(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);

  // ---- token (from ?token= or saved) ----
  const tokenInput = $("token");
  tokenInput.value = q.get("token") || localStorage.getItem("hrToken") || "";
  tokenInput.addEventListener("input", () => localStorage.setItem("hrToken", tokenInput.value));

  function log(msg) {
    const el = $("log");
    const t = new Date().toLocaleTimeString();
    el.innerHTML += `[${t}] ${msg}<br>`;
    el.scrollTop = el.scrollHeight;
  }
  function pill(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = "pill" + (cls ? " " + cls : "");
  }

  if (!("bluetooth" in navigator)) {
    log("⚠ Web Bluetooth not available. Use Chrome on Android (or desktop Chrome) over HTTPS.");
    pill("s_ble", "unsupported", "bad");
  }

  let device = null;
  let charac = null;
  let lastPostMs = 0;
  let reconnectTimer = null;
  let manualDisconnect = false;
  let wakeLock = null;

  // ---- screen wake lock (keep phone awake for 40h) ----
  async function keepAwake() {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      pill("s_wake", "on", "ok");
      wakeLock.addEventListener("release", () => pill("s_wake", "released", "warn"));
    } catch (e) {
      pill("s_wake", "unavailable", "warn");
      log("wake lock: " + e.message);
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (!wakeLock || wakeLock.released)) keepAwake();
  });

  // ---- parse standard BLE Heart Rate Measurement (0x2A37) ----
  function parseHr(dataview) {
    const flags = dataview.getUint8(0);
    const is16 = flags & 0x01;
    return is16 ? dataview.getUint16(1, true) : dataview.getUint8(1);
  }

  async function postHr(bpm) {
    const now = Date.now();
    if (now - lastPostMs < 900) return; // throttle to ~1/sec
    lastPostMs = now;
    try {
      const r = await fetch("/api/hr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bpm, token: tokenInput.value }),
      });
      if (r.ok) pill("s_net", "sending", "ok");
      else if (r.status === 401) { pill("s_net", "bad token", "bad"); log("server: bad token"); }
      else pill("s_net", "err " + r.status, "bad");
    } catch (e) {
      pill("s_net", "offline", "bad");
    }
  }

  function onHr(ev) {
    const bpm = parseHr(ev.target.value);
    if (!bpm || bpm < 20 || bpm > 260) return;
    $("bpm").textContent = bpm;
    const dur = Math.min(1.5, Math.max(0.35, 60 / bpm));
    $("heart").style.animationDuration = dur + "s";
    postHr(bpm);
  }

  async function startNotifications(server) {
    const service = await server.getPrimaryService("heart_rate");
    charac = await service.getCharacteristic("heart_rate_measurement");
    await charac.startNotifications();
    charac.addEventListener("characteristicvaluechanged", onHr);
    pill("s_ble", "streaming", "ok");
    log("subscribed to heart-rate notifications");
  }

  async function connectGatt() {
    pill("s_ble", "connecting…", "warn");
    const server = await device.gatt.connect();
    await startNotifications(server);
  }

  async function connect() {
    try {
      manualDisconnect = false;
      log("requesting device…");
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
        optionalServices: ["battery_service"],
      });
      pill("s_dev", device.name || "sensor", "ok");
      log("selected: " + (device.name || "(unnamed)"));
      device.addEventListener("gattserverdisconnected", onDisconnected);
      await connectGatt();
      await keepAwake();
      $("connect").style.display = "none";
      $("disconnect").style.display = "block";
    } catch (e) {
      pill("s_ble", "failed", "bad");
      log("connect error: " + e.message);
    }
  }

  function onDisconnected() {
    pill("s_ble", "disconnected", "bad");
    pill("s_net", "—");
    log("sensor disconnected");
    if (manualDisconnect) return;
    // auto-reconnect loop
    let delay = 1500;
    const tryReconnect = async () => {
      if (manualDisconnect || !device) return;
      try {
        log("reconnecting…");
        await connectGatt();
        log("reconnected ✓");
      } catch (e) {
        log("reconnect failed, retrying…");
        delay = Math.min(15000, delay * 1.6);
        reconnectTimer = setTimeout(tryReconnect, delay);
      }
    };
    reconnectTimer = setTimeout(tryReconnect, delay);
  }

  function disconnect() {
    manualDisconnect = true;
    clearTimeout(reconnectTimer);
    try { device && device.gatt.connected && device.gatt.disconnect(); } catch (_) {}
    if (wakeLock) { try { wakeLock.release(); } catch (_) {} }
    pill("s_dev", "not connected");
    pill("s_ble", "—"); pill("s_net", "—"); pill("s_wake", "—");
    $("bpm").textContent = "--";
    $("connect").style.display = "block";
    $("disconnect").style.display = "none";
    log("manually disconnected");
  }

  $("connect").addEventListener("click", connect);
  $("disconnect").addEventListener("click", disconnect);
})();
