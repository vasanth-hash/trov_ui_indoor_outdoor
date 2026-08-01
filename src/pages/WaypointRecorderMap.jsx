// import { useEffect, useRef, useState, useCallback } from 'react'

// const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'

// const TOPIC = {
//   STATUS:       'waypoint_recorder/status',
//   ROUTES:       'available_routes',
//   START:        'waypoint_recorder/start',
//   STOP:         'waypoint_recorder/stop',
//   SET_ROUTE:    'waypoint_recorder/set_route',
//   CLEAR_ROUTES: 'waypoint_recorder/clear_routes',
//   MAP:          '/map',
//   AMCL:         '/amcl_pose',
// }

// const C = { red: '#C8000A', green: '#22c55e', amber: '#f59e0b' }

// // ── useRosBridge (identical to WaypointFollowerMap) ──────────────────────────
// function useRosBridge(url) {
//   const wsRef = useRef(null), subMap = useRef({}), advMap = useRef({})
//   const [ready, setReady] = useState(false)
//   const [wsStatus, setWsStatus] = useState('CONNECTING')
//   const reconnectRef = useRef(null)

//   const connect = useCallback(() => {
//     if (wsRef.current && wsRef.current.readyState <= 1) return
//     const ws = new WebSocket(url)
//     wsRef.current = ws; setWsStatus('CONNECTING')
//     ws.onopen = () => {
//       setReady(true); setWsStatus('CONNECTED')
//       Object.entries(subMap.current).forEach(([id, { topic, type, opts = {} }]) =>
//         ws.send(JSON.stringify({ op: 'subscribe', id, topic, type, ...opts })))
//       Object.entries(advMap.current).forEach(([topic, type]) =>
//         ws.send(JSON.stringify({ op: 'advertise', topic, type })))
//     }
//     ws.onclose = () => {
//       setReady(false); setWsStatus('DISCONNECTED')
//       reconnectRef.current = setTimeout(connect, 3000)
//     }
//     ws.onerror = () => setWsStatus('ERROR')
//     ws.onmessage = (evt) => {
//       try {
//         const msg = JSON.parse(evt.data)
//         if (msg.op === 'publish')
//           Object.values(subMap.current).filter(s => s.topic === msg.topic).forEach(s => s.cb(msg.msg))
//       } catch {}
//     }
//   }, [url])

//   useEffect(() => { connect(); return () => { clearTimeout(reconnectRef.current); wsRef.current?.close() } }, [connect])

//   const subscribe = useCallback((topic, type, cb, opts = {}) => {
//     const id = `sub_${topic.replace(/\//g, '_')}_${Date.now()}`
//     subMap.current[id] = { topic, type, cb, opts }
//     if (wsRef.current?.readyState === WebSocket.OPEN)
//       wsRef.current.send(JSON.stringify({ op: 'subscribe', id, topic, type, ...opts }))
//     return () => {
//       delete subMap.current[id]
//       if (wsRef.current?.readyState === WebSocket.OPEN)
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
//     if (!advMap.current[topic]) { ws.send(JSON.stringify({ op: 'advertise', topic, type })); advMap.current[topic] = type }
//     ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
//   }, [])

//   return { ready, wsStatus, subscribe, advertise, publish }
// }

// // ── decodeOccupancyGrid (identical to WaypointFollowerMap) ───────────────────
// function decodeOccupancyGrid(mapMsg) {
//   if (!mapMsg?.info || !mapMsg?.data) return null
//   const { width, height, resolution, origin } = mapMsg.info
//   if (!width || !height) return null
//   const data = mapMsg.data
//   const rgba = new Uint8ClampedArray(width * height * 4)
//   for (let row = 0; row < height; row++) {
//     const canvasRow = height - 1 - row
//     for (let col = 0; col < width; col++) {
//       const v = data[row * width + col]
//       const dst = (canvasRow * width + col) * 4
//       if (v === -1)      { rgba[dst]=128; rgba[dst+1]=128; rgba[dst+2]=128; rgba[dst+3]=255 }
//       else if (v === 0)  { rgba[dst]=205; rgba[dst+1]=205; rgba[dst+2]=205; rgba[dst+3]=255 }
//       else { const d=Math.round(205-(v/100)*195); rgba[dst]=d; rgba[dst+1]=d; rgba[dst+2]=d; rgba[dst+3]=255 }
//     }
//   }
//   return { imageData: new ImageData(rgba, width, height), width, height, resolution, originX: origin.position.x, originY: origin.position.y }
// }

// // ── RecorderMapCanvas ─────────────────────────────────────────────────────────
// // Same map+robot rendering as WaypointFollowerMap + recorded waypoint trail
// function RecorderMapCanvas({ mapData, robotPos, recordedWPs, recording }) {
//   const canvasRef = useRef(null), viewRef = useRef(null), dragRef = useRef(null)
//   const tileRef = useRef(null), fittedRef = useRef(false)

//   // Pre-render map tile on a regular DOM canvas (no OffscreenCanvas)
//   useEffect(() => {
//     if (!mapData?.imageData) { tileRef.current = null; return }
//     const tc = document.createElement('canvas')
//     tc.width = mapData.width; tc.height = mapData.height
//     tc.getContext('2d').putImageData(mapData.imageData, 0, 0)
//     tileRef.current = tc; fittedRef.current = false
//   }, [mapData])

//   const fitView = useCallback(() => {
//     const canvas = canvasRef.current
//     if (!canvas || !mapData) return
//     const W = canvas.width || canvas.offsetWidth || 800
//     const H = canvas.height || canvas.offsetHeight || 500
//     if (!W || !H) return
//     const minX = mapData.originX, minY = mapData.originY
//     const maxX = mapData.originX + mapData.width * mapData.resolution
//     const maxY = mapData.originY + mapData.height * mapData.resolution
//     const scale = Math.min((W * 0.95) / (maxX - minX), (H * 0.95) / (maxY - minY))
//     viewRef.current = { cx: (minX+maxX)/2, cy: (minY+maxY)/2, scale, W, H }
//   }, [mapData])

//   const draw = useCallback(() => {
//     const canvas = canvasRef.current; if (!canvas) return
//     const W = canvas.offsetWidth, H = canvas.offsetHeight
//     if (W < 1 || H < 1) return
//     let needFit = false
//     if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; needFit = true }
//     if (!viewRef.current || needFit || !fittedRef.current) { fitView(); fittedRef.current = true }
//     if (!viewRef.current) return
//     viewRef.current.W = W; viewRef.current.H = H

//     const toC = (wx, wy) => {
//       const v = viewRef.current
//       return { x: (wx-v.cx)*v.scale + v.W/2, y: -(wy-v.cy)*v.scale + v.H/2 }
//     }

//     const ctx = canvas.getContext('2d')
//     ctx.clearRect(0, 0, W, H)
//     ctx.fillStyle = '#0a0e16'; ctx.fillRect(0, 0, W, H)

//     // ── Occupancy grid ───────────────────────────────────────────────────────
//     if (tileRef.current && mapData) {
//       const { width, height, resolution, originX, originY } = mapData
//       const tl = toC(originX, originY + height*resolution)
//       const br = toC(originX + width*resolution, originY)
//       const pw = br.x-tl.x, ph = br.y-tl.y
//       if (pw > 2 && ph > 2) {
//         ctx.save(); ctx.imageSmoothingEnabled = pw < width*2
//         ctx.drawImage(tileRef.current, tl.x, tl.y, pw, ph); ctx.restore()
//         ctx.strokeStyle='rgba(0,200,255,0.2)'; ctx.lineWidth=1; ctx.strokeRect(tl.x,tl.y,pw,ph)
//       }
//     } else {
//       ctx.fillStyle='rgba(255,255,255,0.05)'
//       for (let x=0;x<W;x+=40) for (let y=0;y<H;y+=40) ctx.fillRect(x-1,y-1,2,2)
//       ctx.fillStyle='rgba(232,232,232,0.12)'; ctx.font='11px monospace'; ctx.textAlign='center'
//       ctx.fillText('Waiting for /map…', W/2, H/2)
//     }

//     // ── Recorded waypoint trail ──────────────────────────────────────────────
//     if (recordedWPs?.length > 0) {
//       if (recordedWPs.length > 1) {
//         ctx.beginPath(); ctx.strokeStyle='rgba(200,0,10,0.5)'; ctx.lineWidth=2; ctx.setLineDash([6,4])
//         recordedWPs.forEach((wp,i) => { const c=toC(wp.x,wp.y); i===0?ctx.moveTo(c.x,c.y):ctx.lineTo(c.x,c.y) })
//         ctx.stroke(); ctx.setLineDash([])
//       }
//       recordedWPs.forEach((wp, i) => {
//         const c=toC(wp.x,wp.y), isLast=i===recordedWPs.length-1, isFirst=i===0
//         if (isLast && recording) {
//           const grad=ctx.createRadialGradient(c.x,c.y,2,c.x,c.y,14)
//           grad.addColorStop(0,'rgba(200,0,10,0.3)'); grad.addColorStop(1,'rgba(200,0,10,0)')
//           ctx.beginPath(); ctx.arc(c.x,c.y,14,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill()
//         }
//         ctx.beginPath(); ctx.arc(c.x,c.y,isFirst?6:isLast?5.5:4,0,Math.PI*2)
//         ctx.fillStyle=isFirst?'rgba(34,197,94,0.85)':isLast?'#C8000A':'rgba(200,0,10,0.55)'; ctx.fill()
//         ctx.strokeStyle=isFirst?'#22c55e':isLast?'#ffffff':'rgba(200,0,10,0.7)'; ctx.lineWidth=1.5; ctx.stroke()
//         if (i===0||isLast||i%5===0) {
//           ctx.fillStyle=isLast?'rgba(255,255,255,0.8)':'rgba(200,0,10,0.6)'
//           ctx.font='8px monospace'; ctx.textAlign='center'; ctx.fillText(`#${i}`,c.x,c.y-9)
//         }
//       })
//     }

//     // ── Robot (AMCL) ─────────────────────────────────────────────────────────
//     if (robotPos) {
//       const rc=toC(robotPos.x,robotPos.y), yaw=robotPos.yaw??0
//       const grad=ctx.createRadialGradient(rc.x,rc.y,3,rc.x,rc.y,20)
//       grad.addColorStop(0,'rgba(0,210,255,0.3)'); grad.addColorStop(1,'rgba(0,210,255,0)')
//       ctx.beginPath(); ctx.arc(rc.x,rc.y,20,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill()
//       ctx.beginPath(); ctx.arc(rc.x,rc.y,9,0,Math.PI*2); ctx.fillStyle='rgba(0,200,255,0.95)'; ctx.fill()
//       ctx.strokeStyle='#ffffff'; ctx.lineWidth=2; ctx.stroke()
//       const ax=rc.x+Math.cos(yaw)*18, ay=rc.y-Math.sin(yaw)*18
//       ctx.beginPath(); ctx.moveTo(rc.x,rc.y); ctx.lineTo(ax,ay)
//       ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
//       const ang=Math.atan2(rc.y-ay,ax-rc.x)
//       ctx.beginPath()
//       ctx.moveTo(ax,ay); ctx.lineTo(ax-7*Math.cos(ang-0.5),ay+7*Math.sin(ang-0.5))
//       ctx.moveTo(ax,ay); ctx.lineTo(ax-7*Math.cos(ang+0.5),ay+7*Math.sin(ang+0.5))
//       ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke()
//     }

//     // ── Scale bar ────────────────────────────────────────────────────────────
//     const scale=viewRef.current?.scale||1
//     const scaleM=Math.pow(10,Math.floor(Math.log10(150/scale)))||1
//     const scalePx=scaleM*scale, sx=W-20-scalePx, sy=H-14
//     ctx.strokeStyle='rgba(232,232,232,0.35)'; ctx.lineWidth=1.5; ctx.setLineDash([])
//     ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+scalePx,sy)
//     ctx.moveTo(sx,sy-3); ctx.lineTo(sx,sy+3); ctx.moveTo(sx+scalePx,sy-3); ctx.lineTo(sx+scalePx,sy+3); ctx.stroke()
//     ctx.fillStyle='rgba(232,232,232,0.4)'; ctx.font='9px monospace'; ctx.textAlign='center'
//     ctx.fillText(`${scaleM}m`,sx+scalePx/2,sy-6)

//   }, [mapData, robotPos, recordedWPs, recording, fitView])

//   useEffect(() => { let raf; const loop=()=>{draw();raf=requestAnimationFrame(loop)}; raf=requestAnimationFrame(loop); return()=>cancelAnimationFrame(raf) }, [draw])

//   const onWheel = useCallback((e) => { e.preventDefault(); if(!viewRef.current)return; const f=e.deltaY<0?1.12:0.88; viewRef.current={...viewRef.current,scale:Math.max(4,Math.min(600,viewRef.current.scale*f))} }, [])
//   const onMouseDown = useCallback((e) => { if(!viewRef.current)return; dragRef.current={sx:e.clientX,sy:e.clientY,cx:viewRef.current.cx,cy:viewRef.current.cy} }, [])
//   const onMouseMove = useCallback((e) => { if(!dragRef.current||!viewRef.current)return; const dx=(e.clientX-dragRef.current.sx)/viewRef.current.scale, dy=(e.clientY-dragRef.current.sy)/viewRef.current.scale; viewRef.current={...viewRef.current,cx:dragRef.current.cx-dx,cy:dragRef.current.cy+dy} }, [])
//   const onMouseUp = useCallback(()=>{dragRef.current=null},[])

//   return <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair" onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
// }

// // ── CtrlBtn ───────────────────────────────────────────────────────────────────
// function CtrlBtn({ label, icon, onClick, disabled, variant='red' }) {
//   const colors = {
//     red:   {border:'rgba(200,0,10,0.5)',   bg:'rgba(200,0,10,0.1)',   text:'#C8000A'},
//     amber: {border:'rgba(245,158,11,0.4)', bg:'rgba(245,158,11,0.08)',text:'#f59e0b'},
//     ghost: {border:'rgba(255,255,255,0.1)',bg:'rgba(255,255,255,0.03)',text:'rgba(255,255,255,0.35)'},
//   }
//   const col = disabled ? colors.ghost : colors[variant]
//   return (
//     <button onClick={onClick} disabled={disabled}
//       className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all"
//       style={{borderColor:col.border,background:col.bg,color:col.text,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.45:1}}>
//       <span>{label}</span><span className="text-sm">{icon}</span>
//     </button>
//   )
// }

// function StatBox({ label, value, accent }) {
//   return (
//     <div className="bg-brand-black border border-brand-border px-2.5 py-1.5">
//       <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
//       <p className="font-mono text-[11px] truncate" style={{color:accent||'rgba(255,255,255,0.75)'}}>{String(value??'—')}</p>
//     </div>
//   )
// }

// // ── WaypointRecorder ──────────────────────────────────────────────────────────
// export default function WaypointRecorder() {
//   const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

//   const [status,      setStatus]      = useState({ recording: false, route: 'default', count: 0 })
//   const [routes,      setRoutes]      = useState([])
//   const [mapData,     setMapData]     = useState(null)
//   const [mapStatus,   setMapStatus]   = useState('waiting…')
//   const [robotPos,    setRobotPos]    = useState(null)
//   const [recordedWPs, setRecordedWPs] = useState([])

//   const [routeInput,   setRouteInput]   = useState('')
//   const [dropOpen,     setDropOpen]     = useState(false)
//   const [confirmClear, setConfirmClear] = useState(false)
//   const [eventLog,     setEventLog]     = useState([])
//   const logRef = useRef(null)

//   const addLog = useCallback((msg, type='info') =>
//     setEventLog(prev => [...prev.slice(-100), { t: Date.now(), msg, type }]), [])

//   useEffect(() => {
//     if (!ready) return
//     addLog('rosbridge connected', 'ok')

//     advertise(TOPIC.START,        'std_msgs/Empty')
//     advertise(TOPIC.STOP,         'std_msgs/Empty')
//     advertise(TOPIC.SET_ROUTE,    'std_msgs/String')
//     advertise(TOPIC.CLEAR_ROUTES, 'std_msgs/Empty')

//     const unsubs = [
//       // /map — TRANSIENT_LOCAL, use latch to get retained message immediately
//       subscribe(TOPIC.MAP, 'nav_msgs/OccupancyGrid', (msg) => {
//         const decoded = decodeOccupancyGrid(msg)
//         if (decoded) {
//           setMapData(decoded)
//           setMapStatus(`${msg.info.width}×${msg.info.height} @ ${msg.info.resolution.toFixed(3)}m/cell`)
//           addLog(`Map: ${msg.info.width}×${msg.info.height} cells`, 'info')
//         }
//       }, { queue_length: 0, latch: true }),

//       // /amcl_pose — localized pose in map frame
//       subscribe(TOPIC.AMCL, 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
//         const pos = msg.pose?.pose?.position
//         const ori = msg.pose?.pose?.orientation
//         if (!pos) return
//         let yaw = 0
//         if (ori) { const {x,y,z,w}=ori; yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z)) }
//         setRobotPos({ x: pos.x, y: pos.y, yaw })
//         // Append to trail while recording (min 0.3m step)
//         setStatus(prev => {
//           if (prev.recording) {
//             setRecordedWPs(wps => {
//               const last = wps[wps.length-1]
//               if (last) { const dx=pos.x-last.x,dy=pos.y-last.y; if(Math.sqrt(dx*dx+dy*dy)<0.3) return wps }
//               return [...wps, { x: pos.x, y: pos.y, yaw, index: wps.length }]
//             })
//           }
//           return prev
//         })
//       }),

//       // /odom — high-freq fallback until AMCL arrives
//       subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
//         const pos=msg.pose?.pose?.position, ori=msg.pose?.pose?.orientation
//         if (!pos) return
//         let yaw=0; if(ori){const{x,y,z,w}=ori;yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))}
//         setRobotPos(prev => prev ? prev : { x: pos.x, y: pos.y, yaw })
//       }),

//       // waypoint_recorder/status (latched)
//       subscribe(TOPIC.STATUS, 'std_msgs/String', (msg) => {
//         try {
//           const raw=typeof msg==='string'?msg:(msg?.data??'')
//           const parsed=JSON.parse(raw)
//           setStatus(prev => {
//             if (!prev.recording && parsed.recording) addLog(`Recording STARTED → "${parsed.route}"`, 'cmd')
//             if (prev.recording && !parsed.recording) { addLog(`STOPPED — ${parsed.count} WPs saved`, 'status'); setRecordedWPs([]) }
//             if (parsed.recording && parsed.count > prev.count) addLog(`WP #${parsed.count-1} recorded`, 'ok')
//             return parsed
//           })
//         } catch {}
//       }, { queue_length: 0, latch: true }),

//       // available_routes (latched)
//       subscribe(TOPIC.ROUTES, 'std_msgs/String', (msg) => {
//         try {
//           const raw=typeof msg==='string'?msg:(msg?.data??'')
//           const list=JSON.parse(raw)
//           if (!Array.isArray(list)) return
//           setRoutes(list)
//           addLog(`Routes: [${list.join(', ')}]`, 'info')
//         } catch(e) { addLog(`Routes parse error: ${e.message}`, 'info') }
//       }, { queue_length: 0, latch: true }),
//     ]

//     return () => unsubs.forEach(fn => fn?.())
//   }, [ready, subscribe, advertise, addLog])

//   useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [eventLog])

//   const sendStart = () => { setRecordedWPs([]); publish(TOPIC.START,'std_msgs/Empty',{}); addLog('→ START','cmd') }
//   const sendStop  = () => { publish(TOPIC.STOP,'std_msgs/Empty',{}); addLog('→ STOP','cmd') }
//   const sendSetRoute = (name) => { if(!name.trim())return; publish(TOPIC.SET_ROUTE,'std_msgs/String',{data:name.trim()}); addLog(`→ SET_ROUTE "${name.trim()}"`, 'cmd'); setDropOpen(false) }
//   const sendClearRoutes = () => { publish(TOPIC.CLEAR_ROUTES,'std_msgs/Empty',{}); addLog('→ CLEAR_ROUTES','cmd'); setConfirmClear(false) }

//   const isRecording = status.recording
//   const wsCol = wsStatus==='CONNECTED'?'#22c55e':wsStatus==='CONNECTING'?'#f59e0b':'#ef4444'
//   const recCol = isRecording
//     ? {text:'#ef4444',border:'rgba(239,68,68,0.35)',bg:'rgba(239,68,68,0.08)'}
//     : {text:'#94a3b8',border:'rgba(148,163,184,0.3)',bg:'rgba(148,163,184,0.06)'}

//   return (
//     <div className="h-full flex flex-col bg-brand-black overflow-hidden">

//       {/* Header */}
//       <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
//         <div className="flex items-center gap-3">
//           <div className="w-0.5 h-5 bg-brand-red" />
//           <div>
//             <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">Waypoint Recorder</h1>
//             <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">Mission Planning · MAP Frame · ROS2 TF</p>
//           </div>
//         </div>
//         <div className="flex items-center gap-3">
//           <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
//             style={{borderColor:`${wsCol}44`,background:`${wsCol}0d`,color:wsCol}}>
//             <span className="w-1.5 h-1.5 rounded-full" style={{background:wsCol}} />
//             rosbridge&nbsp;·&nbsp;{wsStatus}
//           </div>
//           <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
//             style={{borderColor:recCol.border,background:recCol.bg,color:recCol.text}}>
//             {isRecording && <span className="w-1.5 h-1.5 rounded-full" style={{background:'#ef4444',boxShadow:'0 0 6px #ef4444'}} />}
//             {isRecording ? 'RECORDING' : 'IDLE'}
//           </div>
//         </div>
//       </div>

//       {/* Body */}
//       <div className="flex-1 flex overflow-hidden min-h-0">

//         {/* Map area */}
//         <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">
//           <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
//             {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
//               'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls,i) => (
//               <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
//             ))}
//             <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
//               <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">Live Trail</span>
//               <span className="text-white/20 font-mono text-[9px]">·</span>
//               <span className="font-mono text-white/40 text-[9px] tracking-widest">{status.route}</span>
//               {isRecording && <><span className="text-white/20 font-mono text-[9px]">·</span>
//                 <span className="font-mono text-[9px]" style={{color:'#ef4444'}}>● {status.count} WPs</span></>}
//             </div>
//             <div className="absolute top-3 right-3 z-10 pointer-events-none">
//               <span className="font-mono text-white/20 text-[8px] tracking-widest">{mapStatus}</span>
//             </div>
//             <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
//               <span className="font-mono text-white/15 text-[7px] tracking-widest uppercase">scroll = zoom · drag = pan</span>
//             </div>
//             <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
//               {[
//                 {style:{width:10,height:10,borderRadius:'50%',border:'2px solid #22c55e',background:'rgba(34,197,94,0.4)',display:'inline-block'},label:'Start'},
//                 {style:{width:10,height:10,borderRadius:'50%',border:'2px solid rgba(200,0,10,0.7)',background:'rgba(200,0,10,0.4)',display:'inline-block'},label:'Waypoint'},
//                 {style:{width:10,height:10,borderRadius:'50%',border:'2px solid #fff',background:'rgba(0,200,255,0.9)',display:'inline-block'},label:'Robot'},
//               ].map(({style,label}) => (
//                 <div key={label} className="flex items-center gap-2">
//                   <div style={style}/><span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
//                 </div>
//               ))}
//             </div>
//             <RecorderMapCanvas mapData={mapData} robotPos={robotPos} recordedWPs={recordedWPs} recording={isRecording} />
//           </div>

//           {/* WP count bar */}
//           <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
//             <div className="flex items-center justify-between mb-2">
//               <span className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Waypoints Recorded</span>
//               <span className="font-mono text-[9px]" style={{color:isRecording?'#ef4444':'rgba(255,255,255,0.35)'}}>{status.count} WPs</span>
//             </div>
//             <div className="h-1.5 bg-white/5 rounded-sm overflow-hidden">
//               <div className="h-full rounded-sm transition-all duration-500"
//                 style={{width:`${Math.min(100,(status.count/30)*100)}%`,background:isRecording?'#C8000A':'rgba(200,0,10,0.3)',boxShadow:isRecording?'0 0 8px rgba(200,0,10,0.6)':'none'}} />
//             </div>
//           </div>
//         </div>

//         {/* Right panel */}
//         <div className="w-60 flex-shrink-0 flex flex-col border-l border-brand-border overflow-hidden">

//           {/* Route name */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border">
//             <div className="flex items-center justify-between mb-2.5">
//               <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Route Name</p>
//               <span className={`font-mono text-[8px] px-1.5 py-0.5 border tracking-widest ${routes.length>0?'border-green-500/30 text-green-400 bg-green-500/5':'border-brand-border text-white/20'}`}>
//                 {routes.length>0?`${routes.length} saved`:'none'}
//               </span>
//             </div>
//             <div className="flex gap-1 mb-2">
//               <input value={routeInput} onChange={e=>setRouteInput(e.target.value)}
//                 onKeyDown={e=>e.key==='Enter'&&sendSetRoute(routeInput)}
//                 disabled={isRecording} placeholder={status.route}
//                 className="flex-1 bg-brand-black border border-brand-border font-mono text-[10px] text-white/70 px-2.5 py-1.5 tracking-wide outline-none focus:border-brand-red/50 placeholder:text-white/15"
//                 style={{cursor:isRecording?'not-allowed':'text'}} />
//               <button onClick={()=>sendSetRoute(routeInput)} disabled={isRecording||!routeInput.trim()}
//                 className="px-2.5 py-1.5 border font-mono text-[9px] tracking-widest transition-all"
//                 style={{borderColor:isRecording||!routeInput.trim()?'rgba(255,255,255,0.08)':'rgba(200,0,10,0.5)',background:isRecording||!routeInput.trim()?'transparent':'rgba(200,0,10,0.1)',color:isRecording||!routeInput.trim()?'rgba(255,255,255,0.2)':'#C8000A',cursor:isRecording||!routeInput.trim()?'not-allowed':'pointer'}}>
//                 SET
//               </button>
//             </div>
//             <div className="relative">
//               <button onClick={()=>!isRecording&&routes.length&&setDropOpen(v=>!v)} disabled={isRecording||!routes.length}
//                 className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-wide transition-all"
//                 style={{borderColor:isRecording?'rgba(255,255,255,0.07)':'rgba(200,0,10,0.35)',background:isRecording?'rgba(255,255,255,0.02)':'rgba(200,0,10,0.05)',color:isRecording?'rgba(255,255,255,0.2)':'#e8e8e8',cursor:isRecording||!routes.length?'not-allowed':'pointer'}}>
//                 <span className="truncate text-[9px]">{routes.length?'Load saved route…':'No saved routes'}</span>
//                 <span className="text-white/25 ml-2 text-[10px]">▾</span>
//               </button>
//               {dropOpen && (<>
//                 <div className="fixed inset-0 z-30" onClick={()=>setDropOpen(false)} />
//                 <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-brand-card border border-brand-border shadow-2xl">
//                   {routes.map(r=>(
//                     <button key={r} onClick={()=>{sendSetRoute(r);setRouteInput(r);setDropOpen(false)}}
//                       className="w-full text-left px-3 py-2.5 font-mono text-[10px] tracking-wide hover:bg-brand-red/10 transition-colors flex items-center gap-2"
//                       style={{color:r===status.route?C.red:'#e8e8e8'}}>
//                       {r===status.route&&<span className="text-brand-red text-[8px]">▶</span>}{r}
//                     </button>
//                   ))}
//                 </div>
//               </>)}
//             </div>
//           </div>

//           {/* Stats */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
//             <StatBox label="Active Route" value={status.route} />
//             <StatBox label="WPs Recorded" value={status.count} accent={isRecording?'#ef4444':undefined} />
//             <StatBox label="Saved Routes" value={routes.length} />
//             <StatBox label="State" value={isRecording?'RECORDING':'IDLE'} accent={isRecording?'#ef4444':'#94a3b8'} />
//           </div>

//           {/* AMCL pose */}
//           <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">Robot · AMCL Pose</p>
//             <div className="grid grid-cols-3 gap-1">
//               {[['X',robotPos?robotPos.x.toFixed(2):'—'],['Y',robotPos?robotPos.y.toFixed(2):'—'],['Yaw°',robotPos?.yaw!=null?(robotPos.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
//                 <div key={l} className="bg-brand-black border border-brand-border px-1.5 py-1">
//                   <p className="font-mono text-[7px] text-white/20 uppercase">{l}</p>
//                   <p className="font-mono text-[10px] text-white/70">{v}</p>
//                 </div>
//               ))}
//             </div>
//           </div>

//           {/* Controls */}
//           <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-1">Recording Control</p>
//             <CtrlBtn label="Start Recording" icon="●" onClick={sendStart} disabled={isRecording||!ready} variant="red" />
//             <CtrlBtn label="Stop & Save"     icon="■" onClick={sendStop}  disabled={!isRecording||!ready} variant="amber" />
//             <div className="mt-1">
//               {!confirmClear ? (
//                 <CtrlBtn label="Clear All Routes" icon="✕" onClick={()=>setConfirmClear(true)} disabled={isRecording||!ready||routes.length===0} variant="ghost" />
//               ) : (
//                 <div className="border border-red-900/60 bg-red-950/20 p-2 flex flex-col gap-1.5">
//                   <p className="font-mono text-[8px] text-red-400/80 tracking-widest uppercase text-center">Delete ALL routes?</p>
//                   <div className="flex gap-1">
//                     <button onClick={sendClearRoutes} className="flex-1 py-1.5 border border-red-700/60 bg-red-900/20 font-mono text-[9px] text-red-400 tracking-widest uppercase hover:bg-red-900/40 transition-colors">Confirm</button>
//                     <button onClick={()=>setConfirmClear(false)} className="flex-1 py-1.5 border border-white/10 font-mono text-[9px] text-white/30 tracking-widest uppercase hover:bg-white/5 transition-colors">Cancel</button>
//                   </div>
//                 </div>
//               )}
//             </div>
//           </div>

//           {/* Saved routes list */}
//           <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">
//               Saved Routes{routes.length>0&&<span className="text-white/20 ml-1">({routes.length})</span>}
//             </p>
//             {routes.length===0 ? <p className="font-mono text-[9px] text-white/15 tracking-widest uppercase">none yet</p> : (
//               <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
//                 {routes.map((r,i)=>(
//                   <div key={r} className="flex items-center justify-between px-2 py-1 border"
//                     style={{borderColor:r===status.route?'rgba(200,0,10,0.4)':'rgba(255,255,255,0.06)',background:r===status.route?'rgba(200,0,10,0.06)':'transparent'}}>
//                     <div className="flex items-center gap-1.5">
//                       <span className="font-mono text-[7px] text-white/20">{String(i).padStart(2,'0')}</span>
//                       <span className="font-mono text-[9px] tracking-wide" style={{color:r===status.route?C.red:'rgba(255,255,255,0.5)'}}>{r}</span>
//                     </div>
//                     {r===status.route&&<span className="font-mono text-[7px] text-brand-red/60 tracking-widest">ACTIVE</span>}
//                   </div>
//                 ))}
//               </div>
//             )}
//           </div>

//           {/* Event log */}
//           <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
//             <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
//             <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
//               {eventLog.length===0&&<p className="font-mono text-[8px] text-white/10 tracking-widest uppercase">waiting…</p>}
//               {eventLog.map((e,i)=>(
//                 <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
//                   <span className="font-mono text-[7px] text-white/15 flex-shrink-0 mt-px">
//                     {new Date(e.t).toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}
//                   </span>
//                   <span className={`font-mono text-[9px] leading-tight break-all ${e.type==='cmd'?'text-brand-red':e.type==='ok'?'text-green-400':e.type==='status'?'text-amber-400':'text-white/35'}`}>{e.msg}</span>
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

const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'

const TOPIC = {
  STATUS:       'waypoint_recorder/status',
  ROUTES:       'available_routes',
  START:        'waypoint_recorder/start',
  STOP:         'waypoint_recorder/stop',
  SET_ROUTE:    'waypoint_recorder/set_route',
  CLEAR_ROUTES: 'waypoint_recorder/clear_routes',
  MAP:          '/map',
  AMCL:         '/amcl_pose',
  INITIAL_POSE: '/initialpose',
  SCAN:         '/scan',
  GOAL_POSE:    '/goal_pose',
}

const C = { red: '#C8000A', green: '#22c55e', amber: '#f59e0b' }

// ── useRosBridge ──────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef = useRef(null), subMap = useRef({}), advMap = useRef({})
  const [ready, setReady] = useState(false)
  const [wsStatus, setWsStatus] = useState('CONNECTING')
  const reconnectRef = useRef(null)

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return
    const ws = new WebSocket(url)
    wsRef.current = ws; setWsStatus('CONNECTING')
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
    ws.onerror = () => setWsStatus('ERROR')
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.op === 'publish')
          Object.values(subMap.current).filter(s => s.topic === msg.topic).forEach(s => s.cb(msg.msg))
      } catch {}
    }
  }, [url])

  useEffect(() => { connect(); return () => { clearTimeout(reconnectRef.current); wsRef.current?.close() } }, [connect])

  const subscribe = useCallback((topic, type, cb, opts = {}) => {
    const id = `sub_${topic.replace(/\//g, '_')}_${Date.now()}`
    subMap.current[id] = { topic, type, cb, opts }
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
    if (!advMap.current[topic]) { ws.send(JSON.stringify({ op: 'advertise', topic, type })); advMap.current[topic] = type }
    ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
  }, [])

  return { ready, wsStatus, subscribe, advertise, publish }
}

// ── decodeOccupancyGrid ───────────────────────────────────────────────────────
function decodeOccupancyGrid(mapMsg) {
  if (!mapMsg?.info || !mapMsg?.data) return null
  const { width, height, resolution, origin } = mapMsg.info
  if (!width || !height) return null
  const data = mapMsg.data
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    const canvasRow = height - 1 - row
    for (let col = 0; col < width; col++) {
      const v = data[row * width + col]
      const dst = (canvasRow * width + col) * 4
      if (v === -1)      { rgba[dst]=128; rgba[dst+1]=128; rgba[dst+2]=128; rgba[dst+3]=255 }
      else if (v === 0)  { rgba[dst]=205; rgba[dst+1]=205; rgba[dst+2]=205; rgba[dst+3]=255 }
      else { const d=Math.round(205-(v/100)*195); rgba[dst]=d; rgba[dst+1]=d; rgba[dst+2]=d; rgba[dst+3]=255 }
    }
  }
  return { imageData: new ImageData(rgba, width, height), width, height, resolution, originX: origin.position.x, originY: origin.position.y }
}

// ── RecorderMapCanvas ─────────────────────────────────────────────────────────
function RecorderMapCanvas({
  mapData, robotPos, recordedWPs, recording,
  scanPoints, initialPose, goalPose,
  activeMode, onMapClick, onMapMouseMove, onMapMouseUp,
  pendingClick, dragYaw,
}) {
  const canvasRef = useRef(null), viewRef = useRef(null)
  const tileRef = useRef(null), fittedRef = useRef(false)
  const panDragRef = useRef(null)

  // ── ALL hot-path props live in refs so the RAF draw loop reads the
  //    absolute latest value without waiting for React re-renders.
  //    This eliminates the robot-dot lag after publishing /initialpose.
  const robotPosRef      = useRef(robotPos)
  const scanPointsRef    = useRef(scanPoints)
  const initialPoseRef   = useRef(initialPose)
  const goalPoseRef      = useRef(goalPose)
  const pendingClickRef2 = useRef(pendingClick)
  const dragYawRef2      = useRef(dragYaw)
  const recordedWPsRef   = useRef(recordedWPs)
  const recordingRef     = useRef(recording)
  useEffect(() => { robotPosRef.current      = robotPos    }, [robotPos])
  useEffect(() => { scanPointsRef.current    = scanPoints  }, [scanPoints])
  useEffect(() => { initialPoseRef.current   = initialPose }, [initialPose])
  useEffect(() => { goalPoseRef.current      = goalPose    }, [goalPose])
  useEffect(() => { pendingClickRef2.current = pendingClick }, [pendingClick])
  useEffect(() => { dragYawRef2.current      = dragYaw     }, [dragYaw])
  useEffect(() => { recordedWPsRef.current   = recordedWPs }, [recordedWPs])
  useEffect(() => { recordingRef.current     = recording   }, [recording])

  // Keep latest event-handler props in refs so canvas handlers never go stale
  const activeModeRef     = useRef(activeMode)
  const onMapClickRef     = useRef(onMapClick)
  const onMapMouseMoveRef = useRef(onMapMouseMove)
  const onMapMouseUpRef   = useRef(onMapMouseUp)
  useEffect(() => { activeModeRef.current     = activeMode     }, [activeMode])
  useEffect(() => { onMapClickRef.current     = onMapClick     }, [onMapClick])
  useEffect(() => { onMapMouseMoveRef.current = onMapMouseMove }, [onMapMouseMove])
  useEffect(() => { onMapMouseUpRef.current   = onMapMouseUp   }, [onMapMouseUp])

  useEffect(() => {
    if (!mapData?.imageData) { tileRef.current = null; return }
    const tc = document.createElement('canvas')
    tc.width = mapData.width; tc.height = mapData.height
    tc.getContext('2d').putImageData(mapData.imageData, 0, 0)
    tileRef.current = tc; fittedRef.current = false
  }, [mapData])

  const fitView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !mapData) return
    const W = canvas.width || canvas.offsetWidth || 800
    const H = canvas.height || canvas.offsetHeight || 500
    if (!W || !H) return
    const minX = mapData.originX, minY = mapData.originY
    const maxX = mapData.originX + mapData.width * mapData.resolution
    const maxY = mapData.originY + mapData.height * mapData.resolution
    const scale = Math.min((W * 0.95) / (maxX - minX), (H * 0.95) / (maxY - minY))
    viewRef.current = { cx: (minX+maxX)/2, cy: (minY+maxY)/2, scale, W, H }
  }, [mapData])

  // draw reads ALL volatile values from refs — no hot-path props in deps.
  // The single stable RAF loop always paints the freshest data every frame
  // without waiting for React re-renders. This eliminates robot-dot lag.
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    if (W < 1 || H < 1) return
    let needFit = false
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; needFit = true }
    if (!viewRef.current || needFit || !fittedRef.current) { fitView(); fittedRef.current = true }
    if (!viewRef.current) return
    viewRef.current.W = W; viewRef.current.H = H

    // Read all hot-path values directly from refs (always current, zero React lag)
    const robotPos    = robotPosRef.current
    const scanPoints  = scanPointsRef.current
    const initialPose = initialPoseRef.current
    const goalPose    = goalPoseRef.current
    const pendingClick= pendingClickRef2.current
    const dragYaw     = dragYawRef2.current
    const recordedWPs = recordedWPsRef.current
    const recording   = recordingRef.current
    const activeMode  = activeModeRef.current

    const toC = (wx, wy) => {
      const v = viewRef.current
      return { x: (wx-v.cx)*v.scale + v.W/2, y: -(wy-v.cy)*v.scale + v.H/2 }
    }

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0a0e16'; ctx.fillRect(0, 0, W, H)

    // ── Occupancy grid ───────────────────────────────────────────────────────
    if (tileRef.current && mapData) {
      const { width, height, resolution, originX, originY } = mapData
      const tl = toC(originX, originY + height*resolution)
      const br = toC(originX + width*resolution, originY)
      const pw = br.x-tl.x, ph = br.y-tl.y
      if (pw > 2 && ph > 2) {
        ctx.save(); ctx.imageSmoothingEnabled = pw < width*2
        ctx.drawImage(tileRef.current, tl.x, tl.y, pw, ph); ctx.restore()
        ctx.strokeStyle='rgba(0,200,255,0.2)'; ctx.lineWidth=1; ctx.strokeRect(tl.x,tl.y,pw,ph)
      }
    } else {
      ctx.fillStyle='rgba(255,255,255,0.05)'
      for (let x=0;x<W;x+=40) for (let y=0;y<H;y+=40) ctx.fillRect(x-1,y-1,2,2)
      ctx.fillStyle='rgba(232,232,232,0.12)'; ctx.font='11px monospace'; ctx.textAlign='center'
      ctx.fillText('Waiting for /map…', W/2, H/2)
    }

    // ── Scan points (LiDAR) ──────────────────────────────────────────────────
    if (scanPoints?.length > 0) {
      ctx.fillStyle = 'rgba(255,200,0,0.7)'
      for (const pt of scanPoints) {
        const c = toC(pt.x, pt.y)
        if (c.x < 0 || c.x > W || c.y < 0 || c.y > H) continue
        ctx.beginPath(); ctx.arc(c.x, c.y, 1.5, 0, Math.PI*2); ctx.fill()
      }
    }

    // ── Recorded waypoint trail ──────────────────────────────────────────────
    if (recordedWPs?.length > 0) {
      if (recordedWPs.length > 1) {
        ctx.beginPath(); ctx.strokeStyle='rgba(200,0,10,0.5)'; ctx.lineWidth=2; ctx.setLineDash([6,4])
        recordedWPs.forEach((wp,i) => { const c=toC(wp.x,wp.y); i===0?ctx.moveTo(c.x,c.y):ctx.lineTo(c.x,c.y) })
        ctx.stroke(); ctx.setLineDash([])
      }
      recordedWPs.forEach((wp, i) => {
        const c=toC(wp.x,wp.y), isLast=i===recordedWPs.length-1, isFirst=i===0
        if (isLast && recording) {
          const grad=ctx.createRadialGradient(c.x,c.y,2,c.x,c.y,14)
          grad.addColorStop(0,'rgba(200,0,10,0.3)'); grad.addColorStop(1,'rgba(200,0,10,0)')
          ctx.beginPath(); ctx.arc(c.x,c.y,14,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill()
        }
        ctx.beginPath(); ctx.arc(c.x,c.y,isFirst?6:isLast?5.5:4,0,Math.PI*2)
        ctx.fillStyle=isFirst?'rgba(34,197,94,0.85)':isLast?'#C8000A':'rgba(200,0,10,0.55)'; ctx.fill()
        ctx.strokeStyle=isFirst?'#22c55e':isLast?'#ffffff':'rgba(200,0,10,0.7)'; ctx.lineWidth=1.5; ctx.stroke()
        if (i===0||isLast||i%5===0) {
          ctx.fillStyle=isLast?'rgba(255,255,255,0.8)':'rgba(200,0,10,0.6)'
          ctx.font='8px monospace'; ctx.textAlign='center'; ctx.fillText(`#${i}`,c.x,c.y-9)
        }
      })
    }

    // ── Initial Pose marker ──────────────────────────────────────────────────
    // Draw a distinctive marker: filled circle with cross-hair + direction arrow
    const drawInitPose = (wx, wy, yaw) => {
      const c = toC(wx, wy)
      const R = 12
      // Glow
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 28)
      grad.addColorStop(0, 'rgba(34,197,94,0.45)')
      grad.addColorStop(1, 'rgba(34,197,94,0)')
      ctx.beginPath(); ctx.arc(c.x, c.y, 28, 0, Math.PI*2); ctx.fillStyle=grad; ctx.fill()
      // Circle body
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI*2)
      ctx.fillStyle='rgba(34,197,94,0.25)'; ctx.fill()
      ctx.strokeStyle='#22c55e'; ctx.lineWidth=2.5; ctx.stroke()
      // Cross-hair
      ctx.strokeStyle='#22c55e'; ctx.lineWidth=1.5
      ctx.beginPath(); ctx.moveTo(c.x-R,c.y); ctx.lineTo(c.x+R,c.y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(c.x,c.y-R); ctx.lineTo(c.x,c.y+R); ctx.stroke()
      // Direction arrow
      const aLen=24, ax=c.x+Math.cos(yaw)*aLen, ay=c.y-Math.sin(yaw)*aLen
      ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(ax,ay)
      ctx.strokeStyle='#22c55e'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
      // Arrowhead
      const ang=Math.atan2(c.y-ay,ax-c.x)
      ctx.beginPath()
      ctx.moveTo(ax,ay); ctx.lineTo(ax-9*Math.cos(ang-0.45),ay+9*Math.sin(ang-0.45))
      ctx.moveTo(ax,ay); ctx.lineTo(ax-9*Math.cos(ang+0.45),ay+9*Math.sin(ang+0.45))
      ctx.strokeStyle='#22c55e'; ctx.lineWidth=2.5; ctx.stroke()
      // Label
      ctx.fillStyle='#22c55e'; ctx.font='bold 9px monospace'; ctx.textAlign='center'
      ctx.fillText('INIT', c.x, c.y - R - 7)
    }

    // ── Goal Pose marker ─────────────────────────────────────────────────────
    // Draw a distinctive marker: filled diamond/chevron shape + direction arrow
    const drawGoalPose = (wx, wy, yaw) => {
      const c = toC(wx, wy)
      const R = 12
      // Glow
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 28)
      grad.addColorStop(0, 'rgba(168,85,247,0.45)')
      grad.addColorStop(1, 'rgba(168,85,247,0)')
      ctx.beginPath(); ctx.arc(c.x, c.y, 28, 0, Math.PI*2); ctx.fillStyle=grad; ctx.fill()
      // Diamond body
      ctx.beginPath()
      ctx.moveTo(c.x, c.y - R)
      ctx.lineTo(c.x + R, c.y)
      ctx.lineTo(c.x, c.y + R)
      ctx.lineTo(c.x - R, c.y)
      ctx.closePath()
      ctx.fillStyle='rgba(168,85,247,0.25)'; ctx.fill()
      ctx.strokeStyle='#a855f7'; ctx.lineWidth=2.5; ctx.stroke()
      // Direction arrow
      const aLen=24, ax=c.x+Math.cos(yaw)*aLen, ay=c.y-Math.sin(yaw)*aLen
      ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(ax,ay)
      ctx.strokeStyle='#a855f7'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
      // Arrowhead
      const ang=Math.atan2(c.y-ay,ax-c.x)
      ctx.beginPath()
      ctx.moveTo(ax,ay); ctx.lineTo(ax-9*Math.cos(ang-0.45),ay+9*Math.sin(ang-0.45))
      ctx.moveTo(ax,ay); ctx.lineTo(ax-9*Math.cos(ang+0.45),ay+9*Math.sin(ang+0.45))
      ctx.strokeStyle='#a855f7'; ctx.lineWidth=2.5; ctx.stroke()
      // Label
      ctx.fillStyle='#a855f7'; ctx.font='bold 9px monospace'; ctx.textAlign='center'
      ctx.fillText('GOAL', c.x, c.y - R - 7)
    }

    if (initialPose) drawInitPose(initialPose.x, initialPose.y, initialPose.yaw)
    if (goalPose)    drawGoalPose(goalPose.x, goalPose.y, goalPose.yaw)

    // ── Robot (AMCL) ─────────────────────────────────────────────────────────
    if (robotPos) {
      const rc=toC(robotPos.x,robotPos.y), yaw=robotPos.yaw??0
      const grad=ctx.createRadialGradient(rc.x,rc.y,3,rc.x,rc.y,20)
      grad.addColorStop(0,'rgba(0,210,255,0.3)'); grad.addColorStop(1,'rgba(0,210,255,0)')
      ctx.beginPath(); ctx.arc(rc.x,rc.y,20,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill()
      ctx.beginPath(); ctx.arc(rc.x,rc.y,9,0,Math.PI*2); ctx.fillStyle='rgba(0,200,255,0.95)'; ctx.fill()
      ctx.strokeStyle='#ffffff'; ctx.lineWidth=2; ctx.stroke()
      const ax=rc.x+Math.cos(yaw)*18, ay=rc.y-Math.sin(yaw)*18
      ctx.beginPath(); ctx.moveTo(rc.x,rc.y); ctx.lineTo(ax,ay)
      ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
      const ang=Math.atan2(rc.y-ay,ax-rc.x)
      ctx.beginPath()
      ctx.moveTo(ax,ay); ctx.lineTo(ax-7*Math.cos(ang-0.5),ay+7*Math.sin(ang-0.5))
      ctx.moveTo(ax,ay); ctx.lineTo(ax-7*Math.cos(ang+0.5),ay+7*Math.sin(ang+0.5))
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke()
    }

    // ── Pending click crosshair (while dragging yaw) ──────────────────────────
    if (pendingClick && (activeMode === 'initial_pose' || activeMode === 'goal_pose')) {
      const c = toC(pendingClick.x, pendingClick.y)
      const color = activeMode === 'initial_pose' ? '#22c55e' : '#a855f7'
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3,3])
      ctx.beginPath(); ctx.arc(c.x, c.y, 18, 0, Math.PI*2); ctx.stroke()
      ctx.setLineDash([])
      if (dragYaw !== null) {
        const ax=c.x+Math.cos(dragYaw)*28, ay=c.y-Math.sin(dragYaw)*28
        ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(ax,ay)
        ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
      }
    }

    // ── Scale bar ────────────────────────────────────────────────────────────
    const scale=viewRef.current?.scale||1
    const scaleM=Math.pow(10,Math.floor(Math.log10(150/scale)))||1
    const scalePx=scaleM*scale, sx=W-20-scalePx, sy=H-14
    ctx.strokeStyle='rgba(232,232,232,0.35)'; ctx.lineWidth=1.5; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+scalePx,sy)
    ctx.moveTo(sx,sy-3); ctx.lineTo(sx,sy+3); ctx.moveTo(sx+scalePx,sy-3); ctx.lineTo(sx+scalePx,sy+3); ctx.stroke()
    ctx.fillStyle='rgba(232,232,232,0.4)'; ctx.font='9px monospace'; ctx.textAlign='center'
    ctx.fillText(`${scaleM}m`,sx+scalePx/2,sy-6)

  // Only mapData in deps — everything else is read live from refs
  }, [mapData, fitView])

  useEffect(() => {
    let raf; const loop=()=>{draw();raf=requestAnimationFrame(loop)}; raf=requestAnimationFrame(loop); return()=>cancelAnimationFrame(raf)
  }, [draw])

  const onWheel = useCallback((e) => {
    e.preventDefault(); if(!viewRef.current)return
    const f=e.deltaY<0?1.12:0.88
    viewRef.current={...viewRef.current,scale:Math.max(4,Math.min(600,viewRef.current.scale*f))}
  }, [])

  // All mouse handlers use refs so they never capture stale closures
  const onMouseDown = useCallback((e) => {
    if (!viewRef.current) return
    const mode = activeModeRef.current
    if (mode === 'initial_pose' || mode === 'goal_pose') {
      const rect = canvasRef.current.getBoundingClientRect()
      const v = viewRef.current
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top
      const world = { x: (cx - v.W/2) / v.scale + v.cx, y: -((cy - v.H/2) / v.scale) + v.cy }
      onMapClickRef.current?.(world, e)
      return
    }
    panDragRef.current = { sx: e.clientX, sy: e.clientY, cx: viewRef.current.cx, cy: viewRef.current.cy }
  }, [])

  const onMouseMove = useCallback((e) => {
    const mode = activeModeRef.current
    if (mode === 'initial_pose' || mode === 'goal_pose') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect || !viewRef.current) return
      const v = viewRef.current
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top
      const world = { x: (cx - v.W/2) / v.scale + v.cx, y: -((cy - v.H/2) / v.scale) + v.cy }
      onMapMouseMoveRef.current?.(world, e)
      return
    }
    if (!panDragRef.current || !viewRef.current) return
    const dx=(e.clientX-panDragRef.current.sx)/viewRef.current.scale
    const dy=(e.clientY-panDragRef.current.sy)/viewRef.current.scale
    viewRef.current={...viewRef.current,cx:panDragRef.current.cx-dx,cy:panDragRef.current.cy+dy}
  }, [])

  const onMouseUp = useCallback((e) => {
    const mode = activeModeRef.current
    if (mode === 'initial_pose' || mode === 'goal_pose') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect || !viewRef.current) return
      const v = viewRef.current
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top
      const world = { x: (cx - v.W/2) / v.scale + v.cx, y: -((cy - v.H/2) / v.scale) + v.cy }
      onMapMouseUpRef.current?.(world, e)
      return
    }
    panDragRef.current = null
  }, [])

  const cursor = activeMode === 'initial_pose' ? 'crosshair'
               : activeMode === 'goal_pose' ? 'crosshair'
               : 'grab'

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      style={{ cursor }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  )
}

// ── CtrlBtn ───────────────────────────────────────────────────────────────────
function CtrlBtn({ label, icon, onClick, disabled, variant='red' }) {
  const colors = {
    red:     {border:'rgba(200,0,10,0.5)',   bg:'rgba(200,0,10,0.1)',   text:'#C8000A'},
    amber:   {border:'rgba(245,158,11,0.4)', bg:'rgba(245,158,11,0.08)',text:'#f59e0b'},
    green:   {border:'rgba(34,197,94,0.4)',  bg:'rgba(34,197,94,0.08)', text:'#22c55e'},
    purple:  {border:'rgba(168,85,247,0.4)', bg:'rgba(168,85,247,0.08)',text:'#a855f7'},
    yellow:  {border:'rgba(234,179,8,0.4)',  bg:'rgba(234,179,8,0.08)', text:'#eab308'},
    ghost:   {border:'rgba(255,255,255,0.1)',bg:'rgba(255,255,255,0.03)',text:'rgba(255,255,255,0.35)'},
  }
  const col = disabled ? colors.ghost : colors[variant]
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all"
      style={{borderColor:col.border,background:col.bg,color:col.text,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.45:1}}>
      <span>{label}</span><span className="text-sm">{icon}</span>
    </button>
  )
}

function StatBox({ label, value, accent }) {
  return (
    <div className="bg-brand-black border border-brand-border px-2.5 py-1.5">
      <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
      <p className="font-mono text-[11px] truncate" style={{color:accent||'rgba(255,255,255,0.75)'}}>{String(value??'—')}</p>
    </div>
  )
}

// ── Mode pill button ──────────────────────────────────────────────────────────
function ModePill({ label, active, color, onClick }) {
  const colors = {
    green:  { border: active ? 'rgba(34,197,94,0.6)'  : 'rgba(34,197,94,0.15)',  bg: active ? 'rgba(34,197,94,0.15)'  : 'transparent', text: active ? '#22c55e'  : 'rgba(34,197,94,0.5)'  },
    yellow: { border: active ? 'rgba(234,179,8,0.6)'  : 'rgba(234,179,8,0.15)',  bg: active ? 'rgba(234,179,8,0.15)'  : 'transparent', text: active ? '#eab308'  : 'rgba(234,179,8,0.5)'  },
    purple: { border: active ? 'rgba(168,85,247,0.6)' : 'rgba(168,85,247,0.15)', bg: active ? 'rgba(168,85,247,0.15)' : 'transparent', text: active ? '#a855f7' : 'rgba(168,85,247,0.5)' },
  }
  const col = colors[color]
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[8px] tracking-widest uppercase transition-all rounded-sm"
      style={{ borderColor: col.border, background: col.bg, color: col.text }}>
      {active && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: col.text }} />}
      {label}
    </button>
  )
}

// ── WaypointRecorder ──────────────────────────────────────────────────────────
export default function WaypointRecorder() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

  const [status,      setStatus]      = useState({ recording: false, route: 'default', count: 0 })
  const [routes,      setRoutes]      = useState([])
  const [mapData,     setMapData]     = useState(null)
  const [mapStatus,   setMapStatus]   = useState('waiting…')
  const [robotPos,    setRobotPos]    = useState(null)
  const [recordedWPs, setRecordedWPs] = useState([])

  // New state
  const [scanPoints,   setScanPoints]   = useState([])
  const [scanActive,   setScanActive]   = useState(false)
  const [initialPose,  setInitialPose]  = useState(null)
  const [goalPose,     setGoalPose]     = useState(null)
  // activeMode: null | 'initial_pose' | 'goal_pose'
  const [activeMode,   setActiveMode]   = useState(null)
  // Drag-to-set-yaw state
  const [pendingClick, setPendingClick] = useState(null) // {x,y} world coords of first click
  const [dragYaw,      setDragYaw]      = useState(null)

  const [routeInput,   setRouteInput]   = useState('')
  const [dropOpen,     setDropOpen]     = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [eventLog,     setEventLog]     = useState([])
  const logRef = useRef(null)

  const addLog = useCallback((msg, type='info') =>
    setEventLog(prev => [...prev.slice(-100), { t: Date.now(), msg, type }]), [])

  // ── robotPos lives in BOTH state (for UI panels) AND a ref (for instant canvas) ──
  // The ref is updated synchronously inside the WS message handler — no React
  // scheduling delay — so the canvas RAF loop sees the new position on the
  // very next animation frame (~16 ms) instead of waiting for a re-render.
  const robotPosStateRef = useRef(null)   // mirror of robotPos state, for AMCL callback

  // ── ROS subscriptions ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')

    advertise(TOPIC.START,        'std_msgs/Empty')
    advertise(TOPIC.STOP,         'std_msgs/Empty')
    advertise(TOPIC.SET_ROUTE,    'std_msgs/String')
    advertise(TOPIC.CLEAR_ROUTES, 'std_msgs/Empty')
    advertise(TOPIC.INITIAL_POSE, 'geometry_msgs/msg/PoseWithCovarianceStamped')
    advertise(TOPIC.GOAL_POSE,    'geometry_msgs/msg/PoseStamped')

    const unsubs = [
      // /map
      subscribe(TOPIC.MAP, 'nav_msgs/OccupancyGrid', (msg) => {
        const decoded = decodeOccupancyGrid(msg)
        if (decoded) {
          setMapData(decoded)
          setMapStatus(`${msg.info.width}×${msg.info.height} @ ${msg.info.resolution.toFixed(3)}m/cell`)
          addLog(`Map: ${msg.info.width}×${msg.info.height} cells`, 'info')
        }
      }, { queue_length: 0, latch: true }),

      // /amcl_pose — write to ref immediately for zero-lag canvas,
      //              then setState for the UI sidebar panels
      subscribe(TOPIC.AMCL, 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
        const pos = msg.pose?.pose?.position
        const ori = msg.pose?.pose?.orientation
        if (!pos) return
        let yaw = 0
        if (ori) { const {x,y,z,w}=ori; yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z)) }
        const newPos = { x: pos.x, y: pos.y, yaw }
        // ← Synchronous ref write: canvas RAF reads this on the very next frame
        robotPosStateRef.current = newPos
        // ← State update: only needed for sidebar X/Y/Yaw readout
        setRobotPos(newPos)
        setStatus(prev => {
          if (prev.recording) {
            setRecordedWPs(wps => {
              const last = wps[wps.length-1]
              if (last) { const dx=pos.x-last.x,dy=pos.y-last.y; if(Math.sqrt(dx*dx+dy*dy)<0.3) return wps }
              return [...wps, { x: pos.x, y: pos.y, yaw, index: wps.length }]
            })
          }
          return prev
        })
      }),

      // /odom — fallback: always update ref (not just when state is null)
      //         so robot dot keeps moving even when AMCL is briefly silent
      subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
        const pos=msg.pose?.pose?.position, ori=msg.pose?.pose?.orientation
        if (!pos) return
        let yaw=0; if(ori){const{x,y,z,w}=ori;yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))}
        // Always update the draw ref for smooth movement
        if (!robotPosStateRef.current) {
          const newPos = { x: pos.x, y: pos.y, yaw }
          robotPosStateRef.current = newPos
          setRobotPos(newPos)
        }
      }),

      // waypoint_recorder/status
      subscribe(TOPIC.STATUS, 'std_msgs/String', (msg) => {
        try {
          const raw=typeof msg==='string'?msg:(msg?.data??'')
          const parsed=JSON.parse(raw)
          setStatus(prev => {
            if (!prev.recording && parsed.recording) addLog(`Recording STARTED → "${parsed.route}"`, 'cmd')
            if (prev.recording && !parsed.recording) { addLog(`STOPPED — ${parsed.count} WPs saved`, 'status'); setRecordedWPs([]) }
            if (parsed.recording && parsed.count > prev.count) addLog(`WP #${parsed.count-1} recorded`, 'ok')
            return parsed
          })
        } catch {}
      }, { queue_length: 0, latch: true }),

      // available_routes
      subscribe(TOPIC.ROUTES, 'std_msgs/String', (msg) => {
        try {
          const raw=typeof msg==='string'?msg:(msg?.data??'')
          const list=JSON.parse(raw)
          if (!Array.isArray(list)) return
          setRoutes(list)
          addLog(`Routes: [${list.join(', ')}]`, 'info')
        } catch(e) { addLog(`Routes parse error: ${e.message}`, 'info') }
      }, { queue_length: 0, latch: true }),
    ]

    return () => unsubs.forEach(fn => fn?.())
  }, [ready, subscribe, advertise, addLog])

  // Keep a ref to robotPos so scan callback always reads latest without re-subscribing
  const robotPosRef = useRef(null)
  useEffect(() => { robotPosRef.current = robotPos }, [robotPos])

  // ── Scan subscription (auto-on with init pose, manually toggleable) ───────
  useEffect(() => {
    if (!ready || !scanActive) { setScanPoints([]); return }
    addLog('Subscribed to /scan', 'ok')
    const unsub = subscribe(TOPIC.SCAN, 'sensor_msgs/msg/LaserScan', (msg) => {
      if (!msg) return
      const robot = robotPosRef.current
      if (!robot) return
      const { ranges, angle_min, angle_increment, range_min, range_max } = msg
      const pts = []
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i]
        if (r < range_min || r > range_max || !isFinite(r)) continue
        const angle = angle_min + i * angle_increment + (robot.yaw ?? 0)
        pts.push({ x: robot.x + r * Math.cos(angle), y: robot.y + r * Math.sin(angle) })
      }
      setScanPoints(pts)
    })
    return () => { unsub?.(); setScanPoints([]); addLog('Unsubscribed from /scan', 'info') }
  }, [ready, scanActive, subscribe, addLog])

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [eventLog])

  // ── Publish helpers ──────────────────────────────────────────────────────
  const sendStart      = () => { setRecordedWPs([]); publish(TOPIC.START,'std_msgs/Empty',{}); addLog('→ START','cmd') }
  const sendStop       = () => { publish(TOPIC.STOP,'std_msgs/Empty',{}); addLog('→ STOP','cmd') }
  const sendSetRoute   = (name) => { if(!name.trim())return; publish(TOPIC.SET_ROUTE,'std_msgs/String',{data:name.trim()}); addLog(`→ SET_ROUTE "${name.trim()}"`, 'cmd'); setDropOpen(false) }
  const sendClearRoutes= () => { publish(TOPIC.CLEAR_ROUTES,'std_msgs/Empty',{}); addLog('→ CLEAR_ROUTES','cmd'); setConfirmClear(false) }

  const publishInitialPose = useCallback((x, y, yaw) => {
    const z = Math.sin(yaw/2), w = Math.cos(yaw/2)
    publish(TOPIC.INITIAL_POSE, 'geometry_msgs/msg/PoseWithCovarianceStamped', {
      header: { frame_id: 'map' },
      pose: {
        pose: {
          position: { x, y, z: 0.0 },
          orientation: { x: 0.0, y: 0.0, z, w },
        },
        covariance: Array(36).fill(0),
      }
    })
    // ── Optimistic snap ──────────────────────────────────────────────────────
    // AMCL may take 100–500 ms to re-localize and publish back on /amcl_pose.
    // We immediately move the robot dot to where we told it to be, so the UI
    // feels instant. The next real /amcl_pose message will naturally override it.
    const optimistic = { x, y, yaw }
    robotPosStateRef.current = optimistic
    setRobotPos(optimistic)
    // ────────────────────────────────────────────────────────────────────────
    addLog(`→ /initialpose (${x.toFixed(2)}, ${y.toFixed(2)}, yaw=${(yaw*180/Math.PI).toFixed(1)}°)`, 'cmd')
  }, [publish, addLog])

  const publishGoalPose = useCallback((x, y, yaw) => {
    const z = Math.sin(yaw/2), w = Math.cos(yaw/2)
    publish(TOPIC.GOAL_POSE, 'geometry_msgs/msg/PoseStamped', {
      header: { frame_id: 'map' },
      pose: {
        position: { x, y, z: 0.0 },
        orientation: { x: 0.0, y: 0.0, z, w },
      }
    })
    addLog(`→ /goal_pose (${x.toFixed(2)}, ${y.toFixed(2)}, yaw=${(yaw*180/Math.PI).toFixed(1)}°)`, 'cmd')
  }, [publish, addLog])

  // ── Map interaction — use refs to avoid stale closures ──────────────────────
  const pendingClickRef = useRef(null)
  const dragYawRef      = useRef(null)
  const activeModeRef2  = useRef(null)
  // Keep ref in sync
  useEffect(() => { activeModeRef2.current = activeMode }, [activeMode])

  // Phase 1: MouseDown → record click world position
  const handleMapClick = useCallback((world) => {
    if (!world) return
    pendingClickRef.current = { x: world.x, y: world.y }
    dragYawRef.current = 0
    setPendingClick({ x: world.x, y: world.y })
    setDragYaw(0)
  }, [])

  // Phase 2: MouseMove → compute yaw from pending click to cursor
  const handleMapMouseMove = useCallback((world) => {
    const pc = pendingClickRef.current
    if (!pc || !world) return
    const dx = world.x - pc.x, dy = world.y - pc.y
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return
    const yaw = Math.atan2(dy, dx)
    dragYawRef.current = yaw
    setDragYaw(yaw)
  }, [])

  // Phase 3: MouseUp → commit and publish
  const handleMapMouseUp = useCallback((world) => {
    const pc = pendingClickRef.current
    if (!pc) return
    const dx = world ? world.x - pc.x : 0
    const dy = world ? world.y - pc.y : 0
    const yaw = (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)
      ? Math.atan2(dy, dx)
      : (dragYawRef.current ?? 0)
    const { x, y } = pc
    const mode = activeModeRef2.current
    if (mode === 'initial_pose') {
      setInitialPose({ x, y, yaw })
      publishInitialPose(x, y, yaw)
    } else if (mode === 'goal_pose') {
      setGoalPose({ x, y, yaw })
      publishGoalPose(x, y, yaw)
    }
    pendingClickRef.current = null; dragYawRef.current = null
    setPendingClick(null); setDragYaw(null)
  }, [publishInitialPose, publishGoalPose])

  const toggleMode = (mode) => {
    pendingClickRef.current = null; dragYawRef.current = null
    setPendingClick(null); setDragYaw(null)
    setActiveMode(prev => {
      const next = prev === mode ? null : mode
      // Auto-enable scan when entering initial_pose mode
      if (next === 'initial_pose') setScanActive(true)
      return next
    })
  }

  const isRecording = status.recording
  const wsCol = wsStatus==='CONNECTED'?'#22c55e':wsStatus==='CONNECTING'?'#f59e0b':'#ef4444'
  const recCol = isRecording
    ? {text:'#ef4444',border:'rgba(239,68,68,0.35)',bg:'rgba(239,68,68,0.08)'}
    : {text:'#94a3b8',border:'rgba(148,163,184,0.3)',bg:'rgba(148,163,184,0.06)'}

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">Waypoint Recorder</h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">Mission Planning · MAP Frame · ROS2 TF</p>
          </div>
          {/* Mode buttons right next to the title */}
          <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-brand-border">
            <ModePill
              label="Init Pose"
              active={activeMode === 'initial_pose'}
              color="green"
              onClick={() => toggleMode('initial_pose')}
            />
            <ModePill
              label="Scan"
              active={scanActive}
              color="yellow"
              onClick={() => { setScanActive(v => !v); addLog(scanActive ? 'Scan OFF' : 'Scan ON', 'info') }}
            />
            <ModePill
              label="Goal Pose"
              active={activeMode === 'goal_pose'}
              color="purple"
              onClick={() => toggleMode('goal_pose')}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{borderColor:`${wsCol}44`,background:`${wsCol}0d`,color:wsCol}}>
            <span className="w-1.5 h-1.5 rounded-full" style={{background:wsCol}} />
            rosbridge&nbsp;·&nbsp;{wsStatus}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{borderColor:recCol.border,background:recCol.bg,color:recCol.text}}>
            {isRecording && <span className="w-1.5 h-1.5 rounded-full" style={{background:'#ef4444',boxShadow:'0 0 6px #ef4444'}} />}
            {isRecording ? 'RECORDING' : 'IDLE'}
          </div>
        </div>
      </div>

      {/* Active mode hint bar */}
      {activeMode && (
        <div className="flex-shrink-0 px-5 py-1.5 border-b border-brand-border flex items-center gap-2"
          style={{
            background: activeMode === 'initial_pose' ? 'rgba(34,197,94,0.06)' : 'rgba(168,85,247,0.06)',
            borderColor: activeMode === 'initial_pose' ? 'rgba(34,197,94,0.2)' : 'rgba(168,85,247,0.2)',
          }}>
          <span className="font-mono text-[8px] tracking-widest uppercase"
            style={{color: activeMode === 'initial_pose' ? '#22c55e' : '#a855f7'}}>
            {activeMode === 'initial_pose' ? '⊕ Initial Pose Mode' : '◎ Goal Pose Mode'}
          </span>
          <span className="font-mono text-[8px] text-white/25 tracking-widest">
            — Click on map to set position, then drag to set orientation, release to confirm
          </span>
          <button onClick={() => setActiveMode(null)}
            className="ml-auto font-mono text-[8px] text-white/25 hover:text-white/50 tracking-widest uppercase transition-colors">
            ✕ cancel
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Map area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">
          <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
            {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
              'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls,i) => (
              <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
            ))}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">Live Trail</span>
              <span className="text-white/20 font-mono text-[9px]">·</span>
              <span className="font-mono text-white/40 text-[9px] tracking-widest">{status.route}</span>
              {isRecording && <><span className="text-white/20 font-mono text-[9px]">·</span>
                <span className="font-mono text-[9px]" style={{color:'#ef4444'}}>● {status.count} WPs</span></>}
              {scanActive && <><span className="text-white/20 font-mono text-[9px]">·</span>
                <span className="font-mono text-[9px]" style={{color:'#eab308'}}>◈ SCAN {scanPoints.length}pts</span></>}
            </div>
            <div className="absolute top-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/20 text-[8px] tracking-widest">{mapStatus}</span>
            </div>
            <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
              {!activeMode
                ? <span className="font-mono text-white/15 text-[7px] tracking-widest uppercase">scroll = zoom · drag = pan</span>
                : <span className="font-mono text-[7px] tracking-widest uppercase"
                    style={{color: activeMode==='initial_pose'?'rgba(34,197,94,0.5)':'rgba(168,85,247,0.5)'}}>
                    click + drag = set pose
                  </span>
              }
            </div>
            {/* Legend */}
            <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
              {[
                {style:{width:10,height:10,borderRadius:'50%',border:'2px solid #22c55e',background:'rgba(34,197,94,0.4)',display:'inline-block'},label:'Start WP'},
                {style:{width:10,height:10,borderRadius:'50%',border:'2px solid rgba(200,0,10,0.7)',background:'rgba(200,0,10,0.4)',display:'inline-block'},label:'Waypoint'},
                {style:{width:10,height:10,borderRadius:'50%',border:'2px solid #fff',background:'rgba(0,200,255,0.9)',display:'inline-block'},label:'Robot'},
                {style:{width:10,height:10,borderRadius:'50%',border:'2px solid #22c55e',background:'rgba(34,197,94,0.6)',display:'inline-block'},label:'Init Pose'},
                {style:{width:10,height:10,borderRadius:'50%',border:'2px solid #a855f7',background:'rgba(168,85,247,0.6)',display:'inline-block'},label:'Goal Pose'},
                {style:{width:10,height:10,borderRadius:'50%',border:'2px solid #eab308',background:'rgba(234,179,8,0.4)',display:'inline-block'},label:'LiDAR Pt'},
              ].map(({style,label}) => (
                <div key={label} className="flex items-center gap-2">
                  <div style={style}/><span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
                </div>
              ))}
            </div>
            <RecorderMapCanvas
              mapData={mapData}
              robotPos={robotPos}
              recordedWPs={recordedWPs}
              recording={isRecording}
              scanPoints={scanPoints}
              initialPose={initialPose}
              goalPose={goalPose}
              activeMode={activeMode}
              pendingClick={pendingClick}
              dragYaw={dragYaw}
              onMapClick={handleMapClick}
              onMapMouseMove={handleMapMouseMove}
              onMapMouseUp={handleMapMouseUp}
            />
          </div>

          {/* WP count bar */}
          <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Waypoints Recorded</span>
              <span className="font-mono text-[9px]" style={{color:isRecording?'#ef4444':'rgba(255,255,255,0.35)'}}>{status.count} WPs</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-sm overflow-hidden">
              <div className="h-full rounded-sm transition-all duration-500"
                style={{width:`${Math.min(100,(status.count/30)*100)}%`,background:isRecording?'#C8000A':'rgba(200,0,10,0.3)',boxShadow:isRecording?'0 0 8px rgba(200,0,10,0.6)':'none'}} />
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-60 flex-shrink-0 flex flex-col border-l border-brand-border overflow-y-auto">

          {/* Route name */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border">
            <div className="flex items-center justify-between mb-2.5">
              <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Route Name</p>
              <span className={`font-mono text-[8px] px-1.5 py-0.5 border tracking-widest ${routes.length>0?'border-green-500/30 text-green-400 bg-green-500/5':'border-brand-border text-white/20'}`}>
                {routes.length>0?`${routes.length} saved`:'none'}
              </span>
            </div>
            <div className="flex gap-1 mb-2">
              <input value={routeInput} onChange={e=>setRouteInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&sendSetRoute(routeInput)}
                disabled={isRecording} placeholder={status.route}
                className="flex-1 bg-brand-black border border-brand-border font-mono text-[10px] text-white/70 px-2.5 py-1.5 tracking-wide outline-none focus:border-brand-red/50 placeholder:text-white/15"
                style={{cursor:isRecording?'not-allowed':'text'}} />
              <button onClick={()=>sendSetRoute(routeInput)} disabled={isRecording||!routeInput.trim()}
                className="px-2.5 py-1.5 border font-mono text-[9px] tracking-widest transition-all"
                style={{borderColor:isRecording||!routeInput.trim()?'rgba(255,255,255,0.08)':'rgba(200,0,10,0.5)',background:isRecording||!routeInput.trim()?'transparent':'rgba(200,0,10,0.1)',color:isRecording||!routeInput.trim()?'rgba(255,255,255,0.2)':'#C8000A',cursor:isRecording||!routeInput.trim()?'not-allowed':'pointer'}}>
                SET
              </button>
            </div>
            <div className="relative">
              <button onClick={()=>!isRecording&&routes.length&&setDropOpen(v=>!v)} disabled={isRecording||!routes.length}
                className="w-full flex items-center justify-between px-3 py-2 border font-mono text-[10px] tracking-wide transition-all"
                style={{borderColor:isRecording?'rgba(255,255,255,0.07)':'rgba(200,0,10,0.35)',background:isRecording?'rgba(255,255,255,0.02)':'rgba(200,0,10,0.05)',color:isRecording?'rgba(255,255,255,0.2)':'#e8e8e8',cursor:isRecording||!routes.length?'not-allowed':'pointer'}}>
                <span className="truncate text-[9px]">{routes.length?'Load saved route…':'No saved routes'}</span>
                <span className="text-white/25 ml-2 text-[10px]">▾</span>
              </button>
              {dropOpen && (<>
                <div className="fixed inset-0 z-30" onClick={()=>setDropOpen(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-brand-card border border-brand-border shadow-2xl">
                  {routes.map(r=>(
                    <button key={r} onClick={()=>{sendSetRoute(r);setRouteInput(r);setDropOpen(false)}}
                      className="w-full text-left px-3 py-2.5 font-mono text-[10px] tracking-wide hover:bg-brand-red/10 transition-colors flex items-center gap-2"
                      style={{color:r===status.route?C.red:'#e8e8e8'}}>
                      {r===status.route&&<span className="text-brand-red text-[8px]">▶</span>}{r}
                    </button>
                  ))}
                </div>
              </>)}
            </div>
          </div>

          {/* Stats */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
            <StatBox label="Active Route" value={status.route} />
            <StatBox label="WPs Recorded" value={status.count} accent={isRecording?'#ef4444':undefined} />
            <StatBox label="Saved Routes" value={routes.length} />
            <StatBox label="State" value={isRecording?'RECORDING':'IDLE'} accent={isRecording?'#ef4444':'#94a3b8'} />
          </div>

          {/* AMCL pose */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">Robot · AMCL Pose</p>
            <div className="grid grid-cols-3 gap-1">
              {[['X',robotPos?robotPos.x.toFixed(2):'—'],['Y',robotPos?robotPos.y.toFixed(2):'—'],['Yaw°',robotPos?.yaw!=null?(robotPos.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
                <div key={l} className="bg-brand-black border border-brand-border px-1.5 py-1">
                  <p className="font-mono text-[7px] text-white/20 uppercase">{l}</p>
                  <p className="font-mono text-[10px] text-white/70">{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Initial Pose display */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] uppercase mb-2" style={{color:'rgba(34,197,94,0.5)'}}>Init Pose · /initialpose</p>
            <div className="grid grid-cols-3 gap-1">
              {[['X',initialPose?initialPose.x.toFixed(2):'—'],['Y',initialPose?initialPose.y.toFixed(2):'—'],['Yaw°',initialPose?.yaw!=null?(initialPose.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
                <div key={l} className="bg-brand-black border px-1.5 py-1" style={{borderColor:'rgba(34,197,94,0.15)'}}>
                  <p className="font-mono text-[7px] text-white/20 uppercase">{l}</p>
                  <p className="font-mono text-[10px]" style={{color:initialPose?'#22c55e':'rgba(255,255,255,0.25)'}}>{v}</p>
                </div>
              ))}
            </div>
            {initialPose && (
              <button onClick={() => setInitialPose(null)}
                className="mt-1.5 w-full font-mono text-[8px] tracking-widest uppercase text-white/20 hover:text-white/40 transition-colors text-center">
                clear ✕
              </button>
            )}
          </div>

          {/* Goal Pose display */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] uppercase mb-2" style={{color:'rgba(168,85,247,0.5)'}}>Goal Pose · /goal_pose</p>
            <div className="grid grid-cols-3 gap-1">
              {[['X',goalPose?goalPose.x.toFixed(2):'—'],['Y',goalPose?goalPose.y.toFixed(2):'—'],['Yaw°',goalPose?.yaw!=null?(goalPose.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
                <div key={l} className="bg-brand-black border px-1.5 py-1" style={{borderColor:'rgba(168,85,247,0.15)'}}>
                  <p className="font-mono text-[7px] text-white/20 uppercase">{l}</p>
                  <p className="font-mono text-[10px]" style={{color:goalPose?'#a855f7':'rgba(255,255,255,0.25)'}}>{v}</p>
                </div>
              ))}
            </div>
            {goalPose && (
              <button onClick={() => setGoalPose(null)}
                className="mt-1.5 w-full font-mono text-[8px] tracking-widest uppercase text-white/20 hover:text-white/40 transition-colors text-center">
                clear ✕
              </button>
            )}
          </div>

          {/* Scan status */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[8px] tracking-[0.3em] uppercase" style={{color:'rgba(234,179,8,0.5)'}}>LiDAR · /scan</p>
              <div className="flex items-center gap-1.5">
                {scanActive && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:'#eab308'}} />}
                <span className="font-mono text-[8px]" style={{color:scanActive?'#eab308':'rgba(255,255,255,0.2)'}}>
                  {scanActive ? `${scanPoints.length} pts` : 'OFF'}
                </span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-1">Recording Control</p>
            <CtrlBtn label="Start Recording" icon="●" onClick={sendStart} disabled={isRecording||!ready} variant="red" />
            <CtrlBtn label="Stop & Save"     icon="■" onClick={sendStop}  disabled={!isRecording||!ready} variant="amber" />
            <div className="mt-1">
              {!confirmClear ? (
                <CtrlBtn label="Clear All Routes" icon="✕" onClick={()=>setConfirmClear(true)} disabled={isRecording||!ready||routes.length===0} variant="ghost" />
              ) : (
                <div className="border border-red-900/60 bg-red-950/20 p-2 flex flex-col gap-1.5">
                  <p className="font-mono text-[8px] text-red-400/80 tracking-widest uppercase text-center">Delete ALL routes?</p>
                  <div className="flex gap-1">
                    <button onClick={sendClearRoutes} className="flex-1 py-1.5 border border-red-700/60 bg-red-900/20 font-mono text-[9px] text-red-400 tracking-widest uppercase hover:bg-red-900/40 transition-colors">Confirm</button>
                    <button onClick={()=>setConfirmClear(false)} className="flex-1 py-1.5 border border-white/10 font-mono text-[9px] text-white/30 tracking-widest uppercase hover:bg-white/5 transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Saved routes list */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">
              Saved Routes{routes.length>0&&<span className="text-white/20 ml-1">({routes.length})</span>}
            </p>
            {routes.length===0 ? <p className="font-mono text-[9px] text-white/15 tracking-widest uppercase">none yet</p> : (
              <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                {routes.map((r,i)=>(
                  <div key={r} className="flex items-center justify-between px-2 py-1 border"
                    style={{borderColor:r===status.route?'rgba(200,0,10,0.4)':'rgba(255,255,255,0.06)',background:r===status.route?'rgba(200,0,10,0.06)':'transparent'}}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[7px] text-white/20">{String(i).padStart(2,'0')}</span>
                      <span className="font-mono text-[9px] tracking-wide" style={{color:r===status.route?C.red:'rgba(255,255,255,0.5)'}}>{r}</span>
                    </div>
                    {r===status.route&&<span className="font-mono text-[7px] text-brand-red/60 tracking-widest">ACTIVE</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Event log */}
          <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
            <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
              {eventLog.length===0&&<p className="font-mono text-[8px] text-white/10 tracking-widest uppercase">waiting…</p>}
              {eventLog.map((e,i)=>(
                <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
                  <span className="font-mono text-[7px] text-white/15 flex-shrink-0 mt-px">
                    {new Date(e.t).toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                  </span>
                  <span className={`font-mono text-[9px] leading-tight break-all ${e.type==='cmd'?'text-brand-red':e.type==='ok'?'text-green-400':e.type==='status'?'text-amber-400':'text-white/35'}`}>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}