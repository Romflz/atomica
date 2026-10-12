import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AtomIcon } from './components/AtomView'
import { Codex, LevelBadge, Toasts } from './components/Game'
import type { Toast } from './components/Game'
import { GpuField } from './components/GpuField'
import type { RendererInfo } from './components/GpuField'
import { Inspector } from './components/Inspector'
import { Palette } from './components/Palette'
import { StatsHud, TopBar } from './components/TopBar'
import { addEvents, evaluate, freshProgress, levelOf, meterFor } from './game/progress'
import type { Discovery, Progress } from './game/progress'
import type { FieldScene, Ghost, View } from './gpu/FieldRenderer'
import { boardSize, pixelToCell, sizeAt } from './render/geometry'
import { DEFS, makeAtom } from './sim/atoms'
import { MAX_SIZE, MIN_SIZE, primordialSoup, SCENES } from './sim/demos'
import type { Note, Size } from './sim/demos'
import { buildGraph, cellKey, emptyEvents, step } from './sim/engine'
import { delta, translate, turnDelta } from './sim/hex'
import type { Graph } from './sim/engine'
import type { Atom, AtomKind, World } from './sim/types'
import './App.css'

/** A dragged atom and its axial offset from the atom under the pointer. */
interface DragItem {
  atom: Atom
  dq: number
  dr: number
}

interface DragState {
  items: DragItem[]
  from: 'palette' | 'field'
  px: number
  py: number
  cell: { x: number; y: number } | null
  overPalette: boolean
}

type Gesture =
  | { type: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { type: 'press'; atomId: string; sx: number; sy: number; shift: boolean }
  | { type: 'drag' }
  | { type: 'resize' }

type Origin = 'sandbox' | 'preset'

// Square-grid saves (v2) don't fit the hex grid, so hex worlds save under a new key.
const SAVE_KEY = 'atomforge.hex.v1'
const PROGRESS_KEY = 'atomforge.progress.v1'
const RENDERER_KEY = 'atomforge.renderer'
const START_SCENE = 'foodchain'
const SANDBOX_SCENES = new Set(['empty', 'soup'])

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or unavailable: the session still works */
  }
}

interface Saved {
  world: World
  notes: Note[]
  sceneId: string
  origin: Origin
}

function initial(): Saved {
  const saved = readJSON<Saved>(SAVE_KEY)
  if (saved?.world && Array.isArray(saved.world.atoms) && saved.world.atoms.every((a) => a.kind in DEFS) && saved.world.atoms.length) {
    return { world: saved.world, notes: saved.notes ?? [], sceneId: 'custom', origin: saved.origin ?? 'sandbox' }
  }
  const scene = SCENES.find((s) => s.id === START_SCENE)!.make({ cols: 48, rows: 34 })
  return { ...scene, sceneId: START_SCENE, origin: 'preset' }
}

function initialProgress(): Progress {
  const p = readJSON<Progress>(PROGRESS_KEY)
  if (!p || typeof p.xp !== 'number') return freshProgress()
  const fresh = freshProgress()
  return { ...fresh, ...p, totals: { ...fresh.totals, ...p.totals } }
}

/** Where a dragged set of atoms would land, and whether every cell is free. */
function placement(world: World, drag: DragState): Ghost | null {
  if (!drag.cell) return null
  const occupied = new Set(world.atoms.map((a) => cellKey(world, a.x, a.y)))
  const cells = drag.items.map((i) => {
    const [x, y] = translate(drag.cell!.x, drag.cell!.y, i.dq, i.dr)
    return { atom: i.atom, x, y }
  })
  const valid = cells.every(
    (c) => c.x >= 0 && c.y >= 0 && c.x < world.cols && c.y < world.rows && !occupied.has(cellKey(world, c.x, c.y)),
  )
  return { cells, valid }
}

/** Clasps currently holding something with a grip. */
const grippingClasps = (g: Graph) =>
  new Set([...g.byId.values()].filter((a) => a.kind === 'clasp' && (g.links.get(a.id) ?? []).some((l) => l.mine === 'grip')).map((a) => a.id))

export default function App() {
  const [boot] = useState(initial)
  const [world, setWorldState] = useState<World>(boot.world)
  const [notes, setNotes] = useState<Note[]>(boot.notes)
  const [sceneId, setSceneId] = useState(boot.sceneId)
  const [origin, setOrigin] = useState<Origin>(boot.origin)
  const [running, setRunning] = useState(true)
  const [tps, setTps] = useState(8)
  const [showFields, setShowFields] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ x: 20, y: 20, k: 0.5 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [resizePreview, setResizePreview] = useState<Size | null>(null)
  const [preferWebGL, setPreferWebGL] = useState(() => readJSON<boolean>(RENDERER_KEY) ?? false)
  const [info, setInfo] = useState<RendererInfo>({ backend: '…', fps: 0 })
  const [progress, setProgressState] = useState<Progress>(initialProgress)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [codexOpen, setCodexOpen] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const worldRef = useRef(world)
  const viewRef = useRef(view)
  const dragRef = useRef(drag)
  const selectedRef = useRef(selectedId)
  const resizeRef = useRef(resizePreview)
  const progressRef = useRef(progress)
  const originRef = useRef(origin)
  const rendered = useRef<{ world: World; graph: Graph } | null>(null)
  const pendingEvents = useRef(emptyEvents())

  const graph = useMemo(() => buildGraph(world), [world])
  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null

  useLayoutEffect(() => {
    viewRef.current = view
    dragRef.current = drag
    selectedRef.current = selectedId
    resizeRef.current = resizePreview
    originRef.current = origin
    rendered.current = { world, graph }
  })

  /**
   * All world changes go through here, synchronously against the ref, so a
   * simulation tick can never overwrite an edit that has not rendered yet.
   */
  const commit = useCallback((fn: (w: World) => World) => {
    const next = fn(worldRef.current)
    if (next === worldRef.current) return
    worldRef.current = next
    setWorldState(next)
  }, [])

  // ── Simulation clock (self-pacing, so huge worlds never queue up ticks) ──
  useEffect(() => {
    if (!running) return
    let handle = 0
    const interval = 1000 / tps
    const loop = () => {
      const t0 = performance.now()
      commit((w) => step(w, pendingEvents.current))
      handle = window.setTimeout(loop, Math.max(0, interval - (performance.now() - t0)))
    }
    handle = window.setTimeout(loop, interval)
    return () => window.clearTimeout(handle)
  }, [running, tps, commit])

  // ── Progress: fold events in and look for new discoveries ─────────
  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random()
    setToasts((list) => [...list.slice(-3), { ...t, id }])
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4800)
  }, [])

  const updateProgress = useCallback(
    (fn: (p: Progress) => Progress) => {
      const before = progressRef.current
      let next = fn(before)
      const r = rendered.current
      const found: Discovery[] = r ? evaluate(next, { world: r.world, graph: r.graph, sandbox: originRef.current === 'sandbox' }) : []
      if (found.length) {
        const unlocked = { ...next.unlocked }
        found.forEach((d) => (unlocked[d.id] = Date.now()))
        next = { ...next, unlocked, xp: next.xp + found.reduce((s, d) => s + d.xp, 0) }
      }
      if (next === before) return
      progressRef.current = next
      setProgressState(next)
      found.forEach((d) => pushToast({ kind: 'discovery', title: d.name, detail: `${d.desc} +${d.xp} XP`, icon: d.icon }))
      const lv0 = levelOf(before.xp)
      const lv1 = levelOf(next.xp)
      if (lv1.level > lv0.level) pushToast({ kind: 'level', title: `Level ${lv1.level} · ${lv1.title}`, detail: 'New rank unlocked', icon: 'pulsar' })
    },
    [pushToast],
  )

  const lastGrip = useRef(new Set<string>())
  useEffect(() => {
    const id = window.setInterval(() => {
      const r = rendered.current
      if (!r) return
      const ev = pendingEvents.current
      pendingEvents.current = emptyEvents()
      const grips = grippingClasps(r.graph)
      let splits = 0
      for (const cid of lastGrip.current) if (r.graph.byId.get(cid)?.out) splits++
      lastGrip.current = grips
      const sandbox = originRef.current === 'sandbox'
      updateProgress((p) => {
        if (!sandbox) return p
        const totals = addEvents(p.totals, ev)
        if (totals === p.totals && !splits) return p
        return { ...p, totals: splits ? { ...totals, splits: totals.splits + splits } : totals }
      })
    }, 400)
    return () => window.clearInterval(id)
  }, [updateProgress])

  useEffect(() => writeJSON(PROGRESS_KEY, progress), [progress])

  // ── Autosave (throttled; a running sim changes the world every tick) ──
  useEffect(() => {
    let last: World | null = null
    const id = window.setInterval(() => {
      if (worldRef.current === last) return
      last = worldRef.current
      writeJSON(SAVE_KEY, { world: last, notes, sceneId, origin: originRef.current })
    }, 2000)
    return () => window.clearInterval(id)
  }, [notes, sceneId])

  // ── View ──────────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const { width, height } = host.getBoundingClientRect()
    const w = worldRef.current
    const pad = 28
    const board = boardSize(w.cols, w.rows)
    const k = Math.min((width - pad * 2) / board.w, (height - pad * 2) / board.h)
    setView({ k, x: (width - board.w * k) / 2, y: (height - board.h * k) / 2 })
  }, [])

  useLayoutEffect(() => {
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = host.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((v) => {
        const k = Math.min(2.4, Math.max(0.04, v.k * Math.exp(-e.deltaY * 0.0015)))
        const wx = (mx - v.x) / v.k
        const wy = (my - v.y) / v.k
        return { k, x: mx - wx * k, y: my - wy * k }
      })
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [])

  const toWorld = useCallback((cx: number, cy: number) => {
    const rect = hostRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { wx: (cx - rect.left - v.x) / v.k, wy: (cy - rect.top - v.y) / v.k, rect }
  }, [])

  const clientToCell = useCallback(
    (cx: number, cy: number) => {
      if (!hostRef.current) return null
      const { wx, wy, rect } = toWorld(cx, cy)
      if (cx < rect.left || cy < rect.top || cx > rect.right || cy > rect.bottom) return null
      return pixelToCell(wx, wy)
    },
    [toWorld],
  )

  const overPalette = (cx: number, cy: number) => {
    const r = paletteRef.current?.getBoundingClientRect()
    return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
  }

  // ── World edits ───────────────────────────────────────────────────
  const patchAtom = useCallback(
    (id: string, patch: Partial<Atom>) => commit((w) => ({ ...w, atoms: w.atoms.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    [commit],
  )

  const rotateAtom = useCallback(
    (id: string) => commit((w) => ({ ...w, atoms: w.atoms.map((a) => (a.id === id ? { ...a, rot: (a.rot + 1) % 6 } : a)) })),
    [commit],
  )

  const deleteAtom = useCallback(
    (id: string) => {
      commit((w) => ({ ...w, atoms: w.atoms.filter((a) => a.id !== id) }))
      setSelectedId((s) => (s === id ? null : s))
    },
    [commit],
  )

  const pinMolecule = useCallback(
    (id: string, pinned: boolean) =>
      commit((w) => {
        const g = buildGraph(w)
        const mi = g.molOf.get(id)
        if (mi === undefined) return w
        const ids = new Set(g.molecules[mi])
        return { ...w, atoms: w.atoms.map((a) => (ids.has(a.id) ? { ...a, pinned } : a)) }
      }),
    [commit],
  )

  const resizeField = useCallback(
    (size: Size, refit: boolean) => {
      const cols = Math.max(MIN_SIZE.cols, Math.min(MAX_SIZE.cols, size.cols))
      const rows = Math.max(MIN_SIZE.rows, Math.min(MAX_SIZE.rows, size.rows))
      commit((w) => (w.cols === cols && w.rows === rows ? w : { ...w, cols, rows, atoms: w.atoms.filter((a) => a.x < cols && a.y < rows) }))
      updateProgress((p) => (cols * rows > p.maxArea ? { ...p, maxArea: cols * rows } : p))
      if (refit) requestAnimationFrame(fit)
    },
    [commit, fit, updateProgress],
  )

  const loadScene = useCallback(
    (id: string) => {
      const scene = SCENES.find((s) => s.id === id) ?? SCENES.find((s) => s.id === 'empty')!
      const cur = worldRef.current
      const made = id === 'soup' ? primordialSoup({ cols: Math.max(cur.cols, 36), rows: Math.max(cur.rows, 26) }) : scene.make({ cols: cur.cols, rows: cur.rows })
      commit(() => made.world)
      setNotes(made.notes)
      setSceneId(scene.id)
      const o: Origin = SANDBOX_SCENES.has(scene.id) ? 'sandbox' : 'preset'
      setOrigin(o)
      originRef.current = o
      setSelectedId(null)
      lastGrip.current = new Set()
      pendingEvents.current = emptyEvents()
      if (!SANDBOX_SCENES.has(scene.id)) updateProgress((p) => (p.presets.includes(scene.id) ? p : { ...p, presets: [...p.presets, scene.id] }))
      requestAnimationFrame(fit)
    },
    [commit, fit, updateProgress],
  )

  // ── Drag & drop ───────────────────────────────────────────────────
  const beginDrag = (items: DragItem[], from: DragState['from'], cx: number, cy: number) => {
    gesture.current = { type: 'drag' }
    setDrag({ items, from, px: cx, py: cy, cell: clientToCell(cx, cy), overPalette: overPalette(cx, cy) })
  }

  const grabFromPalette = (kind: AtomKind, e: ReactPointerEvent) => {
    beginDrag([{ atom: makeAtom(kind, 0, 0), dq: 0, dr: 0 }], 'palette', e.clientX, e.clientY)
  }

  const liftFromField = (atomId: string, wholeMolecule: boolean, cx: number, cy: number) => {
    const g = buildGraph(worldRef.current)
    const anchor = g.byId.get(atomId)
    if (!anchor) return
    const ids = wholeMolecule ? [atomId, ...g.molecules[g.molOf.get(atomId)!].filter((id) => id !== atomId)] : [atomId]
    const lifted = new Set(ids)
    const items = ids.map((id) => {
      const a = g.byId.get(id)!
      const [dq, dr] = delta(anchor.x, anchor.y, a.x, a.y)
      return { atom: a, dq, dr }
    })
    commit((cur) => ({ ...cur, atoms: cur.atoms.filter((a) => !lifted.has(a.id)) }))
    setSelectedId(atomId)
    beginDrag(items, 'field', cx, cy)
  }

  /** Return lifted atoms to their original cells, skipping any that got taken meanwhile. */
  const restore = (items: DragItem[]) =>
    commit((cur) => {
      const taken = new Set(cur.atoms.map((a) => cellKey(cur, a.x, a.y)))
      const back = items.map((i) => i.atom).filter((a) => a.x < cur.cols && a.y < cur.rows && !taken.has(cellKey(cur, a.x, a.y)))
      return { ...cur, atoms: [...cur.atoms, ...back] }
    })

  const drop = () => {
    const d = dragRef.current
    if (!d) return
    setDrag(null)
    const ghost = placement(worldRef.current, d)
    if (ghost?.valid) {
      const placed = ghost.cells.map((c) => ({ ...c.atom, x: c.x, y: c.y }))
      commit((cur) => ({ ...cur, atoms: [...cur.atoms, ...placed] }))
      setSelectedId(placed[0].id)
      if (d.from === 'palette') updateProgress((p) => ({ ...p, totals: { ...p.totals, placed: p.totals.placed + 1 } }))
      return
    }
    if (d.from === 'field' && ghost) {
      restore(d.items)
      return
    }
    if (d.from === 'field') setSelectedId(null)
  }

  const cancelDrag = () => {
    const d = dragRef.current
    gesture.current = null
    setDrag(null)
    if (d?.from === 'field') restore(d.items)
  }

  const rotateDrag = () =>
    setDrag((d) =>
      d
        ? {
            ...d,
            items: d.items.map((i) => {
              const [dq, dr] = turnDelta(i.dq, i.dr)
              return { atom: { ...i.atom, rot: (i.atom.rot + 1) % 6 }, dq, dr }
            }),
          }
        : d,
    )

  // ── Pointer gestures ──────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      if (g.type === 'pan') {
        const dx = e.clientX - g.sx
        const dy = e.clientY - g.sy
        if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
        setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }))
      } else if (g.type === 'press') {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 5) liftFromField(g.atomId, g.shift, e.clientX, e.clientY)
      } else if (g.type === 'resize') {
        const { wx, wy } = toWorld(e.clientX, e.clientY)
        const at = sizeAt(wx, wy)
        const cols = Math.max(MIN_SIZE.cols, Math.min(MAX_SIZE.cols, at.cols))
        const rows = Math.max(MIN_SIZE.rows, Math.min(MAX_SIZE.rows, at.rows))
        setResizePreview((p) => (p && p.cols === cols && p.rows === rows ? p : { cols, rows }))
      } else {
        const cell = clientToCell(e.clientX, e.clientY)
        const op = overPalette(e.clientX, e.clientY)
        setDrag((d) => (d ? { ...d, px: e.clientX, py: e.clientY, cell, overPalette: op } : d))
      }
    }
    const onUp = () => {
      const g = gesture.current
      gesture.current = null
      if (!g) return
      if (g.type === 'pan') {
        if (!g.moved) setSelectedId(null)
      } else if (g.type === 'press') {
        const a = worldRef.current.atoms.find((x) => x.id === g.atomId)
        setSelectedId(g.atomId)
        if (a?.kind === 'spark') patchAtom(a.id, { on: !a.on, out: !a.on })
      } else if (g.type === 'resize') {
        const p = resizeRef.current
        setResizePreview(null)
        if (p) resizeField(p, false)
      } else {
        drop()
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  })

  // ── Keyboard ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (codexOpen && k !== 'c') return
      const sel = selectedRef.current
      if (k === ' ') {
        e.preventDefault()
        setRunning((r) => !r)
      } else if (k === '.' || k === 'n') {
        commit((w) => step(w, pendingEvents.current))
      } else if (k === 'r') {
        if (dragRef.current) rotateDrag()
        else if (sel) rotateAtom(sel)
      } else if ((k === 'delete' || k === 'backspace') && sel) {
        deleteAtom(sel)
      } else if (k === 'p' && sel) {
        const a = worldRef.current.atoms.find((x) => x.id === sel)
        if (a) patchAtom(sel, { pinned: !a.pinned })
      } else if (k === 'f') {
        fit()
      } else if (k === 'v') {
        setShowFields((v) => !v)
      } else if (k === 'c') {
        setCodexOpen((o) => !o)
      } else if (k === 'escape') {
        if (dragRef.current) cancelDrag()
        else setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onAtomPointerDown = useCallback((atom: Atom, e: PointerEvent) => {
    gesture.current = { type: 'press', atomId: atom.id, sx: e.clientX, sy: e.clientY, shift: e.shiftKey }
  }, [])

  const onBackgroundPointerDown = useCallback((e: PointerEvent) => {
    const v = viewRef.current
    gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false }
  }, [])

  const onResizeHandleDown = useCallback((e: PointerEvent) => {
    e.preventDefault()
    gesture.current = { type: 'resize' }
    setResizePreview({ cols: worldRef.current.cols, rows: worldRef.current.rows })
  }, [])

  const onInfo = useCallback((i: RendererInfo) => setInfo((cur) => (cur.backend === i.backend && cur.fps === i.fps ? cur : i)), [])

  // ── Derived UI ────────────────────────────────────────────────────
  const ghost = useMemo(() => (drag ? placement(world, drag) : null), [drag, world])
  const moveMs = Math.min(160, Math.round((1000 / tps) * 0.85))
  const fieldScene = useMemo<FieldScene>(
    () => ({ world, graph, notes, selectedId, ghost, showFields, resizePreview, moveMs }),
    [world, graph, notes, selectedId, ghost, showFields, resizePreview, moveMs],
  )
  const stats = useMemo(() => {
    let largest = 0
    let molecules = 0
    for (const m of graph.molecules) {
      if (m.length > largest) largest = m.length
      if (m.length > 1) molecules++
    }
    let charged = 0
    for (const a of world.atoms) if (a.out) charged++
    return { tick: world.tick, atoms: world.atoms.length, bonds: graph.bonds.length, molecules, largest, charged }
  }, [graph, world])

  const meter = (d: Discovery) => meterFor(d, progress, { world, graph, sandbox: origin === 'sandbox' })

  return (
    <div className={`app${drag ? ' is-dragging' : ''}`}>
      <div className="backdrop" aria-hidden />
      <TopBar
        running={running}
        tps={tps}
        heat={world.heat ?? 0}
        showFields={showFields}
        sceneId={sceneId}
        size={{ cols: world.cols, rows: world.rows }}
        backend={info.backend}
        preferWebGL={preferWebGL}
        levelBadge={<LevelBadge xp={progress.xp} onOpen={() => setCodexOpen(true)} />}
        onToggleRun={() => setRunning((r) => !r)}
        onStep={() => commit((w) => step(w, pendingEvents.current))}
        onTps={setTps}
        onHeat={(heat) => commit((w) => ({ ...w, heat }))}
        onToggleFields={() => setShowFields((v) => !v)}
        onScene={loadScene}
        onResize={(s) => resizeField(s, true)}
        onPreferWebGL={(v) => {
          setPreferWebGL(v)
          writeJSON(RENDERER_KEY, v)
        }}
        onFit={fit}
      />
      <main className="workspace">
        <Palette panelRef={paletteRef} dissolve={!!drag && drag.from === 'field' && drag.overPalette} onGrab={grabFromPalette} />
        <section className="stage">
          <GpuField
            scene={fieldScene}
            view={view}
            hostRef={hostRef}
            preference={preferWebGL ? 'webgl' : 'webgpu'}
            onAtomPointerDown={onAtomPointerDown}
            onAtomContextMenu={(a) => rotateAtom(a.id)}
            onBackgroundPointerDown={onBackgroundPointerDown}
            onResizeHandleDown={onResizeHandleDown}
            onInfo={onInfo}
          />
          <div className={`stage-status${running ? ' live' : ''}`}>
            <i /> {running ? 'SIMULATING' : 'PAUSED'}
            {origin === 'preset' && <em>PRESET</em>}
          </div>
          <StatsHud stats={stats} fps={info.fps} backend={info.backend} />
          <Toasts toasts={toasts} />
          <div className="hint-bar">
            <span>
              <kbd>Drag</kbd> place
            </span>
            <span>
              <kbd>Shift</kbd>+<kbd>Drag</kbd> molecule
            </span>
            <span>
              <kbd>R</kbd>/<kbd>Right-click</kbd> rotate
            </span>
            <span>
              <kbd>P</kbd> pin
            </span>
            <span>
              <kbd>Space</kbd> run
            </span>
            <span>
              <kbd>V</kbd> fields
            </span>
            <span>
              <kbd>C</kbd> codex
            </span>
          </div>
        </section>
        <Inspector atom={selected} graph={graph} onPatch={patchAtom} onRotate={rotateAtom} onDelete={deleteAtom} onPinMolecule={pinMolecule} />
      </main>

      {drag && !drag.cell && (
        <div className="drag-avatar" style={{ transform: `translate(${drag.px}px, ${drag.py}px)` }}>
          <AtomIcon atom={drag.items[0].atom} size={64} />
          {drag.items.length > 1 && <span className="drag-count">+{drag.items.length - 1}</span>}
        </div>
      )}

      {codexOpen && (
        <Codex
          progress={progress}
          meter={meter}
          sandbox={origin === 'sandbox'}
          onClose={() => setCodexOpen(false)}
          onReset={() => {
            const p = freshProgress()
            progressRef.current = p
            setProgressState(p)
          }}
        />
      )}
    </div>
  )
}
