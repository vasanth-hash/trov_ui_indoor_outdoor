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

// ── Manual drive via MAVROS RC override (published straight to the FCU) ──────
const RC_OVERRIDE_TOPIC = '/mavros/rc/override'
const RC_TYPE           = 'mavros_msgs/OverrideRCIn'
const DEFAULT_HZ        = 10

// 0-based channel indices: rc0 = steer, rc2 = throttle (rc5 = arming, handled elsewhere)
const CH_STEER    = 0
const CH_THROTTLE = 2
const RC_NEUTRAL  = 1501
const RC_NOCHANGE = 65535   // OverrideRCIn: leave a channel untouched

// Hardcoded PWM (µs) per direction — steer on rc0, throttle on rc2
const RC = {
  FWD:   { steer: RC_NEUTRAL, throttle: 1530 },
  BACK:  { steer: RC_NEUTRAL, throttle: 1470 },
  LEFT:  { steer: 1330,       throttle: RC_NEUTRAL },
  RIGHT: { steer: 1660,       throttle: RC_NEUTRAL },
  STOP:  { steer: RC_NEUTRAL, throttle: RC_NEUTRAL },
}

// Build an 18-channel OverrideRCIn: override steer + throttle, leave the rest untouched
function rcOverrideMsg(steer, throttle) {
  const channels = new Array(18).fill(RC_NOCHANGE)
  channels[CH_STEER]    = steer
  channels[CH_THROTTLE] = throttle
  return { channels }
}

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
function TeleopPad({ publish, ready, hz }) {
  const intervalRef = useRef(null)
  const [active, setActive] = useState(null)

  const sendRC = useCallback((steer, throttle) => {
    if (ready) publish(RC_OVERRIDE_TOPIC, RC_TYPE, rcOverrideMsg(steer, throttle))
  }, [publish, ready])

  const stopAll = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setActive(null)
    sendRC(RC.STOP.steer, RC.STOP.throttle)   // neutral steer + throttle = halt
  }, [sendRC])

  const startCmd = useCallback((label) => {
    stopAll()
    if (!ready) return
    setActive(label)
    const v = RC[label]
    const send = () => sendRC(v.steer, v.throttle)
    send()
    intervalRef.current = setInterval(send, 1000 / hz)   // stream while held — FCU needs continuous override
  }, [ready, stopAll, sendRC, hz])

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
function PanelBody({ publish, ready, hz }) {
  const [ctrlOpen, setCtrlOpen] = useState(true)

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
            <TeleopPad publish={publish} ready={ready} hz={hz} />
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
  hz          = DEFAULT_HZ,
  alwaysOpen  = false,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(alwaysOpen || defaultOpen)

  if (alwaysOpen) {
    return <PanelBody publish={publish} ready={ready} hz={hz} />
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
          <PanelBody publish={publish} ready={ready} hz={hz} />
        </div>
      )}
    </div>
  )
}