//mapping is coming but the wypoint path is showing upo but not as expected
import { useEffect, useRef, useState, useCallback } from 'react'
import { useScan, ScanButton, drawScanPoints } from '../components/ScanOverlay'

// ── rosbridge WebSocket URL ──────────────────────────────────────────────────
const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'

// ── Topic names ──────────────────────────────────────────────────────────────
const TOPIC = {
  STATUS:    'route_follower/status',
  ROUTES:    'available_routes_follower',
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
// renderMapToOffscreen — decodes OccupancyGrid into an OffscreenCanvas
// Returns an ImageBitmap (or null). Called only when /map changes.
// ────────────────────────────────────────────────────────────────────────────
function decodeOccupancyGrid(mapMsg) {
  if (!mapMsg?.info || !mapMsg?.data) return null
  const { width, height, resolution, origin } = mapMsg.info
  if (!width || !height) return null

  // ROS OccupancyGrid: row 0 = bottom of map (y_min), row N-1 = top (y_max)
  // Canvas: row 0 = top of image → must flip vertically when writing pixels
  // Values: -1 = unknown, 0 = free, 1-100 = occupied (100 = fully occupied)
  const data = mapMsg.data

  const offscreen = new OffscreenCanvas(width, height)
  const ctx       = offscreen.getContext('2d')
  const imgData   = ctx.createImageData(width, height)
  const px        = imgData.data

  for (let row = 0; row < height; row++) {
    // flip: ROS row 0 → canvas row (height-1)
    const canvasRow = height - 1 - row
    for (let col = 0; col < width; col++) {
      const rosIdx    = row * width + col
      const canvasIdx = (canvasRow * width + col) * 4
      const v         = data[rosIdx]

      if (v === -1) {
        // Unknown — mid grey (matches RViz default)
        px[canvasIdx]   = 128
        px[canvasIdx+1] = 128
        px[canvasIdx+2] = 128
        px[canvasIdx+3] = 255
      } else if (v === 0) {
        // Free space — light grey/white (matches RViz)
        px[canvasIdx]   = 210
        px[canvasIdx+1] = 210
        px[canvasIdx+2] = 210
        px[canvasIdx+3] = 255
      } else {
        // Occupied — dark (walls/obstacles). Higher value = darker
        const darkness  = Math.round(210 - (v / 100) * 200)
        px[canvasIdx]   = darkness
        px[canvasIdx+1] = darkness
        px[canvasIdx+2] = darkness
        px[canvasIdx+3] = 255
      }
    }
  }
  ctx.putImageData(imgData, 0, 0)

  return {
    bitmap:     offscreen,
    width, height, resolution,
    originX:    origin.position.x,
    originY:    origin.position.y,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MapCanvas — renders occupancy grid + paths + robot
// ────────────────────────────────────────────────────────────────────────────
function MapCanvas({ mapData, fullPath, remainingPath, robotPos, scanPoints, scanPointsRef }) {
  const canvasRef  = useRef(null)
  // viewBox in world coords — supports pan/zoom
  const viewRef    = useRef({ cx: 0, cy: 0, scale: 60 }) // px per metre
  const dragRef    = useRef(null)
  const animRef    = useRef(null)
  const scanRef = useRef(scanPoints) ; useEffect(() => { scanRef.current = scanPoints }, [scanPoints])
  // ── compute world bounds from map + path ──
  const getBounds = useCallback(() => {
    const pts = []
    if (mapData) {
      pts.push({ x: mapData.originX, y: mapData.originY })
      pts.push({ x: mapData.originX + mapData.width  * mapData.resolution,
                 y: mapData.originY + mapData.height * mapData.resolution })
    }
    fullPath?.forEach(p => pts.push({ x: p.pose.position.x, y: p.pose.position.y }))
    if (!pts.length) return null
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    pts.forEach(p => {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    })
    return { minX, maxX, minY, maxY }
  }, [mapData, fullPath])

  // ── fit view to bounds on first data arrival ──
  const fitView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = getBounds()
    if (!bounds) return
    const { minX, maxX, minY, maxY } = bounds
    const W = canvas.offsetWidth  || 800
    const H = canvas.offsetHeight || 500
    const pad = 0.9
    const sx = (W / (maxX - minX)) * pad
    const sy = (H / (maxY - minY)) * pad
    viewRef.current = {
      cx:    (minX + maxX) / 2,
      cy:    (minY + maxY) / 2,
      scale: Math.min(sx, sy),
    }
  }, [getBounds])

  // ── world → canvas ──
  const toCanvas = useCallback((wx, wy) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const W = canvas.offsetWidth  || 800
    const H = canvas.offsetHeight || 500
    const { cx, cy, scale } = viewRef.current
    return {
      x:  (wx - cx) * scale + W / 2,
      y: -(wy - cy) * scale + H / 2,
    }
  }, [])

  // ── draw ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const scan     = scanRef.current
    if (!canvas) return
    const W = canvas.offsetWidth  || 800
    const H = canvas.offsetHeight || 500
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H
    }
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = '#080d14'
    ctx.fillRect(0, 0, W, H)

    // ── Occupancy grid ──
    if (mapData) {
      const { bitmap, width, height, resolution, originX, originY } = mapData
      const tl = toCanvas(originX, originY + height * resolution)
      const br = toCanvas(originX + width * resolution, originY)
      const pw = br.x - tl.x
      const ph = br.y - tl.y
      if (pw > 0 && ph > 0) {
        ctx.save()
        ctx.imageSmoothingEnabled = false          // crisp cells
        ctx.drawImage(bitmap, tl.x, tl.y, pw, ph)
        ctx.restore()
      }
      // Map border
      ctx.strokeStyle = 'rgba(0,200,255,0.15)'
      ctx.lineWidth   = 1
      ctx.strokeRect(tl.x, tl.y, pw, ph)
    } else {
      // Grid fallback when no map yet
      ctx.strokeStyle = C.grid
      ctx.lineWidth   = 1
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }
    }

if (scanRef.current?.length > 0) {
  ctx.fillStyle = 'rgba(255,0,0,1)'
  for (const pt of scanRef.current) {
    const c = toCanvas(pt.x, pt.y)  // ✅ toCanvas, not toC
    if (c.x < -20 || c.x > W + 20 || c.y < -20 || c.y > H + 20) continue
    ctx.beginPath(); ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2); ctx.fill()
  }
}

    // ── Remaining path overlay (solid red) ──
    if (remainingPath?.length > 1) {
      ctx.beginPath()
      ctx.strokeStyle = C.pathRem
      ctx.lineWidth   = 2.5
      ctx.setLineDash([])
      remainingPath.forEach((p, i) => {
        const c = toCanvas(p.pose.position.x, p.pose.position.y)
        i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)
      })
      ctx.stroke()
    }

    // ── Full path (dashed dim) ──
    if (fullPath?.length) {
      ctx.beginPath()
      ctx.strokeStyle = C.pathFull
      ctx.lineWidth   = 2
      ctx.setLineDash([6, 5])
      fullPath.forEach((p, i) => {
        const c = toCanvas(p.pose.position.x, p.pose.position.y)
        i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)
      })
      ctx.stroke()
      ctx.setLineDash([])

      const remSet = new Set(
        (remainingPath || []).map(p =>
          `${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`
        )
      )

      // ── Waypoint dots ──
      fullPath.forEach((p, i) => {
        const c   = toCanvas(p.pose.position.x, p.pose.position.y)
        const key = `${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`
        const ahead = remSet.has(key)
        ctx.beginPath()
        ctx.arc(c.x, c.y, ahead ? 5 : 4, 0, Math.PI * 2)
        ctx.fillStyle   = ahead ? C.wpAhead : C.wpDone
        ctx.fill()
        ctx.strokeStyle = ahead ? '#fff' : 'rgba(200,0,10,0.5)'
        ctx.lineWidth   = 1.5
        ctx.stroke()
        ctx.fillStyle = ahead ? 'rgba(255,255,255,0.7)' : 'rgba(200,0,10,0.4)'
        ctx.font      = '8px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(i + 1, c.x, c.y - 8)
      })

      // ── Current target ring ──
      if (remainingPath?.length) {
        const t  = remainingPath[0]
        const tc = toCanvas(t.pose.position.x, t.pose.position.y)
        // Pulsing ring via opacity cycling — drawn every frame
        ctx.beginPath()
        ctx.arc(tc.x, tc.y, 13, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth   = 1.5
        ctx.stroke()
        ;[[-1,0],[1,0],[0,-1],[0,1]].forEach(([dx,dy]) => {
          ctx.beginPath()
          ctx.moveTo(tc.x + dx * 10, tc.y + dy * 10)
          ctx.lineTo(tc.x + dx * 16, tc.y + dy * 16)
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'
          ctx.lineWidth   = 1.5
          ctx.stroke()
        })
      }
    }

    // ── Robot (AMCL pose in map frame) ──
    if (robotPos) {
      const rc  = toCanvas(robotPos.x, robotPos.y)
      const yaw = robotPos.yaw ?? 0

      // Outer glow (covariance indicator)
      const grad = ctx.createRadialGradient(rc.x, rc.y, 4, rc.x, rc.y, 22)
      grad.addColorStop(0,   'rgba(0,200,255,0.25)')
      grad.addColorStop(1,   'rgba(0,200,255,0)')
      ctx.beginPath(); ctx.arc(rc.x, rc.y, 22, 0, Math.PI * 2)
      ctx.fillStyle = grad; ctx.fill()

      // Body circle
      ctx.beginPath(); ctx.arc(rc.x, rc.y, 9, 0, Math.PI * 2)
      ctx.fillStyle   = 'rgba(0,200,255,0.9)'; ctx.fill()
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke()

      // Heading arrow
      const headLen = 18
      const ax = rc.x + Math.cos(yaw) * headLen
      const ay = rc.y - Math.sin(yaw) * headLen
      ctx.beginPath()
      ctx.moveTo(rc.x, rc.y); ctx.lineTo(ax, ay)
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5
      ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'

      // Arrow head
      const aHeadLen = 6
      const aAngle   = Math.atan2(-(ay - rc.y), ax - rc.x)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax - aHeadLen * Math.cos(aAngle - Math.PI/6), ay + aHeadLen * Math.sin(aAngle - Math.PI/6))
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax - aHeadLen * Math.cos(aAngle + Math.PI/6), ay + aHeadLen * Math.sin(aAngle + Math.PI/6))
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2
      ctx.stroke()
    }

    // ── Scale bar ──
    const { scale } = viewRef.current
    const scaleM  = Math.pow(10, Math.floor(Math.log10(200 / scale))) || 1
    const scalePx = scaleM * scale
    const sx = W - 20 - scalePx, sy = H - 14
    ctx.strokeStyle = 'rgba(232,232,232,0.3)'; ctx.lineWidth = 1.5; ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(sx, sy); ctx.lineTo(sx + scalePx, sy)
    ctx.moveTo(sx, sy - 3); ctx.lineTo(sx, sy + 3)
    ctx.moveTo(sx + scalePx, sy - 3); ctx.lineTo(sx + scalePx, sy + 3)
    ctx.stroke()
    ctx.fillStyle = 'rgba(232,232,232,0.35)'; ctx.font = '9px monospace'; ctx.textAlign = 'center'
    ctx.fillText(`${scaleM}m`, sx + scalePx / 2, sy - 6)

  }, [mapData, fullPath, remainingPath, robotPos, toCanvas])

  // ── Continuous animation loop so robot moves smoothly ──
  useEffect(() => {
    let raf
    const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  // ── Auto-fit when map or path first arrives ──
  const fittedRef = useRef(false)
  useEffect(() => {
    if ((mapData || fullPath?.length) && !fittedRef.current) {
      fitView()
      fittedRef.current = true
    }
  }, [mapData, fullPath, fitView])

  // ── Scroll to zoom ──
  const onWheel = useCallback((e) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 0.88
    viewRef.current = { ...viewRef.current, scale: Math.max(5, Math.min(500, viewRef.current.scale * factor)) }
  }, [])

  // ── Drag to pan ──
  const onMouseDown = useCallback((e) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: viewRef.current.cx, cy: viewRef.current.cy }
  }, [])
  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.sx) / viewRef.current.scale
    const dy = (e.clientY - dragRef.current.sy) / viewRef.current.scale
    viewRef.current = { ...viewRef.current, cx: dragRef.current.cx - dx, cy: dragRef.current.cy + dy }
  }, [])
  const onMouseUp   = useCallback(() => { dragRef.current = null }, [])

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
    const routesRef = useRef([])
  const [fullPath,  setFullPath]  = useState([])
  const [remaining, setRemaining] = useState([])
  const [robotPos,  setRobotPos]  = useState(null)
  const [mapData,   setMapData]   = useState(null)   // decoded OccupancyGrid
  const [mapStatus, setMapStatus] = useState('waiting…')

  const [selectedRoute, setSelectedRoute] = useState('')
  const [dropOpen,      setDropOpen]      = useState(false)
  const [eventLog,      setEventLog]      = useState([{ t: Date.now(), msg: 'Interface ready', type: 'info' }])
  const robotPosRef = useRef(null)
useEffect(() => { robotPosRef.current = robotPos }, [robotPos])
  const { scanActive, scanPoints, scanPointsRef, toggleScan, pointCount } = useScan(subscribe, ready, robotPosRef)
  const addLog = useCallback((msg, type = 'info') =>
    setEventLog(prev => [{ t: Date.now(), msg, type }, ...prev].slice(0, 120)), [])

  // ── Subscribe ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')

    // Advertise publish topics
    advertise(TOPIC.START,     'std_msgs/Empty')
    advertise(TOPIC.STOP,      'std_msgs/Empty')
    advertise(TOPIC.RESUME,    'std_msgs/Empty')
    advertise(TOPIC.SET_ROUTE, 'std_msgs/String')

    const unsubs = [

      // ── /map — OccupancyGrid ───────────────────────────────────────────────
      // throttle_rate limits how often rosbridge forwards the message (ms)
      // TRANSIENT_LOCAL publisher — queue_length:0 + latch:true gets the
      // retained last message immediately without waiting for a new publish
      subscribe(TOPIC.MAP, 'nav_msgs/OccupancyGrid', (msg) => {
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
      subscribe(TOPIC.AMCL, 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
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
      subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
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
      subscribe(TOPIC.STATUS, 'std_msgs/String', (msg) => {
        try {
          const raw = typeof msg === 'string' ? msg : (msg?.data ?? '')
          const d   = JSON.parse(raw)
          setStatus(d)
          addLog(`[${d.state}] seg ${d.segment}/${d.total}  dist ${d.dist_to_goal ?? '?'}m`, 'status')
        } catch {}
      }, { queue_length: 0, latch: true }),

      // ── available_routes ──────────────────────────────────────────────────
      // queue_length:0 + latch:true = rosbridge immediately delivers the
      // // last retained message (TRANSIENT_LOCAL) as soon as we subscribe
      // subscribe(TOPIC.ROUTES, 'std_msgs/String', (msg) => {
      //   try {
      //     // rosbridge v2 delivers std_msgs/String as { data: "..." }
      //     // but some versions may pass the raw string — handle both
      //     const raw  = typeof msg === 'string' ? msg : (msg?.data ?? '')
      //     const list = JSON.parse(raw)
      //     if (!Array.isArray(list)) return
      //     setRoutes(list)
      //      console.log('Available routes:', list)
      //     if (list.length) setSelectedRoute(r => r || list[0])
      //     addLog(`Routes: [${list.join(', ')}]`, 'info')
      //   } catch (e) {
      //     addLog(`Routes parse error: ${e.message}`, 'info')
      //   }
      // }, { queue_length: 0, latch: true }),


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

      // ── full path ─────────────────────────────────────────────────────────
      subscribe(TOPIC.FULL_PATH, 'nav_msgs/Path', (msg) => {
        setFullPath(msg.poses || [])
        addLog(`Full path: ${(msg.poses || []).length} pts`, 'info')
      }),

      // ── remaining path — drives live progress ─────────────────────────────
      subscribe(TOPIC.REMAINING, 'nav_msgs/Path', (msg) => {
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
  const sendStart  = () => { publish(TOPIC.START,  'std_msgs/Empty',  {}); addLog('→ START',  'cmd') }
  const sendStop   = () => { publish(TOPIC.STOP,   'std_msgs/Empty',  {}); addLog('→ STOP',   'cmd') }
  const sendResume = () => { publish(TOPIC.RESUME, 'std_msgs/Empty',  {}); addLog('→ RESUME', 'cmd') }
  const sendRoute  = (name) => {
    publish(TOPIC.SET_ROUTE, 'std_msgs/String', { data: name })
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
          &nbsp;·&nbsp;{wsStatus}
          </div>

          <ScanButton scanActive={scanActive} toggleScan={toggleScan} pointCount={pointCount} disabled={!ready} />
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
              scanPoints={scanPoints}
              scanPointsRef={scanPointsRef} 
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

