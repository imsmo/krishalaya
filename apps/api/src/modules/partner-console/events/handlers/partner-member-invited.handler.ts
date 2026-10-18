// modules/partner-console/events/handlers/partner-member-invited.handler.ts · PC-56 PARTNER-0 · D4 — consumes `partner.member_invited`:
// SEND THE PARTNER INVITE SMS (the TENANT-SW-c StaffInvitedHandler, on the partner axis).
//
// The event carries the invite id and its partner. The handler does its table work in a PARTNER-REALM kv_app unit of work scoped to that
// partner (the relay runs as kv_relay, which holds NOTHING on partner_invites — HOTFIX-2's rule; the relay gate exercises this case), so
// 0225's policy admits only that partner's invite: a payload naming the wrong partner finds no row and sends nothing. It locks the invite,
// opens the KEK-sealed token (AAD `partner_invite:<id>`), words the SMS from `ui_messages` in the invite's language (`partner.invite.sms.code`,
// `partner.role.<code>` — never an inline literal, Law 7), sends it through the platform SmsSender, marks `sent_at` and CLEARS the sealed
// copy. A failed send is recorded on the invite (`send_failure`) and the event completes (no retry storm; the admin revokes and re-invites).
// Idempotent: an invite already sent / closed is a no-op. Never logs the phone or the token.
import { Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { PartnerRealmUnitOfWork } from '../../../../core/database/partner-realm-uow';
import { SmsSender } from '../../../../core/auth/otp.service';
import { UiMessageRepository } from '../../../../core/i18n/ui-message.repository';
import { openEnvelope } from '../../../../core/secrets/secret-envelope';
import { INVITE_DAYS } from '../../../identity/domain/verification-team';
import { PartnerConsoleRepository } from '../../repositories/partner-console.repository';
import { inviteState } from '../../domain/partner-console.rules';
import { PARTNER_MEMBER_INVITED, partnerInviteAad } from '../../services/partner-team.service';

/** What a platform invite's `send_failure` says: no SMS — the platform administrator handed the code over (0226). */
export const PLATFORM_HANDOVER = 'platform_handover';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

export class PartnerMemberInvitedHandler implements OutboxHandler {
  readonly eventType = PARTNER_MEMBER_INVITED;
  private readonly log = new Logger(PartnerMemberInvitedHandler.name);
  constructor(
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly repo: PartnerConsoleRepository,
    private readonly ui: UiMessageRepository,
    private readonly sms: SmsSender,
    private readonly kek: Buffer,
  ) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const inviteId = typeof event.payload.inviteId === 'string' ? event.payload.inviteId : null;
    const partnerId = typeof event.payload.partnerId === 'string' && UUID.test(event.payload.partnerId) ? event.payload.partnerId : null;
    if (!inviteId || !partnerId) return;   // malformed — fail closed, never invent a recipient
    const outcome = await this.uow.run(partnerId, async (tx) => {
      const inv = await this.repo.inviteForUpdateTx(tx, inviteId);
      // PC-56 PARTNER-1a (0226): the PLATFORM's first-administrator invite keeps no sealed copy (the admin realm holds no KEK) — the platform
      // administrator hands the code over; record that on the invite once, so a pending invite never reads as "queued" for an SMS that never goes.
      if (inv && inviteState(inv) === 'usable' && !inv.tokenSealed && !inv.sentAt && inv.invitedByAdminId && !inv.sendFailure) {
        await this.repo.markInviteSendFailedTx(tx, inv.id, PLATFORM_HANDOVER);
        return 'handover';
      }
      if (!inv || inviteState(inv) !== 'usable' || !inv.tokenSealed || inv.sentAt) return 'skipped';
      const token = openEnvelope(this.kek, inv.tokenSealed, partnerInviteAad(inv.id));
      const words = await this.ui.mapsUnder('partner.invite.sms.', tx);
      const roles = await this.ui.mapsUnder('partner.role.', tx);
      const lang = inv.languageCode || 'en';
      const tpl = words.get('partner.invite.sms.code');
      const role = roles.get(`partner.role.${inv.roleCode}`);
      if (!tpl) { await this.repo.markInviteSendFailedTx(tx, inv.id, 'template_missing: partner.invite.sms.code'); return 'failed'; }
      const org = (await this.repo.partnerOrgTx(tx, partnerId))?.name ?? '';
      const text = fill(tpl[lang] ?? tpl.en, { org, role: (role?.[lang] ?? role?.en) || inv.roleCode, code: token, days: String(INVITE_DAYS) });
      try {
        await this.sms.send(inv.phone, text);
      } catch (e) {
        await this.repo.markInviteSendFailedTx(tx, inv.id, `sms_failed: ${(e as { code?: string })?.code ?? 'provider_error'}`);
        return 'failed';
      }
      await this.repo.markInviteSentTx(tx, inv.id);
      return 'sent';
    });
    if (outcome === 'failed') this.log.warn(`partner invite ${inviteId}: SMS not sent (recorded on the invite)`);
  }
}
