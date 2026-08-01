
import { useEffect, useRef, useState, useCallback } from 'react'
import TeleopPanel from '../components/TeleopPanel'
import { useScan, ScanButton, drawScanPoints } from '../components/ScanOverlay'
import { useEnvironment } from '../context/EnvironmentContext'

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE      = 'https://trovcamera.edgeforce.in'
const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'
const CMD_VEL       = '/cmd_vel_safe'

// ── useRosBridge ──────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef        = useRef(null)
  const subMap       = useRef({})
  const advMap       = useRef({})
  const reconnectRef = useRef(null)
  const [ready,    setReady]    = useState(false)
  const [wsStatus, setWsStatus] = useState('CONNECTING')

  const connect = useCallback(() => {
    if (wsRef.current?.readyState <= 1) return
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
    const id = `sub_${topic.replace(/\//g,'_')}_${Date.now()}`
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
    if (ws?.readyState !== WebSocket.OPEN) return false
    if (!advMap.current[topic]) { ws.send(JSON.stringify({ op: 'advertise', topic, type })); advMap.current[topic] = type }
    ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
    return true
  }, [])

  return { ready, wsStatus, subscribe, advertise, publish }
}

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// ── decodeOccupancyGrid ───────────────────────────────────────────────────────
function decodeOccupancyGrid(mapMsg) {
  if (!mapMsg?.info || !mapMsg?.data) return null
  const { width, height, resolution, origin } = mapMsg.info
  if (!width || !height) return null
  const data = mapMsg.data
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    const cRow = height - 1 - row
    for (let col = 0; col < width; col++) {
      const v   = data[row * width + col]
      const dst = (cRow * width + col) * 4
      if      (v === -1) { rgba[dst]=50;  rgba[dst+1]=55;  rgba[dst+2]=65;  rgba[dst+3]=255 } // unknown → dark slate
      else if (v === 0)  { rgba[dst]=210; rgba[dst+1]=215; rgba[dst+2]=220; rgba[dst+3]=255 } // free   → light
      else               { const d=Math.round(20+(v/100)*30); rgba[dst]=d; rgba[dst+1]=d; rgba[dst+2]=d; rgba[dst+3]=255 } // occupied → near-black
    }
  }
  return {
    imageData: new ImageData(rgba, width, height),
    width, height, resolution,
    originX: origin.position.x,
    originY: origin.position.y,
  }
}

// ── MapCanvas ─────────────────────────────────────────────────────────────────
function MapCanvas({ mapData, robotPos, cellsExplored, scanPoints, scanPointsRef }) {
  const canvasRef = useRef(null)
  const viewRef   = useRef(null)
  const tileRef   = useRef(null)
  const fittedRef = useRef(false)
  const scanRef = useRef(scanPoints) ; useEffect(() => { scanRef.current = scanPoints }, [scanPoints])

  // Keep track of previous dimensions to detect actual size changes
  const prevDimsRef = useRef({ width: 0, height: 0 })

  // Re-render tile when mapData changes — but only reset view fit when
  // the map dimensions change (not on every content update while mapping)
  useEffect(() => {
    if (!mapData?.imageData) { tileRef.current = null; return }
    const tc = document.createElement('canvas')
    tc.width = mapData.width; tc.height = mapData.height
    tc.getContext('2d').putImageData(mapData.imageData, 0, 0)
    tileRef.current = tc
    // Only re-fit when map grows (dimensions change), not on every SLAM update
    const prev = prevDimsRef.current
    if (mapData.width !== prev.width || mapData.height !== prev.height) {
      fittedRef.current = false
      prevDimsRef.current = { width: mapData.width, height: mapData.height }
    }
  }, [mapData])

  // Keep latest values in refs for RAF
  const robotPosRef = useRef(robotPos)
  useEffect(() => { robotPosRef.current = robotPos }, [robotPos])
  const mapDataRef  = useRef(mapData)
  useEffect(() => { mapDataRef.current = mapData }, [mapData])

  const fitView = useCallback(() => {
    const canvas = canvasRef.current
    const md = mapDataRef.current
    if (!canvas || !md) return
    const W = canvas.offsetWidth || 800, H = canvas.offsetHeight || 500
    if (!W || !H) return
    const mapW = md.width * md.resolution, mapH = md.height * md.resolution
    const scale = Math.min((W * 0.9) / mapW, (H * 0.9) / mapH)
    const cx = md.originX + mapW / 2, cy = md.originY + mapH / 2
    viewRef.current = { cx, cy, scale, W, H }
  }, [])

  // Wheel zoom
  const onWheel = useCallback(e => {
    e.preventDefault()
    if (!viewRef.current) return
    const f = e.deltaY < 0 ? 1.12 : 0.88
    viewRef.current = { ...viewRef.current, scale: Math.max(4, Math.min(800, viewRef.current.scale * f)) }
  }, [])

  // Pan drag
  const dragRef = useRef(null)
  const onMouseDown = useCallback(e => {
    if (!viewRef.current) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: viewRef.current.cx, cy: viewRef.current.cy }
  }, [])
  const onMouseMove = useCallback(e => {
    if (!dragRef.current || !viewRef.current) return
    const dx = (e.clientX - dragRef.current.sx) / viewRef.current.scale
    const dy = (e.clientY - dragRef.current.sy) / viewRef.current.scale
    viewRef.current = { ...viewRef.current, cx: dragRef.current.cx - dx, cy: dragRef.current.cy + dy }
  }, [])
  const onMouseUp = useCallback(() => { dragRef.current = null }, [])

  // RAF draw loop
  useEffect(() => {
    let raf
    const draw = () => {
      const canvas = canvasRef.current
        const scan     = scanRef.current;
      if (!canvas) { raf = requestAnimationFrame(draw); return }
      const W = canvas.offsetWidth, H = canvas.offsetHeight
      if (W < 1 || H < 1) { raf = requestAnimationFrame(draw); return }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; fittedRef.current = false }
      if (!viewRef.current || !fittedRef.current) { fitView(); fittedRef.current = true }
      if (!viewRef.current) { raf = requestAnimationFrame(draw); return }

      const v = viewRef.current
      viewRef.current.W = W; viewRef.current.H = H
      const toC = (wx, wy) => ({ x: (wx - v.cx) * v.scale + W / 2, y: -(wy - v.cy) * v.scale + H / 2 })

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#0a0e16'; ctx.fillRect(0, 0, W, H)

      // Background grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1
      const gridStep = 50
      for (let gx = W % gridStep; gx < W; gx += gridStep) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke()
      }
      for (let gy = H % gridStep; gy < H; gy += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke()
      }

      // Map tile
      const md = mapDataRef.current
      if (tileRef.current && md) {
        const tl = toC(md.originX, md.originY + md.height * md.resolution)
        const br = toC(md.originX + md.width * md.resolution, md.originY)
        const pw = br.x - tl.x, ph = br.y - tl.y
        if (pw > 2 && ph > 2) {
          ctx.save()
          ctx.imageSmoothingEnabled = pw < md.width * 2
          ctx.drawImage(tileRef.current, tl.x, tl.y, pw, ph)
          ctx.restore()
          // Map border
          ctx.strokeStyle = 'rgba(0,200,255,0.15)'; ctx.lineWidth = 1
          ctx.strokeRect(tl.x, tl.y, pw, ph)
        }
      } else {
        // No map yet
        ctx.fillStyle = 'rgba(255,255,255,0.04)'
        for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y += 40) ctx.fillRect(x-1, y-1, 2, 2)
        ctx.fillStyle = 'rgba(232,232,232,0.1)'; ctx.font = '12px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(isOutdoorRef.current ? 'No 2D preview (outdoor)' : 'Waiting for /map…', W/2, H/2 - 10)
        ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(232,232,232,0.05)'
        ctx.fillText(isOutdoorRef.current ? 'LidarSLAM builds a point cloud — view in RViz' : 'Start mapping to see map grow here', W/2, H/2 + 10)
      }
     

      // Lines 199–206 corrected:
if (scanRef.current?.length > 0) {
  ctx.fillStyle = 'rgba(255,0,0,0.9)'
  for (const pt of scanRef.current) {
    const c = toC(pt.x, pt.y)  // ✅ correct coordinate converter
    if (c.x < -20 || c.x > W + 20 || c.y < -20 || c.y > H + 20) continue
    ctx.beginPath(); ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2); ctx.fill()
  }
}

      // Robot dot
      const rp = robotPosRef.current
      if (rp) {
        const rc = toC(rp.x, rp.y)
        const yaw = rp.yaw ?? 0
        // Glow
        const grad = ctx.createRadialGradient(rc.x, rc.y, 2, rc.x, rc.y, 18)
        grad.addColorStop(0, 'rgba(0,210,255,0.35)'); grad.addColorStop(1, 'rgba(0,210,255,0)')
        ctx.beginPath(); ctx.arc(rc.x, rc.y, 18, 0, Math.PI*2); ctx.fillStyle = grad; ctx.fill()
        // Body
        ctx.beginPath(); ctx.arc(rc.x, rc.y, 8, 0, Math.PI*2)
        ctx.fillStyle = 'rgba(0,200,255,0.95)'; ctx.fill()
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke()
        // Heading arrow
        const ax = rc.x + Math.cos(yaw) * 16, ay = rc.y - Math.sin(yaw) * 16
        ctx.beginPath(); ctx.moveTo(rc.x, rc.y); ctx.lineTo(ax, ay)
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'
        const ang = Math.atan2(rc.y - ay, ax - rc.x)
        ctx.beginPath()
        ctx.moveTo(ax, ay); ctx.lineTo(ax - 6*Math.cos(ang-0.45), ay + 6*Math.sin(ang-0.45))
        ctx.moveTo(ax, ay); ctx.lineTo(ax - 6*Math.cos(ang+0.45), ay + 6*Math.sin(ang+0.45))
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
      }

      // Scale bar
      const sc = viewRef.current?.scale || 1
      const scM = Math.pow(10, Math.floor(Math.log10(120 / sc))) || 1
      const scPx = scM * sc, sx = W - 20 - scPx, sy = H - 14
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx+scPx, sy)
      ctx.moveTo(sx, sy-3); ctx.lineTo(sx, sy+3)
      ctx.moveTo(sx+scPx, sy-3); ctx.lineTo(sx+scPx, sy+3); ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '9px monospace'; ctx.textAlign = 'center'
      ctx.fillText(`${scM}m`, sx + scPx/2, sy - 5)

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [fitView])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      style={{ cursor: 'grab' }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  )
}

// ── Save Map Modal ────────────────────────────────────────────────────────────
function SaveMapModal({ onSave, onCancel, saving }) {
  const [name, setName] = useState('')
  const [err,  setErr]  = useState('')

  const validate = (v) => {
    if (!v.trim()) return 'Map name is required'
    if (!/^[a-zA-Z0-9_-]+$/.test(v.trim())) return 'Only letters, numbers, _ and - allowed'
    return ''
  }

  const handleSave = () => {
    const e = validate(name)
    if (e) { setErr(e); return }
    onSave(name.trim())
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:50,
      background:'rgba(0,0,0,0.75)',
      display:'flex', alignItems:'center', justifyContent:'center',
    }}>
      <div style={{
        background:'#0d1117', border:'1px solid rgba(200,0,10,0.4)',
        width:360, boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
        display:'flex', flexDirection:'column',
      }}>
        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'1px solid rgba(255,255,255,0.08)', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:3, height:18, background:'#C8000A', flexShrink:0 }} />
          <div>
            <p style={{ fontFamily:'monospace', fontWeight:700, fontSize:12, color:'#fff', letterSpacing:'0.12em', textTransform:'uppercase', margin:0 }}>Save Map</p>
            <p style={{ fontFamily:'monospace', fontSize:8, color:'rgba(255,255,255,0.3)', letterSpacing:'0.15em', textTransform:'uppercase', margin:'3px 0 0' }}>SLAM · Stop &amp; Export</p>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:'18px 18px 14px', display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{
            padding:'10px 14px', background:'rgba(200,0,10,0.06)',
            border:'1px solid rgba(200,0,10,0.2)',
            fontFamily:'monospace', fontSize:9, color:'rgba(245,158,11,0.85)', letterSpacing:'0.1em',
          }}>
            ⚠ This will stop mapping and save the map. Localization and navigation will need to be restarted manually.
          </div>

          <div>
            <label style={{ fontFamily:'monospace', fontSize:8, letterSpacing:'0.2em', color:'rgba(255,255,255,0.3)', textTransform:'uppercase', display:'block', marginBottom:6 }}>
              Map Name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              placeholder="e.g.  warehouse_b2"
              onChange={e => { setName(e.target.value); setErr('') }}
              onKeyDown={e => e.key === 'Enter' && !saving && handleSave()}
              style={{
                width:'100%', boxSizing:'border-box',
                background:'rgba(0,0,0,0.5)', border:`1px solid ${err ? '#C8000A' : 'rgba(255,255,255,0.15)'}`,
                color:'#fff', fontFamily:'monospace', fontSize:12,
                padding:'9px 12px', outline:'none', letterSpacing:'0.05em',
              }}
              onFocus={e => !err && (e.target.style.borderColor='rgba(200,0,10,0.55)')}
              onBlur={e  => !err && (e.target.style.borderColor='rgba(255,255,255,0.15)')}
            />
            {err && (
              <p style={{ fontFamily:'monospace', fontSize:8, color:'#ef4444', marginTop:4, letterSpacing:'0.1em' }}>{err}</p>
            )}
            <p style={{ fontFamily:'monospace', fontSize:8, color:'rgba(255,255,255,0.2)', marginTop:5, letterSpacing:'0.1em' }}>
              Letters, numbers, underscores and hyphens only
            </p>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display:'flex', borderTop:'1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={onCancel} disabled={saving}
            style={{
              flex:1, padding:'12px 0', cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily:'monospace', fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase',
              background:'transparent', border:'none',
              color: saving ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.3)',
              borderRight:'1px solid rgba(255,255,255,0.07)',
              transition:'color 0.15s',
            }}
            onMouseEnter={e => { if (!saving) e.target.style.color='rgba(255,255,255,0.6)' }}
            onMouseLeave={e => { e.target.style.color = saving ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.3)' }}
          >
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            style={{
              flex:1, padding:'12px 0',
              fontFamily:'monospace', fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight:700,
              background: saving || !name.trim() ? 'transparent' : 'rgba(200,0,10,0.15)',
              border:'none',
              color: saving || !name.trim() ? 'rgba(255,255,255,0.2)' : '#C8000A',
              cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              transition:'all 0.15s',
            }}>
            {saving
              ? <><span style={{ width:10, height:10, border:'1px solid currentColor', borderTopColor:'transparent', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite' }} /> Saving…</>
              : '■ Stop & Save'
            }
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position:'fixed', top:16, right:16, zIndex:60, display:'flex', flexDirection:'column', gap:6, pointerEvents:'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          fontFamily:'monospace', fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase',
          padding:'8px 14px', border:`1px solid ${t.ok ? 'rgba(34,197,94,0.4)' : 'rgba(200,0,10,0.45)'}`,
          background: t.ok ? 'rgba(34,197,94,0.1)' : 'rgba(200,0,10,0.12)',
          color: t.ok ? '#22c55e' : '#ef4444',
          display:'flex', alignItems:'center', gap:8,
        }}>
          <span>{t.ok ? '✓' : '✕'}</span><span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

// ─── StatBox ──────────────────────────────────────────────────────────────────
function StatBox({ label, value, accent }) {
  return (
    <div className="bg-black/30 border border-white/6 px-2.5 py-2">
      <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
      <p className="font-mono text-[11px] truncate" style={{ color: accent || 'rgba(255,255,255,0.7)' }}>{value ?? '—'}</p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MappingPage
// ══════════════════════════════════════════════════════════════════════════════
export default function MappingPage() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

  // Indoor (slam_toolbox → /map grid) vs outdoor (lidarslam → .pcd, no 2D grid)
  const { environment } = useEnvironment()
  const isOutdoor = environment === 'outdoor'
  const isOutdoorRef = useRef(isOutdoor)
  useEffect(() => { isOutdoorRef.current = isOutdoor }, [isOutdoor])
  
  // Map state
  const [mapData,    setMapData]    = useState(null)
  const [mapInfo,    setMapInfo]    = useState(null)   // { width, height, resolution }
  const [robotPos,   setRobotPos]   = useState(null)
  const robotPosRef = useRef(null)
   useEffect(() => { robotPosRef.current = robotPos }, [robotPos])
  const { scanActive, scanPoints, scanPointsRef, toggleScan, pointCount } = useScan(subscribe, ready, robotPosRef)

  // ── SINGLE SOURCE OF TRUTH: mappingPhase ────────────────────────────────────
  // One enum drives everything. No competing signals, no ref/state mixing.
  //
  //  'idle'     → fresh load or after save. Start=enabled, Stop&Save=disabled
  //  'starting' → POST /api/mapping/start sent, waiting for response
  //  'active'   → start API returned 200. Start=disabled, Stop&Save=enabled
  //  'saving'   → POST /api/mapping/stop_and_save sent, waiting for response
  //
  // The polling result (gmapping_running) ONLY updates phase when we are in
  // 'active' — and only to confirm it's still running. It cannot flip 'idle'
  // to 'active' (so stale pgrep can't re-enable Stop&Save on refresh).
  // tempReady from the poll is IGNORED for button state — it only shows the
  // amber hint banner, never enables Stop&Save on its own.
  const [mappingPhase, setMappingPhase] = useState('idle')
  // mappingStatus still holds raw poll data for the status panel display
  const [mappingStatus, setMappingStatus] = useState(null)
  const [apiLoading,    setApiLoading]    = useState({})
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saving,        setSaving]        = useState(false)

  // Derived convenience booleans — all from one place
  const isIdle     = mappingPhase === 'idle'
  const isStarting = mappingPhase === 'starting'
  const isActive   = mappingPhase === 'active'
  const isSaving   = mappingPhase === 'saving'
  const gmapping   = isStarting || isActive   // alias kept for existing UI references

  // tempReady: only show the amber "unsaved map on disk" hint, never drives buttons
  const tempReady  = mappingStatus?.temp_map_ready ?? false

  // Event log
  const [eventLog, setEventLog] = useState([])
  const logRef = useRef(null)
  const addLog = useCallback((msg, type = 'info') =>
    setEventLog(p => [...p.slice(-120), { t: Date.now(), msg, type }]), [])

  // Toast
  const [toasts, setToasts] = useState([])
  const toast = useCallback((msg, ok = true) => {
    const id = Date.now()
    setToasts(p => [...p.slice(-4), { id, msg, ok }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])

  // Explored cell count
  const [exploredCells, setExploredCells] = useState(0)

  // ── ROS setup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')
    advertise(CMD_VEL, 'geometry_msgs/Twist')

    const unsubs = [
      // Live map from slam_toolbox — purely visual, never drives button state
      subscribe('/map', 'nav_msgs/OccupancyGrid', (msg) => {
        const decoded = decodeOccupancyGrid(msg)
        if (!decoded) return
        setMapData(decoded)
        setMapInfo({ width: msg.info.width, height: msg.info.height, resolution: msg.info.resolution })
        const free = msg.data.filter(v => v === 0).length
        setExploredCells(free)
      }, { throttle_rate: 500, queue_length: 1 }),

      // AMCL pose (not running during mapping — handled gracefully)
      subscribe('/amcl_pose', 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
        const pos = msg.pose?.pose?.position, ori = msg.pose?.pose?.orientation
        if (!pos) return
        let yaw = 0
        if (ori) { const { x, y, z, w } = ori; yaw = Math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z)) }
        setRobotPos({ x: pos.x, y: pos.y, yaw })
      }),

      // Odometry — primary robot position during mapping (AMCL is off)
      subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
        const pos = msg.pose?.pose?.position, ori = msg.pose?.pose?.orientation
        if (!pos) return
        let yaw = 0
        if (ori) { const { x, y, z, w } = ori; yaw = Math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z)) }
        setRobotPos({ x: pos.x, y: pos.y, yaw })
      }),
    ]
    return () => unsubs.forEach(fn => fn?.())
  }, [ready, subscribe, advertise, addLog])

  // ── Poll mapping status every 5 s — display only ───────────────────────────
  // The poll result NEVER changes button state. mappingPhase is the sole authority.
  // Poll is only used to populate the status panel (SLAM Process row, Temp Map row).
  const inFlightRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/mapping/status')
      if (res.ok) {
        setMappingStatus(res.data)
        console.log('[MappingPage] poll →', res.data, '| phase:', mappingPhase)
      }
    } catch (err) {
      console.error('[MappingPage] fetchStatus error:', err)
    }
  }, [mappingPhase])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [fetchStatus])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [eventLog])

  // ── API actions ─────────────────────────────────────────────────────────────
  const startMapping = async () => {
    if (inFlightRef.current) {
      console.warn('[MappingPage] startMapping: blocked — in flight')
      return
    }
    if (mappingPhase !== 'idle') {
      console.warn('[MappingPage] startMapping: blocked — phase is', mappingPhase)
      return
    }

    inFlightRef.current = true
    setMappingPhase('starting')
    setApiLoading(p => ({ ...p, start: true }))
    addLog('→ Starting SLAM mapping…', 'cmd')
    console.log('[MappingPage] startMapping → POST /api/mapping/start')

    try {
      const res = await apiFetch('/api/mapping/start', { method: 'POST' })
      console.log('[MappingPage] start response:', res.status, res.data)

      if (res.ok) {
        setMappingPhase('active')           // ← only place that sets active
        setMapData(null); setMapInfo(null); setExploredCells(0)
        addLog(`✓ ${res.data.message}`, 'ok')
        toast('Mapping started', true)
      } else {
        setMappingPhase('idle')             // roll back
        addLog(`✗ ${res.data.error || 'Failed to start'}`, 'error')
        toast(res.data.error || 'Failed to start', false)
      }
    } catch (e) {
      setMappingPhase('idle')
      addLog(`✗ Network error: ${e.message}`, 'error')
      toast('Network error', false)
    }

    setApiLoading(p => ({ ...p, start: false }))
    inFlightRef.current = false
  }

  const stopAndSave = async (mapName) => {
    if (inFlightRef.current) {
      console.warn('[MappingPage] stopAndSave: blocked — in flight')
      return
    }
    if (mappingPhase !== 'active') {
      console.warn('[MappingPage] stopAndSave: blocked — phase is', mappingPhase)
      return
    }

    inFlightRef.current = true
    setMappingPhase('saving')
    setSaving(true)
    addLog(`→ Stopping SLAM and saving as '${mapName}'…`, 'cmd')
    console.log(`[MappingPage] stopAndSave → POST /api/mapping/stop_and_save { map_name: '${mapName}' }`)

    try {
      const res = await apiFetch('/api/mapping/stop_and_save', {
        method: 'POST',
        body: JSON.stringify({ map_name: mapName }),
      })
      console.log('[MappingPage] stop response:', res.status, res.data)

      if (res.ok) {
        setMappingPhase('idle')             // ← only place that returns to idle after save
        setShowSaveModal(false)
        addLog(`✓ ${res.data.message}`, 'ok')
        toast(`Map '${mapName}' saved`, true)
        await fetchStatus()
      } else {
        setMappingPhase('active')           // roll back — still running
        addLog(`✗ ${res.data.error || 'Save failed'}`, 'error')
        toast(res.data.error || 'Save failed', false)
      }
    } catch (e) {
      setMappingPhase('active')
      addLog(`✗ Network error: ${e.message}`, 'error')
      toast('Network error', false)
    }

    setSaving(false)
    inFlightRef.current = false
  }

  // ── Derived display ─────────────────────────────────────────────────────────
  const wsCol      = wsStatus === 'CONNECTED' ? '#22c55e' : wsStatus === 'CONNECTING' ? '#f59e0b' : '#ef4444'
  const exploredM2 = mapInfo ? (exploredCells * mapInfo.resolution * mapInfo.resolution).toFixed(1) : '—'

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden font-mono">

      <Toast toasts={toasts} />

      {showSaveModal && (
        <SaveMapModal
          onSave={stopAndSave}
          onCancel={() => !saving && setShowSaveModal(false)}
          saving={saving}
        />
      )}

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red flex-shrink-0" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase leading-none">Mapping</h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase mt-0.5">{isOutdoor ? 'LidarSLAM · PCD Mapping · Point Cloud Builder' : 'GMapping SLAM · Live Exploration · Map Builder'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Mapping state badge */}
          {/* ROS badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase"
            style={{ borderColor: `${wsCol}44`, background: `${wsCol}0d`, color: wsCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: wsCol }} />
           {wsStatus}
          </div>
           <ScanButton scanActive={scanActive} toggleScan={toggleScan} pointCount={pointCount} disabled={!ready} />
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase"
            style={{ borderColor: `${isActive ? '#22c55e' : '#94a3b8'}44`, background: `${isActive ? '#22c55e' : '#94a3b8'}0d`, color: isActive ? '#22c55e' : '#94a3b8' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: isActive ? '#22c55e' : '#94a3b8', boxShadow: isActive ? '0 0 6px #22c55e' : 'none' }} />
            {isStarting ? 'STARTING…' : isActive ? 'MAPPING ACTIVE' : isSaving ? 'SAVING…' : 'IDLE'}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ══ Map area ══ */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">

          {/* Growing map canvas */}
          <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
            {/* Corner brackets */}
            {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
              'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls, i) => (
              <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
            ))}

            {/* Top-left overlay */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              {isActive && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-black/60 border border-green-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="font-mono text-green-400 text-[8px] tracking-widest uppercase">Live Building</span>
                </div>
              )}
            </div>

            {/* Map info overlay */}
            {mapInfo && (
              <div className="absolute top-3 right-3 z-10 pointer-events-none">
                <span className="font-mono text-white/20 text-[8px] tracking-widest">
                  {mapInfo.width}×{mapInfo.height} @ {mapInfo.resolution.toFixed(3)}m/cell
                </span>
              </div>
            )}

            {/* Bottom hints */}
            <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/15 text-[7px] tracking-widest uppercase">scroll = zoom · drag = pan</span>
            </div>

            {/* Legend */}
            <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
              {[
                { col:'rgba(210,215,220,1)', label:'Free space' },
                { col:'rgba(20,20,20,1)',    label:'Obstacle'   },
                { col:'rgba(50,55,65,1)',    label:'Unknown'    },
                { col:'rgba(0,200,255,0.9)', label:'Robot'      },
              ].map(({ col, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div style={{ width:10, height:10, borderRadius:2, background:col, border:'1px solid rgba(255,255,255,0.1)', flexShrink:0 }} />
                  <span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
                </div>
              ))}
            </div>

            <MapCanvas mapData={mapData} robotPos={robotPos} cellsExplored={exploredCells}               scanPoints={scanPoints}
              scanPointsRef={scanPointsRef}  />
          </div>

          {/* Stats bar */}
          <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3 grid grid-cols-4 gap-3">
            <StatBox label="Status"
              value={isStarting ? 'STARTING' : isActive ? 'MAPPING' : isSaving ? 'SAVING' : 'IDLE'}
              accent={isActive ? '#22c55e' : isStarting || isSaving ? '#f59e0b' : '#94a3b8'} />
            <StatBox label="Map Size"
              value={mapInfo ? `${mapInfo.width}×${mapInfo.height}` : '—'} />
            <StatBox label="Explored"
              value={exploredM2 !== '—' ? `${exploredM2} m²` : '—'}
              accent="#38bdf8" />
            <StatBox label="Robot Pos"
              value={robotPos ? `${robotPos.x.toFixed(1)}, ${robotPos.y.toFixed(1)}` : '—'} />
          </div>
        </div>

        {/* ══ Right panel ══ */}
        <div className="w-64 flex-shrink-0 flex flex-col border-l border-brand-border overflow-y-auto overflow-x-hidden">

          {/* ─ Mapping Controls ─ */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-0.5 h-4 bg-brand-red flex-shrink-0" />
              <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Mapping Control</p>
            </div>

            {/* Workflow steps */}
            <div className="flex flex-col gap-1.5 mb-3">
              {[
                { n:'01', label: isOutdoor ? 'Start LidarSLAM' : 'Start GMapping', done: isActive || isSaving },
                { n:'02', label:'Drive to explore', done: isActive && exploredCells > 100 },
                { n:'03', label:'Stop & Save map',  done: isIdle && !!mapData },
              ].map(s => (
                <div key={s.n} className="flex items-center gap-2 px-2 py-1.5 border"
                  style={{ borderColor: s.done ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)', background: s.done ? 'rgba(34,197,94,0.05)' : 'transparent' }}>
                  <span className="font-mono text-[7px] flex-shrink-0" style={{ color: s.done ? '#22c55e' : 'rgba(255,255,255,0.2)' }}>{s.n}</span>
                  <span className="font-mono text-[9px] tracking-wide" style={{ color: s.done ? '#22c55e' : 'rgba(255,255,255,0.4)' }}>{s.label}</span>
                  {s.done && <span className="ml-auto text-green-400 text-[9px] flex-shrink-0">✓</span>}
                </div>
              ))}
            </div>

            {/* Start Mapping button */}
            <button
              onClick={startMapping}
              disabled={!isIdle || isStarting}
              className="w-full flex items-center justify-between px-3 py-2.5 border font-mono text-[10px] tracking-widest uppercase transition-all mb-2"
              style={{
                borderColor: !isIdle ? 'rgba(255,255,255,0.08)' : 'rgba(34,197,94,0.5)',
                background:  !isIdle ? 'transparent'            : 'rgba(34,197,94,0.1)',
                color:       !isIdle ? 'rgba(255,255,255,0.2)'  : '#22c55e',
                cursor:      !isIdle ? 'not-allowed'            : 'pointer',
                opacity:     !isIdle ? 0.45                     : 1,
              }}
            >
              <span>{isStarting ? 'Starting…' : 'Start Mapping'}</span>
              <span>{isStarting ? '…' : '▶'}</span>
            </button>

            {/* Stop & Save button */}
            <button
              onClick={() => setShowSaveModal(true)}
              disabled={!isActive}
              className="w-full flex items-center justify-between px-3 py-2.5 border font-mono text-[10px] tracking-widest uppercase transition-all"
              style={{
                borderColor: !isActive ? 'rgba(255,255,255,0.08)' : 'rgba(200,0,10,0.5)',
                background:  !isActive ? 'transparent'            : 'rgba(200,0,10,0.1)',
                color:       !isActive ? 'rgba(255,255,255,0.2)'  : '#C8000A',
                cursor:      !isActive ? 'not-allowed'            : 'pointer',
                opacity:     !isActive ? 0.45                     : 1,
              }}
            >
              <span>{isSaving ? 'Saving…' : 'Stop & Save'}</span>
              <span>{isSaving ? '…' : '■'}</span>
            </button>

            {/* Temp map ready hint */}
            {tempReady && !gmapping && (
              <div className="mt-2 px-2 py-1.5 border border-amber-500/30 bg-amber-500/5">
                <p className="font-mono text-[8px] text-amber-400 tracking-wide">
                  ◈ Unsaved map on disk — click Stop &amp; Save to export
                </p>
              </div>
            )}
          </div>

          {/* ─ Teleop Panel ─ */}
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

          {/* ─ API Status ─ */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-0.5 h-4 bg-brand-red flex-shrink-0" />
              <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Process Status</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {[
                ...(isOutdoor
                  ? [{ label: 'LidarSLAM',    value: mappingStatus?.gmapping_running ? 'RUNNING' : 'NOT FOUND', ok: mappingStatus?.gmapping_running }]
                  : [{ label: 'SLAM Process', value: mappingStatus?.gmapping_running ? 'RUNNING' : 'NOT FOUND', ok: mappingStatus?.gmapping_running },
                     { label: '/map Topic',   value: isActive || isSaving ? 'PUBLISHING' : 'WAITING', ok: isActive || isSaving }]),
                { label: 'Temp Map',      value: tempReady ? 'READY' : 'NONE', ok: tempReady },
                { label: 'ROS Bridge',    value: wsStatus,  ok: wsStatus === 'CONNECTED' },
                { label: 'Robot Odom',    value: robotPos ? 'RECEIVING' : 'WAITING', ok: !!robotPos },
              ].map(({ label, value, ok }) => (
                <div key={label} className="flex items-center justify-between px-2.5 py-1.5 border border-white/5 bg-black/20">
                  <span className="font-mono text-[9px] text-white/40 tracking-wide uppercase">{label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: ok ? '#22c55e' : '#ef4444' }} />
                    <span className="font-mono text-[9px] tracking-widest uppercase"
                      style={{ color: ok ? '#22c55e' : 'rgba(255,255,255,0.3)' }}>
                      {value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ─ Instructions ─ */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-0.5 h-4 flex-shrink-0" style={{ background:'#38bdf8' }} />
              <p className="font-mono text-[8px] tracking-[0.3em] uppercase" style={{ color:'rgba(56,189,248,0.5)' }}>How to Map</p>
            </div>
            <div className="flex flex-col gap-2">
              {(isOutdoor ? [
                ['01', 'Click Start Mapping. LidarSLAM starts; localization and navigation stop automatically.'],
                ['02', 'Open Manual Control below and drive slowly to cover the whole area.'],
                ['03', 'The point cloud builds in RViz — there is no 2D preview here yet.'],
                ['04', 'When done, click Stop & Save and enter a name; the .pcd map is saved.'],
                ['05', 'Restart outdoor localization to load the new .pcd map.'],
              ] : [
                ['01', 'Click Start Mapping. Localization and navigation will stop automatically.'],
                ['02', 'Open Manual Control below and drive the robot to explore the area.'],
                ['03', 'Watch the map grow in real time on the canvas.'],
                ['04', 'When done, click Stop & Save, enter a name, and confirm.'],
                ['05', 'Restart localization from System Control using the new map.'],
              ]).map(([n, text]) => (
                <div key={n} className="flex gap-2">
                  <span className="font-mono text-[8px] text-brand-red/50 flex-shrink-0 mt-px">{n}</span>
                  <span className="font-mono text-[8px] text-white/35 leading-relaxed tracking-wide">{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ─ Event Log ─ */}
          <div className="flex-1 flex flex-col min-h-0 p-4">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
            <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0" style={{ minHeight: 80 }}>
              {eventLog.length === 0 && (
                <p className="font-mono text-[8px] text-white/10 tracking-widest uppercase">waiting…</p>
              )}
              {eventLog.map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
                  <span className="font-mono text-[7px] text-white/15 flex-shrink-0 mt-px">
                    {new Date(e.t).toLocaleTimeString('en', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                  </span>
                  <span className={`font-mono text-[9px] leading-tight break-all ${
                    e.type === 'cmd'   ? 'text-brand-red'  :
                    e.type === 'ok'    ? 'text-green-400'  :
                    e.type === 'error' ? 'text-red-400'    :
                    'text-white/30'
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