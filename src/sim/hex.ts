/**
 * Hex grid maths.
 *
 * The field is a pointy-top hex grid stored in "odd-r" offset coordinates:
 * `x` is the column, `y` the row, and odd rows sit half a cell to the right.
 * That keeps a field a plain `cols × rows` rectangle with simple bounds
 * checks. Moves and rotations go through axial coordinates (q, r), where they
 * are plain sums.
 *
 * Sides are numbered clockwise from east: 0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE.
 */
export const SIDES = 6
export const SIDE_NAMES = ['E', 'SE', 'SW', 'W', 'NW', 'NE'] as const
/** Distance between rows, in cell widths. */
export const ROW = Math.sqrt(3) / 2

const AQ = [1, 0, -1, -1, 0, 1]
const AR = [0, 1, 1, 0, -1, -1]
// Offset-coordinate neighbour steps, which depend on the row's parity.
const EVEN = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
]
const ODD = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]

export const opposite = (side: number) => (side + 3) % 6

export const toAxial = (x: number, y: number): [number, number] => [x - (y - (y & 1)) / 2, y]
export const fromAxial = (q: number, r: number): [number, number] => [q + (r - (r & 1)) / 2, r]

/** The cell across `side` from (x, y). */
export function neighbor(x: number, y: number, side: number): [number, number] {
  const d = (y & 1 ? ODD : EVEN)[side]
  return [x + d[0], y + d[1]]
}

/** The cell `k` steps from (x, y) in direction `side`. */
export function walk(x: number, y: number, side: number, k: number): [number, number] {
  const [q, r] = toAxial(x, y)
  return fromAxial(q + AQ[side] * k, r + AR[side] * k)
}

/** Unit vector (in cell widths, y down) pointing out of each side. */
export const DIR: [number, number][] = Array.from({ length: SIDES }, (_, s) => [Math.cos((s * Math.PI) / 3), Math.sin((s * Math.PI) / 3)])

/** Centre of a cell in cell widths, with cell (0, 0) at the origin. */
export const centerOf = (x: number, y: number): [number, number] => [x + (y & 1) / 2, y * ROW]

/** The cell whose centre is nearest a point given in cell widths. */
export function cellAt(px: number, py: number): [number, number] {
  const r = py / ROW
  const q = px - r / 2
  // Cube rounding: round all three coordinates, then fix the one that moved most.
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(-q - r)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs + q + r)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return fromAxial(rq, rr)
}

/** Axial offset from one cell to another. */
export function delta(fx: number, fy: number, tx: number, ty: number): [number, number] {
  const [aq, ar] = toAxial(fx, fy)
  const [bq, br] = toAxial(tx, ty)
  return [bq - aq, br - ar]
}

/** Move a cell by an axial offset. */
export function translate(x: number, y: number, dq: number, dr: number): [number, number] {
  const [q, r] = toAxial(x, y)
  return fromAxial(q + dq, r + dr)
}

/** An axial offset turned 60° clockwise. */
export const turnDelta = (dq: number, dr: number): [number, number] => [-dr, dq + dr]

/** Rotate cell (x, y) about the pivot cell by `turns` sixths of a turn clockwise. */
export function rotateAbout(px: number, py: number, x: number, y: number, turns = 1): [number, number] {
  let [dq, dr] = delta(px, py, x, y)
  for (let i = 0; i < ((turns % 6) + 6) % 6; i++) [dq, dr] = turnDelta(dq, dr)
  return translate(px, py, dq, dr)
}

/** Visit every in-bounds cell whose centre lies within `radius` cell widths of (x, y)'s centre. */
export function forEachWithin(
  x: number,
  y: number,
  radius: number,
  cols: number,
  rows: number,
  fn: (cx: number, cy: number, dist: number) => void,
) {
  const [ox, oy] = centerOf(x, y)
  const dy = Math.ceil(radius / ROW)
  const dx = Math.ceil(radius) + 1
  for (let cy = Math.max(0, y - dy); cy <= Math.min(rows - 1, y + dy); cy++) {
    for (let cx = Math.max(0, x - dx); cx <= Math.min(cols - 1, x + dx); cx++) {
      const [px, py] = centerOf(cx, cy)
      const d = Math.hypot(px - ox, py - oy)
      if (d <= radius) fn(cx, cy, d)
    }
  }
}
