// apps/mobile/src/core/i18n/locales/ar.ts · Arabic (ar · dir rtl · Intl ar-AE-u-nu-latn) — MACHINE DRAFT, NOT REVIEWED.
// Every value was machine-translated from en.json at PC-56 RTL-1h-1 (2026-11-11) and has NOT been read by a native Arabic reviewer.
// It is NOT final copy: `ar` stays 'machine-draft-pending-review' in @krishalaya/i18n, is served only when a person chooses it in
// Settings → Language (saved on this phone as `kv.lang`, never on the account), and every screen in Arabic carries the machine-draft
// banner. Founder review owed — PC56_TRACKER.md row "RTL-1 · Arabic copy review" and 07_RTL.md STATE. Never translated: organisation
// names, codes and IDs, {placeholders}. Numerals: Western (founder Q4).
//
// SCOPE (RTL-1h-1): ONLY the app shell — the new language keys of this wave (the Arabic row, the restart notice, the banner), the
// Settings → Language screen, the offline line and the farmer tab bar. Every other key falls back to English through the Translator
// (the RTL-1b-1 pattern). RTL-1h-3 replaces this file with the whole catalogue. A TypeScript file, not JSON, so it can carry this header.
import type { Messages } from '@krishalaya/i18n';

const ar: Messages = {
  // --- shell ---
  'common.offline': 'أنت غير متصل. ستتم مزامنة التغييرات عند إعادة الاتصال.',
  'common.unavailable': 'هذا القسم غير متاح مؤقتًا.',
  'shell.draftBanner': 'هذا النص العربي مسودة آلية ولم تتم مراجعته.',
  'tabs.home': 'الرئيسية',
  'tabs.listings': 'الإعلانات',
  'tabs.orders': 'الطلبات',
  'tabs.wallet': 'المحفظة',
  'tabs.profile': 'الملف الشخصي',
  // --- Settings → Language ---
  'system.language.apply': 'تطبيق اللغة',
  'system.language.comingSoonSub': 'قريبًا',
  'system.language.draftTag': '(مسودة آلية)',
  'system.language.heroSub': 'تتغير فورًا · دون إعادة تشغيل التطبيق',
  'system.language.heroTitle': 'تغيير اللغة',
  'system.language.note': 'اختر لغتك المفضلة.',
  'system.language.opt.english': 'استخدام الإنجليزية للمصطلحات التقنية',
  'system.language.opt.sms': 'الرسائل القصيرة بنفس اللغة',
  'system.language.opt.tts': 'الردود الصوتية (تحويل النص إلى كلام)',
  'system.language.restart.toArabic': 'أغلق Krishalaya وأعد فتحه للتبديل إلى العربية.',
  'system.language.restart.toOther': 'أغلق Krishalaya وأعد فتحه للتبديل إلى {language}.',
  'system.language.settings': 'إعدادات اللغة',
  'system.language.soonBadge': 'قريبًا',
  'system.language.sub.ar': 'العربية · لم تتم مراجعتها بعد',
  'system.language.sub.en': 'للمسؤولين وبعض المشترين',
  'system.language.sub.gu': 'الغوجاراتية · 80% من المزارعين',
  'system.language.sub.hi': 'الهندية · 90% من المزارعين يفهمونها',
  'system.language.title': 'اختر اللغة',
};

export default ar;
