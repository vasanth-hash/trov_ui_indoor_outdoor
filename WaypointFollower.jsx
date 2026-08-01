import { useEffect, useRef, useState, useCallback } from 'react'

// ── Config ────────────────────────────────────────────────────────────────────
const ROSBRIDGE_URL   = 'wss://trovcamera.edgeforce.in/ros/'
const LOCALIZATION_API = 'https://trovcamera.edgeforce.in/api/localization/restart'

// ── Topics ────────────────────────────────────────────────────────────────────
// NOTE: available_routes_follower is the dedicated follower topic (separate from
// recorder's available_routes) — matches the Python node's routes_topic param.
// If your node uses 'available_routes', change this line only.
const TOPIC = {
  STATUS:    'route_follower/status',
  ROUTES:    'available_routes_follower',   // ← follower-specific topic
  FULL_PATH: 'route_follower/full_path',
  REMAINING: 'route_follower/remaining_path',
  START:     'route_follower/start',
  STOP:      'route_follower/stop',
  RESUME:    'route_follower/resume',
  SET_ROUTE: 'route_follower/set_route',
  MAP:       '/map',
  AMCL:      '/amcl_pose',
}

const C = {
  red:      '#C8000A',
  green:    '#22c55e',
  amber:    '#f59e0b',
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

// ── useRosBridge ──────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef      = useRef(null)
  const subMap     = useRef({})
  const advMap     = useRef({})
  const idCounter  = useRef(0)           // unique IDs — no timestamp collisions
  const [ready,    setReady]    = useState(false)
  const [wsStatus, setWsStatus] = useState('CONNECTING')
  const reconnRef  = useRef(null)

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
      reconnRef.current = setTimeout(connect, 3000)
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
    return () => { clearTimeout(reconnRef.current); wsRef.current?.close() }
  }, [connect])

  const subscribe = useCallback((topic, type, cb, opts = {}) => {
    const id = `sub_${++idCounter.current}_${topic.replace(/\//g, '_')}`
    subMap.current[id] = { topic, type, cb, opts }
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ op: 'subscribe', id, topic, type, ...opts }))
    return () => {
      delete subMap.current[id]
      wsRef.current?.readyState === WebSocket.OPEN &&
        wsRef.current.send(JSON.stringify({ op: 'unsubscribe', id, topic }))
    }
  }, [])

  const advertise = useCallback((topic, type) => {
    advMap.current[topic] = type
    wsRef.current?.readyState === WebSocket.OPEN &&
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
  const offscreen = new OffscreenCanvas(width, height)
  const ctx = offscreen.getContext('2d')
  const imgData = ctx.createImageData(width, height)
  const px = imgData.data
  for (let row = 0; row < height; row++) {
    const canvasRow = height - 1 - row
    for (let col = 0; col < width; col++) {
      const rosIdx    = row * width + col
      const canvasIdx = (canvasRow * width + col) * 4
      const v = data[rosIdx]
      if (v === -1) { px[canvasIdx]=px[canvasIdx+1]=px[canvasIdx+2]=128; px[canvasIdx+3]=255 }
      else if (v === 0) { px[canvasIdx]=px[canvasIdx+1]=px[canvasIdx+2]=210; px[canvasIdx+3]=255 }
      else { const d=Math.round(210-(v/100)*200); px[canvasIdx]=px[canvasIdx+1]=px[canvasIdx+2]=d; px[canvasIdx+3]=255 }
    }
  }
  ctx.putImageData(imgData, 0, 0)
  return { bitmap: offscreen, width, height, resolution, originX: origin.position.x, originY: origin.position.y }
}

// ── MapCanvas ─────────────────────────────────────────────────────────────────
function MapCanvas({ mapData, fullPath, remainingPath, robotPos }) {
  const canvasRef = useRef(null)
  const viewRef   = useRef({ cx: 0, cy: 0, scale: 60 })
  const dragRef   = useRef(null)
  const fittedRef = useRef(false)

  const getBounds = useCallback(() => {
    const pts = []
    if (mapData) {
      pts.push({ x: mapData.originX, y: mapData.originY })
      pts.push({ x: mapData.originX + mapData.width * mapData.resolution, y: mapData.originY + mapData.height * mapData.resolution })
    }
    fullPath?.forEach(p => pts.push({ x: p.pose.position.x, y: p.pose.position.y }))
    if (!pts.length) return null
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity
    pts.forEach(p => { if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y })
    return { minX, maxX, minY, maxY }
  }, [mapData, fullPath])

  const fitView = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const bounds = getBounds(); if (!bounds) return
    const { minX, maxX, minY, maxY } = bounds
    const W = canvas.offsetWidth || 800, H = canvas.offsetHeight || 500
    viewRef.current = {
      cx: (minX+maxX)/2, cy: (minY+maxY)/2,
      scale: Math.min((W/(maxX-minX))*0.88, (H/(maxY-minY))*0.88),
    }
  }, [getBounds])

  const toCanvas = useCallback((wx, wy) => {
    const canvas = canvasRef.current; if (!canvas) return { x:0, y:0 }
    const W = canvas.offsetWidth || 800, H = canvas.offsetHeight || 500
    const { cx, cy, scale } = viewRef.current
    return { x: (wx-cx)*scale + W/2, y: -(wy-cy)*scale + H/2 }
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const W = canvas.offsetWidth || 800, H = canvas.offsetHeight || 500
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#080d14'; ctx.fillRect(0, 0, W, H)

    if (mapData) {
      const { bitmap, width, height, resolution, originX, originY } = mapData
      const tl = toCanvas(originX, originY + height*resolution)
      const br = toCanvas(originX + width*resolution, originY)
      const pw = br.x-tl.x, ph = br.y-tl.y
      if (pw > 0 && ph > 0) {
        ctx.save(); ctx.imageSmoothingEnabled = false
        ctx.drawImage(bitmap, tl.x, tl.y, pw, ph); ctx.restore()
        ctx.strokeStyle='rgba(0,200,255,0.15)'; ctx.lineWidth=1; ctx.strokeRect(tl.x,tl.y,pw,ph)
      }
    } else {
      ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1
      for (let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
      for (let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
      ctx.fillStyle='rgba(232,232,232,0.12)'; ctx.font='11px monospace'; ctx.textAlign='center'
      ctx.fillText('Waiting for /map…', W/2, H/2)
    }

    if (remainingPath?.length > 1) {
      ctx.beginPath(); ctx.strokeStyle=C.pathRem; ctx.lineWidth=2.5; ctx.setLineDash([])
      remainingPath.forEach((p,i) => { const c=toCanvas(p.pose.position.x,p.pose.position.y); i===0?ctx.moveTo(c.x,c.y):ctx.lineTo(c.x,c.y) })
      ctx.stroke()
    }
    if (fullPath?.length > 1) {
      ctx.beginPath(); ctx.strokeStyle=C.pathFull; ctx.lineWidth=2; ctx.setLineDash([6,5])
      fullPath.forEach((p,i) => { const c=toCanvas(p.pose.position.x,p.pose.position.y); i===0?ctx.moveTo(c.x,c.y):ctx.lineTo(c.x,c.y) })
      ctx.stroke(); ctx.setLineDash([])
    }
    if (fullPath?.length) {
      const remSet = new Set((remainingPath||[]).map(p=>`${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`))
      fullPath.forEach((p,i) => {
        const c=toCanvas(p.pose.position.x,p.pose.position.y)
        const key=`${p.pose.position.x.toFixed(2)},${p.pose.position.y.toFixed(2)}`
        const ahead=remSet.has(key)
        ctx.beginPath(); ctx.arc(c.x,c.y,ahead?5:3.5,0,Math.PI*2)
        ctx.fillStyle=ahead?C.wpAhead:C.wpDone; ctx.fill()
        ctx.strokeStyle=ahead?'#fff':'rgba(200,0,10,0.4)'; ctx.lineWidth=1.5; ctx.stroke()
        if (ahead) { ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='8px monospace'; ctx.textAlign='center'; ctx.fillText(i+1,c.x,c.y-9) }
      })
      if (remainingPath?.length) {
        const t=remainingPath[0], tc=toCanvas(t.pose.position.x,t.pose.position.y)
        ctx.beginPath(); ctx.arc(tc.x,tc.y,13,0,Math.PI*2); ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=1.5; ctx.stroke()
        ;[[-1,0],[1,0],[0,-1],[0,1]].forEach(([dx,dy]) => {
          ctx.beginPath(); ctx.moveTo(tc.x+dx*10,tc.y+dy*10); ctx.lineTo(tc.x+dx*17,tc.y+dy*17)
          ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1.5; ctx.stroke()
        })
      }
    }
    if (robotPos) {
      const rc=toCanvas(robotPos.x,robotPos.y), yaw=robotPos.yaw??0
      const g=ctx.createRadialGradient(rc.x,rc.y,4,rc.x,rc.y,22)
      g.addColorStop(0,'rgba(0,200,255,0.25)'); g.addColorStop(1,'rgba(0,200,255,0)')
      ctx.beginPath(); ctx.arc(rc.x,rc.y,22,0,Math.PI*2); ctx.fillStyle=g; ctx.fill()
      ctx.beginPath(); ctx.arc(rc.x,rc.y,9,0,Math.PI*2); ctx.fillStyle='rgba(0,200,255,0.9)'; ctx.fill()
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke()
      const ax=rc.x+Math.cos(yaw)*18, ay=rc.y-Math.sin(yaw)*18
      ctx.beginPath(); ctx.moveTo(rc.x,rc.y); ctx.lineTo(ax,ay)
      ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt'
      const aAngle=Math.atan2(-(ay-rc.y),ax-rc.x)
      ctx.beginPath()
      ctx.moveTo(ax,ay); ctx.lineTo(ax-6*Math.cos(aAngle-Math.PI/6),ay+6*Math.sin(aAngle-Math.PI/6))
      ctx.moveTo(ax,ay); ctx.lineTo(ax-6*Math.cos(aAngle+Math.PI/6),ay+6*Math.sin(aAngle+Math.PI/6))
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke()
    }
    const { scale } = viewRef.current
    const scaleM=Math.pow(10,Math.floor(Math.log10(200/scale)))||1
    const scalePx=scaleM*scale, sx=W-20-scalePx, sy=H-14
    ctx.strokeStyle='rgba(232,232,232,0.3)'; ctx.lineWidth=1.5; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+scalePx,sy); ctx.moveTo(sx,sy-3); ctx.lineTo(sx,sy+3); ctx.moveTo(sx+scalePx,sy-3); ctx.lineTo(sx+scalePx,sy+3); ctx.stroke()
    ctx.fillStyle='rgba(232,232,232,0.35)'; ctx.font='9px monospace'; ctx.textAlign='center'
    ctx.fillText(`${scaleM}m`, sx+scalePx/2, sy-6)
  }, [mapData, fullPath, remainingPath, robotPos, toCanvas])

  useEffect(() => {
    let raf; const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf)
  }, [draw])

  useEffect(() => {
    if ((mapData || fullPath?.length) && !fittedRef.current) { fitView(); fittedRef.current = true }
  }, [mapData, fullPath, fitView])

  const onWheel = useCallback((e) => {
    e.preventDefault()
    viewRef.current = { ...viewRef.current, scale: Math.max(5, Math.min(500, viewRef.current.scale*(e.deltaY<0?1.12:0.88))) }
  }, [])
  const onMouseDown = useCallback((e) => { dragRef.current = { sx:e.clientX, sy:e.clientY, cx:viewRef.current.cx, cy:viewRef.current.cy } }, [])
  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return
    viewRef.current = { ...viewRef.current, cx: dragRef.current.cx-(e.clientX-dragRef.current.sx)/viewRef.current.scale, cy: dragRef.current.cy+(e.clientY-dragRef.current.sy)/viewRef.current.scale }
  }, [])
  const onMouseUp = useCallback(() => { dragRef.current = null }, [])

  return (
    <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair"
      onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
  )
}

// ── ProgressBar ───────────────────────────────────────────────────────────────
function ProgressBar({ segment, total }) {
  const pct = total > 0 ? Math.round((segment/total)*100) : 0
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="font-mono text-[9px] tracking-widest uppercase text-white/30">Mission Progress</span>
        <span className="font-mono text-[10px] text-white/50">{segment}/{total}&nbsp;&nbsp;<span className="text-brand-red font-bold">{pct}%</span></span>
      </div>
      <div className="w-full h-1.5 bg-white/5 rounded-sm overflow-hidden">
        <div className="h-full bg-brand-red transition-all duration-300 ease-out" style={{ width:`${pct}%` }} />
      </div>
      {total > 0 && total <= 50 && (
        <div className="relative w-full h-2 mt-1">
          {Array.from({ length: total }).map((_,i) => (
            <div key={i} className="absolute top-0 w-px h-1.5 transition-colors duration-200"
              style={{ left:`${((i+1)/total)*100}%`, background: i<segment?C.red:'rgba(255,255,255,0.1)' }} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── CtrlBtn ───────────────────────────────────────────────────────────────────
function CtrlBtn({ label, icon, onClick, disabled, variant }) {
  const V = {
    red:   { a:{ bg:'#C8000A', border:'#C8000A', color:'#fff' },                              d:{ bg:'transparent', border:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.18)' } },
    amber: { a:{ bg:'transparent', border:'rgba(245,158,11,0.5)', color:'#f59e0b' },          d:{ bg:'transparent', border:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.18)' } },
    green: { a:{ bg:'transparent', border:'rgba(34,197,94,0.45)', color:'#22c55e' },          d:{ bg:'transparent', border:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.18)' } },
  }
  const s = disabled ? V[variant].d : V[variant].a
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full py-3 font-mono text-[10px] tracking-[0.25em] uppercase font-bold transition-all flex items-center justify-center gap-2 border"
      style={{ ...s, borderColor:s.border, cursor:disabled?'not-allowed':'pointer' }}>
      <span>{icon}</span>{label}
    </button>
  )
}

// ── RouteSelector ─────────────────────────────────────────────────────────────
// Isolated component — never has stale routes
function RouteSelector({ routes, selectedRoute, onSelect, disabled, activeMap }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      {/* Map name badge */}
      {activeMap && (
        <div className="flex items-center gap-2 px-3 py-1.5 border border-brand-border bg-brand-black">
          <span className="font-mono text-[8px] tracking-widest uppercase text-white/25">Map:</span>
          <span className="font-mono text-[10px] text-white/65 truncate">{activeMap}</span>
        </div>
      )}
      {/* Route count pill */}
      {routes.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 self-start border border-green-500/25 bg-green-500/5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          <span className="font-mono text-[8px] tracking-widest text-green-400 uppercase">{routes.length} routes loaded</span>
        </div>
      )}
      {/* Dropdown */}
      <div className="relative">
        <button
          onClick={() => !disabled && setOpen(v => !v)}
          disabled={disabled}
          className="w-full flex items-center justify-between px-3 py-2 border font-mono text-xs tracking-wide transition-all"
          style={{
            borderColor: disabled ? 'rgba(255,255,255,0.07)' : 'rgba(200,0,10,0.4)',
            background:  disabled ? 'rgba(255,255,255,0.02)' : 'rgba(200,0,10,0.06)',
            color:       disabled ? 'rgba(255,255,255,0.2)'  : '#e8e8e8',
            cursor:      disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <span className="truncate">{selectedRoute || (routes.length === 0 ? 'No routes loaded…' : 'Select route…')}</span>
          <span className="text-white/25 ml-2 text-[10px] flex-shrink-0">
            {routes.length > 0 ? `▾ (${routes.length})` : '–'}
          </span>
        </button>
        {open && routes.length > 0 && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-[#161616] border border-[#2a2a2a] shadow-2xl max-h-48 overflow-y-auto">
              {routes.map(r => (
                <button key={r} onClick={() => { onSelect(r); setOpen(false) }}
                  className="w-full text-left px-3 py-2.5 font-mono text-xs tracking-wide hover:bg-[rgba(200,0,10,0.1)] transition-colors flex items-center gap-2"
                  style={{ color: r === selectedRoute ? C.red : '#e8e8e8' }}>
                  {r === selectedRoute && <span style={{ color:C.red, fontSize:8 }}>▶</span>}
                  <span>{r}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── LocalizationRestartModal ──────────────────────────────────────────────────
function LocalizationRestartModal({ onClose, onMapLoaded, addLog }) {
  const [maps,    setMaps]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)

  // Fetch available maps from the REST API when modal opens
  useEffect(() => {
    setLoading(true); setError('')
    fetch(LOCALIZATION_API, { method: 'GET' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        // API may return { maps: [...] } or a plain array
        const list = Array.isArray(data) ? data : (Array.isArray(data.maps) ? data.maps : [])
        if (!list.length) throw new Error('No maps returned')
        setMaps(list)
        addLog(`Localization API: ${list.length} maps found`, 'info')
      })
      .catch(e => {
        setError(`Failed to fetch maps: ${e.message}`)
        addLog(`Localization API error: ${e.message}`, 'error')
      })
      .finally(() => setLoading(false))
  }, [])

  const selectMap = (mapName) => {
    setBusy(true)
    // POST the chosen map to restart localization
    fetch(LOCALIZATION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ map: mapName }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json().catch(() => ({}))
      })
      .then(() => {
        addLog(`→ Localization restarted with map "${mapName}"`, 'cmd')
        onMapLoaded(mapName)
        onClose()
      })
      .catch(e => {
        setError(`Failed to load map: ${e.message}`)
        addLog(`Map load error: ${e.message}`, 'error')
        setBusy(false)
      })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#111] border border-[#2a2a2a] w-full max-w-sm mx-4 flex flex-col overflow-hidden"
        style={{ boxShadow: '0 0 60px rgba(200,0,10,0.2)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
          <div>
            <p className="font-mono font-bold text-white text-sm tracking-widest uppercase">Restart Localization</p>
            <p className="font-mono text-white/30 text-[9px] tracking-widest uppercase mt-1">{LOCALIZATION_API.replace('https://','')}</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center border border-[#2a2a2a] text-white/30 hover:border-brand-red/50 hover:text-brand-red transition-all font-mono text-sm">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          <p className="font-mono text-[9px] tracking-widest uppercase text-white/35">
            Select a map to load. The robot will re-localize on the chosen map and routes will be refreshed.
          </p>

          {loading && (
            <div className="flex items-center gap-3 py-4 justify-center">
              <span className="w-4 h-4 border border-brand-red/30 border-t-brand-red rounded-full animate-spin" />
              <span className="font-mono text-[10px] text-white/30 tracking-widest uppercase">Fetching maps…</span>
            </div>
          )}

          {error && (
            <div className="border border-brand-red/30 bg-brand-red/8 px-3 py-2.5">
              <p className="font-mono text-[9px] text-brand-red tracking-widest">⚠ {error}</p>
            </div>
          )}

          {!loading && !error && maps.length > 0 && (
            <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
              {maps.map(m => {
                const name = typeof m === 'string' ? m : (m.name || m.map || String(m))
                return (
                  <button key={name} onClick={() => !busy && selectMap(name)}
                    disabled={busy}
                    className="w-full text-left px-4 py-3 border transition-all font-mono text-[11px] tracking-wide flex items-center gap-3"
                    style={{
                      borderColor: busy ? 'rgba(255,255,255,0.07)' : 'rgba(200,0,10,0.3)',
                      background:  'rgba(200,0,10,0.04)',
                      color:       busy ? 'rgba(255,255,255,0.2)' : '#e8e8e8',
                      cursor:      busy ? 'not-allowed' : 'pointer',
                    }}
                    onMouseEnter={e => { if (!busy) { e.currentTarget.style.background='rgba(200,0,10,0.1)'; e.currentTarget.style.borderColor='rgba(200,0,10,0.5)' }}}
                    onMouseLeave={e => { e.currentTarget.style.background='rgba(200,0,10,0.04)'; e.currentTarget.style.borderColor='rgba(200,0,10,0.3)' }}
                  >
                    {busy ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin flex-shrink-0" /> : <span className="text-brand-red/50 flex-shrink-0">◉</span>}
                    <span>{name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WaypointFollower() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

  const [status,    setStatus]    = useState({ state:'IDLE', route:'—', segment:0, total:0, dist_to_goal:0 })
  const [routes,    setRoutes]    = useState([])
  const routesRef   = useRef([])
  const [activeMap, setActiveMap] = useState('')    // map name shown in UI
  const activeMapRef = useRef('')

  const [fullPath,  setFullPath]  = useState([])
  const [remaining, setRemaining] = useState([])
  const [robotPos,  setRobotPos]  = useState(null)
  const [mapData,   setMapData]   = useState(null)
  const [mapStatus, setMapStatus] = useState('waiting…')

  const [selectedRoute,    setSelectedRouteState] = useState('')
  const selectedRouteRef   = useRef('')
  const setSelectedRoute   = useCallback((val) => { selectedRouteRef.current = val; setSelectedRouteState(val) }, [])

  const [showLocModal, setShowLocModal] = useState(false)
  const [eventLog,     setEventLog]     = useState([{ t:Date.now(), msg:'Interface ready', type:'info' }])
  const addLog = useCallback((msg, type='info') =>
    setEventLog(prev => [{ t:Date.now(), msg, type }, ...prev].slice(0, 120)), [])

  // ── Subscribe — intentionally only [ready] in deps ────────────────────────
  // All callbacks read from refs so stale closure is not an issue.
  useEffect(() => {
    if (!ready) return
    addLog('rosbridge connected', 'ok')
    advertise(TOPIC.START,     'std_msgs/Empty')
    advertise(TOPIC.STOP,      'std_msgs/Empty')
    advertise(TOPIC.RESUME,    'std_msgs/Empty')
    advertise(TOPIC.SET_ROUTE, 'std_msgs/String')

    const unsubs = [
      subscribe(TOPIC.MAP, 'nav_msgs/OccupancyGrid', (msg) => {
        const decoded = decodeOccupancyGrid(msg)
        if (decoded) {
          setMapData(decoded)
          setMapStatus(`${msg.info.width}×${msg.info.height} @ ${msg.info.resolution.toFixed(3)}m/cell`)
          addLog(`Map: ${msg.info.width}×${msg.info.height}, res=${msg.info.resolution.toFixed(3)}m`, 'info')
        }
      }, { throttle_rate: 2000, queue_length: 0, latch: true }),

      subscribe(TOPIC.AMCL, 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
        const pos = msg.pose?.pose?.position, ori = msg.pose?.pose?.orientation
        if (!pos) return
        const yaw = ori ? Math.atan2(2*(ori.w*ori.z+ori.x*ori.y), 1-2*(ori.y*ori.y+ori.z*ori.z)) : 0
        setRobotPos({ x:pos.x, y:pos.y, yaw })
      }),

      subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
        const pos = msg.pose?.pose?.position, ori = msg.pose?.pose?.orientation
        if (!pos) return
        const yaw = ori ? Math.atan2(2*(ori.w*ori.z+ori.x*ori.y), 1-2*(ori.y*ori.y+ori.z*ori.z)) : 0
        setRobotPos(prev => prev ?? { x:pos.x, y:pos.y, yaw })
      }),

      subscribe(TOPIC.STATUS, 'std_msgs/String', (msg) => {
        try {
          const raw = typeof msg==='string'?msg:(msg?.data??'')
          const d   = JSON.parse(raw)
          setStatus(d)
          addLog(`[${d.state}] seg ${d.segment}/${d.total}  dist ${d.dist_to_goal??'?'}m`, 'status')
        } catch {}
      }, { queue_length:0, latch:true }),

      // ── ROUTES — handles ALL formats ──────────────────────────────────────
      // Format 1 (new indoor recorder): { map: "...", routes: [...] }
      // Format 2 (old recorder):        { "routes": [...] }   — no map key
      // Format 3 (plain array):         [...]
      subscribe(TOPIC.ROUTES, 'std_msgs/String', (msg) => {
        try {
          const raw  = typeof msg==='string' ? msg : (msg?.data ?? JSON.stringify(msg))
          const parsed = JSON.parse(raw)

          let list = []
          let mapName = ''

          if (Array.isArray(parsed)) {
            // Format 3: plain array
            list = parsed
          } else if (parsed && typeof parsed === 'object') {
            // Format 1 or 2: object with routes key
            if (Array.isArray(parsed.routes)) list = parsed.routes
            if (parsed.map && parsed.map !== 'unknown') mapName = parsed.map
          }

          if (!Array.isArray(list)) {
            addLog(`Routes: unexpected format — ${JSON.stringify(msg).slice(0,80)}`, 'info')
            return
          }

          routesRef.current = list
          setRoutes(list)

          if (mapName) {
            activeMapRef.current = mapName
            setActiveMap(mapName)
            addLog(`Map: "${mapName}"`, 'info')
          }

          if (list.length && !selectedRouteRef.current) {
            setSelectedRoute(list[0])
            addLog(`Auto-selected route: "${list[0]}"`, 'info')
          }

          addLog(`Routes (${list.length}): [${list.join(', ')}]`, 'info')
        } catch (e) {
          addLog(`Routes parse error: ${e.message}  raw=${JSON.stringify(msg).slice(0,80)}`, 'info')
        }
      }, { queue_length:0, latch:true }),

      subscribe(TOPIC.FULL_PATH, 'nav_msgs/Path', (msg) => {
        setFullPath(msg.poses||[])
        addLog(`Full path: ${(msg.poses||[]).length} pts`, 'info')
      }),

      subscribe(TOPIC.REMAINING, 'nav_msgs/Path', (msg) => {
        const rem = msg.poses||[]
        setRemaining(rem)
        setStatus(prev => {
          if (prev.total>0 && rem.length<=prev.total) return { ...prev, segment: prev.total-rem.length }
          return prev
        })
      }),
    ]

    return () => unsubs.forEach(u => u?.())
  }, [ready])    // ← intentionally only [ready]

  // ── Publish ──────────────────────────────────────────────────────────────
  const sendStart  = () => { publish(TOPIC.START,  'std_msgs/Empty', {}); addLog('→ START',  'cmd') }
  const sendStop   = () => { publish(TOPIC.STOP,   'std_msgs/Empty', {}); addLog('→ STOP',   'cmd') }
  const sendResume = () => { publish(TOPIC.RESUME, 'std_msgs/Empty', {}); addLog('→ RESUME', 'cmd') }
  const handleSelectRoute = useCallback((name) => {
    setSelectedRoute(name)
    publish(TOPIC.SET_ROUTE, 'std_msgs/String', { data: name })
    addLog(`→ SET_ROUTE: "${name}"`, 'cmd')
  }, [publish, setSelectedRoute, addLog])

  // When localization restart loads a new map, clear stale routes
  const handleMapLoaded = useCallback((mapName) => {
    activeMapRef.current = mapName
    setActiveMap(mapName)
    setRoutes([])
    routesRef.current = []
    setSelectedRoute('')
    setFullPath([])
    setRemaining([])
    addLog(`Map changed to "${mapName}" — awaiting new routes from ROS`, 'status')
  }, [setSelectedRoute, addLog])

  // ── Derived ──────────────────────────────────────────────────────────────
  const sc        = STATE_COLOR[status.state] || STATE_COLOR.IDLE
  const isRunning = status.state === 'RUNNING'
  const isStopped = status.state === 'STOPPED'
  const doneCount = Math.max(0, status.segment)
  const remCount  = Math.max(0, status.total - doneCount)
  const wsCol     = wsStatus==='CONNECTED'?'#22c55e':wsStatus==='CONNECTING'?'#f59e0b':'#ef4444'

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">Waypoint Follower</h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">
              Autonomous Route Execution · ROS2 Nav2
              {activeMap && <span className="text-white/40 ml-2">· {activeMap}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* routes loaded pill */}
          {routes.length > 0 && (
            <div className="px-2.5 py-1 border border-brand-border font-mono text-[9px] text-white/40 tracking-widest">
              {routes.length} routes
            </div>
          )}
          {/* Restart Localization button */}
          <button
            onClick={() => setShowLocModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase font-bold transition-all"
            style={{ borderColor:'rgba(245,158,11,0.45)', background:'rgba(245,158,11,0.07)', color:'#f59e0b' }}
          >
            <span>⟳</span> Load Map
          </button>
          {/* rosbridge badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor:`${wsCol}44`, background:`${wsCol}0d`, color:wsCol }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background:wsCol }} />
            rosbridge · {wsStatus}
          </div>
          {/* state badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor:sc.border, background:sc.bg, color:sc.text }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background:sc.text }} />
            {status.state}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* MAP */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3 gap-3">
          <div className="flex-1 relative border border-brand-border overflow-hidden min-h-0 bg-brand-black">
            {['top-0 left-0 border-t border-l','top-0 right-0 border-t border-r',
              'bottom-0 left-0 border-b border-l','bottom-0 right-0 border-b border-r'].map((cls,i)=>(
              <div key={i} className={`absolute w-5 h-5 ${cls} border-brand-red/35 z-10 pointer-events-none`} />
            ))}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              <span className="font-mono text-brand-red text-[9px] tracking-widest uppercase">OccupancyGrid</span>
              {activeMap && <><span className="text-white/20 font-mono text-[9px]">·</span><span className="font-mono text-white/40 text-[9px]">{activeMap}</span></>}
              {status.route && status.route !== '—' && <><span className="text-white/20 font-mono text-[9px]">·</span><span className="font-mono text-white/35 text-[9px]">{status.route}</span></>}
            </div>
            <div className="absolute top-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/20 text-[8px]">{mapStatus}</span>
            </div>
            <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
              <span className="font-mono text-white/15 text-[7px] tracking-widest uppercase">scroll=zoom · drag=pan</span>
            </div>
            <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-col gap-1">
              {[
                { style:{ borderTop:'2px dashed rgba(200,0,10,0.28)',width:22 }, label:'Completed' },
                { style:{ borderTop:'2px solid #C8000A',width:22 },             label:'Remaining' },
                { style:{ width:10,height:10,borderRadius:'50%',border:'2px solid rgba(255,255,255,0.8)',display:'inline-block'}, label:'Robot' },
                { style:{ width:10,height:10,borderRadius:'50%',border:'1px solid #C8000A',background:'#C8000A',display:'inline-block'}, label:'Waypoint'},
              ].map(({style,label})=>(
                <div key={label} className="flex items-center gap-2">
                  <div style={style} />
                  <span className="font-mono text-white/25 text-[8px] tracking-widest uppercase">{label}</span>
                </div>
              ))}
            </div>
            <MapCanvas mapData={mapData} fullPath={fullPath} remainingPath={remaining} robotPos={robotPos} />
          </div>
          <div className="flex-shrink-0 bg-brand-card border border-brand-border px-4 py-3">
            <ProgressBar segment={status.segment} total={status.total} />
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="w-60 flex-shrink-0 flex flex-col border-l border-brand-border overflow-hidden">

          {/* Route selector */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border">
            <div className="flex items-center justify-between mb-2.5">
              <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase">Active Route</p>
            </div>
            <RouteSelector
              routes={routes}
              selectedRoute={selectedRoute}
              onSelect={handleSelectRoute}
              disabled={isRunning}
              activeMap={activeMap}
            />
          </div>

          {/* Stats */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border grid grid-cols-2 gap-2">
            {[
              ['Total WPs',  status.total],
              ['Segment',    status.segment],
              ['Done',       doneCount],
              ['Remaining',  remCount],
              ['Dist Goal',  status.dist_to_goal!=null?`${status.dist_to_goal}m`:'—'],
              ['Route',      status.route],
            ].map(([label,value])=>(
              <div key={label} className="bg-brand-black border border-brand-border px-2.5 py-1.5">
                <p className="font-mono text-[7px] tracking-[0.25em] text-white/20 uppercase mb-0.5">{label}</p>
                <p className="font-mono text-[11px] text-white/75 truncate">{String(value??'—')}</p>
              </div>
            ))}
          </div>

          {/* Robot pose */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2">Robot · AMCL</p>
            <div className="grid grid-cols-3 gap-1">
              {[['X',robotPos?robotPos.x.toFixed(2):'—'],['Y',robotPos?robotPos.y.toFixed(2):'—'],['Yaw°',robotPos?.yaw!=null?(robotPos.yaw*180/Math.PI).toFixed(1):'—']].map(([l,v])=>(
                <div key={l} className="bg-brand-black border border-brand-border px-1.5 py-1">
                  <p className="font-mono text-[7px] text-white/20 uppercase">{l}</p>
                  <p className="font-mono text-[10px] text-white/70">{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Mission controls */}
          <div className="flex-shrink-0 p-4 border-b border-brand-border flex flex-col gap-2">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-1">Mission Control</p>
            <CtrlBtn label="Start Mission" icon="▶" onClick={sendStart}  disabled={isRunning||!ready}  variant="red"   />
            <CtrlBtn label="Stop"          icon="■" onClick={sendStop}   disabled={!isRunning||!ready} variant="amber" />
            <CtrlBtn label="Resume"        icon="⏵" onClick={sendResume} disabled={!isStopped||!ready} variant="green" />
          </div>

          {/* Load Map shortcut */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-brand-border">
            <button
              onClick={() => setShowLocModal(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 border font-mono text-[10px] tracking-widest uppercase font-bold transition-all"
              style={{ borderColor:'rgba(245,158,11,0.4)', background:'rgba(245,158,11,0.06)', color:'#f59e0b' }}
            >
              <span>⟳ Load Map / Restart Localization</span>
            </button>
          </div>

          {/* Event log */}
          <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
            <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-2 flex-shrink-0">Event Log</p>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
              {eventLog.map((e,i)=>(
                <div key={i} className="flex items-start gap-1.5 flex-shrink-0">
                  <span className="font-mono text-[7px] text-white/15 flex-shrink-0 mt-px">
                    {new Date(e.t).toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                  </span>
                  <span className={`font-mono text-[9px] leading-tight break-all ${
                    e.type==='cmd'?'text-brand-red':e.type==='ok'?'text-green-400':e.type==='status'?'text-amber-400':e.type==='error'?'text-red-400':'text-white/35'
                  }`}>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Localization Restart Modal */}
      {showLocModal && (
        <LocalizationRestartModal
          onClose={() => setShowLocModal(false)}
          onMapLoaded={handleMapLoaded}
          addLog={addLog}
        />
      )}
    </div>
  )
}
