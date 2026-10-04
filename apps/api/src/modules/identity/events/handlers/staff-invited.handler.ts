// modules/identity/events/handlers/staff-invited.handler.ts · PC-56 TENANT-SW-c · B2 — consumes `tenancy.staff_invited`: SEND THE INVITE SMS.
//
// The outbox event carries only the invite id. In a kv_app unit of work scoped to the event's tenant (HOTFIX-2: the relay runs as
// kv_relay, which holds nothing on staff_invites), this handler locks the invite, opens the KEK-sealed token (AAD `staff_invite:<id>`),
// words the SMS from `ui_messages` in the invite's language (en / hi / gu — `team.invite.sms.link` with the console link, or
// `team.invite.sms.code` with the code to type when no console URL is configured), sends it through the platform SmsSender (the same
// channel the sign-in OTP uses), then marks the invite `sent_at` and CLEARS the sealed copy — from then on only sha256(token) exists.
// A failed send is recorded on the invite (`send_failure`), the sealed copy kept, and the event completes (no retry storm; the admin
// sees "SMS not sent" and can revoke + re-invite). Idempotent: an invite already sent / closed is a no-op. WhatsApp: no provider is
// connected on this platform (8e) — the channel CHECK admits `sms` only. Never logs the phone or the token.
import { Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UnitOfWork } from '../../../../core/database/unit-of-work';
import { SmsSender } from '../../../../core/auth/otp.service';
import { UiMessageRepository } from '../../../../core/i18n/ui-message.repository';
import { openEnvelope } from '../../../../core/secrets/secret-envelope';
import { VerificationTeamRepository } from '../../repositories/verification-team.repository';
import { INVITE_DAYS, inviteLink } from '../../domain/verification-team';
import { STAFF_INVITED } from '../../services/team.service';

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

export class StaffInvitedHandler implements OutboxHandler {
  readonly eventType = STAFF_INVITED;
  private readonly log = new Logger(StaffInvitedHandler.name);
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: VerificationTeamRepository,
    private readonly ui: UiMessageRepository,
    private readonly sms: SmsSender,
    private readonly kek: Buffer,
    private readonly consoleBaseUrl: string,
  ) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const inviteId = typeof event.payload.inviteId === 'string' ? event.payload.inviteId : null;
    if (!event.tenantId || !inviteId) return;   // malformed — fail closed, never invent a recipient
    const tenantId = event.tenantId;
    const outcome = await this.uow.run(tenantId, async (tx) => {
      const inv = await this.repo.inviteForUpdate(tx, tenantId, inviteId);
      if (!inv || inv.status !== 'pending' || inv.expired || !inv.tokenSealed || inv.sentAt) return 'skipped';
      const token = openEnvelope(this.kek, inv.tokenSealed, `staff_invite:${inv.id}`);
      const words = await this.ui.mapsUnder('team.invite.sms.', tx);
      const roleWords = await this.ui.mapsUnder('team.role.', tx);
      const link = inviteLink(this.consoleBaseUrl, token);
      const key = link ? 'team.invite.sms.link' : 'team.invite.sms.code';
      const lang = inv.languageCode || 'en';
      const tpl = words.get(key);
      const role = roleWords.get(`team.role.${inv.roleCode}`);
      if (!tpl) { await this.repo.markInviteSendFailedTx(tx, tenantId, inv.id, `template_missing: ${key}`); return 'failed'; }   // never an inline literal (Law 7)
      const text = fill(tpl[lang] ?? tpl.en, {
        org: await this.repo.tenantName(tenantId, tx), role: (role?.[lang] ?? role?.en) || inv.roleCode, link: link ?? '', code: token, days: String(INVITE_DAYS),
      });
      try {
        await this.sms.send(inv.phone, text);
      } catch (e) {
        await this.repo.markInviteSendFailedTx(tx, tenantId, inv.id, `sms_failed: ${(e as { code?: string })?.code ?? 'provider_error'}`);
        return 'failed';
      }
      await this.repo.markInviteSentTx(tx, tenantId, inv.id);
      return 'sent';
    }, { userId: undefined });
    if (outcome === 'failed') this.log.warn(`staff invite ${inviteId}: SMS not sent (recorded on the invite)`);
  }
}
