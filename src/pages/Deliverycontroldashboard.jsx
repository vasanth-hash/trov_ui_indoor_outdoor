import { useState, useEffect, useRef, useCallback } from "react";

// ─── ROSBRIDGE CONFIG ──────────────────────────────────────────────────────────
const ROSBRIDGE_URL = "wss://trovcamera.edgeforce.in/ros/";

// ─── ROS TOPIC NAMES (from delivery_runner.py) ─────────────────────────────────
const TOPICS = {
  STATUS:           "/delivery/status",           // SUB  – JSON {state, route, map}
  AVAILABLE_ROUTES: "/delivery/available_routes", // SUB  – JSON {map, routes:[]}
  GO:               "/delivery/go",               // PUB  – std_msgs/String  (route name)
  UNLOADED:         "/delivery/unloaded",         // PUB  – std_msgs/Empty
  FULL_PATH:        "/delivery/full_path",        // SUB  – nav_msgs/Path
  REMAINING_PATH:   "/delivery/remaining_path",   // SUB  – nav_msgs/Path
  PIN32:            "gpio_pin32_control",          // SUB  – std_msgs/Bool
};

// ─── STATES ────────────────────────────────────────────────────────────────────
const STATES = { IDLE: "IDLE", OUTBOUND: "OUTBOUND", ARRIVED: "ARRIVED", DEPARTING: "DEPARTING", RETURNING: "RETURNING" };

const STATE_META = {
  IDLE:      { color: "#6b7280", glow: "rgba(107,114,128,0.4)",  label: "IDLE",      icon: "◎" },
  OUTBOUND:  { color: "#10b981", glow: "rgba(16,185,129,0.5)",   label: "OUTBOUND",  icon: "→" },
  ARRIVED:   { color: "#ef4444", glow: "rgba(239,68,68,0.6)",    label: "ARRIVED",   icon: "⊕" },
  DEPARTING: { color: "#f59e0b", glow: "rgba(245,158,11,0.5)",   label: "DEPARTING", icon: "↑" },
  RETURNING: { color: "#38bdf8", glow: "rgba(56,189,248,0.5)",   label: "RETURNING", icon: "←" },
};

// ─── ROSBridge HOOK ─────────────────────────────────────────────────────────────
function useROSBridge(url) {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const listeners = useRef({});
  const reconnectTimer = useRef(null);
  const idCounter = useRef(1);

  const connect = useCallback(() => {
    try {
      const socket = new WebSocket(url);
      ws.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setConnectionError(null);
        // Re-subscribe all existing listeners
        Object.entries(listeners.current).forEach(([topic, { type }]) => {
          socket.send(JSON.stringify({ op: "subscribe", topic, type }));
        });
      };

      socket.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      socket.onerror = (e) => {
        setConnectionError("WebSocket error — retrying...");
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.op === "publish" && listeners.current[msg.topic]) {
            listeners.current[msg.topic].callbacks.forEach(cb => cb(msg.msg));
          }
        } catch {}
      };
    } catch (e) {
      setConnectionError(String(e));
      reconnectTimer.current = setTimeout(connect, 3000);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((topic, type, callback) => {
    if (!listeners.current[topic]) {
      listeners.current[topic] = { type, callbacks: [] };
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ op: "subscribe", topic, type }));
      }
    }
    listeners.current[topic].callbacks.push(callback);
    return () => {
      if (listeners.current[topic]) {
        listeners.current[topic].callbacks = listeners.current[topic].callbacks.filter(cb => cb !== callback);
      }
    };
  }, []);

  const publish = useCallback((topic, type, msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ op: "publish", topic, type, msg }));
      return true;
    }
    return false;
  }, []);

  return { connected, connectionError, subscribe, publish };
}

// ─── STYLES ─────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #070b0f;
    --surface:  #0d1117;
    --border:   rgba(255,255,255,0.07);
    --accent:   #ef4444;
    --text:     #e2e8f0;
    --muted:    #475569;
    --font:     'Rajdhani', sans-serif;
    --mono:     'Share Tech Mono', monospace;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--font); }

  .dash { min-height: 100dvh; display: flex; flex-direction: column; background: var(--bg); overflow-x: hidden; }

  /* ── grid bg ── */
  .grid-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(rgba(239,68,68,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(239,68,68,0.04) 1px, transparent 1px);
    background-size: 48px 48px;
    animation: gridMove 6s linear infinite;
  }
  @keyframes gridMove { from{background-position:0 0} to{background-position:0 48px} }

  .vignette {
    position: fixed; inset: 0; pointer-events: none; z-index: 1;
    background: radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(0,0,0,0.75) 100%);
  }

  /* ── scanlines ── */
  .scanlines {
    position: fixed; inset: 0; pointer-events: none; z-index: 50;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 3px);
  }

  /* ── header ── */
  .header {
    position: sticky; top: 0; z-index: 20;
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    background: rgba(7,11,15,0.85);
    backdrop-filter: blur(12px);
  }
  .header-brand { display: flex; align-items: center; gap: 12px; }
  .brand-bar { width: 3px; height: 32px; background: var(--accent); }
  .brand-title { font-size: 18px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; line-height: 1; }
  .brand-sub { font-size: 9px; letter-spacing: 0.3em; color: var(--muted); text-transform: uppercase; margin-top: 3px; font-family: var(--mono); }
  .header-right { display: flex; align-items: center; gap: 20px; }
  .mission-time { text-align: right; }
  .time-label { font-size: 9px; letter-spacing: 0.2em; color: var(--muted); text-transform: uppercase; font-family: var(--mono); }
  .time-value { font-size: 16px; font-family: var(--mono); color: var(--accent); font-weight: 700; tabular-nums; }
  .conn-badge { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 4px; border: 1px solid; font-size: 9px; letter-spacing: 0.2em; font-family: var(--mono); text-transform: uppercase; transition: all 0.3s; }
  .conn-badge.online  { border-color: rgba(16,185,129,0.4); color: #10b981; background: rgba(16,185,129,0.06); }
  .conn-badge.offline { border-color: rgba(239,68,68,0.4);  color: #ef4444; background: rgba(239,68,68,0.06); }
  .conn-dot { width: 6px; height: 6px; border-radius: 50%; }
  .conn-badge.online  .conn-dot { background: #10b981; animation: pulse 2s infinite; }
  .conn-badge.offline .conn-dot { background: #ef4444; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

  /* ── main ── */
  .main { position: relative; z-index: 2; flex: 1; padding: 20px 16px; display: flex; flex-direction: column; gap: 16px; max-width: 1200px; margin: 0 auto; width: 100%; }

  /* ── card ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    position: relative;
    overflow: hidden;
  }
  .card::before { content:''; position:absolute; top:0; left:0; width:20px; height:20px; border-top: 2px solid rgba(239,68,68,0.5); border-left: 2px solid rgba(239,68,68,0.5); }
  .card::after  { content:''; position:absolute; bottom:0; right:0; width:20px; height:20px; border-bottom: 2px solid rgba(239,68,68,0.5); border-right: 2px solid rgba(239,68,68,0.5); }
  .card-label { font-size: 9px; letter-spacing: 0.25em; color: var(--muted); text-transform: uppercase; font-family: var(--mono); margin-bottom: 14px; }

  /* ── grid layout ── */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  @media (max-width: 700px) {
    .grid-2 { grid-template-columns: 1fr; }
    .grid-3 { grid-template-columns: repeat(2, 1fr); }
    .grid-4 { grid-template-columns: repeat(2, 1fr); }
    .header { padding: 10px 14px; }
    .brand-title { font-size: 14px; }
    .main { padding: 12px 10px; gap: 12px; }
    .card { padding: 14px; }
  }
  @media (min-width: 900px) {
    .layout-wide { display: grid; grid-template-columns: 1fr 340px; gap: 16px; align-items: start; }
  }

  /* ── state badge ── */
  .state-badge { display: inline-flex; align-items: center; gap: 10px; }
  .state-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; transition: background 0.3s, box-shadow 0.3s; }
  .state-text { font-size: 26px; font-weight: 700; letter-spacing: 0.15em; transition: color 0.3s; }

  /* ── telemetry ── */
  .tele-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
  .tele-cell { display: flex; flex-direction: column; gap: 3px; }
  .tele-label { font-size: 9px; letter-spacing: 0.2em; color: var(--muted); text-transform: uppercase; font-family: var(--mono); }
  .tele-value { font-size: 20px; font-weight: 700; font-family: var(--mono); line-height: 1; }
  .tele-unit  { font-size: 11px; color: var(--muted); margin-left: 2px; }

  /* ── route selector ── */
  .route-select {
    width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.03);
    border: 1px solid var(--border); border-radius: 6px; color: var(--text);
    font-family: var(--font); font-size: 14px; font-weight: 600; letter-spacing: 0.05em;
    cursor: pointer; transition: border-color 0.2s, background 0.2s; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23475569' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 12px center;
    padding-right: 32px;
  }
  .route-select:focus { outline: none; border-color: rgba(239,68,68,0.4); background-color: rgba(239,68,68,0.03); }
  .route-select option { background: #0d1117; }

  /* ── buttons ── */
  .btn {
    position: relative; display: flex; align-items: center; justify-content: center;
    gap: 8px; width: 100%; padding: 14px 20px; border-radius: 6px;
    font-family: var(--font); font-size: 13px; font-weight: 700; letter-spacing: 0.15em;
    text-transform: uppercase; border: 1px solid; cursor: pointer;
    transition: all 0.2s; outline: none;
  }
  .btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none !important; }
  .btn-red   { border-color: rgba(239,68,68,0.5); color: #fff; background: rgba(239,68,68,0.08); }
  .btn-red:not(:disabled):hover   { background: rgba(239,68,68,0.18); border-color: rgba(239,68,68,0.8); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(239,68,68,0.2); }
  .btn-green { border-color: rgba(16,185,129,0.5); color: #fff; background: rgba(16,185,129,0.08); }
  .btn-green:not(:disabled):hover { background: rgba(16,185,129,0.18); border-color: rgba(16,185,129,0.8); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(16,185,129,0.2); }
  .btn-pulse { width: 6px; height: 6px; border-radius: 50%; position: absolute; right: 14px; }
  .btn-red   .btn-pulse { background: var(--accent); animation: pulse 1.2s infinite; }
  .btn-green .btn-pulse { background: #10b981; animation: pulse 1.2s infinite; }

  /* ── rover track ── */
  .track-wrap { position: relative; height: 72px; display: flex; align-items: center; padding: 0 28px; }
  .track-line { position: absolute; left: 28px; right: 28px; height: 1px; background: rgba(255,255,255,0.08); }
  .track-progress { position: absolute; left: 28px; height: 1px; background: var(--accent); transition: width 0.5s ease; opacity: 0.5; }
  .track-node { position: absolute; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .track-node-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid; background: var(--bg); transition: all 0.3s; }
  .track-node-label { font-size: 9px; font-family: var(--mono); letter-spacing: 0.15em; color: var(--muted); }
  .rover-icon {
    position: absolute; top: 50%; transform: translateX(-50%) translateY(-50%);
    transition: left 0.5s ease; z-index: 5;
  }
  .rover-body { width: 28px; height: 18px; border-radius: 3px 3px 2px 2px; position: relative; transition: background 0.3s, box-shadow 0.3s; }
  .rover-wheels { display: flex; justify-content: space-between; padding: 0 2px; margin-top: -2px; }
  .rover-wheel { width: 7px; height: 7px; border-radius: 50%; background: #374151; border: 1px solid #4b5563; }

  /* ── path waypoints ── */
  .waypoints-list { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
  .waypoint-item { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 4px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .waypoint-idx { color: var(--accent); font-size: 9px; width: 20px; }

  /* ── gpio status ── */
  .gpio-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 6px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); }
  .gpio-name { font-family: var(--mono); font-size: 11px; color: var(--muted); letter-spacing: 0.1em; }
  .gpio-led { width: 10px; height: 10px; border-radius: 50%; transition: all 0.2s; }
  .gpio-led.on  { background: #facc15; box-shadow: 0 0 10px 3px rgba(250,204,21,0.6); animation: pulse 0.4s step-end infinite; }
  .gpio-led.off { background: #1f2937; box-shadow: none; }

  /* ── log ── */
  .log-wrap { background: rgba(0,0,0,0.4); border-radius: 6px; padding: 10px; font-family: var(--mono); font-size: 11px; color: #64748b; max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
  .log-entry { display: flex; gap: 8px; }
  .log-ts { color: #334155; flex-shrink: 0; }
  .log-msg { color: #94a3b8; }
  .log-msg.info  { color: #94a3b8; }
  .log-msg.warn  { color: #f59e0b; }
  .log-msg.error { color: #ef4444; }
  .log-msg.ok    { color: #10b981; }

  /* ── arrival banner ── */
  .arrival-banner {
    border: 1px solid rgba(239,68,68,0.4); background: rgba(239,68,68,0.05);
    border-radius: 8px; padding: 14px 20px; display: flex; align-items: center; gap: 14px;
    animation: bannerPulse 1s ease-in-out infinite alternate;
  }
  @keyframes bannerPulse { from{box-shadow:0 0 0 rgba(239,68,68,0)} to{box-shadow:0 0 20px rgba(239,68,68,0.15)} }
  .banner-icon { font-size: 24px; flex-shrink: 0; }
  .banner-title { font-size: 13px; font-weight: 700; letter-spacing: 0.15em; color: #ef4444; text-transform: uppercase; }
  .banner-sub { font-size: 10px; color: var(--muted); margin-top: 3px; letter-spacing: 0.1em; }
  .banner-bars { display: flex; gap: 3px; margin-left: auto; align-items: flex-end; }
  .banner-bar { width: 4px; border-radius: 2px; background: rgba(239,68,68,0.6); }

  /* ── map info ── */
  .map-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); font-family: var(--mono); font-size: 10px; color: #ef4444; letter-spacing: 0.1em; }

  /* ── footer ── */
  .footer { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; border-top: 1px solid var(--border); background: rgba(7,11,15,0.9); backdrop-filter: blur(8px); font-family: var(--mono); font-size: 9px; color: var(--muted); letter-spacing: 0.15em; flex-wrap: wrap; gap: 8px; }

  /* ── scrollbar ── */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
`;

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function now() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

function useLog(maxEntries = 50) {
  const [entries, setEntries] = useState([]);
  const add = useCallback((msg, level = "info") => {
    setEntries(prev => [{ ts: now(), msg, level }, ...prev].slice(0, maxEntries));
  }, [maxEntries]);
  return [entries, add];
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DeliveryControlDashboard() {
  const { connected, subscribe, publish } = useROSBridge(ROSBRIDGE_URL);

  // State from /delivery/status
  const [state, setState]         = useState(STATES.IDLE);
  const [route, setRoute]         = useState("—");
  const [activeMap, setActiveMap] = useState("unknown");

  // Available routes from /delivery/available_routes
  const [availableRoutes, setAvailableRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute]     = useState("");

  // Path from /delivery/full_path + /delivery/remaining_path
  const [fullPath, setFullPath]       = useState([]);
  const [remainingPath, setRemainingPath] = useState([]);

  // GPIO pin32
  const [pin32, setPin32] = useState(false);

  // UI
  const [tripCount, setTripCount] = useState(0);
  const [missionTime, setMissionTime] = useState("00:00:00");
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const prevState = useRef(STATES.IDLE);

  const [log, addLog] = useLog();

  // Mission timer
  useEffect(() => {
    if (state !== STATES.IDLE) {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const e = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setMissionTime(`${String(Math.floor(e/3600)).padStart(2,"0")}:${String(Math.floor((e%3600)/60)).padStart(2,"0")}:${String(e%60).padStart(2,"0")}`);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      if (prevState.current !== STATES.IDLE) setTripCount(c => c + 1);
      startTimeRef.current = null;
      setMissionTime("00:00:00");
    }
    prevState.current = state;
    return () => clearInterval(timerRef.current);
  }, [state]);

  // Connection log
  useEffect(() => {
    if (connected) addLog("ROSBridge connected — " + ROSBRIDGE_URL, "ok");
    else addLog("ROSBridge disconnected — reconnecting...", "warn");
  }, [connected]);

  // Subscribe: /delivery/status
  useEffect(() => {
    return subscribe(TOPICS.STATUS, "std_msgs/String", (msg) => {
      try {
        const payload = JSON.parse(msg.data);
        setState(payload.state  || STATES.IDLE);
        setRoute(payload.route  || "—");
        setActiveMap(payload.map || "unknown");
        addLog(`Status → ${payload.state}  route:${payload.route}  map:${payload.map}`);
      } catch { addLog("Bad /delivery/status message", "error"); }
    });
  }, [subscribe]);

  // Subscribe: /delivery/available_routes
  useEffect(() => {
    return subscribe(TOPICS.AVAILABLE_ROUTES, "std_msgs/String", (msg) => {
      try {
        const payload = JSON.parse(msg.data);
        const routes = payload.routes || [];
        setAvailableRoutes(routes);
        if (routes.length && !selectedRoute) setSelectedRoute(routes[0]);
        addLog(`Routes for map "${payload.map}": [${routes.join(", ")}]`, "ok");
      } catch { addLog("Bad /delivery/available_routes message", "error"); }
    });
  }, [subscribe]);

  // Subscribe: /delivery/full_path
  useEffect(() => {
    return subscribe(TOPICS.FULL_PATH, "nav_msgs/Path", (msg) => {
      setFullPath(msg.poses || []);
    });
  }, [subscribe]);

  // Subscribe: /delivery/remaining_path
  useEffect(() => {
    return subscribe(TOPICS.REMAINING_PATH, "nav_msgs/Path", (msg) => {
      setRemainingPath(msg.poses || []);
    });
  }, [subscribe]);

  // Subscribe: gpio_pin32_control
  useEffect(() => {
    return subscribe(TOPICS.PIN32, "std_msgs/Bool", (msg) => {
      setPin32(!!msg.data);
      addLog(`Pin32 → ${msg.data ? "HIGH ▲" : "LOW ▼"}`, msg.data ? "warn" : "info");
    });
  }, [subscribe]);

  // Publish: /delivery/go
  const handleStartDelivery = () => {
    if (state !== STATES.IDLE) return;
    const r = selectedRoute || (availableRoutes[0] || "");
    if (!r) { addLog("No route selected", "error"); return; }
    const ok = publish(TOPICS.GO, "std_msgs/String", { data: r });
    addLog(ok ? `→ /delivery/go "${r}"` : "Publish failed — not connected", ok ? "ok" : "error");
  };

  // Publish: /delivery/unloaded
  const handleMarkUnloaded = () => {
    if (state !== STATES.ARRIVED) return;
    const ok = publish(TOPICS.UNLOADED, "std_msgs/Empty", {});
    addLog(ok ? "→ /delivery/unloaded sent" : "Publish failed — not connected", ok ? "ok" : "error");
  };

  const meta = STATE_META[state] || STATE_META.IDLE;
  const canStart  = state === STATES.IDLE;
  const canUnload = state === STATES.ARRIVED;
  const isMoving  = state === STATES.OUTBOUND || state === STATES.RETURNING;
  const isArrived = state === STATES.ARRIVED;

  // Rover position 0–100
  const roverPos = (state === STATES.OUTBOUND || state === STATES.ARRIVED || state === STATES.DEPARTING) ? 100 : 0;
  const progressPct = roverPos;

  const stateHint = {
    IDLE:      "Select a route and dispatch the rover.",
    OUTBOUND:  "Rover en route to destination…",
    ARRIVED:   "Rover has arrived — confirm cargo unloaded.",
    DEPARTING: "Preparing return — beacon active…",
    RETURNING: "Returning to base…",
  }[state];

  return (
    <>
      <style>{CSS}</style>
      <div className="grid-bg" />
      <div className="vignette" />
      <div className="scanlines" />

      <div className="dash">
        {/* ── Header ── */}
        <header className="header">
          <div className="header-brand">
            <div className="brand-bar" />
            <div>
              <div className="brand-title">Delivery Control</div>
              <div className="brand-sub">T-ROV Mission Interface · v2.4</div>
            </div>
          </div>

          <div className="header-right">
            {activeMap !== "unknown" && (
              <div className="map-chip">
                <span style={{opacity:0.6}}>MAP</span>
                {activeMap}
              </div>
            )}
            <div className="mission-time">
              <div className="time-label">Mission Time</div>
              <div className="time-value">{missionTime}</div>
            </div>
            <div className={`conn-badge ${connected ? "online" : "offline"}`}>
              <div className="conn-dot" />
              {connected ? "ONLINE" : "OFFLINE"}
            </div>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="main">

          {/* Arrival Banner */}
          {isArrived && (
            <div className="arrival-banner">
              <div className="banner-icon">🚚</div>
              <div>
                <div className="banner-title">Rover Reached Destination</div>
                <div className="banner-sub">Confirm cargo has been removed to begin return journey</div>
              </div>
              <div className="banner-bars">
                {[0,1,2,3].map(i => (
                  <div key={i} className="banner-bar" style={{
                    height: `${12 + i*6}px`,
                    animation: `bannerPulse ${0.6+i*0.15}s ease-in-out infinite alternate`
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* Wide layout on large screens */}
          <div className="layout-wide">
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>

              {/* Status Card */}
              <div className="card">
                <div className="card-label">System Status</div>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
                  <div>
                    <div className="state-badge">
                      <div className="state-dot" style={{
                        background: meta.color,
                        boxShadow: isMoving || isArrived ? `0 0 10px 3px ${meta.glow}` : "none",
                        animation: isMoving ? "pulse 1.5s infinite" : isArrived ? "pulse 0.8s infinite" : "none"
                      }} />
                      <span className="state-text" style={{color: meta.color}}>{meta.label}</span>
                    </div>
                    <div style={{marginTop:6,fontSize:11,fontFamily:"var(--mono)",color:"var(--muted)",letterSpacing:"0.1em"}}>
                      {stateHint}
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:9,letterSpacing:"0.2em",color:"var(--muted)",textTransform:"uppercase",fontFamily:"var(--mono)",marginBottom:4}}>Destination</div>
                    <div style={{fontSize:22,fontWeight:700,letterSpacing:"0.1em"}}>{route}</div>
                  </div>
                </div>

                <div className="tele-grid">
                  <div className="tele-cell">
                    <span className="tele-label">Trips Done</span>
                    <span className="tele-value" style={{color:"var(--accent)"}}>{tripCount}</span>
                  </div>
                  <div className="tele-cell">
                    <span className="tele-label">Waypoints</span>
                    <span className="tele-value">{fullPath.length}<span className="tele-unit">pts</span></span>
                  </div>
                  <div className="tele-cell">
                    <span className="tele-label">Remaining</span>
                    <span className="tele-value">{remainingPath.length}<span className="tele-unit">pts</span></span>
                  </div>
                  <div className="tele-cell">
                    <span className="tele-label">Active Map</span>
                    <span className="tele-value" style={{fontSize:13,letterSpacing:"0.04em"}}>{activeMap}</span>
                  </div>
                </div>
              </div>

              {/* Route Visualization */}
              <div className="card">
                <div className="card-label">Route Visualization</div>

                <div className="track-wrap">
                  <div className="track-line" />
                  <div className="track-progress" style={{
                    width: `calc(${progressPct}% * (100% - 56px) / 100)`,
                    transition: "width 0.5s ease"
                  }} />

                  {/* Ticks */}
                  {[0,25,50,75,100].map(t => (
                    <div key={t} style={{
                      position:"absolute", top:"50%", transform:"translateY(-50%)",
                      left:`calc(28px + ${t}% * (100% - 56px) / 100)`,
                      width:1, height:8, background:"rgba(255,255,255,0.15)"
                    }} />
                  ))}

                  {/* Node A */}
                  <div className="track-node" style={{left:14}}>
                    <div className="track-node-dot" style={{borderColor:"#475569"}} />
                    <div className="track-node-label">BASE</div>
                  </div>

                  {/* Node B */}
                  <div className="track-node" style={{right:14}}>
                    <div className="track-node-dot" style={{
                      borderColor: isArrived ? "#ef4444" : "#475569",
                      boxShadow: isArrived ? "0 0 10px rgba(239,68,68,0.6)" : "none"
                    }} />
                    <div className="track-node-label" style={{color: isArrived ? "#ef4444" : undefined}}>{route !== "—" ? route.toUpperCase() : "DEST"}</div>
                  </div>

                  {/* Rover */}
                  <div className="rover-icon" style={{
                    left: `calc(28px + ${roverPos}% * (100% - 56px) / 100)`,
                    transition: "left 0.5s ease"
                  }}>
                    <div className="rover-body" style={{
                      background: state === STATES.IDLE ? "#374151" : "#ef4444",
                      boxShadow: state !== STATES.IDLE ? `0 0 10px rgba(239,68,68,0.5)` : "none"
                    }}>
                      <div style={{position:"absolute",top:-6,left:"50%",transform:"translateX(-50%)",width:1,height:6,background:"#9ca3af"}} />
                      <div style={{position:"absolute",top:-8,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:"#ef4444"}} />
                      <div style={{position:"absolute",top:5,left:"50%",transform:"translateX(-50%)",width:6,height:4,borderRadius:2,background:"rgba(0,0,0,0.5)"}} />
                    </div>
                    <div className="rover-wheels">
                      <div className="rover-wheel" />
                      <div className="rover-wheel" />
                    </div>
                    {/* motion trail */}
                    {isMoving && (
                      <div style={{
                        position:"absolute",top:"40%",transform:"translateY(-50%)",height:1,
                        background:"linear-gradient(to left, rgba(239,68,68,0.4), transparent)",
                        right:state===STATES.RETURNING?"auto":"100%",
                        left:state===STATES.RETURNING?"100%":"auto",
                        width:36
                      }} />
                    )}
                  </div>
                </div>

                {/* Waypoints from nav_msgs/Path */}
                {fullPath.length > 0 && (
                  <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)"}}>
                    <div style={{fontSize:9,letterSpacing:"0.2em",color:"var(--muted)",textTransform:"uppercase",fontFamily:"var(--mono)",marginBottom:8}}>
                      Full Path — {fullPath.length} poses
                    </div>
                    <div className="waypoints-list">
                      {fullPath.slice(0,20).map((p, i) => (
                        <div className="waypoint-item" key={i}>
                          <span className="waypoint-idx">#{i+1}</span>
                          <span>x: {p.pose?.position?.x?.toFixed(3) ?? "—"}</span>
                          <span style={{marginLeft:8}}>y: {p.pose?.position?.y?.toFixed(3) ?? "—"}</span>
                        </div>
                      ))}
                      {fullPath.length > 20 && <div className="waypoint-item" style={{justifyContent:"center"}}>+ {fullPath.length-20} more…</div>}
                    </div>
                  </div>
                )}
              </div>

              {/* Event Log */}
              <div className="card">
                <div className="card-label">Event Log</div>
                <div className="log-wrap">
                  {log.length === 0 && <div className="log-entry"><span className="log-msg">Waiting for messages…</span></div>}
                  {log.map((e, i) => (
                    <div className="log-entry" key={i}>
                      <span className="log-ts">{e.ts}</span>
                      <span className={`log-msg ${e.level}`}>{e.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Right Panel ── */}
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>

              {/* Command Interface */}
              <div className="card">
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                  <div className="card-label" style={{marginBottom:0}}>Command Interface</div>
                  {/* GPIO 32 flood indicator */}
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                    <div className={`gpio-led ${pin32 ? "on" : "off"}`} />
                    <span style={{fontSize:8,fontFamily:"var(--mono)",color:"var(--muted)",letterSpacing:"0.1em"}}>PIN32</span>
                  </div>
                </div>

                {/* Route Selector */}
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:9,letterSpacing:"0.2em",color:"var(--muted)",textTransform:"uppercase",fontFamily:"var(--mono)",marginBottom:6}}>
                    Route
                  </div>
                  {availableRoutes.length > 0 ? (
                    <select
                      className="route-select"
                      value={selectedRoute}
                      onChange={e => setSelectedRoute(e.target.value)}
                      disabled={!canStart}
                    >
                      {availableRoutes.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid var(--border)",borderRadius:6,fontSize:12,color:"var(--muted)",fontFamily:"var(--mono)"}}>
                      {connected ? "Waiting for routes…" : "Not connected"}
                    </div>
                  )}
                </div>

                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <button className="btn btn-red" onClick={handleStartDelivery} disabled={!canStart || !connected}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 5-10 5V3z" fill="currentColor"/></svg>
                    Start Delivery
                    {canStart && connected && <div className="btn-pulse" />}
                  </button>

                  <button className="btn btn-green" onClick={handleMarkUnloaded} disabled={!canUnload || !connected}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    Mark as Unloaded
                    {canUnload && connected && <div className="btn-pulse" />}
                  </button>
                </div>

                <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid var(--border)",fontSize:9,letterSpacing:"0.15em",color:"var(--muted)",textTransform:"uppercase",fontFamily:"var(--mono)",textAlign:"center"}}>
                  {stateHint}
                </div>
              </div>

              {/* GPIO Status */}
              <div className="card">
                <div className="card-label">GPIO Status</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div className="gpio-row">
                    <div>
                      <div className="gpio-name">PIN 32 — Arrival Beacon</div>
                      <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>3× pulse on arrival</div>
                    </div>
                    <div className={`gpio-led ${pin32 ? "on" : "off"}`} />
                  </div>
                  <div className="gpio-row">
                    <div>
                      <div className="gpio-name">PIN 16 — Departure Beacon</div>
                      <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>HIGH for 10s on depart</div>
                    </div>
                    <div className={`gpio-led ${state === STATES.DEPARTING ? "on" : "off"}`} />
                  </div>
                </div>
              </div>

              {/* Topics Monitor */}
              <div className="card">
                <div className="card-label">Topics Monitor</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[
                    { name: TOPICS.STATUS,           dir:"SUB", active: connected },
                    { name: TOPICS.AVAILABLE_ROUTES, dir:"SUB", active: connected },
                    { name: TOPICS.FULL_PATH,         dir:"SUB", active: fullPath.length > 0 },
                    { name: TOPICS.REMAINING_PATH,    dir:"SUB", active: remainingPath.length > 0 },
                    { name: TOPICS.PIN32,             dir:"SUB", active: pin32 },
                    { name: TOPICS.GO,                dir:"PUB", active: state !== STATES.IDLE },
                    { name: TOPICS.UNLOADED,          dir:"PUB", active: false },
                  ].map(t => (
                    <div key={t.name} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid var(--border)"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:t.active?"#10b981":"#1f2937",flexShrink:0}} />
                      <span style={{fontFamily:"var(--mono)",fontSize:9,color:t.active?"#94a3b8":"#334155",flex:1,letterSpacing:"0.04em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</span>
                      <span style={{fontFamily:"var(--mono)",fontSize:8,color:t.dir==="PUB"?"#f59e0b":"#38bdf8",letterSpacing:"0.05em"}}>{t.dir}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </main>

        {/* ── Footer ── */}
        <footer className="footer">
          <span>T-ROV · Rover Unit #01</span>
          <span>{ROSBRIDGE_URL}</span>
          <span>{new Date().toISOString().slice(0,10)}</span>
          <span style={{color:connected?"#10b981":"#ef4444"}}>{connected ? "SYS OK" : "SYS ERR"}</span>
        </footer>
      </div>
    </>
  );
}