# TLS public-key pinning (mobile app)

PC-56 MOB-TLS-1. Owner: mobile lead. Next review: **2027-11** (see the calendar below).

## What is pinned

| | |
|---|---|
| Hosts | The app's own API host only — the host of `EXPO_PUBLIC_API_URL` (e.g. `api.krishalaya.com`, `api.staging.krishalaya.com`). Exact host, no subdomains. The app has no realtime/WebSocket connection today; if one is added, pass its URL in `extraUrls` (`src/core/security/tls-pins.ts`). |
| Builds | `preview` (appEnv `staging`), `beta` and `production` (appEnv `production`). **Never** `development`, Expo Go, local builds, or any `localhost` / IP / `.local` / ngrok / `exp.direct` host. |
| Never pinned | Third parties: Razorpay, Sentry, Expo (OTA, push), Google/Firebase, Apple, and AWS-owned names (S3 presigned media uploads, CloudFront). They rotate keys without notice and secure their own SDKs. The builder refuses them even if misconfigured. |
| Layer | **CA level**, never our leaf. Production TLS is an AWS ACM certificate on the ALB; ACM renews it (with a new key) by itself, so a leaf pin would lock every installed app out at the next renewal. |
| Pins | All five below, for every pinned host (TrustKit needs ≥ 2). |
| Expiry | **2028-05-31** (UTC). After that date the pins switch themselves off and the app does normal system-CA validation — a phone that never updates fails **open**, it is never locked out. |

| CA | SPKI SHA-256 (base64) | CA expiry |
|---|---|---|
| Amazon Root CA 1 (RSA 2048) | `++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=` | 2038-01-17 |
| Amazon Root CA 2 (RSA 4096) | `f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=` | 2040-05-26 |
| Amazon Root CA 3 (ECC P-256) | `NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=` | 2040-05-26 |
| Amazon Root CA 4 (ECC P-384) | `9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=` | 2040-05-26 |
| Starfield Services Root Certificate Authority – G2 | `KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=` | 2037-12-31 |

Why these: our ACM certificate (Terraform `infra/terraform/modules/acm`, default RSA 2048) chains
leaf → *Amazon RSA 2048 M0x* → *Amazon Root CA 1*. ALBs also send Amazon Root CA 1 **cross-signed by Starfield Services
Root G2**; the cross-signed certificate carries the same key, so pin 1 matches whichever path the phone builds. Roots 2–4
cover ACM switching us to RSA 4096 or ECDSA certificates; Starfield G2 covers old trust stores that end the path there.
Verified on 2026-11-24 against live ACM endpoints (`aws.amazon.com`, `sts.ap-south-1.amazonaws.com` → M04 → Amazon Root
CA 1 issued by Starfield G2; `good.sca1a.amazontrust.com` → M01 → Amazon Root CA 1).

## How it works

- `src/core/security/tls-pins.ts` — the pins, the expiry and the pure builder `buildPinningOptions({ appEnv, apiUrl })`
  (unit-tested: pins only for staging/production, never dev or third-party hosts, ≥ 2 pins, expiry set).
- `src/core/security/tls-pinning.runtime.ts` — installs them with
  [`react-native-ssl-public-key-pinning`](https://github.com/frw/react-native-ssl-public-key-pinning) **1.2.6**
  (autolinked; no config plugin): Android → an OkHttp `CertificatePinner` on React Native's networking client (every
  `fetch`/XHR); iOS → TrustKit on React Native's `NSURLSession`. Started at boot, and both API clients await it before
  their first request, so nothing reaches the API unpinned.
- A pin mismatch fails the request natively; the app shows its ordinary network error (never a crash), and the native
  event is reported **once per host per session** to Sentry as `TlsPinFailure` with `{ kind, host, platform }` — the
  hostname only, never a URL, path, query string or the presented certificate chain.
- Android `android:networkSecurityConfig` (`apps/mobile/plugins/with-android-network-security.js`): release trusts **system
  CAs only** (user-installed CAs refused — Android's default since API 24, now explicit) and forbids cleartext; the
  `debug` build type gets a resource overlay allowing cleartext (Metro) and user CAs (dev proxies). Pins are deliberately
  **not** in a `<pin-set>`: the platform would reject the handshake before OkHttp and the failure could not be reported.
  `usesCleartextTraffic: false` stays in `expo-build-properties`.
- iOS has no Info.plist / `NSPinnedDomains` entry (it has no expiry, so it could brick never-updated phones). iOS already
  refuses user-installed CAs unless the user trusts them by hand; TrustKit's pins also reject those.

**Not covered (residual):** media/KYC uploads go to S3 presigned URLs through `expo-file-system`'s own HTTP client — not
pinned (AWS-owned host, and a different client); on Android they still get the system-CAs-only policy. A rooted/jailbroken
phone with Frida can strip any client check — server-side authority is the real control.

## Recompute / verify the pins

```sh
mkdir -p /tmp/pins && cd /tmp/pins
for c in AmazonRootCA1 AmazonRootCA2 AmazonRootCA3 AmazonRootCA4 SFSRootCAG2; do
  curl -sfSLO "https://www.amazontrust.com/repository/$c.pem"
  printf '%s  ' "$c"
  openssl x509 -in "$c.pem" -pubkey -noout \
    | openssl pkey -pubin -outform der \
    | openssl dgst -sha256 -binary | openssl enc -base64
done

# What our API actually presents (every certificate's SPKI; one must match a pin):
H=api.krishalaya.com
echo | openssl s_client -connect $H:443 -servername $H -showcerts 2>/dev/null \
  | awk '/BEGIN CERT/{n++; f="c" n ".pem"} n{print > f}'
for f in c*.pem; do openssl x509 -in $f -noout -subject -issuer
  openssl x509 -in $f -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64; done
```

The values must equal `AMAZON_TRUST_PINS` in `tls-pins.ts` (and the test `mob-tls1-pinning.spec.ts`, which fixes them).

## Review calendar

- **Every November** (next 2027-11): re-run the commands above against production and staging; read the
  [Amazon Trust Services repository](https://www.amazontrust.com/repository/) and AWS ACM announcements for new roots or
  intermediates; push `PIN_EXPIRATION_DATE` ~18 months out and ship it in that cycle's **store release**. The yearly bump
  keeps every app that updates at least once a year pinned.
- **Hard deadline:** a store release carrying a new expiry must be live by **2027-11-30** (six months before 2028-05-31).
  If it slips, nothing breaks — pins simply switch off on 2028-05-31 and the app falls back to system-CA validation.

## If AWS changes its CAs (or we leave ACM / the ALB)

1. Add the new CA's SPKI pin **alongside** the old ones in `tls-pins.ts` and ship it in a **store release before** the
   server changes certificate. Wait until the forced-update floor / adoption shows most users on that release.
2. Only then switch the server certificate. Remove the old pins one release later.
3. Moving the API behind CloudFront, Cloudflare or another CA means the same procedure — the edge certificate is what the
   phone sees.

Store releases are the plan. The pins live in the JS bundle, so an EAS **OTA update can also change them** — use that only
as an emergency lever: it reaches a phone only on its next cold start after the download (expo-updates fetches from
`u.expo.dev`, which is not pinned, so it still works while our API is refusing), and never reaches phones with updates
blocked. The Android network security config is native and changes only with a store release.

## Test with mitmproxy (manual, on a device/emulator)

```sh
brew install mitmproxy && mitmproxy --listen-port 8080       # first run creates ~/.mitmproxy/mitmproxy-ca-cert.pem
```

1. Point the phone's Wi-Fi proxy at `<laptop-ip>:8080`, open `http://mitm.it`, install the mitmproxy CA (Android:
   Settings → Security → Install certificate → CA; iOS: install the profile **and** enable it under General → About →
   Certificate Trust Settings).
2. **Dev build** (`expo run:android` / EAS `development`, appEnv development): log in — requests to the API appear in
   mitmproxy in clear text. Expected: no pinning, user CA trusted (debug overlay).
3. **Pinned build** (EAS `preview`, appEnv staging, API `https://api.staging.krishalaya.com`): open the app and request an
   OTP. Expected: the screen shows the usual network error; mitmproxy shows the TLS handshake failing (Android release
   refuses the user CA outright; iOS/TrustKit and an Android device with the CA in the *system* store fail on the pin);
   Sentry receives one `TlsPinFailure` with `host: api.staging.krishalaya.com` (only for the pin case; a refused user CA
   is a plain TLS error). Razorpay checkout, Sentry and OTA traffic still work through the proxy (not pinned).
4. Remove the proxy → the pinned build works normally.
5. Expiry check (optional): build `preview` with `PIN_EXPIRATION_DATE` set to yesterday → requests through mitmproxy succeed
   on iOS / a system-CA Android device (fails open).
