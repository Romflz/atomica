import { useState } from 'react'
import { Icon } from './Icon'
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
  onClose: () => void
  panelRef: Ref<HTMLElement>
  dissolve: boolean
  limits: PartLimits | null
  onGrab: (kind: AtomKind, e: ReactPointerEvent) => void
}

export function Palette({ onClose, panelRef, dissolve, limits, onGrab }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  // A challenge offers only its own parts, in palette order.
  const groups = limits ? PALETTE.map((g) => ({ ...g, kinds: g.kinds.filter((k) => (limits.budget[k] ?? 0) > 0) })).filter((g) => g.kinds.length) : PALETTE
  const visible = groups.filter((g) => category === 'All' || g.title === category).map((g) => ({ ...g, kinds: g.kinds.filter((k) => `${DEFS[k].name} ${DEFS[k].caption} ${DEFS[k].blurb}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((g) => g.kinds.length)
  const count = groups.reduce((n, g) => n + g.kinds.length, 0)
  return (
    <aside ref={panelRef} className={`panel palette${dissolve ? ' dissolve' : ''}`}>
      <header className="panel-head">
        <div className="panel-heading"><span className="panel-title">{limits ? 'Your parts' : 'Elements'} <span className="count-badge">{count}</span></span><button className="btn icon-btn panel-close" onClick={onClose} aria-label="Close elements panel"><Icon name="left" size={15} /></button></div>
        <span className="panel-sub">{limits ? 'Your toolkit for this challenge' : 'Small pieces. Endless possibilities.'}</span>
      </header>
      <div className="palette-tools">
        <div className="search-box"><Icon name="search" size={15} /><input aria-label="Search elements" placeholder="Find an element…" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={13} /></button>}</div>
        <select aria-label="Element category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="All">All categories</option>{PALETTE.map((g) => <option key={g.title}>{g.title}</option>)}</select>
      </div>
      <div className="palette-scroll">
        {limits && !groups.length && <p className="palette-empty">No parts in this one. Turn the pieces marked ↻ instead: R or right-click, and Shift to turn back.</p>}
        {!visible.length && !!groups.length && <div className="palette-empty"><b>No elements found</b><p>Try another name or category.</p><button className="btn" onClick={() => { setQuery(''); setCategory('All') }}>Reset filters</button></div>}
        {visible.map((group) => (
          <section key={group.title} className="palette-group">
            <h3>{group.title}<span>{group.kinds.length}</span></h3>
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
      <footer className="panel-footer"><span className="drag-dot">⠿</span> Drag an element onto the field</footer>
      <div className="dissolve-zone">
        <span>Release to dissolve</span>
      </div>
    </aside>
  )
}
