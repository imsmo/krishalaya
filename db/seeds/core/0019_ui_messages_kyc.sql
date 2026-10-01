-- ==================================================================================================================
-- db/seeds/core/0019_ui_messages_kyc.sql
-- PC-56 TENANT-9a · THE KYC DESK — the words a KYC notice is worded with, in every language a member can be told in.
-- ==================================================================================================================
-- `kyc.approved / rejected / expiring / expired` (seed 0007) name the DOCUMENT and, on a refusal, the REASON. Both are
-- platform codes (`fssai_licence`, `blurry_image`); a Gujarati notice with an English code in it is TENANT-6d-7's defect.
-- So the words live here, per language, and the KYC service reads them by prefix and fails CLOSED on a missing English row.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('kyc.doc_type.aadhaar','en','Aadhaar'),('kyc.doc_type.aadhaar','hi','आधार'),('kyc.doc_type.aadhaar','gu','આધાર'),
  ('kyc.doc_type.pan','en','PAN card'),('kyc.doc_type.pan','hi','पैन कार्ड'),('kyc.doc_type.pan','gu','પાન કાર્ડ'),
  ('kyc.doc_type.land_record','en','land record'),('kyc.doc_type.land_record','hi','भूमि अभिलेख'),('kyc.doc_type.land_record','gu','જમીનનો રેકર્ડ'),
  ('kyc.doc_type.gst_cert','en','GST certificate'),('kyc.doc_type.gst_cert','hi','जीएसटी प्रमाणपत्र'),('kyc.doc_type.gst_cert','gu','જીએસટી પ્રમાણપત્ર'),
  ('kyc.doc_type.rc','en','vehicle registration certificate'),('kyc.doc_type.rc','hi','वाहन पंजीकरण प्रमाणपत्र'),('kyc.doc_type.rc','gu','વાહન નોંધણી પ્રમાણપત્ર'),
  ('kyc.doc_type.society_registration','en','registration certificate'),('kyc.doc_type.society_registration','hi','पंजीकरण प्रमाणपत्र'),('kyc.doc_type.society_registration','gu','નોંધણી પ્રમાણપત્ર'),
  ('kyc.doc_type.pan_org','en','organisation PAN'),('kyc.doc_type.pan_org','hi','संस्था का पैन'),('kyc.doc_type.pan_org','gu','સંસ્થાનું પાન'),
  ('kyc.doc_type.fssai_licence','en','FSSAI licence'),('kyc.doc_type.fssai_licence','hi','एफएसएसएआई लाइसेंस'),('kyc.doc_type.fssai_licence','gu','એફએસએસએઆઈ લાઇસન્સ'),
  ('kyc.doc_type.bank_proof','en','bank proof'),('kyc.doc_type.bank_proof','hi','बैंक प्रमाण'),('kyc.doc_type.bank_proof','gu','બેંક પુરાવો'),
  ('kyc.reason.blurry_image','en','the photo is blurry or unreadable'),('kyc.reason.blurry_image','hi','फोटो धुंधली या अपठनीय है'),('kyc.reason.blurry_image','gu','ફોટો ઝાંખો અથવા વાંચી ન શકાય એવો છે'),
  ('kyc.reason.back_side_missing','en','the other side of the document is missing'),('kyc.reason.back_side_missing','hi','दस्तावेज़ का दूसरा भाग नहीं है'),('kyc.reason.back_side_missing','gu','દસ્તાવેજની બીજી બાજુ નથી'),
  ('kyc.reason.incomplete_document','en','pages or details are missing'),('kyc.reason.incomplete_document','hi','पन्ने या विवरण अधूरे हैं'),('kyc.reason.incomplete_document','gu','પાના અથવા વિગતો ખૂટે છે'),
  ('kyc.reason.wrong_document','en','this is not the document type submitted'),('kyc.reason.wrong_document','hi','यह जमा किया गया दस्तावेज़ प्रकार नहीं है'),('kyc.reason.wrong_document','gu','આ જમા કરેલો દસ્તાવેજ પ્રકાર નથી'),
  ('kyc.reason.name_mismatch','en','the name does not match'),('kyc.reason.name_mismatch','hi','नाम मेल नहीं खाता'),('kyc.reason.name_mismatch','gu','નામ મેળ ખાતું નથી'),
  ('kyc.reason.number_mismatch','en','the number does not match the document'),('kyc.reason.number_mismatch','hi','नंबर दस्तावेज़ से मेल नहीं खाता'),('kyc.reason.number_mismatch','gu','નંબર દસ્તાવેજ સાથે મેળ ખાતો નથી'),
  ('kyc.reason.document_expired','en','the document has already lapsed'),('kyc.reason.document_expired','hi','दस्तावेज़ की अवधि समाप्त हो चुकी है'),('kyc.reason.document_expired','gu','દસ્તાવેજની મુદત પૂરી થઈ ગઈ છે'),
  ('kyc.reason.other','en','see the desk''s note'),('kyc.reason.other','hi','डेस्क की टिप्पणी देखें'),('kyc.reason.other','gu','ડેસ્કની નોંધ જુઓ')
ON CONFLICT DO NOTHING;
