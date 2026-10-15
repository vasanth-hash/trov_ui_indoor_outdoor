// import { useEffect, useRef, useState, useCallback } from 'react'
// import PTZControl from '../components/PTZControl'

// // ── Config ────────────────────────────────────────────────────────────────────
// const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'
// const VPS_HOST      = 'trovcamera.edgeforce.in'
// const WEBRTC_PORT   = 8889

// const SENSOR_TOPICS = {
//   LIDAR: '/sensor_health/lidar',
//   IMU:   '/sensor_health/imu',
//   GPS:   '/sensor_health/gps',
//   ALL:   '/sensor_health/all',
// }
// const RAW_TOPICS = {
//   IMU_RAW:      '/imu/data',
//   GPS_RAW:      '/mavros/global_position/global',
//   MAVROS_STATE: '/mavros/state',
// }
// const ARM_SERVICE = '/mavros/cmd/arming'
// const ARM_TYPE    = 'mavros_msgs/CommandBool'
// const CMD_VEL     = '/cmd_vel_safe'

// const CAMERAS = [
//   { id: 'driving',      label: 'Driving Camera',     sub: 'Forward View', stream: 'driving_camera',      hasPTZ: false },
//   { id: 'surveillance', label: 'Surveillance Camera', sub: 'Wide Field',   stream: 'surveillance_camera', hasPTZ: true  },
// ]

// // Teleop speed config
// const SPEED = { linear: 0.5, angular: 1.0 }
// const TELEOP_HZ = 10  // publish rate while held

// // ── useRosBridge ──────────────────────────────────────────────────────────────
// function useRosBridge(url) {
//   const wsRef       = useRef(null)
//   const subMap      = useRef({})
//   const advMap      = useRef({})
//   const idCounter   = useRef(0)
//   const pendingCalls = useRef({})
//   const [ready,    setReady]    = useState(false)
//   const [wsStatus, setWsStatus] = useState('CONNECTING')
//   const reconnRef  = useRef(null)

//   const connect = useCallback(() => {
//     if (wsRef.current?.readyState <= 1) return
//     const ws = new WebSocket(url)
//     wsRef.current = ws
//     setWsStatus('CONNECTING')
//     ws.onopen = () => {
//       setReady(true); setWsStatus('CONNECTED')
//       Object.entries(subMap.current).forEach(([id, { topic, type }]) =>
//         ws.send(JSON.stringify({ op: 'subscribe', id, topic, type })))
//       Object.entries(advMap.current).forEach(([topic, type]) =>
//         ws.send(JSON.stringify({ op: 'advertise', topic, type })))
//     }
//     ws.onclose = () => {
//       setReady(false); setWsStatus('DISCONNECTED')
//       reconnRef.current = setTimeout(connect, 3000)
//     }
//     ws.onerror = () => setWsStatus('ERROR')
//     ws.onmessage = (evt) => {
//       try {
//         const msg = JSON.parse(evt.data)
//         if (msg.op === 'publish')
//           Object.values(subMap.current)
//             .filter(s => s.topic === msg.topic)
//             .forEach(s => s.cb(msg.msg))
//         if (msg.op === 'service_response' && msg.id) {
//           const p = pendingCalls.current[msg.id]
//           if (p) { p(msg); delete pendingCalls.current[msg.id] }
//         }
//       } catch {}
//     }
//   }, [url])

//   useEffect(() => {
//     connect()
//     return () => { clearTimeout(reconnRef.current); wsRef.current?.close() }
//   }, [connect])

//   const subscribe = useCallback((topic, type, cb) => {
//     const id = `sub_${++idCounter.current}`
//     subMap.current[id] = { topic, type, cb }
//     if (wsRef.current?.readyState === WebSocket.OPEN)
//       wsRef.current.send(JSON.stringify({ op: 'subscribe', id, topic, type }))
//     return () => {
//       delete subMap.current[id]
//       wsRef.current?.readyState === WebSocket.OPEN &&
//         wsRef.current.send(JSON.stringify({ op: 'unsubscribe', id, topic }))
//     }
//   }, [])

//   const advertise = useCallback((topic, type) => {
//     advMap.current[topic] = type
//     if (wsRef.current?.readyState === WebSocket.OPEN)
//       wsRef.current.send(JSON.stringify({ op: 'advertise', topic, type }))
//   }, [])

//   const publish = useCallback((topic, type, msg) => {
//     const ws = wsRef.current
//     if (ws?.readyState !== WebSocket.OPEN) return
//     if (!advMap.current[topic]) {
//       ws.send(JSON.stringify({ op: 'advertise', topic, type }))
//       advMap.current[topic] = type
//     }
//     ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
//   }, [])

//   const callService = useCallback((service, type, args = {}) => {
//     return new Promise((resolve) => {
//       const id = `svc_${++idCounter.current}`
//       pendingCalls.current[id] = resolve
//       wsRef.current?.readyState === WebSocket.OPEN &&
//         wsRef.current.send(JSON.stringify({ op: 'call_service', id, service, type, args }))
//       setTimeout(() => {
//         if (pendingCalls.current[id]) {
//           delete pendingCalls.current[id]
//           resolve({ result: false, values: { success: false }, timeout: true })
//         }
//       }, 8000)
//     })
//   }, [])

//   return { ready, wsStatus, subscribe, advertise, publish, callService }
// }

// // ── useWhepStream ─────────────────────────────────────────────────────────────
// function useWhepStream(host, port, streamName, enabled = true) {
//   const videoRef = useRef(null)
//   const pcRef    = useRef(null)
//   const [status, setStatus] = useState('idle')

//   useEffect(() => {
//     if (!enabled) return
//     let cancelled = false

//     async function connect() {
//       setStatus('connecting')
//       if (pcRef.current) { pcRef.current.close(); pcRef.current = null }

//       const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
//       pcRef.current = pc
//       pc.addTransceiver('video', { direction: 'recvonly' })
//       pc.addTransceiver('audio', { direction: 'recvonly' })

//       pc.ontrack = (e) => {
//         if (cancelled) return
//         if (videoRef.current) { videoRef.current.srcObject = e.streams[0]; setStatus('live') }
//       }
//       pc.oniceconnectionstatechange = () => {
//         if (cancelled) return
//         const s = pc.iceConnectionState
//         if (s === 'failed' || s === 'disconnected' || s === 'closed') setStatus('disconnected')
//       }
//       pc.onconnectionstatechange = () => {
//         if (cancelled) return
//         if (pc.connectionState === 'failed') setStatus('error')
//       }

//       try {
//         const offer    = await pc.createOffer()
//         await pc.setLocalDescription(offer)
//         const res      = await fetch(`http://${host}:${port}/${streamName}/whep`, {
//           method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp,
//         })
//         if (!res.ok) throw new Error(`WHEP ${res.status}`)
//         const sdpAnswer = await res.text()
//         if (cancelled) return
//         await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
//       } catch (err) {
//         if (cancelled) return
//         setStatus('error')
//       }
//     }

//     connect()
//     return () => {
//       cancelled = true
//       if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
//       if (videoRef.current) videoRef.current.srcObject = null
//       setStatus('idle')
//     }
//   }, [host, port, streamName, enabled])

//   return { videoRef, status }
// }

// // ── CustomVelInput ────────────────────────────────────────────────────────────
// function CustomVelInput({ publish, ready }) {
//   const [lx, setLx] = useState('')
//   const [az, setAz] = useState('')

//   const handleSet = () => {
//     const linearX  = parseFloat(lx)
//     const angularZ = parseFloat(az)
//     if (isNaN(linearX) || isNaN(angularZ)) return
//     publish(CMD_VEL, 'geometry_msgs/Twist', {
//       linear:  { x: 0.7,  y: 0.0, z: 0.0 },
//       angular: { x: 0.0,      y: 0.0, z: 1.0 },
//     })
//   }

//   const inputStyle = {
//     width: '100%',
//     background: 'rgba(0,0,0,0.45)',
//     border: '1px solid rgba(255,255,255,0.1)',
//     color: '#ffffff',
//     fontFamily: 'monospace',
//     fontSize: 11,
//     padding: '5px 8px',
//     outline: 'none',
//     letterSpacing: '0.05em',
//     boxSizing: 'border-box',
//   }

//   return (
//     <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
//       <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase mb-2.5">
//         Custom Velocity · /cmd_vel
//       </p>
//       <div className="flex flex-col gap-2">
//         {/* Linear X */}
//         <div>
//           <p className="font-mono text-[7px] tracking-widest uppercase text-white/20 mb-1">Linear X (m/s)</p>
//           <input
//             type="number"
//             step="0.05"
//             placeholder="e.g.  0.30"
//             value={lx}
//             onChange={e => setLx(e.target.value)}
//             style={inputStyle}
//             onFocus={e => (e.target.style.borderColor = 'rgba(200,0,10,0.6)')}
//             onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
//           />
//         </div>
//         {/* Angular Z */}
//         <div>
//           <p className="font-mono text-[7px] tracking-widest uppercase text-white/20 mb-1">Angular Z (rad/s)</p>
//           <input
//             type="number"
//             step="0.05"
//             placeholder="e.g.  0.50"
//             value={az}
//             onChange={e => setAz(e.target.value)}
//             style={inputStyle}
//             onFocus={e => (e.target.style.borderColor = 'rgba(200,0,10,0.6)')}
//             onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
//           />
//         </div>
//         {/* Set button */}
//         <button
//           onClick={handleSet}
//           disabled={!ready || lx === '' || az === ''}
//           className="w-full py-2 font-mono text-[9px] tracking-widest uppercase font-bold border transition-all"
//           style={{
//             borderColor: !ready || lx === '' || az === '' ? 'rgba(255,255,255,0.08)' : '#C8000A',
//             background:  !ready || lx === '' || az === '' ? 'transparent' : 'rgba(200,0,10,0.15)',
//             color:       !ready || lx === '' || az === '' ? 'rgba(255,255,255,0.2)' : '#C8000A',
//             cursor:      !ready || lx === '' || az === '' ? 'not-allowed' : 'pointer',
//           }}
//         >
//           ⚡ Set Velocity
//         </button>
//       </div>
//     </div>
//   )
// }

// // ── TeleopPad ─────────────────────────────────────────────────────────────────
// function TeleopPad({ publish, ready }) {
//   const intervalRef = useRef(null)
//   const [active, setActive] = useState(null)

//   const stopAll = useCallback(() => {
//     if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
//     setActive(null)
//     if (ready) {
//       publish(CMD_VEL, 'geometry_msgs/Twist', {
//         linear:  { x: 0.0, y: 0.0, z: 0.0 },
//         angular: { x: 0.0, y: 0.0, z: 0.0 },
//       })
//     }
//   }, [publish, ready])

//   const startCmd = useCallback((lx, az, label) => {
//     stopAll()
//     if (!ready) return
//     setActive(label)
//     const send = () => publish(CMD_VEL, 'geometry_msgs/Twist', {
//       linear:  { x: lx,  y: 0.0, z: 0.0 },
//       angular: { x: 0.0, y: 0.0, z: az  },
//     })
//     send()
//     intervalRef.current = setInterval(send, 1000 / TELEOP_HZ)
//   }, [publish, ready, stopAll])

//   useEffect(() => () => stopAll(), [])

//   // Global mouse/touch release safety net
//   useEffect(() => {
//     const up = () => { if (intervalRef.current) stopAll() }
//     window.addEventListener('mouseup', up)
//     window.addEventListener('touchend', up)
//     return () => { window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up) }
//   }, [stopAll])

//   const btn = (label, lx, az, display) => {
//     const isActive = active === label
//     return (
//       <button
//         onMouseDown={(e) => { e.preventDefault(); startCmd(lx, az, label) }}
//         onMouseUp={stopAll}
//         onMouseLeave={() => { if (active === label) stopAll() }}
//         onTouchStart={(e) => { e.preventDefault(); startCmd(lx, az, label) }}
//         onTouchEnd={(e) => { e.preventDefault(); stopAll() }}
//         onTouchCancel={(e) => { e.preventDefault(); stopAll() }}
//         disabled={!ready}
//         className={`
//           select-none touch-none flex flex-col items-center justify-center gap-1
//           border transition-all duration-75 font-mono text-sm
//           ${isActive
//             ? 'border-brand-red bg-brand-red/20 text-brand-red shadow-[0_0_14px_rgba(200,0,10,0.35)]'
//             : 'border-brand-border bg-white/[0.03] text-white/40 hover:border-brand-red/50 hover:text-white/70'}
//           ${!ready ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
//         `}
//         style={{ width:54, height:54, borderRadius:6 }}
//       >
//         {display}
//         <span className="text-[7px] tracking-widest uppercase opacity-70">{label}</span>
//       </button>
//     )
//   }

//   return (
//     <div className="flex flex-col items-center gap-1.5 select-none">
//       <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-white/30 mb-1">Teleop · /cmd_vel</p>
//       {/* Forward */}
//       <div className="flex justify-center">
//         {btn('FWD',  SPEED.linear, 0, '▲')}
//       </div>
//       {/* Left · Stop · Right */}
//       <div className="flex gap-1.5 justify-center">
//         {btn('LEFT',  0,  SPEED.angular, '◀')}
//         <button
//           onClick={stopAll}
//           disabled={!ready}
//           className="border border-brand-border/60 bg-transparent text-white/20 hover:border-brand-red/50 hover:text-brand-red transition-all font-mono text-xs select-none"
//           style={{ width:54, height:54, borderRadius:6, cursor: ready ? 'pointer' : 'not-allowed' }}
//         >■</button>
//         {btn('RIGHT', '▶')}
//       </div>
//       {/* Back */}
//       <div className="flex justify-center">
//         {btn('BACK', '▼')}
//       </div>
//       <p className="font-mono text-[7px] text-white/15 tracking-widest uppercase mt-1">Hold to move · release to stop</p>
//     </div>
//   )
// }

// // ── CameraFeed ────────────────────────────────────────────────────────────────
// function CameraFeed({ camera, showPTZ = false, size = 50, onSizeChange }) {
//   const { videoRef, status } = useWhepStream(VPS_HOST, WEBRTC_PORT, camera.stream)
//   const [ptzVisible, setPtzVisible] = useState(false)
//   const isLive  = status === 'live'
//   const isError = status === 'error' || status === 'disconnected'

//   return (
//     <div
//       className="relative flex flex-col bg-brand-black border border-brand-border overflow-hidden"
//       style={{ height: `${size}%`, minHeight: 120, transition: 'height 0.2s ease' }}
//     >
//       {/* Label bar */}
//       <div className="flex items-center justify-between px-3 py-1.5 bg-brand-dark border-b border-brand-border flex-shrink-0">
//         <div className="flex items-center gap-2">
//           <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive ? 'bg-green-400 animate-pulse-dot' : 'bg-white/20'}`} />
//           <div>
//             <p className="font-sans font-bold text-white text-xs tracking-wide uppercase leading-none">{camera.label}</p>
//             <p className="font-mono text-white/30 text-[8px] tracking-widest uppercase leading-none mt-0.5">{camera.sub}</p>
//           </div>
//         </div>
//         <div className="flex items-center gap-1.5">
//           <span className="font-mono text-[8px] tracking-widest uppercase px-1.5 py-0.5 border border-white/10 text-white/25">
//             WebRTC
//           </span>
//           {camera.hasPTZ && showPTZ && (
//             <button
//               onClick={() => setPtzVisible(v => !v)}
//               className={`font-mono text-[8px] tracking-widest uppercase px-1.5 py-0.5 border transition-all
//                 ${ptzVisible ? 'border-brand-red text-brand-red bg-brand-red/10' : 'border-brand-red/30 text-brand-red/60 hover:border-brand-red/60'}`}
//             >PTZ</button>
//           )}
//           {/* Size slider */}
//           {onSizeChange && (
//             <input
//               type="range" min={25} max={75} value={size}
//               onChange={e => onSizeChange(Number(e.target.value))}
//               className="w-14 h-1 accent-brand-red cursor-pointer"
//               title="Resize feed"
//             />
//           )}
//           <span className={`font-mono text-[9px] tracking-widest uppercase ${isLive ? 'text-green-400' : 'text-white/20'}`}>
//             {isLive ? 'LIVE' : status.toUpperCase()}
//           </span>
//         </div>
//       </div>

//       {/* Feed */}
//       <div className="flex-1 relative bg-black min-h-0">
//         {/* scanline */}
//         <div className="absolute inset-0 scan-line z-10 pointer-events-none" />
//         {/* corners */}
//         <div className="absolute top-2 left-2 w-4 h-4 border-t border-l border-brand-red/40 z-20 pointer-events-none" />
//         <div className="absolute top-2 right-2 w-4 h-4 border-t border-r border-brand-red/40 z-20 pointer-events-none" />
//         <div className="absolute bottom-2 left-2 w-4 h-4 border-b border-l border-brand-red/40 z-20 pointer-events-none" />
//         <div className="absolute bottom-2 right-2 w-4 h-4 border-b border-r border-brand-red/40 z-20 pointer-events-none" />

//         {/* error */}
//         {isError && (
//           <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20">
//             <span className="text-brand-red/40 text-2xl">⚠</span>
//             <p className="font-mono text-white/25 text-[9px] tracking-widest uppercase">Feed Unavailable</p>
//           </div>
//         )}
//         {/* connecting */}
//         {!isLive && !isError && (
//           <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20">
//             <div className="w-5 h-5 border border-brand-red/30 border-t-brand-red rounded-full animate-spin" />
//             <p className="font-mono text-white/20 text-[9px] tracking-widest uppercase">Connecting…</p>
//           </div>
//         )}

//         {/* Video */}
//         <video ref={videoRef} autoPlay playsInline muted
//           className="absolute inset-0 w-full h-full object-contain"
//           style={{ display: isLive ? 'block' : 'none' }}
//         />

//         {/* PTZ overlay — bottom-right corner of the feed */}
//         {camera.hasPTZ && showPTZ && ptzVisible && (
//           <div className="absolute bottom-3 right-3 z-30 animate-fade-in">
//             <PTZControl />
//           </div>
//         )}
//       </div>
//     </div>
//   )
// }


// function SensorCard({ label, sublabel, healthy, lastSeen, icon, detail }) {
//   const borderColor =
//     healthy === true  ? 'rgba(5, 243, 25, 0.25)' :
//     healthy === false ? '#C8000A' :
//     'rgba(255,255,255,0.08)'

//   const accentBg =
//     healthy === true  ? 'rgba(255,255,255,0.04)' :
//     healthy === false ? 'rgba(200,0,10,0.06)' :
//     'transparent'

//   const badgeColor =
//     healthy === true  ? '#07ec13' :
//     healthy === false ? '#C8000A' :
//     'rgba(255,255,255,0.3)'

//   const badgeBorder =
//     healthy === true  ? 'rgba(7, 248, 108, 0.25)' :
//     healthy === false ? 'rgba(200,0,10,0.5)' :
//     'rgba(255,255,255,0.1)'

//   const badgeBg =
//     healthy === true  ? 'rgba(255,255,255,0.06)' :
//     healthy === false ? 'rgba(200,0,10,0.1)' :
//     'rgba(255,255,255,0.03)'

//   const statusText =
//     healthy === true ? 'HEALTHY' : healthy === false ? 'FAULT' : 'UNKNOWN'

//   return (
//     <div style={{
//       border: `1px solid ${borderColor}`,
//       background: accentBg,
//       transition: 'border-color 0.4s, background 0.4s',
//       display: 'flex',
//       flexDirection: 'column',
//       overflow: 'visible',   /* no clipping */
//       width: '100%',
//       boxSizing: 'border-box',
//     }}>
//       {/* top accent line */}
//       <div style={{
//         height: 2,
//         background: healthy === true ? '#0aeb0a' : healthy === false ? '#C8000A' : 'rgba(255,255,255,0.08)',
//         transition: 'background 0.4s',
//         flexShrink: 0,
//       }} />

//       {/* header */}
//       <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'12px 16px 8px', gap:12, flexWrap:'wrap' }}>
//         <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
//           {/* icon circle */}
//           <div style={{
//             width:36, height:36, borderRadius:4, flexShrink:0,
//             border: `1px solid ${borderColor}`,
//             display:'flex', alignItems:'center', justifyContent:'center',
//             background: 'rgba(255,255,255,0.03)',
//             fontSize:16,
//           }}>
//             {icon}
//           </div>
//           <div style={{ minWidth:0 }}>
//             <p style={{
//               fontFamily:'monospace', fontWeight:700, fontSize:13,
//               color:'#ffffff', letterSpacing:'0.12em', textTransform:'uppercase',
//               lineHeight:1, margin:0,
//             }}>{label}</p>
//             <p style={{
//               fontFamily:'monospace', fontSize:9, color:'rgba(255,255,255,0.35)',
//               letterSpacing:'0.1em', textTransform:'uppercase', marginTop:3,
//               wordBreak:'break-all',
//             }}>{sublabel}</p>
//           </div>
//         </div>

//         {/* badge */}
//         <div style={{
//           display:'flex', alignItems:'center', gap:6, flexShrink:0,
//           padding:'4px 10px', border:`1px solid ${badgeBorder}`,
//           background: badgeBg, color: badgeColor,
//           fontFamily:'monospace', fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase',
//         }}>
//           <span style={{
//             width:6, height:6, borderRadius:'50%',
//             background: badgeColor,
//             flexShrink:0,
//             boxShadow: healthy === false ? `0 0 6px #C8000A` : 'none',
//           }} />
//           {statusText}
//         </div>
//       </div>

//       {/* detail grid */}
//       {detail && (
//         <div style={{ padding:'0 16px 12px' }}>
//           <div style={{
//             background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.07)',
//             padding:'8px 12px', display:'flex', flexDirection:'column', gap:4,
//           }}>
//             {Object.entries(detail).map(([k, v]) => (
//               <div key={k} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
//                 <span style={{ fontFamily:'monospace', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(255,255,255,0.25)', flexShrink:0 }}>{k}</span>
//                 <span style={{ fontFamily:'monospace', fontSize:10, color:'rgba(255,255,255,0.65)', textAlign:'right', wordBreak:'break-all' }}>{String(v ?? '—')}</span>
//               </div>
//             ))}
//           </div>
//         </div>
//       )}

//       {/* last seen */}
//       <div style={{ padding:'0 16px 12px', display:'flex', alignItems:'center', gap:8 }}>
//         <span style={{ fontFamily:'monospace', fontSize:8, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,0.2)' }}>Last msg:</span>
//         <span style={{ fontFamily:'monospace', fontSize:9, color:'rgba(255,255,255,0.4)' }}>{lastSeen || 'Never'}</span>
//       </div>
//     </div>
//   )
// }

// // ── HealthRing ────────────────────────────────────────────────────────────────
// function HealthRing({ sensors }) {
//   const total   = sensors.length
//   const healthy = sensors.filter(s => s.healthy === true).length
//   const pct     = total > 0 ? (healthy / total) * 100 : 0
//   const r = 30, circ = 2 * Math.PI * r, dash = (pct / 100) * circ
//   const color = pct === 100 ? '#ffffff' : '#C8000A'

//   return (
//     <div className="flex flex-col items-center gap-2">
//       <div className="relative" style={{ width:76, height:76 }}>
//         <svg style={{ width:'100%', height:'100%', transform:'rotate(-90deg)' }} viewBox="0 0 68 68">
//           <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
//           <circle cx="34" cy="34" r={r} fill="none" stroke={color} strokeWidth="5"
//             strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
//             style={{ transition:'stroke-dasharray 0.6s ease' }} />
//         </svg>
//         <div className="absolute inset-0 flex flex-col items-center justify-center">
//           <span className="font-mono font-bold text-base leading-none" style={{ color }}>{healthy}/{total}</span>
//           <span className="font-mono text-[7px] tracking-widest uppercase text-white/25 mt-0.5">online</span>
//         </div>
//       </div>
//       <p className="font-mono font-bold text-[10px] tracking-widest uppercase" style={{ color }}>
//         {pct === 100 ? 'ALL GO' : pct > 50 ? 'DEGRADED' : 'CRITICAL'}
//       </p>
//     </div>
//   )
// }

// // ── Main Page ─────────────────────────────────────────────────────────────────
// export default function NavigationPage() {
//   const { ready, wsStatus, subscribe, advertise, publish, callService } = useRosBridge(ROSBRIDGE_URL)

//   // sensor health
//   const [sensorHealth, setSensorHealth] = useState({ lidar: null, imu: null, gps: null, all: null })
//   const [imuData,  setImuData]  = useState(null)
//   const [gpsData,  setGpsData]  = useState(null)
//   const [mavState, setMavState] = useState(null)
//   const [lastSeen, setLastSeen] = useState({ lidar: null, imu: null, gps: null })

//   // arm state
//   const [armed,   setArmed]   = useState(false)
//   const [armBusy, setArmBusy] = useState(false)
//   const [armConfirm, setArmConfirm] = useState(false)

//   // manual mode
//   const [manualMode, setManualMode] = useState(false)

//   // camera split size (top camera %)
//   const [splitPct, setSplitPct] = useState(50)

//   // event log
//   const [eventLog, setEventLog] = useState([{ t: Date.now(), msg: 'System monitoring initialised', type: 'info' }])
//   const addLog = useCallback((msg, type = 'info') =>
//     setEventLog(p => [{ t: Date.now(), msg, type }, ...p].slice(0, 80)), [])

//   const ts = () => new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

//   useEffect(() => {
//     if (!ready) return
//     addLog('rosbridge connected', 'ok')
//     advertise(CMD_VEL, 'geometry_msgs/Twist')

//     const unsubs = [
//       subscribe(SENSOR_TOPICS.LIDAR, 'std_msgs/Bool', (msg) => {
//         setSensorHealth(p => ({ ...p, lidar: msg.data }))
//         if (msg.data) setLastSeen(p => ({ ...p, lidar: ts() }))
//       }),
//       subscribe(SENSOR_TOPICS.IMU, 'std_msgs/Bool', (msg) => {
//         setSensorHealth(p => ({ ...p, imu: msg.data }))
//         if (msg.data) setLastSeen(p => ({ ...p, imu: ts() }))
//       }),
//       subscribe(SENSOR_TOPICS.GPS, 'std_msgs/Bool', (msg) => {
//         setSensorHealth(p => ({ ...p, gps: msg.data }))
//         if (msg.data) setLastSeen(p => ({ ...p, gps: ts() }))
//       }),
//       subscribe(SENSOR_TOPICS.ALL, 'std_msgs/Bool', (msg) =>
//         setSensorHealth(p => ({ ...p, all: msg.data }))),
//       subscribe(RAW_TOPICS.IMU_RAW, 'sensor_msgs/Imu', (msg) => {
//         setImuData(msg); setLastSeen(p => ({ ...p, imu: ts() }))
//       }),
//       subscribe(RAW_TOPICS.GPS_RAW, 'sensor_msgs/NavSatFix', (msg) => {
//         setGpsData(msg); setLastSeen(p => ({ ...p, gps: ts() }))
//       }),
//       subscribe(RAW_TOPICS.MAVROS_STATE, 'mavros_msgs/State', (msg) => {
//         setMavState(msg); setArmed(msg.armed || false)
//         addLog(`Mavros: mode=${msg.mode} armed=${msg.armed ? 'YES' : 'no'}`, 'status')
//       }),
//     ]
//     return () => unsubs.forEach(u => u?.())
//   }, [ready])

//   const sendArm = useCallback(async (value) => {
//     setArmBusy(true); setArmConfirm(false)
//     addLog(`→ ${value ? 'ARM' : 'DISARM'} command sent`, 'cmd')
//     try {
//       const res = await callService(ARM_SERVICE, ARM_TYPE, { value })
//       if (res.timeout) addLog('✗ Service call timed out', 'error')
//       else if (res.values?.success === false || res.result === false)
//         addLog(`✗ ${value ? 'ARM' : 'DISARM'} rejected by FCU`, 'error')
//       else { addLog(`✓ ${value ? 'ARMED' : 'DISARMED'} successfully`, 'ok'); setArmed(value) }
//     } catch (e) { addLog(`✗ Service error: ${e.message}`, 'error') }
//     setArmBusy(false)
//   }, [callService, addLog])

//   // derived
//   const wsCol = wsStatus === 'CONNECTED' ? '#0cf063' : '#C8000A'
//   const sensors = [
//     { key: 'lidar', healthy: sensorHealth.lidar },
//     { key: 'imu',   healthy: sensorHealth.imu   },
//     { key: 'gps',   healthy: sensorHealth.gps   },
//   ]

//   const imuDetail = imuData ? {
//     'Lin X': `${imuData.linear_acceleration?.x?.toFixed(3) ?? '—'} m/s²`,
//     'Lin Y': `${imuData.linear_acceleration?.y?.toFixed(3) ?? '—'} m/s²`,
//     'Lin Z': `${imuData.linear_acceleration?.z?.toFixed(3) ?? '—'} m/s²`,
//     'Ang Z': `${imuData.angular_velocity?.z?.toFixed(3) ?? '—'} rad/s`,
//   } : { 'Topic': '/imu/data', 'Timeout': '0.5 s', 'Health': '/sensor_health/imu' }

//   const gpsDetail = gpsData ? {
//     'Lat':  `${gpsData.latitude?.toFixed(6) ?? '—'}°`,
//     'Lon':  `${gpsData.longitude?.toFixed(6) ?? '—'}°`,
//     'Alt':  `${gpsData.altitude?.toFixed(2) ?? '—'} m`,
//     'Fix':  gpsData.status?.status === 0 ? 'GPS FIX' : gpsData.status?.status > 0 ? 'DGPS' : 'NO FIX',
//   } : { 'Topic': '/mavros/global_position/global', 'Timeout': '1.0 s', 'Health': '/sensor_health/gps' }

//   return (
//     <div className="h-full flex flex-col bg-brand-black overflow-hidden">

//       {/* ══ HEADER ══ */}
//       <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-brand-border flex-wrap gap-2">
//         {/* Title */}
//         <div className="flex items-center gap-3">
//           <div className="w-0.5 h-5 bg-brand-red flex-shrink-0" />
//           <div>
//             <h1 className="font-mono font-bold text-white text-sm tracking-widest uppercase leading-none">System Health</h1>
//             <p className="font-mono text-white/30 text-[8px] tracking-[0.2em] uppercase mt-1">Sensor Monitor · Mavros · Teleop</p>
//           </div>
//         </div>

//         {/* Header action buttons */}
//         <div className="flex items-center gap-2 flex-wrap">

//           {/* rosbridge badge */}
//           <div className="flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[8px] tracking-widest uppercase"
//             style={{ borderColor:`${wsCol}44`, background:`${wsCol}0d`, color:wsCol }}>
//             <span className="w-1.5 h-1.5 rounded-full" style={{ background:wsCol }} />
//             {wsStatus}
//           </div>

//           {/* Overall health badge */}
//           <div className={`flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[8px] tracking-widest uppercase
//             ${sensorHealth.all === true ? 'border-white/20 text-white' : sensorHealth.all === false ? 'border-brand-red/50 text-brand-red' : 'border-white/10 text-white/30'}`}>
//             <span className={`w-1.5 h-1.5 rounded-full ${sensorHealth.all === true ? 'bg-white animate-pulse-dot' : sensorHealth.all === false ? 'bg-brand-red' : 'bg-white/20'}`} />
//             {sensorHealth.all === true ? 'ALL HEALTHY' : sensorHealth.all === false ? 'FAULT' : 'MONITORING'}
//           </div>

//           {/* ARM / DISARM button */}
//           {!armed ? (
//             <>
//               {armConfirm && (
//                 <span className="font-mono text-[8px] text-brand-red tracking-widest animate-pulse">⚠ Click again</span>
//               )}
//               <button
//                 onClick={() => { if (!armConfirm) { setArmConfirm(true) } else { sendArm(true) } }}
//                 disabled={!ready || armBusy}
//                 className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[9px] tracking-widest uppercase font-bold border transition-all"
//                 style={{
//                   borderColor: !ready || armBusy ? 'rgba(255,255,255,0.1)' : armConfirm ? '#C8000A' : 'rgba(200,0,10,0.5)',
//                   background:  !ready || armBusy ? 'transparent' : armConfirm ? 'rgba(200,0,10,0.2)' : '#C8000A',
//                   color:       !ready || armBusy ? 'rgba(255,255,255,0.2)' : '#ffffff',
//                   cursor:      !ready || armBusy ? 'not-allowed' : 'pointer',
//                 }}
//               >
//                 {armBusy ? <span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" /> : '⚡'}
//                 {armBusy ? 'Arming…' : armConfirm ? 'Confirm ARM' : 'ARM'}
//               </button>
//             </>
//           ) : (
//             <button
//               onClick={() => sendArm(false)}
//               disabled={!ready || armBusy}
//               className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[9px] tracking-widest uppercase font-bold border transition-all"
//               style={{
//                 borderColor: !ready || armBusy ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)',
//                 background:  !ready || armBusy ? 'transparent' : 'rgba(255,255,255,0.06)',
//                 color:       !ready || armBusy ? 'rgba(255,255,255,0.2)' : '#ffffff',
//                 cursor:      !ready || armBusy ? 'not-allowed' : 'pointer',
//               }}
//             >
//               {armBusy ? <span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" /> : '■'}
//               {armBusy ? 'Disarming…' : 'DISARM'}
//             </button>
//           )}

//           {/* Armed indicator dot */}
//           {armed && (
//             <div className="flex items-center gap-1.5 px-2.5 py-1 border border-brand-red/50 bg-brand-red/10">
//               <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse-dot" />
//               <span className="font-mono text-[9px] tracking-widest uppercase text-brand-red font-bold">ARMED</span>
//             </div>
//           )}

//           {/* Manual mode toggle */}
//           <button
//             onClick={() => setManualMode(v => !v)}
//             className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[9px] tracking-widest uppercase font-bold border transition-all"
//             style={{
//               borderColor: manualMode ? '#C8000A' : 'rgba(255,255,255,0.15)',
//               background:  manualMode ? 'rgba(200,0,10,0.12)' : 'rgba(255,255,255,0.03)',
//               color:       manualMode ? '#C8000A' : 'rgba(255,255,255,0.5)',
//             }}
//           >
//             <span>{manualMode ? '●' : '○'}</span>
//             Manual Mode
//           </button>
//         </div>
//       </div>

//       {/* ══ BODY ══ */}
//       {manualMode ? (

//         /* ── MANUAL MODE: dual cameras + teleop ── */
//         <div className="flex-1 flex overflow-hidden min-h-0">

//           {/* Left: stacked camera feeds */}
//           <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-0 overflow-hidden">
//             {CAMERAS.map((cam, idx) => {
//               const isFirst   = idx === 0
//               const feedSize  = isFirst ? splitPct : (100 - splitPct)
//               const otherSize = isFirst ? (100 - splitPct) : splitPct

//               return (
//                 <div key={cam.id} className="flex flex-col" style={{ flex: feedSize, minHeight: 0 }}>
//                   <CameraFeed
//                     camera={cam}
//                     showPTZ={true}
//                     size={100}
//                     onSizeChange={isFirst ? setSplitPct : (v) => setSplitPct(100 - v)}
//                   />
//                   {/* Resize handle between feeds */}
//                   {isFirst && (
//                     <div
//                       className="flex-shrink-0 flex items-center justify-center cursor-row-resize bg-brand-dark border-y border-brand-border"
//                       style={{ height:10 }}
//                       onMouseDown={(e) => {
//                         const startY = e.clientY
//                         const startPct = splitPct
//                         const container = e.currentTarget.closest('.flex-col.min-h-0')?.parentElement
//                         const totalH = container?.offsetHeight || 600
//                         const onMove = (me) => {
//                           const delta = ((me.clientY - startY) / totalH) * 100
//                           setSplitPct(Math.max(20, Math.min(80, startPct + delta)))
//                         }
//                         const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
//                         window.addEventListener('mousemove', onMove)
//                         window.addEventListener('mouseup', onUp)
//                       }}
//                     >
//                       <div className="flex gap-0.5">
//                         {[0,1,2,3,4].map(i => <div key={i} className="w-1 h-0.5 bg-white/20" />)}
//                       </div>
//                     </div>
//                   )}
//                 </div>
//               )
//             })}
//           </div>

//           {/* Right: teleop + log */}
//           <div className="w-56 flex-shrink-0 flex flex-col border-l border-brand-border overflow-y-auto">

//             {/* ARM status in manual panel */}
//             <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
//               <div className={`flex items-center gap-2.5 px-3 py-2.5 border
//                 ${armed ? 'border-brand-red/50 bg-brand-red/8' : 'border-white/10 bg-white/[0.02]'}`}>
//                 <span className={`w-2 h-2 rounded-full flex-shrink-0 ${armed ? 'bg-brand-red animate-pulse-dot' : 'bg-white/30'}`} />
//                 <div>
//                   <p className={`font-mono font-bold text-xs tracking-widest uppercase ${armed ? 'text-brand-red' : 'text-white/60'}`}>
//                     {armed ? 'ARMED' : 'DISARMED'}
//                   </p>
//                   <p className="font-mono text-[7px] tracking-widest text-white/25 uppercase mt-0.5">
//                     {armed ? 'Motors active' : 'Safe · motors off'}
//                   </p>
//                 </div>
//               </div>
//             </div>

//             {/* T-ROV image */}
//             <div className="flex-shrink-0 border-b border-brand-border relative overflow-hidden">
//               <img src="/trov.png" alt="T-ROV"
//                 className="w-full object-contain"
//                 style={{
//                   maxHeight:110,
//                   filter: armed
//                     ? 'brightness(0.95) drop-shadow(0 0 10px rgba(200,0,10,0.5))'
//                     : 'brightness(0.45) grayscale(0.3)',
//                   transition:'filter 0.5s',
//                   display:'block',
//                 }}
//                 onError={e => { e.target.style.display='none' }}
//               />
//               {armed && (
//                 <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
//                   <span className="font-mono font-black text-brand-red/20 text-2xl tracking-widest">ARMED</span>
//                 </div>
//               )}
//             </div>

//             {/* Teleop pad */}
//             <div className="flex-shrink-0 px-4 py-4 border-b border-brand-border flex flex-col items-center">
//               <TeleopPad publish={publish} ready={ready} />
//             </div>

//             {/* Custom velocity input */}
//             <CustomVelInput publish={publish} ready={ready} />

//             {/* Mavros state mini */}
//             <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
//               <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase mb-2">Mavros</p>
//               <div className="grid grid-cols-2 gap-1.5">
//                 {[
//                   ['Mode',  mavState?.mode  || '—'],
//                   ['Guided', mavState?.guided ? 'YES' : 'NO'],
//                 ].map(([l, v]) => (
//                   <div key={l} className="bg-brand-black border border-brand-border px-2 py-1.5">
//                     <p className="font-mono text-[7px] text-white/20 uppercase">{l}</p>
//                     <p className="font-mono text-[10px] text-white/70">{v}</p>
//                   </div>
//                 ))}
//               </div>
//             </div>

//             {/* Event log */}
//             <div className="flex-1 flex flex-col min-h-0 px-4 py-3 overflow-hidden">
//               <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase mb-2 flex-shrink-0">Events</p>
//               <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
//                 {eventLog.map((e, i) => (
//                   <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
//                     <span className="font-mono text-[7px] text-white/15 flex-shrink-0">
//                       {new Date(e.t).toLocaleTimeString('en', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })}
//                     </span>
//                     <span className={`font-mono text-[8px] leading-tight break-all ${
//                       e.type === 'cmd'    ? 'text-brand-red'  :
//                       e.type === 'ok'     ? 'text-white'      :
//                       e.type === 'error'  ? 'text-brand-red'  :
//                       e.type === 'status' ? 'text-white/60'   : 'text-white/30'
//                     }`}>{e.msg}</span>
//                   </div>
//                 ))}
//               </div>
//             </div>
//           </div>
//         </div>

//       ) : (

//         /* ── MONITOR MODE: sensor health + arm control ── */
//         <div className="flex-1 overflow-auto p-4" style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 220px', gap:16, alignContent:'start' }}>

//           {/* Left col */}
//           <div style={{ display:'flex', flexDirection:'column', gap:16, minWidth:0 }}>

//             {/* Ring + mavros */}
//             <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
//               <div className="flex-shrink-0 bg-brand-card border border-brand-border p-5 flex items-center justify-center">
//                 <HealthRing sensors={sensors} />
//               </div>
//               <div className="flex-1 bg-brand-card border border-brand-border p-4" style={{ minWidth:160 }}>
//                 <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase mb-3">Mavros · /mavros/state</p>
//                 <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
//                   {[
//                     ['Connected',   mavState?.connected    ? 'YES' : 'NO'],
//                     ['Armed',       mavState?.armed        ? 'YES' : 'NO'],
//                     ['Mode',        mavState?.mode         || '—'],
//                     ['Guided',      mavState?.guided       ? 'YES' : 'NO'],
//                     ['Manual In',   mavState?.manual_input ? 'YES' : 'NO'],
//                     ['Sys Status',  mavState?.system_status ?? '—'],
//                   ].map(([label, value]) => (
//                     <div key={label} className="bg-brand-black border border-brand-border px-2.5 py-2">
//                       <p className="font-mono text-[7px] tracking-widest uppercase text-white/20 mb-0.5">{label}</p>
//                       <p className="font-mono text-[11px] font-bold"
//                         style={{ color: value === 'YES' ? '#ffffff' : value === 'NO' ? '#C8000A' : 'rgba(255,255,255,0.65)' }}>
//                         {String(value)}
//                       </p>
//                     </div>
//                   ))}
//                 </div>
//               </div>
//             </div>

//             <SensorCard label="LiDAR" sublabel="/points · PointCloud2"
//               healthy={sensorHealth.lidar} lastSeen={lastSeen.lidar} icon="⬡"
//               detail={{ 'Topic':'/points','Timeout':'1.0 s','Health':'/sensor_health/lidar' }} />
//             <SensorCard label="IMU" sublabel="/imu/data · sensor_msgs/Imu"
//               healthy={sensorHealth.imu} lastSeen={lastSeen.imu} icon="◎" detail={imuDetail} />
//             <SensorCard label="GPS" sublabel="/mavros/global_position/global"
//               healthy={sensorHealth.gps} lastSeen={lastSeen.gps} icon="◈" detail={gpsDetail} />
//           </div>

//           {/* Right col */}
//           <div style={{ display:'flex', flexDirection:'column', gap:16, minWidth:0 }}>

//             {/* Arm panel */}
//             <div className="bg-brand-card border border-brand-border p-4 flex flex-col gap-3">
//               <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase">Arm Control</p>

//               <div className={`flex items-center gap-2.5 px-3 py-2.5 border
//                 ${armed ? 'border-brand-red/50 bg-brand-red/8' : 'border-white/10 bg-white/[0.02]'}`}>
//                 <span className={`w-2 h-2 rounded-full flex-shrink-0 ${armed ? 'bg-brand-red animate-pulse-dot' : 'bg-white/40'}`} />
//                 <div>
//                   <p className={`font-mono font-bold text-sm tracking-widest uppercase ${armed ? 'text-brand-red' : 'text-white'}`}>
//                     {armed ? 'ARMED' : 'DISARMED'}
//                   </p>
//                   <p className="font-mono text-[7px] text-white/25 uppercase tracking-widest mt-0.5">
//                     {armed ? 'Motors active · caution' : 'Safe · motors off'}
//                   </p>
//                 </div>
//               </div>

//               <div className="relative border border-brand-border overflow-hidden">
//                 <img src="/trov.png" alt="T-ROV"
//                   style={{ width:'100%', display:'block', maxHeight:120, objectFit:'contain',
//                     filter: armed ? 'brightness(0.95) drop-shadow(0 0 10px rgba(200,0,10,0.5))' : 'brightness(0.45) grayscale(0.3)',
//                     transition:'filter 0.5s' }}
//                   onError={e => { e.target.style.display='none' }}
//                 />
//                 {armed && (
//                   <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
//                     <span style={{ fontFamily:'monospace', fontWeight:900, fontSize:22, color:'rgba(200,0,10,0.25)', letterSpacing:'0.3em' }}>ARMED</span>
//                   </div>
//                 )}
//               </div>

//               {armConfirm && !armed && (
//                 <div className="border border-brand-red/30 bg-brand-red/10 px-3 py-2 font-mono text-[9px] text-brand-red tracking-wide">
//                   ⚠ Motors will engage. Click ARM again.
//                 </div>
//               )}

//               {!armed ? (
//                 <button onClick={() => { if (!armConfirm) setArmConfirm(true); else sendArm(true) }}
//                   disabled={!ready || armBusy}
//                   className="w-full py-2.5 font-mono text-[9px] tracking-widest uppercase font-bold border transition-all flex items-center justify-center gap-2"
//                   style={{
//                     borderColor: !ready || armBusy ? 'rgba(255,255,255,0.08)' : '#C8000A',
//                     background:  !ready || armBusy ? 'transparent' : armConfirm ? 'rgba(200,0,10,0.2)' : '#C8000A',
//                     color:       !ready || armBusy ? 'rgba(255,255,255,0.2)' : '#ffffff',
//                     cursor:      !ready || armBusy ? 'not-allowed' : 'pointer',
//                   }}>
//                   {armBusy ? <><span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" /> Arming…</> : armConfirm ? '⚠ Confirm ARM' : '⚡ ARM Vehicle'}
//                 </button>
//               ) : (
//                 <button onClick={() => sendArm(false)} disabled={!ready || armBusy}
//                   className="w-full py-2.5 font-mono text-[9px] tracking-widest uppercase font-bold border transition-all flex items-center justify-center gap-2"
//                   style={{
//                     borderColor: !ready || armBusy ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.35)',
//                     background: 'transparent',
//                     color: !ready || armBusy ? 'rgba(255,255,255,0.2)' : '#ffffff',
//                     cursor: !ready || armBusy ? 'not-allowed' : 'pointer',
//                   }}>
//                   {armBusy ? <><span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" /> Disarming…</> : '■ DISARM Vehicle'}
//                 </button>
//               )}
//             </div>

//             {/* Topics ref */}
//             <div className="bg-brand-card border border-brand-border p-4">
//               <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase mb-3">Topics</p>
//               <div className="flex flex-col gap-2">
//                 {[
//                   ['/sensor_health/lidar','Bool'],['/sensor_health/imu','Bool'],
//                   ['/sensor_health/gps','Bool'],['/sensor_health/all','Bool'],
//                   ['/mavros/state','mavros/State'],['/imu/data','Imu'],
//                   ['/mavros/global_position/global','NavSatFix'],['/cmd_vel_safe','Twist'],
//                 ].map(([t, ty]) => (
//                   <div key={t} className="flex items-start gap-2">
//                     <span className="text-brand-red font-mono text-[8px] mt-px flex-shrink-0">›</span>
//                     <div style={{ minWidth:0 }}>
//                       <p className="font-mono text-[8px] text-white/50" style={{ wordBreak:'break-all' }}>{t}</p>
//                       <p className="font-mono text-[7px] text-white/20 tracking-widest uppercase">{ty}</p>
//                     </div>
//                   </div>
//                 ))}
//               </div>
//             </div>

//             {/* Event log */}
//             <div className="bg-brand-card border border-brand-border p-4 flex flex-col" style={{ minHeight:160, maxHeight:240 }}>
//               <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
//               <div className="flex-1 overflow-y-auto flex flex-col gap-1">
//                 {eventLog.map((e, i) => (
//                   <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
//                     <span className="font-mono text-[7px] text-white/15 flex-shrink-0">
//                       {new Date(e.t).toLocaleTimeString('en', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })}
//                     </span>
//                     <span className={`font-mono text-[8px] leading-tight break-all ${
//                       e.type === 'cmd'    ? 'text-brand-red'  :
//                       e.type === 'ok'     ? 'text-white'      :
//                       e.type === 'error'  ? 'text-brand-red'  :
//                       e.type === 'status' ? 'text-white/60'   : 'text-white/30'
//                     }`}>{e.msg}</span>
//                   </div>
//                 ))}
//               </div>
//             </div>
//           </div>

//           <style>{`@media(max-width:700px){.nav-body{grid-template-columns:1fr!important}}`}</style>
//         </div>
//       )}
//     </div>
//   )
// }




import { useEffect, useRef, useState, useCallback } from 'react'
import PTZControl from '../components/PTZControl'
import { useEnvironment } from '../context/EnvironmentContext'

// ── Config ────────────────────────────────────────────────────────────────────
const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'
const API_BASE      = 'https://trovcamera.edgeforce.in'
const VPS_HOST      = 'trovcamera.edgeforce.in'
const WEBRTC_PORT   = 8889

const SENSOR_TOPICS = {
  LIDAR: '/sensor_health/lidar',
  IMU:   '/sensor_health/imu',
  // GPS:   '/sensor_health/gps',
  ALL:   '/sensor_health/all',
}
const RAW_TOPICS = {
  IMU_RAW:      '/imu/data',
  // GPS_RAW:      '/mavros/global_position/global',
  MAVROS_STATE: '/mavros/state',
}
const TOPIC = {
  FLOOD_LIGHT: '/gpio_pin32_control',
  BATTERY:     '/trov/battery/percent',
  HEADLIGHT:   '/trov/headlight',
}
const ARM_SERVICE = '/mavros/cmd/arming'
const ARM_TYPE    = 'mavros_msgs/CommandBool'
const CMD_VEL     = '/cmd_vel_safe'

const CAMERAS = [
  { id: 'driving',      label: 'Driving Camera',     sub: 'Forward View', stream: 'driving_camera',      hasPTZ: false },
  { id: 'surveillance', label: 'Surveillance Camera', sub: 'Wide Field',   stream: 'surveillance_camera', hasPTZ: true  },
]
const SPEED    = { linear: 0.5, angular: 1.0 }
const TELEOP_HZ = 10

// Manual drive via MAVROS RC override (matches TeleopPanel.jsx)
const RC_OVERRIDE_TOPIC = '/mavros/rc/override'
const RC_TYPE           = 'mavros_msgs/OverrideRCIn'
const CH_STEER = 0, CH_THROTTLE = 2, RC_NEUTRAL = 1500, RC_NOCHANGE = 65535
const RC = {
  FWD:   { steer: RC_NEUTRAL, throttle: 1520 },
  BACK:  { steer: RC_NEUTRAL, throttle: 1480 },
  LEFT:  { steer: 1340,       throttle: RC_NEUTRAL },
  RIGHT: { steer: 1650,       throttle: RC_NEUTRAL },
  STOP:  { steer: RC_NEUTRAL, throttle: RC_NEUTRAL },
}
function rcOverrideMsg(steer, throttle) {
  const channels = new Array(18).fill(RC_NOCHANGE)
  channels[CH_STEER] = steer; channels[CH_THROTTLE] = throttle
  return { channels }
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
// Headings/labels: "Rajdhani"  (bold, wide tracking)
// Body/values:     "DM Mono"   (clean monospace)
// Color palette: #C8000A (red), #ffffff (white), rgba(255,255,255,0.x) (dim white), #0a0a0a (bg)

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' }, ...options,
  })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

// ── useRosBridge ──────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef        = useRef(null)
  const subMap       = useRef({})
  const advMap       = useRef({})
  const idCounter    = useRef(0)
  const pendingCalls = useRef({})
  const reconnRef    = useRef(null)
  const [ready,    setReady]    = useState(false)
  const [wsStatus, setWsStatus] = useState('CONNECTING')

  const connect = useCallback(() => {
    if (wsRef.current?.readyState <= 1) return
    const ws = new WebSocket(url)
    wsRef.current = ws
    setWsStatus('CONNECTING')
    ws.onopen = () => {
      setReady(true); setWsStatus('CONNECTED')
      clearTimeout(reconnRef.current)
      Object.entries(subMap.current).forEach(([id, { topic, type }]) =>
        ws.send(JSON.stringify({ op: 'subscribe', id, topic, type })))
      Object.entries(advMap.current).forEach(([topic, type]) =>
        ws.send(JSON.stringify({ op: 'advertise', topic, type })))
    }
    ws.onclose = () => {
      setReady(false); setWsStatus('DISCONNECTED')
      reconnRef.current = setTimeout(connect, 3000)
    }
    ws.onerror = () => setWsStatus('ERROR')
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.op === 'publish')
          Object.values(subMap.current).filter(s => s.topic === msg.topic).forEach(s => s.cb(msg.msg))
        if (msg.op === 'service_response' && msg.id) {
          const p = pendingCalls.current[msg.id]
          if (p) { p(msg); delete pendingCalls.current[msg.id] }
        }
      } catch {}
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => { clearTimeout(reconnRef.current); wsRef.current?.close() }
  }, [connect])

  const subscribe = useCallback((topic, type, cb) => {
    const id = `sub_${++idCounter.current}`
    subMap.current[id] = { topic, type, cb }
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ op: 'subscribe', id, topic, type }))
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
    if (ws?.readyState !== WebSocket.OPEN) return false
    if (!advMap.current[topic]) {
      ws.send(JSON.stringify({ op: 'advertise', topic, type }))
      advMap.current[topic] = type
    }
    ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
    return true
  }, [])

  const callService = useCallback((service, type, args = {}) => {
    return new Promise((resolve) => {
      const id = `svc_${++idCounter.current}`
      pendingCalls.current[id] = resolve
      wsRef.current?.readyState === WebSocket.OPEN &&
        wsRef.current.send(JSON.stringify({ op: 'call_service', id, service, type, args }))
      setTimeout(() => {
        if (pendingCalls.current[id]) {
          delete pendingCalls.current[id]
          resolve({ result: false, values: { success: false }, timeout: true })
        }
      }, 8000)
    })
  }, [])

  return { ready, wsStatus, subscribe, advertise, publish, callService }
}

// ── useWhepStream ─────────────────────────────────────────────────────────────
function useWhepStream(host, port, streamName, enabled = true) {
  const videoRef = useRef(null)
  const pcRef    = useRef(null)
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function connect() {
      setStatus('connecting')
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pcRef.current = pc
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })
      pc.ontrack = (e) => {
        if (cancelled) return
        if (videoRef.current) { videoRef.current.srcObject = e.streams[0]; setStatus('live') }
      }
      pc.oniceconnectionstatechange = () => {
        if (cancelled) return
        const s = pc.iceConnectionState
        if (s === 'failed' || s === 'disconnected' || s === 'closed') setStatus('disconnected')
      }
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const res = await fetch(`http://${host}:${port}/${streamName}/whep`, {
          method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp,
        })
        if (!res.ok) throw new Error(`WHEP ${res.status}`)
        const sdpAnswer = await res.text()
        if (cancelled) return
        await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
      } catch { if (!cancelled) setStatus('error') }
    }
    connect()
    return () => {
      cancelled = true
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
      if (videoRef.current) videoRef.current.srcObject = null
      setStatus('idle')
    }
  }, [host, port, streamName, enabled])

  return { videoRef, status }
}

// ── Small shared primitives ───────────────────────────────────────────────────

const R = '#C8000A'   // brand red
const DIM = 'rgba(255,255,255,0.18)'

function Label({ children, accent }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-0.5 h-4 flex-shrink-0 rounded-full" style={{ background: accent || R }} />
      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.25em', textTransform:'uppercase', color: accent || 'rgba(255,255,255,0.4)', margin:0 }}>{children}</p>
    </div>
  )
}

function Card({ children, className = '', style = {} }) {
  return (
    <div className={`bg-brand-card border border-brand-border p-4 ${className}`} style={style}>
      {children}
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className="text-[9px] tracking-widest uppercase px-3 py-2 border flex items-center gap-2"
          style={{
            fontFamily:"'DM Mono',monospace",
            background: t.ok ? 'rgba(34,197,94,0.1)' : 'rgba(200,0,10,0.1)',
            borderColor: t.ok ? 'rgba(34,197,94,0.35)' : 'rgba(200,0,10,0.35)',
            color: t.ok ? '#22c55e' : '#ef4444',
          }}>
          <span>{t.ok ? '✓' : '✕'}</span><span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

// ── Map Modal ─────────────────────────────────────────────────────────────────
function MapModal({ maps, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="bg-brand-black border border-brand-border w-80 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
          <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.25em', textTransform:'uppercase', color:'rgba(255,255,255,0.35)' }}>Select Map</p>
          <button onClick={onClose} style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:'rgba(255,255,255,0.25)' }} className="hover:text-white/60 transition-colors">✕</button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {maps.length === 0
            ? <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.2)', textAlign:'center' }} className="px-4 py-6 tracking-widest uppercase">No maps found</p>
            : maps.map(m => (
              <button key={m} onClick={() => onSelect(m)}
                className="w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors flex items-center gap-2">
                <span style={{ color: R, fontSize:8 }}>▶</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:'rgba(255,255,255,0.6)' }}>{m}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel, variant = 'red' }) {
  const col = variant === 'red'
    ? { border: 'rgba(200,0,10,0.5)', text: '#ef4444', btnBg: 'rgba(200,0,10,0.15)' }
    : { border: 'rgba(245,158,11,0.5)', text: '#f59e0b', btnBg: 'rgba(245,158,11,0.1)' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="bg-brand-black border w-80 shadow-2xl" style={{ borderColor: col.border }}>
        <div className="px-5 py-5">
          <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.3em', textTransform:'uppercase', color:col.text }} className="mb-3">⚠ Confirm Action</p>
          <p style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'rgba(255,255,255,0.55)', lineHeight:1.6 }}>{message}</p>
        </div>
        <div className="flex border-t" style={{ borderColor: col.border }}>
          <button onClick={onCancel} style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.3)' }}
            className="flex-1 py-3 tracking-widest uppercase hover:bg-white/5 transition-colors border-r border-white/8">Cancel</button>
          <button onClick={onConfirm} style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:col.text, background:col.btnBg }}
            className="flex-1 py-3 tracking-widest uppercase transition-colors">Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ── Action Button ─────────────────────────────────────────────────────────────
function ActionBtn({ label, icon, onClick, loading, variant = 'ghost', disabled, small }) {
  const variants = {
    red:   { border:'rgba(200,0,10,0.5)',   bg:'rgba(200,0,10,0.1)',   text:'#C8000A' },
    amber: { border:'rgba(245,158,11,0.4)', bg:'rgba(245,158,11,0.08)',text:'#f59e0b' },
    green: { border:'rgba(34,197,94,0.4)',  bg:'rgba(34,197,94,0.08)', text:'#22c55e' },
    blue:  { border:'rgba(255,255,255,0.2)',bg:'rgba(255,255,255,0.04)',text:'rgba(255,255,255,0.6)' },
    ghost: { border:'rgba(255,255,255,0.1)',bg:'rgba(255,255,255,0.02)',text:'rgba(255,255,255,0.4)' },
  }
  const c = (disabled || loading) ? variants.ghost : variants[variant]
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`flex items-center justify-between border tracking-widest uppercase transition-all w-full ${small ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
      style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize: small ? 10 : 11,
        borderColor:c.border, background:c.bg, color:c.text,
        cursor:(disabled||loading)?'not-allowed':'pointer', opacity:(disabled||loading)?0.4:1 }}>
      <span>{label}</span>
      <span className="ml-2 opacity-70">{loading ? '…' : icon}</span>
    </button>
  )
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────
function ToggleSwitch({ on, onToggle, disabled, accentColor = '#f59e0b' }) {
  return (
    <button onClick={onToggle} disabled={disabled}
      className="relative w-12 h-6 border transition-all duration-300"
      style={{
        borderColor: on ? `${accentColor}88` : 'rgba(255,255,255,0.12)',
        background:  on ? `${accentColor}18` : 'rgba(255,255,255,0.02)',
        cursor:      disabled ? 'not-allowed' : 'pointer',
        opacity:     disabled ? 0.35 : 1,
        borderRadius: 2,
      }}>
      <div className="absolute top-0.5 w-4 h-4 border transition-all duration-300"
        style={{
          left:        on ? 'calc(100% - 18px)' : '3px',
          borderColor: on ? accentColor : 'rgba(255,255,255,0.2)',
          background:  on ? accentColor : 'transparent',
          boxShadow:   on ? `0 0 7px ${accentColor}80` : 'none',
          borderRadius: 1,
        }} />
    </button>
  )
}

// ── Battery Icon ─────────────────────────────────────────────────────────────
function BatteryIcon({ percent }) {
  const pct   = Math.max(0, Math.min(100, percent ?? 0))
  const color = pct > 60 ? '#22c55e' : pct > 25 ? '#f59e0b' : '#ef4444'
  return (
    <svg width="48" height="24" viewBox="0 0 52 26" fill="none">
      <rect x="1" y="3" width="44" height="20" rx="3" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="45" y="9" width="6" height="8" rx="1.5" fill={color} opacity="0.6" />
      {[0,1,2,3].map(i => (
        <rect key={i} x={3+i*10+(i>0?1:0)} y={5} width={9} height={16} rx={1.5}
          fill={color} opacity={pct >= [75,50,25,10][i] ? (i===0?0.9:0.75) : 0.1} />
      ))}
    </svg>
  )
}

// ── Light SVG Icons ───────────────────────────────────────────────────────────
function LightIcon({ on, size = 26 }) {
  const col = on ? '#f59e0b' : 'rgba(255,255,255,0.18)'
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      {on && [0,45,90,135,180,225,270,315].map(deg => {
        const r = deg*Math.PI/180
        return <line key={deg} x1={14+Math.cos(r)*10} y1={14+Math.sin(r)*10}
          x2={14+Math.cos(r)*13} y2={14+Math.sin(r)*13}
          stroke={col} strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
      })}
      <circle cx="14" cy="14" r="6" fill={on?col:'none'} opacity={on?0.18:1} />
      <circle cx="14" cy="14" r="6" stroke={col} strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2.5" fill={col} opacity={on?1:0.3} />
    </svg>
  )
}

// ── Health Ring ───────────────────────────────────────────────────────────────
function HealthRing({ sensors }) {
  const total   = sensors.length
  const healthy = sensors.filter(s => s.healthy === true).length
  const pct     = total > 0 ? (healthy / total) * 100 : 0
  const r = 28, circ = 2*Math.PI*r, dash = (pct/100)*circ
  const color = pct === 100 ? '#ffffff' : '#C8000A'
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width:68, height:68 }}>
        <svg style={{ width:'100%', height:'100%', transform:'rotate(-90deg)' }} viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition:'stroke-dasharray 0.6s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:800, fontSize:15, color, lineHeight:1 }}>{healthy}/{total}</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.2)', letterSpacing:'0.15em', textTransform:'uppercase' }}>online</span>
        </div>
      </div>
      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase', color }}>
        {pct===100?'ALL GO':pct>50?'DEGRADED':'CRITICAL'}
      </p>
    </div>
  )
}

// ── Sensor Card ───────────────────────────────────────────────────────────────
function SensorCard({ label, description, healthy, lastSeen, icon, detail }) {
  const borderColor = healthy===true ? 'rgba(34,197,94,0.22)' : healthy===false ? 'rgba(200,0,10,0.5)' : 'rgba(255,255,255,0.07)'
  const topBar      = healthy===true ? '#22c55e'               : healthy===false ? '#C8000A'              : 'rgba(255,255,255,0.07)'
  const badgeText   = healthy===true ? '#22c55e'               : healthy===false ? '#C8000A'              : 'rgba(255,255,255,0.25)'
  const statusText  = healthy===true ? 'HEALTHY'               : healthy===false ? 'FAULT'                : 'UNKNOWN'

  return (
    <div style={{ border:`1px solid ${borderColor}`, background:'rgba(255,255,255,0.015)', transition:'border-color 0.4s' }}>
      <div style={{ height:2, background:topBar, transition:'background 0.4s' }} />
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div style={{ width:32, height:32, border:`1px solid ${borderColor}`, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.02)', fontSize:14, flexShrink:0 }}>
              {icon}
            </div>
            <div>
              <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:14, letterSpacing:'0.12em', textTransform:'uppercase', color:'#fff', lineHeight:1 }}>{label}</p>
              {description && <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.3)', letterSpacing:'0.06em', marginTop:3 }}>{description}</p>}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 8px', border:`1px solid ${badgeText}44`, background:`${badgeText}0d`, flexShrink:0 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:badgeText, boxShadow: healthy===false?`0 0 5px #C8000A`:'none' }} />
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.2em', textTransform:'uppercase', color:badgeText }}>{statusText}</span>
          </div>
        </div>
        {/* Detail grid */}
        {detail && (
          <div style={{ background:'rgba(0,0,0,0.3)', border:'1px solid rgba(255,255,255,0.06)', padding:'7px 10px', display:'flex', flexDirection:'column', gap:4, marginBottom:8 }}>
            {Object.entries(detail).map(([k,v]) => (
              <div key={k} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.22)', flexShrink:0 }}>{k}</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.6)', textAlign:'right' }}>{String(v??'—')}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:7, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(255,255,255,0.18)' }}>Last msg:</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.38)' }}>{lastSeen||'Never'}</span>
        </div>
      </div>
    </div>
  )
}

// ── Teleop Pad ────────────────────────────────────────────────────────────────
function TeleopPad({ publish, ready }) {
  const intervalRef = useRef(null)
  const [active, setActive] = useState(null)

  const stopAll = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setActive(null)
    if (ready) publish(RC_OVERRIDE_TOPIC, RC_TYPE, rcOverrideMsg(RC.STOP.steer, RC.STOP.throttle))
  }, [publish, ready])

  const startCmd = useCallback((label) => {
    stopAll(); if (!ready) return
    setActive(label)
    const v = RC[label]
    const send = () => publish(RC_OVERRIDE_TOPIC, RC_TYPE, rcOverrideMsg(v.steer, v.throttle))
    send(); intervalRef.current = setInterval(send, 1000/TELEOP_HZ)
  }, [publish, ready, stopAll])

  useEffect(() => () => stopAll(), [])
  useEffect(() => {
    const up = () => { if (intervalRef.current) stopAll() }
    window.addEventListener('mouseup', up); window.addEventListener('touchend', up)
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up) }
  }, [stopAll])

  const btn = (label, display) => {
    const isActive = active === label
    return (
      <button
        onMouseDown={e => { e.preventDefault(); startCmd(label) }}
        onMouseUp={stopAll} onMouseLeave={() => { if (active===label) stopAll() }}
        onTouchStart={e => { e.preventDefault(); startCmd(label) }}
        onTouchEnd={e => { e.preventDefault(); stopAll() }}
        onTouchCancel={e => { e.preventDefault(); stopAll() }}
        disabled={!ready}
        className={`select-none touch-none flex flex-col items-center justify-center gap-0.5 border transition-all duration-75
          ${isActive ? 'border-brand-red bg-brand-red/15 text-brand-red' : 'border-brand-border bg-white/[0.03] text-white/35 hover:border-brand-red/40 hover:text-white/60'}
          ${!ready ? 'opacity-25 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{ width:50, height:50, borderRadius:4 }}>
        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:16 }}>{display}</span>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:6, letterSpacing:'0.15em', textTransform:'uppercase', opacity:0.6 }}>{label}</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,0.25)' }} className="mb-1">Velocity Control</p>
      <div className="flex justify-center">{btn('FWD', '▲')}</div>
      <div className="flex gap-1.5 justify-center">
        {btn('LEFT', '◀')}
        <button onClick={stopAll} disabled={!ready}
          className="border border-brand-border/50 bg-transparent text-white/20 hover:border-brand-red/40 hover:text-brand-red transition-all"
          style={{ width:50, height:50, borderRadius:4, cursor:ready?'pointer':'not-allowed', fontFamily:"'Rajdhani',sans-serif", fontSize:14 }}>■</button>
        {btn('RIGHT', '▶')}
      </div>
      <div className="flex justify-center">{btn('BACK', '▼')}</div>
      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.15)', letterSpacing:'0.12em', textTransform:'uppercase', marginTop:4 }}>Hold to move · release to stop</p>
    </div>
  )
}

// ── Custom Velocity Input ─────────────────────────────────────────────────────
function CustomVelInput({ publish, ready }) {
  const [lx, setLx] = useState('')
  const [az, setAz] = useState('')
  const inputStyle = {
    width:'100%', background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.09)',
    color:'#fff', fontFamily:"'DM Mono',monospace", fontSize:10, padding:'5px 8px', outline:'none', boxSizing:'border-box',
  }
  return (
    <div className="px-4 py-3 border-b border-brand-border flex-shrink-0">
      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:10, letterSpacing:'0.25em', textTransform:'uppercase', color:'rgba(255,255,255,0.25)' }} className="mb-2.5">Custom Velocity</p>
      <div className="flex flex-col gap-2">
        <div>
          <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.2)' }} className="mb-1">Linear X (m/s)</p>
          <input type="number" step="0.05" placeholder="0.30" value={lx} onChange={e=>setLx(e.target.value)} style={inputStyle}
            onFocus={e=>(e.target.style.borderColor='rgba(200,0,10,0.5)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.09)')} />
        </div>
        <div>
          <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.2)' }} className="mb-1">Angular Z (rad/s)</p>
          <input type="number" step="0.05" placeholder="0.50" value={az} onChange={e=>setAz(e.target.value)} style={inputStyle}
            onFocus={e=>(e.target.style.borderColor='rgba(200,0,10,0.5)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.09)')} />
        </div>
        <ActionBtn label="Apply Velocity" icon="⚡" variant="ghost" disabled={!ready||!lx||!az}
          onClick={() => {
            const linearX=parseFloat(lx), angularZ=parseFloat(az)
            if (!isNaN(linearX)&&!isNaN(angularZ)) publish(CMD_VEL,'geometry_msgs/Twist',{ linear:{x:linearX,y:0,z:0}, angular:{x:0,y:0,z:angularZ} })
          }} />
      </div>
    </div>
  )
}

// ── Camera Feed ───────────────────────────────────────────────────────────────
function CameraFeed({ camera, showPTZ=false, size=50, onSizeChange }) {
  const { videoRef, status } = useWhepStream(VPS_HOST, WEBRTC_PORT, camera.stream)
  const [ptzVisible, setPtzVisible] = useState(false)
  const isLive  = status === 'live'
  const isError = status === 'error' || status === 'disconnected'
  return (
    <div className="relative flex flex-col bg-brand-black border border-brand-border overflow-hidden"
      style={{ height:`${size}%`, minHeight:120, transition:'height 0.2s ease' }}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-brand-dark border-b border-brand-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive?'bg-green-400 animate-pulse-dot':'bg-white/20'}`} />
          <div>
            <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase', color:'#fff', lineHeight:1 }}>{camera.label}</p>
            <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.28)', letterSpacing:'0.1em', textTransform:'uppercase' }}>{camera.sub}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {camera.hasPTZ && showPTZ && (
            <button onClick={() => setPtzVisible(v=>!v)}
              style={{ fontFamily:"'DM Mono',monospace", fontSize:7, letterSpacing:'0.15em', textTransform:'uppercase' }}
              className={`px-1.5 py-0.5 border transition-all ${ptzVisible?'border-brand-red text-brand-red bg-brand-red/10':'border-brand-red/30 text-brand-red/50 hover:border-brand-red/60'}`}>
              PTZ
            </button>
          )}
          {onSizeChange && (
            <input type="range" min={25} max={75} value={size} onChange={e=>onSizeChange(Number(e.target.value))}
              className="w-12 h-1 accent-brand-red cursor-pointer" />
          )}
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, textTransform:'uppercase', letterSpacing:'0.1em', color:isLive?'#4ade80':'rgba(255,255,255,0.2)' }}>
            {isLive?'LIVE':status.toUpperCase()}
          </span>
        </div>
      </div>
      <div className="flex-1 relative bg-black min-h-0">
        <div className="absolute inset-0 scan-line z-10 pointer-events-none" />
        <div className="absolute top-2 left-2 w-3 h-3 border-t border-l border-brand-red/35 z-20 pointer-events-none" />
        <div className="absolute top-2 right-2 w-3 h-3 border-t border-r border-brand-red/35 z-20 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b border-l border-brand-red/35 z-20 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b border-r border-brand-red/35 z-20 pointer-events-none" />
        {isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20">
            <span style={{ color:'rgba(200,0,10,0.4)', fontSize:22 }}>⚠</span>
            <p style={{ fontFamily:"'DM Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.22)', letterSpacing:'0.15em', textTransform:'uppercase' }}>Feed Unavailable</p>
          </div>
        )}
        {!isLive && !isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20">
            <div className="w-5 h-5 border border-brand-red/30 border-t-brand-red rounded-full animate-spin" />
            <p style={{ fontFamily:"'DM Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.2)', letterSpacing:'0.15em', textTransform:'uppercase' }}>Connecting…</p>
          </div>
        )}
        <video ref={videoRef} autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-contain"
          style={{ display:isLive?'block':'none' }} />
        {camera.hasPTZ && showPTZ && ptzVisible && (
          <div className="absolute bottom-3 right-3 z-30 animate-fade-in"><PTZControl /></div>
        )}
      </div>
    </div>
  )
}

// ── Process Status Row ────────────────────────────────────────────────────────
function ProcessRow({ name, label, status, onRestart, loading, viaStack }) {
  const col = status==='running' ? '#22c55e' : status==='dead' ? '#ef4444' : '#94a3b8'
  return (
    <div className="flex gap-2 items-stretch">
      <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-white/6 bg-black/20">
        <span style={{ width:6, height:6, borderRadius:'50%', background:col, boxShadow:status==='running'?`0 0 4px ${col}`:'none', flexShrink:0 }} />
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.38)', flex:1, letterSpacing:'0.05em' }}>{label}</span>
        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase', color:col }}>{status||'…'}</span>
      </div>
      {viaStack
        ? <div style={{ width:72, display:'flex', alignItems:'center', justifyContent:'center', border:'1px solid rgba(255,255,255,0.05)', fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.15)', letterSpacing:'0.1em' }}>via stack</div>
        : <div style={{ width:72, flexShrink:0 }}><ActionBtn label="Restart" icon="↺" variant="blue" small loading={loading} onClick={onRestart} /></div>
      }
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Main Page
// ══════════════════════════════════════════════════════════════════════════════
export default function NavigationPage() {
  const { ready, wsStatus, subscribe, advertise, publish, callService } = useRosBridge(ROSBRIDGE_URL)

  // Sub-system labels differ per environment (indoor slam_toolbox/AMCL vs outdoor lidarslam)
  const { environment } = useEnvironment()
  const isOutdoor = environment === 'outdoor'
  const locLabel = isOutdoor ? 'Localization · lidar_localization' : 'Localization · map_server + amcl'

  // ── Sensor state ──────────────────────────────────────────────────────────
  const [sensorHealth, setSensorHealth] = useState({ lidar:null, imu:null, all:null })
  const [imuData,  setImuData]  = useState(null)
  // const [gpsData,  setGpsData]  = useState(null)
  const [mavState, setMavState] = useState(null)
  const [lastSeen, setLastSeen] = useState({ lidar:null, imu:null})

  // ── Arm state ────────────────────────────────────────────────────────────
  const [armed,      setArmed]      = useState(false)
  const [armBusy,    setArmBusy]    = useState(false)
  const [armConfirm, setArmConfirm] = useState(false)

  // ── System Control state ─────────────────────────────────────────────────
  const [batteryPct,    setBatteryPct]    = useState(null)
  const [floodOn,       setFloodOn]       = useState(false)
  const [headLightOn,   setHeadLightOn]   = useState(false)
  const [processStatus, setProcessStatus] = useState(null)
  const [stackStatus,   setStackStatus]   = useState(null)
  const [maps,          setMaps]          = useState([])
  const [loading,       setLoading]       = useState({})
  const [toasts,        setToasts]        = useState([])
  const [showMapModal,  setShowMapModal]  = useState(false)
  const [confirm,       setConfirm]       = useState(null)
  const pollRef = useRef(null)

  // ── Mode ─────────────────────────────────────────────────────────────────
  const [manualMode, setManualMode] = useState(false)
  const [splitPct,   setSplitPct]   = useState(50)

  const ts = () => new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})

  // ── Toast helper ──────────────────────────────────────────────────────────
  const toast = useCallback((msg, ok=true) => {
    const id = Date.now()
    setToasts(p => [...p.slice(-4), { id, msg, ok }])
    setTimeout(() => setToasts(p => p.filter(t=>t.id!==id)), 3500)
  }, [])

  const setLoad = (key, val) => setLoading(p => ({ ...p, [key]:val }))

  // ── ROS subscriptions ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    advertise(RC_OVERRIDE_TOPIC, RC_TYPE)
    advertise(TOPIC.FLOOD_LIGHT, 'std_msgs/msg/Bool')
    advertise(TOPIC.HEADLIGHT,   'std_msgs/msg/Bool')

    const unsubs = [
      subscribe(SENSOR_TOPICS.LIDAR, 'std_msgs/Bool', msg => {
        setSensorHealth(p=>({...p,lidar:msg.data}))
        if (msg.data) setLastSeen(p=>({...p,lidar:ts()}))
      }),
      subscribe(SENSOR_TOPICS.IMU, 'std_msgs/Bool', msg => {
        setSensorHealth(p=>({...p,imu:msg.data}))
        if (msg.data) setLastSeen(p=>({...p,imu:ts()}))
      }),
      // subscribe(SENSOR_TOPICS.GPS, 'std_msgs/Bool', msg => {
      //   setSensorHealth(p=>({...p,gps:msg.data}))
      //   if (msg.data) setLastSeen(p=>({...p,gps:ts()}))
      // }),
      subscribe(SENSOR_TOPICS.ALL, 'std_msgs/Bool', msg => setSensorHealth(p=>({...p,all:msg.data}))),
      subscribe(RAW_TOPICS.IMU_RAW, 'sensor_msgs/Imu', msg => {
        setImuData(msg); setLastSeen(p=>({...p,imu:ts()}))
      }),
      // subscribe(RAW_TOPICS.GPS_RAW, 'sensor_msgs/NavSatFix', msg => {
      //   setGpsData(msg); setLastSeen(p=>({...p,gps:ts()}))
      // }),
      subscribe(RAW_TOPICS.MAVROS_STATE, 'mavros_msgs/State', msg => {
        setMavState(msg); setArmed(msg.armed||false)
      }),
      subscribe(TOPIC.BATTERY, 'std_msgs/msg/Float32', msg => {
        if (msg?.data!=null) setBatteryPct(msg.data)
      }),
    ]
    return () => unsubs.forEach(u=>u?.())
  }, [ready])

  // ── Arm service ───────────────────────────────────────────────────────────
  const sendArm = useCallback(async (value) => {
    setArmBusy(true); setArmConfirm(false)
    try {
      const res = await callService(ARM_SERVICE, ARM_TYPE, { value })
      if (res.timeout)                               toast('Service call timed out', false)
      else if (res.values?.success===false)          toast(`${value?'ARM':'DISARM'} rejected by FCU`, false)
      else { toast(`${value?'Armed':'Disarmed'} successfully`, true); setArmed(value) }
    } catch(e) { toast(`Service error: ${e.message}`, false) }
    setArmBusy(false)
  }, [callService, toast])

  // ── System control API ────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const [s, ss] = await Promise.all([apiFetch('/api/status'), apiFetch('/api/stack/status')])
      if (s.ok)  setProcessStatus(s.data.status)
      if (ss.ok) setStackStatus(ss.data.trov_service)
    } catch {}
  }, [])

  const fetchMaps = useCallback(async () => {
    setLoad('maps', true)
    try {
      const res = await apiFetch('/api/maps')
      if (res.ok) setMaps(res.data.maps||[])
      else toast(res.data.error||'Failed to load maps', false)
    } catch { toast('Maps fetch failed', false) }
    setLoad('maps', false)
  }, [toast])

  useEffect(() => {
    fetchStatus(); fetchMaps()
    pollRef.current = setInterval(fetchStatus, 5000)
    return () => clearInterval(pollRef.current)
  }, [fetchStatus, fetchMaps])

  const apiAction = useCallback(async (key, path, method='POST', body=null, successMsg) => {
    setLoad(key, true)
    try {
      const opts = { method }
      if (body) opts.body = JSON.stringify(body)
      const res = await apiFetch(path, opts)
      if (res.ok) toast(successMsg||res.data.message||'Done', true)
      else        toast(res.data.error||`Failed: ${path}`, false)
      await fetchStatus()
    } catch(e) { toast(String(e), false) }
    setLoad(key, false)
  }, [toast, fetchStatus])

  const confirmAction = (message, action, variant='red') => setConfirm({ message, action, variant })

  const handleLocalizationRestart = async (mapName) => {
    setShowMapModal(false)
    await apiAction('localization', '/api/localization/restart', 'POST', { map_name:mapName }, `Localization restarting: ${mapName}`)
  }

  const toggleFlood = useCallback(() => {
    const next = !floodOn
    if (publish(TOPIC.FLOOD_LIGHT,'std_msgs/msg/Bool',{data:next})) { setFloodOn(next); toast(`Flood light ${next?'on':'off'}`, true) }
    else toast('ROS not connected', false)
  }, [floodOn, publish, toast])

  const toggleHeadLight = useCallback(() => {
    const next = !headLightOn
    if (publish(TOPIC.HEADLIGHT,'std_msgs/msg/Bool',{data:next})) { setHeadLightOn(next); toast(`Headlight ${next?'on':'off'}`, true) }
    else toast('ROS not connected', false)
  }, [headLightOn, publish, toast])

  // ── Derived ───────────────────────────────────────────────────────────────
  const sensors = [
    { key:'lidar', healthy:sensorHealth.lidar },
    { key:'imu',   healthy:sensorHealth.imu   },
    // { key:'gps',   healthy:sensorHealth.gps   },
  ]
  const imuDetail = imuData ? {
    'Lin X': `${imuData.linear_acceleration?.x?.toFixed(3)??'—'} m/s²`,
    'Lin Y': `${imuData.linear_acceleration?.y?.toFixed(3)??'—'} m/s²`,
    'Lin Z': `${imuData.linear_acceleration?.z?.toFixed(3)??'—'} m/s²`,
    'Ang Z': `${imuData.angular_velocity?.z?.toFixed(3)??'—'} rad/s`,
  } : null
  // const gpsDetail = gpsData ? {
  //   'Latitude':  `${gpsData.latitude?.toFixed(6)??'—'}°`,
  //   'Longitude': `${gpsData.longitude?.toFixed(6)??'—'}°`,
  //   'Altitude':  `${gpsData.altitude?.toFixed(2)??'—'} m`,
  //   'Fix':       gpsData.status?.status===0?'GPS FIX':gpsData.status?.status>0?'DGPS':'NO FIX',
  // } : null

  const batteryColor = batteryPct==null?'rgba(255,255,255,0.25)': batteryPct>60?'#22c55e': batteryPct>25?'#f59e0b':'#ef4444'
  const stackCol = stackStatus==='active'?'#22c55e': stackStatus==='inactive'?'#94a3b8':'#ef4444'
  const wsCol    = wsStatus==='CONNECTED'?'#22c55e': wsStatus==='CONNECTING'?'#f59e0b':'#ef4444'

  const statusColor = s => s==='running'?'#22c55e': s==='dead'?'#ef4444':'#94a3b8'

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=DM+Mono:wght@300;400;500&display=swap');`}</style>

      <Toast toasts={toasts} />

      {showMapModal && <MapModal maps={maps} onSelect={handleLocalizationRestart} onClose={()=>setShowMapModal(false)} />}
      {confirm && (
        <ConfirmModal message={confirm.message} variant={confirm.variant}
          onConfirm={()=>{ confirm.action(); setConfirm(null) }}
          onCancel={()=>setConfirm(null)} />
      )}

      {/* ══ HEADER ══ */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-brand-border flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red flex-shrink-0" />
          <div>
            <h1 style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:15, letterSpacing:'0.18em', textTransform:'uppercase', color:'#fff', lineHeight:1 }}>System Health</h1>
            <p style={{ fontFamily:"'DM Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.28)', letterSpacing:'0.18em', textTransform:'uppercase', marginTop:3 }}>Sensor Monitor · Vehicle Control · Services</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Stack status */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 border"
            style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase',
              borderColor:`${stackCol}44`, background:`${stackCol}0d`, color:stackCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background:stackCol }} />
            trov.service · {stackStatus??'…'}
          </div>

          {/* Overall sensor health */}
          {/* <div className="flex items-center gap-1.5 px-2.5 py-1 border"
            style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase',
              borderColor: sensorHealth.all===true?'rgba(34,197,94,0.3)': sensorHealth.all===false?'rgba(200,0,10,0.4)':'rgba(255,255,255,0.08)',
              color:       sensorHealth.all===true?'#22c55e':             sensorHealth.all===false?'#C8000A':          'rgba(255,255,255,0.25)' }}>
            <span className={`w-1.5 h-1.5 rounded-full ${sensorHealth.all===true?'animate-pulse-dot':''}`}
              style={{ background: sensorHealth.all===true?'#22c55e': sensorHealth.all===false?'#C8000A':'rgba(255,255,255,0.2)' }} />
            {sensorHealth.all===true?'All Healthy': sensorHealth.all===false?'Fault':'Monitoring'}
          </div> */}



          {/* Manual mode */}
          <button onClick={()=>setManualMode(v=>!v)}
            className="flex items-center gap-1.5 px-3 py-1.5 border transition-all"
            style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase',
              borderColor: manualMode?'#C8000A':'rgba(255,255,255,0.14)',
              background:  manualMode?'rgba(200,0,10,0.1)':'rgba(255,255,255,0.02)',
              color:       manualMode?'#C8000A':'rgba(255,255,255,0.45)' }}>
            <span>{manualMode?'●':'○'}</span>Manual Mode
          </button>
        </div>
      </div>

      {/* ══ BODY ══ */}
      {manualMode ? (

        /* ── MANUAL MODE (unchanged except font) ── */
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-0 overflow-hidden">
            {CAMERAS.map((cam, idx) => {
              const isFirst  = idx===0
              const feedSize = isFirst ? splitPct : (100-splitPct)
              return (
                <div key={cam.id} className="flex flex-col" style={{ flex:feedSize, minHeight:0 }}>
                  <CameraFeed camera={cam} showPTZ size={100}
                    onSizeChange={isFirst ? setSplitPct : v=>setSplitPct(100-v)} />
                  {isFirst && (
                    <div className="flex-shrink-0 flex items-center justify-center cursor-row-resize bg-brand-dark border-y border-brand-border"
                      style={{ height:10 }}
                      onMouseDown={e => {
                        const startY=e.clientY, startPct=splitPct
                        const totalH=e.currentTarget.closest('.flex-col.min-h-0')?.parentElement?.offsetHeight||600
                        const onMove=me => setSplitPct(Math.max(20,Math.min(80,startPct+((me.clientY-startY)/totalH)*100)))
                        const onUp=()=>{ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
                        window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp)
                      }}>
                      <div className="flex gap-0.5">{[0,1,2,3,4].map(i=><div key={i} className="w-1 h-0.5 bg-white/20"/>)}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="w-56 flex-shrink-0 flex flex-col border-l border-brand-border overflow-y-auto">
            {/* ARM status */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
              <div className={`flex items-center gap-2.5 px-3 py-2.5 border ${armed?'border-brand-red/45 bg-brand-red/6':'border-white/8 bg-white/[0.015]'}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${armed?'bg-brand-red animate-pulse-dot':'bg-white/25'}`} />
                <div>
                  <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:12, letterSpacing:'0.18em', textTransform:'uppercase', color:armed?'#C8000A':'rgba(255,255,255,0.55)' }}>{armed?'ARMED':'DISARMED'}</p>
                  <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.22)', letterSpacing:'0.12em', textTransform:'uppercase', marginTop:2 }}>{armed?'Motors active':'Safe · motors off'}</p>
                </div>
              </div>
            </div>
            {/* Rover image */}
            <div className="flex-shrink-0 border-b border-brand-border relative overflow-hidden">
              <img src="/trov.png" alt="T-ROV" className="w-full object-contain"
                style={{ maxHeight:110, filter:armed?'brightness(0.95) drop-shadow(0 0 10px rgba(200,0,10,0.5))':'brightness(0.4) grayscale(0.3)', transition:'filter 0.5s', display:'block' }}
                onError={e=>{e.target.style.display='none'}} />
              {armed && <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:900, fontSize:22, color:'rgba(200,0,10,0.22)', letterSpacing:'0.3em' }}>ARMED</span>
              </div>}
            </div>
            {/* Teleop */}
            <div className="flex-shrink-0 px-4 py-4 border-b border-brand-border flex flex-col items-center">
              <TeleopPad publish={publish} ready={ready} />
            </div>
            {/* Mavros mini */}
            <div className="flex-shrink-0 px-4 py-3">
              <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:9, letterSpacing:'0.25em', textTransform:'uppercase', color:'rgba(255,255,255,0.22)' }} className="mb-2">Flight Controller</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[['Mode', mavState?.mode||'—'], ['Guided', mavState?.guided?'YES':'NO']].map(([l,v]) => (
                  <div key={l} className="bg-brand-black border border-brand-border px-2 py-1.5">
                    <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.2)', textTransform:'uppercase' }}>{l}</p>
                    <p style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:'rgba(255,255,255,0.65)' }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      ) : (

        /* ── MONITOR MODE ── */
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4">

            {/* ══ LEFT COLUMN ══════════════════════════════════════════════ */}
            <div className="lg:col-span-4 flex flex-col gap-4">

              {/* Sensor Overview */}
              <Card>
                <Label>Sensor Overview</Label>
                <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.6, marginBottom:16 }}>
                  Live health status from onboard sensors. All three must be healthy for autonomous navigation to function correctly.
                </p>
                <div className="flex items-center gap-5">
                  <HealthRing sensors={sensors} />
                  <div className="flex flex-col gap-2 flex-1">
                    {[
                      { key:'lidar', label:'LiDAR', icon:'⬡' },
                      { key:'imu',   label:'IMU',   icon:'◎' },
                      // { key:'gps',   label:'GPS',   icon:'◈' },
                    ].map(({ key, label, icon }) => {
                      const h = sensorHealth[key]
                      const col = h===true?'#22c55e': h===false?'#C8000A':'rgba(255,255,255,0.2)'
                      return (
                        <div key={key} className="flex items-center gap-2 px-2.5 py-1.5 border border-white/5 bg-black/15">
                          <span style={{ fontSize:10, color:col }}>{icon}</span>
                          <span style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.12em', textTransform:'uppercase', color:'rgba(255,255,255,0.7)', flex:1 }}>{label}</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase', color:col }}>
                            {h===true?'OK': h===false?'FAULT':'—'}
                          </span>
                          <span style={{ width:5, height:5, borderRadius:'50%', background:col, flexShrink:0, boxShadow:h===false?`0 0 4px ${col}`:'none' }} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Card>


              {/* ── Stack Controls ── */}
              <Card>
                <Label accent="#C8000A">Stack Controls</Label>
                <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.6, marginBottom:12 }}>
                  Manage the main ROS service that runs all navigation, localization, and sensor nodes. Stopping the stack halts all autonomous behavior.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <ActionBtn label="Start Stack" icon="▶" variant="green" loading={loading.start}
                    onClick={()=>apiAction('start','/api/stack/start','POST',null,'trov.service started')} />
                  <ActionBtn label="Stop Stack" icon="■" variant="red" loading={loading.stop}
                    onClick={()=>confirmAction('Stop trov.service? This halts all ROS nodes including navigation and localization.',
                      ()=>apiAction('stop','/api/stack/stop','POST',null,'trov.service stopped'),'red')} />
                  <ActionBtn label="Restart Stack" icon="↺" variant="amber" loading={loading.restart}
                    onClick={()=>confirmAction('Restart trov.service? Robot will be briefly unresponsive during restart.',
                      ()=>apiAction('restart','/api/stack/restart','POST',null,'trov.service restarted'),'amber')} />
                </div>
              </Card>
              

               {/* Flight Controller */}
              {/* <Card>
                <Label>Flight Controller State</Label>
                <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.6, marginBottom:12 }}>
                  MAVROS bridge status. Armed state controls whether motors can receive velocity commands.
                </p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    ['Connected',  mavState?.connected   ?'YES':'NO'],
                    ['Armed',      mavState?.armed        ?'YES':'NO'],
                    ['Mode',       mavState?.mode         ||'—'],
                    ['Guided',     mavState?.guided       ?'YES':'NO'],
                    ['Manual In',  mavState?.manual_input ?'YES':'NO'],
                    ['Sys Status', mavState?.system_status??'—'],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-black/30 border border-white/5 px-2.5 py-2">
                      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.2)', marginBottom:3 }}>{label}</p>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:12, color: value==='YES'?'#fff': value==='NO'?'#C8000A':'rgba(255,255,255,0.6)' }}>{String(value)}</p>
                    </div>
                  ))}
                </div>
                 { ARM panel }
                <div className={`flex items-center gap-2.5 px-3 py-2.5 border mb-3 ${armed?'border-brand-red/40 bg-brand-red/6':'border-white/8 bg-white/[0.015]'}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${armed?'bg-brand-red animate-pulse-dot':'bg-white/35'}`} />
                  <div className="flex-1">
                    <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:13, letterSpacing:'0.18em', textTransform:'uppercase', color:armed?'#C8000A':'#fff' }}>{armed?'ARMED':'DISARMED'}</p>
                    <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.22)', letterSpacing:'0.1em', textTransform:'uppercase', marginTop:2 }}>{armed?'Motors active · caution':'Safe · motors off'}</p>
                  </div>
                </div>
                {armConfirm && !armed && (
                  <div className="border border-brand-red/25 bg-brand-red/8 px-3 py-2 mb-2"
                    style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'#C8000A', letterSpacing:'0.08em' }}>
                    ⚠ Motors will engage. Click ARM again to confirm.
                  </div>
                )}
                {!armed ? (
                  <button onClick={()=>armConfirm?sendArm(true):setArmConfirm(true)} disabled={!ready||armBusy}
                    className="w-full py-2.5 border transition-all flex items-center justify-center gap-2"
                    style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.2em', textTransform:'uppercase',
                      borderColor:!ready||armBusy?'rgba(255,255,255,0.07)':'#C8000A',
                      background:!ready||armBusy?'transparent':armConfirm?'rgba(200,0,10,0.18)':'#C8000A',
                      color:!ready||armBusy?'rgba(255,255,255,0.18)':'#fff',
                      cursor:!ready||armBusy?'not-allowed':'pointer' }}>
                    {armBusy?<span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full"/>:'⚡'}
                    {armBusy?'Arming…':armConfirm?'Confirm ARM':'ARM Vehicle'}
                  </button>
                ) : (
                  <button onClick={()=>sendArm(false)} disabled={!ready||armBusy}
                    className="w-full py-2.5 border transition-all flex items-center justify-center gap-2"
                    style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.2em', textTransform:'uppercase',
                      borderColor:!ready||armBusy?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.32)',
                      background:'transparent', color:!ready||armBusy?'rgba(255,255,255,0.18)':'#fff',
                      cursor:!ready||armBusy?'not-allowed':'pointer' }}>
                    {armBusy?<span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full"/>:'■'}
                    {armBusy?'Disarming…':'DISARM Vehicle'}
                  </button>
                )}
              </Card> */}
              
              {/* Sensor Details */}
              {/* <div className="flex flex-col gap-3">
                <SensorCard label="LiDAR" description="3D point cloud depth sensor for obstacle detection and mapping"
                  healthy={sensorHealth.lidar} lastSeen={lastSeen.lidar} icon="⬡"
                  detail={{ 'Timeout':'1.0 s', 'Status': sensorHealth.lidar===true?'Receiving':'No signal' }} />
                <SensorCard label="IMU" description="Inertial measurement unit — acceleration and angular velocity"
                  healthy={sensorHealth.imu} lastSeen={lastSeen.imu} icon="◎" detail={imuDetail||{ 'Status':'Waiting for data' }} />
                <SensorCard label="GPS" description="Global positioning via MAVROS — latitude, longitude, altitude"
                  healthy={sensorHealth.gps} lastSeen={lastSeen.gps} icon="◈" detail={gpsDetail||{ 'Status':'Waiting for data' }} />
              </div> */}

             

            </div>{/* end left col */}

            {/* ══ RIGHT COLUMN ═════════════════════════════════════════════ */}
            <div className="lg:col-span-8 flex flex-col gap-4">

              {/* ── Battery + Lights row ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                {/* Battery */}
                <Card>
                  <Label accent="#22c55e">Battery</Label>
                  <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.5, marginBottom:12 }}>
                    Onboard power level. Below 25% charge immediately.
                  </p>
                  <div className="flex items-center gap-3 mb-3">
                    <BatteryIcon percent={batteryPct} />
                    <div>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:800, fontSize:28, color:batteryColor, lineHeight:1 }}>
                        {batteryPct!=null?`${batteryPct.toFixed(1)}%`:'—'}
                      </p>
                      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.2)', letterSpacing:'0.1em', textTransform:'uppercase', marginTop:3 }}>
                        {batteryPct==null?'waiting…': batteryPct>60?'nominal': batteryPct>25?'moderate':'critical'}
                      </p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-white/5 border border-white/5 overflow-hidden">
                    <div className="h-full transition-all duration-1000"
                      style={{ width:`${batteryPct??0}%`, background:batteryColor, boxShadow:`0 0 6px ${batteryColor}55` }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    {[0,25,50,75,100].map(v=><span key={v} style={{ fontFamily:"'DM Mono',monospace", fontSize:6, color:'rgba(255,255,255,0.15)' }}>{v}%</span>)}
                  </div>
                </Card>

                {/* Flood Light */}
                <Card>
                  <Label accent="#f59e0b">Flood Light</Label>
                  <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.5, marginBottom:14 }}>
                    Wide-area illumination. Activates onboard high-lumen flood array.
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        {floodOn && <div className="absolute inset-0 rounded-full animate-ping" style={{ background:'rgba(245,158,11,0.25)', animationDuration:'2s' }} />}
                        <LightIcon on={floodOn} size={32} />
                      </div>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:14, letterSpacing:'0.12em', textTransform:'uppercase', color:floodOn?'#f59e0b':'rgba(255,255,255,0.28)' }}>
                        {floodOn?'ACTIVE':'OFF'}
                      </p>
                    </div>
                    <ToggleSwitch on={floodOn} onToggle={toggleFlood} disabled={!ready} />
                  </div>
                </Card>

                {/* Headlight */}
                <Card>
                  <Label accent="#f59e0b">Headlight</Label>
                  <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.5, marginBottom:14 }}>
                    Forward-facing directional light for low-visibility navigation.
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        {headLightOn && <div className="absolute inset-0 rounded-full animate-ping" style={{ background:'rgba(245,158,11,0.25)', animationDuration:'2s' }} />}
                        <LightIcon on={headLightOn} size={32} />
                      </div>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:14, letterSpacing:'0.12em', textTransform:'uppercase', color:headLightOn?'#f59e0b':'rgba(255,255,255,0.28)' }}>
                        {headLightOn?'ACTIVE':'OFF'}
                      </p>
                    </div>
                    <ToggleSwitch on={headLightOn} onToggle={toggleHeadLight} disabled={!ready} />
                  </div>
                </Card>

              </div>

              {/* ── Sub-system Restarts ── */}
              <Card>
                <Label>Sub-System Restarts</Label>
                <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.6, marginBottom:12 }}>
                  Restart individual nodes without cycling the full stack. Useful for recovering a specific component without interrupting others.
                </p>
                <div className="flex flex-col gap-2">
                  <ProcessRow name="localization" label={locLabel}
                    status={processStatus?.localization} loading={loading.localization}
                    onRestart={()=>{ fetchMaps(); setShowMapModal(true) }} />
                  <ProcessRow name="navigation"   label="Navigation · bt_navigator"
                    status={processStatus?.navigation}   loading={loading.navigation}
                    onRestart={()=>confirmAction('Restart navigation? bt_navigator will be killed and restarted.',
                      ()=>apiAction('navigation','/api/navigation/restart','POST',null,'Navigation restarting'),'amber')} />
                  <ProcessRow name="odometry"     label="Odometry · icp_odometry"
                    status={processStatus?.odometry}     loading={loading.odometry}
                    onRestart={()=>confirmAction('Restart odometry? icp_odometry will be killed and restarted.',
                      ()=>apiAction('odometry','/api/odometry/restart','POST',null,'Odometry restarting'),'amber')} />
                  <ProcessRow name="rosbridge"    label="Rosbridge · websocket bridge"  status={processStatus?.rosbridge}  viaStack />
                  <ProcessRow name="mediamtx"     label="MediaMTX · video streaming"    status={processStatus?.mediamtx}   viaStack />
                </div>
              </Card>

              {/* ── Process Status ── */}
              {/* <Card>
                <div className="flex items-center justify-between mb-1">
                  <Label>Process Status</Label>
                  <button onClick={fetchStatus}
                    style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.22)' }}
                    className="hover:text-white/50 transition-colors -mt-2">↻ Refresh</button>
                </div>
                <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.5, marginBottom:12 }}>
                  Live status of all critical system processes polled every 5 seconds.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {['localization','navigation','odometry','rosbridge','mediamtx'].map(k => {
                    const s = processStatus?.[k]
                    const col = s ? statusColor(s) : 'rgba(148,163,184,0.4)'
                    return (
                      <div key={k} className="flex items-center justify-between px-3 py-2 border border-white/5 bg-black/20">
                        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontWeight:700, fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.45)' }}>{k}</span>
                        <div className="flex items-center gap-1.5">
                          <span style={{ width:5, height:5, borderRadius:'50%', background:col, boxShadow:s==='running'?`0 0 4px ${col}`:'none' }} />
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase', color:col }}>{s||'…'}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card> */}

              {/* ── Maps ── */}
              <Card>
                <div className="flex items-center justify-between mb-1">
                  <Label accent="rgba(255,255,255,0.4)">Available Maps</Label>
                  <button onClick={fetchMaps}
                    style={{ fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.22)' }}
                    className="hover:text-white/50 transition-colors -mt-2">
                    {loading.maps?'…':'↻ Refresh'}
                  </button>
                </div>
                <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.28)', lineHeight:1.5, marginBottom:12 }}>
                  Pre-built occupancy maps stored on the robot. Click any map to restart localization using that map.
                </p>
                {maps.length===0 ? (
                  <p style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.15)', textAlign:'center', letterSpacing:'0.12em', textTransform:'uppercase' }} className="py-4">No maps found</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {maps.map((m,i)=>(
                      <button key={m}
                        onClick={()=>confirmAction(`Restart localization with map: "${m}"?`,()=>handleLocalizationRestart(m),'amber')}
                        className="flex items-center gap-2 px-3 py-2.5 border border-white/8 bg-black/20 hover:bg-white/4 hover:border-white/15 transition-all text-left group">
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.15)', flexShrink:0 }}>{String(i+1).padStart(2,'0')}</span>
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.5)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} className="group-hover:text-white/80 transition-colors">{m}</span>
                        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, color:'rgba(255,255,255,0.15)', flexShrink:0 }} className="group-hover:text-white/40 transition-colors">↺</span>
                      </button>
                    ))}
                  </div>
                )}
              </Card>

            </div>{/* end right col */}
          </div>

          <style>{`@media(max-width:640px){ .lg\\:col-span-4,.lg\\:col-span-8{ grid-column:span 1 } }`}</style>
        </div>
      )}
    </div>
  )
}