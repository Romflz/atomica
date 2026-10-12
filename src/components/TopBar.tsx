import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MAX_SIZE, MIN_SIZE, SCENES, SIZE_PRESETS } from '../sim/demos'
import type { Size } from '../sim/demos'

export interface Stats {
  tick: number
  atoms: number
  bonds: number
  molecules: number
  largest: number
  charged: number
}


interface Props {
  running: boolean
  tps: number
  heat: number
  showFields: boolean
  sceneId: string
  size: Size
  backend: string
  preferWebGL: boolean
  levelBadge: ReactNode
  onToggleRun: () => void
  onStep: () => void
  onTps: (tps: number) => void
  onHeat: (heat: number) => void
  onToggleFields: () => void
  onScene: (id: string) => void
  onResize: (size: Size) => void
  onPreferWebGL: (v: boolean) => void
  onFit: () => void
  onExport: () => void
  onImport: () => void
}

export function TopBar(p: Props) {
  const scene = SCENES.find((s) => s.id === p.sceneId)
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="-20 -20 40 40" width="34" height="34">
          <ellipse rx="17" ry="6.5" className="orbit" />
          <ellipse rx="17" ry="6.5" className="orbit" transform="rotate(60)" />
          <ellipse rx="17" ry="6.5" className="orbit" transform="rotate(-60)" />
          <circle r="4" className="nucleus" />
        </svg>
        <div>
          <h1>
            ATOM<span>FORGE</span>
          </h1>
          <p>molecular logic sandbox</p>
        </div>
      </div>

      <div className="transport">
        <button className={`btn play${p.running ? ' running' : ''}`} onClick={p.onToggleRun} title="Space">
          {p.running ? '❚❚ Pause' : '▶ Run'}
        </button>
        <button className="btn" onClick={p.onStep} disabled={p.running} title="Step one tick (.)">
          ⏭ Step
        </button>
        <label className="speed" title="Simulation speed (ticks per second)">
          <span>{p.tps} t/s</span>
          <input type="range" min={1} max={30} value={p.tps} onChange={(e) => p.onTps(+e.target.value)} />
        </label>
        <label className={`speed heat${p.heat > 0 ? ' warm' : ''}`} title="Heat: random thermal jiggle for unpinned molecules">
          <span>{p.heat > 0 ? `${Math.round(p.heat * 100)}°` : 'cold'}</span>
          <input type="range" min={0} max={0.3} step={0.01} value={p.heat} onChange={(e) => p.onHeat(+e.target.value)} />
        </label>
        <button
          className={`btn fields-btn${p.showFields ? ' active' : ''}`}
          onClick={p.onToggleFields}
          title="Show or hide attraction / repulsion fields (V)"
          aria-pressed={p.showFields}
        >
          ◎ Fields
        </button>
      </div>

      <div className="scene-picker">
        <select value={p.sceneId} onChange={(e) => p.onScene(e.target.value)} title={scene?.hint}>
          {p.sceneId === 'custom' && <option value="custom">Your build</option>}
          {SCENES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => p.onScene(p.sceneId === 'custom' ? 'empty' : p.sceneId)} title="Reload scene (reseeds the soup)">
          ↺ {p.sceneId === 'custom' ? 'Clear' : 'Reload'}
        </button>
        <SizeMenu size={p.size} backend={p.backend} preferWebGL={p.preferWebGL} onResize={p.onResize} onPreferWebGL={p.onPreferWebGL} />
        <ProjectMenu onExport={p.onExport} onImport={p.onImport} />
        <button className="btn ghost-btn" onClick={p.onFit} title="Fit view (F)">
          ⤢
        </button>
      </div>

      <div className="topbar-end">{p.levelBadge}</div>
    </header>
  )
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/** A small popover anchored to a top-bar button that closes when you click elsewhere. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return { open, setOpen, ref }
}

function ProjectMenu({ onExport, onImport }: { onExport: () => void; onImport: () => void }) {
  const { open, setOpen, ref } = usePopover()
  return (
    <div className="menu-anchor" ref={ref}>
      <button className={`btn${open ? ' active' : ''}`} onClick={() => setOpen((o) => !o)} title="Save or open a project file">
        ⇅ Project
      </button>
      {open && (
        <div className="popover project-pop">
          <h4>Project file</h4>
          <button
            className="btn wide"
            onClick={() => {
              setOpen(false)
              onExport()
            }}
          >
            ⤓ Export JSON <kbd>{MOD}S</kbd>
          </button>
          <button
            className="btn wide"
            onClick={() => {
              setOpen(false)
              onImport()
            }}
          >
            ⤒ Import JSON <kbd>{MOD}O</kbd>
          </button>
          <p className="muted small">
            Export saves the whole field: size, heat, every atom with its settings and charge, and notes. Importing replaces the current field. You can also drop a
            .json file anywhere on the window.
          </p>
        </div>
      )}
    </div>
  )
}

function SizeMenu({
  size,
  backend,
  preferWebGL,
  onResize,
  onPreferWebGL,
}: {
  size: Size
  backend: string
  preferWebGL: boolean
  onResize: (s: Size) => void
  onPreferWebGL: (v: boolean) => void
}) {
  const { open, setOpen, ref } = usePopover()
  const [draft, setDraft] = useState(size)

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo))
  const apply = (s: Size) => {
    onResize({ cols: clamp(s.cols, MIN_SIZE.cols, MAX_SIZE.cols), rows: clamp(s.rows, MIN_SIZE.rows, MAX_SIZE.rows) })
    setOpen(false)
  }

  return (
    <div className="menu-anchor size-menu" ref={ref}>
      <button
        className={`btn${open ? ' active' : ''}`}
        onClick={() => {
          setDraft(size)
          setOpen((o) => !o)
        }}
        title="Field size"
      >
        ▦ {size.cols}×{size.rows}
      </button>
      {open && (
        <div className="popover">
          <h4>Field size</h4>
          <div className="size-grid">
            {SIZE_PRESETS.map((s) => (
              <button key={s.name} className={`size-opt${s.cols === size.cols && s.rows === size.rows ? ' current' : ''}`} onClick={() => apply(s)}>
                <b>{s.name}</b>
                <span>
                  {s.cols}×{s.rows}
                </span>
                <i style={{ width: `${(s.cols / 200) * 100}%`, height: `${(s.rows / 140) * 26 + 4}px` }} />
              </button>
            ))}
          </div>
          <div className="size-custom">
            <input type="number" min={MIN_SIZE.cols} max={MAX_SIZE.cols} value={draft.cols} onChange={(e) => setDraft({ ...draft, cols: +e.target.value })} />
            <span>×</span>
            <input type="number" min={MIN_SIZE.rows} max={MAX_SIZE.rows} value={draft.rows} onChange={(e) => setDraft({ ...draft, rows: +e.target.value })} />
            <button className="btn" onClick={() => apply(draft)}>
              Apply
            </button>
          </div>
          <p className="muted small">Tip: drag the glowing handle at the board's bottom-right corner. Shrinking dissolves atoms outside the new edge.</p>
          <h4>Renderer</h4>
          <div className="seg">
            <button className={!preferWebGL ? 'on' : ''} onClick={() => onPreferWebGL(false)}>
              WebGPU
            </button>
            <button className={preferWebGL ? 'on' : ''} onClick={() => onPreferWebGL(true)}>
              WebGL
            </button>
          </div>
          <p className="muted small">
            Running on <b className="accent">{backend.toUpperCase()}</b>. WebGPU falls back to WebGL automatically when unsupported.
          </p>
        </div>
      )}
    </div>
  )
}

/** Live counters overlaid on the field, top-right. */
export function StatsHud({ stats, fps, backend }: { stats: Stats; fps: number; backend: string }) {
  return (
    <div className="stats">
      <Stat label="Tick" value={stats.tick} />
      <Stat label="Atoms" value={stats.atoms} />
      <Stat label="Bonds" value={stats.bonds} />
      <Stat label="Molecules" value={stats.molecules} />
      <Stat label="Largest" value={stats.largest} accent />
      <Stat label="Charged" value={stats.charged} signal />
      <div className="stat gpu" title={`Rendering on the GPU via ${backend}`}>
        <b>{fps}</b>
        <span>{backend} fps</span>
      </div>
    </div>
  )
}

function Stat({ label, value, accent, signal }: { label: string; value: number; accent?: boolean; signal?: boolean }) {
  return (
    <div className={`stat${accent ? ' accent' : ''}${signal ? ' signal' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}
