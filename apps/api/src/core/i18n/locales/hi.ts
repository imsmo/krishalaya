// core/i18n/locales/hi.ts · Hindi (Devanagari). Missing keys fall back to English.
const hi: Record<string, string> = {
  'sms.otp': 'Krishi-Verse कोड: {code} ({minutes} मिनट के लिए वैध)। किसी को न बताएं।',
  'error.BAD_REQUEST': 'गलत अनुरोध',
  'error.VALIDATION_FAILED': 'कुछ जानकारी सही नहीं है। कृपया जाँचकर पुनः प्रयास करें।',
  'error.UNAUTHORIZED': 'जारी रखने के लिए कृपया साइन इन करें।',
  'error.FORBIDDEN': 'आपके पास यह करने की अनुमति नहीं है।',
  'error.NOT_FOUND': 'नहीं मिला।',
  'error.CONFLICT': 'यह वर्तमान स्थिति से टकराता है। कृपया रीफ़्रेश करके पुनः प्रयास करें।',
  'error.TOO_MANY_REQUESTS': 'बहुत अधिक प्रयास। कृपया थोड़ी देर बाद प्रयास करें।',
  'error.QUOTA_EXCEEDED': 'आपकी योजना की सीमा पूरी हो गई है।',
  'error.INTERNAL': 'कुछ गड़बड़ हो गई। कृपया पुनः प्रयास करें।',
  'error.OTP_INVALID': 'अमान्य या समाप्त कोड।',
  'error.REFRESH_INVALID': 'आपका सत्र समाप्त हो गया है। कृपया पुनः साइन इन करें।',
  'error.LISTING_NOT_FOUND': 'सूची नहीं मिली।',
  // DEV-27 (Q23) billing-document header badge — brand name kept in Latin script, per sms.otp's own convention above.
  'doc.poweredByKrishiVerse': 'Krishi Verse द्वारा संचालित',
};
export default hi;
