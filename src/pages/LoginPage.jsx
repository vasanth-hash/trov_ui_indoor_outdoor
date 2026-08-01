import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const [vehicleId, setVehicleId]   = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [focused, setFocused]       = useState(null)
  const { login } = useAuth()
  const navigate  = useNavigate()

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    setTimeout(() => {
      const ok = login(vehicleId, password)
      if (ok) {
        navigate('/navigation')
      } else {
        setError('INVALID VEHICLE ID OR PASSWORD')
        setLoading(false)
      }
    }, 900)
  }

  return (
    <div className="min-h-screen w-full flex bg-brand-black overflow-hidden">
      {/* ── LEFT ── */}
      <div className="relative flex-1 bg-brand-red flex flex-col justify-between overflow-hidden">
        {/* Grid */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,0,0,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.15) 1px,transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle,rgba(255,255,255,0.18) 1.5px,transparent 1.5px)',
            backgroundSize: '60px 60px',
          }}
        />

        {/* Top bar */}
        <div className="relative z-10 flex items-start justify-between px-10 pt-10">
          <div>
            <p className="text-white/50 font-mono text-[10px] tracking-[0.3em] uppercase">EdgeForce · UGV Platform</p>
            <p className="text-white/30 font-mono text-[10px] tracking-widest uppercase mt-0.5">Mission Control v2.1</p>
          </div>
          <div className="text-right text-white/40 font-mono text-[10px] tracking-widest uppercase leading-relaxed">
            Robotics<br />×<br />Defense
          </div>
        </div>

        {/* Vehicle image */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center pointer-events-none">
          <img
           src="/trov.png" 

            alt="T-ROV"
            className="w-full max-w-[620px] object-contain select-none"
            style={{
              filter: 'drop-shadow(0 -20px 60px rgba(0,0,0,0.6)) brightness(0.82) contrast(1.1)',
              transform: 'translateY(4%)',
            }}
            draggable={false}
          />
        </div>

        {/* Bottom text */}
        <div className="relative z-10 px-10 pb-10">
          <h1 className="text-white font-sans font-black leading-none tracking-tighter"
            style={{ fontSize: 'clamp(48px,6vw,80px)' }}>T-ROV</h1>
          <p className="text-white/80 font-mono uppercase tracking-[0.12em] text-[11px] mt-1">
            Terra · Remotely Operated Vehicle
          </p>

          <div className="w-10 h-[2px] bg-white/30 my-5" />

          <p className="text-white/65 font-mono text-[11px] leading-relaxed max-w-[400px]">
            The T-ROV is a rugged, medium-class 4×4 Unmanned Ground Vehicle (UGV)
            engineered for high-stakes industrial surveillance, autonomous logistics,
            and research. Featuring a fully indigenous autonomous stack and high-torque
            PMSM powertrain, the T-ROV delivers reliable performance in unstructured environments.
          </p>

          <div className="mt-8 flex gap-8 text-white/30 font-mono text-[9px] tracking-widest uppercase">
            <span>4×4 Drive</span>
            <span>PMSM Powertrain</span>
            <span>Autonomous Stack</span>
          </div>
        </div>
      </div>

      {/* ── RIGHT ── */}
      <div className="w-[400px] flex-shrink-0 bg-brand-dark flex flex-col justify-center px-12 relative border-l border-brand-border">
        {/* Corner accents */}
        <div className="absolute top-0 right-0 w-14 h-14 border-r border-t border-brand-red/40" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-l border-b border-brand-red/20" />

        <div className="absolute top-8 left-12 font-mono text-brand-red text-[10px] tracking-[0.3em] uppercase">
          EdgeForce
        </div>

        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-4 h-[2px] bg-brand-red" />
            <span className="font-mono text-brand-red text-[10px] tracking-[0.3em] uppercase">Operator Access</span>
          </div>

          <h2 className="text-white font-sans font-black text-3xl tracking-tight mb-1">SYSTEM LOGIN</h2>
          <p className="font-mono text-white/25 text-[10px] tracking-widest uppercase mb-10">Authenticated Access Only</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            {/* Vehicle ID */}
            <div>
              <label className="block font-mono text-[10px] tracking-[0.25em] uppercase mb-2"
                style={{ color: focused === 'vid' ? '#C8000A' : 'rgba(255,255,255,0.35)' }}>
                Vehicle ID
              </label>
              <input
                type="text"
                value={vehicleId}
                onChange={e => setVehicleId(e.target.value)}
                onFocus={() => setFocused('vid')}
                onBlur={() => setFocused(null)}
                placeholder="EF-TROV-XXXX"
                className="w-full bg-transparent border-b py-2.5 text-white text-sm outline-none placeholder:opacity-20 transition-all duration-200 font-mono"
                style={{
                  borderColor: focused === 'vid' ? '#C8000A' : 'rgba(255,255,255,0.12)',
                  letterSpacing: '0.08em',
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block font-mono text-[10px] tracking-[0.25em] uppercase mb-2"
                style={{ color: focused === 'pw' ? '#C8000A' : 'rgba(255,255,255,0.35)' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused('pw')}
                onBlur={() => setFocused(null)}
                placeholder="••••••••"
                className="w-full bg-transparent border-b py-2.5 text-white text-sm outline-none placeholder:opacity-20 transition-all duration-200 font-mono"
                style={{
                  borderColor: focused === 'pw' ? '#C8000A' : 'rgba(255,255,255,0.12)',
                  letterSpacing: '0.15em',
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <p className="font-mono text-[10px] tracking-widest text-brand-red bg-brand-red/10 border border-brand-red/30 px-3 py-2 animate-fade-in">
                ✗ {error}
              </p>
            )}

            {/* Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 font-mono text-[11px] tracking-[0.3em] uppercase font-bold transition-all duration-200 mt-2"
              style={{
                background: loading ? 'transparent' : '#C8000A',
                border: '1px solid #C8000A',
                color: loading ? '#C8000A' : '#fff',
                cursor: loading ? 'default' : 'pointer',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin inline-block w-3 h-3 border border-brand-red border-t-transparent rounded-full" />
                  Authenticating...
                </span>
              ) : 'Authorize & Connect'}
            </button>

            <button type="button"
              className="font-mono text-[10px] tracking-[0.2em] uppercase text-white/20 hover:text-white/50 transition-colors self-center bg-transparent border-none cursor-pointer">
              Forgot Credentials?
            </button>
          </form>
        </div>

        {/* Status footer */}
        <div className="absolute bottom-8 left-12 right-12">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
            <span className="font-mono text-green-400 text-[9px] tracking-widest uppercase">System Online</span>
          </div>
          <div className="w-full h-px bg-white/5" />
          <p className="mt-2 font-mono text-white/10 text-[9px] tracking-widest uppercase">
            © 2025 EdgeForce Technologies · edgeforce.in
          </p>
        </div>
      </div>
    </div>
  )
}
