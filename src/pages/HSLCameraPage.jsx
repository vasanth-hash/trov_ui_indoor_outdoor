import { useState, useEffect, useRef } from 'react'
import Hls from 'hls.js'
import PTZControl from '../components/PTZControl'

// ✅ Both are now HLS feeds
const DRIVING_FEED      = 'http://trovcamera.edgeforce.in/driving_camera/index.m3u8'
const SURVEILLANCE_FEED = 'http://trovcamera.edgeforce.in/surveillance_camera/index.m3u8'

const CAMERAS = [
  { id: 'driving', label: 'Driving Camera', sub: 'Forward View', feed: DRIVING_FEED, hasPTZ: false },
  { id: 'surveillance', label: 'Surveillance Camera', sub: 'Wide Field', feed: SURVEILLANCE_FEED, hasPTZ: true },
]

function CameraFeed({ camera, isFullscreen = false, onFullscreen, onExitFullscreen }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let hls

    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 2, // 🔥 reduces latency
        liveSyncDuration: 1
      })
      hls.loadSource(camera.feed)
      hls.attachMedia(video)

      hls.on(Hls.Events.ERROR, () => {
        setError(true)
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = camera.feed
    } else {
      setError(true)
    }

    return () => {
      if (hls) hls.destroy()
    }
  }, [camera.feed])

  return (
    <div className="relative flex flex-col bg-brand-black border border-brand-border overflow-hidden h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-brand-dark border-b border-brand-border">
        <div>
          <p className="text-white text-xs uppercase font-bold">{camera.label}</p>
          <p className="text-white/30 text-[10px]">{camera.sub}</p>
        </div>

        <div className="flex items-center gap-2">
          {camera.hasPTZ && (
            <span className="text-red-400 text-[10px] border px-2 py-0.5">PTZ</span>
          )}

          {onFullscreen && (
            <button onClick={onFullscreen}>⛶</button>
          )}
          {onExitFullscreen && (
            <button onClick={onExitFullscreen}>✕</button>
          )}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 relative bg-black">

        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400">
            <p>Feed Unavailable</p>
            <p className="text-xs">{camera.feed}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}

        {/* LIVE indicator */}
        <div className="absolute top-3 left-3 text-green-400 text-xs">● LIVE</div>
      </div>
    </div>
  )
}

export default function HSLCamerasPage() {
  const [fullscreenId, setFullscreenId] = useState(null)

  const fullscreenCamera = CAMERAS.find(c => c.id === fullscreenId)

  return (
    <div className="h-full flex flex-col bg-black">

      {/* Header */}
      <div className="px-4 py-2 border-b text-white flex justify-between">
        <span>Live Cameras</span>
        <span>{fullscreenId ? 'FULLSCREEN' : 'DUAL VIEW'}</span>
      </div>

      {/* Fullscreen */}
      {fullscreenCamera ? (
        <div className="flex flex-1 p-2 gap-2">
          <div className="flex-1">
            <CameraFeed
              camera={fullscreenCamera}
              isFullscreen
              onExitFullscreen={() => setFullscreenId(null)}
            />
          </div>

          {fullscreenCamera.hasPTZ && <PTZControl />}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 flex-1 p-2">
          {CAMERAS.map(cam => (
            <CameraFeed
              key={cam.id}
              camera={cam}
              onFullscreen={() => setFullscreenId(cam.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}