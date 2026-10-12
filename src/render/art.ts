/**
 * Renderer-agnostic artwork for atoms. `atomArt` returns a flat list of
 * primitive shapes in cell-local coordinates (origin at the cell centre).
 * The GPU field and the SVG icons both draw from this one description.
 */
import { CHANNEL_COLORS, captionOf, DEFS, SIGNAL } from '../sim/atoms'
import { bondSignal, opposite, portAt } from '../sim/engine'
import type { Graph } from '../sim/engine'
import type { Atom, Port } from '../sim/types'
import { bodyPath, CELL, H, sidePoint, slotRimPath, tabPath } from './geometry'

export interface SideInfo {
  port: Port
  bonded: boolean
  neighbor: Port
  hot: boolean
}

export interface Paint {
  fill?: string
  fillAlpha?: number
  stroke?: string
  strokeAlpha?: number
  width?: number
}

/** Animated shapes are grouped so a renderer can transform them as one. */
export type Anim = 'spin' | 'flicker' | 'pulse'

interface Common {
  p: Paint
  glow?: boolean
  anim?: Anim
  /** Reaches beyond the cell (e.g. a sight beam): renderers draw it live instead of baking it. */
  free?: boolean
}

export type Shape =
  | ({ t: 'path'; d: string } & Common)
  | ({ t: 'circle'; x: number; y: number; r: number } & Common)
  | ({ t: 'ellipse'; x: number; y: number; rx: number; ry: number } & Common)
  | ({ t: 'line'; x1: number; y1: number; x2: number; y2: number } & Common)
  | ({ t: 'rect'; x: number; y: number; w: number; h: number; rx: number } & Common)
  | { t: 'halo'; r: number; color: string; alpha: number }
  | {
      t: 'text'
      x: number
      /** Vertical centre of the text. */
      y: number
      text: string
      size: number
      color: string
      alpha?: number
      font: 'display' | 'mono'
      anchor: 'middle' | 'start'
      spacing?: number
    }

export interface ArtOptions {
  ghost?: boolean
  invalid?: boolean
}

export const BODY = '#111a30'
export const INK = '#070c1a'

export const unbonded = (atom: Atom): SideInfo[] =>
  [0, 1, 2, 3].map((s) => ({ port: portAt(atom, s), bonded: false, neighbor: null, hot: false }))

/** Per-atom port, bond and charge info for every side, derived from the bond graph. */
export function sidesFor(graph: Graph): Map<string, SideInfo[]> {
  const m = new Map<string, SideInfo[]>()
  for (const a of graph.byId.values()) {
    const s = unbonded(a)
    for (const l of graph.links.get(a.id) ?? []) s[l.side] = { port: l.mine, bonded: true, neighbor: l.theirs, hot: false }
    m.set(a.id, s)
  }
  for (const b of graph.bonds) {
    const hot = bondSignal(graph, b)
    m.get(b.a)![b.side].hot = hot
    m.get(b.b)![opposite(b.side)].hot = hot
  }
  return m
}

/** Stable cache key: two atoms with equal keys look identical. */
export function artKey(atom: Atom, sides: SideInfo[], opts: ArtOptions = {}): string {
  const s = sides.map((i) => `${i.port ?? '-'}${i.bonded ? 'b' : ''}${i.neighbor ?? ''}${i.hot ? 'h' : ''}`).join(',')
  return [
    atom.kind,
    atom.rot,
    atom.out ? 1 : 0,
    atom.on ? 1 : 0,
    atom.pinned ? 1 : 0,
    captionOf(atom),
    atom.radius ?? '',
    atom.channel ?? '',
    // Internal state (Chronon history, transmit flags) is not drawn, so it stays out of the key;
    // the one visible bit, a Mnemon's, is already part of its caption.
    s,
    opts.ghost ? 'g' : '',
    opts.invalid ? 'x' : '',
  ].join('|')
}

export function atomArt(atom: Atom, sides: SideInfo[] = unbonded(atom), opts: ArtOptions = {}): Shape[] {
  const def = DEFS[atom.kind]
  const c = opts.invalid ? '#ff3b5c' : def.color
  const live = atom.out && !opts.ghost
  const S: Shape[] = []
  const facing = atom.rot
  const back = (atom.rot + 2) % 4

  if (atom.kind === 'conduit') return conduitArt(atom, sides, c, live)

  // ── Under the body ──────────────────────────────────────────────
  if (atom.kind === 'lumen' && live) S.push({ t: 'halo', r: CELL * 1.5, color: '#ffe680', alpha: 0.55 })
  if (live) S.push({ t: 'halo', r: CELL * 0.75, color: c, alpha: 0.28 })
  if (atom.kind === 'oculus') {
    const reach = (atom.radius ?? 4) * CELL - H + CELL / 2 - 12
    const [x1, y1] = sidePoint(facing, 0, 2)
    const [x2, y2] = sidePoint(facing, 0, reach)
    S.push({ t: 'line', x1, y1, x2, y2, p: { stroke: live ? SIGNAL : c, strokeAlpha: live ? 0.6 : 0.13, width: live ? 3 : 1.5 }, glow: live, free: true })
  }
  if (atom.kind === 'propulsor' && live) {
    const flame = (w: number, len: number) =>
      `M ${sidePoint(back, -w, 3).join(' ')} L ${sidePoint(back, 0, len).join(' ')} L ${sidePoint(back, w, 3).join(' ')} Z`
    S.push({ t: 'path', d: flame(8, 26), p: { fill: '#ff9a3c', fillAlpha: 0.9 }, glow: true, anim: 'flicker' })
    S.push({ t: 'path', d: flame(4, 16), p: { fill: '#fff2b0' }, anim: 'flicker' })
  }

  // ── Body ────────────────────────────────────────────────────────
  const d = bodyPath(sides.map((s) => (s.port === 'grip' ? null : s.port)))
  S.push({ t: 'path', d, p: { fill: BODY, stroke: c, width: 1.6 }, glow: live })
  S.push({ t: 'path', d, p: { fill: c, fillAlpha: live ? 0.22 : 0.07 } })
  S.push({ t: 'rect', x: -H + 4, y: -H + 4, w: H * 2 - 8, h: H * 2 - 8, rx: 6, p: { stroke: '#ffffff', strokeAlpha: 0.05, width: 1 } })

  // ── Ports ───────────────────────────────────────────────────────
  sides.forEach((s, side) => {
    if (s.port === 'out') {
      S.push({ t: 'path', d: tabPath(side), p: { fill: live ? SIGNAL : c, fillAlpha: live ? 1 : 0.7 }, glow: live })
    } else if (s.port === 'in' && s.bonded) {
      S.push({ t: 'path', d: slotRimPath(side), p: { stroke: s.hot ? SIGNAL : '#ffffff', strokeAlpha: s.hot ? 1 : 0.1, width: 2 }, glow: s.hot })
    } else if (s.port === 'grip') {
      S.push(...claw(side, c, s.bonded))
    }
    hotDot(S, side, s)
  })
  // A released Clasp shows its open claws on the sides that let go.
  if (atom.kind === 'clasp' && atom.out) {
    def.ports.forEach((p, canon) => {
      if (p === 'grip') S.push(...openClaw((canon + atom.rot) % 4, c))
    })
  }

  // ── Kind-specific detail ────────────────────────────────────────
  switch (atom.kind) {
    case 'pulsar':
      S.push(...dotRing(live ? 20 : 16, 10, c, live ? 0.95 : 0.4, live ? 'spin' : undefined))
      break
    case 'quanta':
      for (const [x, y, r] of [
        [-15, -12, 1.8],
        [16, -14, 2.4],
        [17, 9, 1.6],
        [-17, 10, 2.1],
      ])
        S.push({ t: 'circle', x, y, r, p: { fill: live ? SIGNAL : c, fillAlpha: live ? 1 : 0.4 }, glow: live, anim: live ? 'flicker' : undefined })
      break
    case 'entangler':
      S.push(...dotRing(21, 14, CHANNEL_COLORS[atom.channel ?? 0], live ? 1 : 0.55, live ? 'spin' : undefined))
      break
    case 'mnemon':
      S.push({ t: 'rect', x: 12, y: -23, w: 10, h: 7, rx: 2, p: { fill: atom.mem ? SIGNAL : INK, stroke: c, strokeAlpha: 0.7, width: 1 }, glow: !!atom.mem })
      break
    case 'chronon':
      S.push({ t: 'path', d: 'M 13 -23 L 21 -23 L 13 -13 L 21 -13 Z', p: { stroke: c, strokeAlpha: 0.75, width: 1.2 } })
      break
    case 'oculus': {
      const [ex, ey] = sidePoint(facing, 0, -9)
      const horizontal = facing % 2 === 0
      S.push({ t: 'ellipse', x: ex, y: ey, rx: horizontal ? 9 : 4.5, ry: horizontal ? 4.5 : 9, p: { fill: INK, stroke: c, width: 1.4 } })
      S.push({ t: 'circle', x: ex, y: ey, r: 2.8, p: { fill: live ? SIGNAL : c }, glow: live })
      break
    }
    case 'lumen':
      S.push({ t: 'circle', x: 0, y: 0, r: 13, p: { fill: live ? '#fff4be' : '#fff1a6', fillAlpha: live ? 0.92 : 0.05, stroke: c, strokeAlpha: 0.35, width: 1 }, glow: live })
      S.push({ t: 'circle', x: 0, y: 0, r: live ? 7 : 4, p: { fill: live ? '#ffffff' : c, fillAlpha: live ? 1 : 0.3 } })
      break
    case 'magnetar':
    case 'repulsar':
      S.push(...forceChevrons(atom.kind === 'magnetar', c, live))
      break
    case 'propulsor': {
      const nose = [sidePoint(facing, -7, -12), sidePoint(facing, 0, -5), sidePoint(facing, 7, -12)]
      S.push({ t: 'path', d: `M ${nose.map((p) => p.join(' ')).join(' L ')}`, p: { stroke: c, width: 2 } })
      const bell = [sidePoint(back, -5, -1), sidePoint(back, -8, 4), sidePoint(back, 8, 4), sidePoint(back, 5, -1)]
      S.push({ t: 'path', d: `M ${bell.map((p) => p.join(' ')).join(' L ')} Z`, p: { fill: c, fillAlpha: 0.65 } })
      break
    }
    case 'gyron': {
      const r = 21
      const a0 = (-40 * Math.PI) / 180
      const a1 = (230 * Math.PI) / 180
      const [sx, sy] = [Math.cos(a0) * r, Math.sin(a0) * r]
      const [ex, ey] = [Math.cos(a1) * r, Math.sin(a1) * r]
      const arc = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
      // Arrowhead at the end of the arc, pointing along the clockwise tangent.
      const tx = -Math.sin(a1)
      const ty = Math.cos(a1)
      const head = `M ${(ex - tx * 5 + ty * 4).toFixed(2)} ${(ey - ty * 5 - tx * 4).toFixed(2)} L ${(ex + tx * 1.5).toFixed(2)} ${(ey + ty * 1.5).toFixed(2)} L ${(ex - tx * 5 - ty * 4).toFixed(2)} ${(ey - ty * 5 + tx * 4).toFixed(2)}`
      const paint = { stroke: live ? SIGNAL : c, strokeAlpha: live ? 1 : 0.6, width: 1.8 }
      S.push({ t: 'path', d: arc, p: paint, glow: live, anim: live ? 'spin' : undefined })
      S.push({ t: 'path', d: head, p: paint, anim: live ? 'spin' : undefined })
      break
    }
    case 'fabricator': {
      const [px, py] = sidePoint(facing, 0, -9)
      S.push({ t: 'line', x1: px - 5, y1: py, x2: px + 5, y2: py, p: { stroke: live ? SIGNAL : c, width: 2 }, glow: live })
      S.push({ t: 'line', x1: px, y1: py - 5, x2: px, y2: py + 5, p: { stroke: live ? SIGNAL : c, width: 2 }, glow: live })
      break
    }
    case 'devourer': {
      const pts = [-15, -10, -5, 0, 5, 10, 15].map((t, i) => sidePoint(facing, t, i % 2 ? -8 : -2))
      S.push({ t: 'path', d: `M ${pts.map((p) => p.join(' ')).join(' L ')}`, p: { stroke: live ? '#ffffff' : c, width: 1.8 }, glow: live, anim: live ? 'pulse' : undefined })
      break
    }
  }

  // ── Labels ──────────────────────────────────────────────────────
  S.push({ t: 'text', x: -H + 7, y: -H + 10.5, text: String(def.number).padStart(2, '0'), size: 7, color: c, alpha: 0.5, font: 'mono', anchor: 'start' })
  const symColor = atom.kind === 'lumen' && live ? '#4a3400' : live ? '#ffffff' : c
  S.push({ t: 'text', x: 0, y: -3, text: def.symbol, size: 17, color: symColor, font: 'display', anchor: 'middle' })

  if (atom.kind === 'spark') {
    S.push({ t: 'rect', x: -11, y: 11.5, w: 22, h: 9, rx: 4.5, p: atom.on ? { fill: SIGNAL } : { fill: INK, stroke: c, strokeAlpha: 0.5, width: 1 } })
    S.push({ t: 'circle', x: atom.on ? 6.5 : -6.5, y: 16, r: 3, p: { fill: atom.on ? '#2a2000' : c, fillAlpha: atom.on ? 1 : 0.55 } })
  } else if (atom.kind !== 'magnetar' && atom.kind !== 'repulsar' && atom.kind !== 'gyron') {
    S.push({ t: 'text', x: 0, y: 17.5, text: captionOf(atom), size: 6.5, color: c, alpha: 0.7, font: 'mono', anchor: 'middle', spacing: 1 })
  }

  if (atom.pinned) S.push(...pin(H - 8, -H + 8))
  return S
}

function conduitArt(atom: Atom, sides: SideInfo[], c: string, live: boolean): Shape[] {
  const S: Shape[] = []
  if (live) S.push({ t: 'halo', r: CELL * 0.6, color: SIGNAL, alpha: 0.18 })
  const arms = sides.map((s, side) => {
    const reach = !s.bonded ? 15 : s.neighbor === 'in' ? 44 : s.neighbor === 'out' ? 20 : CELL / 2
    const [x, y] = sidePoint(side, 0, reach - H)
    return { side, x, y, bonded: s.bonded }
  })
  for (const a of arms) S.push({ t: 'line', x1: 0, y1: 0, x2: a.x, y2: a.y, p: { stroke: a.bonded ? '#121b33' : '#0b1224', width: 11 } })
  for (const a of arms)
    S.push({ t: 'line', x1: 0, y1: 0, x2: a.x, y2: a.y, p: { stroke: live ? SIGNAL : c, strokeAlpha: live ? 1 : a.bonded ? 0.9 : 0.5, width: 4 }, glow: live })
  for (const a of arms) if (!a.bonded) S.push({ t: 'circle', x: a.x, y: a.y, r: 3, p: { fill: c, fillAlpha: 0.5 } })
  S.push({ t: 'path', d: 'M 0 -14 L 14 0 L 0 14 L -14 0 Z', p: { fill: live ? SIGNAL : c, stroke: INK, width: 2 }, glow: live })
  S.push({ t: 'text', x: 0, y: 0.5, text: 'Cu', size: 8, color: '#08101f', font: 'display', anchor: 'middle' })
  sides.forEach((s, side) => hotDot(S, side, s))
  if (atom.pinned) S.push(...pin(11, -11))
  return S
}

/** Bonds glow at the cell edge; the east/south owner draws the dot so each bond has one. */
function hotDot(S: Shape[], side: number, s: SideInfo) {
  if (!s.bonded || !s.hot || (side !== 1 && side !== 2)) return
  const [x, y] = sidePoint(side, 0, CELL / 2 - H)
  S.push({ t: 'circle', x, y, r: 3.2, p: { fill: SIGNAL }, glow: true })
}

function claw(side: number, c: string, bonded: boolean): Shape[] {
  const paint = { stroke: c, strokeAlpha: bonded ? 1 : 0.7, width: 2.4 }
  const [ax, ay] = sidePoint(side, -6, -2)
  const [bx, by] = sidePoint(side, -6, 4)
  const [cx, cy] = sidePoint(side, 6, -2)
  const [dx, dy] = sidePoint(side, 6, 4)
  return [
    { t: 'line', x1: ax, y1: ay, x2: bx, y2: by, p: paint },
    { t: 'line', x1: cx, y1: cy, x2: dx, y2: dy, p: paint },
    { t: 'line', x1: ax, y1: ay, x2: cx, y2: cy, p: paint },
  ]
}

function openClaw(side: number, c: string): Shape[] {
  const paint = { stroke: c, strokeAlpha: 0.45, width: 2 }
  const [ax, ay] = sidePoint(side, -5, -2)
  const [bx, by] = sidePoint(side, -10, 4)
  const [cx, cy] = sidePoint(side, 5, -2)
  const [dx, dy] = sidePoint(side, 10, 4)
  return [
    { t: 'line', x1: ax, y1: ay, x2: bx, y2: by, p: paint },
    { t: 'line', x1: cx, y1: cy, x2: dx, y2: dy, p: paint },
  ]
}

function dotRing(r: number, n: number, color: string, alpha: number, anim?: Anim): Shape[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return { t: 'circle', x: +(Math.cos(a) * r).toFixed(2), y: +(Math.sin(a) * r).toFixed(2), r: 1.3, p: { fill: color, fillAlpha: alpha }, anim } as Shape
  })
}

function forceChevrons(inward: boolean, c: string, live: boolean): Shape[] {
  // sidePoint measures outward from the body edge, so `r - H` places a point r from the centre.
  return [0, 2].map((s) => {
    const tip = inward ? 14 : 21
    const base = inward ? 21 : 14
    const [tx, ty] = sidePoint(s, 0, tip - H)
    const [ax, ay] = sidePoint(s, -4, base - H)
    const [bx, by] = sidePoint(s, 4, base - H)
    return { t: 'path', d: `M ${ax} ${ay} L ${tx} ${ty} L ${bx} ${by}`, p: { stroke: c, strokeAlpha: live ? 1 : 0.45, width: 2 }, glow: live } as Shape
  })
}

function pin(x: number, y: number): Shape[] {
  return [
    { t: 'circle', x, y, r: 3.4, p: { fill: INK, stroke: '#9fb0d8', strokeAlpha: 0.6, width: 1 } },
    { t: 'circle', x, y, r: 1.2, p: { fill: '#9fb0d8', fillAlpha: 0.6 } },
  ]
}
