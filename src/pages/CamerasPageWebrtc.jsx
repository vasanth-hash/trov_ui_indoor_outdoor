// import { useState, useEffect, useRef } from 'react'
// import PTZControl from '../components/PTZControl'

// const VPS_HOST = 'trovcamera.edgeforce.in'
// const WEBRTC_PORT = 8889

// const CAMERAS = [
//   { id: 'driving',      label: 'Driving Camera',     sub: 'Forward View', stream: 'driving_camera',      hasPTZ: false },
//   { id: 'surveillance', label: 'Surveillance Camera', sub: 'Wide Field',   stream: 'surveillance_camera', hasPTZ: true  },
// ]

// // ─── WebRTC WHEP Hook ────────────────────────────────────────────────────────
// function useWhepStream(host, port, streamName, enabled = true) {
//   const videoRef  = useRef(null)
//   const pcRef     = useRef(null)
//   const [status, setStatus] = useState('idle') // idle | connecting | live | error | disconnected

//   useEffect(() => {
//     if (!enabled) return

//     let cancelled = false

//     async function connect() {
//       setStatus('connecting')

//       // Clean up any previous peer connection
//       if (pcRef.current) {
//         pcRef.current.close()
//         pcRef.current = null
//       }

//       const pc = new RTCPeerConnection({
//         iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
//       })
//       pcRef.current = pc

//       // Receive video + audio from the server
//       pc.addTransceiver('video', { direction: 'recvonly' })
//       pc.addTransceiver('audio', { direction: 'recvonly' })

//       pc.ontrack = (e) => {
//         if (cancelled) return
//         if (videoRef.current) {
//           videoRef.current.srcObject = e.streams[0]
//           setStatus('live')
//         }
//       }

//       pc.oniceconnectionstatechange = () => {
//         if (cancelled) return
//         const s = pc.iceConnectionState
//         if (s === 'failed' || s === 'disconnected' || s === 'closed') {
//           setStatus('disconnected')
//         }
//       }

//       pc.onconnectionstatechange = () => {
//         if (cancelled) return
//         if (pc.connectionState === 'failed') setStatus('error')
//       }

//       try {
//         const offer = await pc.createOffer()
//         await pc.setLocalDescription(offer)

//         const res = await fetch(`http://${host}:${port}/${streamName}/whep`, {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/sdp' },
//           body: offer.sdp,
//         })

//         if (!res.ok) throw new Error(`WHEP ${res.status}`)

//         const sdpAnswer = await res.text()
//         if (cancelled) return
//         await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
//       } catch (err) {
//         if (cancelled) return
//         console.error(`[WebRTC] ${streamName}:`, err)
//         setStatus('error')
//       }
//     }

//     connect()

//     return () => {
//       cancelled = true
//       if (pcRef.current) {
//         pcRef.current.close()
//         pcRef.current = null
//       }
//       if (videoRef.current) videoRef.current.srcObject = null
//       setStatus('idle')
//     }
//   }, [host, port, streamName, enabled])

//   return { videoRef, status }
// }

// // ─── Status badge text ───────────────────────────────────────────────────────
// function statusLabel(status) {
//   switch (status) {
//     case 'connecting':   return 'Connecting…'
//     case 'error':        return 'Feed Unavailable'
//     case 'disconnected': return 'Stream Disconnected'
//     default:             return 'Initialising…'
//   }
// }

// // ─── CameraFeed ──────────────────────────────────────────────────────────────
// function CameraFeed({ camera, isFullscreen = false, onFullscreen, onExitFullscreen }) {
//   const { videoRef, status } = useWhepStream(VPS_HOST, WEBRTC_PORT, camera.stream)

//   const isLive  = status === 'live'
//   const isError = status === 'error' || status === 'disconnected'

//   return (
//     <div className={`relative flex flex-col bg-brand-black border border-brand-border overflow-hidden
//       ${isFullscreen ? 'h-full' : 'h-full'}`}>

//       {/* ── Label bar ── */}
//       <div className="flex items-center justify-between px-3 py-2 bg-brand-dark border-b border-brand-border flex-shrink-0">
//         <div className="flex items-center gap-2">
//           <div>
//             <p className="font-sans font-bold text-white text-xs tracking-wide uppercase leading-none">
//               {camera.label}
//             </p>
//             <p className="font-mono text-white/30 text-[8px] tracking-widest uppercase leading-none mt-0.5">
//               {camera.sub}
//             </p>
//           </div>
//         </div>

//         <div className="flex items-center gap-2">
//           {/* WebRTC badge */}
//           <span className="font-mono text-[8px] tracking-widest uppercase px-2 py-0.5 border border-brand-teal/30 text-brand-teal bg-brand-teal/5">
//             WebRTC
//           </span>

//           {camera.hasPTZ && (
//             <span className="font-mono text-[8px] tracking-widest uppercase px-2 py-0.5 border border-brand-red/30 text-brand-red bg-brand-red/5">
//               PTZ
//             </span>
//           )}

//           {onFullscreen && (
//             <button
//               onClick={onFullscreen}
//               className="w-6 h-6 flex items-center justify-center border border-brand-border text-white/30 hover:border-brand-red/50 hover:text-brand-red transition-all text-[10px]"
//               title="Fullscreen"
//             >⛶</button>
//           )}
//           {onExitFullscreen && (
//             <button
//               onClick={onExitFullscreen}
//               className="w-6 h-6 flex items-center justify-center border border-brand-red/40 text-brand-red hover:bg-brand-red/10 transition-all text-[10px]"
//               title="Exit Fullscreen"
//             >✕</button>
//           )}
//         </div>
//       </div>

//       {/* ── Feed area ── */}
//       <div className="flex-1 relative bg-black min-h-0">
//         {/* Scanline overlay */}
//         <div className="absolute inset-0 scan-line z-10 pointer-events-none" />

//         {/* Corner accents */}
//         <div className="absolute top-2 left-2 w-5 h-5 border-t border-l border-brand-red/40 z-20 pointer-events-none" />
//         <div className="absolute top-2 right-2 w-5 h-5 border-t border-r border-brand-red/40 z-20 pointer-events-none" />
//         <div className="absolute bottom-2 left-2 w-5 h-5 border-b border-l border-brand-red/40 z-20 pointer-events-none" />
//         <div className="absolute bottom-2 right-2 w-5 h-5 border-b border-r border-brand-red/40 z-20 pointer-events-none" />

//         {/* LIVE badge */}
//         <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 pointer-events-none">
//           <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-400 animate-pulse-dot' : 'bg-white/20'}`} />
//           <span className={`font-mono text-[9px] tracking-widest uppercase ${isLive ? 'text-green-400' : 'text-white/20'}`}>
//             {isLive ? 'Live' : status}
//           </span>
//         </div>

//         {/* ICE / connection state badge — bottom right */}
//         {!isLive && !isError && (
//           <div className="absolute bottom-4 right-4 z-20 pointer-events-none">
//             <span className="font-mono text-[8px] tracking-widest uppercase text-white/20 animate-pulse">
//               ● Negotiating
//             </span>
//           </div>
//         )}

//         {/* Error state */}
//         {isError && (
//           <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20">
//             <div className="text-brand-red/40 text-3xl font-mono">⚠</div>
//             <p className="font-mono text-white/30 text-[10px] tracking-widest uppercase">
//               {statusLabel(status)}
//             </p>
//             <p className="font-mono text-white/15 text-[9px]">
//             {/* https://trovcamera.edgeforce.in/webrtc/driving_camera/whep */}
//               {VPS_HOST}:{WEBRTC_PORT}/{camera.stream}/whep
//             </p>
//           </div>
//         )}

//         {/* Connecting spinner */}
//         {!isLive && !isError && (
//           <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20">
//             <div className="w-6 h-6 border border-brand-red/30 border-t-brand-red rounded-full animate-spin" />
//             <p className="font-mono text-white/20 text-[9px] tracking-widest uppercase">
//               {statusLabel(status)}
//             </p>
//           </div>
//         )}

//         {/* Video element — always mounted, hidden until live */}
//         <video
//           ref={videoRef}
//           autoPlay
//           playsInline
//           muted
//           className="absolute inset-0 w-full h-full object-contain"
//           style={{ display: isLive ? 'block' : 'none' }}
//         />
//       </div>
//     </div>
//   )
// }

// // ─── Page ────────────────────────────────────────────────────────────────────
// export default function CamerasPageWebrtc() {
//   const [fullscreenId, setFullscreenId] = useState(null)
//   const fullscreenCamera = fullscreenId ? CAMERAS.find(c => c.id === fullscreenId) : null

//   return (
//     <div className="h-full flex flex-col bg-brand-black overflow-hidden">

//       {/* Page header */}
//       <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
//         <div className="flex items-center gap-3">
//           <div className="w-0.5 h-5 bg-brand-red" />
//           <div>
//             <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">
//               Live Cameras
//             </h1>
//             <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">
//               {CAMERAS.length} feeds active · WebRTC · sub-500ms latency
//             </p>
//           </div>
//         </div>
//         <span className="font-mono text-[9px] tracking-widest uppercase text-white/20">
//           {fullscreenId ? 'FULLSCREEN MODE' : 'DUAL VIEW'}
//         </span>
//       </div>

//       {/* ── FULLSCREEN MODE ── */}
//       {fullscreenCamera ? (
//         <div className="flex-1 flex overflow-hidden min-h-0 p-3 gap-3">
//           <div className="flex-1 min-w-0 min-h-0">
//             <CameraFeed
//               camera={fullscreenCamera}
//               isFullscreen
//               onExitFullscreen={() => setFullscreenId(null)}
//             />
//           </div>
//           {fullscreenCamera.hasPTZ && (
//             <div className="flex-shrink-0 flex items-center">
//               <PTZControl />
//             </div>
//           )}
//         </div>
//       ) : (
//         /* ── DUAL VIEW ── */
//         <div className="flex-1 grid grid-cols-2 overflow-hidden min-h-0 p-3 gap-3">
//           {CAMERAS.map(cam => (
//             <div key={cam.id} className="min-h-0 min-w-0 flex flex-col">
//               <CameraFeed
//                 camera={cam}
//                 onFullscreen={() => setFullscreenId(cam.id)}
//               />
//             </div>
//           ))}
//         </div>
//       )}
//     </div>
//   )
// }

import { useState, useEffect, useRef } from 'react'
import PTZControl from '../components/PTZControl'

const VPS_HOST = 'trovcamera.edgeforce.in'
const WEBRTC_PORT = 'webrtc'

const CAMERAS = [
  { id: 'driving',      label: 'Driving Camera',     sub: 'Forward View', stream: 'driving_camera',      hasPTZ: false },
  { id: 'surveillance', label: 'Surveillance Camera', sub: 'Wide Field',   stream: 'surveillance_camera', hasPTZ: true  },
]

// ─── WebRTC WHEP Hook ────────────────────────────────────────────────────────
function useWhepStream(host, port, streamName, enabled = true) {
  const videoRef  = useRef(null)
  const pcRef     = useRef(null)
  const [status, setStatus] = useState('idle') // idle | connecting | live | error | disconnected

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function connect() {
      setStatus('connecting')

      // Clean up any previous peer connection
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = pc

      // Receive video + audio from the server
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      pc.ontrack = (e) => {
        if (cancelled) return
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0]
          setStatus('live')
        }
      }

      pc.oniceconnectionstatechange = () => {
        if (cancelled) return
        const s = pc.iceConnectionState
        if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          setStatus('disconnected')
        }
      }

      pc.onconnectionstatechange = () => {
        if (cancelled) return
        if (pc.connectionState === 'failed') setStatus('error')
      }

      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        const res = await fetch(`https://${host}/${port}/${streamName}/whep`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offer.sdp,
        })

        if (!res.ok) throw new Error(`WHEP ${res.status}`)

        const sdpAnswer = await res.text()
        if (cancelled) return
        await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
      } catch (err) {
        if (cancelled) return
        console.error(`[WebRTC] ${streamName}:`, err)
        setStatus('error')
      }
    }

    connect()

    return () => {
      cancelled = true
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      if (videoRef.current) videoRef.current.srcObject = null
      setStatus('idle')
    }
  }, [host, port, streamName, enabled])

  return { videoRef, status }
}

// ─── Status badge text ───────────────────────────────────────────────────────
function statusLabel(status) {
  switch (status) {
    case 'connecting':   return 'Connecting…'
    case 'error':        return 'Feed Unavailable'
    case 'disconnected': return 'Stream Disconnected'
    default:             return 'Initialising…'
  }
}

// ─── CameraFeed ──────────────────────────────────────────────────────────────
function CameraFeed({ camera, isFullscreen = false, onFullscreen, onExitFullscreen }) {
  const { videoRef, status } = useWhepStream(VPS_HOST, WEBRTC_PORT, camera.stream)

  const isLive  = status === 'live'
  const isError = status === 'error' || status === 'disconnected'

  return (
    <div className={`relative flex flex-col bg-brand-black border border-brand-border overflow-hidden
      ${isFullscreen ? 'h-full' : 'h-full'}`}>

      {/* ── Label bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-brand-dark border-b border-brand-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div>
            <p className="font-sans font-bold text-white text-xs tracking-wide uppercase leading-none">
              {camera.label}
            </p>
            <p className="font-mono text-white/30 text-[8px] tracking-widest uppercase leading-none mt-0.5">
              {camera.sub}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* WebRTC badge */}
          <span className="font-mono text-[8px] tracking-widest uppercase px-2 py-0.5 border border-brand-teal/30 text-brand-teal bg-brand-teal/5">
            WebRTC
          </span>

          {camera.hasPTZ && (
            <span className="font-mono text-[8px] tracking-widest uppercase px-2 py-0.5 border border-brand-red/30 text-brand-red bg-brand-red/5">
              PTZ
            </span>
          )}

          {onFullscreen && (
            <button
              onClick={onFullscreen}
              className="w-6 h-6 flex items-center justify-center border border-brand-border text-white/30 hover:border-brand-red/50 hover:text-brand-red transition-all text-[10px]"
              title="Fullscreen"
            >⛶</button>
          )}
          {onExitFullscreen && (
            <button
              onClick={onExitFullscreen}
              className="w-6 h-6 flex items-center justify-center border border-brand-red/40 text-brand-red hover:bg-brand-red/10 transition-all text-[10px]"
              title="Exit Fullscreen"
            >✕</button>
          )}
        </div>
      </div>

      {/* ── Feed area ── */}
      <div className="flex-1 relative bg-black min-h-0">
        {/* Scanline overlay */}
        <div className="absolute inset-0 scan-line z-10 pointer-events-none" />

        {/* Corner accents */}
        <div className="absolute top-2 left-2 w-5 h-5 border-t border-l border-brand-red/40 z-20 pointer-events-none" />
        <div className="absolute top-2 right-2 w-5 h-5 border-t border-r border-brand-red/40 z-20 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-5 h-5 border-b border-l border-brand-red/40 z-20 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-5 h-5 border-b border-r border-brand-red/40 z-20 pointer-events-none" />

        {/* LIVE badge */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 pointer-events-none">
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-400 animate-pulse-dot' : 'bg-white/20'}`} />
          <span className={`font-mono text-[9px] tracking-widest uppercase ${isLive ? 'text-green-400' : 'text-white/20'}`}>
            {isLive ? 'Live' : status}
          </span>
        </div>

        {/* ICE / connection state badge — bottom right */}
        {!isLive && !isError && (
          <div className="absolute bottom-4 right-4 z-20 pointer-events-none">
            <span className="font-mono text-[8px] tracking-widest uppercase text-white/20 animate-pulse">
              ● Negotiating
            </span>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20">
            <div className="text-brand-red/40 text-3xl font-mono">⚠</div>
            <p className="font-mono text-white/30 text-[10px] tracking-widest uppercase">
              {statusLabel(status)}
            </p>
            <p className="font-mono text-white/15 text-[9px]">
            {/* https://trovcamera.edgeforce.in/webrtc/driving_camera/whep */}
              {VPS_HOST}/{WEBRTC_PORT}/{camera.stream}/whep
            </p>
          </div>
        )}

        {/* Connecting spinner */}
        {!isLive && !isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20">
            <div className="w-6 h-6 border border-brand-red/30 border-t-brand-red rounded-full animate-spin" />
            <p className="font-mono text-white/20 text-[9px] tracking-widest uppercase">
              {statusLabel(status)}
            </p>
          </div>
        )}

        {/* Video element — always mounted, hidden until live */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-contain"
          style={{ display: isLive ? 'block' : 'none' }}
        />
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function CamerasPageWebrtc() {
  const [fullscreenId, setFullscreenId] = useState(null)
  const fullscreenCamera = fullscreenId ? CAMERAS.find(c => c.id === fullscreenId) : null

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* Page header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">
              Live Cameras
            </h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">
              {CAMERAS.length} feeds active · WebRTC · sub-500ms latency
            </p>
          </div>
        </div>
        <span className="font-mono text-[9px] tracking-widest uppercase text-white/20">
          {fullscreenId ? 'FULLSCREEN MODE' : 'DUAL VIEW'}
        </span>
      </div>

      {/* ── FULLSCREEN MODE ── */}
      {fullscreenCamera ? (
        <div className="flex-1 flex overflow-hidden min-h-0 p-3 gap-3">
          <div className="flex-1 min-w-0 min-h-0">
            <CameraFeed
              camera={fullscreenCamera}
              isFullscreen
              onExitFullscreen={() => setFullscreenId(null)}
            />
          </div>
          {fullscreenCamera.hasPTZ && (
            <div className="flex-shrink-0 flex items-center">
              <PTZControl />
            </div>
          )}
        </div>
      ) : (
        /* ── DUAL VIEW ── */
        <div className="flex-1 grid grid-cols-2 overflow-hidden min-h-0 p-3 gap-3">
          {CAMERAS.map(cam => (
            <div key={cam.id} className="min-h-0 min-w-0 flex flex-col">
              <CameraFeed
                camera={cam}
                onFullscreen={() => setFullscreenId(cam.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
