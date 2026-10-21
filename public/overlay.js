(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);

  // Optional customisation via query string:
  //   ?title=My%20Race   ?accent=%23ff0000   ?nologos=1
  if (q.get("title")) $("title").textContent = q.get("title");
  if (q.get("accent")) document.documentElement.style.setProperty("--accent", q.get("accent"));
  if (q.get("nologos") === "1") $("sponsors").style.display = "none";

  let clockOffset = 0; // serverMs - clientMs, to keep the timer in sync
  let timer = { startMs: null, running: false };

  function setStale(el, stale) {
    el.classList.toggle("stale", !!stale);
  }

  function fmtHMS(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return `${p(h)}:${p(m)}:${p(ss)}`;
  }

  function render(st) {
    clockOffset = st.serverMs - Date.now();

    // Heart rate
    const hrEl = $("hr");
    const heart = $("heart");
    if (st.hr.bpm && !st.hr.stale) {
      hrEl.textContent = st.hr.bpm;
      heart.classList.remove("stopped");
      // beat the heart at the real rate (clamped)
      const dur = Math.min(1.5, Math.max(0.35, 60 / st.hr.bpm));
      heart.style.animationDuration = dur + "s";
    } else {
      hrEl.textContent = "--";
      heart.classList.add("stopped");
    }
    setStale($("hr").parentElement, st.hr.stale || st.hr.bpm == null);

    // Distance
    const d = st.distance;
    $("remaining").textContent = d.remainingKm != null ? d.remainingKm.toFixed(1) : "--";
    $("total").textContent = `of ${d.totalKm != null ? d.totalKm.toFixed(0) : "--"} km`;
    $("percent").textContent = `${(d.percent ?? 0).toFixed(0)}%`;
    $("fill").style.width = `${d.percent ?? 0}%`;
    // Keep the distance readable even before the first GPS fix; the status dot
    // and control panel report GPS health instead of dimming the big number.
    $("covered").textContent = st.gps.stale && (d.coveredKm ?? 0) === 0
      ? "waiting for GPS…"
      : `${(d.coveredKm ?? 0).toFixed(1)} km`;

    // Timer (store; the local ticker renders it smoothly)
    timer = st.timer;
    tickTimer(); // update immediately so there's no 00:00:00 flash on new state

    // Status dot
    const dot = $("status");
    dot.className = "status";
    if (st.health.pajOk === false) dot.classList.add("bad");
    else if (st.gps.stale) dot.classList.add("warn");
    else dot.classList.add("ok");
  }

  function tickTimer() {
    if (!timer.startMs) {
      $("timer").textContent = "00:00:00";
      return;
    }
    const nowServer = Date.now() + clockOffset;
    $("timer").textContent = fmtHMS((nowServer - timer.startMs) / 1000);
  }
  setInterval(tickTimer, 200);

  // ---- WebSocket with auto-reconnect ----
  let ws = null;
  let backoff = 500;
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { backoff = 500; };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state") render(msg);
      } catch (_) {}
    };
    ws.onclose = () => {
      $("status").className = "status bad";
      setTimeout(connect, backoff);
      backoff = Math.min(8000, backoff * 1.7);
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }
  connect();
})();
