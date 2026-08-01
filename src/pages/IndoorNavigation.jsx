import { useEffect, useRef, useState, useCallback } from 'react'
import TeleopPanel from '../components/TeleopPanel'
import { useEnvironment } from '../context/EnvironmentContext'

const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'

const TOPIC = {
  MAP:          '/map',
  AMCL:         '/amcl_pose',
  SCAN:         '/scan',
  INITIAL_POSE: '/initialpose',
  GOAL_POSE:    '/goal_pose',
}

// ── useRosBridge ──────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef = useRef(null), subMap = useRef({}), advMap = useRef({})
  const idCounter = useRef(0)
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
      reconnectRef.current = setTimeout(connect, 2000)
    }
    ws.onerror  = () => setWsStatus('ERROR')
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
    const id = `sub_${++idCounter.current}_${topic.replace(/\//g, '_')}`
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
      if (v === -1)     { rgba[dst]=128; rgba[dst+1]=128; rgba[dst+2]=128; rgba[dst+3]=255 }
      else if (v === 0) { rgba[dst]=205; rgba[dst+1]=205; rgba[dst+2]=205; rgba[dst+3]=255 }
      else { const d=Math.round(205-(v/100)*195); rgba[dst]=d; rgba[dst+1]=d; rgba[dst+2]=d; rgba[dst+3]=255 }
    }
  }
  return { imageData: new ImageData(rgba, width, height), width, height, resolution, originX: origin.position.x, originY: origin.position.y }
}

// ── NavMapCanvas ──────────────────────────────────────────────────────────────
function NavMapCanvas({ mapData, robotPos, scanPoints, initialPose, goalPose, activeMode, onMapClick, onMapMouseMove, onMapMouseUp }) {
  const canvasRef  = useRef(null)
  const tileRef    = useRef(null)
  const viewRef    = useRef(null)
  const panDragRef = useRef(null)
  const fittedRef  = useRef(false)

  // Hot-path refs
  const robotRef    = useRef(robotPos);  useEffect(() => { robotRef.current    = robotPos    }, [robotPos])
  const scanRef     = useRef(scanPoints);useEffect(() => { scanRef.current     = scanPoints  }, [scanPoints])
  const initRef     = useRef(initialPose);useEffect(()=>{ initRef.current     = initialPose }, [initialPose])
  const goalRef     = useRef(goalPose);  useEffect(() => { goalRef.current     = goalPose    }, [goalPose])
  const modeRef     = useRef(activeMode);useEffect(() => { modeRef.current     = activeMode  }, [activeMode])
  const clickRef    = useRef(onMapClick);useEffect(() => { clickRef.current    = onMapClick  }, [onMapClick])
  const moveRef     = useRef(onMapMouseMove);useEffect(()=>{ moveRef.current   = onMapMouseMove},[onMapMouseMove])
  const upRef       = useRef(onMapMouseUp);useEffect(() =>{ upRef.current      = onMapMouseUp },[onMapMouseUp])

  // Pending drag state (for yaw drag)
  const pendingRef  = useRef(null)
  const dragYawRef  = useRef(null)

  useEffect(() => {
    if (!mapData?.imageData) { tileRef.current = null; return }
    const tc = document.createElement('canvas')
    tc.width = mapData.width; tc.height = mapData.height
    tc.getContext('2d').putImageData(mapData.imageData, 0, 0)
    tileRef.current = tc; fittedRef.current = false
  }, [mapData])

  const fitView = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas || !mapData) return
    const W = canvas.width || canvas.offsetWidth || 800
    const H = canvas.height || canvas.offsetHeight || 500
    if (!W || !H) return
    const scale = Math.min((W*0.92)/(mapData.width*mapData.resolution), (H*0.92)/(mapData.height*mapData.resolution))
    viewRef.current = {
      cx: mapData.originX + mapData.width*mapData.resolution/2,
      cy: mapData.originY + mapData.height*mapData.resolution/2,
      scale,
    }
  }, [mapData])

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    if (W < 1 || H < 1) return
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; fittedRef.current = false }
    if (!viewRef.current || !fittedRef.current) { fitView(); fittedRef.current = true }
    if (!viewRef.current) return

    const { cx, cy, scale } = viewRef.current
    const toC = (wx, wy) => ({ x: (wx-cx)*scale + W/2, y: -(wy-cy)*scale + H/2 })

    const robot    = robotRef.current
    const scan     = scanRef.current
    const initPose = initRef.current
    const goal     = goalRef.current
    const pending  = pendingRef.current
    const dragYaw  = dragYawRef.current

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0a0e16'; ctx.fillRect(0, 0, W, H)

    // Occupancy grid
    if (tileRef.current && mapData) {
      const { width, height, resolution, originX, originY } = mapData
      const tl = toC(originX, originY + height*resolution)
      const br = toC(originX + width*resolution, originY)
      const pw = br.x-tl.x, ph = br.y-tl.y
      if (pw > 2 && ph > 2) {
        ctx.save(); ctx.imageSmoothingEnabled = pw < width*2
        ctx.drawImage(tileRef.current, tl.x, tl.y, pw, ph); ctx.restore()
        ctx.strokeStyle='rgba(200,0,10,0.12)'; ctx.lineWidth=1; ctx.strokeRect(tl.x,tl.y,pw,ph)
      }
    } else {
      ctx.fillStyle='rgba(255,255,255,0.04)'
      for (let x=0;x<W;x+=40) for (let y=0;y<H;y+=40) ctx.fillRect(x-1,y-1,2,2)
      ctx.fillStyle='rgba(232,232,232,0.12)'; ctx.font='11px monospace'; ctx.textAlign='center'
      ctx.fillText('Waiting for /map…', W/2, H/2)
    }

    // Scan points
    if (scan?.length > 0) {
      ctx.fillStyle='rgba(255,0,0,1)'
      for (const pt of scan) {
        const c=toC(pt.x, pt.y)
        if (c.x<-20||c.x>W+20||c.y<-20||c.y>H+20) continue
        ctx.beginPath(); ctx.arc(c.x,c.y,1.5,0,Math.PI*2); ctx.fill()
      }
    }

    // Draw a pose marker helper
    const drawPoseMarker = (wx, wy, yaw, color, label) => {
      const c = toC(wx, wy), R = 11
      const grad = ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,26)
      grad.addColorStop(0,`${color}66`); grad.addColorStop(1,`${color}00`)
      ctx.beginPath(); ctx.arc(c.x,c.y,26,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill()
      ctx.beginPath(); ctx.arc(c.x,c.y,R,0,Math.PI*2)
      ctx.fillStyle=`${color}33`; ctx.fill()
      ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.stroke()
      // Crosshair
      ctx.strokeStyle=color; ctx.lineWidth=1.5
      ctx.beginPath(); ctx.moveTo(c.x-R,c.y); ctx.lineTo(c.x+R,c.y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(c.x,c.y-R); ctx.lineTo(c.x,c.y+R); ctx.stroke()
      // Arrow
      const aLen=22, ax=c.x+Math.cos(yaw)*aLen, ay=c.y-Math.sin(yaw)*aLen
      ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(ax,ay)
      ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
      const ang=Math.atan2(c.y-ay,ax-c.x)
      ctx.beginPath()
      ctx.moveTo(ax,ay); ctx.lineTo(ax-8*Math.cos(ang-0.45),ay+8*Math.sin(ang-0.45))
      ctx.moveTo(ax,ay); ctx.lineTo(ax-8*Math.cos(ang+0.45),ay+8*Math.sin(ang+0.45))
      ctx.strokeStyle=color; ctx.lineWidth=2; ctx.stroke()
      ctx.fillStyle=color; ctx.font='bold 8px monospace'; ctx.textAlign='center'
      ctx.fillText(label, c.x, c.y - R - 6)
    }

    // Pending drag preview
    if (pending) {
      const yaw = dragYaw ?? 0
      drawPoseMarker(pending.x, pending.y, yaw, modeRef.current==='initial_pose'?'#22c55e':'#a855f7', modeRef.current==='initial_pose'?'INIT…':'GOAL…')
    }

    // Committed initial pose
    if (initPose && !pending) {
      drawPoseMarker(initPose.x, initPose.y, initPose.yaw, '#22c55e', 'INIT')
    }

    // Committed goal pose
    if (goal && !pending) {
      drawPoseMarker(goal.x, goal.y, goal.yaw, '#a855f7', 'GOAL')
    }

    // Robot
    if (robot) {
      const rc=toC(robot.x,robot.y), yaw=robot.yaw??0
      const g=ctx.createRadialGradient(rc.x,rc.y,3,rc.x,rc.y,20)
      g.addColorStop(0,'rgba(0,210,255,0.3)'); g.addColorStop(1,'rgba(0,210,255,0)')
      ctx.beginPath(); ctx.arc(rc.x,rc.y,20,0,Math.PI*2); ctx.fillStyle=g; ctx.fill()
      ctx.beginPath(); ctx.arc(rc.x,rc.y,9,0,Math.PI*2); ctx.fillStyle='rgba(0,200,255,0.95)'; ctx.fill()
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke()
      const ax=rc.x+Math.cos(yaw)*18, ay=rc.y-Math.sin(yaw)*18
      ctx.beginPath(); ctx.moveTo(rc.x,rc.y); ctx.lineTo(ax,ay)
      ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
    }

    // Scale bar
    const scaleM=Math.pow(10,Math.floor(Math.log10(150/scale)))||1
    const scalePx=scaleM*scale, sx=W-20-scalePx, sy=H-14
    ctx.strokeStyle='rgba(232,232,232,0.3)'; ctx.lineWidth=1.5; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+scalePx,sy)
    ctx.moveTo(sx,sy-3); ctx.lineTo(sx,sy+3); ctx.moveTo(sx+scalePx,sy-3); ctx.lineTo(sx+scalePx,sy+3); ctx.stroke()
    ctx.fillStyle='rgba(232,232,232,0.35)'; ctx.font='9px monospace'; ctx.textAlign='center'
    ctx.fillText(`${scaleM}m`,sx+scalePx/2,sy-6)
  }, [mapData, fitView])

  useEffect(() => {
    let raf; const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  const worldFromEvent = (e) => {
    const canvas = canvasRef.current; if (!canvas || !viewRef.current) return null
    const rect = canvas.getBoundingClientRect()
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    const { cx, cy, scale } = viewRef.current
    const px = e.clientX - rect.left, py = e.clientY - rect.top
    return { x: (px - W/2) / scale + cx, y: -((py - H/2) / scale) + cy }
  }

  const onWheel = useCallback((e) => {
    e.preventDefault(); if (!viewRef.current) return
    viewRef.current = { ...viewRef.current, scale: Math.max(4, Math.min(600, viewRef.current.scale * (e.deltaY<0?1.12:0.88))) }
  }, [])

  const onMouseDown = useCallback((e) => {
    if (!viewRef.current) return
    const mode = modeRef.current
    if (mode === 'initial_pose' || mode === 'goal_pose') {
      const world = worldFromEvent(e)
      if (!world) return
      pendingRef.current = { x: world.x, y: world.y }
      dragYawRef.current = 0
      clickRef.current?.(world, e)
      return
    }
    panDragRef.current = { sx:e.clientX, sy:e.clientY, cx:viewRef.current.cx, cy:viewRef.current.cy }
  }, [])

  const onMouseMove = useCallback((e) => {
    const mode = modeRef.current
    if ((mode==='initial_pose'||mode==='goal_pose') && pendingRef.current) {
      const world = worldFromEvent(e); if (!world) return
      const pc = pendingRef.current
      const dx = world.x - pc.x, dy = world.y - pc.y
      if (Math.abs(dx)>0.01||Math.abs(dy)>0.01) dragYawRef.current = Math.atan2(dy, dx)
      moveRef.current?.(world, e)
      return
    }
    if (!panDragRef.current || !viewRef.current) return
    const dx=(e.clientX-panDragRef.current.sx)/viewRef.current.scale
    const dy=(e.clientY-panDragRef.current.sy)/viewRef.current.scale
    viewRef.current={...viewRef.current,cx:panDragRef.current.cx-dx,cy:panDragRef.current.cy+dy}
  }, [])

  const onMouseUp = useCallback((e) => {
    const mode = modeRef.current
    if ((mode==='initial_pose'||mode==='goal_pose') && pendingRef.current) {
      const world = worldFromEvent(e)
      const pc = pendingRef.current
      const dx = world ? world.x - pc.x : 0
      const dy = world ? world.y - pc.y : 0
      const yaw = (Math.abs(dx)>0.05||Math.abs(dy)>0.05) ? Math.atan2(dy,dx) : (dragYawRef.current??0)
      upRef.current?.({ x:pc.x, y:pc.y, yaw }, e)
      pendingRef.current = null; dragYawRef.current = null
      return
    }
    panDragRef.current = null
  }, [])

  const cursor = (activeMode==='initial_pose'||activeMode==='goal_pose') ? 'crosshair' : 'grab'

  return (
    <canvas ref={canvasRef} className="w-full h-full block" style={{ cursor }}
      onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
  )
}

// ── ModePill ──────────────────────────────────────────────────────────────────
function ModePill({ label, hint, active, color, onClick, disabled }) {
  const colors = {
    green:  { a: { border:'rgba(34,197,94,0.6)',  bg:'rgba(34,197,94,0.15)',  text:'#22c55e'  }, i: { border:'rgba(34,197,94,0.2)',  bg:'transparent', text:'rgba(34,197,94,0.5)'  } },
    purple: { a: { border:'rgba(168,85,247,0.6)', bg:'rgba(168,85,247,0.15)', text:'#a855f7' }, i: { border:'rgba(168,85,247,0.2)', bg:'transparent', text:'rgba(168,85,247,0.5)' } },
    yellow: { a: { border:'rgba(234,179,8,0.6)',  bg:'rgba(234,179,8,0.15)',  text:'#eab308'  }, i: { border:'rgba(234,179,8,0.2)',  bg:'transparent', text:'rgba(234,179,8,0.4)'  } },
  }
  const col = colors[color][active ? 'a' : 'i']
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex flex-col items-center gap-1 px-4 py-2.5 border transition-all"
      style={{ borderColor:col.border, background:col.bg, color:col.text, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.4:1, minWidth:80 }}>
      <div className="flex items-center gap-1.5">
        {active && <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background:col.text }} />}
        <span className="font-mono font-bold text-[11px] tracking-widest uppercase">{label}</span>
      </div>
      <span className="font-mono text-[8px] tracking-widest opacity-60 uppercase">{hint}</span>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IndoorNavigation() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)
  const { environment } = useEnvironment()
  const isOutdoor = environment === 'outdoor'

  const [mapData,     setMapData]     = useState(null)
  const [mapStatus,   setMapStatus]   = useState('waiting…')
  const [robotPos,    setRobotPos]    = useState(null)
  const robotPosRef = useRef(null)
  const [scanPoints,  setScanPoints]  = useState([])
  const [scanActive,  setScanActive]  = useState(false)
  const [initialPose, setInitialPose] = useState(null)
  const [goalPose,    setGoalPose]    = useState(null)
  // activeMode: null | 'initial_pose' | 'goal_pose'
  const [activeMode,  setActiveMode]  = useState(null)
  const activeModeRef = useRef(null)
  useEffect(() => { activeModeRef.current = activeMode }, [activeMode])

  const [panelWidth, setPanelWidth] = useState(320)
  const splitDragRef = useRef(null)

  const [eventLog, setEventLog] = useState([])
  const logRef = useRef(null)
  const addLog = useCallback((msg, type='info') =>
    setEventLog(prev => [...prev.slice(-100), { t:Date.now(), msg, type }]), [])

  // ── Subscriptions ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')
    advertise(TOPIC.INITIAL_POSE, 'geometry_msgs/msg/PoseWithCovarianceStamped')
    advertise(TOPIC.GOAL_POSE,    'geometry_msgs/msg/PoseStamped')

    const unsubs = [
      subscribe(TOPIC.MAP, 'nav_msgs/OccupancyGrid', (msg) => {
        const d = decodeOccupancyGrid(msg)
        if (d) { setMapData(d); setMapStatus(`${msg.info.width}×${msg.info.height} @ ${msg.info.resolution.toFixed(3)}m/cell`); addLog(`Map: ${msg.info.width}×${msg.info.height}`, 'info') }
      }, { queue_length:0, latch:true }),

      subscribe(TOPIC.AMCL, 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
        const pos=msg.pose?.pose?.position, ori=msg.pose?.pose?.orientation
        if (!pos) return
        let yaw=0; if(ori){const{x,y,z,w}=ori;yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))}
        const np={x:pos.x,y:pos.y,yaw}; robotPosRef.current=np; setRobotPos(np)
      }),

      subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
        const pos=msg.pose?.pose?.position, ori=msg.pose?.pose?.orientation
        if (!pos) return
        let yaw=0; if(ori){const{x,y,z,w}=ori;yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))}
        if (!robotPosRef.current) { const np={x:pos.x,y:pos.y,yaw}; robotPosRef.current=np; setRobotPos(np) }
      }),
    ]
    return () => unsubs.forEach(fn => fn?.())
  }, [ready])

  // Scan subscription
  useEffect(() => {
    if (!ready || !scanActive) { setScanPoints([]); return }
    addLog('Subscribed to /scan', 'ok')
    const unsub = subscribe(TOPIC.SCAN, 'sensor_msgs/LaserScan', (msg) => {
      const robot = robotPosRef.current; if (!robot || !msg) return
      const { ranges, angle_min, angle_increment, range_min, range_max } = msg
      const pts = []
      for (let i=0;i<ranges.length;i++) {
        const r=ranges[i]
        if (r<range_min||r>range_max||!isFinite(r)) continue
        const angle=angle_min+i*angle_increment+(robot.yaw??0)
        pts.push({ x:robot.x+r*Math.cos(angle), y:robot.y+r*Math.sin(angle) })
      }
      setScanPoints(pts)
    })
    return () => { unsub?.(); setScanPoints([]); addLog('Unsubscribed /scan','info') }
  }, [ready, scanActive, subscribe, addLog])

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [eventLog])

  // ── Publish helpers ──────────────────────────────────────────────────────
  const publishInitialPose = useCallback((x, y, yaw) => {
    const z=Math.sin(yaw/2), w=Math.cos(yaw/2)
    publish(TOPIC.INITIAL_POSE, 'geometry_msgs/msg/PoseWithCovarianceStamped', {
      header: { frame_id:'map' },
      pose: { pose: { position:{x,y,z:0}, orientation:{x:0,y:0,z,w} }, covariance: Array(36).fill(0) }
    })
    const optimistic = { x, y, yaw }
    robotPosRef.current = optimistic; setRobotPos(optimistic)
    addLog(`→ /initialpose (${x.toFixed(2)}, ${y.toFixed(2)}, yaw=${(yaw*180/Math.PI).toFixed(1)}°)`, 'cmd')
  }, [publish, addLog])

  const publishGoalPose = useCallback((x, y, yaw) => {
    const z=Math.sin(yaw/2), w=Math.cos(yaw/2)
    publish(TOPIC.GOAL_POSE, 'geometry_msgs/msg/PoseStamped', {
      header: { frame_id:'map' },
      pose: { position:{x,y,z:0}, orientation:{x:0,y:0,z,w} }
    })
    addLog(`→ /goal_pose (${x.toFixed(2)}, ${y.toFixed(2)}, yaw=${(yaw*180/Math.PI).toFixed(1)}°)`, 'cmd')
  }, [publish, addLog])

  // Map interaction
  const handleMapClick = useCallback((world) => {}, [])
  const handleMapMouseMove = useCallback((world) => {}, [])
  const handleMapMouseUp = useCallback((worldWithYaw) => {
    const mode = activeModeRef.current
    if (!worldWithYaw) return
    const { x, y, yaw } = worldWithYaw
    if (mode === 'initial_pose') {
      setInitialPose({ x, y, yaw })
      publishInitialPose(x, y, yaw)
      setActiveMode(null)
    } else if (mode === 'goal_pose') {
      setGoalPose({ x, y, yaw })
      publishGoalPose(x, y, yaw)
      setActiveMode(null)
    }
  }, [publishInitialPose, publishGoalPose])

  const toggleMode = (mode) => {
    setActiveMode(prev => prev === mode ? null : mode)
  }

  // Splitter drag
  const onSplitMouseDown = (e) => {
    e.preventDefault()
    splitDragRef.current = { startX: e.clientX, startW: panelWidth }
    const onMove = (me) => {
      const delta = splitDragRef.current.startX - me.clientX
      setPanelWidth(Math.max(260, Math.min(560, splitDragRef.current.startW + delta)))
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const wsCol = wsStatus==='CONNECTED'?'#22c55e':wsStatus==='CONNECTING'?'#f59e0b':'#ef4444'

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-brand-border flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red flex-shrink-0" />
          <div>
            <h1 className="font-mono font-bold text-white text-sm tracking-widest uppercase leading-none">{isOutdoor ? 'Outdoor Navigation' : 'Indoor Navigation'}</h1>
            <p className="font-mono text-white/30 text-[8px] tracking-[0.2em] uppercase mt-1">Localization · Goal Pose · Teleop</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[9px] tracking-widest uppercase"
            style={{ borderColor:`${wsCol}44`, background:`${wsCol}0d`, color:wsCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background:wsCol }} />
            {wsStatus}
          </div>
          {activeMode && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[9px] tracking-widest uppercase"
              style={{ borderColor:activeMode==='initial_pose'?'rgba(34,197,94,0.5)':'rgba(168,85,247,0.5)', background:activeMode==='initial_pose'?'rgba(34,197,94,0.1)':'rgba(168,85,247,0.1)', color:activeMode==='initial_pose'?'#22c55e':'#a855f7' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background:activeMode==='initial_pose'?'#22c55e':'#a855f7' }} />
              {activeMode==='initial_pose'?'SET INIT POSE':'SET GOAL POSE'}
            </div>
          )}
        </div>
      </div>

      {/* Mode hint bar */}
      {activeMode && (
        <div className="flex-shrink-0 px-4 py-2 border-b flex items-center gap-3 flex-wrap"
          style={{
            background: activeMode==='initial_pose'?'rgba(34,197,94,0.06)':'rgba(168,85,247,0.06)',
            borderColor: activeMode==='initial_pose'?'rgba(34,197,94,0.2)':'rgba(168,85,247,0.2)',
          }}>
          <span className="font-mono text-[9px] tracking-widest uppercase"
            style={{ color:activeMode==='initial_pose'?'#22c55e':'#a855f7' }}>
            {activeMode==='initial_pose'?'⊕ Click to set initial position':'◎ Click to set goal position'}
          </span>
          <span className="font-mono text-[9px] text-white/25 tracking-widest">→ click on map → drag to set orientation → release</span>
          <button onClick={() => setActiveMode(null)} className="ml-auto font-mono text-[9px] text-white/25 hover:text-white/55 tracking-widest uppercase transition-colors">✕ cancel</button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* MAP */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3 overflow-hidden">
          <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
            {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
              'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls,i) => (
              <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
            ))}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">Occupancy Grid</span>
            </div>
            <div className="absolute top-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/20 text-[8px]">{mapStatus}</span>
            </div>
            <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/15 text-[7px] tracking-widest uppercase">
                scroll=zoom · {activeMode ? 'click=set · drag=orient' : 'drag=pan'}
              </span>
            </div>
            {/* Legend */}
            <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
              {[
                { color:'rgba(0,200,255,0.9)', label:'Robot (AMCL)' },
                { color:'#22c55e',             label:'Initial Pose' },
                { color:'#a855f7',             label:'Goal Pose'    },
                { color:'rgba(255,200,0,0.7)', label:'LiDAR Scan'   },
              ].map(({color, label}) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background:color }} />
                  <span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
                </div>
              ))}
            </div>

            <NavMapCanvas
              mapData={mapData}
              robotPos={robotPos}
              scanPoints={scanPoints}
              initialPose={initialPose}
              goalPose={goalPose}
              activeMode={activeMode}
              onMapClick={handleMapClick}
              onMapMouseMove={handleMapMouseMove}
              onMapMouseUp={handleMapMouseUp}
            />
          </div>

          {/* Robot pose readout bar */}
          <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-2.5 flex items-center gap-4 flex-wrap">
            <span className="font-mono text-[9px] text-white/30 tracking-widest uppercase flex-shrink-0">AMCL</span>
            {[['X',robotPos?robotPos.x.toFixed(3):'—'],['Y',robotPos?robotPos.y.toFixed(3):'—'],['Yaw°',robotPos?.yaw!=null?(robotPos.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
              <div key={l} className="flex items-center gap-2">
                <span className="font-mono text-[8px] text-white/20 uppercase">{l}</span>
                <span className="font-mono text-[11px] text-white/65">{v}</span>
              </div>
            ))}
            <div className="flex-1" />
            {scanActive && (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background:'#eab308' }} />
                <span className="font-mono text-[9px] text-yellow-400 tracking-widest">{scanPoints.length} scan pts</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Draggable splitter ── */}
        <div onMouseDown={onSplitMouseDown}
          className="flex-shrink-0 w-2 bg-brand-dark border-x border-brand-border cursor-col-resize hover:bg-brand-red/20 transition-colors flex items-center justify-center group">
          <div className="flex flex-col gap-0.5">
            {[0,1,2,3,4].map(i=><div key={i} className="w-0.5 h-1 bg-white/15 group-hover:bg-brand-red/50 transition-colors" />)}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{ width:panelWidth, minWidth:260, maxWidth:560 }}
          className="flex-shrink-0 flex flex-col border-l border-brand-border overflow-hidden">

          <div className="flex-1 overflow-y-auto flex flex-col">

            {/* Three mode buttons */}
            <div className="flex-shrink-0 p-4 border-b border-brand-border">
              <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold mb-3">Map Tools</p>
              <div className="flex gap-2 flex-wrap">
                <ModePill
                  label="Init Pose"
                  hint="/initialpose"
                  active={activeMode === 'initial_pose'}
                  color="green"
                  onClick={() => toggleMode('initial_pose')}
                  disabled={!ready}
                />
                <ModePill
                  label="Scan"
                  hint="/scan"
                  active={scanActive}
                  color="yellow"
                  onClick={() => { setScanActive(v => !v); addLog(scanActive ? 'Scan OFF' : 'Scan ON', 'info') }}
                  disabled={!ready}
                />
                <ModePill
                  label="Goal Pose"
                  hint="/goal_pose"
                  active={activeMode === 'goal_pose'}
                  color="purple"
                  onClick={() => toggleMode('goal_pose')}
                  disabled={!ready}
                />
              </div>
            </div>

            {/* Pose readouts */}
            <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-3">
              {/* Initial pose */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-mono text-[9px] tracking-widest uppercase" style={{ color:'rgba(34,197,94,0.6)' }}>Initial Pose · /initialpose</p>
                  {initialPose && <button onClick={() => setInitialPose(null)} className="font-mono text-[8px] text-white/20 hover:text-white/50 tracking-widest transition-colors">clear ✕</button>}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[['X',initialPose?initialPose.x.toFixed(2):'—'],['Y',initialPose?initialPose.y.toFixed(2):'—'],['Yaw°',initialPose?.yaw!=null?(initialPose.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
                    <div key={l} className="border px-2 py-1.5" style={{ background:'rgba(0,0,0,0.3)', borderColor:initialPose?'rgba(34,197,94,0.18)':'rgba(255,255,255,0.07)' }}>
                      <p className="font-mono text-[8px] text-white/20 uppercase">{l}</p>
                      <p className="font-mono text-[11px]" style={{ color:initialPose?'#22c55e':'rgba(255,255,255,0.3)' }}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>
              {/* Goal pose */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-mono text-[9px] tracking-widest uppercase" style={{ color:'rgba(168,85,247,0.6)' }}>Goal Pose · /goal_pose</p>
                  {goalPose && <button onClick={() => setGoalPose(null)} className="font-mono text-[8px] text-white/20 hover:text-white/50 tracking-widest transition-colors">clear ✕</button>}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[['X',goalPose?goalPose.x.toFixed(2):'—'],['Y',goalPose?goalPose.y.toFixed(2):'—'],['Yaw°',goalPose?.yaw!=null?(goalPose.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
                    <div key={l} className="border px-2 py-1.5" style={{ background:'rgba(0,0,0,0.3)', borderColor:goalPose?'rgba(168,85,247,0.18)':'rgba(255,255,255,0.07)' }}>
                      <p className="font-mono text-[8px] text-white/20 uppercase">{l}</p>
                      <p className="font-mono text-[11px]" style={{ color:goalPose?'#a855f7':'rgba(255,255,255,0.3)' }}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* TeleopPanel */}
            <div className="flex-shrink-0 px-4 py-4 border-b border-brand-border">
              <TeleopPanel publish={publish} ready={ready} defaultOpen />
            </div>

            {/* Event log */}
            <div className="flex-1 flex flex-col min-h-0 p-4" style={{ minHeight:140 }}>
              <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold mb-2 flex-shrink-0">Event Log</p>
              <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
                {eventLog.length===0&&<p className="font-mono text-[8px] text-white/10 tracking-widest uppercase">waiting…</p>}
                {eventLog.map((e,i)=>(
                  <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
                    <span className="font-mono text-[8px] text-white/15 flex-shrink-0">
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
    </div>
  )
}
