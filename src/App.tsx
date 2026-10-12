import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AtomIcon } from './components/AtomView'
import { ChallengeButton, ChallengeHud, ChallengeList } from './components/Challenges'
import { GpuField } from './components/GpuField'
import type { RendererInfo } from './components/GpuField'
import { Inspector } from './components/Inspector'
import { Palette } from './components/Palette'
import type { PartLimits } from './components/Palette'
import { Toasts } from './components/Toasts'
import type { Toast } from './components/Toasts'
import { StatsHud, TopBar } from './components/TopBar'
import { turnsUsed, usage } from './game/challenge'
import type { CheckCtx, Verdict, Zone } from './game/challenge'
import { challengeById, CHALLENGES, isUnlocked } from './game/challenges'
import type { FieldScene, Ghost, View } from './gpu/FieldRenderer'
import { boardSize, pixelToCell, sizeAt } from './render/geometry'
import { DEFS, makeAtom } from './sim/atoms'
import { MAX_SIZE, MIN_SIZE, primordialSoup, SCENES } from './sim/demos'
import type { Note, Size } from './sim/demos'
import { buildGraph, cellKey, emptyEvents, step } from './sim/engine'
import { delta, translate, turnDelta } from './sim/hex'

/** An axial offset turned 60° anticlockwise (the inverse of `turnDelta`). */
const unturnDelta = (dq: number, dr: number): [number, number] => [dq + dr, -dq]
import { exportProject, importProject, MAX_PROJECT_BYTES, ProjectError } from './sim/project'
import type { Project } from './sim/project'
import type { Atom, AtomKind, TickEvents, World } from './sim/types'
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
  | { type: 'press'; atomId: string; sx: number; sy: number; shift: boolean; locked: boolean }
  | { type: 'drag' }
  | { type: 'resize' }

// Square-grid saves (v2) don't fit the hex grid, so hex worlds save under a new key.
const SAVE_KEY = 'atomforge.hex.v1'
const RENDERER_KEY = 'atomforge.renderer'
const CHALLENGE_KEY = 'atomforge.challenges.v1'
const START_SCENE = 'foodchain'

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

/** A challenge in progress. The map itself lives in the ordinary world state. */
interface Session {
  id: string
  zones: Zone[]
  tags: Record<string, string>
  /** Where each turnable piece started; turns spent are measured from here, so turning back refunds them. */
  startRots: Record<string, number>
  solved: boolean
}

interface Saved {
  world: World
  notes: Note[]
  sceneId: string
  session?: Session | null
  totals?: TickEvents
}

function initial(): Saved {
  const saved = readJSON<Saved>(SAVE_KEY)
  if (saved?.world && Array.isArray(saved.world.atoms) && saved.world.atoms.every((a) => a.kind in DEFS) && saved.world.atoms.length) {
    const session = saved.session?.startRots && challengeById(saved.session.id) ? saved.session : null
    return { world: saved.world, notes: saved.notes ?? [], sceneId: session ? 'challenge' : 'custom', session, totals: saved.totals }
  }
  const scene = SCENES.find((s) => s.id === START_SCENE)!.make({ cols: 48, rows: 34 })
  return { ...scene, sceneId: START_SCENE }
}

const zoneSet = (zones: Zone[], kind: Zone['kind'], cols: number) => {
  const cells = zones.filter((z) => z.kind === kind).flatMap((z) => z.cells)
  return cells.length ? new Set(cells.map(([x, y]) => y * cols + x)) : null
}

/** What a verified challenge's verdict depends on: the pieces and their settings, not their live charge. */
const structureKey = (w: World) =>
  w.atoms.map((a) => `${a.kind}${a.x},${a.y},${a.rot},${a.on ? 1 : 0},${a.delay ?? ''},${a.period ?? ''},${a.radius ?? ''},${a.chance ?? ''},${a.channel ?? ''}`).join('|')

/** Where a dragged set of atoms would land, and whether every cell is free (and allowed, in a challenge). */
function placement(world: World, drag: DragState, zones: Zone[] = []): Ghost | null {
  if (!drag.cell) return null
  const occupied = new Set(world.atoms.map((a) => cellKey(world, a.x, a.y)))
  const cells = drag.items.map((i) => {
    const [x, y] = translate(drag.cell!.x, drag.cell!.y, i.dq, i.dr)
    return { atom: i.atom, x, y }
  })
  const build = zoneSet(zones, 'build', world.cols)
  const goal = zoneSet(zones, 'goal', world.cols)
  const valid = cells.every((c) => {
    const key = cellKey(world, c.x, c.y)
    return c.x >= 0 && c.y >= 0 && c.x < world.cols && c.y < world.rows && !occupied.has(key) && (!build || build.has(key)) && !goal?.has(key)
  })
  return { cells, valid }
}

export default function App() {
  const [boot] = useState(initial)
  const [world, setWorldState] = useState<World>(boot.world)
  const [notes, setNotes] = useState<Note[]>(boot.notes)
  const [sceneId, setSceneId] = useState(boot.sceneId)
  const [running, setRunning] = useState(true)
  const [tps, setTps] = useState(8)
  const [showFields, setShowFields] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ x: 20, y: 20, k: 0.5 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [resizePreview, setResizePreview] = useState<Size | null>(null)
  const [preferWebGL, setPreferWebGL] = useState(() => readJSON<boolean>(RENDERER_KEY) ?? false)
  const [info, setInfo] = useState<RendererInfo>({ backend: '…', fps: 0 })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [session, setSessionState] = useState<Session | null>(boot.session ?? null)
  const [solvedMap, setSolvedMap] = useState<Record<string, number>>(() => readJSON<{ solved: Record<string, number> }>(CHALLENGE_KEY)?.solved ?? {})
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [fileDrag, setFileDrag] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const worldRef = useRef(world)
  const viewRef = useRef(view)
  const dragRef = useRef(drag)
  const selectedRef = useRef(selectedId)
  const resizeRef = useRef(resizePreview)
  const sessionRef = useRef(session)
  const runningRef = useRef(running)
  /** What happened on the field since the current challenge started. */
  const eventsRef = useRef<TickEvents>(boot.totals ?? emptyEvents())

  const graph = useMemo(() => buildGraph(world), [world])
  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null

  useLayoutEffect(() => {
    viewRef.current = view
    dragRef.current = drag
    selectedRef.current = selectedId
    resizeRef.current = resizePreview
    runningRef.current = running
  })

  const setSession = useCallback((s: Session | null) => {
    sessionRef.current = s
    setSessionState(s)
  }, [])

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
      commit((w) => step(w, eventsRef.current))
      handle = window.setTimeout(loop, Math.max(0, interval - (performance.now() - t0)))
    }
    handle = window.setTimeout(loop, interval)
    return () => window.clearTimeout(handle)
  }, [running, tps, commit])

  // ── Toasts ────────────────────────────────────────────────────────
  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random()
    setToasts((list) => [...list.slice(-3), { ...t, id }])
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4800)
  }, [])

  const notice = useCallback((detail: string) => pushToast({ kind: 'notice', title: 'Not allowed here', detail, icon: 'bedrock' }), [pushToast])

  // ── Autosave (throttled; a running sim changes the world every tick) ──
  useEffect(() => {
    let last: World | null = null
    const id = window.setInterval(() => {
      if (worldRef.current === last) return
      last = worldRef.current
      writeJSON(SAVE_KEY, { world: last, notes, sceneId, session: sessionRef.current, totals: eventsRef.current })
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
    // Leave room for the challenge panel on the left so it never hides the map.
    const left = sessionRef.current ? 330 : pad
    const board = boardSize(w.cols, w.rows)
    const k = Math.min((width - left - pad) / board.w, (height - pad * 2) / board.h)
    setView({ k, x: left + (width - left - pad - board.w * k) / 2, y: (height - board.h * k) / 2 })
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

  /** Turn an atom 60° clockwise (dir 1) or back (dir -1). */
  const rotateAtom = useCallback(
    (id: string, dir: 1 | -1 = 1) => {
      const target = worldRef.current.atoms.find((a) => a.id === id)
      if (!target || target.lock === 'fixed') return
      const turn = (w: World): World => ({ ...w, atoms: w.atoms.map((a) => (a.id === id ? { ...a, rot: (a.rot + dir + 6) % 6 } : a)) })
      if (target.lock === 'turn') {
        const s = sessionRef.current
        const budget = challengeById(s?.id ?? '')?.turns ?? 0
        if (!s || turnsUsed(turn(worldRef.current), s.startRots) > budget) return notice('Out of turns. Turn a piece back to get its turns back.')
      }
      commit(turn)
    },
    [commit, notice],
  )

  const deleteAtom = useCallback(
    (id: string) => {
      if (worldRef.current.atoms.find((a) => a.id === id)?.lock) return
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
        if (mi === undefined || g.molecules[mi].some((m) => g.byId.get(m)!.lock)) return w
        const ids = new Set(g.molecules[mi])
        return { ...w, atoms: w.atoms.map((a) => (ids.has(a.id) ? { ...a, pinned } : a)) }
      }),
    [commit],
  )

  const resizeField = useCallback(
    (size: Size, refit: boolean) => {
      if (sessionRef.current) return notice('The field size is fixed during a challenge.')
      const cols = Math.max(MIN_SIZE.cols, Math.min(MAX_SIZE.cols, size.cols))
      const rows = Math.max(MIN_SIZE.rows, Math.min(MAX_SIZE.rows, size.rows))
      commit((w) => (w.cols === cols && w.rows === rows ? w : { ...w, cols, rows, atoms: w.atoms.filter((a) => a.x < cols && a.y < rows) }))
      if (refit) requestAnimationFrame(fit)
    },
    [commit, fit, notice],
  )

  // ── Challenges ────────────────────────────────────────────────────
  const startChallenge = useCallback(
    (id: string) => {
      const ch = challengeById(id)
      if (!ch) return
      const setup = ch.build()
      commit(() => setup.world)
      setNotes(setup.notes)
      setSceneId('challenge')
      const startRots = Object.fromEntries(setup.world.atoms.filter((a) => a.lock === 'turn').map((a) => [a.id, a.rot]))
      setSession({ id, zones: setup.zones, tags: setup.tags, startRots, solved: false })
      eventsRef.current = emptyEvents()
      setVerdict(null)
      setSelectedId(null)
      setListOpen(false)
      // Circuits run live so lamps respond as you wire them; anything that
      // moves starts paused, so a half-built ship cannot fly off.
      setRunning(!!ch.verified)
      requestAnimationFrame(fit)
    },
    [commit, fit, setSession],
  )

  /** Leave the challenge but keep the map, unlocked, to tinker with. */
  const exitChallenge = useCallback(() => {
    setSession(null)
    setVerdict(null)
    setSceneId('custom')
    commit((w) => ({ ...w, atoms: w.atoms.map((a) => (a.lock ? { ...a, lock: undefined } : a)) }))
  }, [commit, setSession])

  // Judge the challenge a couple of times a second. Verified challenges only re-run when the build changes.
  const activeId = session?.id
  useEffect(() => {
    const ch = activeId ? challengeById(activeId) : undefined
    if (!ch) return
    let lastKey = ''
    let last: Verdict | null = null
    const judge = () => {
      const s = sessionRef.current
      if (!s || s.id !== ch.id) return
      const world = worldRef.current
      const ctx: CheckCtx = {
        world,
        graph: buildGraph(world),
        setup: { world, notes: [], zones: s.zones, tags: s.tags },
        totals: eventsRef.current,
        running: runningRef.current,
      }
      let v: Verdict
      if (ch.verified) {
        const key = structureKey(world)
        v = key === lastKey && last ? last : ch.check(ctx)
        lastKey = key
        last = v
      } else {
        v = ch.check(ctx)
      }
      setVerdict((cur) => (cur && cur.solved === v.solved && cur.status === v.status ? cur : v))
      if (v.solved && !s.solved) {
        setSession({ ...s, solved: true })
        setSolvedMap((m) => {
          if (m[ch.id]) return m
          const next = { ...m, [ch.id]: Date.now() }
          writeJSON(CHALLENGE_KEY, { solved: next })
          return next
        })
        pushToast({ kind: 'challenge', title: ch.title, detail: v.status, icon: 'lumen' })
      }
    }
    judge()
    const id = window.setInterval(judge, 400)
    return () => window.clearInterval(id)
  }, [activeId, pushToast, setSession])

  const loadScene = useCallback(
    (id: string) => {
      if (id === 'challenge') {
        if (sessionRef.current) startChallenge(sessionRef.current.id)
        return
      }
      setSession(null)
      setVerdict(null)
      const scene = SCENES.find((s) => s.id === id) ?? SCENES.find((s) => s.id === 'empty')!
      const cur = worldRef.current
      const made = id === 'soup' ? primordialSoup({ cols: Math.max(cur.cols, 36), rows: Math.max(cur.rows, 26) }) : scene.make({ cols: cur.cols, rows: cur.rows })
      commit(() => made.world)
      setNotes(made.notes)
      setSceneId(scene.id)
      setSelectedId(null)
      requestAnimationFrame(fit)
    },
    [commit, fit, setSession, startChallenge],
  )

  // ── Project files ─────────────────────────────────────────────────
  const exportFile = () => {
    const text = exportProject({ world: worldRef.current, notes })
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `atomforge-${sceneId === 'custom' ? 'build' : sceneId}-${stamp}.json`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    const n = worldRef.current.atoms.length
    pushToast({ kind: 'project', title: 'Project exported', detail: `${n} atom${n === 1 ? '' : 's'} on a ${worldRef.current.cols}×${worldRef.current.rows} field`, icon: 'fabricator' })
  }

  const openProject = useCallback(
    ({ world: w, notes: n }: Project) => {
      commit(() => w)
      setNotes(n)
      setSceneId('custom')
      setSession(null)
      setVerdict(null)
      setSelectedId(null)
      requestAnimationFrame(fit)
    },
    [commit, fit, setSession],
  )

  const importFile = useCallback(
    async (file: File) => {
      try {
        if (file.size > MAX_PROJECT_BYTES) throw new ProjectError('That file is too large to be a project (over 8 MB).')
        const { project, warnings } = importProject(await file.text())
        openProject(project)
        const n = project.world.atoms.length
        const detail = [`${n} atom${n === 1 ? '' : 's'} from ${file.name}`, ...warnings].join(' · ')
        pushToast({ kind: 'project', title: 'Project imported', detail, icon: 'fabricator' })
      } catch (e) {
        const detail = e instanceof ProjectError ? e.message : 'The file could not be read.'
        pushToast({ kind: 'error', title: file.name, detail, icon: 'not' })
      }
    },
    [openProject, pushToast],
  )

  // Drop a project file anywhere on the window to open it.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      setFileDrag(true)
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setFileDrag(false)
    }
    const dropped = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setFileDrag(false)
      const file = e.dataTransfer!.files[0]
      if (file) void importFile(file)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', dropped)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', dropped)
    }
  }, [importFile])

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
    // A molecule bonded to challenge fixtures cannot come along whole; just the grabbed atom does.
    const mol = g.molecules[g.molOf.get(atomId)!]
    const whole = wholeMolecule && !mol.some((id) => g.byId.get(id)!.lock)
    const ids = whole ? [atomId, ...mol.filter((id) => id !== atomId)] : [atomId]
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
    const ghost = placement(worldRef.current, d, sessionRef.current?.zones)
    if (ghost?.valid) {
      const placed = ghost.cells.map((c) => ({ ...c.atom, x: c.x, y: c.y }))
      commit((cur) => ({ ...cur, atoms: [...cur.atoms, ...placed] }))
      setSelectedId(placed[0].id)
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

  const rotateDrag = (dir: 1 | -1) =>
    setDrag((d) =>
      d
        ? {
            ...d,
            items: d.items.map((i) => {
              const [dq, dr] = dir === 1 ? turnDelta(i.dq, i.dr) : unturnDelta(i.dq, i.dr)
              return { atom: { ...i.atom, rot: (i.atom.rot + dir + 6) % 6 }, dq, dr }
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
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) <= 5) return
        // Dragging a fixture pans the view instead of moving it.
        if (g.locked) {
          const v = viewRef.current
          gesture.current = { type: 'pan', sx: g.sx, sy: g.sy, vx: v.x, vy: v.y, moved: true }
        } else liftFromField(g.atomId, g.shift, e.clientX, e.clientY)
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
      // Modifier shortcuts are file commands; never let them fall through to the single-key ones (⌘C, ⌘R…).
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && k === 's') {
          e.preventDefault()
          exportFile()
        } else if ((e.metaKey || e.ctrlKey) && k === 'o') {
          e.preventDefault()
          fileInputRef.current?.click()
        }
        return
      }
      const sel = selectedRef.current
      if (k === ' ') {
        e.preventDefault()
        setRunning((r) => !r)
      } else if (k === '.' || k === 'n') {
        commit((w) => step(w, eventsRef.current))
      } else if (k === 'r') {
        const dir = e.shiftKey ? -1 : 1
        if (dragRef.current) rotateDrag(dir)
        else if (sel) rotateAtom(sel, dir)
      } else if ((k === 'delete' || k === 'backspace') && sel) {
        deleteAtom(sel)
      } else if (k === 'p' && sel) {
        const a = worldRef.current.atoms.find((x) => x.id === sel)
        if (a && !a.lock) patchAtom(sel, { pinned: !a.pinned })
      } else if (k === 'f') {
        fit()
      } else if (k === 'v') {
        setShowFields((v) => !v)
      } else if (k === 'escape') {
        if (listOpen) setListOpen(false)
        else if (dragRef.current) cancelDrag()
        else setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onAtomPointerDown = useCallback((atom: Atom, e: PointerEvent) => {
    gesture.current = { type: 'press', atomId: atom.id, sx: e.clientX, sy: e.clientY, shift: e.shiftKey, locked: !!atom.lock }
  }, [])

  const onBackgroundPointerDown = useCallback((e: PointerEvent) => {
    const v = viewRef.current
    gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false }
  }, [])

  const onResizeHandleDown = useCallback((e: PointerEvent) => {
    e.preventDefault()
    if (sessionRef.current) return notice('The field size is fixed during a challenge.')
    gesture.current = { type: 'resize' }
    setResizePreview({ cols: worldRef.current.cols, rows: worldRef.current.rows })
  }, [notice])

  const onInfo = useCallback((i: RendererInfo) => setInfo((cur) => (cur.backend === i.backend && cur.fps === i.fps ? cur : i)), [])

  // ── Derived UI ────────────────────────────────────────────────────
  const zones = useMemo(() => session?.zones ?? [], [session?.zones])
  const ghost = useMemo(() => (drag ? placement(world, drag, zones) : null), [drag, world, zones])
  const moveMs = Math.min(160, Math.round((1000 / tps) * 0.85))
  const fieldScene = useMemo<FieldScene>(
    () => ({ world, graph, notes, selectedId, ghost, showFields, resizePreview, moveMs, zones }),
    [world, graph, notes, selectedId, ghost, showFields, resizePreview, moveMs, zones],
  )
  const challenge = session ? challengeById(session.id) : undefined
  const challengeIndex = challenge ? CHALLENGES.indexOf(challenge) : -1
  const limits = useMemo<PartLimits | null>(() => (challenge ? { budget: challenge.parts, used: usage(world) } : null), [challenge, world])
  const turnsLeft = challenge?.turns !== undefined && session ? challenge.turns - turnsUsed(world, session.startRots) : null
  const nextChallenge = challengeIndex >= 0 && challengeIndex + 1 < CHALLENGES.length && isUnlocked(challengeIndex + 1, solvedMap) ? CHALLENGES[challengeIndex + 1] : null
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
        challengeTitle={challenge?.title ?? null}
        end={<ChallengeButton solved={Object.keys(solvedMap).length} active={!!challenge} onOpen={() => setListOpen(true)} />}
        onToggleRun={() => setRunning((r) => !r)}
        onStep={() => commit(step)}
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
        onExport={exportFile}
        onImport={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importFile(file)
        }}
      />
      <main className="workspace">
        <Palette panelRef={paletteRef} dissolve={!!drag && drag.from === 'field' && drag.overPalette} limits={limits} onGrab={grabFromPalette} />
        <section className="stage">
          <GpuField
            scene={fieldScene}
            view={view}
            hostRef={hostRef}
            preference={preferWebGL ? 'webgl' : 'webgpu'}
            onAtomPointerDown={onAtomPointerDown}
            onAtomContextMenu={(a, e) => rotateAtom(a.id, e.shiftKey ? -1 : 1)}
            onBackgroundPointerDown={onBackgroundPointerDown}
            onResizeHandleDown={onResizeHandleDown}
            onInfo={onInfo}
          />
          <div className={`stage-status${running ? ' live' : ''}`}>
            <i /> {running ? 'SIMULATING' : 'PAUSED'}
          </div>
          <StatsHud stats={stats} fps={info.fps} backend={info.backend} />
          {challenge && session && (
            <ChallengeHud
              key={challenge.id}
              challenge={challenge}
              index={challengeIndex}
              verdict={verdict}
              solved={session.solved}
              turnsLeft={turnsLeft}
              hasNext={!!nextChallenge}
              onRestart={() => startChallenge(challenge.id)}
              onExit={exitChallenge}
              onNext={() => nextChallenge && startChallenge(nextChallenge.id)}
            />
          )}
          <Toasts toasts={toasts} />
          <div className="hint-bar">
            <span>
              <kbd>Drag</kbd> place
            </span>
            <span>
              <kbd>Shift</kbd>+<kbd>Drag</kbd> molecule
            </span>
            <span>
              <kbd>R</kbd>/<kbd>Right-click</kbd> rotate, <kbd>Shift</kbd> back
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
          </div>
        </section>
        <Inspector atom={selected} graph={graph} onPatch={patchAtom} onRotate={rotateAtom} onDelete={deleteAtom} onPinMolecule={pinMolecule} turnsLeft={turnsLeft} />
      </main>

      {drag && !drag.cell && (
        <div className="drag-avatar" style={{ transform: `translate(${drag.px}px, ${drag.py}px)` }}>
          <AtomIcon atom={drag.items[0].atom} size={64} />
          {drag.items.length > 1 && <span className="drag-count">+{drag.items.length - 1}</span>}
        </div>
      )}

      {listOpen && <ChallengeList solved={solvedMap} activeId={session?.id ?? null} onStart={startChallenge} onClose={() => setListOpen(false)} />}

      {fileDrag && (
        <div className="file-drop" aria-hidden>
          <div>
            DROP TO OPEN PROJECT
            <small>replaces the current field</small>
          </div>
        </div>
      )}
    </div>
  )
}
