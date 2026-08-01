import { useEffect, useRef, useState, useCallback } from 'react'
import { useEnvironment } from '../context/EnvironmentContext'

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE      = 'https://trovcamera.edgeforce.in'
const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'

const TOPIC = {
  FLOOD_LIGHT: '/gpio_pin32_control',
  BATTERY:     '/trov/battery/percent',
  HEADLIGHT: '/trov/headlight'
}

// ─── useRosBridge ─────────────────────────────────────────────────────────────
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
  setReady(false)
  setWsStatus('DISCONNECTED')
  if (!reconnectRef.current) {
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null
      connect()
    }, 3000)
  }
}


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
    if (ws?.readyState !== WebSocket.OPEN) return false
    if (!advMap.current[topic]) { ws.send(JSON.stringify({ op: 'advertise', topic, type })); advMap.current[topic] = type }
    ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
    return true
  }, [])

  return { ready, wsStatus, subscribe, advertise, publish }
}

// ─── API helper ───────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

// ─── Battery Icon ─────────────────────────────────────────────────────────────
function BatteryIcon({ percent }) {
  const pct   = Math.max(0, Math.min(100, percent ?? 0))
  const color = pct > 60 ? '#22c55e' : pct > 25 ? '#f59e0b' : '#ef4444'
  const fills = [75, 50, 25, 10]
  const bars  = fills.map(f => pct >= f)

  return (
    <svg width="52" height="26" viewBox="0 0 52 26" fill="none">
      {/* Body */}
      <rect x="1" y="3" width="44" height="20" rx="3" stroke={color} strokeWidth="1.5" fill="none" />
      {/* Terminal nub */}
      <rect x="45" y="9" width="6" height="8" rx="1.5" fill={color} opacity="0.6" />
      {/* Fill bars */}
      {[0,1,2,3].map(i => (
        <rect key={i}
          x={3 + i * 10 + (i > 0 ? 1 : 0)}
          y={5}
          width={9}
          height={16}
          rx={1.5}
          fill={color}
          opacity={bars[i] ? (i === 0 ? 0.9 : 0.75) : 0.1}
        />
      ))}
    </svg>
  )
}

// ─── Flood Light Icon ─────────────────────────────────────────────────────────
function FloodLightIcon({ on, size = 28 }) {
  const col = on ? '#f59e0b' : 'rgba(255,255,255,0.2)'
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      {/* Rays */}
      {on && [0,45,90,135,180,225,270,315].map(deg => {
        const r = deg * Math.PI / 180
        const x1 = 14 + Math.cos(r) * 10, y1 = 14 + Math.sin(r) * 10
        const x2 = 14 + Math.cos(r) * 13, y2 = 14 + Math.sin(r) * 13
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      })}
      {/* Bulb body */}
      <circle cx="14" cy="14" r="6" fill={on ? col : 'none'} opacity={on ? 0.2 : 1} />
      <circle cx="14" cy="14" r="6" stroke={col} strokeWidth="1.5" />
      {/* Filament */}
      <circle cx="14" cy="14" r="2.5" fill={col} opacity={on ? 1 : 0.3} />
      {/* Base */}
      <rect x="11.5" y="19.5" width="5" height="2" rx="0.5" fill={col} opacity={on ? 0.8 : 0.2} />
      <rect x="12.5" y="21" width="3" height="1.5" rx="0.5" fill={col} opacity={on ? 0.6 : 0.15} />
    </svg>
  )
}


// ─── Flood Light Icon ─────────────────────────────────────────────────────────
function HeadLightIcon({ on, size = 28 }) {
  const col = on ? '#f59e0b' : 'rgba(255,255,255,0.2)'
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      {/* Rays */}
      {on && [0,45,90,135,180,225,270,315].map(deg => {
        const r = deg * Math.PI / 180
        const x1 = 14 + Math.cos(r) * 10, y1 = 14 + Math.sin(r) * 10
        const x2 = 14 + Math.cos(r) * 13, y2 = 14 + Math.sin(r) * 13
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      })}
      {/* Bulb body */}
      <circle cx="14" cy="14" r="6" fill={on ? col : 'none'} opacity={on ? 0.2 : 1} />
      <circle cx="14" cy="14" r="6" stroke={col} strokeWidth="1.5" />
      {/* Filament */}
      <circle cx="14" cy="14" r="2.5" fill={col} opacity={on ? 1 : 0.3} />
      {/* Base */}
      <rect x="11.5" y="19.5" width="5" height="2" rx="0.5" fill={col} opacity={on ? 0.8 : 0.2} />
      <rect x="12.5" y="21" width="3" height="1.5" rx="0.5" fill={col} opacity={on ? 0.6 : 0.15} />
    </svg>
  )
}
// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ label, accent }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-0.5 h-4 flex-shrink-0" style={{ background: accent || '#C8000A' }} />
      <p className="font-mono text-[8px] tracking-[0.35em] uppercase" style={{ color: accent || 'rgba(255,255,255,0.25)' }}>{label}</p>
    </div>
  )
}

// ─── Action Button ────────────────────────────────────────────────────────────
function ActionBtn({ label, icon, onClick, loading, variant = 'ghost', disabled, small }) {
  const variants = {
    red:    { border: 'rgba(200,0,10,0.5)',   bg: 'rgba(200,0,10,0.1)',   text: '#C8000A'  },
    amber:  { border: 'rgba(245,158,11,0.4)', bg: 'rgba(245,158,11,0.08)',text: '#f59e0b'  },
    green:  { border: 'rgba(34,197,94,0.4)',  bg: 'rgba(34,197,94,0.08)', text: '#22c55e'  },
    blue:   { border: 'rgba(56,189,248,0.4)', bg: 'rgba(56,189,248,0.08)',text: '#38bdf8'  },
    ghost:  { border: 'rgba(255,255,255,0.1)',bg: 'rgba(255,255,255,0.03)',text: 'rgba(255,255,255,0.45)' },
  }
  const col = (disabled || loading) ? variants.ghost : variants[variant]
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-between border font-mono tracking-widest uppercase transition-all ${small ? 'px-2.5 py-1.5 text-[9px]' : 'px-3 py-2 text-[10px]'} w-full`}
      style={{ borderColor: col.border, background: col.bg, color: col.text, cursor: (disabled || loading) ? 'not-allowed' : 'pointer', opacity: (disabled || loading) ? 0.45 : 1 }}>
      <span>{label}</span>
      <span className="ml-2 text-sm opacity-70">{loading ? '…' : icon}</span>
    </button>
  )
}

// ─── Data Card ────────────────────────────────────────────────────────────────
function DataCard({ label, value, accent, mono = true }) {
  return (
    <div className="bg-black/30 border border-white/6 px-3 py-2.5">
      <p className="font-mono text-[7px] tracking-[0.3em] text-white/20 uppercase mb-1">{label}</p>
      <p className={`${mono ? 'font-mono' : 'font-sans'} text-[11px] truncate`} style={{ color: accent || 'rgba(255,255,255,0.7)' }}>{value ?? '—'}</p>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className="font-mono text-[9px] tracking-widest uppercase px-3 py-2 border flex items-center gap-2"
          style={{
            background: t.ok ? 'rgba(34,197,94,0.12)' : 'rgba(200,0,10,0.12)',
            borderColor: t.ok ? 'rgba(34,197,94,0.4)' : 'rgba(200,0,10,0.4)',
            color: t.ok ? '#22c55e' : '#ef4444',
          }}>
          <span>{t.ok ? '✓' : '✕'}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Map Selector Modal ───────────────────────────────────────────────────────
function MapModal({ maps, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#0a0e16] border border-white/10 w-80 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <p className="font-mono text-[9px] tracking-[0.3em] text-white/40 uppercase">Select Map</p>
          <button onClick={onClose} className="font-mono text-[9px] text-white/25 hover:text-white/50 transition-colors">✕</button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {maps.length === 0
            ? <p className="font-mono text-[9px] text-white/20 px-4 py-6 text-center tracking-widest">No maps found</p>
            : maps.map(m => (
              <button key={m} onClick={() => onSelect(m)}
                className="w-full text-left px-4 py-3 font-mono text-[10px] tracking-wide text-white/60 hover:bg-white/5 hover:text-white/90 border-b border-white/5 transition-colors flex items-center gap-2">
                <span className="text-brand-red text-[8px]">▶</span>{m}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel, variant = 'red' }) {
  const col = variant === 'red'
    ? { border: 'rgba(200,0,10,0.5)', text: '#ef4444', btnBg: 'rgba(200,0,10,0.15)' }
    : { border: 'rgba(245,158,11,0.5)', text: '#f59e0b', btnBg: 'rgba(245,158,11,0.1)' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#0a0e16] border w-80 shadow-2xl" style={{ borderColor: col.border }}>
        <div className="px-5 py-5">
          <p className="font-mono text-[9px] tracking-[0.3em] uppercase mb-3" style={{ color: col.text }}>⚠ Confirm Action</p>
          <p className="font-mono text-[11px] text-white/60 tracking-wide leading-relaxed">{message}</p>
        </div>
        <div className="flex border-t" style={{ borderColor: col.border }}>
          <button onClick={onCancel}
            className="flex-1 py-3 font-mono text-[9px] tracking-widest uppercase text-white/30 hover:bg-white/5 transition-colors border-r border-white/8">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-3 font-mono text-[9px] tracking-widest uppercase transition-colors"
            style={{ color: col.text, background: col.btnBg }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Main SystemControl Page
// ══════════════════════════════════════════════════════════════════════════════
export default function SystemControl() {
  const { ready, wsStatus, subscribe, advertise, publish } = useRosBridge(ROSBRIDGE_URL)

  // Active indoor/outdoor environment (backend-owned, via EnvironmentContext)
  const { environment } = useEnvironment()

  // ── State ──────────────────────────────────────────────────────────────────
  const [processStatus, setProcessStatus] = useState(null)
  const [stackStatus,   setStackStatus]   = useState(null)
  const [stackService,  setStackService]  = useState('trov.service')
  const [maps,          setMaps]          = useState([])
  const [batteryPct,    setBatteryPct]    = useState(null)
  const [floodOn,       setFloodOn]       = useState(false)
  const [headLightOn,       setHeadLightOn]       = useState(false)

  const [loading,       setLoading]       = useState({})
  const [toasts,        setToasts]        = useState([])
  const [showMapModal,  setShowMapModal]  = useState(false)
  const [confirm,       setConfirm]       = useState(null)   // { message, action, variant }

  const pollRef = useRef(null)

  // ── Toast helper ───────────────────────────────────────────────────────────
  const toast = useCallback((msg, ok = true) => {
    const id = Date.now()
    setToasts(p => [...p.slice(-4), { id, msg, ok }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])

  const setLoad = (key, val) => setLoading(p => ({ ...p, [key]: val }))

  // ── ROS setup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    advertise(TOPIC.FLOOD_LIGHT, 'std_msgs/msg/Bool')
     advertise(TOPIC.HEADLIGHT, 'std_msgs/msg/Bool')
    const unsub = subscribe(TOPIC.BATTERY, 'std_msgs/msg/Float32', (msg) => {
      if (msg?.data != null) setBatteryPct(msg.data)
    })
    return () => unsub?.()
  }, [ready, subscribe, advertise])

 

  // ── Poll status every 5s ───────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const [s, ss] = await Promise.all([
        apiFetch('/api/status'),
        apiFetch('/api/stack/status'),
      ])
      if (s.ok)  setProcessStatus(s.data.status)
      if (ss.ok) {
        setStackStatus(ss.data.trov_service)
        setStackService(ss.data.service || 'trov.service')
      }
    } catch {}
  }, [])

  const fetchMaps = useCallback(async () => {
    setLoad('maps', true)
    try {
      const res = await apiFetch('/api/maps')
      if (res.ok) setMaps(res.data.maps || [])
      else toast(res.data.error || 'Failed to load maps', false)
    } catch { toast('Maps fetch failed', false) }
    setLoad('maps', false)
  }, [toast])

  useEffect(() => {
    fetchStatus()
    fetchMaps()
    pollRef.current = setInterval(fetchStatus, 5000)
    return () => clearInterval(pollRef.current)
  }, [fetchStatus, fetchMaps])

  // Re-fetch maps + status whenever the environment changes
  useEffect(() => {
    fetchStatus()
    fetchMaps()
  }, [environment, fetchStatus, fetchMaps])

  // ── Flood light toggle ─────────────────────────────────────────────────────
  const toggleFlood = useCallback(() => {
    const next = !floodOn
    const sent = publish(TOPIC.FLOOD_LIGHT, 'std_msgs/msg/Bool', { data: next })
    if (sent) {
      setFloodOn(next)
      toast(`Flood light ${next ? 'ON' : 'OFF'}`, true)
    } else {
      toast('ROS not connected', false)
    }
  }, [floodOn, publish, toast])


   const toggleHeadLight = useCallback(() => {
    const next = !headLightOn
    const sent = publish(TOPIC.HEADLIGHT, 'std_msgs/msg/Bool', { data: next })
    if (sent) {
      setHeadLightOn(next)
      toast(`HeadLight light ${next ? 'ON' : 'OFF'}`, true)
    } else {
      toast('ROS not connected', false)
    }
  }, [headLightOn, publish, toast])

  // ── Stack actions ──────────────────────────────────────────────────────────
  const apiAction = useCallback(async (key, path, method = 'POST', body = null, successMsg) => {
    setLoad(key, true)
    try {
      const opts = { method }
      if (body) opts.body = JSON.stringify(body)
      const res = await apiFetch(path, opts)
      if (res.ok) toast(successMsg || res.data.message || 'Done', true)
      else        toast(res.data.error || `Failed: ${path}`, false)
      await fetchStatus()
    } catch (e) { toast(String(e), false) }
    setLoad(key, false)
  }, [toast, fetchStatus])

  const confirmAction = (message, action, variant = 'red') => setConfirm({ message, action, variant })

  // ── Localization with map selection ───────────────────────────────────────
  const handleLocalizationRestart = async (mapName) => {
    setShowMapModal(false)
    await apiAction('localization', '/api/localization/restart', 'POST',
      { map_name: mapName }, `Localization restarting with map: ${mapName}`)
  }

  // ── Process status display ────────────────────────────────────────────────
  const statusColor = (s) =>
    s === 'running' ? '#22c55e' : s === 'dead' ? '#ef4444' : '#94a3b8'

  const wsCol = wsStatus === 'CONNECTED' ? '#22c55e' : wsStatus === 'CONNECTING' ? '#f59e0b' : '#ef4444'

  const batteryColor = batteryPct == null ? 'rgba(255,255,255,0.3)'
    : batteryPct > 60 ? '#22c55e'
    : batteryPct > 25 ? '#f59e0b'
    : '#ef4444'

  const stackCol = stackStatus === 'active' ? '#22c55e'
    : stackStatus === 'inactive' ? '#94a3b8'
    : '#ef4444'

  const envCol = environment === 'outdoor' ? '#22c55e' : '#38bdf8'

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden font-mono">

      {/* ── Toast ── */}
      <Toast toasts={toasts} />

      {/* ── Modals ── */}
      {showMapModal && (
        <MapModal maps={maps} onSelect={handleLocalizationRestart} onClose={() => setShowMapModal(false)} />
      )}
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          variant={confirm.variant}
          onConfirm={() => { confirm.action(); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">System Control</h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">TROV · Robot Operations · Services</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Environment badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor: `${envCol}44`, background: `${envCol}0d`, color: envCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: envCol }} />
            {environment}
          </div>
          {/* Stack status badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor: `${stackCol}44`, background: `${stackCol}0d`, color: stackCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: stackCol }} />
            {stackService} · {stackStatus ?? '…'}
          </div>
          {/* ROS badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 border font-mono text-[9px] tracking-widest uppercase rounded-sm"
            style={{ borderColor: `${wsCol}44`, background: `${wsCol}0d`, color: wsCol }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: wsCol }} />
            ros · {wsStatus}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-5">
        <div className="grid grid-cols-12 gap-4 max-w-6xl mx-auto">

          {/* ══ LEFT COLUMN ══════════════════════════════════════════════════ */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">

            {/* ─ Battery ─ */}
            <div className="bg-brand-card border border-brand-border p-4">
              <SectionHeader label="Battery · /trov/battery/percent" accent="#22c55e" />
              <div className="flex items-center gap-4 mb-4">
                <div className="flex-shrink-0">
                  <BatteryIcon percent={batteryPct} />
                </div>
                <div>
                  <p className="font-mono text-3xl font-bold leading-none" style={{ color: batteryColor }}>
                    {batteryPct != null ? `${batteryPct.toFixed(1)}%` : '—'}
                  </p>
                  <p className="font-mono text-[8px] text-white/20 tracking-widest uppercase mt-1">
                    {batteryPct == null ? 'waiting for data…'
                      : batteryPct > 60 ? 'good — nominal'
                      : batteryPct > 25 ? 'moderate — consider charging'
                      : 'critical — charge immediately'}
                  </p>
                </div>
              </div>
              {/* Battery bar */}
              <div className="h-2 bg-white/5 border border-white/5 overflow-hidden">
                <div className="h-full transition-all duration-1000"
                  style={{
                    width: `${batteryPct ?? 0}%`,
                    background: batteryColor,
                    boxShadow: `0 0 8px ${batteryColor}66`,
                  }} />
              </div>
              <div className="flex justify-between mt-1">
                {[0, 25, 50, 75, 100].map(v => (
                  <span key={v} className="font-mono text-[7px] text-white/15">{v}%</span>
                ))}
              </div>
            </div>

            {/* ─ Flood Light ─ */}
            <div className="bg-brand-card border border-brand-border p-4">
              <SectionHeader label="Flood Light · /gpio_pin32_control" accent="#f59e0b" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {floodOn && (
                      <div className="absolute inset-0 rounded-full animate-ping"
                        style={{ background: 'rgba(245,158,11,0.3)', animationDuration: '2s' }} />
                    )}
                    <FloodLightIcon on={floodOn} size={36} />
                  </div>
                  <div>
                    <p className="font-mono text-[11px] font-bold" style={{ color: floodOn ? '#f59e0b' : 'rgba(255,255,255,0.3)' }}>
                      {floodOn ? 'ACTIVE' : 'OFF'}
                    </p>
                    <p className="font-mono text-[8px] text-white/20 tracking-widest uppercase">std_msgs/Bool</p>
                  </div>
                </div>
                {/* Toggle switch */}
                <button onClick={toggleFlood} disabled={!ready}
                  className="relative w-14 h-7 border transition-all duration-300 rounded-sm"
                  style={{
                    borderColor: floodOn ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.15)',
                    background: floodOn ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)',
                    cursor: ready ? 'pointer' : 'not-allowed',
                    opacity: ready ? 1 : 0.4,
                  }}>
                  <div className="absolute top-1 w-5 h-5 border transition-all duration-300"
                    style={{
                      left: floodOn ? 'calc(100% - 22px)' : '4px',
                      borderColor: floodOn ? '#f59e0b' : 'rgba(255,255,255,0.25)',
                      background: floodOn ? '#f59e0b' : 'transparent',
                      boxShadow: floodOn ? '0 0 8px rgba(245,158,11,0.6)' : 'none',
                    }} />
                </button>
              </div>
              <div className="mt-3 h-px bg-white/5" />
              <p className="font-mono text-[8px] text-white/15 tracking-wide mt-2 leading-relaxed">
                Publishes <span className="text-white/30">data: {floodOn ? 'true' : 'false'}</span> to /gpio_pin32_control on toggle
              </p>
            </div>



             <div className="bg-brand-card border border-brand-border p-4">
              <SectionHeader label="HeadLight · /trov/headlight" accent="#f59e0b" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {headLightOn && (
                      <div className="absolute inset-0 rounded-full animate-ping"
                        style={{ background: 'rgba(245,158,11,0.3)', animationDuration: '2s' }} />
                    )}
                    <HeadLightIcon on={headLightOn} size={36} />
                  </div>
                  <div>
                    <p className="font-mono text-[11px] font-bold" style={{ color: headLightOn ? '#f59e0b' : 'rgba(255,255,255,0.3)' }}>
                      {headLightOn ? 'ACTIVE' : 'OFF'}
                    </p>
                    <p className="font-mono text-[8px] text-white/20 tracking-widest uppercase">std_msgs/Bool</p>
                  </div>
                </div>
                {/* Toggle switch */}
                <button onClick={toggleHeadLight} disabled={!ready}
                  className="relative w-14 h-7 border transition-all duration-300 rounded-sm"
                  style={{
                    borderColor: headLightOn ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.15)',
                    background: headLightOn ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)',
                    cursor: ready ? 'pointer' : 'not-allowed',
                    opacity: ready ? 1 : 0.4,
                  }}>
                  <div className="absolute top-1 w-5 h-5 border transition-all duration-300"
                    style={{
                      left:headLightOn? 'calc(100% - 22px)' : '4px',
                      borderColor:headLightOn ? '#f59e0b' : 'rgba(255,255,255,0.25)',
                      background: headLightOn? '#f59e0b' : 'transparent',
                      boxShadow: headLightOn? '0 0 8px rgba(245,158,11,0.6)' : 'none',
                    }} />
                </button>
              </div>
              <div className="mt-3 h-px bg-white/5" />
              <p className="font-mono text-[8px] text-white/15 tracking-wide mt-2 leading-relaxed">
                Publishes <span className="text-white/30">data: {headLightOn ? 'true' : 'false'}</span> 
              </p>
            </div>

            {/* ─ ROS Status ─ */}
            <div className="bg-brand-card border border-brand-border p-4">
              <SectionHeader label="Process Status · /api/status" />
              {processStatus ? (
                <div className="flex flex-col gap-1.5">
                  {Object.entries(processStatus).map(([name, state]) => (
                    <div key={name} className="flex items-center justify-between px-2.5 py-1.5 border border-white/5 bg-black/20">
                      <span className="font-mono text-[9px] text-white/50 tracking-wide uppercase">{name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor(state) }} />
                        <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: statusColor(state) }}>{state}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {['localization','navigation','odometry','rosbridge','mediamtx'].map(k => (
                    <div key={k} className="flex items-center justify-between px-2.5 py-1.5 border border-white/5 bg-black/20">
                      <span className="font-mono text-[9px] text-white/25 tracking-wide uppercase">{k}</span>
                      <span className="font-mono text-[9px] text-white/15 tracking-widest">…</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={fetchStatus}
                className="mt-3 w-full py-1.5 border border-white/8 font-mono text-[8px] tracking-widest uppercase text-white/25 hover:text-white/45 hover:bg-white/4 transition-colors">
                ↻ Refresh
              </button>
            </div>

          </div>

          {/* ══ RIGHT COLUMN ═════════════════════════════════════════════════ */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-4">

            {/* ─ Stack Controls ─ */}
            <div className="bg-brand-card border border-brand-border p-4">
              <SectionHeader label={`Stack Control · ${stackService}`} accent="#C8000A" />
              <div className="grid grid-cols-3 gap-2">
                <ActionBtn
                  label="Start Stack"
                  icon="▶"
                  variant="green"
                  loading={loading.start}
                  onClick={() => apiAction('start', '/api/stack/start', 'POST', null, `${stackService} started`)}
                />
                <ActionBtn
                  label="Stop Stack"
                  icon="■"
                  variant="red"
                  loading={loading.stop}
                  onClick={() => confirmAction(
                    `Stop ${stackService}? This will halt all ROS nodes including navigation and localization.`,
                    () => apiAction('stop', '/api/stack/stop', 'POST', null, `${stackService} stopped`),
                    'red'
                  )}
                />
                <ActionBtn
                  label="Restart Stack"
                  icon="↺"
                  variant="amber"
                  loading={loading.restart}
                  onClick={() => confirmAction(
                    `Restart ${stackService}? Robot will be briefly unresponsive during restart.`,
                    () => apiAction('restart', '/api/stack/restart', 'POST', null, `${stackService} restarted`),
                    'amber'
                  )}
                />
              </div>
            </div>

            {/* ─ Sub-System Restarts ─ */}
            <div className="bg-brand-card border border-brand-border p-4">
              <SectionHeader label="Sub-System Restart · Individual Nodes" />
              <div className="grid grid-cols-1 gap-2">

                {/* Localization */}
                <div className="flex gap-2 items-stretch">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 px-3 py-2 border border-white/6 bg-black/20">
                      <div className="w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: processStatus?.localization ? statusColor(processStatus.localization) : '#94a3b8' }} />
                      <span className="font-mono text-[9px] text-white/40 tracking-wide flex-1">localization · map_server</span>
                      <span className="font-mono text-[8px] tracking-widest uppercase"
                        style={{ color: processStatus?.localization ? statusColor(processStatus.localization) : '#94a3b8' }}>
                        {processStatus?.localization ?? '…'}
                      </span>
                    </div>
                  </div>
                  <ActionBtn
                    label="Restart"
                    icon="↺"
                    variant="blue"
                    small
                    loading={loading.localization}
                    onClick={() => { fetchMaps(); setShowMapModal(true) }}
                  />
                </div>

                {/* Navigation */}
                <div className="flex gap-2 items-stretch">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 px-3 py-2 border border-white/6 bg-black/20">
                      <div className="w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: processStatus?.navigation ? statusColor(processStatus.navigation) : '#94a3b8' }} />
                      <span className="font-mono text-[9px] text-white/40 tracking-wide flex-1">navigation · bt_navigator</span>
                      <span className="font-mono text-[8px] tracking-widest uppercase"
                        style={{ color: processStatus?.navigation ? statusColor(processStatus.navigation) : '#94a3b8' }}>
                        {processStatus?.navigation ?? '…'}
                      </span>
                    </div>
                  </div>
                  <ActionBtn
                    label="Restart"
                    icon="↺"
                    variant="blue"
                    small
                    loading={loading.navigation}
                    onClick={() => confirmAction(
                      'Restart navigation? bt_navigator will be killed and restarted.',
                      () => apiAction('navigation', '/api/navigation/restart', 'POST', null, 'Navigation restarting'),
                      'amber'
                    )}
                  />
                </div>

                {/* Odometry */}
                <div className="flex gap-2 items-stretch">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 px-3 py-2 border border-white/6 bg-black/20">
                      <div className="w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: processStatus?.odometry ? statusColor(processStatus.odometry) : '#94a3b8' }} />
                      <span className="font-mono text-[9px] text-white/40 tracking-wide flex-1">odometry · icp_odometry</span>
                      <span className="font-mono text-[8px] tracking-widest uppercase"
                        style={{ color: processStatus?.odometry ? statusColor(processStatus.odometry) : '#94a3b8' }}>
                        {processStatus?.odometry ?? '…'}
                      </span>
                    </div>
                  </div>
                  <ActionBtn
                    label="Restart"
                    icon="↺"
                    variant="blue"
                    small
                    loading={loading.odometry}
                    onClick={() => confirmAction(
                      'Restart odometry? icp_odometry will be killed and restarted.',
                      () => apiAction('odometry', '/api/odometry/restart', 'POST', null, 'Odometry restarting'),
                      'amber'
                    )}
                  />
                </div>

                {/* Rosbridge */}
                <div className="flex gap-2 items-stretch">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 px-3 py-2 border border-white/6 bg-black/20">
                      <div className="w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: processStatus?.rosbridge ? statusColor(processStatus.rosbridge) : '#94a3b8' }} />
                      <span className="font-mono text-[9px] text-white/40 tracking-wide flex-1">rosbridge · rosbridge_websocket</span>
                      <span className="font-mono text-[8px] tracking-widest uppercase"
                        style={{ color: processStatus?.rosbridge ? statusColor(processStatus.rosbridge) : '#94a3b8' }}>
                        {processStatus?.rosbridge ?? '…'}
                      </span>
                    </div>
                  </div>
                  {/* no direct restart endpoint for rosbridge — use stack restart */}
                  <div className="w-24 flex items-center justify-center border border-white/5 bg-black/10 font-mono text-[8px] text-white/15 tracking-widest">
                    via stack
                  </div>
                </div>

                {/* mediamtx */}
                <div className="flex gap-2 items-stretch">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 px-3 py-2 border border-white/6 bg-black/20">
                      <div className="w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: processStatus?.mediamtx ? statusColor(processStatus.mediamtx) : '#94a3b8' }} />
                      <span className="font-mono text-[9px] text-white/40 tracking-wide flex-1">mediamtx · mediamtx</span>
                      <span className="font-mono text-[8px] tracking-widest uppercase"
                        style={{ color: processStatus?.mediamtx ? statusColor(processStatus.mediamtx) : '#94a3b8' }}>
                        {processStatus?.mediamtx ?? '…'}
                      </span>
                    </div>
                  </div>
                  <div className="w-24 flex items-center justify-center border border-white/5 bg-black/10 font-mono text-[8px] text-white/15 tracking-widest">
                    via stack
                  </div>
                </div>

              </div>
            </div>

            {/* ─ Available Maps ─ */}
            <div className="bg-brand-card border border-brand-border p-4">
              <div className="flex items-center justify-between mb-3">
                <SectionHeader label={`Maps · /api/maps (${maps.length})`} accent="#38bdf8" />
                <button onClick={fetchMaps}
                  className="font-mono text-[8px] tracking-widest uppercase text-white/20 hover:text-white/45 transition-colors -mt-3">
                  {loading.maps ? '…' : '↻ Refresh'}
                </button>
              </div>
              {maps.length === 0 ? (
                <p className="font-mono text-[9px] text-white/15 tracking-widest uppercase text-center py-4">No maps found</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {maps.map((m, i) => (
                    <button key={m}
                      onClick={() => confirmAction(
                        `Restart localization with map: "${m}"?`,
                        () => handleLocalizationRestart(m),
                        'amber'
                      )}
                      className="flex items-center gap-2 px-3 py-2.5 border border-white/8 bg-black/20 hover:bg-white/5 hover:border-blue-400/30 transition-all text-left group">
                      <span className="font-mono text-[7px] text-white/15 flex-shrink-0"
                        style={{ color: processStatus?.localization === 'running' ? '#38bdf855' : 'rgba(255,255,255,0.1)' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-mono text-[9px] text-white/50 group-hover:text-white/80 tracking-wide truncate transition-colors">{m}</span>
                      <span className="ml-auto font-mono text-[7px] text-white/15 group-hover:text-blue-400/50 transition-colors flex-shrink-0">↺</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="font-mono text-[8px] text-white/15 tracking-wide mt-3">
                Click a map to restart localization with that map · requires localization process to be running
              </p>
            </div>

            {/* ─ API Endpoints reference ─ */}
            <div className="bg-brand-card border border-brand-border p-4">
              <SectionHeader label="Endpoint Reference" />
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {[
                  ['GET',  '/api/environment'],
                  ['POST', '/api/environment/switch'],
                  ['GET',  '/api/maps'],
                  ['GET',  '/api/status'],
                  ['GET',  '/api/stack/status'],
                  ['POST', '/api/stack/start'],
                  ['POST', '/api/stack/stop'],
                  ['POST', '/api/stack/restart'],
                  ['POST', '/api/localization/restart'],
                  ['POST', '/api/navigation/restart'],
                  ['POST', '/api/odometry/restart'],
                  ['GET',  '/api/health'],
                ].map(([method, path]) => (
                  <div key={path} className="flex items-center gap-2 py-1 border-b border-white/4">
                    <span className="font-mono text-[8px] tracking-widest flex-shrink-0"
                      style={{ color: method === 'GET' ? '#38bdf8' : '#f59e0b', opacity: 0.7 }}>
                      {method}
                    </span>
                    <span className="font-mono text-[8px] text-white/25 tracking-wide truncate">{path}</span>
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
