
// import { useEffect, useRef, useState, useCallback } from 'react'

// // ── rosbridge WebSocket URL ──────────────────────────────────────────────────
// const ROSBRIDGE_URL = 'ws://187.77.184.19/ros/'

// // ── Topic names (mirror the Python node defaults) ────────────────────────────
// const TOPIC = {
//   STATUS:    'route_follower/status',
//   ROUTES:    'available_routes',
//   FULL_PATH: 'route_follower/full_path',
//   REMAINING: 'route_follower/remaining_path',
//   START:     'route_follower/start',
//   STOP:      'route_follower/stop',
//   RESUME:    'route_follower/resume',
//   SET_ROUTE: 'route_follower/set_route',
// }

// const C = {
//   red:      '#C8000A',
//   green:    '#22c55e',
//   amber:    '#f59e0b',
//   white:    '#e8e8e8',
//   muted:    'rgba(232,232,232,0.3)',
//   grid:     'rgba(255,255,255,0.04)',
//   pathFull: 'rgba(200,0,10,0.22)',
//   pathRem:  '#C8000A',
//   wpDone:   'rgba(200,0,10,0.3)',
//   wpAhead:  '#C8000A',
// }

// const STATE_COLOR = {
//   IDLE:    { text: '#94a3b8', border: 'rgba(148,163,184,0.3)', bg: 'rgba(148,163,184,0.06)' },
//   RUNNING: { text: '#22c55e', border: 'rgba(34,197,94,0.35)',  bg: 'rgba(34,197,94,0.08)'   },
//   STOPPED: { text: '#f59e0b', border: 'rgba(245,158,11,0.35)', bg: 'rgba(245,158,11,0.08)'  },
// }

// // ────────────────────────────────────────────────────────────────────────────
// // useRosBridge — lightweight hook (rosbridge v2 JSON protocol, no roslibjs)
// // ────────────────────────────────────────────────────────────────────────────
// function useRosBridge(url) {
//   const wsRef        = useRef(null)
//   const subMap       = useRef({})   // subscriptions
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
//       setReady(true)
//       setWsStatus('CONNECTED')
//       // Re-subscribe after reconnect
//       Object.entries(subMap.current).forEach(([id, { topic, type }]) =>
//         ws.send(JSON.stringify({ op: 'subscribe', id, topic, type })))
//       // Re-advertise all publish topics after reconnect
//       Object.entries(advMap.current).forEach(([topic, type]) =>
//         ws.send(JSON.stringify({ op: 'advertise', topic, type })))
//     }
//     ws.onclose = () => {
//       setReady(false)
//       setWsStatus('DISCONNECTED')
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
// // MapCanvas
// // ────────────────────────────────────────────────────────────────────────────
// function MapCanvas({ fullPath, remainingPath, robotPos }) {
//   const canvasRef = useRef(null)

//   useEffect(() => {
//     const canvas = canvasRef.current
//     if (!canvas) return
//     const ctx = canvas.getContext('2d')
//     const W = canvas.offsetWidth  || 800
//     const H = canvas.offsetHeight || 500
//     canvas.width  = W
//     canvas.height = H

//     ctx.clearRect(0, 0, W, H)
//     ctx.fillStyle = '#080808'
//     ctx.fillRect(0, 0, W, H)

//     // grid
//     ctx.strokeStyle = C.grid
//     ctx.lineWidth   = 1
//     for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
//     for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }

//     if (!fullPath?.length) {
//       ctx.fillStyle = C.muted
//       ctx.font      = '11px monospace'
//       ctx.textAlign = 'center'
//       ctx.fillText('No route loaded — start mission or set route', W/2, H/2)
//       return
//     }

//     // bounds
//     let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
//     const allPts = [...fullPath]
//     if (robotPos) allPts.push({ pose: { position: { x: robotPos.x, y: robotPos.y } } })
//     allPts.forEach(p => {
//       const x = p.pose.position.x, y = p.pose.position.y
//       if (x < minX) minX = x; if (x > maxX) maxX = x
//       if (y < minY) minY = y; if (y > maxY) maxY = y
//     })
//     const pad = Math.max((maxX - minX) * 0.2, (maxY - minY) * 0.2, 2)
//     minX -= pad; maxX += pad; minY -= pad; maxY += pad

//     const toC = (wx, wy) => ({
//       x: ((wx - minX) / (maxX - minX)) * (W - 48) + 24,
//       y: H - (((wy - minY) / (maxY - minY)) * (H - 48) + 24),
//     })

//     const remSet = new Set(
//       (remainingPath || []).map(p =>
//         `${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`
//       )
//     )

//     // completed dashed path
//     ctx.beginPath()
//     ctx.strokeStyle = C.pathFull
//     ctx.lineWidth   = 2
//     ctx.setLineDash([6, 5])
//     fullPath.forEach((p, i) => {
//       const c = toC(p.pose.position.x, p.pose.position.y)
//       i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)
//     })
//     ctx.stroke()
//     ctx.setLineDash([])

//     // remaining solid red
//     if (remainingPath?.length > 1) {
//       ctx.beginPath()
//       ctx.strokeStyle = C.pathRem
//       ctx.lineWidth   = 2.5
//       remainingPath.forEach((p, i) => {
//         const c = toC(p.pose.position.x, p.pose.position.y)
//         i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)
//       })
//       ctx.stroke()
//     }

//     // waypoint dots
//     fullPath.forEach((p, i) => {
//       const c   = toC(p.pose.position.x, p.pose.position.y)
//       const key = `${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`
//       const ahead = remSet.has(key)
//       ctx.beginPath()
//       ctx.arc(c.x, c.y, ahead ? 4.5 : 3.5, 0, Math.PI*2)
//       ctx.fillStyle   = ahead ? C.wpAhead : C.wpDone
//       ctx.fill()
//       ctx.strokeStyle = ahead ? C.red : C.wpDone
//       ctx.lineWidth   = 1.5
//       ctx.stroke()
//       // index label
//       ctx.fillStyle = ahead ? 'rgba(200,0,10,0.85)' : 'rgba(200,0,10,0.35)'
//       ctx.font      = '8px monospace'
//       ctx.textAlign = 'center'
//       ctx.fillText(i+1, c.x, c.y - 8)
//     })

//     // current target ring (first of remaining)
//     if (remainingPath?.length) {
//       const t  = remainingPath[0]
//       const tc = toC(t.pose.position.x, t.pose.position.y)
//       ctx.beginPath()
//       ctx.arc(tc.x, tc.y, 11, 0, Math.PI*2)
//       ctx.strokeStyle = '#ffffff'
//       ctx.lineWidth   = 1.5
//       ctx.stroke()
//       const tl = 5
//       ;[[-1,0],[1,0],[0,-1],[0,1]].forEach(([dx,dy]) => {
//         ctx.beginPath()
//         ctx.moveTo(tc.x + dx*tl*1.9, tc.y + dy*tl*1.9)
//         ctx.lineTo(tc.x + dx*tl*3.2, tc.y + dy*tl*3.2)
//         ctx.stroke()
//       })
//     }

//     // robot
//     if (robotPos) {
//       const rc = toC(robotPos.x, robotPos.y)
//       ctx.beginPath(); ctx.arc(rc.x, rc.y, 10, 0, Math.PI*2)
//       ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 7; ctx.stroke()
//       ctx.beginPath(); ctx.arc(rc.x, rc.y, 7, 0, Math.PI*2)
//       ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke()
//       ctx.beginPath(); ctx.arc(rc.x, rc.y, 3, 0, Math.PI*2)
//       ctx.fillStyle = '#ffffff'; ctx.fill()
//     }

//     // scale bar
//     const worldW = maxX - minX
//     const pxPerM = (W - 48) / worldW
//     const scaleM = Math.pow(10, Math.floor(Math.log10(worldW / 4)))
//     const scalePx = scaleM * pxPerM
//     const sx = W - 24 - scalePx, sy = H - 12
//     ctx.strokeStyle = 'rgba(232,232,232,0.25)'; ctx.lineWidth = 1.5; ctx.setLineDash([])
//     ctx.beginPath()
//     ctx.moveTo(sx, sy); ctx.lineTo(sx+scalePx, sy)
//     ctx.moveTo(sx, sy-3); ctx.lineTo(sx, sy+3)
//     ctx.moveTo(sx+scalePx, sy-3); ctx.lineTo(sx+scalePx, sy+3)
//     ctx.stroke()
//     ctx.fillStyle = 'rgba(232,232,232,0.25)'; ctx.font = '9px monospace'; ctx.textAlign = 'center'
//     ctx.fillText(`${scaleM}m`, sx+scalePx/2, sy-6)

//   }, [fullPath, remainingPath, robotPos])

//   return <canvas ref={canvasRef} className="w-full h-full block" />
// }

// // ────────────────────────────────────────────────────────────────────────────
// // Progress Bar
// // ────────────────────────────────────────────────────────────────────────────
// function ProgressBar({ segment, total }) {
//   const pct = total > 0 ? Math.round((segment / total) * 100) : 0
//   return (
//     <div className="w-full">
//       <div className="flex justify-between items-center mb-1.5">
//         <span className="font-mono text-[9px] tracking-widest uppercase text-white/30">Mission Progress</span>
//         <span className="font-mono text-[10px] text-white/50">
//           {segment}/{total}&nbsp;&nbsp;<span className="text-brand-red font-bold">{pct}%</span>
//         </span>
//       </div>
//       <div className="w-full h-1.5 bg-white/5 rounded-sm overflow-hidden">
//         <div className="h-full bg-brand-red transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
//       </div>
//       {total > 0 && total <= 50 && (
//         <div className="relative w-full h-2 mt-1">
//           {Array.from({ length: total }).map((_, i) => (
//             <div key={i} className="absolute top-0 w-px h-1.5 transition-colors duration-300"
//               style={{
//                 left:       `${((i+1) / total) * 100}%`,
//                 background: i < segment ? C.red : 'rgba(255,255,255,0.1)',
//               }}
//             />
//           ))}
//         </div>
//       )}
//     </div>
//   )
// }

// // ────────────────────────────────────────────────────────────────────────────
// // Control Button
// // ────────────────────────────────────────────────────────────────────────────
// function CtrlBtn({ label, icon, onClick, disabled, variant }) {
//   const variants = {
//     red:   { active: { bg: '#C8000A', border: '#C8000A', color: '#fff' },     dim: { bg: 'transparent', border: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.18)' } },
//     amber: { active: { bg: 'transparent', border: 'rgba(245,158,11,0.5)', color: '#f59e0b' }, dim: { bg: 'transparent', border: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.18)' } },
//     green: { active: { bg: 'transparent', border: 'rgba(34,197,94,0.45)',  color: '#22c55e' }, dim: { bg: 'transparent', border: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.18)' } },
//   }
//   const style = disabled ? variants[variant].dim : variants[variant].active
//   return (
//     <button onClick={onClick} disabled={disabled}
//       className="w-full py-3 font-mono text-[10px] tracking-[0.25em] uppercase font-bold transition-all duration-150 flex items-center justify-center gap-2 border"
//       style={{ ...style, cursor: disabled ? 'not-allowed' : 'pointer' }}>
//       <span>{icon}</span>{label}
//     </button>
//   )
// }

// // ────────────────────────────────────────────────────────────────────────────
// // Main Page
// // ────────────────────────────────────────────────────────────────────────────
// export default function WaypointFollower() {
//   const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

//   const [status,    setStatus]    = useState({ state: 'IDLE', route: '—', segment: 0, total: 0, dist_to_goal: 0 })
//   const [routes,    setRoutes]    = useState([])
//   const [fullPath,  setFullPath]  = useState([])
//   const [remaining, setRemaining] = useState([])
//   const [robotPos,  setRobotPos]  = useState(null)

//   const [selectedRoute, setSelectedRoute] = useState('')
//   const [dropOpen,      setDropOpen]      = useState(false)
//   const [eventLog,      setEventLog]      = useState([{ t: Date.now(), msg: 'Interface ready', type: 'info' }])

//   const addLog = useCallback((msg, type = 'info') =>
//     setEventLog(prev => [{ t: Date.now(), msg, type }, ...prev].slice(0, 80)), [])

//   // ── Subscribe ────────────────────────────────────────────────────────────
//   useEffect(() => {
//     if (!ready) return
//     addLog('rosbridge connected', 'ok')

//     // Advertise all publish topics so rosbridge knows their types
//     advertise(TOPIC.START,     'std_msgs/msg/Empty')
//     advertise(TOPIC.STOP,      'std_msgs/msg/Empty')
//     advertise(TOPIC.RESUME,    'std_msgs/msg/Empty')
//     advertise(TOPIC.SET_ROUTE, 'std_msgs/msg/String')

//     const unsubs = [
//       subscribe(TOPIC.STATUS, 'std_msgs/msg/String', (msg) => {
//         try {
//           const d = JSON.parse(msg.data)
//           setStatus(d)
//           addLog(`[${d.state}] seg ${d.segment}/${d.total}  dist ${d.dist_to_goal}m`, 'status')
//         } catch {}
//       }),
//       subscribe(TOPIC.ROUTES, 'std_msgs/msg/String', (msg) => {
//         try {
//           const list = JSON.parse(msg.data)
//           setRoutes(list)
//           if (list.length) setSelectedRoute(r => r || list[0])
//           addLog(`Routes: [${list.join(', ')}]`, 'info')
//         } catch {}
//       }),
//       subscribe(TOPIC.FULL_PATH, 'nav_msgs/msg/Path', (msg) => {
//         setFullPath(msg.poses || [])
//         addLog(`Full path received: ${(msg.poses||[]).length} pts`, 'info')
//       }),
//       subscribe(TOPIC.REMAINING, 'nav_msgs/msg/Path', (msg) => {
//         setRemaining(msg.poses || [])
//       }),
//     ]
//     return () => unsubs.forEach(u => u?.())
//   }, [ready])

//   // ── Publish ──────────────────────────────────────────────────────────────
//   const sendStart  = () => { publish(TOPIC.START,  'std_msgs/msg/Empty',  {}); addLog('→ START',  'cmd') }
//   const sendStop   = () => { publish(TOPIC.STOP,   'std_msgs/msg/Empty',  {}); addLog('→ STOP',   'cmd') }
//   const sendResume = () => { publish(TOPIC.RESUME, 'std_msgs/msg/Empty',  {}); addLog('→ RESUME', 'cmd') }
//   const sendRoute  = (name) => {
//     publish(TOPIC.SET_ROUTE, 'std_msgs/msg/String', { data: name })
//     setSelectedRoute(name); setDropOpen(false)
//     addLog(`→ SET_ROUTE: "${name}"`, 'cmd')
//   }

//   // ── Derived ──────────────────────────────────────────────────────────────
//   const sc       = STATE_COLOR[status.state] || STATE_COLOR.IDLE
//   const isRunning = status.state === 'RUNNING'
//   const isStopped = status.state === 'STOPPED'
//   const doneCount = Math.max(0, status.segment - 1)
//   const remCount  = Math.max(0, status.total - doneCount)

//   const wsCol = wsStatus === 'CONNECTED' ? '#22c55e' : wsStatus === 'CONNECTING' ? '#f59e0b' : '#ef4444'

//   return (
//     <div className="h-full flex flex-col bg-brand-black overflow-hidden">

//       {/* ── Header ── */}
//       <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
//         <div className="flex items-center gap-3">
//           <div className="w-0.5 h-5 bg-brand-red" />
//           <div>
//             <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">Waypoint Follower</h1>
//             <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">Autonomous Route Execution · ROS2 Nav2</p>
//           </div>
//         </div>
//         <div className="flex items-center gap-3">
//           {/* rosbridge badge */}
//           <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
//             style={{ borderColor: `${wsCol}44`, background: `${wsCol}0d`, color: wsCol }}>
//             <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: wsCol }} />
//             rosbridge&nbsp;·&nbsp;{wsStatus}
//           </div>
//           {/* state badge */}
//           <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
//             style={{ borderColor: sc.border, background: sc.bg, color: sc.text }}>
//             <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.text }} />
//             {status.state}
//           </div>
//         </div>
//       </div>

//       {/* ── Body ── */}
//       <div className="flex-1 flex overflow-hidden min-h-0">

//         {/* MAP area */}
//         <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">

//           {/* Map canvas */}
//           <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
//             {/* corner marks */}
//             {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r','bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls,i) => (
//               <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
//             ))}

//             {/* map badge */}
//             <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
//               <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">Route Map</span>
//               {status.route !== '—' && <>
//                 <span className="text-white/20 font-mono text-[9px]">·</span>
//                 <span className="font-mono text-white/40 text-[9px] tracking-widest">{status.route}</span>
//               </>}
//             </div>

//             {/* legend */}
//             <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
//               {[
//                 { style: { borderTop: '2px dashed rgba(200,0,10,0.25)', width: 22 }, label: 'Completed' },
//                 { style: { borderTop: '2px solid #C8000A', width: 22 }, label: 'Remaining' },
//                 { style: { width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.6)', display:'inline-block' }, label: 'Robot' },
//                 { style: { width: 10, height: 10, borderRadius: '50%', border: '1px solid #C8000A', background: '#C8000A', display:'inline-block' }, label: 'Waypoint' },
//               ].map(({ style, label }) => (
//                 <div key={label} className="flex items-center gap-2">
//                   <div style={style} />
//                   <span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
//                 </div>
//               ))}
//             </div>

//             <MapCanvas fullPath={fullPath} remainingPath={remaining} robotPos={robotPos} />
//           </div>

//           {/* Progress bar */}
//           <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
//             <ProgressBar segment={status.segment} total={status.total} />
//           </div>
//         </div>

//         {/* RIGHT PANEL */}
//         <div className="w-60 flex-shrink-0 flex flex-col border-l border-brand-border overflow-hidden">

//           {/* Route selector */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2.5">Active Route</p>
//             <div className="relative">
//               <button
//                 onClick={() => !isRunning && setDropOpen(v => !v)}
//                 disabled={isRunning}
//                 className="w-full flex items-center justify-between px-3 py-2 border font-mono text-xs tracking-wide transition-all"
//                 style={{
//                   borderColor: isRunning ? 'rgba(255,255,255,0.07)' : 'rgba(200,0,10,0.4)',
//                   background:  isRunning ? 'rgba(255,255,255,0.02)' : 'rgba(200,0,10,0.06)',
//                   color:       isRunning ? 'rgba(255,255,255,0.2)'  : '#e8e8e8',
//                   cursor:      isRunning ? 'not-allowed' : 'pointer',
//                 }}
//               >
//                 <span className="truncate">{selectedRoute || 'Select route…'}</span>
//                 <span className="text-white/25 ml-2 text-[10px]">▾</span>
//               </button>
//               {dropOpen && (
//                 <>
//                   <div className="fixed inset-0 z-30" onClick={() => setDropOpen(false)} />
//                   <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-brand-card border border-brand-border shadow-2xl">
//                     {routes.length === 0
//                       ? <p className="font-mono text-white/20 text-[9px] p-3 tracking-widest uppercase">No routes</p>
//                       : routes.map(r => (
//                         <button key={r} onClick={() => sendRoute(r)}
//                           className="w-full text-left px-3 py-2.5 font-mono text-xs tracking-wide hover:bg-brand-red/10 transition-colors flex items-center gap-2"
//                           style={{ color: r === selectedRoute ? C.red : '#e8e8e8' }}>
//                           {r === selectedRoute && <span className="text-brand-red text-[8px]">▶</span>}
//                           {r}
//                         </button>
//                       ))
//                     }
//                   </div>
//                 </>
//               )}
//             </div>
//           </div>

//           {/* Stats grid */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
//             {[
//               ['Total WPs',   status.total                            ],
//               ['Segment',     status.segment                          ],
//               ['Done',        doneCount                               ],
//               ['Remaining',   remCount                                ],
//               ['Dist. Goal',  status.dist_to_goal ? `${status.dist_to_goal}m` : '—'],
//               ['Route',       status.route                            ],
//             ].map(([label, value]) => (
//               <div key={label} className="bg-brand-black border border-brand-border px-2.5 py-1.5">
//                 <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
//                 <p className="font-mono text-[11px] text-white/75 truncate">{String(value ?? '—')}</p>
//               </div>
//             ))}
//           </div>

//           {/* Control buttons */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-1">Mission Control</p>
//             <CtrlBtn label="Start Mission" icon="▶" onClick={sendStart}  disabled={isRunning || !ready} variant="red"   />
//             <CtrlBtn label="Stop"          icon="■" onClick={sendStop}   disabled={!isRunning || !ready} variant="amber" />
//             <CtrlBtn label="Resume"        icon="⏵" onClick={sendResume} disabled={!isStopped || !ready} variant="green" />
//           </div>

//           {/* Event log */}
//           <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
//             <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
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
  STATUS:    'route_follower/status',
  ROUTES:    'available_routes',
  FULL_PATH: 'route_follower/full_path',
  REMAINING: 'route_follower/remaining_path',
  START:     'route_follower/start',
  STOP:      'route_follower/stop',
  RESUME:    'route_follower/resume',
  SET_ROUTE: 'route_follower/set_route',
  MAP:       '/map',
  AMCL:      '/amcl_pose',   // geometry_msgs/PoseWithCovarianceStamped — localized pose in map frame
}

const C = {
  red:      '#C8000A',
  green:    '#22c55e',
  amber:    '#f59e0b',
  white:    '#e8e8e8',
  muted:    'rgba(232,232,232,0.3)',
  grid:     'rgba(255,255,255,0.04)',
  pathFull: 'rgba(200,0,10,0.25)',
  pathRem:  '#C8000A',
  wpDone:   'rgba(200,0,10,0.35)',
  wpAhead:  '#C8000A',
}

const STATE_COLOR = {
  IDLE:    { text: '#94a3b8', border: 'rgba(148,163,184,0.3)', bg: 'rgba(148,163,184,0.06)' },
  RUNNING: { text: '#22c55e', border: 'rgba(34,197,94,0.35)',  bg: 'rgba(34,197,94,0.08)'   },
  STOPPED: { text: '#f59e0b', border: 'rgba(245,158,11,0.35)', bg: 'rgba(245,158,11,0.08)'  },
}

// ────────────────────────────────────────────────────────────────────────────
// useRosBridge
// ────────────────────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef        = useRef(null)
  const subMap       = useRef({})
  const advMap       = useRef({})
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
      Object.entries(subMap.current).forEach(([id, { topic, type, opts = {} }]) =>
        ws.send(JSON.stringify({ op: 'subscribe', id, topic, type, ...opts })))
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

  const subscribe = useCallback((topic, type, cb, opts = {}) => {
    const id = `sub_${topic.replace(/\//g, '_')}_${Date.now()}`
    subMap.current[id] = { topic, type, cb, opts }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const payload = { op: 'subscribe', id, topic, type, ...opts }
      wsRef.current.send(JSON.stringify(payload))
    }
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
// decodeOccupancyGrid
// Converts nav_msgs/OccupancyGrid → ImageData drawn onto a regular <canvas>
// Returns: { imageData, width, height, resolution, originX, originY }
// ────────────────────────────────────────────────────────────────────────────
function decodeOccupancyGrid(mapMsg) {
  if (!mapMsg?.info || !mapMsg?.data) return null
  const { width, height, resolution, origin } = mapMsg.info
  if (!width || !height) return null

  const data = mapMsg.data  // Int8Array or plain Array from rosbridge

  // Build raw RGBA pixel buffer — rows are flipped because:
  //   ROS: row 0 = bottom of map (y_min),  row N-1 = top (y_max)
  //   ImageData: row 0 = top of image
  const rgba = new Uint8ClampedArray(width * height * 4)

  for (let row = 0; row < height; row++) {
    const canvasRow = height - 1 - row   // flip Y
    for (let col = 0; col < width; col++) {
      const v   = data[row * width + col]
      const dst = (canvasRow * width + col) * 4
      if (v === -1) {
        // Unknown → mid grey (RViz default)
        rgba[dst] = 128; rgba[dst+1] = 128; rgba[dst+2] = 128; rgba[dst+3] = 255
      } else if (v === 0) {
        // Free → light grey/white
        rgba[dst] = 205; rgba[dst+1] = 205; rgba[dst+2] = 205; rgba[dst+3] = 255
      } else {
        // Occupied → dark; higher value = darker (100 = near-black)
        const d = Math.round(205 - (v / 100) * 195)
        rgba[dst] = d; rgba[dst+1] = d; rgba[dst+2] = d; rgba[dst+3] = 255
      }
    }
  }

  return {
    imageData: new ImageData(rgba, width, height),
    width, height, resolution,
    originX: origin.position.x,
    originY: origin.position.y,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MapCanvas
// All coordinate math uses canvas.width/height (the actual pixel buffer size),
// NOT offsetWidth/offsetHeight (the CSS layout size) — these differ with
// devicePixelRatio and before layout settles.
// ────────────────────────────────────────────────────────────────────────────
function MapCanvas({ mapData, fullPath, remainingPath, robotPos }) {
  const canvasRef = useRef(null)
  // Single source of truth for view state — world coords (metres)
  const viewRef   = useRef(null)   // null = not fitted yet
  const dragRef   = useRef(null)

  // ── Tile canvas: pre-render the occupancy grid once per map update ──
  const tileRef   = useRef(null)   // { canvas, mapData } — reuse across frames
  useEffect(() => {
    if (!mapData?.imageData) { tileRef.current = null; return }
    const tc  = document.createElement('canvas')
    tc.width  = mapData.width
    tc.height = mapData.height
    tc.getContext('2d').putImageData(mapData.imageData, 0, 0)
    tileRef.current = tc
  }, [mapData])

  // ── Fit view to the map bounds ──
  // Called after tileRef is set and canvas has a real size
  const fittedRef = useRef(false)
  const fitView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Use the actual pixel buffer size (set explicitly in the resize handler)
    const W = canvas.width  || canvas.offsetWidth  || 800
    const H = canvas.height || canvas.offsetHeight || 500
    if (!W || !H) return

    // Build bounds from map origin (preferred) or fall back to waypoints
    let minX, maxX, minY, maxY
    if (mapData) {
      minX = mapData.originX
      minY = mapData.originY
      maxX = mapData.originX + mapData.width  * mapData.resolution
      maxY = mapData.originY + mapData.height * mapData.resolution
    } else if (fullPath?.length) {
      const xs = fullPath.map(p => p.pose.position.x)
      const ys = fullPath.map(p => p.pose.position.y)
      minX = Math.min(...xs); maxX = Math.max(...xs)
      minY = Math.min(...ys); maxY = Math.max(...ys)
    } else return

    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    // 95% of canvas, preserving aspect ratio
    const scale  = Math.min((W * 0.95) / rangeX, (H * 0.95) / rangeY)

    viewRef.current = {
      cx:    (minX + maxX) / 2,
      cy:    (minY + maxY) / 2,
      scale,
      W, H,
    }
  }, [mapData, fullPath])

  // ── world → canvas pixel (uses the frozen W/H stored in viewRef) ──
  const toC = (wx, wy) => {
    const v = viewRef.current
    if (!v) return { x: 0, y: 0 }
    return {
      x:  (wx - v.cx) * v.scale + v.W / 2,
      y: -(wy - v.cy) * v.scale + v.H / 2,
    }
  }

  // ── draw one frame ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Sync canvas pixel buffer to CSS layout size (only if changed)
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    if (W < 1 || H < 1) return
    let needFit = false
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width  = W
      canvas.height = H
      needFit = true   // size changed → refit
    }

    // First-fit or size-change fit
    if (!viewRef.current || needFit) {
      fitView()
      fittedRef.current = true
    }
    if (!viewRef.current) return   // still no data to fit to

    // Keep stored W/H in sync
    viewRef.current.W = W
    viewRef.current.H = H

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0a0e16'
    ctx.fillRect(0, 0, W, H)

    // ── Occupancy grid ──────────────────────────────────────────────────────
    if (tileRef.current && mapData) {
      const { width, height, resolution, originX, originY } = mapData
      // World corners of the map
      const tl = toC(originX,                         originY + height * resolution)
      const br = toC(originX + width * resolution,    originY)
      const pw = br.x - tl.x
      const ph = br.y - tl.y
      if (pw > 2 && ph > 2) {
        ctx.save()
        ctx.imageSmoothingEnabled = pw < width * 2   // smooth only when zoomed in
        ctx.drawImage(tileRef.current, tl.x, tl.y, pw, ph)
        ctx.restore()
        // Map border
        ctx.strokeStyle = 'rgba(0,200,255,0.2)'
        ctx.lineWidth   = 1
        ctx.strokeRect(tl.x, tl.y, pw, ph)
      }
    } else {
      // Dot grid fallback — no map yet
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      for (let x = 0; x < W; x += 40)
        for (let y = 0; y < H; y += 40)
          ctx.fillRect(x - 1, y - 1, 2, 2)
    }

    // ── Full path (dashed, dim) ─────────────────────────────────────────────
    if (fullPath?.length > 1) {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(200,0,10,0.3)'
      ctx.lineWidth   = 2
      ctx.setLineDash([6, 5])
      fullPath.forEach((p, i) => {
        const c = toC(p.pose.position.x, p.pose.position.y)
        i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)
      })
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ── Remaining path (solid red) ──────────────────────────────────────────
    if (remainingPath?.length > 1) {
      ctx.beginPath()
      ctx.strokeStyle = '#C8000A'
      ctx.lineWidth   = 2.5
      remainingPath.forEach((p, i) => {
        const c = toC(p.pose.position.x, p.pose.position.y)
        i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)
      })
      ctx.stroke()
    }

    // ── Waypoint dots ───────────────────────────────────────────────────────
    if (fullPath?.length) {
      const remSet = new Set(
        (remainingPath || []).map(p =>
          `${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`
        )
      )
      fullPath.forEach((p, i) => {
        const c     = toC(p.pose.position.x, p.pose.position.y)
        const key   = `${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`
        const ahead = remSet.has(key)
        ctx.beginPath()
        ctx.arc(c.x, c.y, ahead ? 5 : 4, 0, Math.PI * 2)
        ctx.fillStyle   = ahead ? '#C8000A' : 'rgba(200,0,10,0.35)'
        ctx.fill()
        ctx.strokeStyle = ahead ? '#fff' : 'rgba(200,0,10,0.5)'
        ctx.lineWidth   = 1.5; ctx.stroke()
        ctx.fillStyle   = ahead ? 'rgba(255,255,255,0.75)' : 'rgba(200,0,10,0.4)'
        ctx.font        = '8px monospace'; ctx.textAlign = 'center'
        ctx.fillText(i + 1, c.x, c.y - 8)
      })

      // Current target ring
      if (remainingPath?.length) {
        const tc = toC(remainingPath[0].pose.position.x, remainingPath[0].pose.position.y)
        ctx.beginPath(); ctx.arc(tc.x, tc.y, 13, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
        ;[[-1,0],[1,0],[0,-1],[0,1]].forEach(([dx,dy]) => {
          ctx.beginPath()
          ctx.moveTo(tc.x + dx * 10, tc.y + dy * 10)
          ctx.lineTo(tc.x + dx * 16, tc.y + dy * 16)
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke()
        })
      }
    }

    // ── Robot (AMCL pose) ───────────────────────────────────────────────────
    if (robotPos) {
      const rc  = toC(robotPos.x, robotPos.y)
      const yaw = robotPos.yaw ?? 0

      // Glow
      const grad = ctx.createRadialGradient(rc.x, rc.y, 3, rc.x, rc.y, 20)
      grad.addColorStop(0, 'rgba(0,210,255,0.3)'); grad.addColorStop(1, 'rgba(0,210,255,0)')
      ctx.beginPath(); ctx.arc(rc.x, rc.y, 20, 0, Math.PI * 2)
      ctx.fillStyle = grad; ctx.fill()

      // Body
      ctx.beginPath(); ctx.arc(rc.x, rc.y, 9, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,200,255,0.95)'; ctx.fill()
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke()

      // Heading arrow
      const ax = rc.x + Math.cos(yaw) * 18
      const ay = rc.y - Math.sin(yaw) * 18
      ctx.beginPath(); ctx.moveTo(rc.x, rc.y); ctx.lineTo(ax, ay)
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke()
      ctx.lineCap = 'butt'
      const ang = Math.atan2(rc.y - ay, ax - rc.x)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax - 7 * Math.cos(ang - 0.5), ay + 7 * Math.sin(ang - 0.5))
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax - 7 * Math.cos(ang + 0.5), ay + 7 * Math.sin(ang + 0.5))
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    }

    // ── Scale bar ───────────────────────────────────────────────────────────
    const scale   = viewRef.current?.scale || 1
    const scaleM  = Math.pow(10, Math.floor(Math.log10(150 / scale))) || 1
    const scalePx = scaleM * scale
    const sx = W - 20 - scalePx, sy = H - 14
    ctx.strokeStyle = 'rgba(232,232,232,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(sx, sy);    ctx.lineTo(sx + scalePx, sy)
    ctx.moveTo(sx, sy-3);  ctx.lineTo(sx, sy+3)
    ctx.moveTo(sx+scalePx, sy-3); ctx.lineTo(sx+scalePx, sy+3)
    ctx.stroke()
    ctx.fillStyle = 'rgba(232,232,232,0.4)'; ctx.font = '9px monospace'; ctx.textAlign = 'center'
    ctx.fillText(`${scaleM}m`, sx + scalePx / 2, sy - 6)

  }, [mapData, fullPath, remainingPath, robotPos, fitView])

  // ── rAF loop ──
  useEffect(() => {
    let raf
    const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  // ── Fit when map data changes ──
  useEffect(() => {
    fittedRef.current = false   // allow re-fit on new map
  }, [mapData])

  // ── Mouse wheel zoom ──
  const onWheel = useCallback((e) => {
    e.preventDefault()
    if (!viewRef.current) return
    const f = e.deltaY < 0 ? 1.12 : 0.88
    viewRef.current = { ...viewRef.current, scale: Math.max(4, Math.min(600, viewRef.current.scale * f)) }
  }, [])

  // ── Drag to pan ──
  const onMouseDown = useCallback((e) => {
    if (!viewRef.current) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: viewRef.current.cx, cy: viewRef.current.cy }
  }, [])
  const onMouseMove = useCallback((e) => {
    if (!dragRef.current || !viewRef.current) return
    const dx = (e.clientX - dragRef.current.sx) / viewRef.current.scale
    const dy = (e.clientY - dragRef.current.sy) / viewRef.current.scale
    viewRef.current = { ...viewRef.current, cx: dragRef.current.cx - dx, cy: dragRef.current.cy + dy }
  }, [])
  const onMouseUp = useCallback(() => { dragRef.current = null }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block cursor-crosshair"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Progress Bar
// ────────────────────────────────────────────────────────────────────────────
function ProgressBar({ segment, total }) {
  const pct = total > 0 ? Math.round((segment / total) * 100) : 0
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="font-mono text-[9px] tracking-widest uppercase text-white/30">Mission Progress</span>
        <span className="font-mono text-[10px] text-white/50">
          {segment}/{total}&nbsp;&nbsp;<span className="text-brand-red font-bold">{pct}%</span>
        </span>
      </div>
      <div className="w-full h-1.5 bg-white/5 rounded-sm overflow-hidden">
        <div className="h-full bg-brand-red transition-all duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {total > 0 && total <= 50 && (
        <div className="relative w-full h-2 mt-1">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className="absolute top-0 w-px h-1.5 transition-colors duration-200"
              style={{
                left:       `${((i + 1) / total) * 100}%`,
                background: i < segment ? C.red : 'rgba(255,255,255,0.1)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Control Button
// ────────────────────────────────────────────────────────────────────────────
function CtrlBtn({ label, icon, onClick, disabled, variant }) {
  const variants = {
    red:   { active: { bg: '#C8000A', border: '#C8000A', color: '#fff' },                                         dim: { bg: 'transparent', border: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.18)' } },
    amber: { active: { bg: 'transparent', border: 'rgba(245,158,11,0.5)',  color: '#f59e0b' },                    dim: { bg: 'transparent', border: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.18)' } },
    green: { active: { bg: 'transparent', border: 'rgba(34,197,94,0.45)', color: '#22c55e' },                    dim: { bg: 'transparent', border: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.18)' } },
  }
  const style = disabled ? variants[variant].dim : variants[variant].active
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full py-3 font-mono text-[10px] tracking-[0.25em] uppercase font-bold transition-all duration-150 flex items-center justify-center gap-2 border"
      style={{ ...style, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span>{icon}</span>{label}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────────────────
export default function WaypointFollower() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

  const [status,    setStatus]    = useState({ state: 'IDLE', route: '—', segment: 0, total: 0, dist_to_goal: 0 })
  const [routes,    setRoutes]    = useState([])
  const [fullPath,  setFullPath]  = useState([])
  const [remaining, setRemaining] = useState([])
  const [robotPos,  setRobotPos]  = useState(null)
  const [mapData,   setMapData]   = useState(null)   // decoded OccupancyGrid
  const [mapStatus, setMapStatus] = useState('waiting…')

  const [selectedRoute, setSelectedRoute] = useState('')
  const [dropOpen,      setDropOpen]      = useState(false)
  const [eventLog,      setEventLog]      = useState([{ t: Date.now(), msg: 'Interface ready', type: 'info' }])

  const addLog = useCallback((msg, type = 'info') =>
    setEventLog(prev => [{ t: Date.now(), msg, type }, ...prev].slice(0, 120)), [])

  // ── Subscribe ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')

    // Advertise publish topics
    advertise(TOPIC.START,     'std_msgs/msg/Empty')
    advertise(TOPIC.STOP,      'std_msgs/msg/Empty')
    advertise(TOPIC.RESUME,    'std_msgs/msg/Empty')
    advertise(TOPIC.SET_ROUTE, 'std_msgs/msg/String')

    const unsubs = [

      // ── /map — OccupancyGrid ───────────────────────────────────────────────
      // throttle_rate limits how often rosbridge forwards the message (ms)
      // TRANSIENT_LOCAL publisher — queue_length:0 + latch:true gets the
      // retained last message immediately without waiting for a new publish
      subscribe(TOPIC.MAP, 'nav_msgs/msg/OccupancyGrid', (msg) => {
        const decoded = decodeOccupancyGrid(msg)
        if (decoded) {
          setMapData(decoded)
          setMapStatus(`${msg.info.width}×${msg.info.height} @ ${msg.info.resolution.toFixed(3)}m/cell`)
          addLog(`Map received: ${msg.info.width}×${msg.info.height} cells, res=${msg.info.resolution.toFixed(3)}m`, 'info')
        }
      }, { queue_length: 0, latch: true }),

      // ── /amcl_pose — localized robot pose in MAP frame (from AMCL) ─────────
      // geometry_msgs/PoseWithCovarianceStamped
      // This is the correct topic to use — odom drifts, AMCL gives map-frame pose
      subscribe(TOPIC.AMCL, 'geometry_msgs/msg/PoseWithCovarianceStamped', (msg) => {
        const pos = msg.pose?.pose?.position
        const ori = msg.pose?.pose?.orientation
        if (!pos) return
        let yaw = 0
        if (ori) {
          const { x, y, z, w } = ori
          yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
        }
        setRobotPos({ x: pos.x, y: pos.y, yaw })
      }),

      // ── /odom — for smooth real-time robot movement between AMCL corrections ──
      // Odom drifts over time but is high-frequency; AMCL corrects the drift.
      // We use odom delta on top of last AMCL fix for smooth animation.
      subscribe('/odom', 'nav_msgs/msg/Odometry', (msg) => {
        const pos = msg.pose?.pose?.position
        const ori = msg.pose?.pose?.orientation
        if (!pos) return
        let yaw = 0
        if (ori) {
          const { x, y, z, w } = ori
          yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
        }
        // Only use odom if AMCL hasn't arrived yet (first fix)
        setRobotPos(prev => prev ? prev : { x: pos.x, y: pos.y, yaw })
      }),

      // ── route_follower/status ─────────────────────────────────────────────
      subscribe(TOPIC.STATUS, 'std_msgs/msg/String', (msg) => {
        try {
          const raw = typeof msg === 'string' ? msg : (msg?.data ?? '')
          const d   = JSON.parse(raw)
          setStatus(d)
          addLog(`[${d.state}] seg ${d.segment}/${d.total}  dist ${d.dist_to_goal ?? '?'}m`, 'status')
        } catch {}
      }, { queue_length: 0, latch: true }),

      // ── available_routes ──────────────────────────────────────────────────
      // queue_length:0 + latch:true = rosbridge immediately delivers the
      // last retained message (TRANSIENT_LOCAL) as soon as we subscribe
      subscribe(TOPIC.ROUTES, 'std_msgs/msg/String', (msg) => {
        try {
          // rosbridge v2 delivers std_msgs/String as { data: "..." }
          // but some versions may pass the raw string — handle both
          const raw  = typeof msg === 'string' ? msg : (msg?.data ?? '')
          const list = JSON.parse(raw)
          if (!Array.isArray(list)) return
          setRoutes(list)
          if (list.length) setSelectedRoute(r => r || list[0])
          addLog(`Routes: [${list.join(', ')}]`, 'info')
        } catch (e) {
          addLog(`Routes parse error: ${e.message}`, 'info')
        }
      }, { queue_length: 0, latch: true }),

      // ── full path ─────────────────────────────────────────────────────────
      subscribe(TOPIC.FULL_PATH, 'nav_msgs/msg/Path', (msg) => {
        setFullPath(msg.poses || [])
        addLog(`Full path: ${(msg.poses || []).length} pts`, 'info')
      }),

      // ── remaining path — drives live progress ─────────────────────────────
      subscribe(TOPIC.REMAINING, 'nav_msgs/msg/Path', (msg) => {
        const rem = msg.poses || []
        setRemaining(rem)
        // Derive segment from remaining count so progress updates continuously
        // even if status topic is slow
        setStatus(prev => {
          if (prev.total > 0 && rem.length <= prev.total) {
            const done = prev.total - rem.length
            return { ...prev, segment: done }
          }
          return prev
        })
      }),
    ]

    return () => unsubs.forEach(u => u?.())
  }, [ready, subscribe, advertise, addLog])

  // ── Publish ──────────────────────────────────────────────────────────────
  const sendStart  = () => { publish(TOPIC.START,  'std_msgs/msg/Empty',  {}); addLog('→ START',  'cmd') }
  const sendStop   = () => { publish(TOPIC.STOP,   'std_msgs/msg/Empty',  {}); addLog('→ STOP',   'cmd') }
  const sendResume = () => { publish(TOPIC.RESUME, 'std_msgs/msg/Empty',  {}); addLog('→ RESUME', 'cmd') }
  const sendRoute  = (name) => {
    publish(TOPIC.SET_ROUTE, 'std_msgs/msg/String', { data: name })
    setSelectedRoute(name); setDropOpen(false)
    addLog(`→ SET_ROUTE: "${name}"`, 'cmd')
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const sc        = STATE_COLOR[status.state] || STATE_COLOR.IDLE
  const isRunning  = status.state === 'RUNNING'
  const isStopped  = status.state === 'STOPPED'
  const doneCount  = Math.max(0, status.segment)
  const remCount   = Math.max(0, status.total - doneCount)
  const wsCol      = wsStatus === 'CONNECTED' ? '#22c55e' : wsStatus === 'CONNECTING' ? '#f59e0b' : '#ef4444'

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">Waypoint Follower</h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">Autonomous Route Execution · ROS2 Nav2</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor: `${wsCol}44`, background: `${wsCol}0d`, color: wsCol }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: wsCol }} />
            rosbridge&nbsp;·&nbsp;{wsStatus}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor: sc.border, background: sc.bg, color: sc.text }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.text }} />
            {status.state}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* MAP area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">

          {/* Map canvas */}
          <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
            {/* corner marks */}
            {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
              'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls,i) => (
              <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
            ))}

            {/* Map overlay info */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">OccupancyGrid</span>
              {status.route !== '—' && <>
                <span className="text-white/20 font-mono text-[9px]">·</span>
                <span className="font-mono text-white/40 text-[9px] tracking-widest">{status.route}</span>
              </>}
            </div>
            <div className="absolute top-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/20 text-[8px] tracking-widest">{mapStatus}</span>
            </div>

            {/* Zoom hint */}
            <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/15 text-[7px] tracking-widest uppercase">scroll = zoom · drag = pan</span>
            </div>

            {/* Legend */}
            <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
              {[
                { style: { borderTop: '2px dashed rgba(200,0,10,0.28)', width: 22 }, label: 'Completed' },
                { style: { borderTop: '2px solid #C8000A', width: 22 },              label: 'Remaining' },
                { style: { width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.8)', display:'inline-block' }, label: 'Robot' },
                { style: { width: 10, height: 10, borderRadius: '50%', border: '1px solid #C8000A', background: '#C8000A', display:'inline-block' }, label: 'Waypoint' },
              ].map(({ style, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div style={style} />
                  <span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
                </div>
              ))}
            </div>

            <MapCanvas
              mapData={mapData}
              fullPath={fullPath}
              remainingPath={remaining}
              robotPos={robotPos}
            />
          </div>

          {/* Progress bar */}
          <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
            <ProgressBar segment={status.segment} total={status.total} />
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="w-60 flex-shrink-0 flex flex-col border-l border-brand-border overflow-hidden">

          {/* Route selector */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2.5">Active Route</p>
            <div className="relative">
              <button
                onClick={() => !isRunning && setDropOpen(v => !v)}
                disabled={isRunning}
                className="w-full flex items-center justify-between px-3 py-2 border font-mono text-xs tracking-wide transition-all"
                style={{
                  borderColor: isRunning ? 'rgba(255,255,255,0.07)' : 'rgba(200,0,10,0.4)',
                  background:  isRunning ? 'rgba(255,255,255,0.02)' : 'rgba(200,0,10,0.06)',
                  color:       isRunning ? 'rgba(255,255,255,0.2)'  : '#e8e8e8',
                  cursor:      isRunning ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="truncate">{selectedRoute || 'Select route…'}</span>
                <span className="text-white/25 ml-2 text-[10px]">▾</span>
              </button>
              {dropOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setDropOpen(false)} />
                  <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-brand-card border border-brand-border shadow-2xl">
                    {routes.length === 0
                      ? <p className="font-mono text-white/20 text-[9px] p-3 tracking-widest uppercase">No routes</p>
                      : routes.map(r => (
                        <button key={r} onClick={() => sendRoute(r)}
                          className="w-full text-left px-3 py-2.5 font-mono text-xs tracking-wide hover:bg-brand-red/10 transition-colors flex items-center gap-2"
                          style={{ color: r === selectedRoute ? C.red : '#e8e8e8' }}>
                          {r === selectedRoute && <span className="text-brand-red text-[8px]">▶</span>}
                          {r}
                        </button>
                      ))
                    }
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Stats grid */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
            {[
              ['Total WPs',  status.total                                       ],
              ['Segment',    status.segment                                     ],
              ['Done',       doneCount                                          ],
              ['Remaining',  remCount                                           ],
              ['Dist Goal',  status.dist_to_goal != null ? `${status.dist_to_goal}m` : '—'],
              ['Route',      status.route                                       ],
            ].map(([label, value]) => (
              <div key={label} className="bg-brand-black border border-brand-border px-2.5 py-1.5">
                <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
                <p className="font-mono text-[11px] text-white/75 truncate">{String(value ?? '—')}</p>
              </div>
            ))}
          </div>

          {/* Robot live position */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">Robot · AMCL Pose</p>
            <div className="grid grid-cols-3 gap-1">
              {[
                ['X', robotPos ? robotPos.x.toFixed(2) : '—'],
                ['Y', robotPos ? robotPos.y.toFixed(2) : '—'],
                ['Yaw°', robotPos?.yaw != null ? (robotPos.yaw * 180 / Math.PI).toFixed(1) : '—'],
              ].map(([l, v]) => (
                <div key={l} className="bg-brand-black border border-brand-border px-1.5 py-1">
                  <p className="font-mono text-[7px] text-white/20 uppercase">{l}</p>
                  <p className="font-mono text-[10px] text-white/70">{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Control buttons */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-1">Mission Control</p>
            <CtrlBtn label="Start Mission" icon="▶" onClick={sendStart}  disabled={isRunning || !ready}  variant="red"   />
            <CtrlBtn label="Stop"          icon="■" onClick={sendStop}   disabled={!isRunning || !ready} variant="amber" />
            <CtrlBtn label="Resume"        icon="⏵" onClick={sendResume} disabled={!isStopped || !ready} variant="green" />
          </div>

          {/* Event log */}
          <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
              {eventLog.map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
                  <span className="font-mono text-[7px] text-white/15 flex-shrink-0 mt-px">
                    {new Date(e.t).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`font-mono text-[9px] leading-tight ${
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