


/**
 * TeleopPanel — camera feeds + velocity config + d-pad teleop
 *
 * Props:
 *   publish      (topic, type, msg) from useRosBridge
 *   ready        boolean
 *   cmdVelTopic  string   — default '/cmd_vel'
 *   hz           number   — publish rate while held, default 10
 *   alwaysOpen   boolean  — skip outer toggle
 *   defaultOpen  boolean  — initial state when toggleable
 */

import { useEffect, useRef, useState, useCallback } from 'react'

const DEFAULT_CMD_VEL = '/cmd_vel_smoothed'
// const DEFAULT_CMD_VEL = '/mavros/rc/override'
const DEFAULT_HZ      = 10
const DEFAULT_LINEAR  = 0.3
const DEFAULT_ANGULAR = 0.5

const VPS_HOST    = 'trovcamera.edgeforce.in'
const WEBRTC_PORT = 'webrtc'
const CAMERAS = [
  { id: 'driving',      label: 'Driving Camera',     stream: 'driving_camera'      },
  { id: 'surveillance', label: 'Surveillance Camera', stream: 'surveillance_camera' },
]

// ─── Typography tokens ────────────────────────────────────────────────────────
const T = {
  sectionLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
  },
  fieldLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    marginBottom: 4,
  },
  readout: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: '0.1em',
  },
  hint: {
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.2)',
    margin: 0,
  },
  error: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#C8000A',
    letterSpacing: '0.1em',
    margin: 0,
  },
  btnLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    fontWeight: 700,
  },
}

// ─── Section divider with label ───────────────────────────────────────────────
function SectionHeader({ label, open, onToggle, accent = false }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        background: open && accent ? 'rgba(200,0,10,0.08)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${open && accent ? 'rgba(200,0,10,0.4)' : 'rgba(255,255,255,0.1)'}`,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span style={{
        ...T.sectionLabel,
        color: open && accent ? '#C8000A' : 'rgba(255,255,255,0.55)',
      }}>{label}</span>
      <span style={{
        fontFamily: 'monospace', fontSize: 12,
        color: open && accent ? '#C8000A' : 'rgba(255,255,255,0.3)',
        display: 'inline-block',
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.2s',
      }}>▾</span>
    </button>
  )
}

// ─── WebRTC WHEP hook ─────────────────────────────────────────────────────────
function useWhepStream(host, port, streamName, enabled) {
  const videoRef = useRef(null)
  const pcRef    = useRef(null)
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    if (!enabled) {
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
      if (videoRef.current) videoRef.current.srcObject = null
      setStatus('idle')
      return
    }
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
      pc.onconnectionstatechange = () => {
        if (cancelled) return
        if (pc.connectionState === 'failed') setStatus('error')
      }
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
    const res = await fetch(`https://${host}/${port}/${streamName}/whep`, {
          method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp,    
        })
        if (!res.ok) throw new Error(`WHEP ${res.status}`)
        const sdp = await res.text()
        if (cancelled) return
        await pc.setRemoteDescription({ type: 'answer', sdp })
      } catch {
        if (!cancelled) setStatus('error')
      }
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

// ─── CameraFeedEmbed ─────────────────────────────────────────────────────────
function CameraFeedEmbed({ camera, enabled }) {
  const { videoRef, status } = useWhepStream(VPS_HOST, WEBRTC_PORT, camera.stream, enabled)
  const isLive  = status === 'live'
  const isError = status === 'error' || status === 'disconnected'

  if (!enabled) return null

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      aspectRatio: '16/9',
      background: '#000',
      border: '1px solid rgba(255,255,255,0.1)',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Corner accents */}
      {[['top:6px','left:6px','borderTop','borderLeft'],['top:6px','right:6px','borderTop','borderRight'],
        ['bottom:6px','left:6px','borderBottom','borderLeft'],['bottom:6px','right:6px','borderBottom','borderRight'],
      ].map(([p1, p2, b1, b2], i) => (
        <div key={i} style={{
          position:'absolute', width:12, height:12, pointerEvents:'none', zIndex:2,
          [p1.split(':')[0]]: p1.split(':')[1],
          [p2.split(':')[0]]: p2.split(':')[1],
          [b1]: '1px solid rgba(200,0,10,0.5)',
          [b2]: '1px solid rgba(200,0,10,0.5)',
        }} />
      ))}

      {/* LIVE badge */}
      <div style={{ position:'absolute', top:8, left:8, zIndex:3, display:'flex', alignItems:'center', gap:5, pointerEvents:'none' }}>
        <span style={{
          width:6, height:6, borderRadius:'50%', flexShrink:0,
          background: isLive ? '#22c55e' : 'rgba(255,255,255,0.2)',
          boxShadow: isLive ? '0 0 5px #22c55e' : 'none',
        }} />
        <span style={{ fontFamily:'monospace', fontSize:9, letterSpacing:'0.18em', textTransform:'uppercase',
          color: isLive ? '#22c55e' : 'rgba(255,255,255,0.25)' }}>
          {isLive ? 'LIVE' : status.toUpperCase()}
        </span>
      </div>

      {/* WebRTC badge */}
      <div style={{ position:'absolute', top:8, right:8, zIndex:3,
        fontFamily:'monospace', fontSize:8, letterSpacing:'0.14em', textTransform:'uppercase',
        color:'rgba(255,255,255,0.3)', border:'1px solid rgba(255,255,255,0.1)', padding:'2px 6px',
        pointerEvents:'none' }}>
        WebRTC
      </div>

      {/* Error */}
      {isError && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, zIndex:3 }}>
          <span style={{ fontFamily:'monospace', fontSize:22, color:'rgba(200,0,10,0.4)' }}>⚠</span>
          <span style={{ fontFamily:'monospace', fontSize:10, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.3)' }}>Feed Unavailable</span>
        </div>
      )}

      {/* Connecting */}
      {!isLive && !isError && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, zIndex:3 }}>
          <div style={{ width:20, height:20, border:'1.5px solid rgba(200,0,10,0.3)', borderTopColor:'#C8000A', borderRadius:'50%', animation:'spin 0.9s linear infinite' }} />
          <span style={{ fontFamily:'monospace', fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.2)' }}>Connecting…</span>
        </div>
      )}

      {/* Video */}
      <video ref={videoRef} autoPlay playsInline muted
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain', display: isLive ? 'block' : 'none' }} />

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ─── CameraToggleSection ──────────────────────────────────────────────────────
function CameraToggleSection({ camera }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      <SectionHeader label={camera.label} open={open} onToggle={() => setOpen(v => !v)} />
      {open && (
        <div style={{ border:'1px solid rgba(255,255,255,0.08)', borderTop:'none' }}>
          <CameraFeedEmbed camera={camera} enabled={open} />
        </div>
      )}
    </div>
  )
}

// ─── VelInput ─────────────────────────────────────────────────────────────────
function VelInput({ linearSpeed, angularSpeed, onApply, onSend, ready }) {
  const [lxRaw, setLxRaw] = useState(String(linearSpeed))
  const [azRaw, setAzRaw] = useState(String(angularSpeed))
  const [error, setError] = useState('')

  const parsed = () => {
    const lx = parseFloat(lxRaw), az = parseFloat(azRaw)
    if (isNaN(lx) || isNaN(az)) { setError('Enter valid numbers'); return null }
    if (Math.abs(lx) > 5)       { setError('Linear |x| ≤ 5 m/s');  return null }
    if (Math.abs(az) > 5)       { setError('Angular |z| ≤ 5 r/s'); return null }
    setError(''); return { lx, az }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#ffffff',
    fontFamily: 'monospace', fontSize: 13,
    padding: '7px 9px',
    outline: 'none',
    transition: 'border-color 0.15s',
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

      {/* Status row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={T.sectionLabel}>Velocity Config</span>
        <span style={{ fontFamily:'monospace', fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase',
          color: ready ? 'rgba(255,255,255,0.6)' : '#C8000A', fontWeight:700 }}>
          {ready ? '● LIVE' : '○ OFFLINE'}
        </span>
      </div>

      {/* Two inputs */}
      <div style={{ display:'flex', gap:8 }}>
        <div style={{ flex:1 }}>
          <p style={T.fieldLabel}>Linear X <span style={{ color:'rgba(255,255,255,0.25)' }}>m/s</span></p>
          <input type="number" step="0.05" placeholder="0.30" value={lxRaw}
            onChange={e => { setLxRaw(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && parsed() && onApply(parseFloat(lxRaw), parseFloat(azRaw))}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor='#C8000A'}
            onBlur={e  => e.target.style.borderColor='rgba(255,255,255,0.12)'}
          />
        </div>
        <div style={{ flex:1 }}>
          <p style={T.fieldLabel}>Angular Z <span style={{ color:'rgba(255,255,255,0.25)' }}>r/s</span></p>
          <input type="number" step="0.05" placeholder="0.50" value={azRaw}
            onChange={e => { setAzRaw(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && parsed() && onApply(parseFloat(lxRaw), parseFloat(azRaw))}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor='#C8000A'}
            onBlur={e  => e.target.style.borderColor='rgba(255,255,255,0.12)'}
          />
        </div>
      </div>

      {error && <p style={T.error}>⚠ {error}</p>}

      {/* Buttons */}
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={() => { const v = parsed(); if (v) onApply(v.lx, v.az) }}
          style={{ flex:1, padding:'8px 0', cursor:'pointer', transition:'all 0.1s',
            fontFamily:'monospace', fontSize:11, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight:700,
            border:'1px solid rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.7)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='#C8000A'; e.currentTarget.style.color='#C8000A' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.2)'; e.currentTarget.style.color='rgba(255,255,255,0.7)' }}
        >SET D-PAD</button>

        <button onClick={() => { const v = parsed(); if (v) onSend(v.lx, v.az) }}
          disabled={!ready}
          style={{ flex:1, padding:'8px 0', transition:'all 0.1s',
            fontFamily:'monospace', fontSize:11, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight:700,
            border:`1px solid ${ready ? '#C8000A' : 'rgba(255,255,255,0.08)'}`,
            background: ready ? '#C8000A' : 'transparent',
            color: ready ? '#ffffff' : 'rgba(255,255,255,0.18)',
            cursor: ready ? 'pointer' : 'not-allowed' }}
        >SEND ONCE</button>
      </div>

      {/* Active speed readout */}
      <div style={{ background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.07)',
        padding:'6px 10px', display:'flex', justifyContent:'space-between' }}>
        <span style={{ ...T.hint, fontSize:10 }}>D-PAD SPEED</span>
        <span style={{ fontFamily:'monospace', fontSize:11, color:'rgba(255,255,255,0.55)', letterSpacing:'0.08em' }}>
          lx {linearSpeed.toFixed(2)} · az {angularSpeed.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

// ─── DirBtn ───────────────────────────────────────────────────────────────────
function DirBtn({ label, display, onStart, onStop, active, disabled }) {
  const isActive = active === label
  return (
    <button
      onMouseDown={e   => { e.preventDefault(); onStart(label) }}
      onMouseUp={onStop}
      onMouseLeave={() => { if (active === label) onStop() }}
      onTouchStart={e  => { e.preventDefault(); onStart(label) }}
      onTouchEnd={e    => { e.preventDefault(); onStop() }}
      onTouchCancel={e => { e.preventDefault(); onStop() }}
      disabled={disabled}
      style={{
        width:60, height:60, borderRadius:6,
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
        border:`1px solid ${isActive ? '#C8000A' : disabled ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)'}`,
        background: isActive ? 'rgba(200,0,10,0.2)' : disabled ? 'transparent' : 'rgba(255,255,255,0.04)',
        color:      isActive ? '#C8000A' : disabled ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.55)',
        boxShadow:  isActive ? '0 0 14px rgba(200,0,10,0.3)' : 'none',
        cursor:     disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.07s',
        userSelect:'none', touchAction:'none', fontFamily:'monospace',
      }}
    >
      <span style={{ fontSize:20, lineHeight:1 }}>{display}</span>
      <span style={{ fontSize:8, letterSpacing:'0.15em', textTransform:'uppercase', opacity:0.7 }}>{label}</span>
    </button>
  )
}

// ─── TeleopPad ────────────────────────────────────────────────────────────────
function TeleopPad({ publish, ready, cmdVelTopic, linearSpeed, angularSpeed, hz }) {
  const intervalRef = useRef(null)
  const speedRef    = useRef({ linearSpeed, angularSpeed })
  const [active, setActive] = useState(null)

  useEffect(() => { speedRef.current = { linearSpeed, angularSpeed } }, [linearSpeed, angularSpeed])

  const stopAll = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setActive(null)
    if (ready) publish(cmdVelTopic, 'geometry_msgs/Twist', {
      linear: { x:0, y:0, z:0 }, angular: { x:0, y:0, z:0 },
    })
  }, [publish, ready, cmdVelTopic])

  const DIR = { FWD:[1,0], BACK:[-1,0], LEFT:[0,1], RIGHT:[0,-1] }

  const startCmd = useCallback((label) => {
    stopAll()
    if (!ready) return
    setActive(label)
    const [lm, am] = DIR[label]
    const send = () => {
      const { linearSpeed: ls, angularSpeed: as } = speedRef.current
      publish(cmdVelTopic, 'geometry_msgs/Twist', {
        linear: { x: lm * ls, y:0, z:0 }, angular: { x:0, y:0, z: am * as },
      })
    }
    send()
    intervalRef.current = setInterval(send, 1000 / hz)
  }, [publish, ready, stopAll, cmdVelTopic, hz])

  useEffect(() => () => stopAll(), [])
  useEffect(() => {
    const up = () => { if (intervalRef.current) stopAll() }
    window.addEventListener('mouseup',     up)
    window.addEventListener('touchend',    up)
    window.addEventListener('touchcancel', up)
    return () => {
      window.removeEventListener('mouseup',     up)
      window.removeEventListener('touchend',    up)
      window.removeEventListener('touchcancel', up)
    }
  }, [stopAll])

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, userSelect:'none' }}>
      {/* D-pad */}
      <div style={{ display:'flex', justifyContent:'center' }}>
        <DirBtn label="FWD"   display="▲" active={active} disabled={!ready} onStart={startCmd} onStop={stopAll} />
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <DirBtn label="LEFT"  display="◀" active={active} disabled={!ready} onStart={startCmd} onStop={stopAll} />
        {/* E-Stop */}
        <button onClick={stopAll} disabled={!ready}
          style={{ width:60, height:60, borderRadius:6,
            border:'1px solid rgba(255,255,255,0.12)', background:'transparent',
            color:'rgba(255,255,255,0.3)', fontFamily:'monospace', fontSize:20,
            cursor: ready ? 'pointer' : 'not-allowed', transition:'all 0.1s' }}
          onMouseEnter={e => { if (ready) { e.currentTarget.style.borderColor='rgba(200,0,10,0.5)'; e.currentTarget.style.color='#C8000A' }}}
          onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.12)'; e.currentTarget.style.color='rgba(255,255,255,0.3)' }}
        >■</button>
        <DirBtn label="RIGHT" display="▶" active={active} disabled={!ready} onStart={startCmd} onStop={stopAll} />
      </div>
      <div style={{ display:'flex', justifyContent:'center' }}>
        <DirBtn label="BACK"  display="▼" active={active} disabled={!ready} onStart={startCmd} onStop={stopAll} />
      </div>
      <p style={{ ...T.hint, fontSize:10, marginTop:2 }}>Hold to move · Release to stop</p>
    </div>
  )
}

// ─── PanelBody ────────────────────────────────────────────────────────────────
function PanelBody({ publish, ready, cmdVelTopic, hz, linearSpeed, angularSpeed, onApply }) {
  const [ctrlOpen, setCtrlOpen] = useState(true)

  const handleSend = useCallback((lx, az) => {
    if (!ready) return
    publish(cmdVelTopic, 'geometry_msgs/Twist', {
      linear: { x: lx, y:0, z:0 }, angular: { x:0, y:0, z: az },
    })
  }, [publish, ready, cmdVelTopic])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0 }}>

      {/* ── Camera 1: Driving ── */}
      <CameraToggleSection camera={CAMERAS[0]} />

      {/* spacer */}
      <div style={{ height:4 }} />

      {/* ── Camera 2: Surveillance ── */}
      <CameraToggleSection camera={CAMERAS[1]} />

      <div style={{ height:8 }} />

      {/* ── Manual Control section ── */}
      <SectionHeader label="Manual Control" open={ctrlOpen} onToggle={() => setCtrlOpen(v => !v)} accent />

      {ctrlOpen && (
        <div style={{ border:'1px solid rgba(200,0,10,0.22)', borderTop:'none', background:'rgba(0,0,0,0.25)', padding:'14px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <VelInput
              linearSpeed={linearSpeed} angularSpeed={angularSpeed}
              onApply={onApply} onSend={handleSend} ready={ready}
            />
            <div style={{ height:1, background:'rgba(255,255,255,0.07)' }} />
            <TeleopPad
              publish={publish} ready={ready}
              cmdVelTopic={cmdVelTopic} hz={hz}
              linearSpeed={linearSpeed} angularSpeed={angularSpeed}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────
export default function TeleopPanel({
  publish,
  ready,
  cmdVelTopic = DEFAULT_CMD_VEL,
  hz          = DEFAULT_HZ,
  alwaysOpen  = false,
  defaultOpen = false,
}) {
  const [open,         setOpen]         = useState(alwaysOpen || defaultOpen)
  const [linearSpeed,  setLinearSpeed]  = useState(DEFAULT_LINEAR)
  const [angularSpeed, setAngularSpeed] = useState(DEFAULT_ANGULAR)

  const handleApply = useCallback((lx, az) => {
    setLinearSpeed(Math.abs(lx))
    setAngularSpeed(Math.abs(az))
  }, [])

  if (alwaysOpen) {
    return (
      <PanelBody
        publish={publish} ready={ready} cmdVelTopic={cmdVelTopic} hz={hz}
        linearSpeed={linearSpeed} angularSpeed={angularSpeed} onApply={handleApply}
      />
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {/* Outer toggle */}
      <button onClick={() => setOpen(v => !v)}
        style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'10px 14px', width:'100%', cursor:'pointer', transition:'all 0.15s',
          background: open ? 'rgba(200,0,10,0.1)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${open ? 'rgba(200,0,10,0.45)' : 'rgba(255,255,255,0.12)'}`,
          color: open ? '#C8000A' : 'rgba(255,255,255,0.5)',
        }}
      >
        <span style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* Joystick icon */}
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0 }}>
            <circle cx="7" cy="7" r="6"  stroke="currentColor" strokeWidth="1.2" />
            <circle cx="7" cy="7" r="2"  stroke="currentColor" strokeWidth="1.2" />
            <line x1="7" y1="1" x2="7" y2="5"  stroke="currentColor" strokeWidth="1.2" />
            <line x1="7" y1="9" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" />
            <line x1="1" y1="7" x2="5" y2="7"  stroke="currentColor" strokeWidth="1.2" />
            <line x1="9" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span style={{ ...T.sectionLabel, color: open ? '#C8000A' : 'rgba(255,255,255,0.5)' }}>
            Manual Control
          </span>
          {!ready && (
            <span style={{ fontFamily:'monospace', fontSize:9, color:'#C8000A', letterSpacing:'0.12em' }}>
              · OFFLINE
            </span>
          )}
        </span>
        <span style={{ fontFamily:'monospace', fontSize:13, display:'inline-block',
          transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.2s',
          color: open ? '#C8000A' : 'rgba(255,255,255,0.3)' }}>▾</span>
      </button>

      {open && (
        <div style={{ border:'1px solid rgba(200,0,10,0.22)', borderTop:'none', background:'rgba(0,0,0,0.2)', padding:'12px 14px' }}>
          <PanelBody
            publish={publish} ready={ready} cmdVelTopic={cmdVelTopic} hz={hz}
            linearSpeed={linearSpeed} angularSpeed={angularSpeed} onApply={handleApply}
          />
        </div>
      )}
    </div>
  )
}