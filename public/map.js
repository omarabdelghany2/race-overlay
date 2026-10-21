(() => {
  const q = new URLSearchParams(location.search);

  // ---- tile layers (all free, no API key) ----
  const LAYERS = {
    // Google-Maps-like street style
    street: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      opts: { maxZoom: 19, attribution: "© OpenStreetMap contributors" },
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      opts: { maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" },
    },
    // Topographic — shows terrain + trails, ideal for a mountain ultra
    topo: {
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      opts: { subdomains: "abc", maxZoom: 17, attribution: "© OpenTopoMap (CC-BY-SA), © OpenStreetMap" },
    },
  };
  const chosen = LAYERS[q.get("map")] || LAYERS.satellite; // client prefers satellite
  const followZoom = Number(q.get("zoom")) || 14;
  const DEFAULT_CENTER = [47.8072, 7.5631]; // Neuenburg am Rhein (race start)

  const map = L.map("map", {
    zoomControl: false, attributionControl: true, preferCanvas: true,
  }).setView(DEFAULT_CENTER, followZoom);
  L.tileLayer(chosen.url, chosen.opts).addTo(map);

  // place/road labels on top of satellite so towns stay readable
  if (chosen === LAYERS.satellite) {
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, pane: "overlayPane" }).addTo(map);
  }

  let followedOnce = false;
  let routeBounds = null;
  let lastTs = 0;

  // ---- planned race route (official GPX) ----
  const routeCasing = L.polyline([], { color: "#000", weight: 8, opacity: 0.35, lineJoin: "round" });
  const routeLine = L.polyline([], { color: "#ff3b4e", weight: 4, opacity: 0.9, lineJoin: "round" });
  fetch("route.json").then((r) => r.json()).then((d) => {
    const ll = (d.coordinates || []).map((p) => [p[1], p[0]]); // [lng,lat] -> [lat,lng]
    if (!ll.length) return;
    routeCasing.setLatLngs(ll).addTo(map);
    routeLine.setLatLngs(ll).addTo(map);
    routeBounds = routeLine.getBounds();
    const startIcon = L.divIcon({ className: "", iconSize: [104, 42], iconAnchor: [52, 42],
      html: '<div class="start-flag">START / END</div>' });
    L.marker(ll[0], { icon: startIcon, interactive: false }).addTo(map);
    if (!followedOnce) map.fitBounds(routeBounds, { padding: [80, 80] }); // course overview until first live fix
  }).catch(() => {});

  // ---- breadcrumb of the travelled path ----
  const trail = L.polyline([], { color: "#feb60e", weight: 5, opacity: 0.95, lineJoin: "round" }).addTo(map);
  const trailEdge = L.polyline([], { color: "#000", weight: 8, opacity: 0.25, lineJoin: "round" }).addTo(map);
  trailEdge.bringToBack();

  // ---- live position marker ----
  const icon = L.divIcon({
    className: "", iconSize: [22, 22], iconAnchor: [11, 11],
    html: '<div class="runner-pulse"></div><div class="runner-dot"></div>',
  });
  let marker = null;

  function setMarker(lat, lng) {
    const ll = [lat, lng];
    if (!marker) marker = L.marker(ll, { icon, interactive: false }).addTo(map);
    else marker.setLatLng(ll);
    // Always follow the live GPS position.
    if (!followedOnce) { map.setView(ll, followZoom); followedOnce = true; }
    else map.panTo(ll, { animate: true, duration: 1.0 });
  }

  function drawTrail(points) {
    const latlngs = points.map((p) => [p.lat, p.lng]);
    trail.setLatLngs(latlngs);
    trailEdge.setLatLngs(latlngs);
  }

  // Initial history (so a reload mid-race keeps the path).
  fetch("/api/track").then((r) => r.json()).then((d) => {
    if (d.points && d.points.length) {
      drawTrail(d.points);
      lastTs = d.points[d.points.length - 1].ts;
    }
    if (d.current) setMarker(d.current.lat, d.current.lng);
  }).catch(() => {});

  // ---- live updates via the same WebSocket the overlay uses ----
  let ws, backoff = 500;
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => (backoff = 500);
    ws.onmessage = (ev) => {
      let st; try { st = JSON.parse(ev.data); } catch { return; }
      if (st.type !== "state" || st.gps.lat == null) return;
      setMarker(st.gps.lat, st.gps.lng);
      // append to the trail when a genuinely new race point arrives
      if (st.timer.running && st.gps.ts && st.gps.ts / 1000 > lastTs) {
        lastTs = st.gps.ts / 1000;
        trail.addLatLng([st.gps.lat, st.gps.lng]);
        trailEdge.addLatLng([st.gps.lat, st.gps.lng]);
      }
    };
    ws.onclose = () => { setTimeout(connect, backoff); backoff = Math.min(8000, backoff * 1.7); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  connect();
})();
