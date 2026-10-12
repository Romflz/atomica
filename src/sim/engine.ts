import { DEFS, genesOf, isForce, makeAtom } from './atoms'
import type { ComputeCtx } from './atoms'
import { centerOf, DIR, forEachWithin, neighbor, opposite, rotateAbout, SIDES, walk } from './hex'
import type { Atom, Port, TickEvents, World } from './types'

export { opposite }
export const MAX_ATOMS = 12000

/** Canonical side of an atom that faces world side `side`. */
export const canonSide = (a: Atom, side: number) => (side - a.rot + 12) % SIDES

/** The port an atom presents on a world-facing side, after rotation and state. */
export function portAt(a: Atom, side: number): Port {
  const p = DEFS[a.kind].ports[canonSide(a, side)]
  // A charged Clasp opens its claws.
  if (p === 'grip' && a.kind === 'clasp' && a.out) return null
  return p
}

/** Tabs fit slots, sockets and grips fit anything, but like never fits like. */
export function canBond(p: Port, q: Port): boolean {
  if (!p || !q) return false
  if (p === 'in' && q === 'in') return false
  if (p === 'out' && q === 'out') return false
  return true
}

export interface Link {
  side: number
  other: string
  mine: Port
  theirs: Port
}

export interface Bond {
  a: string
  b: string
  /** Side of `a` that faces `b`. */
  side: number
  pa: Port
  pb: Port
}

export interface Graph {
  byId: Map<string, Atom>
  occ: Map<number, string>
  links: Map<string, Link[]>
  bonds: Bond[]
  molOf: Map<string, number>
  molecules: string[][]
  netOf: Map<string, number>
  nets: string[][]
}

class UnionFind {
  parent: Int32Array
  constructor(n: number) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b)
  }
}

function groups(ids: string[], uf: UnionFind): { list: string[][]; of: Map<string, number> } {
  const byRoot = new Map<number, string[]>()
  ids.forEach((id, i) => {
    const r = uf.find(i)
    const g = byRoot.get(r)
    if (g) g.push(id)
    else byRoot.set(r, [id])
  })
  const list = [...byRoot.values()]
  const of = new Map<string, number>()
  list.forEach((g, i) => g.forEach((id) => of.set(id, i)))
  return { list, of }
}

export const cellKey = (world: Pick<World, 'cols'>, x: number, y: number) => y * world.cols + x

export function buildGraph(world: World): Graph {
  const { atoms, cols, rows } = world
  const byId = new Map<string, Atom>()
  const occ = new Map<number, string>()
  const links = new Map<string, Link[]>()
  const index = new Map<string, number>()
  atoms.forEach((a, i) => {
    byId.set(a.id, a)
    occ.set(cellKey(world, a.x, a.y), a.id)
    links.set(a.id, [])
    index.set(a.id, i)
  })

  const bonds: Bond[] = []
  const molUf = new UnionFind(atoms.length)
  for (const a of atoms) {
    // Only look E, SE and SW so every pair is visited once.
    for (const side of [0, 1, 2]) {
      const [nx, ny] = neighbor(a.x, a.y, side)
      if (nx < 0 || nx >= cols || ny >= rows) continue
      const bid = occ.get(cellKey(world, nx, ny))
      if (!bid) continue
      const b = byId.get(bid)!
      const pa = portAt(a, side)
      const pb = portAt(b, opposite(side))
      if (!canBond(pa, pb)) continue
      bonds.push({ a: a.id, b: b.id, side, pa, pb })
      links.get(a.id)!.push({ side, other: b.id, mine: pa, theirs: pb })
      links.get(b.id)!.push({ side: opposite(side), other: a.id, mine: pb, theirs: pa })
      molUf.union(index.get(a.id)!, index.get(b.id)!)
    }
  }
  const mol = groups(
    atoms.map((a) => a.id),
    molUf,
  )

  // Conduit nets: conduits joined socket-to-socket share one charge.
  const conduits = atoms.filter((a) => a.kind === 'conduit').map((a) => a.id)
  const cIndex = new Map(conduits.map((id, i) => [id, i]))
  const netUf = new UnionFind(conduits.length)
  for (const bond of bonds) {
    if (bond.pa === 'io' && bond.pb === 'io') netUf.union(cIndex.get(bond.a)!, cIndex.get(bond.b)!)
  }
  const net = groups(conduits, netUf)

  return { byId, occ, links, bonds, molOf: mol.of, molecules: mol.list, netOf: net.of, nets: net.list }
}

/** Value currently carried across a bond, read from the driving side. */
export function bondSignal(g: Graph, bond: Bond): boolean {
  if (bond.pa === 'grip' || bond.pb === 'grip') return false
  const a = g.byId.get(bond.a)!
  const b = g.byId.get(bond.b)!
  if (bond.pa === 'out') return a.out
  if (bond.pb === 'out') return b.out
  // io–in or io–io: the conduit carries its net's charge.
  if (bond.pa === 'io') return a.out
  return b.out
}

export const emptyEvents = (): TickEvents => ({ eaten: 0, born: 0, spins: 0, thrusts: 0, fieldMoves: 0, docks: 0 })

/** Advance the world one tick. Pass `events` to tally what happened. */
export function step(world: World, events: TickEvents = emptyEvents()): World {
  const g = buildGraph(world)
  const tick = world.tick + 1

  const netVal = g.nets.map((members) =>
    members.some((cid) => g.links.get(cid)!.some((l) => l.theirs === 'out' && g.byId.get(l.other)!.out)),
  )
  const read = (l: Link) => (l.theirs === 'out' ? g.byId.get(l.other)!.out : !!netVal[g.netOf.get(l.other)!])

  // Entanglons that received charge last tick, per channel.
  const transmitting = new Map<number, string[]>()
  for (const a of world.atoms) {
    if (a.kind !== 'entangler' || !a.mem) continue
    const ch = a.channel ?? 0
    transmitting.set(ch, [...(transmitting.get(ch) ?? []), a.id])
  }

  const atoms = world.atoms.map((a) => {
    if (a.kind === 'conduit') {
      const out = !!netVal[g.netOf.get(a.id)!]
      return out === a.out ? a : { ...a, out }
    }
    const inputs: boolean[] = []
    const bySide: (boolean | undefined)[] = []
    for (const l of g.links.get(a.id)!) {
      if (l.mine !== 'in' || l.theirs === 'grip') continue
      const v = read(l)
      inputs.push(v)
      bySide[canonSide(a, l.side)] = v
    }
    const ctx: ComputeCtx = {
      inputs,
      atom: a,
      tick,
      slot: (s) => bySide[s],
      look: (range) => lookAhead(world, g, a, range),
      broadcast: () => (transmitting.get(a.channel ?? 0) ?? []).some((id) => id !== a.id),
    }
    const r = DEFS[a.kind].compute(ctx)
    return patch(a, typeof r === 'boolean' ? { out: r } : r)
  })

  const moved = applyPhysics(world, atoms, g, events)
  return { ...world, tick, atoms: applyLife(world, moved, g, events) }
}

function patch(a: Atom, p: Partial<Atom>): Atom {
  for (const k in p) {
    if (p[k as keyof Atom] !== a[k as keyof Atom]) return { ...a, ...p }
  }
  return a
}

/** Ray-cast from an atom's facing side; its own molecule is see-through. */
function lookAhead(world: World, g: Graph, a: Atom, range: number): boolean {
  const mine = g.molOf.get(a.id)
  for (let k = 1; k <= range; k++) {
    const [x, y] = walk(a.x, a.y, a.rot, k)
    if (x < 0 || y < 0 || x >= world.cols || y >= world.rows) return false
    const id = g.occ.get(cellKey(world, x, y))
    if (id && g.molOf.get(id) !== mine) return true
  }
  return false
}

/**
 * Motion, in priority order. A molecule moves at most once per tick.
 *
 *  1. Thrust: charged Propulsors drive their molecule toward their nose.
 *  2. Spin: a Gyron pulse turns its molecule 60° clockwise about the Gyron.
 *  3. Fields: every active Magnetar / Repulsar acts on *other* molecules only.
 *     Because that is not reciprocal, attractors and repellers chase each
 *     other. A molecule slides one cell in whichever direction most lowers its
 *     field energy (Σ distance to attractors − Σ distance to repellers); a
 *     strict decrease is required so nothing jitters in place. A lone atom
 *     pressed against something tumbles until it docks.
 *  4. Heat: small molecules wander at random and loose atoms tumble into
 *     docking orientations, which keeps soups evolving.
 */
function applyPhysics(world: World, atoms: Atom[], g: Graph, events: TickEvents): Atom[] {
  const heat = world.heat ?? 0
  const pos = new Map(atoms.map((a) => [a.id, a]))
  const occ = new Map(g.occ)
  const moved = new Set<number>()

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < world.cols && y < world.rows
  const mobile = (mol: string[]) => !mol.some((id) => pos.get(id)!.pinned)
  const isLoose = (mol: string[]) => mol.length === 1 && g.links.get(mol[0])!.length === 0

  const blocked = (mol: string[], members: Set<string>, side: number) =>
    mol.some((id) => {
      const a = pos.get(id)!
      const [nx, ny] = neighbor(a.x, a.y, side)
      if (!inBounds(nx, ny)) return true
      const o = occ.get(cellKey(world, nx, ny))
      return o !== undefined && !members.has(o)
    })

  const relocate = (mol: string[], next: (a: Atom) => Atom) => {
    for (const id of mol) {
      const a = pos.get(id)!
      occ.delete(cellKey(world, a.x, a.y))
    }
    for (const id of mol) {
      const n = next(pos.get(id)!)
      pos.set(id, n)
      occ.set(cellKey(world, n.x, n.y), id)
    }
  }
  const shift = (mol: string[], side: number) =>
    relocate(mol, (a) => {
      const [x, y] = neighbor(a.x, a.y, side)
      return { ...a, x, y }
    })

  /** Rotate a lone atom to the first orientation that bonds with a neighbour. */
  const dock = (id: string) => {
    const a = pos.get(id)!
    for (let turn = 1; turn < SIDES; turn++) {
      const spun = { ...a, rot: (a.rot + turn) % SIDES }
      const fits = [0, 1, 2, 3, 4, 5].some((side) => {
        const [nx, ny] = neighbor(a.x, a.y, side)
        if (!inBounds(nx, ny)) return false
        const o = occ.get(cellKey(world, nx, ny))
        return o !== undefined && canBond(portAt(spun, side), portAt(pos.get(o)!, opposite(side)))
      })
      if (fits) {
        pos.set(id, spun)
        events.docks++
        return true
      }
    }
    return false
  }

  // ── 1. Thrust ───────────────────────────────────────────────────
  const thrust = new Map<number, [number, number]>()
  for (const a of atoms) {
    if (a.kind !== 'propulsor' || !a.out) continue
    const mi = g.molOf.get(a.id)!
    const v = thrust.get(mi) ?? [0, 0]
    v[0] += DIR[a.rot][0]
    v[1] += DIR[a.rot][1]
    thrust.set(mi, v)
  }
  for (const [mi, [vx, vy]] of thrust) {
    const mol = g.molecules[mi]
    if (Math.hypot(vx, vy) < 1e-6 || !mobile(mol)) continue
    // Opposed engines cancel; otherwise go the hex direction closest to the net thrust.
    let side = 0
    for (let s = 1; s < SIDES; s++) if (DIR[s][0] * vx + DIR[s][1] * vy > DIR[side][0] * vx + DIR[side][1] * vy) side = s
    if (blocked(mol, new Set(mol), side)) continue
    shift(mol, side)
    moved.add(mi)
    events.thrusts++
  }

  // ── 2. Spin ─────────────────────────────────────────────────────
  for (const a of atoms) {
    if (a.kind !== 'gyron' || !a.out) continue
    const mi = g.molOf.get(a.id)!
    const mol = g.molecules[mi]
    if (!mobile(mol)) continue
    const p = pos.get(a.id)!
    const members = new Set(mol)
    const target = (b: Atom) => {
      const [x, y] = rotateAbout(p.x, p.y, b.x, b.y)
      return { x, y }
    }
    const clear = mol.every((id) => {
      const t = target(pos.get(id)!)
      if (!inBounds(t.x, t.y)) return false
      const o = occ.get(cellKey(world, t.x, t.y))
      return o === undefined || members.has(o)
    })
    if (!clear) continue
    relocate(mol, (b) => ({ ...b, ...target(b), rot: (b.rot + 1) % SIDES }))
    moved.add(mi)
    events.spins++
  }

  // ── 3. Fields ───────────────────────────────────────────────────
  const fields = atoms.filter((a) => isForce(a.kind) && a.out)
  if (fields.length) {
    // Spatial cull: only scan the cells inside each field's radius.
    const acting = new Map<number, Atom[]>()
    const reach = new Map<number, number>()
    for (const f of fields) {
      const r = f.radius ?? 5
      const own = g.molOf.get(f.id)
      const seen = new Set<number>()
      forEachWithin(f.x, f.y, r, world.cols, world.rows, (x, y, d) => {
        const id = g.occ.get(cellKey(world, x, y))
        if (!id) return
        const mi = g.molOf.get(id)!
        if (mi === own || moved.has(mi)) return
        reach.set(mi, Math.min(reach.get(mi) ?? Infinity, d))
        if (seen.has(mi)) return
        seen.add(mi)
        const list = acting.get(mi)
        if (list) list.push(f)
        else acting.set(mi, [f])
      })
    }

    // Field energy if the molecule slid one cell across `side` (-1: stays put).
    const energy = (mol: string[], fs: Atom[], side: number) => {
      const [dx, dy] = side < 0 ? [0, 0] : DIR[side]
      let e = 0
      for (const id of mol) {
        const a = pos.get(id)!
        const [ax, ay] = centerOf(a.x, a.y)
        for (const f of fs) {
          const [fx, fy] = centerOf(f.x, f.y)
          const d = Math.hypot(fx - (ax + dx), fy - (ay + dy))
          e += f.kind === 'magnetar' ? d : -d
        }
      }
      return e
    }

    // Molecules nearest a field move first so trailing chains can follow.
    const order = [...acting.keys()].sort((a, b) => reach.get(a)! - reach.get(b)!)
    for (const mi of order) {
      const mol = g.molecules[mi]
      if (!mobile(mol)) continue
      const fs = acting.get(mi)!
      const members = new Set(mol)
      let best = -1
      let bestE = energy(mol, fs, -1) - 1e-6
      for (let side = 0; side < SIDES; side++) {
        if (blocked(mol, members, side)) continue
        const e = energy(mol, fs, side)
        if (e < bestE) {
          bestE = e
          best = side
        }
      }
      if (best >= 0) {
        shift(mol, best)
        moved.add(mi)
        events.fieldMoves++
      } else if (isLoose(mol)) {
        dock(mol[0])
      }
    }
  }

  // ── 4. Heat ─────────────────────────────────────────────────────
  if (heat > 0) {
    g.molecules.forEach((mol, mi) => {
      if (moved.has(mi) || !mobile(mol)) return
      if (isLoose(mol) && Math.random() < heat && dock(mol[0])) return
      if (Math.random() >= heat / Math.sqrt(mol.length)) return
      const side = Math.floor(Math.random() * SIDES)
      if (!blocked(mol, new Set(mol), side)) shift(mol, side)
    })
  }

  return atoms.map((a) => pos.get(a.id)!)
}

/** Devourers eat what is at their mouth; Fabricators copy what they hold. */
function applyLife(world: World, atoms: Atom[], g: Graph, events: TickEvents): Atom[] {
  const eaters = atoms.filter((a) => a.kind === 'devourer' && a.out)
  const makers = atoms.filter((a) => a.kind === 'fabricator' && a.out)
  if (!eaters.length && !makers.length) return atoms

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < world.cols && y < world.rows
  const at = new Map(atoms.map((a) => [cellKey(world, a.x, a.y), a]))
  const eaten = new Set<string>()

  for (const d of eaters) {
    if (eaten.has(d.id)) continue
    const [mx, my] = neighbor(d.x, d.y, d.rot)
    const prey = inBounds(mx, my) ? at.get(cellKey(world, mx, my)) : undefined
    if (!prey || prey.pinned || g.molOf.get(prey.id) === g.molOf.get(d.id)) continue
    eaten.add(prey.id)
    at.delete(cellKey(world, mx, my))
    events.eaten++
  }

  const born: Atom[] = []
  let count = atoms.length - eaten.size
  for (const f of makers) {
    if (eaten.has(f.id) || count >= MAX_ATOMS) continue
    const [bx, by] = neighbor(f.x, f.y, opposite(f.rot))
    const tpl = inBounds(bx, by) ? at.get(cellKey(world, bx, by)) : undefined
    const [fx, fy] = neighbor(f.x, f.y, f.rot)
    if (!tpl || !inBounds(fx, fy) || at.has(cellKey(world, fx, fy))) continue
    const child = makeAtom(tpl.kind, fx, fy, tpl.rot, genesOf(tpl))
    born.push(child)
    at.set(cellKey(world, fx, fy), child)
    count++
    events.born++
  }

  return [...(eaten.size ? atoms.filter((a) => !eaten.has(a.id)) : atoms), ...born]
}
