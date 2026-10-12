import { cellAt, centerOf, ROW } from '../sim/hex'
import type { Port } from '../sim/types'

/** Distance between the centres of neighbouring cells, in world pixels. */
export const CELL = 72
/** Vertical distance between rows. */
export const ROW_H = CELL * ROW
/** Circumradius of a grid cell (centre to corner). */
export const HEX_R = CELL / Math.sqrt(3)
/** Apothem (centre to edge) of an atom body; leaves a 6px gap between neighbouring bodies. */
export const H = CELL / 2 - 3
/** Side length of an atom body, which for a regular hexagon is also its circumradius. */
export const BODY_R = (H * 2) / Math.sqrt(3)
const CORNER = 6
const CUT = CORNER / Math.sqrt(3)

// Slot: a circular bite whose centre sits just inside the body edge.
const SLOT_R = 9.5
export const SLOT_INSET = 4
const SLOT_MOUTH = Math.sqrt(SLOT_R ** 2 - SLOT_INSET ** 2)

// Tab: a neck bridging the gap, ending in a round head that lands in the
// neighbour's slot with 1.5px of clearance all round.
const GAP = 2 * (CELL / 2 - H)
const TAB_R = 8
const TAB_CENTER = GAP + SLOT_INSET
const TAB_NECK = 5
const TAB_NECK_LEN = TAB_CENTER - Math.sqrt(TAB_R ** 2 - TAB_NECK ** 2)

/** How far a tab reaches past its own body edge. */
export const TAB_REACH = TAB_CENTER + TAB_R

// Outward normal and clockwise tangent of each side, clockwise from east.
const NOR = Array.from({ length: 6 }, (_, s) => [Math.cos((s * Math.PI) / 3), Math.sin((s * Math.PI) / 3)])
const TAN = NOR.map(([x, y]) => [-y, x])

const f = (n: number) => +n.toFixed(2)

/** A point on side `s`, `t` along the edge (clockwise) and `n` outward from it. */
export function sidePoint(s: number, t: number, n: number): [number, number] {
  const k = H + n
  return [f(NOR[s][0] * k + TAN[s][0] * t), f(NOR[s][1] * k + TAN[s][1] * t)]
}

/** A point `r` from the centre at `deg` degrees clockwise from east. */
export const polar = (r: number, deg: number): [number, number] => [f(r * Math.cos((deg * Math.PI) / 180)), f(r * Math.sin((deg * Math.PI) / 180))]

const pt = (p: [number, number]) => `${p[0]} ${p[1]}`

function edgeFeature(side: number, port: Port): string {
  if (port === 'in') {
    return `L ${pt(sidePoint(side, -SLOT_MOUTH, 0))} A ${SLOT_R} ${SLOT_R} 0 1 0 ${pt(sidePoint(side, SLOT_MOUTH, 0))} `
  }
  if (port === 'out') {
    return (
      `L ${pt(sidePoint(side, -TAB_NECK, 0))} L ${pt(sidePoint(side, -TAB_NECK, TAB_NECK_LEN))} ` +
      `A ${TAB_R} ${TAB_R} 0 1 1 ${pt(sidePoint(side, TAB_NECK, TAB_NECK_LEN))} L ${pt(sidePoint(side, TAB_NECK, 0))} `
    )
  }
  return ''
}

/** Outline of a hexagonal atom body with tabs and slots cut into its world-facing sides. */
export function bodyPath(ports: Port[]): string {
  const half = BODY_R / 2
  let d = `M ${pt(sidePoint(0, -half + CUT, 0))} `
  for (let s = 0; s < 6; s++) {
    d += edgeFeature(s, ports[s])
    d += `L ${pt(sidePoint(s, half - CUT, 0))} A ${CORNER} ${CORNER} 0 0 1 ${pt(sidePoint((s + 1) % 6, -half + CUT, 0))} `
  }
  return d + 'Z'
}

/** Corners of a pointy-top hexagon with circumradius `r`, clockwise from the top. */
export function hexCorners(r: number, cx = 0, cy = 0): [number, number][] {
  return Array.from({ length: 6 }, (_, k) => {
    const [x, y] = polar(r, -90 + 60 * k)
    return [cx + x, cy + y]
  })
}

/** A plain pointy-top hexagon with apothem `a`, as an SVG path. */
export function hexPath(a: number): string {
  return `M ${hexCorners((a * 2) / Math.sqrt(3))
    .map(pt)
    .join(' L ')} Z`
}

/** Just the tab on one side, for painting it with the signal colour. */
export function tabPath(side: number): string {
  return (
    `M ${pt(sidePoint(side, -TAB_NECK, -2))} L ${pt(sidePoint(side, -TAB_NECK, TAB_NECK_LEN))} ` +
    `A ${TAB_R} ${TAB_R} 0 1 1 ${pt(sidePoint(side, TAB_NECK, TAB_NECK_LEN))} L ${pt(sidePoint(side, TAB_NECK, -2))} Z`
  )
}

/** The inner rim of a slot, for lighting it up when it receives charge. */
export function slotRimPath(side: number): string {
  return `M ${pt(sidePoint(side, -SLOT_MOUTH, 0))} A ${SLOT_R} ${SLOT_R} 0 1 0 ${pt(sidePoint(side, SLOT_MOUTH, 0))}`
}

// ── Board layout ────────────────────────────────────────────────────

/** World-pixel centre of a cell. The board's bounding box starts at (0, 0). */
export function cellCenter(x: number, y: number): [number, number] {
  const [cx, cy] = centerOf(x, y)
  return [cx * CELL + CELL / 2, cy * CELL + HEX_R]
}

/** Bounding box of a cols × rows board in world pixels. */
export const boardSize = (cols: number, rows: number) => ({ w: cols * CELL + (rows > 1 ? CELL / 2 : 0), h: (rows - 1) * ROW_H + 2 * HEX_R })

/** The cell under a world-pixel point (may be off the board). */
export const pixelToCell = (px: number, py: number) => {
  const [x, y] = cellAt((px - CELL / 2) / CELL, (py - HEX_R) / CELL)
  return { x, y }
}

/** The board size whose bottom-right corner is nearest a world-pixel point. */
export const sizeAt = (px: number, py: number) => ({ cols: Math.round((px - CELL / 2) / CELL), rows: Math.round((py - 2 * HEX_R) / ROW_H + 1) })

/** Outline of a cols × rows hex board, as a flat [x0, y0, x1, y1, …] polygon. */
export function boardOutline(cols: number, rows: number): number[] {
  const out: number[] = []
  // Corner k of cell (x, y): 0 top, 1 upper-right, 2 lower-right, 3 bottom, 4 lower-left, 5 upper-left.
  const v = (x: number, y: number, k: number) => {
    const [cx, cy] = cellCenter(x, y)
    const [px, py] = polar(HEX_R, -90 + 60 * k)
    out.push(cx + px, cy + py)
  }
  const R = cols - 1
  const B = rows - 1
  for (let x = 0; x < cols; x++) {
    v(x, 0, 5)
    v(x, 0, 0)
  }
  for (let y = 0; y < rows; y++) {
    v(R, y, 1)
    v(R, y, 2)
    // Below an odd row the edge steps back left to the even row's corner.
    if (y < B && y & 1) v(R, y, 3)
  }
  for (let x = R; x >= 0; x--) {
    v(x, B, 3)
    v(x, B, 4)
  }
  for (let y = B; y >= 0; y--) {
    v(0, y, 4)
    v(0, y, 5)
    // Above an even row the edge steps right to the odd row's corner.
    if (y > 0 && !(y & 1)) v(0, y, 0)
  }
  return out
}
