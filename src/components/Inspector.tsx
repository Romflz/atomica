import { CHANNEL_COLORS, DEFS, isForce, SIGNAL } from '../sim/atoms'
import { canonSide } from '../sim/engine'
import type { Graph } from '../sim/engine'
import { SIDE_NAMES } from '../sim/hex'
import type { Atom, AtomKind } from '../sim/types'
import { AtomIcon } from './AtomView'

interface Props {
  atom: Atom | null
  graph: Graph
  onPatch: (id: string, patch: Partial<Atom>) => void
  onRotate: (id: string) => void
  onDelete: (id: string) => void
  onPinMolecule: (id: string, pinned: boolean) => void
}

const PORT_LABEL = { in: 'slot', out: 'tab', io: 'socket', grip: 'grip' } as const

function stateOf(a: Atom): string {
  switch (a.kind) {
    case 'lumen':
      return a.out ? 'LIT' : 'DARK'
    case 'magnetar':
    case 'repulsar':
      return a.out ? 'FIELD ACTIVE' : 'FIELD DORMANT'
    case 'clasp':
      return a.out ? 'RELEASED' : 'GRIPPING'
    case 'mnemon':
      return `STORED ${a.mem ? 1 : 0}`
    case 'oculus':
      return a.out ? 'TARGET SEEN' : 'SCANNING'
    case 'devourer':
      return a.out ? 'FEEDING' : 'DORMANT'
    case 'propulsor':
      return a.out ? 'THRUSTING' : 'IDLE'
    case 'gyron':
    case 'fabricator':
      return a.out ? 'PULSE' : 'WAITING'
    case 'entangler':
      return a.out ? 'RECEIVING' : a.mem ? 'TRANSMITTING' : 'SILENT'
    default:
      return a.out ? 'CHARGED' : 'IDLE'
  }
}

export function Inspector({ atom, graph, onPatch, onRotate, onDelete, onPinMolecule }: Props) {
  return (
    <aside className="panel inspector">
      <header className="panel-head">
        <span className="panel-title">{atom ? 'Inspector' : 'Field Guide'}</span>
        <span className="panel-sub">{atom ? DEFS[atom.kind].category : 'how matter behaves here'}</span>
      </header>
      <div className="inspector-scroll">{atom ? <AtomDetails atom={atom} graph={graph} {...{ onPatch, onRotate, onDelete, onPinMolecule }} /> : <FieldGuide />}</div>
    </aside>
  )
}

function AtomDetails({ atom, graph, onPatch, onRotate, onDelete, onPinMolecule }: Props & { atom: Atom }) {
  const def = DEFS[atom.kind]
  const links = graph.links.get(atom.id) ?? []
  const molIndex = graph.molOf.get(atom.id)
  const mol = molIndex === undefined ? [atom.id] : graph.molecules[molIndex]
  const molAtoms = mol.map((id) => graph.byId.get(id)!).filter(Boolean)
  const molPinned = molAtoms.some((a) => a.pinned)
  const counts = new Map<AtomKind, number>()
  for (const a of molAtoms) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1)

  const stateLabel = stateOf(atom)

  return (
    <div className="details" style={{ ['--c' as string]: def.color }}>
      <div className="hero">
        <div className="hero-icon">
          <AtomIcon atom={atom} size={104} />
        </div>
        <div className="hero-text">
          <div className="hero-num">No. {String(def.number).padStart(2, '0')}</div>
          <h2>
            {def.name} <span className="hero-sym">{def.symbol}</span>
          </h2>
          <div className={`state-pill${atom.out ? ' on' : ''}`}>
            <i /> {stateLabel}
          </div>
        </div>
      </div>

      <p className="blurb">{def.blurb}</p>

      <div className="btn-row">
        <button className="btn" onClick={() => onRotate(atom.id)}>
          ⟳ Rotate <kbd>R</kbd>
        </button>
        <button className={`btn${atom.pinned ? ' active' : ''}`} onClick={() => onPatch(atom.id, { pinned: !atom.pinned })}>
          ◉ {atom.pinned ? 'Pinned' : 'Pin'} <kbd>P</kbd>
        </button>
        <button className="btn danger" onClick={() => onDelete(atom.id)}>
          ✕ <kbd>Del</kbd>
        </button>
      </div>

      {atom.kind === 'spark' && (
        <button className={`btn wide toggle-btn${atom.on ? ' active' : ''}`} onClick={() => onPatch(atom.id, { on: !atom.on, out: !atom.on })}>
          {atom.on ? 'Switch OFF' : 'Switch ON'}
        </button>
      )}
      {atom.kind === 'pulsar' && (
        <label className="slider">
          <span>
            Period <b>{atom.period ?? 8} ticks</b>
          </span>
          <input type="range" min={2} max={32} step={2} value={atom.period ?? 8} onChange={(e) => onPatch(atom.id, { period: +e.target.value })} />
        </label>
      )}
      {isForce(atom.kind) && (
        <label className="slider">
          <span>
            Field radius <b>{atom.radius ?? 5} cells</b>
          </span>
          <input type="range" min={2} max={10} value={atom.radius ?? 5} onChange={(e) => onPatch(atom.id, { radius: +e.target.value })} />
        </label>
      )}
      {atom.kind === 'oculus' && (
        <label className="slider">
          <span>
            Sight range <b>{atom.radius ?? 4} cells</b>
          </span>
          <input type="range" min={1} max={8} value={atom.radius ?? 4} onChange={(e) => onPatch(atom.id, { radius: +e.target.value })} />
        </label>
      )}
      {atom.kind === 'chronon' && (
        <label className="slider">
          <span>
            Delay <b>{atom.delay ?? 4} ticks</b>
          </span>
          <input type="range" min={1} max={16} value={atom.delay ?? 4} onChange={(e) => onPatch(atom.id, { delay: +e.target.value, mem: 0 })} />
        </label>
      )}
      {atom.kind === 'quanta' && (
        <label className="slider">
          <span>
            Fire chance <b>{Math.round((atom.chance ?? 0.5) * 100)}%</b>
          </span>
          <input type="range" min={0} max={1} step={0.01} value={atom.chance ?? 0.5} onChange={(e) => onPatch(atom.id, { chance: +e.target.value })} />
        </label>
      )}
      {atom.kind === 'entangler' && (
        <div className="slider">
          <span>Channel</span>
          <div className="seg channels">
            {CHANNEL_COLORS.map((c, i) => (
              <button key={c} className={(atom.channel ?? 0) === i ? 'on' : ''} style={{ ['--ch' as string]: c }} onClick={() => onPatch(atom.id, { channel: i })}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="card">
        <h4>Ports</h4>
        <div className="compass">
          {[0, 1, 2, 3, 4, 5].map((side) => {
            const canon = canonSide(atom, side)
            const port = def.ports[canon]
            const face = def.faces?.[canon]
            const link = links.find((l) => l.side === side)
            return (
              <div key={side} className={`compass-cell side-${SIDE_NAMES[side]}${link ? ' bonded' : ''}`}>
                <b>{SIDE_NAMES[side]}</b>
                <span>{face ? (port ? `${face} ${PORT_LABEL[port]}` : face) : port ? PORT_LABEL[port] : 'flat'}</span>
                {link && <em>bonded</em>}
              </div>
            )
          })}
          <div className="compass-core">{def.symbol}</div>
        </div>
      </section>

      <section className="card">
        <h4>Behaviour</h4>
        <ul className="rules">
          {def.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h4>
          Molecule <span className="muted">· {molAtoms.length} atom{molAtoms.length === 1 ? '' : 's'}</span>
        </h4>
        <div className="chips">
          {[...counts.entries()].map(([kind, n]) => (
            <span key={kind} className="chip" style={{ ['--c' as string]: DEFS[kind].color }}>
              {DEFS[kind].symbol}
              <small>×{n}</small>
            </span>
          ))}
        </div>
        <p className="muted small">
          {molPinned ? 'Pinned: force fields cannot move it.' : 'Free: it drifts in force fields and snaps onto whatever fits.'}
        </p>
        <button className="btn wide" onClick={() => onPinMolecule(atom.id, !molPinned)}>
          {molPinned ? 'Release molecule' : 'Pin whole molecule'}
        </button>
      </section>
    </div>
  )
}

function FieldGuide() {
  return (
    <div className="guide">
      <section className="card">
        <h4>Bonding</h4>
        <div className="bond-rules">
          <div>
            <span className="glyph-tab" /> tab <i>→</i> <span className="glyph-slot" /> slot <b className="ok">bonds</b>
          </div>
          <div>
            <span className="glyph-socket" /> socket <i>→</i> anything <b className="ok">bonds</b>
          </div>
          <div>
            <span className="glyph-grip" /> grip <i>→</i> anything <b className="ok">holds</b>
          </div>
          <div>
            tab <i>→</i> tab, slot <i>→</i> slot <b className="no">repel</b>
          </div>
        </div>
        <p className="muted small">
          Every atom is a hexagon with six edges. Pieces lock together like a jigsaw, and everything bonded is one rigid molecule that moves as a single body.
        </p>
      </section>

      <section className="card">
        <h4>Signal</h4>
        <p className="small">
          Charge flows from tabs into slots. Conduit chains share charge instantly; each gate adds one tick of delay, so loops make clocks and memory.
        </p>
        <div className="signal-swatch">
          <i style={{ background: SIGNAL }} /> charged
        </div>
      </section>

      <section className="card">
        <h4>Forces</h4>
        <p className="small">
          <b style={{ color: DEFS.magnetar.color }}>Magnetars</b> pull and <b style={{ color: DEFS.repulsar.color }}>Repulsars</b> push every other molecule in range. They never feel their own field, so an attractor and repeller in separate molecules chase each other forever.
        </p>
        <p className="muted small">
          <b>Heat</b> jostles small molecules and tumbles loose atoms into fitting orientations, which drives new reactions. Pinned atoms ignore it.
        </p>
      </section>

      <section className="card">
        <h4>Life</h4>
        <p className="small">
          <b style={{ color: DEFS.propulsor.color }}>Propulsors</b> move a molecule, <b style={{ color: DEFS.gyron.color }}>Gyrons</b> steer it,{' '}
          <b style={{ color: DEFS.oculus.color }}>Oculi</b> see, <b style={{ color: DEFS.devourer.color }}>Devourers</b> eat and{' '}
          <b style={{ color: DEFS.fabricator.color }}>Fabricators</b> copy. Wire them with logic and you have a creature.
        </p>
      </section>

      <section className="card">
        <h4>Try building</h4>
        <ul className="rules">
          <li>A walker: Spark → Propulsor, with a Quanta pulsing a Gyron so it turns 60° at random.</li>
          <li>A hunter: an Oculus looking through a Devourer, wired to both the mouth and a Propulsor.</li>
          <li>A ripple counter: Mnemons chained through Negons, clocked by a Pulsar.</li>
          <li>A printer: a Pulsar clocking a Fabricator that holds the atom you want copied.</li>
        </ul>
      </section>

      <section className="card keys">
        <h4>Controls</h4>
        <dl>
          <dt>Drag</dt>
          <dd>place / move atom</dd>
          <dt>Shift+Drag</dt>
          <dd>move whole molecule</dd>
          <dt>R · Right-click</dt>
          <dd>rotate 60°</dd>
          <dt>Click Spark</dt>
          <dd>toggle it</dd>
          <dt>Drag off field</dt>
          <dd>dissolve</dd>
          <dt>Space · .</dt>
          <dd>run / step</dd>
          <dt>V</dt>
          <dd>show / hide force fields</dd>
          <dt>C</dt>
          <dd>open the Codex</dd>
          <dt>Corner handle</dt>
          <dd>resize the field</dd>
          <dt>⌘S · ⌘O</dt>
          <dd>export · import project</dd>
          <dt>Drop .json</dt>
          <dd>open a project</dd>
          <dt>Wheel · Drag bg</dt>
          <dd>zoom · pan</dd>
        </dl>
      </section>
    </div>
  )
}
