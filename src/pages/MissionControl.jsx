
import { useState, useEffect, useRef, useCallback } from "react";

// ─── ROSBRIDGE CONFIG ────────────────────────────────────────────────────────
const ROS_URL = "wss://trovcamera.edgeforce.in/ros/";

const TOPICS = {
  START:     "/delivery/start",
  STOP:      "/delivery/stop",
  STATUS:    "/delivery/status",
  ROUTES:    "/delivery/available_routes",
  FULL_PATH: "/delivery/full_path",
  ROSOUT:    "/rosout",
};

// ─── STATES ──────────────────────────────────────────────────────────────────
const S = {
  IDLE:      "IDLE",
  OUTBOUND:  "OUTBOUND",
  ARRIVED:   "ARRIVED",
  DEPARTING: "DEPARTING",
  RETURNING: "RETURNING",
};

// ─── ROS HOOK ─────────────────────────────────────────────────────────────────
function useROS() {
  const wsRef       = useRef(null);
  const subMap      = useRef({});
  const [connected, setConnected] = useState(false);
  const reconnTimer = useRef(null);

  const send = useCallback((obj) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(obj));
  }, []);


  const subscribeLatched = useCallback((topic, type, cb) => {
  if (!subMap.current[topic]) subMap.current[topic] = [];
  subMap.current[topic].push(cb);
  send({ op: "subscribe", topic, type, queue_length: 1, latch: true });
  return () => {
    subMap.current[topic] = (subMap.current[topic] || []).filter(f => f !== cb);
  };
}, [send]);

  const subscribe = useCallback((topic, type, cb) => {
    if (!subMap.current[topic]) subMap.current[topic] = [];
    subMap.current[topic].push(cb);
    send({ op: "subscribe", topic, type });
    return () => {
      subMap.current[topic] = (subMap.current[topic] || []).filter(f => f !== cb);
    };
  }, [send]);

  const publish = useCallback((topic, type, msg) => {
    send({ op: "publish", topic, msg, type });
  }, [send]);

  const connect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(ROS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      clearTimeout(reconnTimer.current);
      Object.keys(subMap.current).forEach(t => send({ op: "subscribe", topic: t }));
      console.info("[ROSBridge] Connected →", ROS_URL);
    };
    ws.onmessage = (e) => {
      try {
        const pkt = JSON.parse(e.data);
        if (pkt.op === "publish" && subMap.current[pkt.topic])
          subMap.current[pkt.topic].forEach(cb => cb(pkt.msg));
      } catch (_) {}
    };
    ws.onclose = () => {
      setConnected(false);
      console.warn("[ROSBridge] Disconnected — reconnecting in 3s…");
      reconnTimer.current = setTimeout(connect, 1000);
    };
    ws.onerror = (e) => console.error("[ROSBridge] Error", e);
  }, [send]);

  useEffect(() => {
    connect();
    return () => { clearTimeout(reconnTimer.current); wsRef.current?.close(); };
  }, []); // eslint-disable-line

  return { connected, subscribe, subscribeLatched,publish };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const stateColor = {
  [S.IDLE]:      "text-gray-400",
  [S.OUTBOUND]:  "text-emerald-400",
  [S.ARRIVED]:   "text-red-400",
  [S.DEPARTING]: "text-amber-400",
  [S.RETURNING]: "text-sky-400",
};
const stateDot = {
  [S.IDLE]:      "bg-gray-500",
  [S.OUTBOUND]:  "bg-emerald-400",
  [S.ARRIVED]:   "bg-red-500",
  [S.DEPARTING]: "bg-amber-400",
  [S.RETURNING]: "bg-sky-400",
};
const stateLabel = {
  [S.IDLE]:      "System ready — select a route and dispatch",
  [S.OUTBOUND]:  "Rover en route to destination…",
  [S.ARRIVED]:   "Arrived at destination — awaiting unload confirmation",
  [S.DEPARTING]: "Preparing return journey…",
  [S.RETURNING]: "Returning to base…",
};

const isMoving = (s) => s === S.OUTBOUND || s === S.RETURNING || s === S.DEPARTING;

// ─── STATUS STRIP ─────────────────────────────────────────────────────────────
const ConnPill = ({ connected }) => (
  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs tracking-widest uppercase
    ${connected
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : "border-red-500/40 bg-red-500/10 text-red-400"}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
    {connected ? "LINKED" : "OFFLINE"}
  </div>
);

const StatusStrip = ({ state, route, connected }) => {
  const moving = isMoving(state);
  return (
    <div className={`flex items-center gap-4 px-5 py-4 rounded-2xl border
      ${state === S.ARRIVED ? "border-red-500/50 bg-red-500/8" : "border-white/6 bg-white/[0.025]"}`}
      style={{
        backdropFilter: "blur(16px)",
        animation: state === S.ARRIVED ? "arrived-pulse 1.5s ease-in-out infinite alternate" : "none"
      }}>
      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${stateDot[state]}
        ${moving ? "animate-pulse" : state === S.ARRIVED ? "shadow-lg shadow-red-500/80" : ""}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-xl font-bold tracking-widest uppercase leading-none ${stateColor[state]}`}
            style={{ fontFamily: "'Teko', sans-serif" }}>{state}</p>
          {route && state !== S.IDLE && (
            <span className="text-[9px] bg-white/5 border border-white/8 px-2 py-0.5 rounded-full text-gray-500 tracking-widest uppercase"
              style={{ fontFamily: "'DM Mono', monospace" }}>{route}</span>
          )}
        </div>
        <p className="text-[10px] text-gray-500 tracking-wide mt-0.5"
          style={{ fontFamily: "'DM Mono', monospace" }}>{stateLabel[state]}</p>
      </div>
      <ConnPill connected={connected} />
    </div>
  );
};

// ─── ROUTE CARD ───────────────────────────────────────────────────────────────
const RouteCard = ({ name, selected, disabled, onSelect }) => (
  <button
    onClick={() => !disabled && onSelect(name)}
    disabled={disabled}
    className={`relative w-full text-left px-4 py-3 rounded-xl border transition-all duration-200
      ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
      ${selected
        ? "border-red-500 bg-red-500/15 shadow-lg shadow-red-500/20"
        : disabled ? "border-white/5 bg-white/[0.02]"
        : "border-white/8 bg-white/[0.03] hover:border-red-500/50 hover:bg-red-500/8 hover:scale-[1.01]"}`}
    style={{ fontFamily: "'Teko', sans-serif" }}
  >
    {selected && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-red-500 rounded-full" />}
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0
          ${selected ? "bg-red-500/20 text-red-400" : "bg-white/5 text-gray-500"}`}>
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
            <path d="M2 13L8 3L14 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
          </svg>
        </div>
        <div className="min-w-0">
          <p className={`text-base font-semibold tracking-wider uppercase leading-none truncate
            ${selected ? "text-white" : "text-gray-300"}`}>{name}</p>
          <p className="text-[9px] text-gray-600 tracking-widest mt-0.5 uppercase"
            style={{ fontFamily: "'DM Mono', monospace" }}>
            {selected ? "— active route —" : "tap to select"}
          </p>
        </div>
      </div>
      {selected && (
        <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 10 10" fill="none" className="w-3 h-3">
            <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      )}
    </div>
  </button>
);

// ─── ACTION BUTTONS ───────────────────────────────────────────────────────────
const ActionButtons = ({ selectedRoute, onStart, onStop }) => {
  // No mission-state lock: Start needs a selected route; Stop is always available.
  const canStart = !!selectedRoute;
  const canStop  = true;

  const base = "relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-2xl border font-bold tracking-widest uppercase transition-all duration-200 w-full py-8";

  return (
    <div className="grid grid-cols-2 gap-3 h-full">
      {/* START */}
      <button onClick={onStart} disabled={!canStart}
        className={`${base} ${canStart
          ? "border-emerald-500 bg-emerald-500/10 text-white hover:bg-emerald-500/20 hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-500/25 cursor-pointer active:scale-[0.98]"
          : "border-white/5 bg-white/[0.02] text-gray-700 cursor-not-allowed"}`}
        style={{ fontFamily: "'Teko', sans-serif" }}>
        {canStart && <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />}
        <svg viewBox="0 0 24 24" fill="none" className={`w-9 h-9 ${canStart ? "text-emerald-400" : "text-gray-700"}`}>
          <path d="M7 5v14l11-7L7 5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
        <span className="text-xl leading-none">Start</span>
        <span className="text-[9px] font-normal"
          style={{ fontFamily: "'DM Mono', monospace", color: canStart ? "#9ca3af" : "#374151" }}>
          {canStart ? `→ ${selectedRoute}` : "select route first"}
        </span>
        {canStart && <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      </button>

      {/* STOP */}
      <button onClick={onStop} disabled={!canStop}
        className={`${base} border-red-500 bg-red-500/10 text-white hover:bg-red-500/20 hover:scale-[1.02] hover:shadow-xl hover:shadow-red-500/25 cursor-pointer active:scale-[0.98]`}
        style={{ fontFamily: "'Teko', sans-serif" }}>
        <div className="absolute inset-0 bg-gradient-to-b from-red-500/5 to-transparent pointer-events-none" />
        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-red-400">
          <rect x="6" y="6" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
        <span className="text-xl leading-none">Stop</span>
        <span className="text-[9px] font-normal"
          style={{ fontFamily: "'DM Mono', monospace", color: "#9ca3af" }}>
          cancel &amp; halt
        </span>
      </button>
    </div>
  );
};

// ─── LOG ROW ──────────────────────────────────────────────────────────────────
const LogRow = ({ entry }) => {
  const levelColor = { INFO: "text-gray-400", WARN: "text-amber-400", ERROR: "text-red-400", DEBUG: "text-gray-600", FATAL: "text-red-300" };
  return (
    <div className="flex gap-2 text-[10px] leading-relaxed border-b border-white/[0.03] pb-1.5"
      style={{ fontFamily: "'DM Mono', monospace" }}>
      <span className="text-gray-700 flex-shrink-0">{entry.time}</span>
      {entry.level && (
        <span className={`flex-shrink-0 w-10 font-medium ${levelColor[entry.level] || "text-gray-500"}`}>
          {entry.level}
        </span>
      )}
      <span className="text-gray-400 break-all">{entry.msg}</span>
    </div>
  );
};

// ─── FULLSCREEN LOG MODAL ─────────────────────────────────────────────────────
const LogModal = ({ log, onClose, onClear }) => {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(10px)" }}>
      <div className="w-full max-w-3xl h-[82vh] rounded-2xl border border-white/10 overflow-hidden flex flex-col"
        style={{ background: "rgba(5,5,5,0.96)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <p className="text-lg font-semibold tracking-widest uppercase text-white"
              style={{ fontFamily: "'Teko', sans-serif" }}>Event Log — Full View</p>
            <p className="text-[9px] text-gray-600 tracking-widest mt-0.5"
              style={{ fontFamily: "'DM Mono', monospace" }}>{log.length} entries · all ROS + system events</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClear}
              className="text-[10px] tracking-widest text-gray-600 hover:text-red-400 uppercase transition-colors border border-white/8 px-3 py-1.5 rounded-lg"
              style={{ fontFamily: "'DM Mono', monospace" }}>Clear</button>
            <button onClick={onClose}
              className="w-8 h-8 rounded-lg border border-white/8 bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-all">
              <svg viewBox="0 0 14 14" fill="none" className="w-4 h-4">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div ref={ref} className="flex-1 overflow-y-auto p-5 flex flex-col gap-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}>
          {log.length === 0
            ? <p className="text-gray-700 text-[10px] tracking-widest uppercase m-auto">No events recorded</p>
            : [...log].reverse().map((e, i) => <LogRow key={i} entry={e} />)}
        </div>
      </div>
    </div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function TrovMissionControl() {
  const { connected, subscribe, subscribeLatched, publish } = useROS();

  const [state,         setState]         = useState(S.IDLE);
  const [routes,        setRoutes]        = useState([]);
  const [selected,      setSelected]      = useState(null);
  const [activeMap,     setActiveMap]     = useState(null);
  const [log,           setLog]           = useState([]);
  const [logOpen,       setLogOpen]       = useState(false);
  const [logFullscreen, setLogFullscreen] = useState(false);
  const logRef = useRef(null);

  const pushLog = useCallback((msg, level = "INFO") => {
    const time = new Date().toTimeString().slice(0, 8);
    setLog(prev => [...prev.slice(-150), { time, msg, level }]);
  }, []);

  useEffect(() => {
    if (logRef.current && logOpen) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, logOpen]);

  // ── ROS subscriptions ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [];    
    unsubs.push(subscribeLatched(TOPICS.STATUS, "std_msgs/String", (msg) => {
  const raw = msg.data || "";
  console.log("status raw", raw);
  pushLog(`Status → ${raw}`);

  try {
    const parsed = JSON.parse(raw);

    if (parsed.state)  setState(parsed.state);
    if (parsed.map)    setActiveMap(parsed.map);
    if (parsed.route !== undefined) setSelected(parsed.route);

  } catch (e) {
    // Fallback: old plain-string format
    const sm = raw.match(/^(\w+)/);
    const mm = raw.match(/map:(\S+)/);
    const rm = raw.match(/route:(\S+)/);
    if (sm) setState(sm[1]);
    if (mm) setActiveMap(mm[1]);
    if (rm) setSelected(rm[1]);
  }
}));
    
    unsubs.push(subscribeLatched(TOPICS.ROUTES, "std_msgs/String", (msg) => {
      const raw = msg.data || "";
      console.log("routes", raw)
      let list = [];
      try { list = JSON.parse(raw); }
      catch { list = raw.split(",").map(r => r.trim()).filter(Boolean); }
      setRoutes(list.routes);
      pushLog(`Routes available: [${list.join(", ")}]`);
    }));

    unsubs.push(subscribe(TOPICS.ROSOUT, "rcl_interfaces/msg/Log", (msg) => {
      const lm = { 10: "DEBUG", 20: "INFO", 30: "WARN", 40: "ERROR", 50: "FATAL" };
      const level = lm[msg.level] || "INFO";
      console[level === "ERROR" || level === "FATAL" ? "error" : level === "WARN" ? "warn" : "log"](
        `[ROS/${level}] [${msg.name}] ${msg.msg}`
      );
      pushLog(`[${msg.name}] ${msg.msg}`, level);
    }));
    return () => unsubs.forEach(u => u());
  }, [subscribe, pushLog]);

  useEffect(() => {
    pushLog(
      connected ? `ROSBridge connected — ${ROS_URL}` : `ROSBridge disconnected — reconnecting...`,
      connected ? "INFO" : "WARN"
    );
  }, [connected, pushLog]);

  const handleStart = () => {
    if (!selected) return;
    publish(TOPICS.START, "std_msgs/String", { data: selected });
    pushLog(`Start → /delivery/start  route: "${selected}"`);
  };
  const handleStop = () => {
    publish(TOPICS.STOP, "std_msgs/Empty", {});
    pushLog(`Stop → /delivery/stop`);
  };

  const moving = isMoving(state);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Teko:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');

        @keyframes arrived-pulse {
          from { box-shadow: 0 0 0px rgba(239,68,68,0); }
          to   { box-shadow: 0 0 24px rgba(239,68,68,0.18); }
        }
        @keyframes fadein {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes log-slide {
          from { opacity: 0; max-height: 0; }
          to   { opacity: 1; max-height: 400px; }
        }
        .fadein    { animation: fadein 0.4s ease forwards; }
        .log-slide { animation: log-slide 0.25s ease forwards; overflow: hidden; }
      `}</style>

      {/* ── Background ── */}
      {/* <div className="fixed inset-0 pointer-events-none">
        <img src="/trov.png" alt="" className="w-full h-full object-cover object-center"
          style={{ filter: "brightness(0.35) saturate(0.6)" }} />
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(135deg,rgba(10,0,0,0.82) 0%,rgba(80,10,10,0.55) 50%,rgba(10,0,0,0.90) 100%)" }} />
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 40%,transparent 30%,rgba(0,0,0,0.75) 100%)" }} />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,1) 2px,rgba(255,255,255,1) 3px)" }} />
      </div> */}

      {/* Fullscreen log */}
      {logFullscreen && (
        <LogModal log={log} onClose={() => setLogFullscreen(false)} onClear={() => setLog([])} />
      )}

      {/* ── Page ── */}
    
      <div className="relative z-0 min-h-screen  flex flex-col text-white"
        style={{ fontFamily: "'DM Mono', monospace" }}>
        
         <div className="absolute inset-0 pointer-events-none">
        <img src="/trov.png" alt="" className="w-full h-full object-cover object-center"
          style={{ filter: "brightness(0.35) saturate(0.6)" }} />
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(135deg,rgba(10,0,0,0.82) 0%,rgba(80,10,10,0.55) 50%,rgba(10,0,0,0.90) 100%)" }} />
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 40%,transparent 30%,rgba(0,0,0,0.75) 100%)" }} />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,1) 2px,rgba(255,255,255,1) 3px)" }} />
      </div>

        <main className="flex-1 flex items-start justify-center px-4 py-6">
          <div className="w-full max-w-4xl flex flex-col gap-4 fadein">

            {/* Status strip */}
            <StatusStrip state={state} route={selected} connected={connected} />

            {/* ── Two-column: Commands + Routes ── */}
            <div className="grid grid-cols-2 gap-4">

              {/* LEFT — Mission Commands */}
              <div className="rounded-2xl border border-white/6 flex flex-col"
                style={{ backdropFilter: "blur(16px)", background: "rgba(0,0,0,0.45)" }}>
                <div className="px-5 pt-5 pb-4 border-b border-white/5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-0.5 h-5 bg-red-500 rounded-full" />
                    <p className="text-lg font-semibold tracking-widest uppercase text-white"
                      style={{ fontFamily: "'Teko', sans-serif" }}>Mission Commands</p>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed tracking-wide">
                    Start a delivery mission on the selected route, or stop the rover at any time. Start and Stop stay available throughout the mission.
                  </p>
                </div>
                <div className="flex-1 p-4">
                  <ActionButtons
                    selectedRoute={selected}
                    onStart={handleStart}
                    onStop={handleStop}
                  />
                </div>
                {activeMap && (
                  <div className="px-5 py-3 border-t border-white/5 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                    <span className="text-[9px] tracking-widest text-gray-600 uppercase">
                      Active map — {activeMap}
                    </span>
                  </div>
                )}
              </div>

              {/* RIGHT — Route Selection */}
              <div className="rounded-2xl border border-white/6 flex flex-col"
                style={{ backdropFilter: "blur(16px)", background: "rgba(0,0,0,0.45)" }}>
                <div className="px-5 pt-5 pb-4 border-b border-white/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-0.5 h-5 bg-red-500 rounded-full" />
                      <p className="text-lg font-semibold tracking-widest uppercase text-white"
                        style={{ fontFamily: "'Teko', sans-serif" }}>Route Selection</p>
                    </div>
                    <span className="text-[9px] bg-white/5 border border-white/8 px-2 py-0.5 rounded-full text-gray-500 tabular-nums"
                      style={{ fontFamily: "'DM Mono', monospace" }}>
                      {routes.length} routes
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed tracking-wide">
                    Pre-mapped delivery paths loaded from the active ROS2 nav map. Select a route, then press Start.
                  </p>
                </div>

                {/* Route list */}
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2"
                  style={{ maxHeight: "260px", scrollbarWidth: "none" }}>
                  {routes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-8">
                      <div className="w-10 h-10 rounded-full border border-white/8 bg-white/5 flex items-center justify-center">
                        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-gray-600">
                          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M10 7v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <p className="text-[10px] text-gray-600 tracking-widest uppercase text-center">
                        {connected ? "Waiting for routes…" : "Connect to fetch routes"}
                      </p>
                    </div>
                  ) : (
                    routes.map(r => (
                      <RouteCard key={r} name={r} selected={selected === r} disabled={false} onSelect={setSelected} />
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ── Event Log (collapsible) ── */}
            <div className="rounded-2xl border border-white/6 overflow-hidden"
              style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.50)" }}>

            
              <div className="flex items-center justify-between px-5 py-3">
                <button onClick={() => setLogOpen(v => !v)} className="flex items-center gap-2.5 group">
                  <div className={`w-5 h-5 rounded-md border border-white/10 bg-white/5 flex items-center justify-center
                    transition-all group-hover:border-red-500/40 group-hover:bg-red-500/5`}>
                    <svg viewBox="0 0 10 10" fill="none"
                      className={`w-2.5 h-2.5 text-gray-400 transition-transform duration-200 ${logOpen ? "rotate-180" : ""}`}>
                      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <p className="text-[10px] tracking-[0.25em] text-gray-500 uppercase group-hover:text-gray-300 transition-colors">
                    Event Log
                  </p>
                  {log.length > 0 && (
                    <span className="text-[9px] bg-red-500/15 border border-red-500/20 text-red-400 px-2 py-0.5 rounded-full tabular-nums"
                      style={{ fontFamily: "'DM Mono', monospace" }}>{log.length}</span>
                  )}
                </button>

                <div className="flex items-center gap-2">
                 
                  <button onClick={() => { setLogFullscreen(true); setLogOpen(true); }}
                    title="Open fullscreen"
                    className="w-7 h-7 rounded-lg border border-white/8 bg-white/5 hover:bg-white/10 hover:border-white/15 flex items-center justify-center text-gray-500 hover:text-white transition-all">
                    <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5">
                      <path d="M1 5V2h3M10 2h3v3M13 9v3h-3M4 12H1V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {logOpen && (
                    <button onClick={() => setLog([])}
                      className="text-[9px] tracking-widest text-gray-700 hover:text-red-400 uppercase transition-colors"
                      style={{ fontFamily: "'DM Mono', monospace" }}>Clear</button>
                  )}
                </div>
              </div>

             
              {logOpen && (
                <div className="border-t border-white/5 log-slide">
                  <div ref={logRef}
                    className="h-48 overflow-y-auto p-4 flex flex-col gap-2"
                    style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}>
                    {log.length === 0
                      ? <p className="text-gray-700 text-[10px] tracking-widest uppercase m-auto">No events yet</p>
                      : [...log].reverse().map((e, i) => <LogRow key={i} entry={e} />)
                    }
                  </div>
                </div>
              )}
            </div>

          </div>
        </main>
      </div>
    </>
  );
}