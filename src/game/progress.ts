import type { Graph } from '../sim/engine'
import type { AtomKind, TickEvents, World } from '../sim/types'

export interface Totals {
  placed: number
  eaten: number
  born: number
  thrusts: number
  spins: number
  fieldMoves: number
  splits: number
}

export interface Progress {
  xp: number
  unlocked: Record<string, number>
  totals: Totals
  presets: string[]
  maxArea: number
}

export const freshProgress = (): Progress => ({
  xp: 0,
  unlocked: {},
  totals: { placed: 0, eaten: 0, born: 0, thrusts: 0, spins: 0, fieldMoves: 0, splits: 0 },
  presets: [],
  maxArea: 0,
})

export interface EvalCtx {
  world: World
  graph: Graph
  totals: Totals
  presets: string[]
  maxArea: number
  sandbox: boolean
}

export interface Discovery {
  id: string
  name: string
  desc: string
  xp: number
  icon: AtomKind
  /** Sandbox discoveries only count in your own builds, not in presets. */
  sandbox: boolean
  tier: 'Build' | 'Logic' | 'Force' | 'Life' | 'Explore'
  check: (c: EvalCtx) => boolean
  /** Optional [current, goal] readout for the Codex. */
  meter?: (c: EvalCtx) => [number, number]
}

// ── Measurements ────────────────────────────────────────────────────

const largest = (c: EvalCtx) => c.graph.molecules.reduce((m, mol) => Math.max(m, mol.length), 0)
const count = (c: EvalCtx, kind: AtomKind, pred: (a: World['atoms'][number]) => boolean = () => true) =>
  c.world.atoms.reduce((n, a) => (a.kind === kind && pred(a) ? n + 1 : n), 0)
const moleculeWith = (c: EvalCtx, kinds: AtomKind[]) =>
  c.graph.molecules.some((mol) => {
    const has = new Set(mol.map((id) => c.graph.byId.get(id)!.kind))
    return kinds.every((k) => has.has(k))
  })
const largestWith = (c: EvalCtx, kind: AtomKind) =>
  c.graph.molecules.reduce((m, mol) => (mol.some((id) => c.graph.byId.get(id)!.kind === kind) ? Math.max(m, mol.length) : m), 0)

/** A Negon whose own output reaches its own input through one conduit net. */
function hasFeedbackLoop(c: EvalCtx) {
  for (const a of c.world.atoms) {
    if (a.kind !== 'not') continue
    const links = c.graph.links.get(a.id) ?? []
    const outNet = links.find((l) => l.mine === 'out' && l.theirs === 'io')
    const inNet = links.find((l) => l.mine === 'in' && l.theirs === 'io')
    if (outNet && inNet && c.graph.netOf.get(outNet.other) === c.graph.netOf.get(inNet.other)) return true
  }
  return false
}

const at = (n: number, goal: number): [number, number] => [Math.min(n, goal), goal]

export const DISCOVERIES: Discovery[] = [
  // Build
  { id: 'genesis', tier: 'Build', name: 'Genesis', desc: 'Place your first atom.', xp: 10, icon: 'spark', sandbox: false, check: (c) => c.totals.placed >= 1 },
  { id: 'covalent', tier: 'Build', name: 'Covalent', desc: 'Snap two atoms together.', xp: 15, icon: 'conduit', sandbox: true, check: (c) => c.graph.bonds.length >= 1 },
  { id: 'polymer', tier: 'Build', name: 'Polymer', desc: 'Grow a molecule of 10 atoms.', xp: 30, icon: 'conduit', sandbox: true, check: (c) => largest(c) >= 10, meter: (c) => at(largest(c), 10) },
  { id: 'macro', tier: 'Build', name: 'Macromolecule', desc: 'Grow a molecule of 50 atoms.', xp: 80, icon: 'clasp', sandbox: true, check: (c) => largest(c) >= 50, meter: (c) => at(largest(c), 50) },
  { id: 'mega', tier: 'Build', name: 'Megastructure', desc: 'Grow a molecule of 200 atoms.', xp: 200, icon: 'magnetar', sandbox: true, check: (c) => largest(c) >= 200, meter: (c) => at(largest(c), 200) },
  { id: 'teeming', tier: 'Build', name: 'Teeming', desc: 'Have 500 atoms on the field at once.', xp: 60, icon: 'quanta', sandbox: true, check: (c) => c.world.atoms.length >= 500, meter: (c) => at(c.world.atoms.length, 500) },

  // Logic
  { id: 'light', tier: 'Logic', name: 'Let There Be Light', desc: 'Light a Lumen.', xp: 15, icon: 'lumen', sandbox: true, check: (c) => count(c, 'lumen', (a) => a.out) >= 1 },
  { id: 'illuminate', tier: 'Logic', name: 'Illumination', desc: 'Light 12 Lumens at once.', xp: 50, icon: 'lumen', sandbox: true, check: (c) => count(c, 'lumen', (a) => a.out) >= 12, meter: (c) => at(count(c, 'lumen', (a) => a.out), 12) },
  { id: 'logician', tier: 'Logic', name: 'Logician', desc: 'Bond Andium, Orium, Xorium and Negon into one molecule.', xp: 40, icon: 'and', sandbox: true, check: (c) => moleculeWith(c, ['and', 'or', 'xor', 'not']) },
  { id: 'feedback', tier: 'Logic', name: 'Feedback', desc: 'Wire a Negon into its own input: an oscillator.', xp: 40, icon: 'not', sandbox: true, check: hasFeedbackLoop },
  { id: 'memory', tier: 'Logic', name: 'Total Recall', desc: 'Store a 1 in a Mnemon.', xp: 25, icon: 'mnemon', sandbox: true, check: (c) => count(c, 'mnemon', (a) => a.mem === 1) >= 1 },
  { id: 'wireless', tier: 'Logic', name: 'Spooky Action', desc: 'Send charge between Entanglon twins.', xp: 30, icon: 'entangler', sandbox: true, check: (c) => count(c, 'entangler', (a) => a.out) >= 1 },
  { id: 'clockwork', tier: 'Logic', name: 'Clockwork', desc: 'Run a Chronon delay line.', xp: 25, icon: 'chronon', sandbox: true, check: (c) => count(c, 'chronon', (a) => a.out) >= 1 },

  // Force
  { id: 'gravity', tier: 'Force', name: 'Gravity', desc: 'Move a molecule with a force field.', xp: 20, icon: 'magnetar', sandbox: true, check: (c) => c.totals.fieldMoves >= 1 },
  { id: 'snowball', tier: 'Force', name: 'Snowball', desc: 'Accrete 25 atoms onto a Magnetar.', xp: 60, icon: 'magnetar', sandbox: true, check: (c) => largestWith(c, 'magnetar') >= 25, meter: (c) => at(largestWith(c, 'magnetar'), 25) },

  // Life
  { id: 'liftoff', tier: 'Life', name: 'Liftoff', desc: 'Make a molecule propel itself.', xp: 30, icon: 'propulsor', sandbox: true, check: (c) => c.totals.thrusts >= 1 },
  { id: 'navigator', tier: 'Life', name: 'Navigator', desc: 'Turn a molecule with a Gyron.', xp: 30, icon: 'gyron', sandbox: true, check: (c) => c.totals.spins >= 1 },
  { id: 'odyssey', tier: 'Life', name: 'Odyssey', desc: 'Travel 500 cells under your own thrust.', xp: 80, icon: 'propulsor', sandbox: true, check: (c) => c.totals.thrusts >= 500, meter: (c) => at(c.totals.thrusts, 500) },
  { id: 'eyes', tier: 'Life', name: 'Eyes Open', desc: 'Have an Oculus spot something.', xp: 25, icon: 'oculus', sandbox: true, check: (c) => count(c, 'oculus', (a) => a.out) >= 1 },
  { id: 'meal', tier: 'Life', name: 'First Meal', desc: 'Let a Devourer eat.', xp: 40, icon: 'devourer', sandbox: true, check: (c) => c.totals.eaten >= 1 },
  { id: 'apex', tier: 'Life', name: 'Apex Predator', desc: 'Devour 100 atoms.', xp: 120, icon: 'devourer', sandbox: true, check: (c) => c.totals.eaten >= 100, meter: (c) => at(c.totals.eaten, 100) },
  { id: 'hunter', tier: 'Life', name: 'Hunter', desc: 'Build a creature with an eye, an engine and a mouth.', xp: 100, icon: 'oculus', sandbox: true, check: (c) => moleculeWith(c, ['oculus', 'propulsor', 'devourer']) },
  { id: 'replicator', tier: 'Life', name: 'Replicator', desc: 'Copy an atom with a Fabricator.', xp: 40, icon: 'fabricator', sandbox: true, check: (c) => c.totals.born >= 1 },
  { id: 'population', tier: 'Life', name: 'Population Boom', desc: 'Fabricate 200 atoms.', xp: 120, icon: 'fabricator', sandbox: true, check: (c) => c.totals.born >= 200, meter: (c) => at(c.totals.born, 200) },
  { id: 'mitosis', tier: 'Life', name: 'Mitosis', desc: 'Split a molecule by opening a Clasp.', xp: 60, icon: 'clasp', sandbox: true, check: (c) => c.totals.splits >= 1 },

  // Explore (count anywhere)
  { id: 'tourist', tier: 'Explore', name: 'Tourist', desc: 'Load 3 presets.', xp: 15, icon: 'pulsar', sandbox: false, check: (c) => c.presets.length >= 3, meter: (c) => at(c.presets.length, 3) },
  { id: 'curator', tier: 'Explore', name: 'Curator', desc: 'Load every preset.', xp: 50, icon: 'pulsar', sandbox: false, check: (c) => c.presets.length >= 10, meter: (c) => at(c.presets.length, 10) },
  { id: 'colossus', tier: 'Explore', name: 'Colossus', desc: 'Expand the field to 100×60 or larger.', xp: 30, icon: 'repulsar', sandbox: false, check: (c) => c.maxArea >= 6000 },
]

export const TOTAL_XP = DISCOVERIES.reduce((s, d) => s + d.xp, 0)

const TITLES = ['Initiate', 'Bonder', 'Chemist', 'Engineer', 'Architect', 'Biologist', 'Demiurge', 'Cosmogonist']

/** Level curve: each level needs 120 more XP than the last. */
export function levelOf(xp: number) {
  let level = 1
  let floor = 0
  let need = 120
  while (xp >= floor + need) {
    floor += need
    level++
    need += 120
  }
  return { level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], into: xp - floor, need }
}

/** Fold one tick's events into the running totals (sandbox builds only). */
export function addEvents(t: Totals, e: TickEvents): Totals {
  if (!e.eaten && !e.born && !e.thrusts && !e.spins && !e.fieldMoves) return t
  return {
    ...t,
    eaten: t.eaten + e.eaten,
    born: t.born + e.born,
    thrusts: t.thrusts + e.thrusts,
    spins: t.spins + e.spins,
    fieldMoves: t.fieldMoves + e.fieldMoves,
  }
}

/** Discoveries newly earned in this state. */
export function evaluate(p: Progress, ctx: Omit<EvalCtx, 'totals' | 'presets' | 'maxArea'>): Discovery[] {
  const c: EvalCtx = { ...ctx, totals: p.totals, presets: p.presets, maxArea: p.maxArea }
  return DISCOVERIES.filter((d) => !p.unlocked[d.id] && (!d.sandbox || c.sandbox) && d.check(c))
}

export function meterFor(d: Discovery, p: Progress, ctx: Omit<EvalCtx, 'totals' | 'presets' | 'maxArea'>): [number, number] | null {
  return d.meter ? d.meter({ ...ctx, totals: p.totals, presets: p.presets, maxArea: p.maxArea }) : null
}
