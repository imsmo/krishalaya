# Onboarding & Auth — screen build specs

- **Route group:** `src/app/(auth)`  ·  **Feature/data:** `core/auth`  ·  **Flag (default OFF):** `(always-on)`
- Build each screen to FULL design parity (guide §12). Content below is the EXACT design text/values the
  screen must show (from `docs/design-data/SCREEN-DATA-CATALOG.md`) — render via i18n keys (hi/en/gu),
  money via `MoneyText` (paise), all from `ui-native` tokens. Verify against real seeded data, never hardcode.


## 01-welcome — 01 · Welcome — Krishalaya
- **Design:** `Phase-1 all screen design/Krishalaya_Design_System/screens/01-welcome.html`
- **Route:** `src/app/(auth)/…`  ·  **Feature:** `core/auth`  ·  **Flag:** `(always-on)`
- **Must render (exact design content):**
  - 01 · Welcome — Krishalaya
  - Krishalaya
  - From Farm to Future
  - आपकी खेती का डिजिटल साथी
  - Your farming, digitally yours.
  - Sell your crop in 60 seconds. Get fair prices. Hire workers. Manage your wallet. Everything in one place — in your language.
  - Get Started
  - Already have an account?
  - Sign in
- **States (Law 12):** loading = skeleton mirroring THIS layout · empty = designed `EmptyState` · error = inline retry. Never a blank body.
- **i18n:** add hi/en/gu keys for every string above. **Money:** bigint paise via MoneyText.
- **Parity check:** every region above present; ui-native palette/radius/shadow; verify as Ramesh (+919900000101); degrade (never fake) any datum the API can't supply yet (flag it).

## 02-language — 02 · Choose Language — Krishalaya
- **Design:** `Phase-1 all screen design/Krishalaya_Design_System/screens/02-language.html`
- **Route:** `src/app/(auth)/…`  ·  **Feature:** `core/auth`  ·  **Flag:** `(always-on)`
- **Must render (exact design content):**
  - 02 · Choose Language — Krishalaya
  - Choose Your Language
  - अपनी भाषा चुनें
  - તમારી ભાષા પસંદ કરો
  - You can change this anytime in Settings
  - अ
  - हिंदी
  - Hindi · हिंदुस्तानी
  - A
  - English
  - अंग्रेज़ी · International
  - ગ
  - ગુજરાતી
  - Gujarati · ગુજરાત
  - Continue / आगे बढ़ें
- **States (Law 12):** loading = skeleton mirroring THIS layout · empty = designed `EmptyState` · error = inline retry. Never a blank body.
- **i18n:** add hi/en/gu keys for every string above. **Money:** bigint paise via MoneyText.
- **Parity check:** every region above present; ui-native palette/radius/shadow; verify as Ramesh (+919900000101); degrade (never fake) any datum the API can't supply yet (flag it).

## 03-otp — 03 · Verify Phone — Krishalaya
- **Design:** `Phase-1 all screen design/Krishalaya_Design_System/screens/03-otp.html`
- **Route:** `src/app/(auth)/…`  ·  **Feature:** `core/auth`  ·  **Flag:** `(always-on)`
- **Must render (exact design content):**
  - 03 · Verify Phone — Krishalaya
  - Verify Your Number
  - Enter the 6-digit code sent to
  - +91 98765 43210
  - Didn't receive code?
  - Resend in 0:24
  - For your safety, never share this OTP with anyone, not even Krishalaya team.
  - Verify & Continue
- **States (Law 12):** loading = skeleton mirroring THIS layout · empty = designed `EmptyState` · error = inline retry. Never a blank body.
- **i18n:** add hi/en/gu keys for every string above. **Money:** bigint paise via MoneyText.
- **Parity check:** every region above present; ui-native palette/radius/shadow; verify as Ramesh (+919900000101); degrade (never fake) any datum the API can't supply yet (flag it).

## 04-role — 04 · Choose Role — Krishalaya
- **Design:** `Phase-1 all screen design/Krishalaya_Design_System/screens/04-role.html`
- **Route:** `src/app/(auth)/…`  ·  **Feature:** `core/auth`  ·  **Flag:** `(always-on)`
- **Must render (exact design content):**
  - 04 · Choose Role — Krishalaya
  - Choose Your Role
  - How will you use Krishalaya?
  - Pick what fits you best. You can add more roles later.
  - Farmer
  - किसान
  - Sell your crops, book labour, manage your farm
  - Buyer / Customer
  - खरीदार
  - Buy fresh produce direct from farmers
  - Vyapari / Trader
  - व्यापारी
  - Bid in auctions, bulk procurement
  - FPO / Business Owner
  - व्यवसाय
  - Launch your own branded marketplace
  - Village Ambassador
  - ग्राम सहायक
  - Onboard farmers & workers, earn commission
  - Continue as Farmer
- **States (Law 12):** loading = skeleton mirroring THIS layout · empty = designed `EmptyState` · error = inline retry. Never a blank body.
- **i18n:** add hi/en/gu keys for every string above. **Money:** bigint paise via MoneyText.
- **Parity check:** every region above present; ui-native palette/radius/shadow; verify as Ramesh (+919900000101); degrade (never fake) any datum the API can't supply yet (flag it).

## 05-profile-setup — 05 · Set Up Profile — Krishalaya
- **Design:** `Phase-1 all screen design/Krishalaya_Design_System/screens/05-profile-setup.html`
- **Route:** `src/app/(auth)/…`  ·  **Feature:** `core/auth`  ·  **Flag:** `(always-on)`
- **Must render (exact design content):**
  - 05 · Set Up Profile — Krishalaya
  - Set Up Your Profile
  - Skip
  - Tell us a little about yourself so we can personalise your experience
  - Add Photo
  - Full Name
  - *
  - Village / Location
  - *
  - Detect via GPS
  - Pincode
  - Farm Size
  - Small (< 2 acres)
  - Medium (2-10 acres)
  - Large (10+ acres)
  - UPI ID
  - — for receiving payments (optional, add later)
  - Your data is safe
  - We never share your information without consent.
  - Save Draft
  - Save & Continue
- **States (Law 12):** loading = skeleton mirroring THIS layout · empty = designed `EmptyState` · error = inline retry. Never a blank body.
- **i18n:** add hi/en/gu keys for every string above. **Money:** bigint paise via MoneyText.
- **Parity check:** every region above present; ui-native palette/radius/shadow; verify as Ramesh (+919900000101); degrade (never fake) any datum the API can't supply yet (flag it).
