import { useEffect } from 'react'
import { DISCOVERIES, levelOf, TOTAL_XP } from '../game/progress'
import type { Discovery, Progress } from '../game/progress'
import { DEFS, makeAtom } from '../sim/atoms'
import type { AtomKind } from '../sim/types'
import { AtomIcon } from './AtomView'

const ICONS = new Map<AtomKind, ReturnType<typeof makeAtom>>()
const iconAtom = (kind: AtomKind) => {
  if (!ICONS.has(kind)) ICONS.set(kind, makeAtom(kind, 0, 0, 0, { on: true, out: true }))
  return ICONS.get(kind)!
}

export interface Toast {
  id: number
  kind: 'discovery' | 'level' | 'project' | 'error'
  title: string
  detail: string
  icon: AtomKind
}

export function LevelBadge({ xp, onOpen }: { xp: number; onOpen: () => void }) {
  const lv = levelOf(xp)
  return (
    <button className="level-badge" onClick={onOpen} title="Open the Codex (C)">
      <span className="level-num">
        <small>LV</small>
        {lv.level}
      </span>
      <span className="level-body">
        <span className="level-title">{lv.title}</span>
        <span className="xp-bar">
          <i style={{ width: `${(lv.into / lv.need) * 100}%` }} />
        </span>
        <span className="xp-text">
          {lv.into} / {lv.need} XP
        </span>
      </span>
    </button>
  )
}

const TOAST_LABEL: Record<Toast['kind'], string> = { discovery: 'DISCOVERY', level: 'LEVEL UP', project: 'PROJECT', error: 'COULD NOT OPEN' }

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} style={{ ['--c' as string]: t.kind === 'error' ? '#ff3b5c' : DEFS[t.icon].color }}>
          <AtomIcon atom={iconAtom(t.icon)} size={44} />
          <div>
            <small>{TOAST_LABEL[t.kind]}</small>
            <b>{t.title}</b>
            <span>{t.detail}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

interface CodexProps {
  progress: Progress
  meter: (d: Discovery) => [number, number] | null
  sandbox: boolean
  onClose: () => void
  onReset: () => void
}

export function Codex({ progress, meter, sandbox, onClose, onReset }: CodexProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lv = levelOf(progress.xp)
  const got = DISCOVERIES.filter((d) => progress.unlocked[d.id]).length
  const tiers = [...new Set(DISCOVERIES.map((d) => d.tier))]

  return (
    <div className="codex-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="codex" role="dialog" aria-label="Codex">
        <header className="codex-head">
          <div>
            <span className="panel-title">Codex</span>
            <h2>
              Level {lv.level} · {lv.title}
            </h2>
            <div className="xp-bar big">
              <i style={{ width: `${(lv.into / lv.need) * 100}%` }} />
            </div>
            <p className="muted small">
              {progress.xp} XP earned of {TOTAL_XP} · {got}/{DISCOVERIES.length} discoveries
            </p>
          </div>
          <button className="btn" onClick={onClose}>
            ✕ Close <kbd>Esc</kbd>
          </button>
        </header>
        {!sandbox && (
          <p className="codex-note">
            You are watching a preset. Most discoveries only count in your own sandbox: load <b>Empty Field</b> or
            <b> Primordial Soup</b>, or keep building on a saved world.
          </p>
        )}
        <div className="codex-scroll">
          {tiers.map((tier) => (
            <section key={tier}>
              <h3>{tier}</h3>
              <div className="codex-grid">
                {DISCOVERIES.filter((d) => d.tier === tier).map((d) => {
                  const done = !!progress.unlocked[d.id]
                  // Presets don't count toward sandbox discoveries, so don't show their progress there.
                  const m = done || (d.sandbox && !sandbox) ? null : meter(d)
                  return (
                    <div key={d.id} className={`discovery${done ? ' done' : ''}`} style={{ ['--c' as string]: DEFS[d.icon].color }}>
                      <div className="discovery-icon">
                        <AtomIcon atom={iconAtom(d.icon)} size={46} />
                      </div>
                      <div className="discovery-text">
                        <b>{d.name}</b>
                        <span>{d.desc}</span>
                        {m && (
                          <span className="meter">
                            <i style={{ width: `${(m[0] / m[1]) * 100}%` }} />
                            <em>
                              {m[0]}/{m[1]}
                            </em>
                          </span>
                        )}
                      </div>
                      <span className="discovery-xp">{done ? '✓' : `+${d.xp}`}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
        <footer className="codex-foot">
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm('Reset all XP and discoveries?')) onReset()
            }}
          >
            Reset progress
          </button>
        </footer>
      </div>
    </div>
  )
}
