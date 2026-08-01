
import { useEffect, useRef, useState, useCallback } from 'react'
import TeleopPanel from '../components/TeleopPanel'
import { useScan, ScanButton, drawScanPoints } from '../components/ScanOverlay'


const API_BASE      = 'https://trovcamera.edgeforce.in'
const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'
const CMD_VEL       = '/cmd_vel_safe'
// ── Topics matching indoor_waypoint_recorder.py ───────────────────────────────
const TOPIC = {
  STATUS:              'waypoint_recorder/status',
  ROUTES:              'available_routes_recorder',
  START:               'waypoint_recorder/start',
  STOP:                'waypoint_recorder/stop',
  SET_ROUTE:           'waypoint_recorder/set_route',
  CLEAR_ROUTES:        'waypoint_recorder/clear_routes',
  START_MAP_SELECT:    'waypoint_recorder/start_map_select',
  ADD_POINT:           'waypoint_recorder/add_point',
  GENERATE_INTERP:     'waypoint_recorder/generate_interpolated',
  CANCEL_MAP_SELECT:   'waypoint_recorder/cancel_map_select',
  MAP:                 '/map',
  AMCL:                '/amcl_pose',
}

const C = { red: '#C8000A', green: '#22c55e', amber: '#f59e0b' }

// ── Status shape from node:
// { mode, recording, map, route, count, pending_points }
// mode: 'idle' | 'drive' | 'map_select'

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

// ── RecorderMapCanvas ─────────────────────────────────────────────────────────
function RecorderMapCanvas({ mapData, robotPos, recordedWPs, recording, pendingMapPoints, mapSelectMode, onMapClick , scanPoints, scanPointsRef}) {
  const canvasRef  = useRef(null)
  const tileRef    = useRef(null)
  const viewRef    = useRef(null)
  const dragRef    = useRef(null)
  const fittedRef  = useRef(false)
  const scanRef = useRef(scanPoints) ; useEffect(() => { scanRef.current = scanPoints }, [scanPoints])

  // Hot-path refs — canvas RAF reads these directly, no React lag
  const robotPosRef     = useRef(robotPos)
  const recordedRef     = useRef(recordedWPs)
  const recordingRef    = useRef(recording)
  const pendingRef      = useRef(pendingMapPoints)
  const mapSelectRef    = useRef(mapSelectMode)
  const onMapClickRef   = useRef(onMapClick)
  useEffect(() => { robotPosRef.current   = robotPos       }, [robotPos])
  useEffect(() => { recordedRef.current   = recordedWPs    }, [recordedWPs])
  useEffect(() => { recordingRef.current  = recording      }, [recording])
  useEffect(() => { pendingRef.current    = pendingMapPoints }, [pendingMapPoints])
  useEffect(() => { mapSelectRef.current  = mapSelectMode   }, [mapSelectMode])
  useEffect(() => { onMapClickRef.current = onMapClick      }, [onMapClick])

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
    const minX = mapData.originX, minY = mapData.originY
    const maxX = mapData.originX + mapData.width * mapData.resolution
    const maxY = mapData.originY + mapData.height * mapData.resolution
    const scale = Math.min((W * 0.92) / (maxX - minX), (H * 0.92) / (maxY - minY))
    viewRef.current = { cx: (minX+maxX)/2, cy: (minY+maxY)/2, scale }
  }, [mapData])

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
     const scan     = scanRef.current;
      if (!canvas) return
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    if (W < 1 || H < 1) return
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; fittedRef.current = false }
    if (!viewRef.current || !fittedRef.current) { fitView(); fittedRef.current = true }
    if (!viewRef.current) return

    const { cx, cy, scale } = viewRef.current
    const toC = (wx, wy) => ({ x: (wx-cx)*scale + W/2, y: -(wy-cy)*scale + H/2 })

    const robotPos      = robotPosRef.current
    const recordedWPs   = recordedRef.current
    const recording     = recordingRef.current
    const pendingPts    = pendingRef.current
    const mapSelect     = mapSelectRef.current

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0a0e16'; ctx.fillRect(0, 0, W, H)

    // Grid dots fallback
    if (!tileRef.current) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      for (let x=0;x<W;x+=40) for (let y=0;y<H;y+=40) ctx.fillRect(x-1,y-1,2,2)
      ctx.fillStyle = 'rgba(232,232,232,0.15)'; ctx.font = '11px monospace'; ctx.textAlign = 'center'
      ctx.fillText('Waiting for /map…', W/2, H/2)
    } else if (mapData) {
      const { width, height, resolution, originX, originY } = mapData
      const tl = toC(originX, originY + height*resolution)
      const br = toC(originX + width*resolution, originY)
      const pw = br.x-tl.x, ph = br.y-tl.y
      if (pw > 2 && ph > 2) {
        ctx.save(); ctx.imageSmoothingEnabled = pw < width*2
        ctx.drawImage(tileRef.current, tl.x, tl.y, pw, ph); ctx.restore()
        ctx.strokeStyle='rgba(200,0,10,0.15)'; ctx.lineWidth=1; ctx.strokeRect(tl.x,tl.y,pw,ph)
      }
    }

if (scanRef.current?.length > 0) {
  ctx.fillStyle = 'rgba(255,0,0,0.9)'
  for (const pt of scanRef.current) {
    const c = toC(pt.x, pt.y)  // ✅ correct coordinate converter
    if (c.x < -20 || c.x > W + 20 || c.y < -20 || c.y > H + 20) continue
    ctx.beginPath(); ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2); ctx.fill()
  }
}
    // Recorded waypoint trail
    if (recordedWPs?.length > 0) {
      if (recordedWPs.length > 1) {
        ctx.beginPath(); ctx.strokeStyle='rgba(200,0,10,0.55)'; ctx.lineWidth=2; ctx.setLineDash([5,4])
        recordedWPs.forEach((wp,i) => { const c=toC(wp.x,wp.y); i===0?ctx.moveTo(c.x,c.y):ctx.lineTo(c.x,c.y) })
        ctx.stroke(); ctx.setLineDash([])
      }
      recordedWPs.forEach((wp, i) => {
        const c=toC(wp.x,wp.y), isLast=i===recordedWPs.length-1, isFirst=i===0
        if (isLast && recording) {
          const g=ctx.createRadialGradient(c.x,c.y,2,c.x,c.y,14)
          g.addColorStop(0,'rgba(200,0,10,0.35)'); g.addColorStop(1,'rgba(200,0,10,0)')
          ctx.beginPath(); ctx.arc(c.x,c.y,14,0,Math.PI*2); ctx.fillStyle=g; ctx.fill()
        }
        ctx.beginPath(); ctx.arc(c.x,c.y,isFirst?6:isLast?5:3.5,0,Math.PI*2)
        ctx.fillStyle=isFirst?'rgba(34,197,94,0.9)':isLast?'#C8000A':'rgba(200,0,10,0.5)'; ctx.fill()
        ctx.strokeStyle=isFirst?'#22c55e':isLast?'#fff':'rgba(200,0,10,0.7)'; ctx.lineWidth=1.5; ctx.stroke()
        if (i===0||isLast||i%5===0) {
          ctx.fillStyle=isLast?'rgba(255,255,255,0.85)':'rgba(200,0,10,0.55)'
          ctx.font='8px monospace'; ctx.textAlign='center'; ctx.fillText(`#${i}`,c.x,c.y-9)
        }
      })
    }

    // Pending map-select points
    if (pendingPts?.length > 0 && mapSelect) {
      if (pendingPts.length > 1) {
        ctx.beginPath(); ctx.strokeStyle='rgba(245,158,11,0.6)'; ctx.lineWidth=1.5; ctx.setLineDash([4,3])
        pendingPts.forEach((p,i) => { const c=toC(p.x,p.y); i===0?ctx.moveTo(c.x,c.y):ctx.lineTo(c.x,c.y) })
        ctx.stroke(); ctx.setLineDash([])
      }
      pendingPts.forEach((p, i) => {
        const c=toC(p.x,p.y)
        ctx.beginPath(); ctx.arc(c.x,c.y,5,0,Math.PI*2)
        ctx.fillStyle='rgba(245,158,11,0.8)'; ctx.fill()
        ctx.strokeStyle='#f59e0b'; ctx.lineWidth=1.5; ctx.stroke()
        ctx.fillStyle='rgba(245,158,11,0.9)'; ctx.font='8px monospace'; ctx.textAlign='center'
        ctx.fillText(`P${i}`,c.x,c.y-9)
      })
    }

    // Robot (AMCL)
    if (robotPos) {
      const rc=toC(robotPos.x,robotPos.y), yaw=robotPos.yaw??0
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
    ctx.strokeStyle='rgba(232,232,232,0.35)'; ctx.lineWidth=1.5; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+scalePx,sy)
    ctx.moveTo(sx,sy-3); ctx.lineTo(sx,sy+3); ctx.moveTo(sx+scalePx,sy-3); ctx.lineTo(sx+scalePx,sy+3); ctx.stroke()
    ctx.fillStyle='rgba(232,232,232,0.4)'; ctx.font='9px monospace'; ctx.textAlign='center'
    ctx.fillText(`${scaleM}m`,sx+scalePx/2,sy-6)
  }, [mapData, fitView])

  useEffect(() => {
    let raf
    const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  const onWheel = useCallback((e) => {
    e.preventDefault(); if (!viewRef.current) return
    viewRef.current = { ...viewRef.current, scale: Math.max(4, Math.min(600, viewRef.current.scale * (e.deltaY < 0 ? 1.12 : 0.88))) }
  }, [])

  const onMouseDown = useCallback((e) => {
    if (!viewRef.current) return
    if (mapSelectRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      const { cx, cy, scale } = viewRef.current
      const W = canvasRef.current.offsetWidth, H = canvasRef.current.offsetHeight
      const px = e.clientX - rect.left, py = e.clientY - rect.top
      const world = { x: (px - W/2) / scale + cx, y: -((py - H/2) / scale) + cy }
      onMapClickRef.current?.(world)
      return
    }
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
    <canvas ref={canvasRef} className="w-full h-full block"
      style={{ cursor: mapSelectMode ? 'crosshair' : 'grab' }}
      onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
  )
}

// ── RouteDropdown ─────────────────────────────────────────────────────────────
function RouteDropdown({ routes, activeRoute, onSelect, disabled }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => !disabled && routes.length > 0 && setOpen(v => !v)} disabled={disabled || routes.length === 0}
        className="w-full flex items-center justify-between px-3 py-2 border font-mono text-xs tracking-wide transition-all"
        style={{
          borderColor: disabled ? 'rgba(255,255,255,0.07)' : 'rgba(200,0,10,0.4)',
          background:  disabled ? 'rgba(255,255,255,0.02)' : 'rgba(200,0,10,0.06)',
          color:       disabled ? 'rgba(255,255,255,0.2)'  : '#e8e8e8',
          cursor:      disabled || routes.length === 0 ? 'not-allowed' : 'pointer',
        }}>
        <span className="truncate text-[10px]">{routes.length > 0 ? `Saved routes (${routes.length})` : 'No saved routes'}</span>
        <span className="text-white/25 ml-2 text-[10px]">▾</span>
      </button>
      {open && routes.length > 0 && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-[#161616] border border-[#2a2a2a] shadow-2xl max-h-40 overflow-y-auto">
            {routes.map(r => (
              <button key={r} onClick={() => { onSelect(r); setOpen(false) }}
                className="w-full text-left px-3 py-2 font-mono text-[10px] tracking-wide hover:bg-[rgba(200,0,10,0.1)] transition-colors flex items-center gap-2"
                style={{ color: r === activeRoute ? C.red : '#e8e8e8' }}>
                {r === activeRoute && <span style={{ color: C.red, fontSize: 8 }}>▶</span>}
                <span>{r}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── CtrlBtn ───────────────────────────────────────────────────────────────────
function CtrlBtn({ label, icon, onClick, disabled, variant = 'red' }) {
  const colors = {
    red:   { border:'rgba(200,0,10,0.5)',   bg:'rgba(200,0,10,0.1)',   text:'#C8000A'  },
    amber: { border:'rgba(245,158,11,0.4)', bg:'rgba(245,158,11,0.08)',text:'#f59e0b'  },
    green: { border:'rgba(34,197,94,0.4)',  bg:'rgba(34,197,94,0.08)', text:'#22c55e'  },
    ghost: { border:'rgba(255,255,255,0.1)',bg:'rgba(255,255,255,0.03)',text:'rgba(255,255,255,0.35)' },
  }
  const col = disabled ? colors.ghost : colors[variant]
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full flex items-center justify-between px-3 py-2.5 border font-mono text-[11px] tracking-widest uppercase transition-all font-bold"
      style={{ borderColor:col.border, background:col.bg, color:col.text, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.4:1 }}>
      <span>{label}</span><span className="text-base">{icon}</span>
    </button>
  )
}

// ── StatBox ───────────────────────────────────────────────────────────────────
function StatBox({ label, value, accent }) {
  return (
    <div className="bg-brand-black border border-brand-border px-2.5 py-2">
      <p className="font-mono text-[8px] tracking-[0.25em] text-white/25 uppercase mb-1">{label}</p>
      <p className="font-mono text-[12px] font-bold truncate" style={{ color:accent||'rgba(255,255,255,0.8)' }}>{String(value??'—')}</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WaypointRecorder() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

  // Node state — matches new Python status JSON
  const [status, setStatus] = useState({ mode:'idle', recording:false, map:'unknown', route:'default', count:0, pending_points:0 })
  const statusRef = useRef({ mode:'idle', recording:false, map:'unknown', route:'default', count:0, pending_points:0 })

  const [routes,      setRoutes]      = useState([])
  const routesRef = useRef([])
  const [mapData,     setMapData]     = useState(null)
  const [mapStatus,   setMapStatus]   = useState('waiting…')
  const [robotPos,    setRobotPos]    = useState(null)
  const robotPosRef   = useRef(null)
  const [recordedWPs, setRecordedWPs] = useState([])

  // Map-select mode: accumulate pending click points locally
  const [pendingMapPoints, setPendingMapPoints] = useState([])
  const [mapSelectMode,    setMapSelectMode]    = useState(false)

  const [routeInput,   setRouteInput]   = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [eventLog,     setEventLog]     = useState([])
  const logRef = useRef(null)

  useEffect(() => { robotPosRef.current = robotPos }, [robotPos])
  
  const { scanActive, scanPoints, scanPointsRef, toggleScan, pointCount } = useScan(subscribe, ready, robotPosRef)
  
  // Draggable splitter: panelWidth = right panel width in px, default 280
  const [panelWidth,   setPanelWidth]   = useState(300)
  const splitDragRef = useRef(null)

  const addLog = useCallback((msg, type='info') =>
    setEventLog(prev => [...prev.slice(-100), { t: Date.now(), msg, type }]), [])

  // ── ROS subscriptions ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')

    advertise(TOPIC.START,             'std_msgs/Empty')
    advertise(TOPIC.STOP,              'std_msgs/Empty')
    advertise(TOPIC.SET_ROUTE,         'std_msgs/String')
    advertise(TOPIC.CLEAR_ROUTES,      'std_msgs/Empty')
    advertise(TOPIC.START_MAP_SELECT,  'std_msgs/Empty')
    advertise(TOPIC.ADD_POINT,         'geometry_msgs/Point')
    advertise(TOPIC.GENERATE_INTERP,   'std_msgs/Empty')
    advertise(TOPIC.CANCEL_MAP_SELECT, 'std_msgs/Empty')

    const unsubs = [
      subscribe(TOPIC.MAP, 'nav_msgs/OccupancyGrid', (msg) => {
        const d = decodeOccupancyGrid(msg)
        if (d) {
          setMapData(d)
          setMapStatus(`${msg.info.width}×${msg.info.height} @ ${msg.info.resolution.toFixed(3)}m/cell`)
          addLog(`Map: ${msg.info.width}×${msg.info.height}`, 'info')
        }
      }, { queue_length:0, latch:true }),

      subscribe(TOPIC.AMCL, 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
        const pos = msg.pose?.pose?.position, ori = msg.pose?.pose?.orientation
        if (!pos) return
        let yaw = 0; if (ori) { const{x,y,z,w}=ori; yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z)) }
        const np = { x:pos.x, y:pos.y, yaw }
        robotPosRef.current = np; setRobotPos(np)
        // Update recorded trail in drive mode
        setStatus(prev => {
          if (prev.recording) {
            setRecordedWPs(wps => {
              const last = wps[wps.length-1]
              if (last) { const dx=pos.x-last.x,dy=pos.y-last.y; if(Math.sqrt(dx*dx+dy*dy)<0.3) return wps }
              return [...wps, { x:pos.x, y:pos.y, yaw, index:wps.length }]
            })
          }
          return prev
        })
      }),

      subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
        const pos=msg.pose?.pose?.position, ori=msg.pose?.pose?.orientation
        if (!pos) return
        let yaw=0; if(ori){const{x,y,z,w}=ori;yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))}
        if (!robotPosRef.current) { const np={x:pos.x,y:pos.y,yaw}; robotPosRef.current=np; setRobotPos(np) }
      }),

      // Status — new JSON format: { mode, recording, map, route, count, pending_points }
      subscribe(TOPIC.STATUS, 'std_msgs/String', (msg) => {
        try {
          const raw = typeof msg==='string'?msg:(msg?.data??'')
          const parsed = JSON.parse(raw)
          const prev = statusRef.current
          if (prev.mode!=='drive' && parsed.mode==='drive')     addLog(`Drive recording STARTED → "${parsed.route}"`, 'cmd')
          if (prev.mode==='drive' && parsed.mode!=='drive')     { addLog(`Drive STOPPED — ${parsed.count} WPs`, 'status'); setRecordedWPs([]) }
          if (prev.mode!=='map_select' && parsed.mode==='map_select') addLog('Map-select mode ACTIVE', 'cmd')
          if (prev.mode==='map_select' && parsed.mode!=='map_select') { addLog(`Map-select DONE — route saved`, 'status'); setPendingMapPoints([]); setMapSelectMode(false) }
          if (parsed.recording && parsed.count > prev.count)   addLog(`WP #${parsed.count-1} recorded`, 'ok')
          statusRef.current = parsed
          setStatus(parsed)
        } catch {}
      }, { queue_length:0, latch:true }),

      // Routes — new format: { map, routes: [...] }
      subscribe(TOPIC.ROUTES, 'std_msgs/String', (msg) => {
        try {
          const raw = typeof msg==='string'?msg:(msg?.data??JSON.stringify(msg))
          const obj = JSON.parse(raw)
          // new node sends { map, routes: [...] }; old sends plain array
          const list = Array.isArray(obj) ? obj : (Array.isArray(obj.routes) ? obj.routes : [])
          routesRef.current = list; setRoutes(list)
          const mapName = obj.map || 'unknown'
          addLog(`Routes for map "${mapName}": [${list.join(', ')}]`, 'info')
        } catch(e) { addLog(`Routes parse error: ${e.message}`, 'info') }
      }, { queue_length:0, latch:true }),
    ]

    return () => unsubs.forEach(fn => fn?.())
  }, [ready])

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [eventLog])

  // ── Publishers ──────────────────────────────────────────────────────────
  const sendStart = () => {
    setRecordedWPs([])
    publish(TOPIC.START, 'std_msgs/Empty', {})
    addLog('→ START (drive mode)', 'cmd')
  }
  const sendStop = () => {
    publish(TOPIC.STOP, 'std_msgs/Empty', {})
    addLog('→ STOP', 'cmd')
  }
  const sendSetRoute = (name) => {
    if (!name.trim()) return
    publish(TOPIC.SET_ROUTE, 'std_msgs/String', { data: name.trim() })
    addLog(`→ SET_ROUTE "${name.trim()}"`, 'cmd')
  }
  const sendClearRoutes = () => {
    publish(TOPIC.CLEAR_ROUTES, 'std_msgs/Empty', {})
    addLog('→ CLEAR_ROUTES', 'cmd')
    setConfirmClear(false)
  }

  // ── Re-send SET_ROUTE when node resolves map name from 'unknown' ──────────
  // The node stores routes keyed by map name. If map was 'unknown' when SET_ROUTE
  // was sent, the route is stored under the wrong key and won't appear in routes list.
  // When status.map transitions from 'unknown' → real name, re-send SET_ROUTE
  // so the node re-registers the route under the correct map.
  const prevMapRef = useRef(status.map)
  useEffect(() => {
    const prev = prevMapRef.current
    const curr = status.map
    prevMapRef.current = curr
    if (prev === 'unknown' && curr && curr !== 'unknown' && status.route && status.route !== 'default') {
      publish(TOPIC.SET_ROUTE, 'std_msgs/String', { data: status.route })
      addLog(`Map resolved "${curr}" — re-sent SET_ROUTE "${status.route}"`, 'status')
    }
  }, [status.map])

  // Map-select flow
  const startMapSelect = () => {
    // Block if map not yet known — routes would save under 'unknown' key
    if (!status.map || status.map === 'unknown') {
      addLog('⚠ Cannot start map select — map not detected yet. Wait for AMCL to localise.', 'error')
      return
    }
    if (!routeInput.trim() && (!status.route || status.route === 'default')) {
      addLog('⚠ No route name set — enter a name above first.', 'status')
    }
    setPendingMapPoints([])
    setMapSelectMode(true)
    // Auto-send route name if typed but not yet SET
    if (routeInput.trim() && routeInput.trim() !== status.route) {
      publish(TOPIC.SET_ROUTE, 'std_msgs/String', { data: routeInput.trim() })
      addLog(`→ SET_ROUTE "${routeInput.trim()}" (auto before map select)`, 'cmd')
    }
    publish(TOPIC.START_MAP_SELECT, 'std_msgs/Empty', {})
    addLog('→ START_MAP_SELECT', 'cmd')
  }
  const cancelMapSelect = () => {
    setMapSelectMode(false); setPendingMapPoints([])
    publish(TOPIC.CANCEL_MAP_SELECT, 'std_msgs/Empty', {})
    addLog('→ CANCEL_MAP_SELECT', 'cmd')
  }
  const generateInterpolated = () => {
    // If the user typed a route name but didn't press SET, send it now
    // before generating — the node uses whichever route is active at generate time
    if (routeInput.trim() && routeInput.trim() !== status.route) {
      publish(TOPIC.SET_ROUTE, 'std_msgs/String', { data: routeInput.trim() })
      addLog(`→ SET_ROUTE "${routeInput.trim()}" (auto before generate)`, 'cmd')
    }
    publish(TOPIC.GENERATE_INTERP, 'std_msgs/Empty', {})
    addLog('→ GENERATE_INTERPOLATED', 'cmd')
    setMapSelectMode(false); setPendingMapPoints([])
  }

  // Map click → ADD_POINT
  const handleMapClick = useCallback((world) => {
    if (!mapSelectMode || !world) return
    publish(TOPIC.ADD_POINT, 'geometry_msgs/Point', { x: world.x, y: world.y, z: 0.0 })
    setPendingMapPoints(prev => [...prev, { x: world.x, y: world.y }])
    addLog(`→ ADD_POINT (${world.x.toFixed(2)}, ${world.y.toFixed(2)})`, 'cmd')
  }, [mapSelectMode, publish, addLog])

  // ── Splitter drag ───────────────────────────────────────────────────────
  const onSplitMouseDown = (e) => {
    e.preventDefault()
    splitDragRef.current = { startX: e.clientX, startW: panelWidth }
    const onMove = (me) => {
      const delta = splitDragRef.current.startX - me.clientX
      setPanelWidth(Math.max(220, Math.min(520, splitDragRef.current.startW + delta)))
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  const isIdle       = status.mode === 'idle'
  const isDrive      = status.mode === 'drive'
  const isMapSelect  = status.mode === 'map_select'
  const mapUnknown   = !status.map || status.map === 'unknown'
  const wsCol = wsStatus==='CONNECTED'?'#22c55e':wsStatus==='CONNECTING'?'#f59e0b':'#ef4444'

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-brand-border flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red flex-shrink-0" />
          <div>
            <h1 className="font-mono font-bold text-white text-sm tracking-widest uppercase leading-none">Waypoint Recorder</h1>
            <p className="font-mono text-white/30 text-[8px] tracking-[0.2em] uppercase mt-1">
              Map: <span className="text-white/50">{status.map}</span>
            </p>
          </div>
        </div>

       
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[9px] tracking-widest uppercase"
            style={{ borderColor:`${wsCol}44`, background:`${wsCol}0d`, color:wsCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background:wsCol }} />
            {wsStatus}
          </div>
          {/* Mode badge */}

          <ScanButton scanActive={scanActive} toggleScan={toggleScan} pointCount={pointCount} disabled={!ready} />
          <div className="flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[9px] tracking-widest uppercase"
            style={{
              borderColor: isDrive?'rgba(200,0,10,0.5)':isMapSelect?'rgba(245,158,11,0.4)':'rgba(255,255,255,0.1)',
              background:  isDrive?'rgba(200,0,10,0.1)':isMapSelect?'rgba(245,158,11,0.08)':'rgba(255,255,255,0.03)',
              color:       isDrive?'#C8000A':isMapSelect?'#f59e0b':'rgba(255,255,255,0.35)',
            }}>
            {isDrive && <span className="w-1.5 h-1.5 rounded-full bg-brand-red animate-pulse-dot" />}
            {isDrive ? 'RECORDING' : isMapSelect ? 'MAP SELECT' : 'IDLE'}
          </div>
          {/* {routes.length > 0 && (
            <span className="px-2 py-1 border border-brand-border font-mono text-[9px] text-white/35 tracking-widest">{routes.length} routes</span>
          )} */}
        </div>
      </div>

      {/* Map-select hint bar */}
      {(mapSelectMode || isMapSelect) && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-amber-900/40 bg-amber-900/10 flex items-center gap-3">
          <span className="font-mono text-[9px] text-amber-400 tracking-widest uppercase">◎ Map Select Mode</span>
          <span className="font-mono text-[9px] text-white/30 tracking-widest">Click on map to add waypoints · {pendingMapPoints.length} pending</span>
          <button onClick={cancelMapSelect} className="ml-auto font-mono text-[9px] text-white/30 hover:text-white/60 tracking-widest uppercase transition-colors">✕ Cancel</button>
        </div>
      )}

      {/* Map unknown warning — blocks map-select until AMCL localises */}
      {mapUnknown && !mapSelectMode && !isMapSelect && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-red-900/50 bg-red-950/20 flex items-center gap-3">
          <span className="font-mono text-[9px] text-red-400 tracking-widest uppercase">⚠ Map Unknown</span>
          <span className="font-mono text-[9px] text-white/30 tracking-widest">
            AMCL has not localised yet — wait for map name to resolve before recording routes.
            Routes saved now would be stored under "unknown" and may not reload correctly.
          </span>
        </div>
      )}

      {/* ── Body: map + draggable splitter + right panel ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* MAP area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3 overflow-hidden">
          <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
            {/* Corner accents */}
            {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
              'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls,i) => (
              <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
            ))}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">Live Trail</span>
              <span className="text-white/20 font-mono text-[9px]">·</span>
              <span className="font-mono text-white/40 text-[9px]">{status.route}</span>
            </div>
            <div className="absolute top-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/20 text-[8px] tracking-widest">{mapStatus}</span>
            </div>
            <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/15 text-[7px] tracking-widest uppercase">scroll=zoom · drag=pan{mapSelectMode?' · click=waypoint':''}</span>
            </div>

            <RecorderMapCanvas
              mapData={mapData}
              robotPos={robotPos}
              recordedWPs={recordedWPs}
              recording={isDrive}
              pendingMapPoints={pendingMapPoints}
              mapSelectMode={mapSelectMode || isMapSelect}
              onMapClick={handleMapClick}
              scanPoints={scanPoints}
              scanPointsRef={scanPointsRef} 
            />
          </div>

          {/* WP count bar */}
          <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[9px] tracking-[0.25em] text-white/30 uppercase">
                {isDrive ? 'Drive Waypoints' : isMapSelect ? `Pending Points (${pendingMapPoints.length})` : 'Waypoints Recorded'}
              </span>
              <span className="font-mono text-[10px]" style={{ color: isDrive?'#C8000A':isMapSelect?'#f59e0b':'rgba(255,255,255,0.35)' }}>
                {isDrive ? status.count : isMapSelect ? pendingMapPoints.length : status.count} pts
              </span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-sm overflow-hidden">
              <div className="h-full rounded-sm transition-all duration-500"
                style={{
                  width: `${Math.min(100, ((isDrive ? status.count : pendingMapPoints.length) / 20) * 100)}%`,
                  background: isDrive ? '#C8000A' : isMapSelect ? '#f59e0b' : 'rgba(200,0,10,0.3)',
                  boxShadow: isDrive ? '0 0 8px rgba(200,0,10,0.5)' : 'none',
                }} />
            </div>
          </div>
        </div>

        {/* ── Draggable splitter ── */}
        <div
          onMouseDown={onSplitMouseDown}
          className="flex-shrink-0 w-2 bg-brand-dark border-x border-brand-border cursor-col-resize hover:bg-brand-red/20 transition-colors flex items-center justify-center group"
        >
          <div className="flex flex-col gap-0.5">
            {[0,1,2,3,4].map(i => <div key={i} className="w-0.5 h-1 bg-white/15 group-hover:bg-brand-red/50 transition-colors" />)}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{ width: panelWidth, minWidth: 220, maxWidth: 520 }}
          className="flex-shrink-0 flex flex-col border-l border-brand-border overflow-hidden">

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto flex flex-col">

            {/* Route name */}
            <div className="flex-shrink-0 p-4 border-b border-brand-border">
              <div className="flex items-center justify-between mb-2.5">
                <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold">Route Name</p>
                <span className={`font-mono text-[8px] px-1.5 py-0.5 border tracking-widest ${routes.length>0?'border-green-500/30 text-green-400':'border-brand-border text-white/20'}`}>
                  {routes.length > 0 ? `${routes.length} saved` : 'none'}
                </span>
              </div>
              <div className="flex gap-1.5 mb-2">
                <input value={routeInput} onChange={e => setRouteInput(e.target.value)}
                  onKeyDown={e => e.key==='Enter' && sendSetRoute(routeInput)}
                  disabled={isDrive || isMapSelect}
                  placeholder={status.route}
                  className="flex-1 bg-brand-black border border-brand-border font-mono text-[11px] text-white/70 px-2.5 py-2 tracking-wide outline-none focus:border-brand-red/50 placeholder:text-white/15"
                  style={{ cursor: isDrive||isMapSelect ? 'not-allowed' : 'text' }}
                />
                <button onClick={() => sendSetRoute(routeInput)}
                  disabled={isDrive || isMapSelect || !routeInput.trim()}
                  className="px-3 py-2 border font-mono text-[10px] tracking-widest transition-all font-bold"
                  style={{
                    borderColor: isDrive||isMapSelect||!routeInput.trim() ? 'rgba(255,255,255,0.08)' : 'rgba(200,0,10,0.5)',
                    background:  isDrive||isMapSelect||!routeInput.trim() ? 'transparent' : 'rgba(200,0,10,0.1)',
                    color:       isDrive||isMapSelect||!routeInput.trim() ? 'rgba(255,255,255,0.2)' : '#C8000A',
                    cursor:      isDrive||isMapSelect||!routeInput.trim() ? 'not-allowed' : 'pointer',
                  }}>SET</button>
              </div>
              <RouteDropdown routes={routes} activeRoute={status.route} disabled={isDrive||isMapSelect}
                onSelect={(r) => { sendSetRoute(r); setRouteInput(r) }} />
            </div>

            {/* Stats */}
            <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
              <StatBox label="Mode"         value={status.mode}           accent={isDrive?'#C8000A':isMapSelect?'#f59e0b':undefined} />
              <StatBox label="Active Route" value={status.route}                         />
              <StatBox label="WPs Recorded" value={status.count}                         accent={isDrive?'#C8000A':undefined} />
              <StatBox label="Pending Pts"  value={pendingMapPoints.length > 0 ? pendingMapPoints.length : (status.pending_points ?? 0)}  accent={isMapSelect?'#f59e0b':undefined} />
              <StatBox label="Saved Routes" value={routes.length}                        />
              <StatBox label="Map"          value={status.map}                           />
            </div>

            {/* Robot pose */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
              <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold mb-2">Robot · AMCL</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[['X',robotPos?robotPos.x.toFixed(2):'—'],['Y',robotPos?robotPos.y.toFixed(2):'—'],['Yaw°',robotPos?.yaw!=null?(robotPos.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
                  <div key={l} className="bg-brand-black border border-brand-border px-2 py-1.5">
                    <p className="font-mono text-[8px] text-white/20 uppercase">{l}</p>
                    <p className="font-mono text-[11px] text-white/70">{v}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recording controls */}
            <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
              <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold mb-1">Drive Recording</p>
              <CtrlBtn label="Start Recording" icon="●" onClick={sendStart} disabled={!isIdle||!ready} variant="red" />
              <CtrlBtn label="Stop & Save"     icon="■" onClick={sendStop}  disabled={!isDrive||!ready} variant="amber" />
            </div>

            {/* Map-select controls */}
            <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
              <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold mb-1">Map-Select Recording</p>
              {!mapSelectMode && !isMapSelect ? (
                <CtrlBtn label="Start Map Select" icon="◎" onClick={startMapSelect} disabled={!isIdle||!ready||mapUnknown} variant="amber" />
              ) : (
                <>
                  <CtrlBtn label={`Generate (${pendingMapPoints.length} pts)`} icon="⚡" onClick={generateInterpolated}
                    disabled={pendingMapPoints.length < 1 || !ready} variant="green" />
                  <CtrlBtn label="Cancel" icon="✕" onClick={cancelMapSelect} disabled={!ready} variant="ghost" />
                </>
              )}
            </div>

            {/* Clear routes */}
            <div className="flex-shrink-0 px-4 pb-3 border-b border-brand-border">
              {!confirmClear ? (
                <CtrlBtn label="Clear All Routes" icon="✕" onClick={() => setConfirmClear(true)}
                  disabled={isDrive||isMapSelect||!ready||routes.length===0} variant="ghost" />
              ) : (
                <div className="border border-red-900/50 bg-red-950/20 p-2.5 flex flex-col gap-2">
                  <p className="font-mono text-[9px] text-red-400/80 tracking-widest uppercase text-center">Delete ALL routes for this map?</p>
                  <div className="flex gap-1.5">
                    <button onClick={sendClearRoutes} className="flex-1 py-2 border border-red-700/60 bg-red-900/20 font-mono text-[10px] text-red-400 tracking-widest uppercase hover:bg-red-900/40 transition-colors">Confirm</button>
                    <button onClick={() => setConfirmClear(false)} className="flex-1 py-2 border border-white/10 font-mono text-[10px] text-white/30 tracking-widest uppercase hover:bg-white/5 transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Saved routes list */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
              <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold mb-2">
                Saved Routes {routes.length > 0 && <span className="text-white/20 ml-1">({routes.length})</span>}
              </p>
              {routes.length === 0
                ? <p className="font-mono text-[9px] text-white/15 tracking-widest uppercase">none yet</p>
                : (
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {routes.map((r, i) => (
                      <div key={r} className="flex items-center justify-between px-2 py-1.5 border"
                        style={{ borderColor: r===status.route?'rgba(200,0,10,0.4)':'rgba(255,255,255,0.07)', background: r===status.route?'rgba(200,0,10,0.07)':'transparent' }}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[8px] text-white/20">{String(i).padStart(2,'0')}</span>
                          <span className="font-mono text-[10px] tracking-wide" style={{ color: r===status.route?C.red:'rgba(255,255,255,0.55)' }}>{r}</span>
                        </div>
                        {r===status.route && <span className="font-mono text-[8px] text-brand-red/60 tracking-widest">ACTIVE</span>}
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* TeleopPanel */}
            <div className="flex-shrink-0 p-4 border-b border-brand-border">
                       <div className="flex items-center gap-2 mb-3">
                         <div className="w-0.5 h-4 bg-brand-red flex-shrink-0" />
                         <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Vehicle Control</p>
                       </div>
                       <TeleopPanel
                         publish={publish}
                         ready={ready}
                         cmdVelTopic={CMD_VEL}
                         hz={10}
                         defaultOpen={false}
                       />
                     </div>

            {/* Event log */}
            <div className="flex-1 flex flex-col min-h-0 p-4" style={{ minHeight: 140 }}>
              <p className="font-mono text-[10px] tracking-[0.25em] text-white/35 uppercase font-bold mb-2 flex-shrink-0">Event Log</p>
              <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-1">
                {eventLog.length === 0 && <p className="font-mono text-[8px] text-white/10 tracking-widest uppercase">waiting…</p>}
                {eventLog.map((e, i) => (
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