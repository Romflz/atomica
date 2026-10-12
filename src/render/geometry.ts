import type { Port } from '../sim/types'

export const CELL = 64
/** Half-size of an atom body; leaves a 6px gap between neighbouring bodies. */
export const H = 29
const CORNER = 9

// Slot: a circular bite whose centre sits just inside the body edge.
const SLOT_R = 9.5
const SLOT_INSET = 4
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

const MID = [
  [0, -H],
  [H, 0],
  [0, H],
  [-H, 0],
]
const TAN = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]
const NOR = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

const f = (n: number) => +n.toFixed(2)

/** A point on side `s`, `t` along the edge (clockwise) and `n` outward from it. */
export function sidePoint(s: number, t: number, n: number): [number, number] {
  return [f(MID[s][0] + TAN[s][0] * t + NOR[s][0] * n), f(MID[s][1] + TAN[s][1] * t + NOR[s][1] * n)]
}

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

/** Outline of an atom body with tabs and slots cut into world-facing sides [N, E, S, W]. */
export function bodyPath(ports: Port[]): string {
  const c = CORNER
  let d = `M ${-H + c} ${-H} `
  d += edgeFeature(0, ports[0])
  d += `L ${H - c} ${-H} A ${c} ${c} 0 0 1 ${H} ${-H + c} `
  d += edgeFeature(1, ports[1])
  d += `L ${H} ${H - c} A ${c} ${c} 0 0 1 ${H - c} ${H} `
  d += edgeFeature(2, ports[2])
  d += `L ${-H + c} ${H} A ${c} ${c} 0 0 1 ${-H} ${H - c} `
  d += edgeFeature(3, ports[3])
  d += `L ${-H} ${-H + c} A ${c} ${c} 0 0 1 ${-H + c} ${-H} Z`
  return d
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
