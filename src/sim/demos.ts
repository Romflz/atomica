import { makeAtom } from './atoms'
import { cellAt, centerOf, neighbor, translate, turnDelta } from './hex'
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

// Hex rows are only √3/2 of a cell apart, so fields get a few more rows than columns would suggest.
export const DEFAULT_SIZE: Size = { cols: 36, rows: 26 }

export const SIZE_PRESETS: { name: string; cols: number; rows: number }[] = [
  { name: 'Petri', cols: 24, rows: 18 },
  { name: 'Lab', cols: 36, rows: 26 },
  { name: 'Arena', cols: 60, rows: 42 },
  { name: 'Biome', cols: 100, rows: 70 },
  { name: 'Colossal', cols: 200, rows: 140 },
]
export const MIN_SIZE = { cols: 8, rows: 6 }
export const MAX_SIZE = { cols: 240, rows: 170 }

export const emptyWorld = (size: Size = DEFAULT_SIZE, heat = 0): World => ({ ...size, tick: 0, atoms: [], heat })

/**
 * [kind, q, r, rot?, extra?]. In a blueprint, (q, r) is an axial offset from
 * the blueprint's anchor; after `stamp` it is an absolute cell (column, row).
 */
type Spec = [AtomKind, number, number, number?, Partial<Atom>?]

/** Place a blueprint at cell (ox, oy), turned `turns` sixths of a turn clockwise. */
function stamp(specs: Spec[], ox: number, oy: number, turns = 0, extra: Partial<Atom> = {}): Spec[] {
  return specs.map(([k, q, r, rot = 0, e = {}]) => {
    let [dq, dr] = [q, r]
    for (let i = 0; i < turns; i++) [dq, dr] = turnDelta(dq, dr)
    const [x, y] = translate(ox, oy, dq, dr)
    return [k, x, y, (rot + turns) % 6, { ...extra, ...e }]
  })
}

/** The absolute cell at an axial offset from an anchor, for placing notes beside blueprints. */
const cellNear = (ox: number, oy: number, q: number, r: number) => {
  const [x, y] = translate(ox, oy, q, r)
  return { x, y }
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

/** A cell and its six neighbours. */
const around = (x: number, y: number) => [[x, y], ...[0, 1, 2, 3, 4, 5].map((s) => neighbor(x, y, s))]

/** Scatter loose atoms on free cells, keeping a one-cell moat around everything already placed. */
function scatter(specs: Spec[], size: Size, n: number, kinds: AtomKind[], seed: number, extra: Partial<Atom> = {}) {
  const rand = mulberry(seed)
  const taken = new Set(specs.map(([, x, y]) => `${x},${y}`))
  const near = (x: number, y: number) => around(x, y).some(([nx, ny]) => taken.has(`${nx},${ny}`))
  let placed = 0
  for (let tries = 0; placed < n && tries < n * 60; tries++) {
    const x = 1 + Math.floor(rand() * (size.cols - 2))
    const y = 1 + Math.floor(rand() * (size.rows - 2))
    if (near(x, y)) continue
    taken.add(`${x},${y}`)
    specs.push([kinds[Math.floor(rand() * kinds.length)], x, y, Math.floor(rand() * 6), extra])
    placed++
  }
}

// ── Blueprints (drawn facing east; stamp() turns them) ──────────────

/** Spark-powered thruster that turns at random: a Quanta pulses a Gyron. */
const WANDERER = (chance = 0.12): Spec[] => [
  ['propulsor', 0, 0],
  ['spark', 0, -1, 0, { on: true }],
  ['gyron', -1, 1, 1],
  ['quanta', 0, 1, 0, { chance }],
]

/**
 * Hunter, sixteen atoms with a tiny brain:
 *  - the Oculus looks forward through its own Devourer;
 *  - seeing fires the Propulsor, so it charges at whatever it spots;
 *  - an unfed Negon is a battery that keeps the mouth hungry;
 *  - a Gyron turns it at random, but only while nothing is in view:
 *    Gyron = Quanta AND NOT(seeing);
 *  - eight Lumen photophores cap every tab and grip on its skin, so drifting
 *    plankton has nothing to stick to. They glow while it hunts and flicker
 *    with its random impulses.
 */
const PREDATOR: Spec[] = [
  ['oculus', 0, 0, 0, { radius: 8 }],
  ['devourer', 1, 0],
  ['propulsor', -1, 1],
  ['not', 1, -1, 5],
  ['and', 2, -2],
  ['gyron', 3, -2],
  ['quanta', 1, -2, 0, { chance: 0.2 }],
  ['not', 2, -1, 2],
  ['lumen', 0, 1],
  ['lumen', -1, 0],
  ['lumen', 0, -1],
  ['lumen', 4, -2],
  ['lumen', 3, -3],
  ['lumen', 0, -2],
  ['lumen', 1, -3],
  ['lumen', 2, -3],
]

/**
 * A pinned printer: a Pulsar clocks a Fabricator copying the Lumen it holds.
 * Lumens cap the Pulsar's spare tabs (and blink with it), so drifting
 * plankton has nothing to stick to.
 */
const FACTORY = (period = 6): Spec[] => [
  ['fabricator', 0, 0],
  ['lumen', -1, 0],
  ['pulsar', 0, -1, 0, { period }],
  ['lumen', 1, -1],
  ['lumen', 1, -2],
  ['lumen', 0, -2],
  ['lumen', -1, -1],
  // Keeps the output clear so the printer never jams.
  ['repulsar', 3, 0, 0, { radius: 3 }],
]

/** Three Repulsars held by a Clasp; a Pulsar via a Negon opens it after `period / 2` ticks. */
const SPORE = (period: number): Spec[] => [
  ['pulsar', -2, 0, 0, { period }],
  ['not', -1, 0],
  ['clasp', 0, 0],
  ['repulsar', 1, 0, 0, { radius: 4 }],
  ['repulsar', 0, 1, 1, { radius: 4 }],
  ['repulsar', 1, -1, 5, { radius: 4 }],
]

/** Two sparks feeding a 2-input gate through its back slots, wired out to a lamp. */
const GATE_BENCH = (kind: AtomKind, a: boolean, b: boolean): Spec[] => [
  ['spark', 0, -2, 0, { on: a }],
  ['conduit', 0, -1],
  [kind, 0, 0],
  ['conduit', -1, 1],
  ['spark', -2, 2, 0, { on: b }],
  ['conduit', 1, 0],
  ['conduit', 2, 0],
  ['lumen', 3, 0],
]

/**
 * Half adder. A and B each reach both gates without their wires touching:
 * B runs straight down between the gates, A loops around the outside.
 */
const HALF_ADDER: Spec[] = [
  ['xor', 0, 0],
  ['and', -2, 4],
  // B: down the middle, from Xorium's lower slot to Andium's upper slot.
  ['spark', 0, 2, 0, { on: false }],
  ['conduit', -1, 1],
  ['conduit', -1, 2],
  ['conduit', -2, 3],
  // A: from Xorium's upper slot, round the left, into Andium's lower slot.
  ['spark', -5, 3, 0, { on: true }],
  ['conduit', 0, -1],
  ['conduit', -1, -1],
  ['conduit', -2, 0],
  ['conduit', -3, 1],
  ['conduit', -3, 2],
  ['conduit', -4, 3],
  ['conduit', -4, 4],
  ['conduit', -4, 5],
  ['conduit', -3, 5],
  // Sum and carry out to lamps.
  ['conduit', 1, 0],
  ['conduit', 2, 0],
  ['lumen', 3, 0],
  ['conduit', -1, 4],
  ['conduit', 0, 4],
  ['lumen', 1, 4],
]

// ── Scenes ──────────────────────────────────────────────────────────

function logicLab(): Scene {
  const specs: Spec[] = [
    ...stamp(GATE_BENCH('and', true, true), 5, 4),
    ...stamp(GATE_BENCH('or', true, false), 13, 4),
    ...stamp(GATE_BENCH('xor', true, true), 21, 4),

    // Clock and its inverse.
    ...stamp(
      [
        ['pulsar', 0, 0],
        ['conduit', 1, 0],
        ['conduit', 2, 0],
        ['not', 3, 0],
        ['conduit', 4, 0],
        ['lumen', 5, 0],
        ['conduit', 1, 1],
        ['lumen', 1, 2],
      ],
      2,
      12,
    ),

    // Ring oscillator: a Negon fed its own output.
    ...stamp(
      [
        ['not', 0, 0],
        ['conduit', 1, 0],
        ['conduit', 1, -1],
        ['conduit', 0, -1],
        ['conduit', -1, 0],
        ['lumen', 2, 0],
      ],
      13,
      12,
    ),

    ...stamp(HALF_ADDER, 29, 11),

    // Wireless: a Spark into one Entanglon lights a lamp on its twin.
    ...stamp(
      [
        ['spark', 0, 0, 0, { on: true }],
        ['entangler', 1, 0],
        ['entangler', 4, 0],
        ['lumen', 5, 0],
      ],
      2,
      21,
    ),

    // Memory: each time the Spark turns on, the stored bit flips.
    ...stamp(
      [
        ['spark', 0, 0],
        ['mnemon', 1, 0],
        ['lumen', 2, 0],
      ],
      11,
      21,
    ),

    // Delay line: the delayed lamp trails the direct one by 4 ticks.
    ...stamp(
      [
        ['pulsar', 0, 0, 0, { period: 16 }],
        ['chronon', 1, 0, 0, { delay: 4 }],
        ['lumen', 2, 0],
        ['lumen', -1, 1],
      ],
      18,
      21,
    ),

    // Noise.
    ...stamp(
      [
        ['quanta', 0, 0, 0, { chance: 0.35 }],
        ['lumen', 1, 0],
      ],
      26,
      21,
    ),
  ]
  return {
    world: { ...emptyWorld(), atoms: build(specs, true) },
    notes: [
      { x: 2, y: 1, text: 'AND' },
      { x: 10, y: 1, text: 'OR' },
      { x: 18, y: 1, text: 'XOR' },
      { x: 2, y: 9, text: 'CLOCK + INVERSE' },
      { x: 11, y: 9, text: 'RING OSCILLATOR' },
      { x: 25, y: 9, text: 'HALF ADDER' },
      { ...cellNear(29, 11, -6, 3), text: 'A' },
      { ...cellNear(29, 11, 1, 2), text: 'B' },
      { ...cellNear(29, 11, 4, 0), text: 'SUM' },
      { ...cellNear(29, 11, 2, 4), text: 'CARRY' },
      { x: 2, y: 19, text: 'WIRELESS' },
      { x: 11, y: 19, text: 'MEMORY' },
      { x: 17, y: 19, text: 'DELAY' },
      { x: 25, y: 19, text: 'NOISE' },
    ],
  }
}

/**
 * Eight Mnemons in a row. Each one's bit runs through a Negon into the next
 * one's toggle slot, so a bit flips whenever the previous one falls. A reset
 * bus runs above, dropping into every Mnemon's upper (reset) slot.
 */
function binaryCounter(): Scene {
  const bits = 8
  const bp: Spec[] = [
    ['pulsar', -2, 1, 0, { period: 4 }],
    // Relay: keeps the clock's tabs away from the reset bus.
    ['or', -1, 0],
    ['spark', -1, -2],
  ]
  for (let q = 0; q <= bits * 3 - 2; q++) bp.push(['conduit', q, -2])
  for (let i = 0; i < bits; i++) {
    const q = i * 3
    bp.push(['conduit', q, -1], ['mnemon', q, 0], ['conduit', q + 1, 0], ['lumen', q + 1, 1])
    if (i < bits - 1) bp.push(['not', q + 2, 0])
  }
  const [ox, oy] = [3, 5]
  return {
    world: { ...emptyWorld({ cols: 28, rows: 10 }), atoms: build(stamp(bp, ox, oy), true) },
    notes: [
      { x: 2, y: 0, text: '8-BIT RIPPLE COUNTER' },
      { ...cellNear(ox, oy, -1, 2), text: 'LSB' },
      { ...cellNear(ox, oy, 21, 2), text: 'MSB' },
      { ...cellNear(ox, oy, -3, -1), text: 'RESET' },
    ],
  }
}

function lightShow(): Scene {
  const lanes: [number, number, AtomKind][] = [
    [8, 1, 'pulsar'],
    [12, 1, 'pulsar'],
    [16, 2, 'pulsar'],
    [6, 1, 'pulsar'],
    [20, 1, 'pulsar'],
    [10, 3, 'pulsar'],
    [0, 1, 'quanta'],
  ]
  const specs: Spec[] = []
  lanes.forEach(([period, delay, src], lane) => {
    const bp: Spec[] = [[src, 0, 0, 0, src === 'pulsar' ? { period } : { chance: 0.3 }]]
    for (let i = 0; i < 20; i++) bp.push(['chronon', 1 + i * 2, 0, 0, { delay }], ['conduit', 2 + i * 2, 0], ['lumen', 2 + i * 2, 1])
    specs.push(...stamp(bp, 2, 2 + lane * 4))
  })
  return {
    world: { ...emptyWorld({ cols: 46, rows: 30 }), atoms: build(specs, true) },
    notes: [{ x: 2, y: 0, text: 'CHRONON MARQUEES · EVERY ROW A DIFFERENT RHYTHM' }],
  }
}

function wireless(): Scene {
  // East neighbours share a row, so these pairs can use plain cell coordinates.
  const receiver = (x: number, y: number, ch: number): Spec[] => [
    ['entangler', x, y, 0, { channel: ch }],
    ['lumen', x + 1, y],
  ]
  const specs: Spec[] = [
    ['spark', 16, 12, 0, { on: true }],
    ['entangler', 17, 12, 0, { channel: 0 }],
    ['pulsar', 16, 6, 0, { period: 10 }],
    ['entangler', 17, 6, 0, { channel: 1 }],
    ['quanta', 16, 18, 0, { chance: 0.3 }],
    ['entangler', 17, 18, 0, { channel: 2 }],
    ...receiver(3, 3, 0),
    ...receiver(30, 3, 0),
    ...receiver(3, 22, 0),
    ...receiver(30, 22, 0),
    ...receiver(9, 2, 1),
    ...receiver(24, 23, 1),
    ...receiver(3, 12, 1),
    ...receiver(24, 2, 2),
    ...receiver(9, 23, 2),
    ...receiver(30, 12, 2),
    // A remote-controlled memory: the Spark's channel toggles a Mnemon far away.
    ['entangler', 10, 12, 0, { channel: 0 }],
    ['mnemon', 11, 12],
    ['lumen', 12, 12],
  ]
  return {
    world: { ...emptyWorld(), atoms: build(specs, true) },
    notes: [
      { x: 14, y: 10, text: 'CLICK THE SPARK' },
      { x: 19, y: 6, text: 'CH 2 · PULSAR' },
      { x: 19, y: 12, text: 'CH 1 · SPARK' },
      { x: 19, y: 18, text: 'CH 3 · QUANTA' },
    ],
  }
}

function foodChain(): Scene {
  const size = { cols: 48, rows: 34 }
  const pinnedFactories = [...stamp(FACTORY(4), 6, 17, 0), ...stamp(FACTORY(6), 41, 16, 3)]
  const specs: Spec[] = [
    ...stamp(PREDATOR, 14, 8, 0),
    ...stamp(PREDATOR, 33, 27, 3),
    ...stamp(PREDATOR, 24, 17, 1),
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
  const size = { cols: 60, rows: 42 }
  const rand = mulberry(5)
  const specs: Spec[] = []
  const taken = new Set<string>()
  let made = 0
  for (let tries = 0; made < 18 && tries < 2000; tries++) {
    const ox = 3 + Math.floor(rand() * (size.cols - 6))
    const oy = 3 + Math.floor(rand() * (size.rows - 6))
    const turns = Math.floor(rand() * 6)
    const body = stamp(WANDERER(0.08 + rand() * 0.1), ox, oy, turns)
    const clash = body.some(([, x, y]) => around(x, y).some(([nx, ny]) => taken.has(`${nx},${ny}`)))
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
  const size = { cols: 40, rows: 28 }
  const specs: Spec[] = []
  const periods = [24, 40, 56, 72, 88, 104]
  periods.forEach((p, i) => specs.push(...stamp(SPORE(p), 7 + (i % 3) * 12, 7 + Math.floor(i / 3) * 13, i)))
  scatter(specs, size, 24, ['conduit', 'lumen', 'and', 'or'], 31)
  return {
    world: { ...emptyWorld(size), atoms: build(specs) },
    notes: [{ x: 1, y: 0, text: 'EACH CLASP LETS GO ON ITS OWN SCHEDULE' }],
  }
}

function accretion(): Scene {
  // Seed crystal: a Spark-charged Magnetar ringed by a conduit lattice that anything can dock onto.
  const [cx, cy] = [18, 13]
  const specs: Spec[] = stamp(
    [
      ['magnetar', 0, 0, 0, { radius: 10 }],
      ['spark', -1, 0, 0, { on: true }],
      ['conduit', 0, -1],
      ['conduit', 1, -1],
      ['conduit', 1, 0],
      ['conduit', 0, 1],
      ['conduit', -1, 1],
    ],
    cx,
    cy,
  )
  const debris: AtomKind[] = ['conduit', 'conduit', 'conduit', 'and', 'or', 'xor', 'not', 'lumen', 'lumen', 'lumen', 'pulsar']
  const rand = mulberry(7)
  const taken = new Set(specs.map(([, x, y]) => `${x},${y}`))
  const [px, py] = centerOf(cx, cy)
  let n = 0
  while (n < 40) {
    const ang = rand() * Math.PI * 2
    const r = 4 + rand() * 6
    const [x, y] = cellAt(px + Math.cos(ang) * r, py + Math.sin(ang) * r)
    if (x < 0 || y < 0 || x >= DEFAULT_SIZE.cols || y >= DEFAULT_SIZE.rows || taken.has(`${x},${y}`)) continue
    taken.add(`${x},${y}`)
    specs.push([debris[Math.floor(rand() * debris.length)], x, y, Math.floor(rand() * 6)])
    n++
  }
  return {
    world: { ...emptyWorld(), atoms: build(specs) },
    notes: [{ x: 11, y: 0, text: 'DEBRIS TUMBLES, DOCKS, AND WAKES UP' }],
  }
}

function chasers(): Scene {
  // East neighbours share a row, so plain cell coordinates work for these.
  const specs: Spec[] = [
    // A plain predator/prey pair.
    ['magnetar', 8, 6],
    ['repulsar', 11, 7],
    // A heartbeat swimmer: the Pulsar switches its Magnetar on and off.
    ['pulsar', 20, 13, 0, { period: 6 }],
    ['magnetar', 21, 13],
    ['repulsar', 24, 15],
    // A lit creature: a Spark powers the attractor and a lamp riding on it.
    ['spark', 9, 19, 0, { on: true }],
    ['magnetar', 10, 19],
    ['lumen', ...neighbor(9, 19, 1)],
    ['repulsar', 12, 21],
    // Loose plankton to bump into.
    ['conduit', 28, 4],
    ['conduit', 29, 4],
    ['lumen', 30, 4],
    ['or', 30, 19],
    ['conduit', 15, 3],
    ['not', 4, 14],
    ['conduit', 32, 11],
    ['lumen', 33, 11],
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

export function primordialSoup(size: Size = { cols: 60, rows: 42 }, seed = Math.floor(Math.random() * 1e9)): Scene {
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
        makeAtom(kind, x, y, Math.floor(rand() * 6), {
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
