// Validate route-based distance against the REAL GPS history — no deploy.
import "dotenv/config";
import fs from "fs";
import { RouteMatcher } from "../lib/route.js";
import { getPointsSince } from "../lib/paj.js";
import { odometer } from "../lib/geo.js";

const cfg = {
  email: process.env.PAJ_EMAIL,
  password: process.env.PAJ_PASSWORD,
  deviceId: process.env.PAJ_DEVICE_ID,
};

const raw = JSON.parse(fs.readFileSync(new URL("../public/route.json", import.meta.url)));
const coords = raw.coordinates.map(([lng, lat]) => [lat, lng]); // [lng,lat] -> [lat,lng]
const m = new RouteMatcher(coords);
console.log("route length:", (m.totalM / 1000).toFixed(2), "km |", coords.length, "pts");

const start = Math.floor(Date.parse("2026-10-22T06:20:00+02:00") / 1000);
const { points } = await getPointsSince(cfg, start);
console.log("GPS points since 6:20:", points.length);
if (points.length) {
  const f = points[0], l = points[points.length - 1];
  console.log("first fix:", new Date(f.ts * 1000).toISOString(), f.lat.toFixed(4), f.lng.toFixed(4));
  console.log("last  fix:", new Date(l.ts * 1000).toISOString(), l.lat.toFixed(4), l.lng.toFixed(4));
  // show the biggest time gaps between consecutive points
  let gaps = [];
  for (let i = 1; i < points.length; i++) gaps.push(Math.round((points[i].ts - points[i - 1].ts) / 60));
  gaps.sort((a, b) => b - a);
  console.log("biggest gaps (min):", gaps.slice(0, 5));
}

for (const p of points) m.onPoint(p.lat, p.lng, p.ts);
console.log("");
console.log("ROUTE-BASED covered:", (m.progressM / 1000).toFixed(2), "km   <-- should be ~37");
console.log("ODOMETER    covered:", (odometer(points) / 1000).toFixed(2), "km   <-- the undercount");
console.log("route idx reached  :", m.idxHint, "/", coords.length - 1);
