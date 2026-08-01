import { useRef, useState, useCallback } from 'react'

const API_BASE     = 'https://trovcamera.edgeforce.in'
const MOVE_DURATION = 800
const REPEAT_MS     = 600

export default function PTZControl() {
  const [activeOp, setActiveOp]   = useState(null)
  const [log, setLog]             = useState('Waiting for command…')
  const [status, setStatus]       = useState('READY')
  const [isError, setIsError]     = useState(false)
  const repeatRef = useRef(null)
  const activeRef = useRef(null)

  const setLogMsg = (msg, err = false) => { setLog(msg); setIsError(err) }
  const setStatusMsg = (msg, err = false) => { setStatus(msg); setIsError(err) }

  const apiMove = useCallback(async (operation, duration = MOVE_DURATION) => {
    try {
      const res  = await fetch(`${API_BASE}/api/ptz/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, duration }),
      })
      const data = await res.json()
      if (!data.success) {
        const isLimit =
          data.error?.includes('DT1021') ||
          data.error?.toLowerCase().includes('limit') ||
          data.error?.toLowerCase().includes('boundary')
        if (isLimit) {
          setLogMsg(`⚠ Limit — ${operation}`, false)
          setStatusMsg('AT LIMIT')
          stopMovement()
        } else {
          setLogMsg(`✗ ${data.error}`, true)
          setStatusMsg('ERROR', true)
          stopMovement()
        }
      }
    } catch {
      setLogMsg('✗ Backend unreachable', true)
      setStatusMsg('OFFLINE', true)
      stopMovement()
    }
  }, [])

  const apiStop = async () => {
    try { await fetch(`${API_BASE}/api/ptz/stop`, { method: 'POST' }) } catch {}
  }

  const stopMovement = useCallback(() => {
    if (repeatRef.current) { clearInterval(repeatRef.current); repeatRef.current = null }
    activeRef.current = null
    setActiveOp(null)
    apiStop()
    setLogMsg('Stopped')
    setStatusMsg('READY')
  }, [])

  const startMovement = useCallback((op) => {
    if (activeRef.current === op) return
    stopMovement()
    activeRef.current = op
    setActiveOp(op)
    setLogMsg(`→ ${op}…`)
    setStatusMsg(op)
    apiMove(op)
    repeatRef.current = setInterval(() => {
      if (activeRef.current) apiMove(activeRef.current)
    }, REPEAT_MS)
  }, [apiMove, stopMovement])

  const btnProps = (op) => ({
    onMouseDown:  (e) => { e.preventDefault(); startMovement(op) },
    onMouseUp:    () => stopMovement(),
    onMouseLeave: () => { if (activeRef.current === op) stopMovement() },
    onTouchStart: (e) => { e.preventDefault(); startMovement(op) },
    onTouchEnd:   (e) => { e.preventDefault(); stopMovement() },
    onTouchCancel:(e) => { e.preventDefault(); stopMovement() },
  })

  const DirBtn = ({ op, symbol, label }) => (
    <button
      {...btnProps(op)}
      className={`
        w-14 h-14 rounded flex flex-col items-center justify-center gap-1 select-none touch-none
        border transition-all duration-100 font-mono text-lg
        ${activeOp === op
          ? 'border-brand-red bg-brand-red/15 text-brand-red shadow-[0_0_16px_rgba(200,0,10,0.3)]'
          : 'border-brand-border bg-white/[0.02] text-white/40 hover:border-brand-red/50 hover:text-brand-red hover:bg-brand-red/5'}
      `}
    >
      {symbol}
      <span className={`text-[7px] tracking-widest uppercase transition-opacity duration-100 ${activeOp === op ? 'opacity-100' : 'opacity-0'}`}>
        {label}
      </span>
    </button>
  )

  return (
    <div className="bg-brand-card border border-brand-border p-4 flex flex-col gap-4 w-52">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[8px] tracking-[0.3em] text-white/30 uppercase">Camera</p>
          <p className="font-sans font-bold text-white text-sm tracking-wide">PTZ CONTROL</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[9px]
          ${isError
            ? 'border-brand-red/40 bg-brand-red/8 text-brand-red'
            : 'border-brand-red/20 bg-brand-red/5 text-brand-red'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isError ? 'bg-brand-red' : 'bg-brand-red animate-pulse-dot'}`} />
          {status}
        </div>
      </div>

      {/* Log */}
      <div className="bg-brand-black border border-brand-border rounded px-3 py-2 font-mono text-[10px] text-white/30 flex items-center gap-2 min-h-[30px] overflow-hidden">
        <span className="text-brand-red flex-shrink-0">›</span>
        <span className="truncate">{log}</span>
      </div>

      {/* D-Pad */}
      <div>
        <p className="font-mono text-[8px] tracking-[0.3em] text-white/25 uppercase mb-3">Pan & Tilt</p>
        <div className="flex flex-col items-center gap-1.5">
          {/* UP */}
          <div className="flex gap-1.5 justify-center">
            <div className="w-14 h-14" />
            <DirBtn op="UP"    symbol="▲" label="UP" />
            <div className="w-14 h-14" />
          </div>
          {/* LEFT · STOP · RIGHT */}
          <div className="flex gap-1.5 justify-center">
            <DirBtn op="LEFT"  symbol="◀" label="LEFT" />
            {/* STOP */}
            <button
              onClick={stopMovement}
              className="w-14 h-14 rounded border border-brand-border/60 bg-transparent text-white/20
                hover:border-brand-red/50 hover:bg-brand-red/8 hover:text-brand-red transition-all duration-100
                font-mono text-sm select-none"
            >■</button>
            <DirBtn op="RIGHT" symbol="▶" label="RIGHT" />
          </div>
          {/* DOWN */}
          <div className="flex gap-1.5 justify-center">
            <div className="w-14 h-14" />
            <DirBtn op="DOWN"  symbol="▼" label="DOWN" />
            <div className="w-14 h-14" />
          </div>
        </div>
      </div>

      <p className="font-mono text-[8px] tracking-widest text-white/15 uppercase text-center">
        Hold to move
      </p>
    </div>
  )
}
