import { createContext, useContext, useEffect, useState, useCallback } from 'react'

// Same API base the rest of the app uses (SystemControl.jsx)
const API_BASE    = 'https://trovcamera.edgeforce.in'
const STORAGE_KEY = 'trov_environment'

const EnvironmentContext = createContext({
  environment: 'indoor',      // 'indoor' | 'outdoor'
  serviceStatus: null,        // 'active' | 'inactive' | ...
  switching: false,           // true while a switch is in flight
  ready: false,               // true once we've read the backend once
  switchEnvironment: async () => {},
  refresh: async () => {},
})

export function EnvironmentProvider({ children }) {
  // Optimistic initial value from localStorage so the UI doesn't flicker on load.
  // The backend is the real source of truth and reconciles it on mount (refresh).
  const [environment,   setEnvironment]   = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'indoor'
  )
  const [serviceStatus, setServiceStatus] = useState(null)
  const [switching,     setSwitching]     = useState(false)
  const [ready,         setReady]         = useState(false)

  // ── Read the active environment from the backend (authoritative) ──
  const refresh = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/environment`)
      const data = await res.json()
      if (data?.environment) {
        setEnvironment(data.environment)
        localStorage.setItem(STORAGE_KEY, data.environment)
      }
      if (data?.service_status !== undefined) setServiceStatus(data.service_status)
    } catch (e) {
      // API unreachable — keep the optimistic localStorage value
      console.warn('[Environment] could not read /api/environment:', e.message)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // ── Switch modes: backend stops the other stack and starts the target ──
  const switchEnvironment = useCallback(async (target) => {
    if (target !== 'indoor' && target !== 'outdoor')
      return { ok: false, error: 'invalid environment' }
    if (target === environment)
      return { ok: true, unchanged: true }

    setSwitching(true)
    try {
      const res = await fetch(`${API_BASE}/api/environment/switch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ environment: target }),
      })
      const data = await res.json()
      if (res.ok && data?.environment) {
        setEnvironment(data.environment)
        localStorage.setItem(STORAGE_KEY, data.environment)
        return { ok: true, data }
      }
      return { ok: false, error: data?.error || 'switch failed' }
    } catch (e) {
      return { ok: false, error: e.message }
    } finally {
      setSwitching(false)
    }
  }, [environment])

  return (
    <EnvironmentContext.Provider
      value={{ environment, serviceStatus, switching, ready, switchEnvironment, refresh }}
    >
      {children}
    </EnvironmentContext.Provider>
  )
}

export const useEnvironment = () => useContext(EnvironmentContext)
