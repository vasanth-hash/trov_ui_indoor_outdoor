/**
 * ScanOverlay — reusable LiDAR scan component
 *
 * Provides:
 *   1. useScan(subscribe, ready, robotPosRef)
 *      Hook that manages the /scan subscription.
 *      Returns { scanActive, scanPoints, scanPointsRef, toggleScan, pointCount }
 *
 *   2. ScanButton({ scanActive, toggleScan, pointCount, disabled })
 *      Small toggle button to drop in any header/toolbar.
 *
 *   3. drawScanPoints(ctx, scanPointsRef, toC, W, H)
 *      Pure canvas draw function — call this inside your RAF draw loop.
 *      Points are drawn in red (#C8000A) with a subtle glow.
 *
 * ── How to use in WaypointRecorder / WaypointFollower ────────────────────────
 *
 * STEP 1 — Import
 *   import { useScan, ScanButton, drawScanPoints } from '../components/ScanOverlay'
 *
 * STEP 2 — Add the hook inside your page component (needs subscribe, ready, robotPosRef)
 *   const { scanActive, scanPoints, scanPointsRef, toggleScan, pointCount } =
 *     useScan(subscribe, ready, robotPosRef)
 *
 * STEP 3 — Add the button wherever you want (header, panel, etc.)
 *   <ScanButton scanActive={scanActive} toggleScan={toggleScan}         pointCount={pointCount} disabled={!ready} />
 *
 * STEP 4 — In your canvas RAF draw loop, after drawing the map but before the robot:
 *   drawScanPoints(ctx, scanPointsRef, toC, W, H)
 *
 * STEP 5 — Pass scanPoints as a prop to your canvas component so the ref stays in sync:
 *   <YourMapCanvas ... scanPoints={scanPoints} />
 *   Inside RecorderMapCanvas, add:
 *     const scanPointsRef = useRef(scanPoints)
 *     useEffect(() => { scanPointsRef.current = scanPoints }, [scanPoints])
 *   Then call drawScanPoints(ctx, scanPointsRef, toC, W, H) in the draw function.
 *
 * NOTE: robotPosRef must be a ref (useRef) that always holds the latest robot
 * position {x, y, yaw} — this avoids stale closures in the scan callback.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

const SCAN_TOPIC = '/scan'
const SCAN_TYPE  = 'sensor_msgs/msg/LaserScan'

// ── Hook ──────────────────────────────────────────────────────────────────────
/**
 * useScan(subscribe, ready, robotPosRef)
 *
 * subscribe   — from useRosBridge
 * ready       — boolean, rosbridge connected
 * robotPosRef — useRef holding latest { x, y, yaw } robot position
 *
 * Returns:
 *   scanActive    boolean   — whether scan subscription is on
 *   scanPoints    array     — latest computed world-space points (for React state)
 *   scanPointsRef ref       — same data as a ref (for RAF canvas, zero lag)
 *   toggleScan    function  — toggle on/off
 *   pointCount    number    — current point count
 */
export function useScan(subscribe, ready, robotPosRef) {
  const [scanActive, setScanActive] = useState(false)
  const [scanPoints, setScanPoints] = useState([])
  const scanPointsRef = useRef([])

  // Keep ref in sync with state for canvas RAF
  useEffect(() => { scanPointsRef.current = scanPoints }, [scanPoints])

  useEffect(() => {
    if (!ready || !scanActive) {
      setScanPoints([])
      scanPointsRef.current = []
      return
    }

    const unsub = subscribe(SCAN_TOPIC, SCAN_TYPE, (msg) => {
      if (!msg) return
      const robot = robotPosRef.current
      if (!robot) return

      const { ranges, angle_min, angle_increment, range_min, range_max } = msg
      const pts = []
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i]
        if (r < range_min || r > range_max || !isFinite(r)) continue
        const angle = angle_min + i * angle_increment + (robot.yaw ?? 0)
        pts.push({
          x: robot.x + r * Math.cos(angle),
          y: robot.y + r * Math.sin(angle),
        })
      }
      // Write ref synchronously for zero-lag canvas, then schedule state update
      scanPointsRef.current = pts
      setScanPoints(pts)
    })

    return () => {
      unsub?.()
      setScanPoints([])
      scanPointsRef.current = []
    }
  }, [ready, scanActive, subscribe, robotPosRef])

  const toggleScan = useCallback(() => setScanActive(v => !v), [])

  return {
    scanActive,
    scanPoints,
    scanPointsRef,
    toggleScan,
    pointCount: scanPoints.length,
  }
}

// ── Canvas draw function ──────────────────────────────────────────────────────
/**
 * drawScanPoints(ctx, scanPointsRef, toC, W, H)
 *
 * Call this inside your RAF draw loop.
 * toC(wx, wy) — your world→canvas coordinate function
 * W, H        — canvas pixel dimensions
 */
export function drawScanPoints(ctx, scanPointsRef, toC, W, H) {
  const pts = scanPointsRef.current
  if (!pts || pts.length === 0) return

  ctx.save()

  // Outer glow pass — slightly larger, low opacity
  ctx.fillStyle = 'rgba(200, 0, 10, 0.25)'
  for (let i = 0; i < pts.length; i++) {
    const c = toC(pts[i].x, pts[i].y)
    if (c.x < -4 || c.x > W + 4 || c.y < -4 || c.y > H + 4) continue
    ctx.beginPath()
    ctx.arc(c.x, c.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  // Core dot pass — solid red
  ctx.fillStyle = '#C8000A'
  for (let i = 0; i < pts.length; i++) {
    const c = toC(pts[i].x, pts[i].y)
    if (c.x < -2 || c.x > W + 2 || c.y < -2 || c.y > H + 2) continue
    ctx.beginPath()
    ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ── Button component ──────────────────────────────────────────────────────────
/**
 * ScanButton({ scanActive, toggleScan, pointCount, disabled })
 * Drop this anywhere — header, toolbar, side panel.
 */
export function ScanButton({ scanActive, toggleScan, pointCount = 0, disabled = false }) {
  return (
    <button
      onClick={toggleScan}
      disabled={disabled}
      title={scanActive ? `LiDAR scan ON — ${pointCount} points · click to disable` : 'LiDAR scan OFF · click to enable'}
      className="flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[9px] tracking-widest uppercase transition-all duration-150"
      style={{
        borderColor: disabled
          ? 'rgba(255,255,255,0.07)'
          : scanActive
            ? 'rgba(200,0,10,0.6)'
            : 'rgba(255,255,255,0.12)',
        background: disabled
          ? 'transparent'
          : scanActive
            ? 'rgba(200,0,10,0.12)'
            : 'transparent',
        color: disabled
          ? 'rgba(255,255,255,0.15)'
          : scanActive
            ? '#C8000A'
            : 'rgba(255,255,255,0.35)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {/* Radar icon */}
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1" fill="none" />
        <circle cx="5.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6" />
        <circle cx="5.5" cy="5.5" r="0.8" fill="currentColor" />
        {scanActive && (
          <line x1="5.5" y1="5.5" x2="9.5" y2="2"
            stroke="currentColor" strokeWidth="1" strokeLinecap="round"
            style={{ transformOrigin: '5.5px 5.5px', animation: 'scan-sweep 2s linear infinite' }}
          />
        )}
      </svg>

      <span>Scan</span>

      {scanActive && (
        <>
          <span className="text-white/30">·</span>
          <span style={{ color: '#C8000A' }}>{pointCount}</span>
        </>
      )}

      {/* Pulsing dot when active */}
      {scanActive && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: '#C8000A', boxShadow: '0 0 5px #C8000A', animation: 'pulse 1.5s infinite' }}
        />
      )}

      <style>{`
        @keyframes scan-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  )
}

// ── Default export: all three together for convenience ────────────────────────
export default { useScan, ScanButton, drawScanPoints }




// integration in WaypointRecorder / WaypointFollower
// Step 1 — Import at the top of your page:
// jsimport { useScan, ScanButton, drawScanPoints } from '../components/ScanOverlay'
// Step 2 — Add the hook in your page component (you already have robotPosStateRef or robotPosRef — pass whichever ref holds the latest {x, y, yaw}):
// jsconst { scanActive, scanPoints, scanPointsRef, toggleScan, pointCount } = useScan(subscribe, ready, robotPosStateRef)
// Step 3 — Add the button in your header (next to your existing ROS badge):
// jsx<ScanButton scanActive={scanActive} toggleScan={toggleScan} pointCount={pointCount} disabled={!ready} />
// Step 4 — Pass scanPoints and scanPointsRef to your canvas component:
// jsx<RecorderMapCanvas
//   ...
//   scanPoints={scanPoints}
//   scanPointsRef={scanPointsRef}   {/* pass the ref directly */}
// />
// Inside RecorderMapCanvas, update the ref sync and draw call:
// js// In the props destructure:
// function RecorderMapCanvas({ ..., scanPoints, scanPointsRef }) {

// // Sync the ref when prop changes (if you passed state not the ref):
// useEffect(() => { scanPointsRef.current = scanPoints }, [scanPoints])

// // In the RAF draw function, after drawing the map tile, before drawing the robot:
// drawScanPoints(ctx, scanPointsRef, toC, W, H)
// That's all — no changes needed to the ROS subscription code, the hook handles everything.
