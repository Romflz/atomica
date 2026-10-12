import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { DEFS, makeAtom, PALETTE } from '../sim/atoms'
import type { AtomKind } from '../sim/types'
import { AtomIcon } from './AtomView'

const PREVIEW = Object.fromEntries(
  Object.keys(DEFS).map((k) => [k, makeAtom(k as AtomKind, 0, 0, 0, { on: true })]),
) as Record<AtomKind, ReturnType<typeof makeAtom>>

/** In a challenge, the parts on offer and how many of each are left. */
export interface PartLimits {
  budget: Partial<Record<AtomKind, number>>
  used: Partial<Record<AtomKind, number>>
}

interface Props {
  panelRef: Ref<HTMLElement>
  dissolve: boolean
  limits: PartLimits | null
  onGrab: (kind: AtomKind, e: ReactPointerEvent) => void
}

export function Palette({ panelRef, dissolve, limits, onGrab }: Props) {
  // A challenge offers only its own parts, in palette order.
  const groups = limits ? PALETTE.map((g) => ({ ...g, kinds: g.kinds.filter((k) => (limits.budget[k] ?? 0) > 0) })).filter((g) => g.kinds.length) : PALETTE
  return (
    <aside ref={panelRef} className={`panel palette${dissolve ? ' dissolve' : ''}`}>
      <header className="panel-head">
        <span className="panel-title">{limits ? 'Your parts' : 'Elements'}</span>
        <span className="panel-sub">{limits ? 'this challenge allows only these' : 'drag onto the field'}</span>
      </header>
      <div className="palette-scroll">
        {limits && !groups.length && <p className="palette-empty">No parts in this one. Turn the pieces marked ↻ instead: R or right-click, and Shift to turn back.</p>}
        {groups.map((group) => (
          <section key={group.title} className="palette-group">
            <h3>{group.title}</h3>
            <div className="palette-grid">
              {group.kinds.map((kind) => {
                const def = DEFS[kind]
                const left = limits ? Math.max(0, (limits.budget[kind] ?? 0) - (limits.used[kind] ?? 0)) : null
                return (
                  <button
                    key={kind}
                    className={`element-card${left === 0 ? ' spent' : ''}`}
                    style={{ ['--c' as string]: def.color }}
                    title={def.blurb}
                    disabled={left === 0}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      if (left !== 0) onGrab(kind, e)
                    }}
                  >
                    {left === null ? <span className="element-num">{String(def.number).padStart(2, '0')}</span> : <span className="element-left">×{left}</span>}
                    <AtomIcon atom={PREVIEW[kind]} size={50} />
                    <span className="element-name">{def.name}</span>
                    <span className="element-cap">{def.caption}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="dissolve-zone">
        <span>Release to dissolve</span>
      </div>
    </aside>
  )
}
