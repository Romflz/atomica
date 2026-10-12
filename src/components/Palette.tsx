import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { DEFS, makeAtom, PALETTE } from '../sim/atoms'
import type { AtomKind } from '../sim/types'
import { AtomIcon } from './AtomView'

const PREVIEW = Object.fromEntries(
  Object.keys(DEFS).map((k) => [k, makeAtom(k as AtomKind, 0, 0, 0, { on: true })]),
) as Record<AtomKind, ReturnType<typeof makeAtom>>

interface Props {
  panelRef: Ref<HTMLElement>
  dissolve: boolean
  onGrab: (kind: AtomKind, e: ReactPointerEvent) => void
}

export function Palette({ panelRef, dissolve, onGrab }: Props) {
  return (
    <aside ref={panelRef} className={`panel palette${dissolve ? ' dissolve' : ''}`}>
      <header className="panel-head">
        <span className="panel-title">Elements</span>
        <span className="panel-sub">drag onto the field</span>
      </header>
      <div className="palette-scroll">
        {PALETTE.map((group) => (
          <section key={group.title} className="palette-group">
            <h3>{group.title}</h3>
            <div className="palette-grid">
              {group.kinds.map((kind) => {
                const def = DEFS[kind]
                return (
                  <button
                    key={kind}
                    className="element-card"
                    style={{ ['--c' as string]: def.color }}
                    title={def.blurb}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      onGrab(kind, e)
                    }}
                  >
                    <span className="element-num">{String(def.number).padStart(2, '0')}</span>
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
