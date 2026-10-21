import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { getLastPoints, getPointsSince, getDevices } from "./lib/paj.js";
import { haversine, odometer } from "./lib/geo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------- config ----------------
const cfg = {
  email: process.env.PAJ_EMAIL,
  password: process.env.PAJ_PASSWORD,
  deviceId: process.env.PAJ_DEVICE_ID,
};
const POLL_MS = Number(process.env.PAJ_POLL_MS || 15000);
const PORT = Number(process.env.PORT || 3000);
const HR_TOKEN = process.env.HR_TOKEN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const HR_STALE_MS = 20_000; // heart rate considered stale after 20s
const GPS_STALE_MS = 150_000; // GPS considered stale after 2.5 min

// ---------------- live state ----------------
const state = {
  totalKm: Number(process.env.ROUTE_TOTAL_KM || 0),
  raceStartMs: process.env.RACE_START_ISO ? Date.parse(process.env.RACE_START_ISO) : null,
  timerRunning: false,

  hr: { bpm: null, ts: 0 },
  gps: { lat: null, lng: null, ts: 0, speedKmh: null, battery: null },

  odoM: 0, // cumulative metres travelled (our noise-filtered odometer)
  lastPointTs: 0, // unix seconds of the last GPS point folded into the odometer
  lastOdoPoint: null, // {lat,lng,ts} to continue the odometer across polls
  track: [], // race-time breadcrumb for the map [{lat,lng,ts}], capped

  pajOk: null, // null=unknown, true/false after first poll
  pajError: null,
  updatedMs: 0,
};

// Auto-start the timer once we pass the configured start time.
if (state.raceStartMs && Date.now() >= state.raceStartMs) state.timerRunning = true;

// ---------------- derived snapshot sent to clients ----------------
function snapshot() {
  const now = Date.now();
  const coveredKm = state.odoM / 1000;
  const remainingKm = Math.max(0, state.totalKm - coveredKm);
  const percent = state.totalKm > 0 ? Math.min(100, (coveredKm / state.totalKm) * 100) : 0;

  let elapsedSec = 0;
  if (state.raceStartMs) elapsedSec = Math.max(0, Math.floor((now - state.raceStartMs) / 1000));

  return {
    type: "state",
    serverMs: now,
    hr: {
      bpm: state.hr.bpm,
      ts: state.hr.ts,
      stale: !state.hr.ts || now - state.hr.ts > HR_STALE_MS,
    },
    gps: {
      lat: state.gps.lat,
      lng: state.gps.lng,
      speedKmh: state.gps.speedKmh,
      battery: state.gps.battery,
      ts: state.gps.ts,
      stale: !state.gps.ts || now - state.gps.ts > GPS_STALE_MS,
    },
    distance: {
      totalKm: round(state.totalKm, 2),
      coveredKm: round(coveredKm, 2),
      remainingKm: round(remainingKm, 2),
      percent: round(percent, 1),
    },
    timer: {
      startMs: state.raceStartMs,
      running: state.timerRunning,
      elapsedSec,
    },
    health: { pajOk: state.pajOk, pajError: state.pajError },
  };
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ---------------- odometer folding ----------------
// Fold any points newer than lastPointTs into the running odometer.
function foldPoints(points) {
  if (!points.length) return;

  // Always reflect the live position (for display + battery), regardless of
  // whether the race has started — so testing/transport shows up on the map.
  const latest = points[points.length - 1];
  state.gps = {
    lat: latest.lat,
    lng: latest.lng,
    ts: latest.ts * 1000,
    speedKmh: latest.speedKmh,
    battery: latest.battery,
  };

  // The odometer ONLY accumulates during the race — travel to the start line
  // and pre-race testing must not count toward covered distance.
  if (!state.timerRunning || !state.raceStartMs) return;
  const raceStartSec = Math.floor(state.raceStartMs / 1000);
  const fresh = points.filter((p) => p.ts > state.lastPointTs && p.ts >= raceStartSec);
  if (!fresh.length) return;

  // Prepend the last counted point so the first new segment is measured correctly.
  const seq = state.lastOdoPoint ? [state.lastOdoPoint, ...fresh] : fresh;
  state.odoM += odometer(seq);

  const last = fresh[fresh.length - 1];
  state.lastOdoPoint = { lat: last.lat, lng: last.lng, ts: last.ts };
  state.lastPointTs = last.ts;

  // Grow the map breadcrumb (race-time path only), capped.
  for (const p of fresh) state.track.push({ lat: p.lat, lng: p.lng, ts: p.ts });
  if (state.track.length > 6000) state.track = state.track.slice(-6000);
}

// Reset the odometer + breadcrumb so counting starts fresh from a given race start.
function resetOdometer(raceStartMs) {
  state.odoM = 0;
  state.lastOdoPoint = null;
  state.lastPointTs = raceStartMs ? Math.floor(raceStartMs / 1000) - 1 : 0;
  state.track = [];
}

// On startup, if the race already began, rebuild the odometer from history so a
// server restart mid-race doesn't lose the covered distance.
async function backfill() {
  if (!state.raceStartMs || Date.now() < state.raceStartMs) return;
  try {
    const sinceUnix = Math.floor(state.raceStartMs / 1000);
    const { points } = await getPointsSince(cfg, sinceUnix);
    if (points.length) {
      state.odoM = odometer(points);
      const latest = points[points.length - 1];
      state.lastOdoPoint = { lat: latest.lat, lng: latest.lng, ts: latest.ts };
      state.lastPointTs = latest.ts;
      state.gps = {
        lat: latest.lat, lng: latest.lng, ts: latest.ts * 1000,
        speedKmh: latest.speedKmh, battery: latest.battery,
      };
      console.log(`[backfill] ${points.length} pts, odometer=${(state.odoM / 1000).toFixed(2)} km`);
    } else {
      console.log("[backfill] no history points yet");
    }
  } catch (e) {
    console.warn("[backfill] failed:", e.message);
  }
}

// ---------------- PAJ poll loop ----------------
async function poll() {
  try {
    const { points } = await getLastPoints(cfg, 25);
    foldPoints(points);
    state.pajOk = true;
    state.pajError = null;
  } catch (e) {
    state.pajOk = false;
    state.pajError = e.message;
    console.warn("[poll] PAJ error:", e.message);
  }
  state.updatedMs = Date.now();
  broadcast();
}

// ---------------- express + ws ----------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Heart rate ingest (from the Android relay app).
app.post("/api/hr", (req, res) => {
  const { bpm, token } = req.body || {};
  if (HR_TOKEN && token !== HR_TOKEN) return res.status(401).json({ error: "bad token" });
  const n = Number(bpm);
  if (!Number.isFinite(n) || n <= 0 || n > 260) return res.status(400).json({ error: "bad bpm" });
  state.hr = { bpm: Math.round(n), ts: Date.now() };
  broadcast();
  res.json({ ok: true });
});

app.get("/api/state", (_req, res) => res.json(snapshot()));

// Breadcrumb for the map: the race-time path travelled so far.
app.get("/api/track", (_req, res) => {
  res.json({
    points: state.track,
    current: state.gps.lat != null ? { lat: state.gps.lat, lng: state.gps.lng } : null,
  });
});

// Control panel actions (start/reset timer, adjust total distance, test HR).
app.post("/api/control", (req, res) => {
  const { token, action, value } = req.body || {};
  if (ADMIN_TOKEN && token !== ADMIN_TOKEN) return res.status(401).json({ error: "bad token" });
  switch (action) {
    case "startTimer":
      state.raceStartMs = Date.now();
      state.timerRunning = true;
      resetOdometer(state.raceStartMs);
      break;
    case "setStart":
      state.raceStartMs = Date.parse(value);
      state.timerRunning = state.raceStartMs ? Date.now() >= state.raceStartMs : false;
      resetOdometer(state.raceStartMs);
      break;
    case "resetTimer":
      state.raceStartMs = null;
      state.timerRunning = false;
      resetOdometer(null);
      break;
    case "setTotalKm":
      state.totalKm = Number(value) || state.totalKm;
      break;
    case "setCoveredKm": // manual correction if needed
      state.odoM = (Number(value) || 0) * 1000;
      break;
    case "testHr":
      state.hr = { bpm: Math.round(Number(value) || 0), ts: Date.now() };
      break;
    default:
      return res.status(400).json({ error: "unknown action" });
  }
  broadcast();
  res.json({ ok: true, state: snapshot() });
});

app.get("/healthz", (_req, res) => res.json({ ok: true, ...snapshot().health }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify(snapshot()));
});

function broadcast() {
  const msg = JSON.stringify(snapshot());
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ---------------- boot ----------------
async function main() {
  if (!cfg.email || !cfg.password || !cfg.deviceId) {
    console.error("Missing PAJ_EMAIL / PAJ_PASSWORD / PAJ_DEVICE_ID in .env");
  }
  try {
    const devices = await getDevices(cfg);
    const d = devices.find((x) => String(x.id) === String(cfg.deviceId)) || devices[0];
    if (d) console.log(`[paj] device OK: ${d.name} (id ${d.id}, interval ${d.intervalllaenge}s)`);
  } catch (e) {
    console.warn("[paj] device check failed:", e.message);
  }

  await backfill();
  await poll();
  setInterval(poll, POLL_MS);
  // Heartbeat so overlays refresh stale flags / timer even without new data.
  setInterval(broadcast, 2000);

  server.listen(PORT, () => {
    console.log(`\n  Overlay:        http://localhost:${PORT}/           (OBS Browser Source)`);
    console.log(`  Control panel:  http://localhost:${PORT}/control.html`);
    console.log(`  State JSON:     http://localhost:${PORT}/api/state\n`);
  });
}

main();
