/**
 * Challenge framework: map building, zones, and the detectors that decide
 * when a challenge is solved.
 *
 * Logic, memory and timing challenges are verified on a hidden copy of the
 * field: the detector sets the switches itself, runs the copy, and reads the
 * lamp. That checks every case, works while the simulation is paused, and
 * cannot be fooled by toggling switches by hand. Motion and life challenges
 * are judged live from what happens on the field since the challenge started.
 */
import { makeAtom } from '../sim/atoms'
import type { Note } from '../sim/demos'
import { buildGraph, cellKey, emptyEvents, step } from '../sim/engine'
import type { Graph } from '../sim/engine'
import { neighbor, SIDES } from '../sim/hex'
import type { Atom, AtomKind, TickEvents, World } from '../sim/types'

export interface Zone {
  kind: 'goal' | 'build'
  cells: [number, number][]
}

export interface ChallengeSetup {
  world: World
  notes: Note[]
  zones: Zone[]
  /** Fixture atoms the detector refers to, by role → atom id. */
  tags: Record<string, string>
}

export interface CheckCtx {
  world: World
  graph: Graph
  setup: ChallengeSetup
  /** Everything that happened since the challenge (re)started. */
  totals: TickEvents
  running: boolean
}

export interface Verdict {
  solved: boolean
  /** One short live line: what is still wrong, or how far along it is. */
  status: string
}

export interface Challenge {
  id: string
  title: string
  stars: 1 | 2 | 3 | 4 | 5
  /** The task, one or two sentences. */
  brief: string
  hint: string
  /** The parts the player may place, and how many of each. */
  parts: Partial<Record<AtomKind, number>>
  /** How many times the player may rotate turnable fixtures, if the challenge has any. */
  turns?: number
  /**
   * Verified on a hidden copy rather than watched live. Its verdict depends
   * only on the structure the player built, so it is cached between changes.
   */
  verified?: boolean
  build: () => ChallengeSetup
  check: (c: CheckCtx) => Verdict
}

// ── Map building ────────────────────────────────────────────────────

/** A small kit for laying out a challenge map with tagged, locked fixtures. */
export function mapKit(cols: number, rows: number, heat = 0) {
  const atoms: Atom[] = []
  const tags: Record<string, string> = {}
  const notes: Note[] = []
  const zones: Zone[] = []
  const kit = {
    /** A fixture: pinned and locked unless told otherwise. */
    fix(kind: AtomKind, x: number, y: number, opts: { rot?: number; tag?: string; lock?: Atom['lock']; pinned?: boolean } & Partial<Atom> = {}) {
      const { rot = 0, tag, lock = 'fixed', pinned = true, ...extra } = opts
      const a = makeAtom(kind, x, y, rot, { ...extra, pinned, lock })
      atoms.push(a)
      if (tag) tags[tag] = a.id
      return kit
    },
    /** A switch the player may flip; detectors drive it themselves. */
    switch(x: number, y: number, tag: string, on = false) {
      return kit.fix('spark', x, y, { tag, on, out: on })
    },
    lamp(x: number, y: number, tag = 'lamp') {
      return kit.fix('lumen', x, y, { tag })
    },
    rock(cells: [number, number][]) {
      for (const [x, y] of cells) kit.fix('bedrock', x, y)
      return kit
    },
    zone(kind: Zone['kind'], cells: [number, number][]) {
      zones.push({ kind, cells })
      return kit
    },
    note(x: number, y: number, text: string) {
      notes.push({ x, y, text })
      return kit
    },
    done(): ChallengeSetup {
      return { world: { cols, rows, tick: 0, heat, atoms }, notes, zones, tags }
    },
  }
  return kit
}

/** Every cell in a rectangle of columns × rows (inclusive). */
export function rect(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y])
  return out
}

/** Sixths of a turn between two rotations, the short way round. */
export const turnDistance = (from: number, to: number) => {
  const d = (((to - from) % 6) + 6) % 6
  return Math.min(d, 6 - d)
}

/** Turns spent on a challenge's turnable pieces: how far each sits from where it started. */
export function turnsUsed(w: World, start: Record<string, number>): number {
  let n = 0
  for (const a of w.atoms) if (a.lock === 'turn' && a.id in start) n += turnDistance(start[a.id], a.rot)
  return n
}

// ── Reading the field ───────────────────────────────────────────────

export const byTag = (c: Pick<CheckCtx, 'world' | 'setup'>, tag: string) => c.world.atoms.find((a) => a.id === c.setup.tags[tag])

/** Atoms the player placed (or that their machines made). */
export const playerAtoms = (w: World) => w.atoms.filter((a) => !a.lock)

export function zoneCells(setup: ChallengeSetup, kind: Zone['kind']): Set<number> | null {
  const zs = setup.zones.filter((z) => z.kind === kind)
  if (!zs.length) return null
  return new Set(zs.flatMap((z) => z.cells.map(([x, y]) => cellKey(setup.world, x, y))))
}

export function inGoal(c: CheckCtx, atoms: Atom[]) {
  const goal = zoneCells(c.setup, 'goal')
  return !!goal && atoms.some((a) => goal.has(cellKey(c.world, a.x, a.y)))
}

/** Count the player's atoms of each kind, for budgets. */
export function usage(w: World): Partial<Record<AtomKind, number>> {
  const n: Partial<Record<AtomKind, number>> = {}
  for (const a of w.atoms) if (!a.lock) n[a.kind] = (n[a.kind] ?? 0) + 1
  return n
}

// ── Hidden-copy simulation ──────────────────────────────────────────

export function run(w: World, n: number, events = emptyEvents()): World {
  for (let i = 0; i < n; i++) w = step(w, events)
  return w
}

export function setSwitch(w: World, id: string | undefined, on: boolean): World {
  return { ...w, atoms: w.atoms.map((a) => (a.id === id ? { ...a, on, out: on } : a)) }
}

const outOf = (w: World, id: string | undefined) => !!w.atoms.find((a) => a.id === id)?.out

/**
 * A copy of the field as if just switched on: transient state cleared, then
 * left to settle. Mnemons are zeroed a few times while it settles, so
 * counters start from 0 even though their Negons start out ON.
 */
export function powerOn(w: World): World {
  w = {
    ...w,
    heat: 0,
    atoms: w.atoms.map((a) => ({
      ...a,
      out: a.kind === 'spark' ? !!a.on : a.kind === 'not',
      prev: undefined,
      ...(a.mem !== undefined ? { mem: 0 } : {}),
    })),
  }
  for (let i = 0; i < 4; i++) {
    w = run(w, 12)
    w = { ...w, atoms: w.atoms.map((a) => (a.kind === 'mnemon' && a.mem ? { ...a, mem: 0, out: false } : a)) }
  }
  return run(w, 12)
}

const onOff = (b: boolean) => (b ? 'on' : 'off')

/** Check a combinational circuit against every combination of its switches. */
export function truthTable(c: CheckCtx, inputs: string[], names: string[], fn: (bits: boolean[]) => boolean): Verdict {
  const ids = inputs.map((t) => c.setup.tags[t])
  const out = c.setup.tags.lamp
  for (let m = 0; m < 1 << inputs.length; m++) {
    const bits = inputs.map((_, i) => !!((m >> i) & 1))
    let w = c.world
    bits.forEach((b, i) => (w = setSwitch(w, ids[i], b)))
    w = run(powerOn(w), 24)
    const first = outOf(w, out)
    const second = outOf(step(w), out)
    const want = fn(bits)
    if (first !== second || first !== want) {
      const when = names.map((n, i) => `${n} ${onOff(bits[i])}`).join(', ')
      return { solved: false, status: first !== second ? `With ${when} the lamp flickers` : `With ${when} the lamp should be ${onOff(want)}` }
    }
  }
  return { solved: true, status: `All ${1 << inputs.length} switch combinations correct` }
}

/** Does the lamp light within a few ticks on a copy of the field as it stands? */
export function lampLights(c: CheckCtx, tag = 'lamp', ticks = 30): boolean {
  const w = run({ ...c.world, heat: 0 }, ticks)
  return outOf(w, c.setup.tags[tag])
}

/** Smallest period of a sampled signal, or 0 if it never changes. */
export function periodOf(seq: boolean[]): number {
  if (seq.every((v) => v === seq[0])) return 0
  for (let p = 1; p <= seq.length / 2; p++) if (seq.every((v, i) => i + p >= seq.length || v === seq[i + p])) return p
  return -1
}

/** Ticks from flipping a switch until the lamp follows, or -1 within `limit`. */
export function follow(w: World, sw: string, lamp: string, on: boolean, limit = 60): { w: World; ticks: number } {
  w = setSwitch(w, sw, on)
  for (let k = 1; k <= limit; k++) {
    w = step(w)
    if (outOf(w, lamp) === on) return { w, ticks: k }
  }
  return { w, ticks: -1 }
}

export { outOf, onOff }

/** Cells next to (x, y), for layout helpers. */
export const around = (x: number, y: number) => Array.from({ length: SIDES }, (_, s) => neighbor(x, y, s))

export { buildGraph }
