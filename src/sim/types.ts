/** Atoms sit on a pointy-top hex grid. Sides are indexed clockwise from east: 0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE. */
export type Side = 0 | 1 | 2 | 3 | 4 | 5

/**
 * A port is the shape on one side of an atom.
 *  - `out`  is a tab (knob) that pushes signal out
 *  - `in`   is a slot (notch) that receives signal
 *  - `io`   is a conduit socket that bonds to anything and carries charge
 *  - `grip` is a claw that bonds to anything but carries no charge
 *  - `null` is a flat, inert edge
 */
export type Port = 'in' | 'out' | 'io' | 'grip' | null

export type AtomKind =
  | 'spark'
  | 'pulsar'
  | 'quanta'
  | 'conduit'
  | 'entangler'
  | 'clasp'
  | 'and'
  | 'or'
  | 'xor'
  | 'not'
  | 'mnemon'
  | 'chronon'
  | 'oculus'
  | 'lumen'
  | 'magnetar'
  | 'repulsar'
  | 'propulsor'
  | 'gyron'
  | 'fabricator'
  | 'devourer'

export interface Atom {
  id: string
  kind: AtomKind
  /** Hex column and row ("odd-r" offset: odd rows sit half a cell to the right). */
  x: number
  y: number
  /** Sixths of a turn clockwise, 0..5. Directional atoms face their canonical east side. */
  rot: number
  /** Pinned molecules ignore fields, heat, thrust and predators. */
  pinned: boolean
  /** Current output / lit / active state. */
  out: boolean
  /** Spark: manual toggle. */
  on?: boolean
  /** Pulsar: ticks per full cycle. */
  period?: number
  /** Magnetar / Repulsar: field radius. Oculus: sight range. In cells. */
  radius?: number
  /** Chronon: delay in ticks. */
  delay?: number
  /** Quanta: probability of firing each tick, 0..1. */
  chance?: number
  /** Entanglon: channel 0..3. */
  channel?: number
  /** Internal state: Mnemon bit, Chronon history, Entanglon transmit flag. */
  mem?: number
  /** Last tick's input, for rising-edge detection. */
  prev?: boolean
}

export interface World {
  cols: number
  rows: number
  tick: number
  atoms: Atom[]
  /** Thermal noise, 0..1: chance per tick that a lone atom jiggles. */
  heat?: number
}

/** Things that happened during one tick, for the discovery system. */
export interface TickEvents {
  eaten: number
  born: number
  spins: number
  thrusts: number
  fieldMoves: number
  docks: number
}
