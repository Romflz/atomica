import type { Atom, AtomKind, Port } from './types'

export type Category = 'Source' | 'Wire' | 'Gate' | 'Memory' | 'Sense' | 'Output' | 'Force' | 'Motion' | 'Life' | 'Terrain'

export interface ComputeCtx {
  /** Values arriving at each bonded `in` slot. Unbonded slots are absent. */
  inputs: boolean[]
  /** Value at a bonded slot by canonical side (0 = E, 1 = SE … 5 = NE); undefined if unbonded. */
  slot: (side: number) => boolean | undefined
  atom: Atom
  tick: number
  /** Is a foreign atom within `range` cells straight ahead of the atom's facing? */
  look: (range: number) => boolean
  /** Did another Entanglon on this atom's channel receive charge last tick? */
  broadcast: () => boolean
}

export type ComputeResult = boolean | (Partial<Atom> & { out: boolean })

export interface AtomDef {
  kind: AtomKind
  name: string
  symbol: string
  number: number
  color: string
  category: Category
  caption: string
  /** Ports in canonical orientation, clockwise from the front: [E, SE, SW, W, NW, NE]. */
  ports: [Port, Port, Port, Port, Port, Port]
  /** Optional names for sides (canonical), e.g. an eye or a mouth. */
  faces?: [string?, string?, string?, string?, string?, string?]
  blurb: string
  rules: string[]
  compute: (ctx: ComputeCtx) => ComputeResult
}

export const SIGNAL = '#ffe14d'
export const CHANNEL_COLORS = ['#38e8ff', '#ff6ee0', '#c6ff4d', '#ffb347']

/** Tab in front, slots on the three back sides. */
const GATE_PORTS: AtomDef['ports'] = ['out', null, 'in', 'in', 'in', null]
/** Tab in front, one slot at the back. */
const INLINE_PORTS: AtomDef['ports'] = ['out', null, null, 'in', null, null]
const ALL_OUT: AtomDef['ports'] = ['out', 'out', 'out', 'out', 'out', 'out']
const FORCE_PORTS: AtomDef['ports'] = [null, null, null, 'in', null, null]

const forceActive = ({ inputs }: ComputeCtx) => inputs.length === 0 || inputs.some(Boolean)
const anyInput = ({ inputs }: ComputeCtx) => inputs.some(Boolean)
/** Fires for exactly one tick when its input goes from OFF to ON. */
const risingEdge = ({ inputs, atom }: ComputeCtx) => {
  const on = inputs.some(Boolean)
  return { out: on && !atom.prev, prev: on }
}

export const DEFS: Record<AtomKind, AtomDef> = {
  spark: {
    kind: 'spark',
    name: 'Spark',
    symbol: 'Sk',
    number: 1,
    color: '#ffc93c',
    category: 'Source',
    caption: 'SWITCH',
    ports: ALL_OUT,
    blurb: 'A charged nucleus you flip by hand. Its charge leaks out of every tab.',
    rules: ['Click to toggle ON / OFF', 'Emits from all six tabs', 'Bonds to any slot or conduit'],
    compute: ({ atom }) => !!atom.on,
  },
  pulsar: {
    kind: 'pulsar',
    name: 'Pulsar',
    symbol: 'Pu',
    number: 2,
    color: '#ff6ee0',
    category: 'Source',
    caption: 'CLOCK',
    ports: ALL_OUT,
    blurb: 'A spinning core that beats on its own rhythm. The heartbeat of any machine.',
    rules: ['ON for half its period, OFF for the rest', 'Period is tunable (2–32 ticks)', 'Emits from all six tabs'],
    compute: ({ atom, tick }) => {
      const p = atom.period ?? 8
      return tick % p < p / 2
    },
  },
  quanta: {
    kind: 'quanta',
    name: 'Quanta',
    symbol: 'Qu',
    number: 11,
    color: '#e6ff4d',
    category: 'Source',
    caption: 'RANDOM',
    ports: ALL_OUT,
    blurb: 'A particle that cannot make up its mind. Fires at random, which is where surprise comes from.',
    rules: ['Each tick: ON with its set probability', 'Probability tunable 0–100%', 'Feed a Gyron for random turning'],
    compute: ({ atom }) => Math.random() < (atom.chance ?? 0.5),
  },
  conduit: {
    kind: 'conduit',
    name: 'Conduit',
    symbol: 'Cu',
    number: 3,
    color: '#8fb3d9',
    category: 'Wire',
    caption: 'WIRE',
    ports: ['io', 'io', 'io', 'io', 'io', 'io'],
    blurb: 'Copper lattice. Chains of conduits share one charge, instantly.',
    rules: ['Bonds on every side, to anything', 'Whole chain is ON if any tab feeds it', 'Zero propagation delay'],
    compute: () => false,
  },
  entangler: {
    kind: 'entangler',
    name: 'Entanglon',
    symbol: 'En',
    number: 12,
    color: '#e0a8ff',
    category: 'Wire',
    caption: 'WIRELESS',
    ports: INLINE_PORTS,
    blurb: 'One half of a quantum pair. What enters one twin leaves every other twin, anywhere on the field.',
    rules: ['Charge into its slot appears at all twins on its channel', 'No wire needed, any distance', '4 channels, 1 tick latency'],
    compute: ({ inputs, broadcast }) => ({ out: broadcast(), mem: inputs.some(Boolean) ? 1 : 0 }),
  },
  clasp: {
    kind: 'clasp',
    name: 'Clasp',
    symbol: 'Cl',
    number: 13,
    color: '#d4a373',
    category: 'Wire',
    caption: 'GRIP',
    ports: ['grip', 'grip', null, 'in', null, 'grip'],
    blurb: 'A three-fingered claw. Holds anything until charged, then lets go so the molecule splits in two.',
    rules: ['Three front grips bond to any port at all', 'Charge its back slot: it releases, splitting the molecule', 'Grips carry no charge'],
    compute: anyInput,
  },
  and: {
    kind: 'and',
    name: 'Andium',
    symbol: 'An',
    number: 4,
    color: '#38e8ff',
    category: 'Gate',
    caption: 'AND',
    ports: GATE_PORTS,
    blurb: 'A picky nucleus. Only fires when every bonded slot is charged.',
    rules: ['ON when all bonded slots are ON', 'Slots on its 3 back sides, tab in front', '1 tick delay'],
    compute: ({ inputs }) => inputs.length > 0 && inputs.every(Boolean),
  },
  or: {
    kind: 'or',
    name: 'Orium',
    symbol: 'Or',
    number: 5,
    color: '#4dffa0',
    category: 'Gate',
    caption: 'OR',
    ports: GATE_PORTS,
    blurb: 'An eager nucleus. Any charge on any slot sets it off.',
    rules: ['ON when any bonded slot is ON', 'Slots on its 3 back sides, tab in front', '1 tick delay'],
    compute: anyInput,
  },
  xor: {
    kind: 'xor',
    name: 'Xorium',
    symbol: 'Xo',
    number: 6,
    color: '#b07cff',
    category: 'Gate',
    caption: 'XOR',
    ports: GATE_PORTS,
    blurb: 'An unstable isotope. Fires on an odd number of charged slots.',
    rules: ['ON when an odd count of slots are ON', 'Slots on its 3 back sides, tab in front', '1 tick delay'],
    compute: ({ inputs }) => inputs.filter(Boolean).length % 2 === 1,
  },
  not: {
    kind: 'not',
    name: 'Negon',
    symbol: 'Ng',
    number: 7,
    color: '#ff5079',
    category: 'Gate',
    caption: 'NOT',
    ports: INLINE_PORTS,
    blurb: 'Antimatter. Glows when starved, goes dark when fed.',
    rules: ['Inverts its single slot', 'ON when nothing is bonded', 'Loop it into itself to oscillate'],
    compute: ({ inputs }) => !inputs.some(Boolean),
  },
  mnemon: {
    kind: 'mnemon',
    name: 'Mnemon',
    symbol: 'Mn',
    number: 14,
    color: '#2ee6c5',
    category: 'Memory',
    caption: 'MEMORY',
    ports: GATE_PORTS,
    faces: ['bit', undefined, 'set', 'toggle', 'reset'],
    blurb: 'A nucleus that remembers. Holds one bit for as long as you like.',
    rules: ['Back slot flips the bit on each rising edge', 'Lower back slot sets it, upper back slot resets it', 'Front tab outputs the stored bit'],
    compute: ({ slot, atom }) => {
      const toggle = !!slot(3)
      let bit = atom.mem ?? 0
      if (toggle && !atom.prev) bit = bit ? 0 : 1
      if (slot(2)) bit = 1
      if (slot(4)) bit = 0
      return { out: bit === 1, mem: bit, prev: toggle }
    },
  },
  chronon: {
    kind: 'chronon',
    name: 'Chronon',
    symbol: 'Ch',
    number: 15,
    color: '#9ad1ff',
    category: 'Memory',
    caption: 'DELAY',
    ports: INLINE_PORTS,
    blurb: 'A pocket of slow time. Whatever goes in comes out later, exactly as it went in.',
    rules: ['Replays its slot N ticks later', 'Delay tunable 1–16 ticks', 'Build rhythms, pulses and timers'],
    compute: ({ inputs, atom }) => {
      const d = Math.max(1, Math.min(16, atom.delay ?? 4))
      const hist = (((atom.mem ?? 0) << 1) | (inputs.some(Boolean) ? 1 : 0)) & ((1 << d) - 1)
      return { out: ((hist >> (d - 1)) & 1) === 1, mem: hist }
    },
  },
  oculus: {
    kind: 'oculus',
    name: 'Oculus',
    symbol: 'Oc',
    number: 16,
    color: '#eef3ff',
    category: 'Sense',
    caption: 'SENSOR',
    ports: [null, 'out', 'out', 'out', 'out', 'out'],
    faces: ['eye'],
    blurb: 'An eye. Stares in one direction and fires when something that is not part of its own body comes into view.',
    rules: ['ON when a foreign atom is within sight', 'Sight range tunable 1–8 cells', 'Its own molecule is transparent to it'],
    compute: ({ look, atom }) => look(atom.radius ?? 4),
  },
  lumen: {
    kind: 'lumen',
    name: 'Lumen',
    symbol: 'Lu',
    number: 8,
    color: '#fff1a6',
    category: 'Output',
    caption: 'LAMP',
    ports: ['in', 'in', 'in', 'in', 'in', 'in'],
    blurb: 'A photon trap. Lights up the field whenever charge reaches it.',
    rules: ['Lights when any slot is ON', 'Slots on all six sides', 'Pure output, never drives'],
    compute: anyInput,
  },
  magnetar: {
    kind: 'magnetar',
    name: 'Magnetar',
    symbol: 'Ma',
    number: 9,
    color: '#5b8cff',
    category: 'Force',
    caption: 'ATTRACT',
    ports: FORCE_PORTS,
    blurb: 'A collapsed star. Drags other molecules toward itself so they snap together and grow.',
    rules: ['Pulls other molecules in its field', 'Blind to its own molecule, so it can be chased', 'Bond a signal to its slot to switch it'],
    compute: forceActive,
  },
  repulsar: {
    kind: 'repulsar',
    name: 'Repulsar',
    symbol: 'Rp',
    number: 10,
    color: '#ff8a2a',
    category: 'Force',
    caption: 'REPEL',
    ports: FORCE_PORTS,
    blurb: 'A radiant core. Shoves other molecules out of its field. Pair it with a Magnetar and they chase.',
    rules: ['Pushes other molecules away', 'Blind to its own molecule, so it can flee', 'Bond a signal to its slot to switch it'],
    compute: forceActive,
  },
  propulsor: {
    kind: 'propulsor',
    name: 'Propulsor',
    symbol: 'Pr',
    number: 17,
    color: '#ff6b45',
    category: 'Motion',
    caption: 'THRUST',
    ports: [null, 'in', 'in', null, 'in', 'in'],
    faces: ['nose', undefined, undefined, 'nozzle'],
    blurb: 'A tiny engine. Charge it and it drives its whole molecule forward, nose first.',
    rules: ['Charged: moves its molecule 1 cell toward its nose', 'Works anywhere, no field needed', 'Slots on all four flanks'],
    compute: anyInput,
  },
  gyron: {
    kind: 'gyron',
    name: 'Gyron',
    symbol: 'Gy',
    number: 18,
    color: '#ff9ecf',
    category: 'Motion',
    caption: 'ROTATE',
    ports: ['grip', 'in', 'grip', 'in', 'grip', 'in'],
    blurb: 'A gyroscope. Every pulse turns its entire molecule a sixth of a turn. This is how creatures steer.',
    rules: ['Each rising edge turns its molecule 60° clockwise', 'Pivots around itself if there is room', 'Grips and slots alternate; grips hold anything'],
    compute: risingEdge,
  },
  fabricator: {
    kind: 'fabricator',
    name: 'Fabricator',
    symbol: 'Fb',
    number: 19,
    color: '#9dff7a',
    category: 'Life',
    caption: 'COPY',
    ports: [null, 'in', 'in', 'grip', 'in', 'in'],
    faces: ['output', undefined, undefined, 'template'],
    blurb: 'A molecular printer. Copies whatever it holds at its back and places the copy in front.',
    rules: ['On each rising edge, copies the atom gripped at its back', 'The copy appears at its front if the cell is free', 'Copies inherit settings: this is reproduction'],
    compute: risingEdge,
  },
  devourer: {
    kind: 'devourer',
    name: 'Devourer',
    symbol: 'Dv',
    number: 20,
    color: '#ff2d55',
    category: 'Life',
    caption: 'EAT',
    ports: [null, 'in', 'in', 'in', 'in', 'in'],
    faces: ['mouth'],
    blurb: 'A hungry void. When charged it erases whatever sits at its mouth. Give it eyes and it hunts.',
    rules: ['Charged: consumes the atom at its mouth', 'Cannot eat pinned atoms or its own body', 'Pair with an Oculus to hunt'],
    compute: anyInput,
  },
  bedrock: {
    kind: 'bedrock',
    name: 'Bedrock',
    symbol: 'Br',
    number: 21,
    color: '#7d88a6',
    category: 'Terrain',
    caption: 'WALL',
    ports: [null, null, null, null, null, null],
    blurb: 'Inert rock that walls off parts of a challenge. Nothing bonds to it and nothing passes through it.',
    rules: ['Bonds to nothing on any side', 'Blocks movement; Oculi can see it', 'Only found in challenges'],
    compute: () => false,
  },
}

export const PALETTE: { title: string; kinds: AtomKind[] }[] = [
  { title: 'Sources', kinds: ['spark', 'pulsar', 'quanta'] },
  { title: 'Wiring', kinds: ['conduit', 'entangler', 'clasp'] },
  { title: 'Logic', kinds: ['and', 'or', 'xor', 'not'] },
  { title: 'Memory & Time', kinds: ['mnemon', 'chronon'] },
  { title: 'Sense & Light', kinds: ['oculus', 'lumen'] },
  { title: 'Forces', kinds: ['magnetar', 'repulsar'] },
  { title: 'Motion', kinds: ['propulsor', 'gyron'] },
  { title: 'Life', kinds: ['fabricator', 'devourer'] },
]

export const isForce = (k: AtomKind) => k === 'magnetar' || k === 'repulsar'

/** Atoms that act toward their canonical front, side 0 (eye, nose, mouth, output). */
export const isDirectional = (k: AtomKind) => k === 'oculus' || k === 'propulsor' || k === 'fabricator' || k === 'devourer'

/** Short live readout shown under an atom's symbol. */
export function captionOf(a: Atom): string {
  switch (a.kind) {
    case 'pulsar':
      return `${a.period ?? 8}T`
    case 'chronon':
      return `${a.delay ?? 4}T`
    case 'quanta':
      return `${Math.round((a.chance ?? 0.5) * 100)}%`
    case 'mnemon':
      return `BIT ${a.mem ? 1 : 0}`
    case 'clasp':
      return a.out ? 'OPEN' : 'GRIP'
    case 'entangler':
      return `CH ${(a.channel ?? 0) + 1}`
    default:
      return DEFS[a.kind].caption
  }
}

/** Settings a Fabricator copies into its offspring. */
export function genesOf(a: Atom): Partial<Atom> {
  const g: Partial<Atom> = {}
  for (const k of ['on', 'period', 'radius', 'delay', 'chance', 'channel'] as const) {
    if (a[k] !== undefined) (g as Record<string, unknown>)[k] = a[k]
  }
  return g
}

let seq = 0
export function makeAtom(kind: AtomKind, x: number, y: number, rot = 0, extra: Partial<Atom> = {}): Atom {
  seq += 1
  return {
    id: `${kind}-${Date.now().toString(36)}-${seq}`,
    kind,
    x,
    y,
    rot,
    pinned: false,
    out: kind === 'not',
    ...(kind === 'spark' ? { on: false } : {}),
    ...(kind === 'pulsar' ? { period: 8 } : {}),
    ...(kind === 'quanta' ? { chance: 0.5 } : {}),
    ...(kind === 'chronon' ? { delay: 4, mem: 0 } : {}),
    ...(kind === 'mnemon' ? { mem: 0 } : {}),
    ...(kind === 'entangler' ? { channel: 0, mem: 0 } : {}),
    ...(kind === 'oculus' ? { radius: 4 } : {}),
    ...(isForce(kind) ? { radius: 5 } : {}),
    ...extra,
  }
}
