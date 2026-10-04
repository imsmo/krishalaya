-- 0027 · PC-56 TENANT-SW-c · the words a staff-invite SMS is worded with (en / hi / gu) and the staff role names it carries.
-- The SMS is rendered by the identity module's StaffInvitedHandler in the INVITE's language. `{org}`, `{role}`, `{link}`, `{code}`,
-- `{days}` are filled at send time; the token never lands in a table in clear (sealed until the SMS leaves, then only its hash).
-- NOTE (ops): India's DLT regime requires a registered template for transactional SMS; these texts are the template bodies to register.
INSERT INTO ui_messages (key, language_code, text) VALUES
 ('team.invite.sms.link', 'en', 'You are invited to join {org} as {role} on Krishalaya. Open {link} and confirm with the code we send to this phone. Valid {days} days.'),
 ('team.invite.sms.link', 'hi', 'आपको Krishalaya पर {org} में {role} के रूप में जुड़ने का निमंत्रण है। {link} खोलें और इस फ़ोन पर भेजे गए कोड से पुष्टि करें। {days} दिन तक मान्य।'),
 ('team.invite.sms.link', 'gu', 'તમને Krishalaya પર {org} માં {role} તરીકે જોડાવાનું આમંત્રણ છે. {link} ખોલો અને આ ફોન પર મોકલેલા કોડથી પુષ્ટિ કરો. {days} દિવસ માન્ય.'),
 ('team.invite.sms.code', 'en', 'You are invited to join {org} as {role} on Krishalaya. On the console''s invite page enter code {code}, then the code we send to this phone. Valid {days} days.'),
 ('team.invite.sms.code', 'hi', 'आपको Krishalaya पर {org} में {role} के रूप में जुड़ने का निमंत्रण है। कंसोल के निमंत्रण पेज पर कोड {code} डालें, फिर इस फ़ोन पर भेजा गया कोड। {days} दिन तक मान्य।'),
 ('team.invite.sms.code', 'gu', 'તમને Krishalaya પર {org} માં {role} તરીકે જોડાવાનું આમંત્રણ છે. કન્સોલના આમંત્રણ પેજ પર કોડ {code} દાખલ કરો, પછી આ ફોન પર મોકલેલો કોડ. {days} દિવસ માન્ય.'),
 ('team.role.tenant_admin', 'en', 'administrator'), ('team.role.tenant_admin', 'hi', 'प्रशासक'), ('team.role.tenant_admin', 'gu', 'વ્યવસ્થાપક'),
 ('team.role.tenant_staff', 'en', 'staff member'), ('team.role.tenant_staff', 'hi', 'स्टाफ़ सदस्य'), ('team.role.tenant_staff', 'gu', 'સ્ટાફ સભ્ય'),
 ('team.role.support_agent', 'en', 'support agent'), ('team.role.support_agent', 'hi', 'सहायता एजेंट'), ('team.role.support_agent', 'gu', 'સહાય એજન્ટ'),
 ('team.role.auditor', 'en', 'auditor'), ('team.role.auditor', 'hi', 'लेखा परीक्षक'), ('team.role.auditor', 'gu', 'ઓડિટર'),
 ('team.role.fpo_coordinator', 'en', 'FPO coordinator'), ('team.role.fpo_coordinator', 'hi', 'एफ़पीओ समन्वयक'), ('team.role.fpo_coordinator', 'gu', 'એફપીઓ સંયોજક')
ON CONFLICT (key, language_code) DO UPDATE SET text = EXCLUDED.text;
