// apps/web-storefront/src/lib/drafts-labels.ts · PC-56 STORE-6b — the catalogue words the drafts and install islands carry (server-side through
// lib/i18n; the client pieces get plain strings, the `{n}` / `{age}` / `{name}` / `{date}` holes filled on the phone). Both chromes read them
// here, so the platform and every organisation say the same thing in en / hi / gu.
import { formatNumber } from '@krishalaya/i18n';
import { getTranslator, getLang } from './i18n';
import type { AccountChrome } from '../features/store4a/account';
import { ASK_DAYS } from '../features/store6b/drafts';
import { syncHref } from '../features/store6b/paths';
import type { KeeperLabels } from '../components/drafts/DraftKeeper';
import type { ChipLabels } from '../components/drafts/DraftsChip';
import type { InviteLabels } from '../components/install/InstallInvite';
import type { StatusLabels } from '../components/install/InstallStatus';

export function keeperLabels(chrome: AccountChrome): KeeperLabels {
  const t = getTranslator();
  return {
    kept: t.t('store6b.keeper.kept'), restored: t.t('store6b.keeper.restored', { age: '{age}' }),
    ask: t.t('store6b.keeper.ask', { days: formatNumber(ASK_DAYS, getLang()) }), missing: t.t('store6b.keeper.missing'),
    link: t.t('store6b.keeper.link'), syncHref: syncHref(chrome),
    now: t.t('store6b.age.now'), minutes: t.t('store6b.age.minutes', { n: '{n}' }), hours: t.t('store6b.age.hours', { n: '{n}' }), days: t.t('store6b.age.days', { n: '{n}' }),
  };
}

export function chipLabels(): ChipLabels {
  const t = getTranslator();
  return { chip: t.t('store6b.chip', { n: '{n}' }), aria: t.t('store6b.chip.aria', { n: '{n}' }) };
}

export function inviteLabels(): InviteLabels {
  const t = getTranslator();
  return {
    title: t.t('store6b.invite.title', { name: '{name}' }), body: t.t('store6b.invite.body'), add: t.t('store6b.invite.add'), notNow: t.t('store6b.invite.notNow'),
    added: t.t('store6b.invite.added', { name: '{name}' }), notAdded: t.t('store6b.invite.notAdded'), close: t.t('store6b.invite.close'),
    appLink: t.t('store6b.invite.appLink'), label: t.t('store6b.invite.label'),
  };
}

export function statusLabels(): StatusLabels {
  const t = getTranslator();
  return { notNow: t.t('store6b.app.status.notNow', { date: '{date}' }), added: t.t('store6b.app.status.added'), cannot: t.t('store6b.app.cannot') };
}
