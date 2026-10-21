# Race Overlay — PeakPixelCafe

Live Twitch/OBS overlay for the **"Drei Länder – ein Weg"** ultra:
**remaining distance** (PAJ GPS), **live heart rate** (Suunto Vertical 2 / BLE strap), and a **race timer**, with sponsor logos always on screen.

```
 Suunto watch ──BLE──► Android phone (Chrome: /hr.html) ──HTTPS──┐
                                                                 ├─► Node server ──► OBS Browser Source (/)
 PAJ GPS tracker ──4G──► PAJ cloud ◄──API poll── Node server ────┘
```

The server pulls GPS from the PAJ API (no phone needed for GPS — the tracker has its own SIM), receives heart rate from the phone, computes remaining distance, and pushes everything to the overlay over WebSocket.

---

## 1. Run locally

```bash
npm install
npm start
```

Open:
- **Overlay (for OBS):** http://localhost:3000/
- **Control panel:** http://localhost:3000/control.html
- **HR relay (phone):** http://localhost:3000/hr.html
- **Preview (overlay on a backdrop):** http://localhost:3000/preview.html

Demo it without hardware:

```bash
npm run simulate     # animates HR + distance so you can see the overlay live
```

All settings live in `.env` (PAJ login, device ID, total distance, race start, tokens).

---

## 2. OBS setup

1. Add a **Browser Source**.
2. URL = your overlay URL (e.g. `https://<your-domain>/`), **Width 1920, Height 1080**.
3. Tick **"Shutdown source when not visible"** = OFF and **"Refresh browser when scene becomes active"** = OFF.
4. The background is transparent — it sits on top of your video.

Optional overlay tweaks via URL query:
`/?title=My%20Race` · `/?accent=%23ff3b4e` · `/?nologos=1`

### Two overlay scenes
- **`/`** — transparent data overlay (logos + stats) to composite over your camera/video.
- **`/map.html`** — full-screen **live map** background with the athlete's position moving on it, logos + stats on top. The travelled path draws live during the race, and the map follows the runner.
  - Map style: `/map.html` (default = **satellite**, client's choice) · `?map=street` (Google-Maps-like) · `?map=topo` (terrain/trails)
  - Zoom: `?zoom=15`
  - All map tiles are free (no API key). Real Google Maps can be swapped in later with an API key.

---

## 3. Heart rate (Suunto Vertical 2)

The watch broadcasts heart rate over Bluetooth **only while recording an activity**.

On the watch, before the race:
1. Settings → Connectivity → **Broadcast HR** → **On** (or enable "Broadcast heart rate").
2. Start an activity (e.g. *Trail running*) and **keep it recording for the whole race**.

On the phone (bought for the race):
1. Open **Chrome** and go to `https://<your-domain>/hr.html`.
2. Enter the **relay token** (the `HR_TOKEN` from `.env`) — or open the pre-filled link `…/hr.html?token=YOUR_TOKEN`.
3. Tap **Connect heart-rate sensor**, pick the Suunto (or chest strap) → heart rate starts streaming.
4. Leave the page open and in the foreground. It keeps the screen awake automatically.

**Phone checklist for 40h:** plugged into power bank, battery saver OFF, Do-Not-Disturb ON, auto-lock won't fight the wake lock. Chrome must stay in the foreground.

> **Backup sensor:** a BLE chest strap (e.g. Polar H10) works with the exact same page — if the watch misbehaves, connect the strap instead, nothing else changes.

---

## 4. Race day — timer & distance

- The timer auto-starts at `RACE_START_ISO` in `.env` (set to **22 Oct 2026, 06:00 Europe/Berlin**).
- Or press **▶ Start now** in the control panel the moment the gun goes off.
- Total distance defaults to **206.32 km**; adjust in the control panel if the race distance differs.
- Remaining distance = total − distance covered, where *covered* is computed from the tracker's GPS trail (noise-filtered). If it ever needs a manual nudge, use **Override covered** in the control panel.

**Make sure the PAJ tracker is powered on, outdoors, and reporting** (check the control panel — "PAJ connection: connected" and a GPS fix). The device reports every ~30 s.

---

## 5. Deployment (must be reachable over HTTPS)

Both the athlete's phone and the OBS PC reach the server over the internet, and Web Bluetooth requires HTTPS. Two options:

### A) Quick public URL for testing (fastest)
```bash
cloudflared tunnel --url http://localhost:3000
```
Gives a `https://<random>.trycloudflare.com` URL instantly (no account). Great for testing today; tied to this machine staying on.

### B) Stable host for the race (recommended)
Deploy to a small always-on host (VPS, Railway, Render, Fly.io). Steps for a plain VPS:
```bash
# on the server
git clone <repo> && cd race-overlay
npm install
cp .env .env            # set real values
# run under a process manager so it survives 40h
npx pm2 start server.js --name race-overlay
```
Put it behind Caddy/Nginx with TLS (Caddy auto-HTTPS is simplest). Then use `https://your-domain/` in OBS and on the phone.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Overlay shows `--` for HR | Phone page not connected, token wrong, or watch not recording/broadcasting. |
| HR tile greyed out | No HR received in the last 20 s (sensor dropped). The page auto-reconnects. |
| Remaining distance greyed | No GPS fix in the last 2.5 min — check the tracker is on and outdoors. |
| "PAJ connection: error" | Check PAJ login in `.env`; the token refreshes automatically. |
| Web Bluetooth button does nothing | Must be Chrome (Android/desktop) over **HTTPS** (or localhost). |
| Distance looks off | Use **Override covered** in the control panel to correct. |

---

## Files

```
server.js              Backend: PAJ polling, odometer, HR ingest, timer, WebSocket
lib/paj.js             PAJ FINDER Portal API client
lib/geo.js             Haversine + noise-filtered odometer
public/index.html      OBS overlay
public/hr.html         Web Bluetooth heart-rate relay (phone)
public/control.html    Control panel (timer, distance, test HR, live status)
public/preview.html    Overlay over a sample backdrop (for screenshots)
public/logos/          Sponsor logos (trimmed, transparent)
scripts/simulate.js    Demo driver (no hardware needed)
scripts/prep_logos.py  Logo trim + white-key tool
```
