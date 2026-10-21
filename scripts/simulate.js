// Demo driver: makes the overlay come alive WITHOUT the real hardware, so you can
// verify the look + behaviour before the watch/phone/tracker are connected.
//   node scripts/simulate.js
import "dotenv/config";

const BASE = process.env.SIM_BASE || `http://localhost:${process.env.PORT || 3000}`;
const HR_TOKEN = process.env.HR_TOKEN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const TOTAL = Number(process.env.ROUTE_TOTAL_KM || 206.32);

async function ctl(action, value) {
  await fetch(`${BASE}/api/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: ADMIN_TOKEN, action, value }),
  }).catch(() => {});
}
async function sendHr(bpm) {
  await fetch(`${BASE}/api/hr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: HR_TOKEN, bpm }),
  }).catch(() => {});
}

let hr = 135;
let covered = 0;
const paceKmh = 9; // simulated running pace

console.log(`Simulating race on ${BASE} … (Ctrl+C to stop)`);
await ctl("setTotalKm", TOTAL);
await ctl("startTimer");

setInterval(() => {
  // wander the heart rate naturally between ~120 and ~165
  hr += Math.round((Math.random() - 0.5) * 8);
  hr = Math.max(118, Math.min(168, hr));
  sendHr(hr);
}, 1000);

setInterval(() => {
  covered = Math.min(TOTAL, covered + paceKmh / 30); // advance every 2s
  ctl("setCoveredKm", covered.toFixed(3));
}, 2000);
