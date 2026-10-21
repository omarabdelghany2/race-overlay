(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);

  const tokenInput = $("token");
  tokenInput.value = q.get("token") || localStorage.getItem("hrToken") || "";
  tokenInput.addEventListener("input", () => localStorage.setItem("hrToken", tokenInput.value));

  function log(msg) {
    const el = $("log");
    el.innerHTML += `[${new Date().toLocaleTimeString()}] ${msg}<br>`;
    el.scrollTop = el.scrollHeight;
  }
  function pill(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = "pill" + (cls ? " " + cls : "");
  }

  if (!("bluetooth" in navigator)) {
    log("⚠ Web Bluetooth not available. Use Chrome (Android) or Bluefy (iPhone), over HTTPS.");
    pill("s_ble", "unsupported", "bad");
  }

  let device = null, charac = null;
  let lastPostMs = 0, lastBeatMs = 0;
  let reconnectTimer = null, manualDisconnect = false, wakeLock = null;

  // ---- keep the screen awake ----
  async function keepAwake() {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      pill("s_wake", "on", "ok");
      wakeLock.addEventListener("release", () => pill("s_wake", "released", "warn"));
    } catch (e) { pill("s_wake", "unavailable", "warn"); }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (!wakeLock || wakeLock.released)) keepAwake();
  });

  // ---- standard BLE Heart Rate Measurement (0x2A37) ----
  function parseHr(dv) {
    const flags = dv.getUint8(0);
    return (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
  }

  async function postHr(bpm) {
    const now = Date.now();
    if (now - lastPostMs < 900) return;      // ~1/sec
    lastPostMs = now;
    try {
      const r = await fetch("/api/hr", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bpm, token: tokenInput.value }),
      });
      if (r.ok) pill("s_net", "sending", "ok");
      else if (r.status === 401) { pill("s_net", "bad token", "bad"); log("server: bad token"); }
      else pill("s_net", "err " + r.status, "bad");
    } catch (e) { pill("s_net", "offline", "bad"); }
  }

  function onHr(ev) {
    const bpm = parseHr(ev.target.value);
    if (!bpm || bpm < 20 || bpm > 260) return;
    lastBeatMs = Date.now();
    $("bpm").textContent = bpm;
    $("heart").style.animationDuration = Math.min(1.5, Math.max(0.35, 60 / bpm)) + "s";
    postHr(bpm);
  }

  async function startNotifications(server) {
    const service = await server.getPrimaryService("heart_rate");
    charac = await service.getCharacteristic("heart_rate_measurement");
    await charac.startNotifications();
    charac.removeEventListener("characteristicvaluechanged", onHr);
    charac.addEventListener("characteristicvaluechanged", onHr);
    pill("s_ble", "streaming", "ok");
    lastBeatMs = Date.now();
    log("subscribed to heart-rate notifications");
  }

  async function connectGatt() {
    pill("s_ble", "connecting…", "warn");
    const server = await device.gatt.connect();
    await startNotifications(server);
  }

  async function connect(showAll) {
    try {
      manualDisconnect = false;
      log(showAll ? "scanning ALL devices…" : "requesting heart-rate device…");
      const opts = showAll
        ? { acceptAllDevices: true, optionalServices: ["heart_rate", "battery_service"] }
        : { filters: [{ services: ["heart_rate"] }], optionalServices: ["battery_service"] };
      device = await navigator.bluetooth.requestDevice(opts);
      pill("s_dev", device.name || "sensor", "ok");
      log("selected: " + (device.name || "(unnamed)"));
      device.removeEventListener("gattserverdisconnected", onDisconnected);
      device.addEventListener("gattserverdisconnected", onDisconnected);
      await connectGatt();
      await keepAwake();
      $("connect").style.display = "none";
      $("connectAll").style.display = "none";
      $("disconnect").style.display = "block";
    } catch (e) {
      pill("s_ble", "failed", "bad");
      log("connect error: " + e.message);
    }
  }

  // Persistent auto-reconnect — keeps retrying every few seconds until it's back.
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (manualDisconnect || !device) return;
    reconnectTimer = setTimeout(async () => {
      if (manualDisconnect || !device) return;
      try { log("reconnecting…"); await connectGatt(); log("reconnected ✓"); }
      catch (e) { log("reconnect failed, retrying…"); scheduleReconnect(); }
    }, 2500);
  }

  function onDisconnected() {
    pill("s_ble", "disconnected", "bad");
    pill("s_net", "—");
    log("sensor disconnected");
    scheduleReconnect();
  }

  // Watchdog: if we're "connected" but no heartbeats arrive for 12s, the
  // notification stream has silently stalled — force a reconnect.
  setInterval(() => {
    if (manualDisconnect || !device) return;
    if (device.gatt && device.gatt.connected && lastBeatMs && Date.now() - lastBeatMs > 12000) {
      log("no data for 12s — restarting connection");
      lastBeatMs = Date.now();
      try { device.gatt.disconnect(); } catch (_) {}   // triggers onDisconnected → reconnect
    }
  }, 4000);

  function disconnect() {
    manualDisconnect = true;
    clearTimeout(reconnectTimer);
    try { device && device.gatt.connected && device.gatt.disconnect(); } catch (_) {}
    if (wakeLock) { try { wakeLock.release(); } catch (_) {} }
    pill("s_dev", "not connected"); pill("s_ble", "—"); pill("s_net", "—"); pill("s_wake", "—");
    $("bpm").textContent = "--";
    $("connect").style.display = "block";
    $("connectAll").style.display = "block";
    $("disconnect").style.display = "none";
    log("manually disconnected");
  }

  $("connect").addEventListener("click", () => connect(false));
  $("connectAll").addEventListener("click", () => connect(true));
  $("disconnect").addEventListener("click", disconnect);
})();
