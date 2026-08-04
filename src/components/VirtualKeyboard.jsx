import { useEffect, useState, useRef } from 'react'

// ── Config ───────────────────────────────────────────────────────────────────
// Flip to true while debugging: logs every focus event to the console so you
// can see WHICH element got focus (tag/type) — useful when the keyboard won't
// appear (e.g. the field is a contentEditable div, not a real <input>).
const DEBUG = false

// On a touchscreen kiosk, tag the focused field with inputmode="none" so the
// OS/native on-screen keyboard does NOT also pop up. Harmless on machines that
// have no native keyboard, and it never blocks a physical keyboard.
const SUPPRESS_NATIVE = true

// ── Layouts ──────────────────────────────────────────────────────────────────
const NUMS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

const LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

const SYMBOLS = [
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  ['~', '`', '=', '+', '[', ']', '{', '}', '\\', '|'],
  [';', ':', '\'', '"', ',', '<', '>', '?'],
]

// Editable-element test — covers inputs, textareas AND contentEditable nodes.
function isEditable(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase()
    // Skip inputs that don't take free text (or that our layout can't serve).
    return !['range', 'checkbox', 'radio', 'color', 'file', 'button',
             'submit', 'reset', 'image', 'number'].includes(t)
  }
  if (tag === 'TEXTAREA') return true
  if (el.isContentEditable) return true
  return false
}

// ── Single key ───────────────────────────────────────────────────────────────
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

// A blank slot used to keep rows aligned (e.g. left of the symbols bottom row).
function Spacer({ flex }) {
  return <div style={{ flex: flex || 1 }} />
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
export default function GlobalVirtualKeyboard() {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const [layer, setLayer] = useState('letters') // 'letters' | 'symbols'
  const activeInputRef = useRef(null)

  useEffect(() => {
    const onFocus = (e) => {
      const el = e.target
      if (DEBUG) console.log('[VKB] focusin →', el.tagName, el.type, el)
      if (!isEditable(el)) return
      activeInputRef.current = el
      if (SUPPRESS_NATIVE && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        el.setAttribute('inputmode', 'none')
      }
      setVisible(true)
    }
    const onBlur = (e) => {
      if (!isEditable(e.target)) return
      // Delay so focus can move between fields without flickering the keyboard.
      setTimeout(() => {
        const ae = document.activeElement
        if (isEditable(ae)) {
          activeInputRef.current = ae
        } else {
          setVisible(false)
          activeInputRef.current = null
        }
      }, 150)
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
    }
  }, [])

  // Insert text at the caret of the focused field (input/textarea or CE div).
  const typeInto = (char) => {
    const el = activeInputRef.current
    if (!el) return
    if (el.isContentEditable) {
      el.focus()
      document.execCommand('insertText', false, char)
      return
    }
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
    if (el.isContentEditable) {
      el.focus()
      document.execCommand('delete')
      return
    }
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
    switch (key) {
      case 'CAPS':      setCaps(c => !c); return
      case 'LAYER':     setLayer(l => (l === 'letters' ? 'symbols' : 'letters')); return
      case 'BACKSPACE': backspace(); return
      case 'SPACE':     typeInto(' '); return
      case 'ENTER':     pressEnter(); return
      case 'CLOSE':     setVisible(false); activeInputRef.current?.blur(); return
      default:          typeInto(caps && layer === 'letters' ? key.toUpperCase() : key)
    }
  }

  if (!visible) return null

  const rows = layer === 'letters' ? LETTERS : SYMBOLS
  const rowStyle = { display: 'flex', gap: 5, marginBottom: 5, justifyContent: 'center' }

  return (
    <div
      onPointerDown={e => e.preventDefault()}
      style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        zIndex: 999999,
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

      {/* Number row (always visible in both layers) */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
        {NUMS.map(k => <Key key={k} label={k} onPress={() => press(k)} />)}
      </div>

      {/* First two content rows */}
      {rows.slice(0, 2).map((row, ri) => (
        <div key={`r${ri}`} style={rowStyle}>
          {row.map(k => (
            <Key
              key={k}
              label={caps && layer === 'letters' ? k.toUpperCase() : k}
              onPress={() => press(k)}
            />
          ))}
        </div>
      ))}

      {/* Third content row — CAPS (letters) / spacer (symbols) … keys … BACKSPACE */}
      <div style={rowStyle}>
        {layer === 'letters'
          ? <Key label="CAPS" onPress={() => press('CAPS')} flex={1.6} active={caps} />
          : <Spacer flex={1.6} />}
        {rows[2].map(k => (
          <Key
            key={k}
            label={caps && layer === 'letters' ? k.toUpperCase() : k}
            onPress={() => press(k)}
          />
        ))}
        <Key label="⌫" onPress={() => press('BACKSPACE')} flex={1.6} />
      </div>

      {/* Function row — layer toggle, quick filename chars, space, enter */}
      <div style={{ display: 'flex', gap: 5 }}>
        <Key
          label={layer === 'letters' ? '?123' : 'ABC'}
          onPress={() => press('LAYER')}
          flex={1.8}
          accent
        />
        <Key label="." onPress={() => press('.')} flex={1} />
        <Key label="/" onPress={() => press('/')} flex={1} />
        <Key label="SPACE" onPress={() => press('SPACE')} flex={4} />
        <Key label="-" onPress={() => press('-')} flex={1} />
        <Key label="_" onPress={() => press('_')} flex={1} />
        <Key label="ENTER" onPress={() => press('ENTER')} flex={2} accent />
      </div>
    </div>
  )
}