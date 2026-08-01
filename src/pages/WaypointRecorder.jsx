// import { useEffect, useRef, useState, useCallback } from 'react'

// // ── rosbridge WebSocket URL ──────────────────────────────────────────────────
// const ROSBRIDGE_URL = 'ws://187.77.184.19/ros/'

// // ── Topic names (mirror the Python node defaults) ────────────────────────────
// const TOPIC = {
//   STATUS:       'waypoint_recorder/status',
//   ROUTES:       'available_routes',
//   START:        'waypoint_recorder/start',
//   STOP:         'waypoint_recorder/stop',
//   SET_ROUTE:    'waypoint_recorder/set_route',
//   CLEAR_ROUTES: 'waypoint_recorder/clear_routes',
// }

// const C = {
//   red:   '#C8000A',
//   green: '#22c55e',
//   amber: '#f59e0b',
// }

// // ────────────────────────────────────────────────────────────────────────────
// // useRosBridge
// // ────────────────────────────────────────────────────────────────────────────
// function useRosBridge(url) {
//   const wsRef        = useRef(null)
//   const subMap       = useRef({})
//   const advMap       = useRef({})   // advertised topics: topic -> type
//   const [ready,      setReady]    = useState(false)
//   const [wsStatus,   setWsStatus] = useState('CONNECTING')
//   const reconnectRef = useRef(null)

//   const connect = useCallback(() => {
//     if (wsRef.current && wsRef.current.readyState <= 1) return
//     const ws = new WebSocket(url)
//     wsRef.current = ws
//     setWsStatus('CONNECTING')
//     ws.onopen = () => {
//       setReady(true); setWsStatus('CONNECTED')
//       Object.entries(subMap.current).forEach(([id, { topic, type }]) =>
//         ws.send(JSON.stringify({ op: 'subscribe', id, topic, type })))
//       // Re-advertise publish topics after reconnect
//       Object.entries(advMap.current).forEach(([topic, type]) =>
//         ws.send(JSON.stringify({ op: 'advertise', topic, type })))
//     }
//     ws.onclose = () => {
//       setReady(false); setWsStatus('DISCONNECTED')
//       reconnectRef.current = setTimeout(connect, 3000)
//     }
//     ws.onerror  = () => setWsStatus('ERROR')
//     ws.onmessage = (evt) => {
//       try {
//         const msg = JSON.parse(evt.data)
//         if (msg.op === 'publish')
//           Object.values(subMap.current)
//             .filter(s => s.topic === msg.topic)
//             .forEach(s => s.cb(msg.msg))
//       } catch {}
//     }
//   }, [url])

//   useEffect(() => {
//     connect()
//     return () => { clearTimeout(reconnectRef.current); wsRef.current?.close() }
//   }, [connect])

//   const subscribe = useCallback((topic, type, cb) => {
//     const id = `sub_${topic.replace(/\//g, '_')}_${Date.now()}`
//     subMap.current[id] = { topic, type, cb }
//     if (wsRef.current?.readyState === WebSocket.OPEN)
//       wsRef.current.send(JSON.stringify({ op: 'subscribe', id, topic, type }))
//     return () => {
//       delete subMap.current[id]
//       if (wsRef.current?.readyState === WebSocket.OPEN)
//         wsRef.current.send(JSON.stringify({ op: 'unsubscribe', id, topic }))
//     }
//   }, [])

//   // advertise — registers topic type with rosbridge before publishing
//   const advertise = useCallback((topic, type) => {
//     advMap.current[topic] = type
//     if (wsRef.current?.readyState === WebSocket.OPEN)
//       wsRef.current.send(JSON.stringify({ op: 'advertise', topic, type }))
//   }, [])

//   // publish — auto-advertises if not already done
//   const publish = useCallback((topic, type, msg) => {
//     const ws = wsRef.current
//     if (ws?.readyState !== WebSocket.OPEN) return
//     if (!advMap.current[topic]) {
//       ws.send(JSON.stringify({ op: 'advertise', topic, type }))
//       advMap.current[topic] = type
//     }
//     ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
//   }, [])

//   return { ready, wsStatus, subscribe, advertise, publish }
// }

// // ────────────────────────────────────────────────────────────────────────────
// // WaypointCanvas — live dot-trail of recorded waypoints
// // ────────────────────────────────────────────────────────────────────────────
// function WaypointCanvas({ waypoints, recording }) {
//   const canvasRef = useRef(null)

//   useEffect(() => {
//     const canvas = canvasRef.current
//     if (!canvas) return
//     const W = canvas.offsetWidth  || 600
//     const H = canvas.offsetHeight || 400
//     canvas.width  = W
//     canvas.height = H
//     const ctx = canvas.getContext('2d')

//     ctx.clearRect(0, 0, W, H)
//     ctx.fillStyle = '#080808'
//     ctx.fillRect(0, 0, W, H)

//     // grid
//     ctx.strokeStyle = 'rgba(255,255,255,0.04)'
//     ctx.lineWidth   = 1
//     for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
//     for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }

//     if (!waypoints?.length) {
//       ctx.fillStyle = 'rgba(232,232,232,0.15)'
//       ctx.font      = '11px monospace'
//       ctx.textAlign = 'center'
//       ctx.fillText('Drive the T-ROV to record waypoints', W / 2, H / 2 - 10)
//       ctx.fillStyle = 'rgba(232,232,232,0.07)'
//       ctx.font      = '9px monospace'
//       ctx.fillText('waypoints will appear here in real-time', W / 2, H / 2 + 10)
//       return
//     }

//     // compute bounds
//     const xs = waypoints.map(w => w.position.x)
//     const ys = waypoints.map(w => w.position.y)
//     const minX = Math.min(...xs), maxX = Math.max(...xs)
//     const minY = Math.min(...ys), maxY = Math.max(...ys)
//     const pad  = 60
//     const rangeX = maxX - minX || 1
//     const rangeY = maxY - minY || 1
//     const scale  = Math.min((W - pad*2) / rangeX, (H - pad*2) / rangeY)

//     const tx = wp => pad + (wp.position.x - minX) * scale
//     const ty = wp => H - pad - (wp.position.y - minY) * scale

//     // path line
//     ctx.beginPath()
//     waypoints.forEach((wp, i) => {
//       const px = tx(wp), py = ty(wp)
//       i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
//     })
//     ctx.strokeStyle = 'rgba(200,0,10,0.4)'
//     ctx.lineWidth   = 2
//     ctx.setLineDash([6, 4])
//     ctx.stroke()
//     ctx.setLineDash([])

//     // waypoint dots
//     waypoints.forEach((wp, i) => {
//       const px = tx(wp), py = ty(wp)
//       const isLast = i === waypoints.length - 1

//       // glow for last
//       if (isLast && recording) {
//         ctx.beginPath()
//         ctx.arc(px, py, 10, 0, Math.PI * 2)
//         ctx.fillStyle = 'rgba(200,0,10,0.12)'
//         ctx.fill()
//       }

//       ctx.beginPath()
//       ctx.arc(px, py, isLast ? 5 : 3.5, 0, Math.PI * 2)
//       ctx.fillStyle    = isLast ? C.red : 'rgba(200,0,10,0.6)'
//       ctx.fill()
//       ctx.strokeStyle  = isLast ? 'rgba(255,255,255,0.6)' : 'rgba(200,0,10,0.8)'
//       ctx.lineWidth    = 1.5
//       ctx.stroke()

//       // index label on every 5th or last
//       if (i % 5 === 0 || isLast) {
//         ctx.fillStyle = isLast ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'
//         ctx.font      = '8px monospace'
//         ctx.textAlign = 'left'
//         ctx.fillText(`#${wp.index}`, px + 7, py + 3)
//       }
//     })

//     // start marker
//     const s = waypoints[0]
//     ctx.beginPath()
//     ctx.arc(tx(s), ty(s), 5, 0, Math.PI * 2)
//     ctx.fillStyle   = 'rgba(34,197,94,0.8)'
//     ctx.fill()
//     ctx.strokeStyle = '#22c55e'
//     ctx.lineWidth   = 1.5
//     ctx.stroke()

//   }, [waypoints, recording])

//   return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
// }

// // ────────────────────────────────────────────────────────────────────────────
// // CtrlBtn — matches WaypointFollower's button style
// // ────────────────────────────────────────────────────────────────────────────
// function CtrlBtn({ label, icon, onClick, disabled, variant = 'red' }) {
//   const colors = {
//     red:   { border: 'rgba(200,0,10,0.5)',    bg: 'rgba(200,0,10,0.1)',    text: '#C8000A'  },
//     green: { border: 'rgba(34,197,94,0.4)',   bg: 'rgba(34,197,94,0.08)',  text: '#22c55e'  },
//     amber: { border: 'rgba(245,158,11,0.4)',  bg: 'rgba(245,158,11,0.08)', text: '#f59e0b'  },
//     ghost: { border: 'rgba(255,255,255,0.1)', bg: 'rgba(255,255,255,0.03)', text: 'rgba(255,255,255,0.35)' },
//   }
//   const col = disabled ? colors.ghost : colors[variant]
//   return (
//     <button
//       onClick={onClick}
//       disabled={disabled}
//       className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all"
//       style={{
//         borderColor: col.border,
//         background:  col.bg,
//         color:       col.text,
//         cursor:      disabled ? 'not-allowed' : 'pointer',
//         opacity:     disabled ? 0.45 : 1,
//       }}
//     >
//       <span>{label}</span>
//       <span className="text-sm">{icon}</span>
//     </button>
//   )
// }

// // ────────────────────────────────────────────────────────────────────────────
// // StatBox
// // ────────────────────────────────────────────────────────────────────────────
// function StatBox({ label, value, accent }) {
//   return (
//     <div className="bg-brand-black border border-brand-border px-2.5 py-1.5">
//       <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
//       <p className="font-mono text-[11px] truncate" style={{ color: accent || 'rgba(255,255,255,0.75)' }}>
//         {String(value ?? '—')}
//       </p>
//     </div>
//   )
// }

// // ────────────────────────────────────────────────────────────────────────────
// // WaypointRecorder
// // ────────────────────────────────────────────────────────────────────────────
// export default function WaypointRecorder() {
//   const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

//   // ── State from node ──
//   const [status, setStatus] = useState({
//     recording: false,
//     route:     'default',
//     count:     0,
//   })
//   const [routes,    setRoutes]    = useState([])
//   const [waypoints, setWaypoints] = useState([])   // accumulated this session

//   // ── Local UI state ──
//   const [routeInput,   setRouteInput]   = useState('')
//   const [dropOpen,     setDropOpen]     = useState(false)
//   const [eventLog,     setEventLog]     = useState([])
//   const [confirmClear, setConfirmClear] = useState(false)
//   const logRef = useRef(null)

//   const addLog = useCallback((msg, type = 'info') => {
//     setEventLog(prev => [...prev.slice(-80), { t: Date.now(), msg, type }])
//   }, [])

//   // ── Subscriptions ──
//   useEffect(() => {
//     if (!ready) return

//     // Advertise all publish topics so rosbridge knows their types
//     advertise(TOPIC.START,        'std_msgs/msg/Empty')
//     advertise(TOPIC.STOP,         'std_msgs/msg/Empty')
//     advertise(TOPIC.SET_ROUTE,    'std_msgs/msg/String')
//     advertise(TOPIC.CLEAR_ROUTES, 'std_msgs/msg/Empty')

//     const unsubs = []

//     unsubs.push(subscribe(TOPIC.STATUS, 'std_msgs/msg/String', msg => {
//       try {
//         const parsed = JSON.parse(msg.data)
//         setStatus(prev => {
//           // Detect new waypoint added mid-session
//           if (parsed.recording && parsed.count > prev.count) {
//             addLog(`WP #${parsed.count - 1} recorded`, 'ok')
//           }
//           if (!prev.recording && parsed.recording) {
//             addLog(`Recording STARTED → "${parsed.route}"`, 'cmd')
//             setWaypoints([])   // reset canvas on new session
//           }
//           if (prev.recording && !parsed.recording) {
//             addLog(`Recording STOPPED — ${parsed.count} waypoints saved`, 'status')
//           }
//           return parsed
//         })
//       } catch {}
//     }))

//     unsubs.push(subscribe(TOPIC.ROUTES, 'std_msgs/String', msg => {
//       try {
//         const list = JSON.parse(msg.data)
//         setRoutes(list)
//         console.log('Available routes:', list)
//         if (list.length) addLog(`Routes updated: [${list.join(', ')}]`, 'info')
//       } catch {}
//     }))

//     return () => unsubs.forEach(fn => fn())
//   }, [ready, subscribe, addLog])

//   // Auto-scroll log
//   useEffect(() => {
//     if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
//   }, [eventLog])

//   // Track waypoint count to build canvas dots (count-only from status)
//   // We simulate position dots using the count — actual positions would need
//   // a separate topic; here we show a "count bar" visualization instead.
//   // (The canvas will show real positions if you add a waypoints topic.)

//   // ── Publishers ──
//   const sendStart = () => {
//     publish(TOPIC.START, 'std_msgs/msg/Empty', {})
//     addLog('→ START sent', 'cmd')
//   }

//   const sendStop = () => {
//     publish(TOPIC.STOP, 'std_msgs/msg/Empty', {})
//     addLog('→ STOP sent', 'cmd')
//   }

//   const sendSetRoute = (name) => {
//     if (!name.trim()) return
//     publish(TOPIC.SET_ROUTE, 'std_msgs/msg/String', { data: name.trim() })
//     addLog(`→ SET_ROUTE "${name.trim()}"`, 'cmd')
//     setDropOpen(false)
//   }

//   const sendClearRoutes = () => {
//     publish(TOPIC.CLEAR_ROUTES, 'std_msgs/msg/Empty', {})
//     addLog('→ CLEAR_ROUTES sent', 'cmd')
//     setConfirmClear(false)
//   }

//   // ── Derived ──
//   const isRecording = status.recording
//   const wsCol = wsStatus === 'CONNECTED' ? '#22c55e' : wsStatus === 'CONNECTING' ? '#f59e0b' : '#ef4444'
//   const recCol = isRecording
//     ? { text: '#ef4444', border: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.08)' }
//     : { text: '#94a3b8', border: 'rgba(148,163,184,0.3)', bg: 'rgba(148,163,184,0.06)' }

//   // Fake waypoint dots for visualization (index-based positions in a spiral)
//   // Replace this with a real subscription if you publish waypoint positions
//   const fakeWPs = Array.from({ length: status.count }, (_, i) => ({
//     index: i,
//     position: {
//       x: Math.cos(i * 0.7) * (i * 0.4),
//       y: Math.sin(i * 0.7) * (i * 0.4),
//     }
//   }))

//   return (
//     <div className="h-full flex flex-col bg-brand-black overflow-hidden">

//       {/* ── Header ── */}
//       <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
//         <div className="flex items-center gap-3">
//           <div className="w-0.5 h-5 bg-brand-red" />
//           <div>
//             <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">
//               Waypoint Recorder
//             </h1>
//             <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">
//               Mission Planning · MAP Frame · ROS2 TF
//             </p>
//           </div>
//         </div>

//         <div className="flex items-center gap-3">
//           {/* rosbridge badge */}
//           <div
//             className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
//             style={{ borderColor: `${wsCol}44`, background: `${wsCol}0d`, color: wsCol }}
//           >
//             <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: wsCol }} />
//             rosbridge&nbsp;·&nbsp;{wsStatus}
//           </div>

//           {/* recording state badge */}
//           <div
//             className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
//             style={{ borderColor: recCol.border, background: recCol.bg, color: recCol.text }}
//           >
//             {isRecording && (
//               <span
//                 className="w-1.5 h-1.5 rounded-full"
//                 style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444', animation: 'pulse 1s infinite' }}
//               />
//             )}
//             {isRecording ? 'RECORDING' : 'IDLE'}
//           </div>
//         </div>
//       </div>

//       {/* ── Body ── */}
//       <div className="flex-1 flex overflow-hidden min-h-0">

//         {/* ── Map canvas area ── */}
//         <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">

//           {/* Canvas */}
//           <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
//             {/* corner marks */}
//             {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
//               'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls, i) => (
//               <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
//             ))}

//             {/* map badge */}
//             <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
//               <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">Live Trail</span>
//               <span className="text-white/20 font-mono text-[9px]">·</span>
//               <span className="font-mono text-white/40 text-[9px] tracking-widest">{status.route}</span>
//               {isRecording && (
//                 <>
//                   <span className="text-white/20 font-mono text-[9px]">·</span>
//                   <span className="font-mono text-[9px]" style={{ color: '#ef4444' }}>
//                     ● {status.count} WPs
//                   </span>
//                 </>
//               )}
//             </div>

//             {/* legend */}
//             <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
//               {[
//                 { style: { width: 10, height: 10, borderRadius: '50%', border: '2px solid #22c55e', background: 'rgba(34,197,94,0.4)', display: 'inline-block' }, label: 'Start' },
//                 { style: { width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(200,0,10,0.8)', background: 'rgba(200,0,10,0.4)', display: 'inline-block' }, label: 'Waypoint' },
//                 { style: { width: 10, height: 10, borderRadius: '50%', border: '2px solid #fff', background: '#C8000A', display: 'inline-block' }, label: 'Latest' },
//               ].map(({ style, label }) => (
//                 <div key={label} className="flex items-center gap-2">
//                   <div style={style} />
//                   <span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
//                 </div>
//               ))}
//             </div>

//             <WaypointCanvas waypoints={fakeWPs} recording={isRecording} />
//           </div>

//           {/* Waypoint count progress bar */}
//           <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
//             <div className="flex items-center justify-between mb-2">
//               <span className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">
//                 Waypoints Recorded
//               </span>
//               <span className="font-mono text-[9px]" style={{ color: isRecording ? '#ef4444' : 'rgba(255,255,255,0.35)' }}>
//                 {status.count} / ∞
//               </span>
//             </div>
//             <div className="h-1 bg-white/5 rounded-full overflow-hidden">
//               <div
//                 className="h-full rounded-full transition-all duration-500"
//                 style={{
//                   width:      `${Math.min(100, (status.count / 30) * 100)}%`,
//                   background: isRecording ? '#C8000A' : 'rgba(200,0,10,0.3)',
//                   boxShadow:  isRecording ? '0 0 8px rgba(200,0,10,0.6)' : 'none',
//                 }}
//               />
//             </div>
//           </div>
//         </div>

//         {/* ── Right Panel ── */}
//         <div className="w-60 flex-shrink-0 flex flex-col border-l border-brand-border overflow-hidden">

//           {/* Route name input + selector */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2.5">Route Name</p>

//             {/* Text input */}
//             <div className="flex gap-1 mb-2">
//               <input
//                 value={routeInput}
//                 onChange={e => setRouteInput(e.target.value)}
//                 onKeyDown={e => e.key === 'Enter' && sendSetRoute(routeInput)}
//                 disabled={isRecording}
//                 placeholder={status.route}
//                 className="flex-1 bg-brand-black border border-brand-border font-mono text-[10px] text-white/70 px-2.5 py-1.5 tracking-wide outline-none focus:border-brand-red/50 placeholder:text-white/15"
//                 style={{ cursor: isRecording ? 'not-allowed' : 'text' }}
//               />
//               <button
//                 onClick={() => sendSetRoute(routeInput)}
//                 disabled={isRecording || !routeInput.trim()}
//                 className="px-2.5 py-1.5 border font-mono text-[9px] tracking-widest transition-all"
//                 style={{
//                   borderColor: isRecording || !routeInput.trim() ? 'rgba(255,255,255,0.08)' : 'rgba(200,0,10,0.5)',
//                   background:  isRecording || !routeInput.trim() ? 'transparent' : 'rgba(200,0,10,0.1)',
//                   color:       isRecording || !routeInput.trim() ? 'rgba(255,255,255,0.2)' : '#C8000A',
//                   cursor:      isRecording || !routeInput.trim() ? 'not-allowed' : 'pointer',
//                 }}
//               >
//                 SET
//               </button>
//             </div>

//             {/* Saved routes dropdown */}
//             <div className="relative">
//               <button
//                 onClick={() => !isRecording && routes.length && setDropOpen(v => !v)}
//                 disabled={isRecording || !routes.length}
//                 className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-wide transition-all"
//                 style={{
//                   borderColor: isRecording ? 'rgba(255,255,255,0.07)' : 'rgba(200,0,10,0.35)',
//                   background:  isRecording ? 'rgba(255,255,255,0.02)' : 'rgba(200,0,10,0.05)',
//                   color:       isRecording ? 'rgba(255,255,255,0.2)'  : '#e8e8e8',
//                   cursor:      isRecording || !routes.length ? 'not-allowed' : 'pointer',
//                 }}
//               >
//                 <span className="truncate text-[9px]">{routes.length ? 'Saved routes…' : 'No saved routes'}</span>
//                 <span className="text-white/25 ml-2 text-[10px]">▾</span>
//               </button>
//               {dropOpen && (
//                 <>
//                   <div className="fixed inset-0 z-30" onClick={() => setDropOpen(false)} />
//                   <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-brand-card border border-brand-border shadow-2xl">
//                     {routes.map(r => (
//                       <button
//                         key={r}
//                         onClick={() => { sendSetRoute(r); setRouteInput(r); setDropOpen(false) }}
//                         className="w-full text-left px-3 py-2.5 font-mono text-[10px] tracking-wide hover:bg-brand-red/10 transition-colors flex items-center gap-2"
//                         style={{ color: r === status.route ? C.red : '#e8e8e8' }}
//                       >
//                         {r === status.route && <span className="text-brand-red text-[8px]">▶</span>}
//                         {r}
//                       </button>
//                     ))}
//                   </div>
//                 </>
//               )}
//             </div>
//           </div>

//           {/* Stats grid */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
//             <StatBox label="Active Route"  value={status.route}                        />
//             <StatBox label="WPs Recorded"  value={status.count}
//               accent={isRecording ? '#ef4444' : undefined}                             />
//             <StatBox label="Saved Routes"  value={routes.length}                       />
//             <StatBox label="State"
//               value={isRecording ? 'RECORDING' : 'IDLE'}
//               accent={isRecording ? '#ef4444' : '#94a3b8'}                             />
//           </div>

//           {/* Control buttons */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-1">Recording Control</p>

//             <CtrlBtn
//               label="Start Recording" icon="●"
//               onClick={sendStart}
//               disabled={isRecording || !ready}
//               variant="red"
//             />
//             <CtrlBtn
//               label="Stop & Save" icon="■"
//               onClick={sendStop}
//               disabled={!isRecording || !ready}
//               variant="amber"
//             />

//             {/* Clear routes — with confirmation */}
//             <div className="mt-1">
//               {!confirmClear ? (
//                 <CtrlBtn
//                   label="Clear All Routes" icon="✕"
//                   onClick={() => setConfirmClear(true)}
//                   disabled={isRecording || !ready || routes.length === 0}
//                   variant="ghost"
//                 />
//               ) : (
//                 <div className="border border-red-900/60 bg-red-950/20 p-2 flex flex-col gap-1.5">
//                   <p className="font-mono text-[8px] text-red-400/80 tracking-widest uppercase text-center">
//                     Delete ALL routes?
//                   </p>
//                   <div className="flex gap-1">
//                     <button
//                       onClick={sendClearRoutes}
//                       className="flex-1 py-1.5 border border-red-700/60 bg-red-900/20 font-mono text-[9px] text-red-400 tracking-widest uppercase hover:bg-red-900/40 transition-colors"
//                     >
//                       Confirm
//                     </button>
//                     <button
//                       onClick={() => setConfirmClear(false)}
//                       className="flex-1 py-1.5 border border-white/10 font-mono text-[9px] text-white/30 tracking-widest uppercase hover:bg-white/5 transition-colors"
//                     >
//                       Cancel
//                     </button>
//                   </div>
//                 </div>
//               )}
//             </div>
//           </div>

//           {/* Saved routes list */}
//           <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">Saved Routes</p>
//             {routes.length === 0 ? (
//               <p className="font-mono text-[9px] text-white/15 tracking-widest uppercase">none yet</p>
//             ) : (
//               <div className="flex flex-col gap-1">
//                 {routes.map((r, i) => (
//                   <div
//                     key={r}
//                     className="flex items-center justify-between px-2 py-1 border"
//                     style={{
//                       borderColor: r === status.route ? 'rgba(200,0,10,0.4)' : 'rgba(255,255,255,0.06)',
//                       background:  r === status.route ? 'rgba(200,0,10,0.06)' : 'transparent',
//                     }}
//                   >
//                     <div className="flex items-center gap-1.5">
//                       <span className="font-mono text-[7px] text-white/20">{String(i).padStart(2,'0')}</span>
//                       <span
//                         className="font-mono text-[9px] tracking-wide"
//                         style={{ color: r === status.route ? C.red : 'rgba(255,255,255,0.5)' }}
//                       >
//                         {r}
//                       </span>
//                     </div>
//                     {r === status.route && (
//                       <span className="font-mono text-[7px] text-brand-red/60 tracking-widest">ACTIVE</span>
//                     )}
//                   </div>
//                 ))}
//               </div>
//             )}
//           </div>

//           {/* Event log */}
//           <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
//             <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
//               {eventLog.length === 0 && (
//                 <p className="font-mono text-[8px] text-white/10 tracking-widest uppercase">waiting…</p>
//               )}
//               {eventLog.map((e, i) => (
//                 <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
//                   <span className="font-mono text-[7px] text-white/15 flex-shrink-0 mt-px">
//                     {new Date(e.t).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
//                   </span>
//                   <span className={`font-mono text-[9px] leading-tight ${
//                     e.type === 'cmd'    ? 'text-brand-red'  :
//                     e.type === 'ok'     ? 'text-green-400'  :
//                     e.type === 'status' ? 'text-amber-400'  : 'text-white/35'
//                   }`}>{e.msg}</span>
//                 </div>
//               ))}
//             </div>
//           </div>

//         </div>
//       </div>
//     </div>
//   )
// }

import { useEffect, useRef, useState, useCallback } from 'react'

// ── rosbridge WebSocket URL ──────────────────────────────────────────────────
const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'

// ── Topic names ──────────────────────────────────────────────────────────────
const TOPIC = {
  STATUS:       'waypoint_recorder/status',
  ROUTES:       'available_routes',
  START:        'waypoint_recorder/start',
  STOP:         'waypoint_recorder/stop',
  SET_ROUTE:    'waypoint_recorder/set_route',
  CLEAR_ROUTES: 'waypoint_recorder/clear_routes',
}

const C = {
  red:   '#C8000A',
  green: '#22c55e',
  amber: '#f59e0b',
}

// ────────────────────────────────────────────────────────────────────────────
// useRosBridge
// ────────────────────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef        = useRef(null)
  const subMap       = useRef({})
  const advMap       = useRef({})
  const idCounter    = useRef(0)           // ← unique IDs avoid collision
  const [ready,      setReady]    = useState(false)
  const [wsStatus,   setWsStatus] = useState('CONNECTING')
  const reconnectRef = useRef(null)

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return
    const ws = new WebSocket(url)
    wsRef.current = ws
    setWsStatus('CONNECTING')
    ws.onopen = () => {
      setReady(true); setWsStatus('CONNECTED')
      Object.entries(subMap.current).forEach(([id, { topic, type }]) =>
        ws.send(JSON.stringify({ op: 'subscribe', id, topic, type })))
      Object.entries(advMap.current).forEach(([topic, type]) =>
        ws.send(JSON.stringify({ op: 'advertise', topic, type })))
    }
    ws.onclose = () => {
      setReady(false); setWsStatus('DISCONNECTED')
      reconnectRef.current = setTimeout(connect, 3000)
    }
    ws.onerror  = () => setWsStatus('ERROR')
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.op === 'publish')
          Object.values(subMap.current)
            .filter(s => s.topic === msg.topic)
            .forEach(s => s.cb(msg.msg))
      } catch {}
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => { clearTimeout(reconnectRef.current); wsRef.current?.close() }
  }, [connect])

  // FIX: unique IDs using counter so re-subscriptions never collide
  const subscribe = useCallback((topic, type, cb, opts = {}) => {
    const id = `sub_${++idCounter.current}_${topic.replace(/\//g, '_')}`
    subMap.current[id] = { topic, type, cb }
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ op: 'subscribe', id, topic, type, ...opts }))
    return () => {
      delete subMap.current[id]
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ op: 'unsubscribe', id, topic }))
    }
  }, [])

  const advertise = useCallback((topic, type) => {
    advMap.current[topic] = type
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ op: 'advertise', topic, type }))
  }, [])

  const publish = useCallback((topic, type, msg) => {
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) return
    if (!advMap.current[topic]) {
      ws.send(JSON.stringify({ op: 'advertise', topic, type }))
      advMap.current[topic] = type
    }
    ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
  }, [])

  return { ready, wsStatus, subscribe, advertise, publish }
}

// ────────────────────────────────────────────────────────────────────────────
// WaypointCanvas — live dot-trail of recorded waypoints
// ────────────────────────────────────────────────────────────────────────────
function WaypointCanvas({ waypoints, recording }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = canvas.offsetWidth  || 600
    const H = canvas.offsetHeight || 400
    canvas.width  = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#080808'
    ctx.fillRect(0, 0, W, H)

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth   = 1
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }

    if (!waypoints?.length) {
      ctx.fillStyle = 'rgba(232,232,232,0.15)'
      ctx.font      = '11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Drive the T-ROV to record waypoints', W / 2, H / 2 - 10)
      ctx.fillStyle = 'rgba(232,232,232,0.07)'
      ctx.font      = '9px monospace'
      ctx.fillText('waypoints will appear here in real-time', W / 2, H / 2 + 10)
      return
    }

    const xs = waypoints.map(w => w.position.x)
    const ys = waypoints.map(w => w.position.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad    = 60
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const scale  = Math.min((W - pad*2) / rangeX, (H - pad*2) / rangeY)

    const tx = wp => pad + (wp.position.x - minX) * scale
    const ty = wp => H - pad - (wp.position.y - minY) * scale

    // path line
    ctx.beginPath()
    waypoints.forEach((wp, i) => {
      const px = tx(wp), py = ty(wp)
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    })
    ctx.strokeStyle = 'rgba(200,0,10,0.4)'
    ctx.lineWidth   = 2
    ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.setLineDash([])

    // dots
    waypoints.forEach((wp, i) => {
      const px = tx(wp), py = ty(wp)
      const isLast = i === waypoints.length - 1
      if (isLast && recording) {
        ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(200,0,10,0.12)'; ctx.fill()
      }
      ctx.beginPath(); ctx.arc(px, py, isLast ? 5 : 3.5, 0, Math.PI * 2)
      ctx.fillStyle   = isLast ? C.red : 'rgba(200,0,10,0.6)'; ctx.fill()
      ctx.strokeStyle = isLast ? 'rgba(255,255,255,0.6)' : 'rgba(200,0,10,0.8)'
      ctx.lineWidth   = 1.5; ctx.stroke()
      if (i % 5 === 0 || isLast) {
        ctx.fillStyle = isLast ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'
        ctx.font = '8px monospace'; ctx.textAlign = 'left'
        ctx.fillText(`#${wp.index}`, px + 7, py + 3)
      }
    })

    // start marker
    const s = waypoints[0]
    ctx.beginPath(); ctx.arc(tx(s), ty(s), 5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(34,197,94,0.8)'; ctx.fill()
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5; ctx.stroke()
  }, [waypoints, recording])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ────────────────────────────────────────────────────────────────────────────
// CtrlBtn
// ────────────────────────────────────────────────────────────────────────────
function CtrlBtn({ label, icon, onClick, disabled, variant = 'red' }) {
  const colors = {
    red:   { border: 'rgba(200,0,10,0.5)',     bg: 'rgba(200,0,10,0.1)',     text: '#C8000A'  },
    green: { border: 'rgba(34,197,94,0.4)',    bg: 'rgba(34,197,94,0.08)',   text: '#22c55e'  },
    amber: { border: 'rgba(245,158,11,0.4)',   bg: 'rgba(245,158,11,0.08)',  text: '#f59e0b'  },
    ghost: { border: 'rgba(255,255,255,0.1)',  bg: 'rgba(255,255,255,0.03)', text: 'rgba(255,255,255,0.35)' },
  }
  const col = disabled ? colors.ghost : colors[variant]
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all"
      style={{ borderColor: col.border, background: col.bg, color: col.text, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      <span>{label}</span>
      <span className="text-sm">{icon}</span>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// StatBox
// ────────────────────────────────────────────────────────────────────────────
function StatBox({ label, value, accent }) {
  return (
    <div className="bg-brand-black border border-brand-border px-2.5 py-1.5">
      <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
      <p className="font-mono text-[11px] truncate" style={{ color: accent || 'rgba(255,255,255,0.75)' }}>
        {String(value ?? '—')}
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// RouteDropdown — isolated component so routes state never goes stale
// Same pattern as WaypointFollower's RouteSelector fix
// ────────────────────────────────────────────────────────────────────────────
// function RouteDropdown({ routes, activeRoute, onSelect, disabled }) {
//   const [open, setOpen] = useState(false)

//   return (
//     <div className="relative">
//       <button
//         onClick={() => { if (!disabled && routes.length > 0) setOpen(v => !v) }}
//         disabled={disabled || routes.length === 0}
//         className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-wide transition-all"
//         style={{
//           borderColor: disabled ? 'rgba(255,255,255,0.07)' : 'rgba(200,0,10,0.35)',
//           background:  disabled ? 'rgba(255,255,255,0.02)' : 'rgba(200,0,10,0.05)',
//           color:       disabled ? 'rgba(255,255,255,0.2)'  : '#e8e8e8',
//           cursor:      disabled || routes.length === 0 ? 'not-allowed' : 'pointer',
//         }}
//       >
//         <span className="truncate text-[9px]">
//           {routes.length > 0 ? `Saved routes… (${routes.length})` : 'No saved routes'}
//         </span>
//         <span className="text-white/25 ml-2 text-[10px]">▾</span>
//       </button>

//       {open && routes.length > 0 && (
//         <>
//           <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
//           <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-[#161616] border border-[#2a2a2a] shadow-2xl max-h-48 overflow-y-auto">
//             {routes.map(r => (
//               <button key={r}
//                 onClick={() => { onSelect(r); setOpen(false) }}
//                 className="w-full text-left px-3 py-2.5 font-mono text-[10px] tracking-wide hover:bg-[rgba(200,0,10,0.1)] transition-colors flex items-center gap-2"
//                 style={{ color: r === activeRoute ? C.red : '#e8e8e8' }}>
//                 {r === activeRoute && <span className="text-[8px]" style={{ color: C.red }}>▶</span>}
//                 <span>{r}</span>
//               </button>
//             ))}
//           </div>
//         </>
//       )}
//     </div>
//   )
// }

// ────────────────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────────────────
export default function WaypointRecorder() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

  // ── Node state ──────────────────────────────────────────────────────────
  const [status, setStatus] = useState({ recording: false, route: 'default', count: 0 })
  const statusRef = useRef({ recording: false, route: 'default', count: 0 })

  // FIX: both state (render) + ref (callbacks) for routes
  const [routes,   setRoutes]  = useState([])
  const routesRef  = useRef([])

  // ── Local UI state ───────────────────────────────────────────────────────
  const [routeInput,   setRouteInput]   = useState('')
  const [eventLog,     setEventLog]     = useState([])
  const [confirmClear, setConfirmClear] = useState(false)
  const logRef = useRef(null)

  const addLog = useCallback((msg, type = 'info') =>
    setEventLog(prev => [...prev.slice(-80), { t: Date.now(), msg, type }]), [])

  // ── Subscriptions ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')

    // Advertise — use both std_msgs/msg/Empty and std_msgs/Empty for compat
    advertise(TOPIC.START,        'std_msgs/msg/Empty')
    advertise(TOPIC.STOP,         'std_msgs/msg/Empty')
    advertise(TOPIC.SET_ROUTE,    'std_msgs/msg/String')
    advertise(TOPIC.CLEAR_ROUTES, 'std_msgs/msg/Empty')

    const unsubs = [

      // ── waypoint_recorder/status ────────────────────────────────────────
      subscribe(TOPIC.STATUS, 'std_msgs/msg/String', (msg) => {
        try {
          const raw    = typeof msg === 'string' ? msg : (msg?.data ?? '')
          const parsed = JSON.parse(raw)
          const prev   = statusRef.current

          // transitions
          if (!prev.recording && parsed.recording)
            addLog(`Recording STARTED → "${parsed.route}"`, 'cmd')
          if (prev.recording && !parsed.recording)
            addLog(`Recording STOPPED — ${parsed.count} WPs saved`, 'status')
          if (parsed.recording && parsed.count > prev.count)
            addLog(`WP #${parsed.count - 1} recorded`, 'ok')

          statusRef.current = parsed
          setStatus(parsed)
        } catch (e) {
          addLog(`Status parse error: ${e.message}`, 'info')
        }
      }, { queue_length: 0, latch: true }),

      // ── available_routes ─────────────────────────────────────────────────
      // FIX 1: unique sub ID via counter (already handled in hook)
      // FIX 2: parse both wrapper formats { data: "..." } and raw string
      // FIX 3: update routesRef synchronously so callbacks never see stale value
      subscribe(TOPIC.ROUTES, 'std_msgs/msg/String', (msg) => {
        try {
          const raw  = typeof msg === 'string' ? msg : (msg?.data ?? JSON.stringify(msg))
          const list = JSON.parse(raw)
          if (!Array.isArray(list)) {
            addLog(`Routes: unexpected format — ${JSON.stringify(msg).slice(0, 60)}`, 'info')
            return
          }
          // update ref first (sync), then state (triggers re-render)
          routesRef.current = list
          setRoutes(list)
          addLog(`Routes (${list.length}): [${list.join(', ')}]`, 'info')
        } catch (e) {
          addLog(`Routes parse error: ${e.message}  raw=${JSON.stringify(msg).slice(0, 80)}`, 'info')
        }
      }, { queue_length: 0, latch: true }),
    ]

    return () => unsubs.forEach(fn => fn())
  }, [ready]) // intentionally only [ready] — callbacks read from refs

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [eventLog])

  // ── Publishers ───────────────────────────────────────────────────────────
  const sendStart = () => {
    publish(TOPIC.START, 'std_msgs/msg/Empty', {})
    addLog('→ START sent', 'cmd')
  }
  const sendStop = () => {
    publish(TOPIC.STOP, 'std_msgs/msg/Empty', {})
    addLog('→ STOP sent', 'cmd')
  }
  const sendSetRoute = useCallback((name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    publish(TOPIC.SET_ROUTE, 'std_msgs/msg/String', { data: trimmed })
    addLog(`→ SET_ROUTE "${trimmed}"`, 'cmd')
  }, [publish, addLog])

  const sendClearRoutes = () => {
    publish(TOPIC.CLEAR_ROUTES, 'std_msgs/msg/Empty', {})
    addLog('→ CLEAR_ROUTES sent', 'cmd')
    setConfirmClear(false)
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const isRecording = status.recording
  const wsCol       = wsStatus === 'CONNECTED' ? '#22c55e' : wsStatus === 'CONNECTING' ? '#f59e0b' : '#ef4444'
  const recCol      = isRecording
    ? { text: '#ef4444', border: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.08)' }
    : { text: '#94a3b8', border: 'rgba(148,163,184,0.3)', bg: 'rgba(148,163,184,0.06)' }

  // Simulated spiral dots for canvas (replace with real pose subscription if available)
  const fakeWPs = Array.from({ length: status.count }, (_, i) => ({
    index:    i,
    position: { x: Math.cos(i * 0.7) * (i * 0.4), y: Math.sin(i * 0.7) * (i * 0.4) },
  }))

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">Waypoint Recorder</h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">
              Mission Planning · MAP Frame · ROS2 TF
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* rosbridge badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor: `${wsCol}44`, background: `${wsCol}0d`, color: wsCol }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: wsCol }} />
            rosbridge · {wsStatus}
          </div>
          {/* recording badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor: recCol.border, background: recCol.bg, color: recCol.text }}>
            {isRecording && (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: '#ef4444' }} />
            )}
            {isRecording ? 'RECORDING' : 'IDLE'}
          </div>
          {/* routes loaded pill */}
          {routes.length > 0 && (
            <div className="px-2.5 py-1 border border-brand-border font-mono text-[9px] text-white/40 tracking-widest">
              {routes.length} routes
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Map canvas */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">
          <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
            {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
              'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls, i) => (
              <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
            ))}

            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">Live Trail</span>
              <span className="text-white/20 font-mono text-[9px]">·</span>
              <span className="font-mono text-white/40 text-[9px]">{status.route}</span>
              {isRecording && (
                <><span className="text-white/20 font-mono text-[9px]">·</span>
                <span className="font-mono text-[9px] text-red-400 animate-pulse-dot">● {status.count} WPs</span></>
              )}
            </div>

            <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
              {[
                { style: { width:10,height:10,borderRadius:'50%',border:'2px solid #22c55e',background:'rgba(34,197,94,0.4)',display:'inline-block'}, label:'Start' },
                { style: { width:10,height:10,borderRadius:'50%',border:'2px solid rgba(200,0,10,0.8)',background:'rgba(200,0,10,0.4)',display:'inline-block'}, label:'Waypoint' },
                { style: { width:10,height:10,borderRadius:'50%',border:'2px solid #fff',background:'#C8000A',display:'inline-block'}, label:'Latest' },
              ].map(({ style, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div style={style} />
                  <span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
                </div>
              ))}
            </div>

            <WaypointCanvas waypoints={fakeWPs} recording={isRecording} />
          </div>

          {/* Count progress */}
          <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Waypoints Recorded</span>
              <span className="font-mono text-[9px]" style={{ color: isRecording ? '#ef4444' : 'rgba(255,255,255,0.35)' }}>
                {status.count} / ∞
              </span>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{
                  width:      `${Math.min(100, (status.count / 30) * 100)}%`,
                  background: isRecording ? '#C8000A' : 'rgba(200,0,10,0.3)',
                  boxShadow:  isRecording ? '0 0 8px rgba(200,0,10,0.6)' : 'none',
                }} />
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-60 flex-shrink-0 flex flex-col border-l border-brand-border overflow-y-auto">

          {/* Route name input + dropdown */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border">
            <div className="flex items-center justify-between mb-2.5">
              <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Route Name</p>
              {/* FIX: always-visible route count so user knows data arrived */}
              <span className={`font-mono text-[8px] px-1.5 py-0.5 border tracking-widest
                ${routes.length > 0 ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-brand-border text-white/20'}`}>
                {routes.length > 0 ? `${routes.length} saved` : 'none'}
              </span>
            </div>

            {/* Text input */}
            <div className="flex gap-1 mb-2">
              <input
                value={routeInput}
                onChange={e => setRouteInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendSetRoute(routeInput)}
                disabled={isRecording}
                placeholder={status.route}
                className="flex-1 bg-brand-black border border-brand-border font-mono text-[10px] text-white/70 px-2.5 py-1.5 tracking-wide outline-none focus:border-brand-red/50 placeholder:text-white/15"
                style={{ cursor: isRecording ? 'not-allowed' : 'text' }}
              />
              <button
                onClick={() => sendSetRoute(routeInput)}
                disabled={isRecording || !routeInput.trim()}
                className="px-2.5 py-1.5 border font-mono text-[9px] tracking-widest transition-all"
                style={{
                  borderColor: isRecording || !routeInput.trim() ? 'rgba(255,255,255,0.08)' : 'rgba(200,0,10,0.5)',
                  background:  isRecording || !routeInput.trim() ? 'transparent' : 'rgba(200,0,10,0.1)',
                  color:       isRecording || !routeInput.trim() ? 'rgba(255,255,255,0.2)' : '#C8000A',
                  cursor:      isRecording || !routeInput.trim() ? 'not-allowed' : 'pointer',
                }}
              >SET</button>
            </div>

            {/* Isolated dropdown — never has stale routes */}
            {/* <RouteDropdown
              routes={routes}
              activeRoute={status.route}
              onSelect={(r) => { sendSetRoute(r); setRouteInput(r) }}
              disabled={isRecording}
            /> */}
          </div>

          {/* Stats */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
            <StatBox label="Active Route"  value={status.route} />
            <StatBox label="WPs Recorded"  value={status.count} accent={isRecording ? '#ef4444' : undefined} />
            <StatBox label="Saved Routes"  value={routes.length} />
            <StatBox label="State" value={isRecording ? 'RECORDING' : 'IDLE'} accent={isRecording ? '#ef4444' : '#94a3b8'} />
          </div>

          {/* Controls */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-1">Recording Control</p>
            <CtrlBtn label="Start Recording" icon="●" onClick={sendStart} disabled={isRecording || !ready}  variant="red"   />
            <CtrlBtn label="Stop & Save"     icon="■" onClick={sendStop}  disabled={!isRecording || !ready} variant="amber" />
            <div className="mt-1">
              {!confirmClear ? (
                <CtrlBtn label="Clear All Routes" icon="✕" onClick={() => setConfirmClear(true)}
                  disabled={isRecording || !ready || routes.length === 0} variant="ghost" />
              ) : (
                <div className="border border-red-900/60 bg-red-950/20 p-2 flex flex-col gap-1.5">
                  <p className="font-mono text-[8px] text-red-400/80 tracking-widest uppercase text-center">Delete ALL routes?</p>
                  <div className="flex gap-1">
                    <button onClick={sendClearRoutes}
                      className="flex-1 py-1.5 border border-red-700/60 bg-red-900/20 font-mono text-[9px] text-red-400 tracking-widest uppercase hover:bg-red-900/40 transition-colors">
                      Confirm
                    </button>
                    <button onClick={() => setConfirmClear(false)}
                      className="flex-1 py-1.5 border border-white/10 font-mono text-[9px] text-white/30 tracking-widest uppercase hover:bg-white/5 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Saved routes list */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">
              Saved Routes
              {routes.length > 0 && <span className="text-white/20 ml-1">({routes.length})</span>}
            </p>
            {routes.length === 0 ? (
              <p className="font-mono text-[9px] text-white/15 tracking-widest uppercase">none yet</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                {routes.map((r, i) => (
                  <div key={r}
                    className="flex items-center justify-between px-2 py-1 border"
                    style={{
                      borderColor: r === status.route ? 'rgba(200,0,10,0.4)' : 'rgba(255,255,255,0.06)',
                      background:  r === status.route ? 'rgba(200,0,10,0.06)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[7px] text-white/20">{String(i).padStart(2,'0')}</span>
                      <span className="font-mono text-[9px] tracking-wide"
                        style={{ color: r === status.route ? C.red : 'rgba(255,255,255,0.5)' }}>
                        {r}
                      </span>
                    </div>
                    {r === status.route && (
                      <span className="font-mono text-[7px] text-brand-red/60 tracking-widest">ACTIVE</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Event log */}
          <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
            <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
              {eventLog.length === 0 && (
                <p className="font-mono text-[8px] text-white/10 tracking-widest uppercase">waiting…</p>
              )}
              {eventLog.map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
                  <span className="font-mono text-[7px] text-white/15 flex-shrink-0 mt-px">
                    {new Date(e.t).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`font-mono text-[9px] leading-tight break-all ${
                    e.type === 'cmd'    ? 'text-brand-red'  :
                    e.type === 'ok'     ? 'text-green-400'  :
                    e.type === 'status' ? 'text-amber-400'  : 'text-white/35'
                  }`}>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}