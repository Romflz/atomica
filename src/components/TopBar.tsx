import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
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
  paletteOpen: boolean
  inspectorOpen: boolean
  onTogglePalette: () => void
  onToggleInspector: () => void
  running: boolean
  tps: number
  heat: number
  showFields: boolean
  sceneId: string
  size: Size
  backend: string
  preferWebGL: boolean
  /** Set while a challenge is loaded: its title, and the controls it locks. */
  challengeTitle: string | null
  end: ReactNode
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
      <div className="topbar-main">
        <div className="brand">
          <svg className="brand-mark" viewBox="-20 -20 40 40" width="32" height="32" aria-hidden="true">
            <ellipse rx="17" ry="6.5" className="orbit" />
            <ellipse rx="17" ry="6.5" className="orbit" transform="rotate(60)" />
            <ellipse rx="17" ry="6.5" className="orbit" transform="rotate(-60)" />
            <circle r="4" className="nucleus" />
          </svg>
          <div><h1>Atom<span>forge</span></h1><p>Molecular playground</p></div>
        </div>
        <div className="scene-picker">
          <span className="toolbar-label">Scene</span>
          <select aria-label="Scene" value={p.sceneId} onChange={(e) => p.onScene(e.target.value)} title={scene?.hint}>
            {p.sceneId === 'custom' && <option value="custom">Your build</option>}
            {p.sceneId === 'challenge' && <option value="challenge">{p.challengeTitle}</option>}
            {SCENES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn icon-btn" onClick={() => p.onScene(p.sceneId === 'custom' ? 'empty' : p.sceneId)} title={p.sceneId === 'custom' ? 'Clear scene' : 'Restart scene'} aria-label={p.sceneId === 'custom' ? 'Clear scene' : 'Restart scene'}><Icon name="reset" /></button>
        </div>
        <div className="topbar-end"><ProjectMenu onExport={p.onExport} onImport={p.onImport} />{p.end}</div>
      </div>
      <div className="command-bar">
        <div className="transport">
          <button className={`btn play${p.running ? ' running' : ''}`} onClick={p.onToggleRun} title="Run or pause (Space)">
            <Icon name={p.running ? 'pause' : 'play'} />{p.running ? 'Pause' : 'Run'}<kbd>Space</kbd>
          </button>
          <button className="btn step-btn" onClick={p.onStep} disabled={p.running} title="Step one tick (.)"><Icon name="step" /> Step</button>
          <span className="toolbar-divider" />
          <label className="speed"><span>Speed <b>{p.tps}<small> t/s</small></b></span><input aria-label="Simulation speed" type="range" min={1} max={30} value={p.tps} onChange={(e) => p.onTps(+e.target.value)} /></label>
          <label className={`speed heat${p.heat > 0 ? ' warm' : ''}`} title={p.challengeTitle ? 'Heat is fixed during a challenge' : 'Random thermal motion for unpinned molecules'}>
            <span>Heat <b>{Math.round(p.heat * 100)}<small>°</small></b></span><input aria-label="Heat" type="range" min={0} max={0.3} step={0.01} value={p.heat} disabled={!!p.challengeTitle} onChange={(e) => p.onHeat(+e.target.value)} />
          </label>
        </div>
        <div className="view-controls">
          <button className={`btn fields-btn${p.showFields ? ' active' : ''}`} onClick={p.onToggleFields} title="Show force fields (V)" aria-pressed={p.showFields}><Icon name="field" /><span>Fields</span></button>
          <SizeMenu size={p.size} backend={p.backend} preferWebGL={p.preferWebGL} onResize={p.onResize} onPreferWebGL={p.onPreferWebGL} />
          <button className="btn icon-btn" onClick={p.onFit} title="Fit view (F)" aria-label="Fit view"><Icon name="fit" /></button>
          <span className="toolbar-divider" />
          <button className={`btn icon-btn${p.paletteOpen ? ' active' : ''}`} onClick={p.onTogglePalette} aria-label="Toggle elements panel" aria-pressed={p.paletteOpen} title="Toggle elements panel"><Icon name="left" /></button>
          <button className={`btn icon-btn${p.inspectorOpen ? ' active' : ''}`} onClick={p.onToggleInspector} aria-label="Toggle inspector panel" aria-pressed={p.inspectorOpen} title="Toggle inspector panel"><Icon name="right" /></button>
        </div>
      </div>
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
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [open])
  return { open, setOpen, ref }
}

function ProjectMenu({ onExport, onImport }: { onExport: () => void; onImport: () => void }) {
  const { open, setOpen, ref } = usePopover()
  return (
    <div className="menu-anchor" ref={ref}>
      <button className={`btn${open ? ' active' : ''}`} onClick={() => setOpen((o) => !o)} title="Save or open a project file" aria-expanded={open}>
        <Icon name="folder" /><span>Project</span>
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
        aria-expanded={open}
      >
        <Icon name="grid" /> {size.cols} × {size.rows}
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
            <input aria-label="Field columns" type="number" min={MIN_SIZE.cols} max={MAX_SIZE.cols} value={draft.cols} onChange={(e) => setDraft({ ...draft, cols: +e.target.value })} />
            <span>×</span>
            <input aria-label="Field rows" type="number" min={MIN_SIZE.rows} max={MAX_SIZE.rows} value={draft.rows} onChange={(e) => setDraft({ ...draft, rows: +e.target.value })} />
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

/** Live counters docked at the bottom of the field. */
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
