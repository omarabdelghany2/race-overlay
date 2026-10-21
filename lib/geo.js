// Geo helpers: haversine distance + an odometer that tolerates GPS noise.

const R = 6371000; // earth radius, metres

export function haversine(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Build a cumulative distance (metres) from an ordered list of GPS points,
// filtering out jitter (tiny moves) and implausible teleports (GPS glitches).
// points: [{lat, lng, ts}] sorted ascending by ts.
export function odometer(points, opts = {}) {
  const minStepM = opts.minStepM ?? 4;        // ignore sub-4m jitter while "standing still"
  const maxSpeedKmh = opts.maxSpeedKmh ?? 35;  // drop steps faster than this (teleport/glitch)
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const c = points[i];
    if (
      p.lat == null || p.lng == null || c.lat == null || c.lng == null ||
      !Number.isFinite(p.lat) || !Number.isFinite(c.lat)
    ) continue;
    const d = haversine(p.lat, p.lng, c.lat, c.lng);
    const dt = Math.max(1, (c.ts - p.ts)); // seconds
    const impliedKmh = (d / dt) * 3.6;
    if (d < minStepM) continue;
    if (impliedKmh > maxSpeedKmh) continue;
    total += d;
  }
  return total;
}
