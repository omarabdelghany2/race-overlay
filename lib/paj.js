// Minimal PAJ GPS (FINDER Portal) API client.
// Docs: https://connect.paj-gps.de/api/documentation
// Auth: POST /login with {email,password} -> JWT; send as Bearer on every call.

const BASE = "https://connect.paj-gps.de/api/v1";

let token = null;
let tokenExpMs = 0;

export async function login(email, password) {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`PAJ login failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  token = data?.success?.token;
  if (!token) throw new Error("PAJ login: no token in response");
  const ttl = data?.success?.expires_in ? data.success.expires_in * 1000 : 3600_000;
  tokenExpMs = Date.now() + ttl - 120_000; // refresh 2 min early
  return token;
}

async function ensureToken(cfg) {
  if (!token || Date.now() > tokenExpMs) await login(cfg.email, cfg.password);
  return token;
}

async function authedGet(cfg, path) {
  await ensureToken(cfg);
  const url = `${BASE}${path}`;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 401) {
    await login(cfg.email, cfg.password);
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`PAJ GET ${path} -> ${res.status} ${txt.slice(0, 160)}`);
  }
  return res.json();
}

// Map a raw PAJ trackerdata row to a tidy point. Field names are defensive
// because PAJ returns German-ish keys that vary slightly by firmware.
function toPoint(r) {
  const lat = num(r.lat ?? r.latitude);
  const lng = num(r.lng ?? r.lon ?? r.longitude);
  const ts = num(r.dateunix ?? r.timestamp ?? r.unix_timestamp);
  if (lat == null || lng == null || ts == null) return null;
  return {
    lat,
    lng,
    ts,
    speedKmh: num(r.speed), // PAJ speed is km/h
    battery: num(r.battery),
    direction: num(r.direction),
  };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalize(data) {
  const rows = Array.isArray(data?.success) ? data.success : [];
  const pts = rows.map(toPoint).filter(Boolean);
  pts.sort((a, b) => a.ts - b.ts); // ascending by time
  return { points: pts, distanceM: num(data?.distance) ?? 0 };
}

export async function getDevices(cfg) {
  const data = await authedGet(cfg, `/device`);
  return Array.isArray(data?.success) ? data.success : [];
}

export async function getLastPoints(cfg, n = 20) {
  const data = await authedGet(
    cfg,
    `/trackerdata/${cfg.deviceId}/last_points?lastPoints=${n}&gps=1&wifi=0`
  );
  return normalize(data);
}

export async function getPointsSince(cfg, sinceUnix) {
  const now = Math.floor(Date.now() / 1000);
  const data = await authedGet(
    cfg,
    `/trackerdata/${cfg.deviceId}/date_range?dateStart=${sinceUnix}&dateEnd=${now}&gps=1&wifi=0`
  );
  return normalize(data);
}
