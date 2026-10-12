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
  kind: 'project' | 'error'
  title: string
  detail: string
  icon: AtomKind
}

const LABEL: Record<Toast['kind'], string> = { project: 'PROJECT', error: 'COULD NOT OPEN' }

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} style={{ ['--c' as string]: t.kind === 'error' ? '#ff3b5c' : DEFS[t.icon].color }}>
          <AtomIcon atom={iconAtom(t.icon)} size={44} />
          <div>
            <small>{LABEL[t.kind]}</small>
            <b>{t.title}</b>
            <span>{t.detail}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
