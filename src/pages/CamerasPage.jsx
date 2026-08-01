import { useState } from 'react'
import PTZControl from '../components/PTZControl'

const DRIVING_FEED      = 'http://trovcamera.edgeforce.in/driving_camera_mjpeg'
const SURVEILLANCE_FEED = 'http://trovcamera.edgeforce.in/surveillance_camera_mjpeg'

const CAMERAS = [
  { id: 'driving',      label: 'Driving Camera',     sub: 'Forward View', feed: DRIVING_FEED,      hasPTZ: false },
  { id: 'surveillance', label: 'Surveillance Camera', sub: 'Wide Field',   feed: SURVEILLANCE_FEED, hasPTZ: true  },
]

function CameraFeed({ camera, isFullscreen = false, onFullscreen, onExitFullscreen }) {
  const [imgError, setImgError] = useState(false)
  const [imgKey, setImgKey]     = useState(0)

  const retry = () => { setImgError(false); setImgKey(k => k + 1) }

  return (
    <div className={`relative flex flex-col bg-brand-black border border-brand-border overflow-hidden
      ${isFullscreen ? 'h-full' : 'h-full'}`}>

      {/* ── Label bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-brand-dark border-b border-brand-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div>
            <p className="font-sans font-bold text-white text-xs tracking-wide uppercase leading-none">{camera.label}</p>
            <p className="font-mono text-white/30 text-[8px] tracking-widest uppercase leading-none mt-0.5">{camera.sub}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {camera.hasPTZ && (
            <span className="font-mono text-[8px] tracking-widest uppercase px-2 py-0.5 border border-brand-red/30 text-brand-red bg-brand-red/5">
              PTZ
            </span>
          )}

          {/* Fullscreen / Exit */}
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
        {/* Scanline */}
        <div className="absolute inset-0 scan-line z-10 pointer-events-none" />

        {/* Corner accents */}
        <div className="absolute top-2 left-2 w-5 h-5 border-t border-l border-brand-red/40 z-20 pointer-events-none" />
        <div className="absolute top-2 right-2 w-5 h-5 border-t border-r border-brand-red/40 z-20 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-5 h-5 border-b border-l border-brand-red/40 z-20 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-5 h-5 border-b border-r border-brand-red/40 z-20 pointer-events-none" />

        {/* LIVE badge — green */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
          <span className="font-mono text-green-400 text-[9px] tracking-widest uppercase">Live</span>
        </div>

        {imgError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="text-brand-red/40 text-3xl font-mono">⚠</div>
            <p className="font-mono text-white/30 text-[10px] tracking-widest uppercase">Feed Unavailable</p>
            <p className="font-mono text-white/15 text-[9px]">{camera.feed}</p>
            <button
              onClick={retry}
              className="mt-2 px-4 py-1.5 border border-brand-red/30 text-brand-red font-mono text-[9px] tracking-widest uppercase hover:bg-brand-red/10 transition-colors"
            >Retry</button>
          </div>
        ) : (
          <img
            key={imgKey}
            src={camera.feed}
            alt={camera.label}
            className="absolute inset-0 w-full h-full object-contain"
            onError={() => setImgError(true)}
          />
        )}
      </div>
    </div>
  )
}

export default function CamerasPage() {
  const [fullscreenId, setFullscreenId] = useState(null)

  const fullscreenCamera = fullscreenId ? CAMERAS.find(c => c.id === fullscreenId) : null

  return (
    <div className="h-full flex flex-col bg-brand-black overflow-hidden">

      {/* Page header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <div className="w-0.5 h-5 bg-brand-red" />
          <div>
            <h1 className="font-sans font-black text-white text-base tracking-wide uppercase">Live Cameras</h1>
            <p className="font-mono text-white/25 text-[8px] tracking-widest uppercase">
              {CAMERAS.length} feeds active · MJPEG stream
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
          {/* Feed takes all remaining space */}
          <div className="flex-1 min-w-0 min-h-0">
            <CameraFeed
              camera={fullscreenCamera}
              isFullscreen
              onExitFullscreen={() => setFullscreenId(null)}
            />
          </div>
          {/* PTZ only shown when surveillance camera is fullscreen */}
          {fullscreenCamera.hasPTZ && (
            <div className="flex-shrink-0 flex items-center">
              <PTZControl />
            </div>
          )}
        </div>
      ) : (
        /* ── DUAL VIEW — perfectly equal halves, NO PTZ panel ── */
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
