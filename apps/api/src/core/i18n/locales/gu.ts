// core/i18n/locales/gu.ts · Gujarati. Missing keys fall back to English.
const gu: Record<string, string> = {
  'sms.otp': 'Krishalaya કોડ: {code} ({minutes} મિનિટ માટે માન્ય). કોઈને કહેશો નહીં.',
  'sms.otp_slots': 'Krishalaya કોડ: {code} — તમારી મંડળીએ સૂચવેલા પિકઅપ સમયનો જવાબ આપવા માટે ({minutes} મિનિટ માટે માન્ય). કોઈને કહેશો નહીં.',
  'sms.otp_handover': 'Krishalaya કોડ: {code}. ડ્રોપ પોઇન્ટ પર પાર્સલ તમારા હાથમાં આવે પછી જ ડ્રાઇવરને કહો ({minutes} મિનિટ માટે માન્ય).',
  'sms.otp_collect': 'Krishalaya કોડ: {code}. તમારું પાર્સલ લેતી વખતે જ ડ્રોપ પોઇન્ટને કહો ({minutes} મિનિટ માટે માન્ય).',
  'error.BAD_REQUEST': 'ખોટી વિનંતી',
  'error.VALIDATION_FAILED': 'કેટલીક વિગતો માન્ય નથી. કૃપા કરી તપાસીને ફરી પ્રયાસ કરો.',
  'error.UNAUTHORIZED': 'ચાલુ રાખવા માટે કૃપા કરી સાઇન ઇન કરો.',
  'error.FORBIDDEN': 'તમારી પાસે આ કરવાની પરવાનગી નથી.',
  'error.NOT_FOUND': 'મળ્યું નથી.',
  'error.CONFLICT': 'આ વર્તમાન સ્થિતિ સાથે અથડાય છે. કૃપા કરી રિફ્રેશ કરીને ફરી પ્રયાસ કરો.',
  'error.TOO_MANY_REQUESTS': 'ઘણા બધા પ્રયાસો. કૃપા કરી થોડી વાર પછી પ્રયાસ કરો.',
  'error.QUOTA_EXCEEDED': 'તમારી યોજનાની મર્યાદા પૂરી થઈ ગઈ છે.',
  'error.INTERNAL': 'કંઈક ખોટું થયું. કૃપા કરી ફરી પ્રયાસ કરો.',
  'error.OTP_INVALID': 'અમાન્ય અથવા સમાપ્ત કોડ.',
  'error.REFRESH_INVALID': 'તમારું સત્ર સમાપ્ત થઈ ગયું છે. કૃપા કરી ફરી સાઇન ઇન કરો.',
  'error.LISTING_NOT_FOUND': 'લિસ્ટિંગ મળ્યું નથી.',
  // DEV-27 (Q23) billing-document header badge — brand name kept in Latin script, per sms.otp's own convention above.
  'doc.poweredByKrishalaya': 'Krishalaya દ્વારા સંચાલિત',
};
export default gu;
