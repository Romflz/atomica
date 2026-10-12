import { makeAtom } from './atoms'
import type { Atom, AtomKind, World } from './types'

export interface Note {
  x: number
  y: number
  text: string
}

export interface Scene {
  world: World
  notes: Note[]
}

export interface Size {
  cols: number
  rows: number
}

export const DEFAULT_SIZE: Size = { cols: 36, rows: 22 }

export const SIZE_PRESETS: { name: string; cols: number; rows: number }[] = [
  { name: 'Petri', cols: 24, rows: 16 },
  { name: 'Lab', cols: 36, rows: 22 },
  { name: 'Arena', cols: 60, rows: 36 },
  { name: 'Biome', cols: 100, rows: 60 },
  { name: 'Colossal', cols: 200, rows: 120 },
]
export const MIN_SIZE = { cols: 8, rows: 6 }
export const MAX_SIZE = { cols: 240, rows: 150 }

export const emptyWorld = (size: Size = DEFAULT_SIZE, heat = 0): World => ({ ...size, tick: 0, atoms: [], heat })

/** [kind, x, y, rot?, extra?] relative to a stamp origin. */
type Spec = [AtomKind, number, number, number?, Partial<Atom>?]

/** Rotate a relative blueprint by quarter turns clockwise and place it at (ox, oy). */
function stamp(specs: Spec[], ox: number, oy: number, turns = 0, extra: Partial<Atom> = {}): Spec[] {
  return specs.map(([k, x, y, rot = 0, e = {}]) => {
    let dx = x
    let dy = y
    for (let i = 0; i < turns; i++) [dx, dy] = [-dy, dx]
    return [k, ox + dx, oy + dy, (rot + turns) % 4, { ...extra, ...e }]
  })
}

const build = (specs: Spec[], pinned = false): Atom[] =>
  specs.map(([k, x, y, rot = 0, extra = {}]) => makeAtom(k, x, y, rot, { pinned, ...extra }))

/** Small deterministic PRNG so hand-tuned scenes look the same every time. */
function mulberry(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Scatter loose atoms on free cells, keeping a one-cell moat around everything already placed. */
function scatter(specs: Spec[], size: Size, n: number, kinds: AtomKind[], seed: number, extra: Partial<Atom> = {}) {
  const rand = mulberry(seed)
  const taken = new Set(specs.map(([, x, y]) => `${x},${y}`))
  const near = (x: number, y: number) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => taken.has(`${x + dx},${y + dy}`)))
  let placed = 0
  for (let tries = 0; placed < n && tries < n * 60; tries++) {
    const x = 1 + Math.floor(rand() * (size.cols - 2))
    const y = 1 + Math.floor(rand() * (size.rows - 2))
    if (near(x, y)) continue
    taken.add(`${x},${y}`)
    specs.push([kinds[Math.floor(rand() * kinds.length)], x, y, Math.floor(rand() * 4), extra])
    placed++
  }
}

// ── Blueprints (drawn facing north; stamp() rotates them) ───────────

/** Spark-powered thruster that turns at random: Quanta pulses a Gyron. */
const WANDERER = (chance = 0.12): Spec[] => [
  ['spark', -1, 0, 0, { on: true }],
  ['propulsor', 0, 0],
  ['gyron', 1, 0],
  ['quanta', 1, -1, 0, { chance }],
]

/**
 * Hunter, nine atoms with a tiny brain:
 *  - the Oculus looks forward through its own Devourer;
 *  - seeing fires the Propulsor directly, and the mouth via two Orium relays
 *    (their exposed sides are slots, which Lumen plankton cannot stick to);
 *  - a Gyron turns it at random, but only while nothing is in view:
 *    Gyron = Quanta AND NOT(seeing).
 */
const PREDATOR: Spec[] = [
  ['devourer', 0, 0],
  ['or', 1, 0, 2],
  ['oculus', 0, 1, 0, { radius: 8 }],
  ['or', 1, 1, 3],
  ['propulsor', -1, 1],
  ['not', 0, 2, 1],
  ['and', 0, 3],
  ['quanta', -1, 3, 0, { chance: 0.2 }],
  ['gyron', 1, 3, 1],
]

/** A pinned printer: a Pulsar clocks a Fabricator copying the Lumen it holds. */
const FACTORY = (period = 6): Spec[] => [
  ['fabricator', 0, 0],
  ['lumen', 0, 1],
  ['pulsar', -1, 0, 0, { period }],
  ['repulsar', 0, -3, 0, { radius: 3 }],
]

/** Three Repulsars held by a Clasp; a Pulsar via a Negon opens it after `period / 2` ticks. */
const SPORE = (period: number): Spec[] => [
  ['pulsar', -2, 0, 0, { period }],
  ['not', -1, 0],
  ['clasp', 0, 0],
  ['repulsar', 1, 0, 0, { radius: 4 }],
  ['repulsar', 0, -1, 3, { radius: 4 }],
  ['repulsar', 0, 1, 1, { radius: 4 }],
]

// ── Scenes ──────────────────────────────────────────────────────────

/** Two sparks feeding a 2-input gate, wired out to a lamp. */
function gateBench(kind: AtomKind, gx: number, gy: number, a: boolean, b: boolean): Spec[] {
  return [
    ['spark', gx, gy - 2, 0, { on: a }],
    ['conduit', gx, gy - 1],
    [kind, gx, gy],
    ['conduit', gx, gy + 1],
    ['spark', gx, gy + 2, 0, { on: b }],
    ['conduit', gx + 1, gy],
    ['conduit', gx + 2, gy],
    ['lumen', gx + 3, gy],
  ]
}

function logicLab(): Scene {
  const specs: Spec[] = [
    ...gateBench('and', 3, 4, true, true),
    ...gateBench('or', 10, 4, true, false),
    ...gateBench('xor', 17, 4, true, true),

    // Clock and its inverse.
    ['pulsar', 3, 11],
    ['conduit', 4, 11],
    ['conduit', 5, 11],
    ['not', 6, 11],
    ['conduit', 7, 11],
    ['lumen', 8, 11],
    ['conduit', 4, 12],
    ['lumen', 4, 13],

    // Ring oscillator: a Negon fed its own output.
    ['not', 12, 11],
    ['conduit', 13, 11],
    ['conduit', 13, 12],
    ['conduit', 12, 12],
    ['conduit', 11, 12],
    ['conduit', 11, 11],
    ['lumen', 14, 11],

    // Half adder: A and B into Xorium (sum) and Andium (carry).
    ['spark', 24, 12, 0, { on: true }],
    ['conduit', 25, 9],
    ['conduit', 25, 10],
    ['conduit', 25, 11],
    ['conduit', 25, 12],
    ['conduit', 25, 13],
    ['conduit', 25, 14],
    ['conduit', 25, 15],
    ['conduit', 26, 9],
    ['conduit', 27, 9],
    ['conduit', 26, 15],
    ['conduit', 27, 15],
    ['xor', 27, 10],
    ['and', 27, 14],
    ['spark', 28, 12, 0, { on: false }],
    ['conduit', 27, 11],
    ['conduit', 27, 12],
    ['conduit', 27, 13],
    ['conduit', 28, 10],
    ['conduit', 29, 10],
    ['lumen', 30, 10],
    ['conduit', 28, 14],
    ['conduit', 29, 14],
    ['lumen', 30, 14],

    // Wireless: a Spark into one Entanglon lights a lamp on its twin.
    ['spark', 2, 19, 0, { on: true }],
    ['entangler', 3, 19],
    ['entangler', 6, 19],
    ['lumen', 7, 19],

    // Memory: each time the Spark turns on, the stored bit flips.
    ['spark', 11, 19],
    ['mnemon', 12, 19],
    ['lumen', 13, 19],

    // Delay line: the delayed lamp trails the direct one by 4 ticks.
    ['pulsar', 17, 19, 0, { period: 16 }],
    ['chronon', 18, 19, 0, { delay: 4 }],
    ['lumen', 19, 19],
    ['lumen', 17, 20],

    // Noise.
    ['quanta', 24, 19, 0, { chance: 0.35 }],
    ['lumen', 25, 19],
  ]
  return {
    world: { ...emptyWorld(), atoms: build(specs, true) },
    notes: [
      { x: 3, y: 1, text: 'AND' },
      { x: 10, y: 1, text: 'OR' },
      { x: 17, y: 1, text: 'XOR' },
      { x: 3, y: 9, text: 'CLOCK + INVERSE' },
      { x: 11, y: 9, text: 'RING OSCILLATOR' },
      { x: 24, y: 7, text: 'HALF ADDER' },
      { x: 23, y: 12, text: 'A' },
      { x: 29, y: 12, text: 'B' },
      { x: 31, y: 10, text: 'SUM' },
      { x: 31, y: 14, text: 'CARRY' },
      { x: 2, y: 17, text: 'WIRELESS' },
      { x: 10, y: 17, text: 'MEMORY' },
      { x: 16, y: 17, text: 'DELAY' },
      { x: 23, y: 17, text: 'NOISE' },
    ],
  }
}

function binaryCounter(): Scene {
  const bits = 8
  const specs: Spec[] = [['pulsar', 2, 10, 0, { period: 4 }], ['spark', 1, 8]]
  for (let x = 2; x <= 2 + bits * 3; x++) specs.push(['conduit', x, 8])
  for (let i = 0; i < bits; i++) {
    const x = 3 + i * 3
    specs.push(['conduit', x, 9], ['mnemon', x, 10], ['conduit', x + 1, 10], ['lumen', x + 1, 11])
    // Each bit toggles when the previous one falls: feed its inverse onward.
    if (i < bits - 1) specs.push(['not', x + 2, 10])
  }
  return {
    world: { ...emptyWorld({ cols: 30, rows: 15 }), atoms: build(specs, true) },
    notes: [
      { x: 2, y: 5, text: '8-BIT RIPPLE COUNTER' },
      { x: 2, y: 13, text: 'LSB' },
      { x: 24, y: 13, text: 'MSB' },
      { x: 0, y: 7, text: 'RESET' },
    ],
  }
}

function lightShow(): Scene {
  const rows: [number, number, AtomKind][] = [
    [8, 1, 'pulsar'],
    [12, 1, 'pulsar'],
    [16, 2, 'pulsar'],
    [6, 1, 'pulsar'],
    [20, 1, 'pulsar'],
    [10, 3, 'pulsar'],
    [0, 1, 'quanta'],
  ]
  const specs: Spec[] = []
  rows.forEach(([period, delay, src], r) => {
    const y = 2 + r * 4
    specs.push([src, 2, y, 0, src === 'pulsar' ? { period } : { chance: 0.3 }])
    for (let i = 0; i < 20; i++) {
      specs.push(['chronon', 3 + i * 2, y, 0, { delay }], ['conduit', 4 + i * 2, y], ['lumen', 4 + i * 2, y + 1])
    }
  })
  return {
    world: { ...emptyWorld({ cols: 46, rows: 30 }), atoms: build(specs, true) },
    notes: [{ x: 2, y: 0, text: 'CHRONON MARQUEES · EVERY ROW A DIFFERENT RHYTHM' }],
  }
}

function wireless(): Scene {
  const receiver = (x: number, y: number, ch: number): Spec[] => [
    ['entangler', x, y, 0, { channel: ch }],
    ['lumen', x + 1, y],
  ]
  const specs: Spec[] = [
    ['spark', 16, 10, 0, { on: true }],
    ['entangler', 17, 10, 0, { channel: 0 }],
    ['pulsar', 16, 5, 0, { period: 10 }],
    ['entangler', 17, 5, 0, { channel: 1 }],
    ['quanta', 16, 15, 0, { chance: 0.3 }],
    ['entangler', 17, 15, 0, { channel: 2 }],
    ...receiver(3, 3, 0),
    ...receiver(30, 3, 0),
    ...receiver(3, 17, 0),
    ...receiver(30, 17, 0),
    ...receiver(9, 2, 1),
    ...receiver(24, 18, 1),
    ...receiver(3, 10, 1),
    ...receiver(24, 2, 2),
    ...receiver(9, 18, 2),
    ...receiver(30, 10, 2),
    // A remote-controlled memory: the channel-0 signal toggles a Mnemon far away.
    ['entangler', 10, 10, 0, { channel: 0 }],
    ['mnemon', 11, 10],
    ['lumen', 12, 10],
  ]
  return {
    world: { ...emptyWorld(), atoms: build(specs, true) },
    notes: [
      { x: 14, y: 8, text: 'CLICK THE SPARK' },
      { x: 19, y: 5, text: 'CH 2 · PULSAR' },
      { x: 19, y: 10, text: 'CH 1 · SPARK' },
      { x: 19, y: 15, text: 'CH 3 · QUANTA' },
    ],
  }
}

function foodChain(): Scene {
  const size = { cols: 48, rows: 30 }
  const pinnedFactories = [...stamp(FACTORY(4), 6, 15, 1), ...stamp(FACTORY(6), 41, 14, 3)]
  const specs: Spec[] = [
    ...stamp(PREDATOR, 16, 6, 1),
    ...stamp(PREDATOR, 32, 23, 3),
    ...stamp(PREDATOR, 24, 13, 0),
    ...stamp(WANDERER(0.1), 12, 25, 0),
    ...stamp(WANDERER(0.1), 37, 4, 2),
  ]
  const all: Spec[] = [...pinnedFactories, ...specs]
  scatter(all, size, 45, ['lumen'], 11)
  const atoms = [...build(all.slice(0, pinnedFactories.length), true), ...build(all.slice(pinnedFactories.length))]
  return {
    world: { ...emptyWorld(size, 0.06), atoms },
    notes: [{ x: 1, y: 0, text: 'FABRICATORS PRINT PLANKTON · PREDATORS SEE, CHASE AND EAT IT' }],
  }
}

function swarm(): Scene {
  const size = { cols: 60, rows: 36 }
  const rand = mulberry(5)
  const specs: Spec[] = []
  const taken = new Set<string>()
  let made = 0
  for (let tries = 0; made < 18 && tries < 2000; tries++) {
    const ox = 3 + Math.floor(rand() * (size.cols - 6))
    const oy = 3 + Math.floor(rand() * (size.rows - 6))
    const turns = Math.floor(rand() * 4)
    const body = stamp(WANDERER(0.08 + rand() * 0.1), ox, oy, turns)
    const clash = body.some(([, x, y]) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => taken.has(`${x + dx},${y + dy}`))))
    if (clash) continue
    body.forEach(([, x, y]) => taken.add(`${x},${y}`))
    specs.push(...body)
    made++
  }
  scatter(specs, size, 40, ['lumen', 'lumen', 'conduit'], 21)
  return {
    world: { ...emptyWorld(size, 0.02), atoms: build(specs) },
    notes: [{ x: 1, y: 0, text: 'WANDERERS LATCH ONTO WHATEVER THEY BUMP INTO' }],
  }
}

function sporeBurst(): Scene {
  const specs: Spec[] = []
  const periods = [24, 40, 56, 72, 88, 104]
  periods.forEach((p, i) => specs.push(...stamp(SPORE(p), 7 + (i % 3) * 12, 6 + Math.floor(i / 3) * 11, i % 4)))
  scatter(specs, { cols: 40, rows: 24 }, 24, ['conduit', 'lumen', 'and', 'or'], 31)
  return {
    world: { ...emptyWorld({ cols: 40, rows: 24 }), atoms: build(specs) },
    notes: [{ x: 1, y: 0, text: 'EACH CLASP LETS GO ON ITS OWN SCHEDULE' }],
  }
}

function accretion(): Scene {
  // Seed crystal: a Magnetar caged in a charged conduit lattice that anything can dock onto.
  const specs: Spec[] = [
    ['magnetar', 18, 11, 0, { radius: 10 }],
    ['spark', 17, 11, 0, { on: true }],
    ['conduit', 16, 11],
    ['conduit', 17, 10],
    ['conduit', 18, 10],
    ['conduit', 19, 10],
    ['conduit', 19, 11],
    ['conduit', 19, 12],
    ['conduit', 18, 12],
    ['conduit', 17, 12],
  ]
  const debris: AtomKind[] = ['conduit', 'conduit', 'conduit', 'and', 'or', 'xor', 'not', 'lumen', 'lumen', 'lumen', 'pulsar']
  const rand = mulberry(7)
  const taken = new Set(specs.map(([, x, y]) => `${x},${y}`))
  let n = 0
  while (n < 40) {
    const ang = rand() * Math.PI * 2
    const r = 4 + rand() * 6
    const x = Math.round(18 + Math.cos(ang) * r)
    const y = Math.round(11 + Math.sin(ang) * r)
    if (x < 0 || y < 0 || x >= 36 || y >= 22 || taken.has(`${x},${y}`)) continue
    taken.add(`${x},${y}`)
    specs.push([debris[Math.floor(rand() * debris.length)], x, y, Math.floor(rand() * 4)])
    n++
  }
  return {
    world: { ...emptyWorld(), atoms: build(specs) },
    notes: [{ x: 11, y: 0, text: 'DEBRIS TUMBLES, DOCKS, AND WAKES UP' }],
  }
}

function chasers(): Scene {
  const specs: Spec[] = [
    // A plain predator/prey pair.
    ['magnetar', 8, 5],
    ['repulsar', 11, 6],
    // A heartbeat swimmer: the Pulsar switches its Magnetar on and off.
    ['pulsar', 20, 11, 0, { period: 6 }],
    ['magnetar', 21, 11],
    ['repulsar', 24, 13],
    // A lit creature: Spark powers a lamp riding on the attractor.
    ['spark', 9, 16, 0, { on: true }],
    ['magnetar', 10, 16],
    ['lumen', 9, 17],
    ['repulsar', 12, 18],
    // Loose plankton to bump into.
    ['conduit', 28, 4],
    ['conduit', 29, 4],
    ['lumen', 30, 4],
    ['or', 30, 17],
    ['conduit', 15, 3],
    ['not', 4, 12],
    ['conduit', 32, 10],
    ['lumen', 33, 10],
  ]
  return {
    world: { ...emptyWorld(DEFAULT_SIZE, 0.06), atoms: build(specs) },
    notes: [{ x: 1, y: 0, text: 'ATTRACT + REPEL = PURSUIT. NEITHER FEELS ITS OWN FIELD' }],
  }
}

const SOUP_MIX: [AtomKind, number][] = [
  ['conduit', 22],
  ['and', 5],
  ['or', 5],
  ['xor', 4],
  ['not', 6],
  ['lumen', 11],
  ['spark', 8],
  ['pulsar', 5],
  ['quanta', 3],
  ['magnetar', 8],
  ['repulsar', 7],
  ['clasp', 3],
  ['mnemon', 2],
  ['chronon', 2],
  ['oculus', 3],
  ['propulsor', 4],
  ['gyron', 3],
  ['entangler', 2],
  ['devourer', 2],
  ['fabricator', 1],
]

export function primordialSoup(size: Size = { cols: 60, rows: 36 }, seed = Math.floor(Math.random() * 1e9)): Scene {
  const rand = mulberry(seed)
  const total = SOUP_MIX.reduce((s, [, w]) => s + w, 0)
  const pick = (): AtomKind => {
    let r = rand() * total
    for (const [k, w] of SOUP_MIX) {
      r -= w
      if (r <= 0) return k
    }
    return 'conduit'
  }
  const atoms: Atom[] = []
  for (let y = 0; y < size.rows; y++) {
    for (let x = 0; x < size.cols; x++) {
      if (rand() > 0.17) continue
      const kind = pick()
      atoms.push(
        makeAtom(kind, x, y, Math.floor(rand() * 4), {
          ...(kind === 'spark' ? { on: rand() < 0.6 } : {}),
          ...(kind === 'pulsar' ? { period: 4 + Math.floor(rand() * 6) * 2 } : {}),
          ...(kind === 'quanta' ? { chance: 0.1 + rand() * 0.4 } : {}),
          ...(kind === 'entangler' ? { channel: Math.floor(rand() * 4) } : {}),
          ...(kind === 'magnetar' || kind === 'repulsar' ? { radius: 3 + Math.floor(rand() * 3) } : {}),
        }),
      )
    }
  }
  return { world: { ...emptyWorld(size, 0.12), atoms }, notes: [] }
}

export interface SceneDef {
  id: string
  name: string
  hint: string
  /** Scenes that adapt to the current field size receive it. */
  make: (size: Size) => Scene
}

export const SCENES: SceneDef[] = [
  { id: 'foodchain', name: 'Food Chain', hint: 'Printers make plankton; sighted predators hunt it', make: foodChain },
  { id: 'swarm', name: 'Swarm', hint: '18 random walkers that latch together into super-organisms', make: swarm },
  { id: 'chasers', name: 'Chasers', hint: 'Attract/repel pairs that hunt each other', make: chasers },
  { id: 'spores', name: 'Spore Burst', hint: 'Clasp-bound cells split apart on staggered timers', make: sporeBurst },
  { id: 'accretion', name: 'Accretion', hint: 'A Magnetar gathers debris into one living molecule', make: accretion },
  { id: 'soup', name: 'Primordial Soup', hint: 'Random chemistry at your field size. Watch what emerges.', make: (size) => primordialSoup(size) },
  { id: 'lab', name: 'Logic Lab', hint: 'Gates, clocks, a half adder, memory, delay, wireless', make: logicLab },
  { id: 'counter', name: 'Binary Counter', hint: 'Eight Mnemons counting to 255', make: binaryCounter },
  { id: 'lights', name: 'Light Show', hint: 'Chronon marquees racing in different rhythms', make: lightShow },
  { id: 'wireless', name: 'Wireless Web', hint: 'Entanglon channels light lamps across the void', make: wireless },
  { id: 'empty', name: 'Empty Field', hint: 'A blank sandbox at your field size', make: (size) => ({ world: emptyWorld(size), notes: [] }) },
]
