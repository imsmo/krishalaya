-- ==================================================================================================================
-- db/seeds/core/0021_ui_messages_esg.sql
-- PC-56 TENANT-9d · ESG — the words of the method registry (0183), in every launch language.
-- ==================================================================================================================
--
-- Three families, keyed by the metric code 0183 declares:
--   esg.metric.<code>.name    — the metric's name (all fourteen rows the canon draws)
--   esg.metric.<code>.needs   — for a row with NO published method: the fact table it would need, said plainly
--   esg.method.<code>.text    — for a PUBLISHED method: the method itself, cited on the dashboard, the method page and in
--                               the export's method appendix
-- The API reads them through `UiMessageRepository` and fails CLOSED when an English row is missing (langMapFrom).
-- Platform vocabulary, not tenant data: a cooperative writes its own words as a DISCLOSURE (esg_disclosures), never here.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('esg.metric.water_per_kg.name', 'en', 'Water per kg of groundnut'),
  ('esg.metric.water_per_kg.name', 'hi', 'मूंगफली प्रति किलो पानी'),
  ('esg.metric.water_per_kg.name', 'gu', 'મગફળી દીઠ કિલો પાણી'),
  ('esg.metric.diesel_per_qtl.name', 'en', 'Diesel per quintal moved'),
  ('esg.metric.diesel_per_qtl.name', 'hi', 'प्रति क्विंटल ढुलाई डीज़ल'),
  ('esg.metric.diesel_per_qtl.name', 'gu', 'ક્વિન્ટલ દીઠ હેરફેર ડીઝલ'),
  ('esg.metric.solar_share_bmc.name', 'en', 'Solar share of bulk-milk-cooler power'),
  ('esg.metric.solar_share_bmc.name', 'hi', 'बल्क मिल्क कूलर की बिजली में सौर हिस्सा'),
  ('esg.metric.solar_share_bmc.name', 'gu', 'બલ્ક મિલ્ક કૂલરની વીજળીમાં સૌર હિસ્સો'),
  ('esg.metric.carbon_participation.name', 'en', 'Carbon — parcel participation'),
  ('esg.metric.carbon_participation.name', 'hi', 'कार्बन — खेतों की भागीदारी'),
  ('esg.metric.carbon_participation.name', 'gu', 'કાર્બન — ખેતરોની ભાગીદારી'),
  ('esg.metric.women_participation.name', 'en', 'Women participation'),
  ('esg.metric.women_participation.name', 'hi', 'महिला भागीदारी'),
  ('esg.metric.women_participation.name', 'gu', 'મહિલા ભાગીદારી'),
  ('esg.metric.wage_on_time.name', 'en', 'Wages paid on time'),
  ('esg.metric.wage_on_time.name', 'hi', 'समय पर मज़दूरी'),
  ('esg.metric.wage_on_time.name', 'gu', 'સમયસર મજૂરી'),
  ('esg.metric.delay_compensation.name', 'en', 'Delay compensation'),
  ('esg.metric.delay_compensation.name', 'hi', 'देरी का मुआवज़ा'),
  ('esg.metric.delay_compensation.name', 'gu', 'વિલંબ વળતર'),
  ('esg.metric.adulteration.name', 'en', 'Adulteration'),
  ('esg.metric.adulteration.name', 'hi', 'मिलावट'),
  ('esg.metric.adulteration.name', 'gu', 'ભેળસેળ'),
  ('esg.metric.worksite_facilities.name', 'en', 'Safety — worksite facilities'),
  ('esg.metric.worksite_facilities.name', 'hi', 'सुरक्षा — कार्यस्थल की सुविधाएँ'),
  ('esg.metric.worksite_facilities.name', 'gu', 'સલામતી — કાર્યસ્થળની સુવિધાઓ'),
  ('esg.metric.worksite_injury_rate.name', 'en', 'Worksite injury rate'),
  ('esg.metric.worksite_injury_rate.name', 'hi', 'कार्यस्थल पर चोट की दर'),
  ('esg.metric.worksite_injury_rate.name', 'gu', 'કાર્યસ્થળે ઈજાનો દર'),
  ('esg.metric.one_member_one_vote.name', 'en', 'One member, one vote'),
  ('esg.metric.one_member_one_vote.name', 'hi', 'एक सदस्य, एक वोट'),
  ('esg.metric.one_member_one_vote.name', 'gu', 'એક સભ્ય, એક મત'),
  ('esg.metric.to_farmer_hands.name', 'en', 'Share reaching farmers'' hands'),
  ('esg.metric.to_farmer_hands.name', 'hi', 'किसानों के हाथ तक पहुँचा हिस्सा'),
  ('esg.metric.to_farmer_hands.name', 'gu', 'ખેડૂતોના હાથ સુધી પહોંચેલો હિસ્સો'),
  ('esg.metric.audit_trail.name', 'en', 'Audit trail'),
  ('esg.metric.audit_trail.name', 'hi', 'ऑडिट ट्रेल'),
  ('esg.metric.audit_trail.name', 'gu', 'ઑડિટ ટ્રેલ'),
  ('esg.metric.grievance_channels.name', 'en', 'Grievance channels'),
  ('esg.metric.grievance_channels.name', 'hi', 'शिकायत के माध्यम'),
  ('esg.metric.grievance_channels.name', 'gu', 'ફરિયાદનાં માધ્યમો')
ON CONFLICT DO NOTHING;

-- WHAT EACH UNPUBLISHED ROW WOULD NEED. Said, so nobody computes it from the wrong table.
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('esg.metric.water_per_kg.needs', 'en', 'Needs litres of water per irrigation and the yield per parcel. The platform records an irrigation type per parcel (a category, not litres) and no yield per kilogram.'),
  ('esg.metric.water_per_kg.needs', 'hi', 'हर सिंचाई का पानी (लीटर) और हर खेत की उपज चाहिए। प्लेटफ़ॉर्म हर खेत का सिंचाई प्रकार रखता है (एक श्रेणी, लीटर नहीं) और प्रति किलो उपज नहीं रखता।'),
  ('esg.metric.water_per_kg.needs', 'gu', 'દરેક પિયતનું પાણી (લીટર) અને દરેક ખેતરની ઉપજ જોઈએ. પ્લેટફૉર્મ દરેક ખેતરનો પિયત પ્રકાર રાખે છે (એક શ્રેણી, લીટર નહીં) અને કિલો દીઠ ઉપજ રાખતું નથી.'),
  ('esg.metric.diesel_per_qtl.needs', 'en', 'Needs fuel recorded per trip. Trips carry no fuel figure; the only fuel field says whether an equipment rate includes fuel.'),
  ('esg.metric.diesel_per_qtl.needs', 'hi', 'हर फेरे का ईंधन दर्ज होना चाहिए। फेरों में ईंधन का कोई आँकड़ा नहीं है; ईंधन का एकमात्र खाना बताता है कि उपकरण दर में ईंधन शामिल है या नहीं।'),
  ('esg.metric.diesel_per_qtl.needs', 'gu', 'દરેક ફેરાનું બળતણ નોંધાવું જોઈએ. ફેરામાં બળતણનો કોઈ આંકડો નથી; બળતણનું એકમાત્ર ખાનું કહે છે કે સાધન દરમાં બળતણ સામેલ છે કે નહીં.'),
  ('esg.metric.solar_share_bmc.needs', 'en', 'Needs a power meter reading per bulk-milk cooler, solar and grid apart. Coolers carry a device reference and no power reading.'),
  ('esg.metric.solar_share_bmc.needs', 'hi', 'हर बल्क मिल्क कूलर का बिजली मीटर रीडिंग चाहिए, सौर और ग्रिड अलग-अलग। कूलरों के पास केवल उपकरण संदर्भ है, बिजली की कोई रीडिंग नहीं।'),
  ('esg.metric.solar_share_bmc.needs', 'gu', 'દરેક બલ્ક મિલ્ક કૂલરનું વીજ મીટર વાંચન જોઈએ, સૌર અને ગ્રિડ અલગ. કૂલર પાસે માત્ર સાધન સંદર્ભ છે, વીજળીનું કોઈ વાંચન નથી.'),
  ('esg.metric.carbon_participation.needs', 'en', 'No carbon programme is recorded on this platform. The platform does not issue or sell credits.'),
  ('esg.metric.carbon_participation.needs', 'hi', 'इस प्लेटफ़ॉर्म पर कोई कार्बन कार्यक्रम दर्ज नहीं है। प्लेटफ़ॉर्म क्रेडिट जारी नहीं करता और बेचता नहीं।'),
  ('esg.metric.carbon_participation.needs', 'gu', 'આ પ્લેટફૉર્મ પર કોઈ કાર્બન કાર્યક્રમ નોંધાયેલો નથી. પ્લેટફૉર્મ ક્રેડિટ જારી કરતું નથી કે વેચતું નથી.'),
  ('esg.metric.women_participation.needs', 'en', 'Needs a declared basis: which roll is the denominator, and gender as the person''s own answer where “not stated” is its own value. The profile''s gender is a free field with no vocabulary.'),
  ('esg.metric.women_participation.needs', 'hi', 'एक घोषित आधार चाहिए: हर किस सूची से गिना जाए, और लिंग व्यक्ति का अपना उत्तर हो जहाँ “नहीं बताया” अपना अलग मान हो। प्रोफ़ाइल का लिंग एक खुला खाना है, बिना शब्दावली के।'),
  ('esg.metric.women_participation.needs', 'gu', 'એક જાહેર આધાર જોઈએ: ભાજક કઈ યાદી છે, અને લિંગ વ્યક્તિનો પોતાનો જવાબ હોય જ્યાં “જણાવ્યું નથી” પોતાનું અલગ મૂલ્ય હોય. પ્રોફાઇલનું લિંગ શબ્દાવલી વગરનું ખુલ્લું ખાનું છે.'),
  ('esg.metric.wage_on_time.needs', 'en', 'Needs a declared due day per wage cycle to measure against. Attendance and payouts are recorded; the day wages were due is not.'),
  ('esg.metric.wage_on_time.needs', 'hi', 'हर मज़दूरी चक्र की घोषित देय तिथि चाहिए जिससे नापा जाए। हाज़िरी और भुगतान दर्ज हैं; मज़दूरी किस दिन देय थी, यह नहीं।'),
  ('esg.metric.wage_on_time.needs', 'gu', 'દરેક મજૂરી ચક્રની જાહેર ચૂકવણી તારીખ જોઈએ જેની સામે માપી શકાય. હાજરી અને ચૂકવણી નોંધાય છે; મજૂરી કયા દિવસે ચૂકવવાની હતી તે નહીં.'),
  ('esg.metric.delay_compensation.needs', 'en', 'Needs a delay-compensation rule and what it accrued. No such rule exists on this platform.'),
  ('esg.metric.delay_compensation.needs', 'hi', 'देरी के मुआवज़े का नियम और उससे बनी राशि चाहिए। इस प्लेटफ़ॉर्म पर ऐसा कोई नियम नहीं है।'),
  ('esg.metric.delay_compensation.needs', 'gu', 'વિલંબ વળતરનો નિયમ અને તેનાથી બનેલી રકમ જોઈએ. આ પ્લેટફૉર્મ પર એવો કોઈ નિયમ નથી.'),
  ('esg.metric.worksite_facilities.needs', 'en', 'Needs a worksite checklist (crèche, drinking water, shade) recorded per muster. None is recorded.'),
  ('esg.metric.worksite_facilities.needs', 'hi', 'हर मस्टर पर दर्ज कार्यस्थल जाँच सूची (पालना घर, पीने का पानी, छाया) चाहिए। कोई दर्ज नहीं है।'),
  ('esg.metric.worksite_facilities.needs', 'gu', 'દરેક મસ્ટર પર નોંધાયેલી કાર્યસ્થળ ચકાસણી યાદી (ઘોડિયાઘર, પીવાનું પાણી, છાંયો) જોઈએ. કોઈ નોંધાયેલી નથી.'),
  ('esg.metric.worksite_injury_rate.needs', 'en', 'Needs an injury register and the hours worked it is a rate of. Neither is recorded.'),
  ('esg.metric.worksite_injury_rate.needs', 'hi', 'चोटों का रजिस्टर और काम के घंटे चाहिए जिनकी यह दर है। दोनों में से कुछ दर्ज नहीं है।'),
  ('esg.metric.worksite_injury_rate.needs', 'gu', 'ઈજાઓનું રજિસ્ટર અને કામના કલાકો જોઈએ જેનો આ દર છે. બેમાંથી કશું નોંધાયેલું નથી.'),
  ('esg.metric.to_farmer_hands.needs', 'en', 'Needs a declared gross value and a declared basis for what reached farmers'' hands, per financial year. Neither is declared.'),
  ('esg.metric.to_farmer_hands.needs', 'hi', 'हर वित्त वर्ष के लिए घोषित कुल मूल्य और किसानों के हाथ क्या पहुँचा उसका घोषित आधार चाहिए। दोनों घोषित नहीं हैं।'),
  ('esg.metric.to_farmer_hands.needs', 'gu', 'દરેક નાણાકીય વર્ષ માટે જાહેર કુલ મૂલ્ય અને ખેડૂતોના હાથ સુધી શું પહોંચ્યું તેનો જાહેર આધાર જોઈએ. બંને જાહેર નથી.'),
  ('esg.metric.grievance_channels.needs', 'en', 'Needs a grievance register somebody writes. A labour grievance table exists, but nothing on this platform records a grievance — a count would be zero by construction, not zero grievances.'),
  ('esg.metric.grievance_channels.needs', 'hi', 'ऐसा शिकायत रजिस्टर चाहिए जिसमें कोई लिखे। मज़दूर शिकायतों की तालिका है, पर इस प्लेटफ़ॉर्म पर कुछ भी शिकायत दर्ज नहीं करता — गिनती बनावट से शून्य होगी, शिकायतें शून्य नहीं।'),
  ('esg.metric.grievance_channels.needs', 'gu', 'એવું ફરિયાદ રજિસ્ટર જોઈએ જેમાં કોઈ લખે. મજૂર ફરિયાદોનું કોષ્ટક છે, પણ આ પ્લેટફૉર્મ પર કંઈ પણ ફરિયાદ નોંધતું નથી — ગણતરી રચનાથી શૂન્ય થાય, ફરિયાદો શૂન્ય નહીં.')
ON CONFLICT DO NOTHING;

-- THE THREE PUBLISHED METHODS (0183: KV-ESG-G1 v1, KV-ESG-S4 v1, KV-ESG-G3 v1).
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('esg.method.one_member_one_vote.text', 'en', 'Counted from the cooperative''s CLOSED resolutions that carry a recorded snapshot: for each, the ballots in its frozen ballot box and the members eligible at the moment it closed — never today''s roll. A ballot box holds at most one ballot per member (its primary key) and the tally has no shareholding term, so shares add capital and never extra votes. Resolutions closed before the snapshot existed are counted apart and never contribute a figure.'),
  ('esg.method.one_member_one_vote.text', 'hi', 'सहकारी के उन बंद प्रस्तावों से गिना जाता है जिनका स्नैपशॉट दर्ज है: हर एक के लिए उसकी जमी हुई मतपेटी के मत और बंद होने के क्षण पात्र सदस्य — आज की सूची कभी नहीं। एक मतपेटी में हर सदस्य का अधिकतम एक मत होता है (उसकी प्राथमिक कुंजी) और गिनती में शेयर का कोई पद नहीं, इसलिए शेयर पूँजी जोड़ते हैं, कभी अतिरिक्त वोट नहीं। स्नैपशॉट से पहले बंद हुए प्रस्ताव अलग गिने जाते हैं और कोई आँकड़ा नहीं देते।'),
  ('esg.method.one_member_one_vote.text', 'gu', 'સહકારીના એવા બંધ ઠરાવોમાંથી ગણાય છે જેનો સ્નૅપશૉટ નોંધાયેલો છે: દરેક માટે તેની સ્થિર મતપેટીના મત અને બંધ થવાની ક્ષણે પાત્ર સભ્યો — આજની યાદી ક્યારેય નહીં. એક મતપેટીમાં દરેક સભ્યનો વધુમાં વધુ એક મત હોય છે (તેની પ્રાથમિક ચાવી) અને ગણતરીમાં શેરનું કોઈ પદ નથી, તેથી શેર મૂડી ઉમેરે છે, ક્યારેય વધારાના મત નહીં. સ્નૅપશૉટ પહેલાં બંધ થયેલા ઠરાવો અલગ ગણાય છે અને કોઈ આંકડો આપતા નથી.'),
  ('esg.method.adulteration.text', 'en', 'Counted from the pours recorded at the cooperative''s collection centres over the last thirty days in its own time zone: a pour is flagged when the counter recorded water or any adulteration flag on it. Retests are the quality reviews opened on those pours and the ones re-tested. When no pour is recorded in the window there is no figure — never a zero.'),
  ('esg.method.adulteration.text', 'hi', 'सहकारी के संग्रह केंद्रों पर उसके अपने समय क्षेत्र में पिछले तीस दिनों में दर्ज दूध के हर डाल से गिना जाता है: जिस डाल पर काउंटर ने पानी या कोई मिलावट चिह्न दर्ज किया, वह चिह्नित है। पुनः परीक्षण वे गुणवत्ता समीक्षाएँ हैं जो उन डालों पर खुलीं और जिनका दोबारा परीक्षण हुआ। अवधि में कोई डाल दर्ज न हो तो कोई आँकड़ा नहीं — शून्य कभी नहीं।'),
  ('esg.method.adulteration.text', 'gu', 'સહકારીનાં સંગ્રહ કેન્દ્રો પર તેના પોતાના સમય ક્ષેત્રમાં છેલ્લા ત્રીસ દિવસમાં નોંધાયેલા દૂધના દરેક ઠાલવણમાંથી ગણાય છે: જે ઠાલવણ પર કાઉન્ટરે પાણી કે કોઈ ભેળસેળ ચિહ્ન નોંધ્યું, તે ચિહ્નિત છે. પુનઃપરીક્ષણ એ ગુણવત્તા સમીક્ષાઓ છે જે તે ઠાલવણ પર ખૂલી અને જેનું ફરી પરીક્ષણ થયું. સમયગાળામાં કોઈ ઠાલવણ નોંધાયું ન હોય તો કોઈ આંકડો નથી — શૂન્ય ક્યારેય નહીં.'),
  ('esg.method.audit_trail.text', 'en', 'Read from the database catalogue at the moment of reading: whether the cooperative''s application role may change, delete or empty an audit row (append-only means it may only add and read), whether the audit trail carries any hash column, and whether the money ledger carries its hash chain. The trail is append-only; the hash chain belongs to the money ledger, not to the trail.'),
  ('esg.method.audit_trail.text', 'hi', 'पढ़ने के क्षण डेटाबेस कैटलॉग से पढ़ा जाता है: क्या सहकारी की ऐप्लिकेशन भूमिका किसी ऑडिट पंक्ति को बदल, मिटा या खाली कर सकती है (केवल-जोड़ का अर्थ है वह सिर्फ़ जोड़ और पढ़ सकती है), क्या ऑडिट ट्रेल में कोई हैश स्तंभ है, और क्या धन खाते में उसकी हैश शृंखला है। ट्रेल केवल-जोड़ है; हैश शृंखला धन खाते की है, ट्रेल की नहीं।'),
  ('esg.method.audit_trail.text', 'gu', 'વાંચનની ક્ષણે ડેટાબેઝ કૅટલૉગમાંથી વંચાય છે: શું સહકારીની ઍપ્લિકેશન ભૂમિકા કોઈ ઑડિટ પંક્તિ બદલી, ભૂંસી કે ખાલી કરી શકે છે (માત્ર-ઉમેરણનો અર્થ છે તે ફક્ત ઉમેરી અને વાંચી શકે), શું ઑડિટ ટ્રેલમાં કોઈ હૅશ સ્તંભ છે, અને શું નાણાં ખાતામાં તેની હૅશ શૃંખલા છે. ટ્રેલ માત્ર-ઉમેરણ છે; હૅશ શૃંખલા નાણાં ખાતાની છે, ટ્રેલની નહીં.')
ON CONFLICT DO NOTHING;
