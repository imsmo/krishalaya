# Step 5 — Run the mobile app (React Native + Expo)

The mobile app (`apps/mobile`) is React Native, run through **Expo**. The easiest beginner path is **Expo Go on
your real phone** (no Xcode/Android Studio). The single thing that trips everyone up: **the phone cannot reach
"localhost" — that means the phone itself, not your Mac.** So we point the app at your Mac's network address.

Prerequisite: the **API (Step 3.1) is running on :3000**, and your **Mac + phone are on the same Wi-Fi**.

---

## 5.1 Find your Mac's local IP address

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```
This prints something like `192.168.1.42`. Note it — that's `<MAC_IP>` below.

> If it prints nothing, you're likely on Ethernet or a VPN; turn off the VPN and ensure Wi-Fi is connected.

---

## 5.2 Point the app at your Mac (not localhost)

```bash
echo 'EXPO_PUBLIC_API_URL=http://<MAC_IP>:3000' > apps/mobile/.env
# example: echo 'EXPO_PUBLIC_API_URL=http://192.168.1.42:3000' > apps/mobile/.env
```
Replace `<MAC_IP>` with the address from 5.1. **Do not use `localhost` here** — it would point the phone at itself.

> The NestJS API already listens on all network interfaces (`0.0.0.0`), so your phone can reach it at the Mac IP.
> The first time, macOS may pop up "Do you want the application node to accept incoming connections?" → click
> **Allow**.

---

## 5.3 Start Expo

```bash
nvm use
cd apps/mobile
pnpm start
```
A QR code appears in the terminal.

- **iPhone:** open the **Camera** app, point at the QR → tap the banner → it opens in **Expo Go**.
- **Android:** open the **Expo Go** app → **Scan QR code** → point at the terminal QR.

The app downloads the JS bundle (first time is slow) and launches. You should land on the onboarding/login screen.

---

## 5.4 If the phone can't connect (very common) — use a tunnel

If the app is stuck on "Downloading…" or shows a network error, your Wi-Fi may block device-to-device traffic
(common on office/college networks). Use Expo's tunnel, which routes through the internet instead of the LAN:
```bash
pnpm start --tunnel ngrok
```
(Expo SDK 58: plain `--tunnel` is Expo's new tunnel and needs `npx expo login` first; `--tunnel ngrok` uses the
`@expo/ngrok` dev dependency the app already has, no account needed.) Re-scan the new QR. With `--tunnel` the LAN IP doesn't matter,
**but** the app still calls your API at `EXPO_PUBLIC_API_URL`, which on a tunnel must be publicly reachable — so
for tunnel mode either keep on the same Wi-Fi (LAN IP still works for the API) or expose the API too. For a
beginner: **first try same-Wi-Fi (5.2 + 5.3); only use --tunnel if that fails**, and stay on the same Wi-Fi so the
Mac IP still reaches the API.

---

## 5.5 Optional: run on a simulator/emulator instead of a phone

Only if you did Path B in Step 1.7:
```bash
pnpm start          # then press:
#   i  → open iOS Simulator   (needs Xcode)
#   a  → open Android Emulator (needs Android Studio + a running AVD)
```
On a **simulator**, `localhost` *does* reach your Mac, so you can use `EXPO_PUBLIC_API_URL=http://localhost:3000`
for the iOS Simulator. (Android Emulator uses the special host `http://10.0.2.2:3000` for the Mac's localhost.)

---

## 5.6 Reloading & stopping

- Edit code → it hot-reloads. Press `r` in the Expo terminal to force reload.
- Press `Ctrl+C` to stop Expo.
- Logs from the app print in the Expo terminal (and in Expo Go's dev menu — shake the phone).

Mobile running? Continue to **`06-test-and-smoke.md`** to run the test suites and a full end-to-end flow.
