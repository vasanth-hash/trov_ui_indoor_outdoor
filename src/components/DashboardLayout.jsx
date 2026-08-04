import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEnvironment } from '../context/EnvironmentContext'

const ROSBRIDGE_URL = 'wss://trovcamera.edgeforce.in/ros/'

// ── Shared ARM context so NavigationPage can sync arm state ──────────────────
export const ArmContext = createContext({
  armed: false,
  setArmed: () => {},
  cmdVelTopic: '/cmd_vel_safe',
  setCmdVelTopic: () => {},
})
export const useArm = () => useContext(ArmContext)

const NAV_ITEMS = [
  { path: '/navigation',        icon: NavIcon,    label: 'Home',        sub: 'Route Control',    iconKey: 'nav'  },
   { path: '/indoor',            icon: IndoorIcon, label: 'Indoor',            sub: 'Indoor Nav',       iconKey: 'ind'  },
  { path: '/webrtc-cameras',    icon: CamIcon,    label: 'Sights',    sub: 'Live Feed',        iconKey: 'cam'  },
  { path: '/waypoint-recorder', icon: RecIcon,    label: 'Waypoint Recorder', sub: 'Mission Plan',     iconKey: 'rec'  },
  // { path: '/waypoint-follower', icon: FollowIcon, label: 'Waypoint Follower', sub: 'Autonomous',       iconKey: 'fol'  },
  // { path: '/systemcontrol',     icon: SysIcon,    label: 'System Control',    sub: 'Controls',         iconKey: 'sys'  },
  { path: '/mapping',           icon: MapIcon,    label: 'Mapping',           sub: 'Maps',             iconKey: 'map'  },
  // { path: '/delivery',            icon: IndoorIcon, label: 'Delivery',            sub: 'Delivery',       iconKey: 'ind'  },
  { path: '/mission',            icon: SysIcon, label: 'Mission Commands',            sub: 'Delivery',       iconKey: 'ind'  },
]

// ── SVG Nav Icons ─────────────────────────────────────────────────────────────
function NavIcon({ active }) {
  const c = active ? '#ff2323' : 'rgba(255,255,255,0.45)'
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5L14 13H2L8 1.5Z" stroke={c} strokeWidth="1.2" fill="none"/>
    <circle cx="8" cy="8.5" r="1.5" fill={c}/>
  </svg>
}
function CamIcon({ active }) {
  const c = active ? '#ff2323' : 'rgba(255,255,255,0.45)'
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="4" width="10" height="8" rx="1.5" stroke={c} strokeWidth="1.2"/>
    <path d="M11 7L15 5V11L11 9" stroke={c} strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
}
function RecIcon({ active }) {
  const c = active ? '#ff2323' : 'rgba(255,255,255,0.45)'
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="5.5" stroke={c} strokeWidth="1.2"/>
    <circle cx="8" cy="8" r="2.5" fill={c}/>
  </svg>
}
function FollowIcon({ active }) {
  const c = active ? '#ff2323' : 'rgba(255,255,255,0.45)'
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 8h9M8 5l3 3-3 3" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="13" cy="8" r="1.5" fill={c}/>
  </svg>
}
function SysIcon({ active }) {
  const c = active ? '#ff2323' : 'rgba(255,255,255,0.45)'
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2" stroke={c} strokeWidth="1.2"/>
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke={c} strokeWidth="1.1" strokeLinecap="round"/>
  </svg>
}
function MapIcon({ active }) {
  const c = active ? '#ff2323' : 'rgba(255,255,255,0.45)'
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M1 3l5 2 4-2 5 2v8l-5-2-4 2-5-2V3Z" stroke={c} strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M6 5v8M10 3v8" stroke={c} strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
  </svg>
}
function IndoorIcon({ active }) {
  const c = active ? '#ff2323' : 'rgba(255,255,255,0.45)'
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 8L8 2l6 6" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 8v5h3v-3h2v3h3V8" stroke={c} strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
}

// ── Minimal rosbridge hook ─────────────────────────────────────────────────────
function useRosBridge(url) {
  const wsRef        = useRef(null)
  const subMap       = useRef({})
  const advMap       = useRef({})
  const reconnectRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [wsStatus, setWsStatus] = useState('CONNECTING')

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return
    const ws = new WebSocket(url)
    wsRef.current = ws
    setWsStatus('CONNECTING')
    ws.onopen = () => {
      setReady(true)
      setWsStatus('CONNECTED')
      Object.entries(subMap.current).forEach(([id, { topic, type, opts = {} }]) =>
        ws.send(JSON.stringify({ op: 'subscribe', id, topic, type, ...opts })))
      Object.entries(advMap.current).forEach(([topic, type]) =>
        ws.send(JSON.stringify({ op: 'advertise', topic, type })))
    }
    ws.onclose = () => {
      setReady(false)
      setWsStatus('DISCONNECTED')
      reconnectRef.current = setTimeout(connect, 2000)
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
    const id = `sub_${topic.replace(/\//g, '_')}_${Date.now()}_${Math.random().toString(36).slice(2)}`
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
    if (!advMap.current[topic]) {
      ws.send(JSON.stringify({ op: 'advertise', topic, type }))
      advMap.current[topic] = type
    }
    ws.send(JSON.stringify({ op: 'publish', topic, type, msg }))
    return true
  }, [])

  const callService = useCallback((service, type, args) => {
    return new Promise((resolve) => {
      const ws = wsRef.current
      if (ws?.readyState !== WebSocket.OPEN) return resolve({ timeout: true })
      const id = `svc_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const timeout = setTimeout(() => resolve({ timeout: true }), 5000)
      const handler = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.op === 'service_response' && msg.id === id) {
            clearTimeout(timeout)
            ws.removeEventListener('message', handler)
            resolve(msg)
          }
        } catch {}
      }
      ws.addEventListener('message', handler)
      ws.send(JSON.stringify({ op: 'call_service', id, service, type, args }))
    })
  }, [])

  return { ready, wsStatus, subscribe, advertise, publish, callService }
}

// ── Vertical Battery Indicator ─────────────────────────────────────────────────
function BatteryBar({ percent }) {
  const pct      = Math.max(0, Math.min(100, percent ?? 0))
  const color    = pct > 60 ? '#22c55e' : pct > 30 ? '#f59e0b' : '#ef4444'
  const glowColor = pct > 60 ? 'rgba(34,197,94,0.3)' : pct > 30 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'
  const segments  = 4

  return (
    <div className="flex items-center gap-2 select-none">
      {/* Vertical battery shell */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {/* Nub on top */}
        <div style={{
          width: 8, height: 3,
          background: color,
          borderRadius: '2px 2px 0 0',
          opacity: 0.7,
        }} />
        {/* Body */}
        <div style={{
          width: 16, height: 25,
          border: `1.5px solid ${color}`,
          borderRadius: 3,
          padding: '2px',
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 2,
          boxShadow: pct < 30 ? `0 0 8px ${glowColor}` : 'none',
        }}>
          {Array.from({ length: segments }).map((_, i) => {
            const threshold = (i + 1) * (100 / segments)
            const filled = pct >= threshold - (100 / segments / 2)
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  borderRadius: 1.5,
                  background: filled ? color : 'rgba(255,255,255,0.07)',
                  transition: 'background 0.4s ease',
                  boxShadow: filled && pct > 60 ? `0 0 4px ${glowColor}` : 'none',
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Light Toggle Button (reusable for Flood & Headlight) ──────────────────────
function LightToggle({ on, onToggle, disabled, label, color = '#f59e0b' }) {
  const glowRgba = color === '#f59e0b' ? 'rgba(245,158,11,0.25)' : 'rgba(147,197,253,0.25)'
  const borderActive = color === '#f59e0b' ? 'rgba(245,158,11,0.6)' : 'rgba(147,197,253,0.6)'
  const bgActive = color === '#f59e0b' ? 'rgba(245,158,11,0.12)' : 'rgba(147,197,253,0.1)'
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={`${label} ${on ? 'ON — click to turn off' : 'OFF — click to turn on'}`}
      className="relative flex items-center gap-2 px-3 py-1.5 transition-all duration-200"
      style={{
        border: `1.5px solid ${on ? borderActive : 'rgba(255,255,255,0.50)'}`,
        background: on ? bgActive : 'rgba(255,255,255,0.03)',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: on ? `0 0 12px ${glowRgba}` : 'none',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        padding: '4px 8px',
      }}
    >

      <div style={{
       fontFamily: "'Teko', sans-serif",
        fontSize: 7,
        letterSpacing: '0.12em',
        color: on ? color : 'rgba(255,255,255,0.50)',
        textTransform: 'uppercase',
        fontWeight: 600,
        lineHeight: 1,
      }}>
        {label}
      </div>
      <div style={{
        width: 20, height: 10,
        borderRadius: 4,
        background: on ? (color === '#f59e0b' ? 'rgba(245,158,11,0.2)' : 'rgba(147,197,253,0.15)') : 'rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          {on && [0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
            const r = deg * Math.PI / 180
            const x1 = 8 + Math.cos(r) * 5.5, y1 = 8 + Math.sin(r) * 5.5
            const x2 = 8 + Math.cos(r) * 7.5, y2 = 8 + Math.sin(r) * 7.5
            return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
          })}
          <circle cx="8" cy="8" r="3" fill={on ? color : 'rgba(255,255,255,0.25)'} opacity={on ? 0.3 : 1} />
          <circle cx="8" cy="8" r="3" stroke={on ? color : 'rgba(255,255,255,0.35)'} strokeWidth="1.3" />
          <circle cx="8" cy="8" r="1.2" fill={on ? color : 'rgba(255,255,255,0.2)'} />
        </svg>
      </div>
      
    </button>
  )
}

// ── Indoor / Outdoor environment selector ─────────────────────────────────────
function EnvToggle({ environment, switching, onRequestSwitch }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center',
      border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 6, overflow: 'hidden',
      opacity: switching ? 0.6 : 1 }}>
      {['indoor', 'outdoor'].map(opt => {
        const active = environment === opt
        const accent = opt === 'outdoor' ? '#22c55e' : '#38bdf8'
        return (
          <button key={opt}
            onClick={() => !active && !switching && onRequestSwitch(opt)}
            disabled={switching || active}
            title={active ? `Currently ${opt}` : `Switch to ${opt} (stops current stack)`}
            style={{
              fontFamily: "'Teko', sans-serif", fontSize: 10, letterSpacing: '0.12em',
              textTransform: 'uppercase', fontWeight: 600, padding: '6px 12px', border: 'none',
              cursor: switching ? 'wait' : active ? 'default' : 'pointer',
              background: active ? `${accent}26` : 'transparent',
              color: active ? accent : 'rgba(255,255,255,0.4)', transition: 'all 0.2s',
            }}>
            {switching && !active ? '…' : opt}
          </button>
        )
      })}
    </div>
  )
}

// ── Armed/Disarm Button (calls /mavros/cmd/arming service) ───────────────────
function ArmedBadge({ armed, onToggle, busy }) {
  return (
    <button
      onClick={onToggle}
      disabled={busy}
      title={armed ? 'Click to DISARM' : 'Click to ARM'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        border: `1.5px solid ${armed ? 'rgba(255,35,35,0.5)' : 'rgba(255,255,255,0.50)'}`,
        borderRadius: 6,
        background: armed ? 'rgba(255,35,35,0.1)' : 'rgba(255,255,255,0.03)',
        boxShadow: armed ? '0 0 16px rgba(255,35,35,0.2)' : 'none',
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.55 : 1,
        transition: 'all 0.3s ease',
        userSelect: 'none',
      }}
    >
      <span style={{
        width: 7, height: 7,
        borderRadius: '50%',
        flexShrink: 0,
        background: busy ? '#f59e0b' : armed ? '#ff2323' : 'rgba(255,255,255,0.50)',
        boxShadow: busy ? '0 0 8px #f59e0b' : armed ? '0 0 8px #ff2323' : 'none',
        animation: armed && !busy ? 'armPulse 1.5s ease-in-out infinite' : busy ? 'armPulse 0.6s ease-in-out infinite' : 'none',
      }} />
      <span style={{
        fontFamily: "'Teko', sans-serif",
        fontSize: 9,
        letterSpacing: '0.18em',
        color: busy ? '#f59e0b' : armed ? '#ff5757' : 'rgba(255,255,255,0.50)',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}>
        {busy ? 'WAIT…' : armed ? 'ARMED' : 'DISARMED'}
      </span>
    </button>
  )
}

// ── WS Status Pill ─────────────────────────────────────────────────────────────
function WsStatusPill({ status }) {
  const map = {
    CONNECTED:    { color: '#22c55e', dot: '#22c55e' },
    CONNECTING:   { color: '#f59e0b', dot: '#f59e0b' },
    DISCONNECTED: { color: 'rgba(255,255,255,0.2)', dot: 'rgba(255,255,255,0.15)' },
    ERROR:        { color: '#ef4444', dot: '#ef4444' },
  }
  const { color, dot } = map[status] || map.DISCONNECTED
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, boxShadow: status === 'CONNECTED' ? `0 0 6px ${dot}` : 'none' }} />
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 8, letterSpacing: '0.15em', color, textTransform: 'uppercase' }}>
        
      </span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
export default function DashboardLayout() {
  // const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // ARM state (shared via context with child pages)
  const [armed, setArmed] = useState(false)
  const [armBusy, setArmBusy] = useState(false)
  // cmdVelTopic: NavigationPage sets this so header can display it
  const [cmdVelTopic, setCmdVelTopic] = useState('/cmd_vel_safe')

  // Indoor / outdoor environment (backend-owned, via EnvironmentContext)
  const { environment, switching, switchEnvironment } = useEnvironment()
  const [pendingEnv, setPendingEnv] = useState(null)

  const confirmSwitch = async () => {
    const target = pendingEnv
    setPendingEnv(null)
    const res = await switchEnvironment(target)
    if (!res.ok) console.error('Environment switch failed:', res.error)
  }

  const { ready, wsStatus, subscribe, advertise, publish, callService } = useRosBridge(ROSBRIDGE_URL)
  const [batteryPct, setBatteryPct]   = useState(null)
  const [floodOn,    setFloodOn]      = useState(false)
  const [headLightOn, setHeadLightOn] = useState(false)

  useEffect(() => {
    if (!ready) return
    advertise('/gpio_pin32_control', 'std_msgs/msg/Bool')
    advertise('/trov/headlight',     'std_msgs/msg/Bool')
    const unsub = subscribe('/trov/battery/percent', 'std_msgs/msg/Float32', (msg) => {
      if (msg?.data != null) setBatteryPct(msg.data)
    })
    // Sync arm state from mavros
    const unsubArm = subscribe('/mavros/state', 'mavros_msgs/State', (msg) => {
      if (msg?.armed != null) setArmed(msg.armed)
    })
    return () => { unsub?.(); unsubArm?.() }
  }, [ready, subscribe, advertise])

  const toggleFlood = useCallback(() => {
    const next = !floodOn
    publish('/gpio_pin32_control', 'std_msgs/msg/Bool', { data: next })
    setFloodOn(next)
  }, [floodOn, publish])

  const toggleHeadLight = useCallback(() => {
    const next = !headLightOn
    publish('/trov/headlight', 'std_msgs/msg/Bool', { data: next })
    setHeadLightOn(next)
  }, [headLightOn, publish])

  // ── ARM / DISARM via rosbridge service call ──────────────────────────────────
  const sendArm = useCallback(async (value) => {
    setArmBusy(true)
    try {
      const res = await callService('/mavros/cmd/arming', 'mavros_msgs/CommandBool', { value })
      if (res.timeout) {
        console.warn('Arm service timed out')
      } else if (res.values?.success === false || res.result === false) {
        console.warn(`${value ? 'ARM' : 'DISARM'} rejected by FCU`)
      } else {
        setArmed(value)
      }
    } catch (e) {
      console.error('Arm service error:', e.message)
    }
    setArmBusy(false)
  }, [callService])

  const handleArmToggle = useCallback(() => {
    sendArm(!armed)
  }, [armed, sendArm])

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <ArmContext.Provider value={{ armed, setArmed, cmdVelTopic, setCmdVelTopic }}>
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#0a0a0a', fontFamily: "'Courier New', monospace" }}>

        {/* ── Environment switch confirm modal ── */}
        {pendingEnv && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#0a0e16', border: '1.5px solid rgba(245,158,11,0.5)',
              width: 320, fontFamily: "'Courier New', monospace" }}>
              <div style={{ padding: '20px' }}>
                <p style={{ color: '#f59e0b', fontSize: 9, letterSpacing: '0.3em',
                  textTransform: 'uppercase', marginBottom: 12 }}>⚠ Switch environment</p>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, lineHeight: 1.6 }}>
                  Switch to <b style={{ color: '#fff' }}>{pendingEnv?.toUpperCase()}</b>? This stops the
                  current stack and starts the {pendingEnv} stack. The robot will be briefly unresponsive.
                </p>
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid rgba(245,158,11,0.4)' }}>
                <button onClick={() => setPendingEnv(null)}
                  style={{ flex: 1, padding: 12, background: 'none', border: 'none',
                    borderRight: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)',
                    fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={confirmSwitch}
                  style={{ flex: 1, padding: 12, background: 'rgba(245,158,11,0.1)', border: 'none',
                    color: '#f59e0b', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase',
                    cursor: 'pointer' }}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`
          @keyframes armPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.85)} }
          @keyframes fadeSlideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
          .nav-item-active { background: linear-gradient(90deg, rgba(255,35,35,0.08) 0%, transparent 100%) !important; }
          .sidebar-link:hover .nav-label { color: rgba(255,255,255,0.9); }
          .profile-dropdown { animation: fadeSlideIn 0.15s ease; }
        `}</style>

        {/* ── HEADER ── */}
        <header style={{
          height: 52,
          flexShrink: 0,
          background: '#111111',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 16,
          paddingRight: 16,
          gap: 12,
          zIndex: 50,
          position: 'relative',
        }}>

          {/* Hamburger */}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            style={{ width: 44, height: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                display: 'block', width: 18, height: 1.5,
                background: sidebarOpen ? 'rgba(255,255,255,0.45)' : i === 1 ? 'transparent' : 'rgba(255,255,255,0.45)',
                borderRadius: 2,
                transform: !sidebarOpen && i === 0 ? 'translateY(6.5px) rotate(45deg)' : !sidebarOpen && i === 2 ? 'translateY(-6.5px) rotate(-45deg)' : 'none',
                transition: 'all 0.2s ease',
              }} />
            ))}
          </button>

          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 14, flexShrink: 0 }}>
            <div style={{
              width: 28, height: 28,
              background: 'linear-gradient(135deg, #ff2323 0%, #b10303 100%)',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 12px rgba(255,35,35,0.3)',
              flexShrink: 0,
            }}>
              <span style={{ fontFamily: "'Arial Black', sans-serif", color: '#fff', fontSize: 9, fontWeight: 900, letterSpacing: '0.05em' }}>EF</span>
            </div>
            <div>
              <p style={{ fontFamily: "'Arial Black', sans-serif", letterSpacing: '0.18em', color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>T-ROV</p>
              <p style={{ fontFamily: "'Courier New', monospace", letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', fontSize: 8, textTransform: 'uppercase', lineHeight: 1, marginTop: 3 }}>Mission Control</p>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* Right Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

            {/* WS Status */}
            <WsStatusPill status={wsStatus} />

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

            {/* Indoor / Outdoor selector — left of ARMED */}
            <EnvToggle environment={environment} switching={switching} onRequestSwitch={setPendingEnv} />

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

            {/* ARMED/DISARMED badge — clickable */}
            <ArmedBadge armed={armed} onToggle={handleArmToggle} busy={armBusy} />

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

            {/* Flood light */}
            <LightToggle on={floodOn} onToggle={toggleFlood} disabled={!ready} label="FLOOD" color="#f59e0b" />

            {/* Headlight */}
            <LightToggle on={headLightOn} onToggle={toggleHeadLight} disabled={!ready} label="HEAD" color="#93c5fd" />

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

            {/* Battery bar */}
            <BatteryBar percent={batteryPct} />
          </div>

          {/* Profile */}
          {/* <div style={{ position: 'relative', borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 14 }}>
            <button
              onClick={() => setProfileOpen(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <div style={{
                width: 30, height: 30,
                background: 'rgba(255,35,35,0.12)',
                border: '1.5px solid rgba(255,35,35,0.3)',
                borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontFamily: "'Arial Black', sans-serif", color: '#ff5757', fontSize: 9, fontWeight: 900, textTransform: 'uppercase' }}>
                  {user?.vehicleId?.slice(0, 2) || 'OP'}
                </span>
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontFamily: "'Arial Black', sans-serif", letterSpacing: '0.08em', color: '#fff', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', margin: 0, lineHeight: 1 }}>{user?.vehicleId}</p>
                <p style={{ fontFamily: "'Courier New', monospace", letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', fontSize: 8, textTransform: 'uppercase', lineHeight: 1, marginTop: 3 }}>{user?.role}</p>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>▾</span>
            </button>

            {profileOpen && (
              <div className="profile-dropdown" style={{
                position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                width: 176,
                background: '#161616',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                overflow: 'hidden',
                zIndex: 50,
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <p style={{ fontFamily: "'Arial Black', sans-serif", color: '#fff', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{user?.vehicleId}</p>
                  <p style={{ fontFamily: "'Courier New', monospace", color: 'rgba(255,255,255,0.35)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 4 }}>{user?.role}</p>
                </div>
                <button
                  onClick={handleLogout}
                  style={{ width: '100%', textAlign: 'left', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,35,35,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  onTouchStart={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onTouchEnd={e => { if (!isActive) e.currentTarget.style.background = 'none' }}
                >
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#ff5757', textTransform: 'uppercase', letterSpacing: '0.12em' }}>⏻ Logout</span>
                </button>
              </div>
            )}
          </div>

          {profileOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setProfileOpen(false)} onTouchStart={() => setProfileOpen(false)} />} */}
        </header>

        {/* ── BODY ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* SIDEBAR */}
          <aside style={{
            flexShrink: 0,
            background: '#111111',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            width: sidebarOpen ? 216 : 0,
            transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
          }}>
            <div style={{ flex: 1, padding: '12px 0', overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
          
              <p style={{ fontFamily: "'Courier New', monospace", letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', fontSize: 8, textTransform: 'uppercase', padding: '0 20px', marginBottom: 8, whiteSpace: 'nowrap' }}>
                MODULES
              </p>

              {NAV_ITEMS.map((rawItem) => {
                // The /indoor route serves both modes — relabel it to match the environment
                const item = rawItem.path === '/indoor'
                  ? { ...rawItem,
                      label: environment === 'outdoor' ? 'Outdoor' : 'Indoor',
                      sub:   environment === 'outdoor' ? 'Outdoor Nav' : 'Indoor Nav' }
                  : rawItem
                return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className="sidebar-link"
                  style={{ textDecoration: 'none', display: 'block' }}
                >
                  {({ isActive }) => (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 20px',
                        borderRight: isActive ? '2px solid #ff2323' : '2px solid transparent',
                        background: isActive ? 'linear-gradient(90deg, rgba(255,35,35,0.09) 0%, transparent 100%)' : 'none',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none' }}
                    >
                      {isActive && (
                        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 2, height: 16, background: '#ff2323', borderRadius: 2 }} />
                      )}
                      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        <item.icon active={isActive} />
                      </span>
                      <div>
                        <p className="nav-label" style={{ fontFamily: "'Arial Black', sans-serif", fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: isActive ? '#ffffff' : 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1, transition: 'color 0.15s' }}>{item.label}</p>
                        <p style={{ fontFamily: "'Courier New', monospace", fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', marginTop: 3, lineHeight: 1 }}>{item.sub}</p>
                      </div>
                    </div>
                  )}
                </NavLink>
                )
              })}
            </div>

            {/* Sidebar footer */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '12px 20px' }}>
              <p style={{ fontFamily: "'Courier New', monospace", letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', fontSize: 8, textTransform: 'uppercase', whiteSpace: 'nowrap', margin: 0 }}>trovcamera.edgeforce.in</p>
            </div>
          </aside>

          {/* PAGE CONTENT */}
          <main style={{ flex: 1, overflow: 'hidden', background: '#0a0a0a' }}>
            <Outlet />
          </main>
        </div>
      </div>
    </ArmContext.Provider>
  )
}
