// Route matcher: snap a live GPS point onto the known course and report how far
// along the route (metres) the athlete is. Far more accurate + stable than a raw
// GPS odometer because it uses the real route length, not GPS-dot distances.

import { haversine } from "./geo.js";

const DEG = Math.PI / 180;
const R = 6371000;

export class RouteMatcher {
  // coords: array of [lat, lng] in route order
  constructor(coords) {
    this.pts = coords.map(([lat, lng]) => ({ lat, lng }));
    this.cum = [0];
    this.segLen = [];
    for (let i = 1; i < this.pts.length; i++) {
      const d = haversine(this.pts[i - 1].lat, this.pts[i - 1].lng, this.pts[i].lat, this.pts[i].lng);
      this.segLen.push(d);
      this.cum.push(this.cum[i - 1] + d);
    }
    this.totalM = this.cum[this.cum.length - 1] || 0;
    this.reset();
  }

  reset() {
    this.progressM = 0;
    this.idxHint = 0;
    this.lastTs = 0;
    this.miss = 0;
  }

  // Closest point on segment a->b to p; returns {t in [0,1], dist metres}
  _project(p, a, b) {
    const cosLat = Math.cos(a.lat * DEG);
    const bx = (b.lng - a.lng) * DEG * cosLat * R;
    const by = (b.lat - a.lat) * DEG * R;
    const px = (p.lng - a.lng) * DEG * cosLat * R;
    const py = (p.lat - a.lat) * DEG * R;
    const len2 = bx * bx + by * by;
    let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - t * bx;
    const dy = py - t * by;
    return { t, dist: Math.hypot(dx, dy) };
  }

  _searchWindow(p, from, to) {
    let best = { dist: Infinity, arc: this.progressM, idx: this.idxHint };
    for (let i = from; i <= to; i++) {
      const pr = this._project(p, this.pts[i], this.pts[i + 1]);
      if (pr.dist < best.dist) best = { dist: pr.dist, arc: this.cum[i] + pr.t * this.segLen[i], idx: i };
    }
    return best;
  }

  // Fold in one GPS point (must be called in time order). Returns covered metres.
  // Forward-global search from current progress to the end of the route, so it
  // handles signal gaps and sparse sampling; off-route outliers are rejected.
  onPoint(lat, lng, ts) {
    const nSeg = this.segLen.length;
    if (!nSeg) return this.progressM;
    const OFF_ROUTE_M = 500;   // GPS this far from the course = outlier, skip
    const best = this._searchWindow({ lat, lng }, this.idxHint, nSeg - 1);

    // On-route and forward of our current progress -> advance (monotonic).
    if (best.dist <= OFF_ROUTE_M && best.arc >= this.progressM) {
      this.progressM = best.arc;
      this.idxHint = best.idx;
    }
    // off-route outliers or backward GPS noise: hold progress (monotonic)
    this.lastTs = ts;
    return this.progressM;
  }
}
