import { useEffect, useState, useRef } from 'react'

const ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
]

const NUMS = ['1','2','3','4','5','6','7','8','9','0','-','_']

function Key({ label, onPress, flex, active, accent }) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      onPointerDown={e => { e.preventDefault(); setPressed(true); onPress() }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        flex: flex || 1,
        height: 48,
        background: pressed
          ? 'rgba(255,255,255,0.25)'
          : active
          ? 'rgba(200,0,10,0.25)'
          : accent
          ? 'rgba(200,0,10,0.15)'
          : 'rgba(255,255,255,0.09)',
        border: `1px solid ${accent ? 'rgba(200,0,10,0.5)' : active ? 'rgba(200,0,10,0.5)' : 'rgba(255,255,255,0.14)'}`,
        color: accent ? '#ff5757' : active ? '#ff5757' : 'rgba(255,255,255,0.85)',
        fontFamily: 'monospace',
        fontSize: label.length > 3 ? 9 : 16,
        fontWeight: label.length <= 1 ? 500 : 400,
        letterSpacing: label.length > 3 ? '0.06em' : 0,
        cursor: 'pointer',
        borderRadius: 4,
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        transition: 'background 0.05s',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  )
}

export default function GlobalVirtualKeyboard() {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const activeInputRef = useRef(null)

  useEffect(() => {
    const onFocus = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        const type = e.target.type
        if (type === 'range' || type === 'checkbox' || type === 'radio' || type === 'number') return
        activeInputRef.current = e.target
        setVisible(true)
      }
    }
    const onBlur = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        setTimeout(() => {
          if (
            document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA'
          ) {
            setVisible(false)
            activeInputRef.current = null
          } else {
            activeInputRef.current = document.activeElement
          }
        }, 150)
      }
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
    }
  }, [])

  const typeInto = (char) => {
    const el = activeInputRef.current
    if (!el) return
    const nativeSetter =
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    if (nativeSetter) {
      const start = el.selectionStart ?? el.value.length
      const end   = el.selectionEnd   ?? el.value.length
      const newVal = el.value.slice(0, start) + char + el.value.slice(end)
      nativeSetter.call(el, newVal)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.selectionStart = el.selectionEnd = start + char.length
    }
    el.focus()
  }

  const backspace = () => {
    const el = activeInputRef.current
    if (!el) return
    const nativeSetter =
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    if (nativeSetter) {
      const start = el.selectionStart ?? el.value.length
      const end   = el.selectionEnd   ?? el.value.length
      let newVal, newCursor
      if (start !== end) {
        newVal = el.value.slice(0, start) + el.value.slice(end)
        newCursor = start
      } else if (start > 0) {
        newVal = el.value.slice(0, start - 1) + el.value.slice(start)
        newCursor = start - 1
      } else return
      nativeSetter.call(el, newVal)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.selectionStart = el.selectionEnd = newCursor
    }
    el.focus()
  }

  const pressEnter = () => {
    const el = activeInputRef.current
    if (!el) return
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    setVisible(false)
    activeInputRef.current = null
  }

  const press = (key) => {
    if (key === 'CAPS')      { setCaps(c => !c); return }
    if (key === 'BACKSPACE') { backspace(); return }
    if (key === 'SPACE')     { typeInto(' '); return }
    if (key === 'ENTER')     { pressEnter(); return }
    if (key === 'CLOSE')     { setVisible(false); activeInputRef.current?.blur(); return }
    typeInto(caps ? key.toUpperCase() : key)
  }

  if (!visible) return null

  return (
    <div
      onPointerDown={e => e.preventDefault()}
      style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        zIndex: 99999,
        background: '#0d0d0d',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '6px 8px 10px',
        userSelect: 'none',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
      }}
    >
      {/* Close row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}>
        <button
          onPointerDown={e => { e.preventDefault(); press('CLOSE') }}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.45)',
            fontFamily: 'monospace', fontSize: 9,
            letterSpacing: '0.15em',
            padding: '3px 12px',
            cursor: 'pointer', borderRadius: 3,
          }}
        >
          CLOSE ✕
        </button>
      </div>

      {/* Number row */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
        {NUMS.map(k => <Key key={k} label={k} onPress={() => press(k)} />)}
      </div>

      {/* Letter rows */}
      {ROWS.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 5, marginBottom: 5, justifyContent: 'center' }}>
          {row.map(k => (
            <Key key={k} label={caps ? k.toUpperCase() : k} onPress={() => press(k)} />
          ))}
        </div>
      ))}

      {/* Bottom row */}
      <div style={{ display: 'flex', gap: 5 }}>
        <Key label="CAPS" onPress={() => press('CAPS')} flex={1.5} active={caps} />
        <Key label="SPACE" onPress={() => press('SPACE')} flex={5} />
        <Key label="⌫" onPress={() => press('BACKSPACE')} flex={1.5} />
        <Key label="ENTER" onPress={() => press('ENTER')} flex={2} accent />
      </div>
    </div>
  )
}
