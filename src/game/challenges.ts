/**
 * The twenty challenges, easiest first. Each lays out a map of locked
 * fixtures, limits which parts the player may use, and says how to tell when
 * it is solved. Every one has a reference solution in the test suite.
 */
import { translate } from '../sim/hex'
import { step } from '../sim/engine'
import {
  byTag,
  follow,
  inGoal,
  lampLights,
  mapKit,
  outOf,
  periodOf,
  playerAtoms,
  powerOn,
  rect,
  run,
  setSwitch,
  truthTable,
} from './challenge'
import type { Challenge, CheckCtx, Verdict } from './challenge'

const ok = (status: string): Verdict => ({ solved: true, status })
const no = (status: string): Verdict => ({ solved: false, status })
const paused = (c: CheckCtx) => (c.running ? '' : ' · press Space to run')

/** Offset cell at an axial offset from an anchor, for layouts drawn in axial coordinates. */
const rel = (ax: number, ay: number, q: number, r: number) => translate(ax, ay, q, r)

/** Small deterministic PRNG so generated maps are the same every time. */
function mulberry(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const lampCheck = (c: CheckCtx) => (lampLights(c) ? ok('The lamp is lit') : no('The lamp is still dark'))

/** Ticks the reference fuse (three Chronons at 3, chained) takes to light the lamp. */
export const FUSE_TICKS = 10

export const CHALLENGES: Challenge[] = [
  {
    id: 'first-light',
    title: 'First Light',
    stars: 1,
    brief: 'Carry the Spark’s charge across to the Lamp.',
    hint: 'Conduits bond on every side and share one charge. Lay them in a line between the two.',
    parts: { conduit: 3 },
    verified: true,
    build: () => mapKit(8, 5).fix('spark', 1, 2, { on: true, out: true }).lamp(5, 2).done(),
    check: lampCheck,
  },
  {
    id: 'detour',
    title: 'Detour',
    stars: 1,
    brief: 'A wall of bedrock stands in the way. Wire around it to light the Lamp.',
    hint: 'Nothing bonds to bedrock. There is a gap at the top of the wall, and you have exactly enough conduit for the shortest way through it.',
    parts: { conduit: 10 },
    verified: true,
    build: () =>
      mapKit(11, 7)
        .fix('spark', 1, 3, { on: true, out: true })
        .lamp(9, 3)
        .rock(rect(5, 1, 5, 6))
        .done(),
    check: lampCheck,
  },
  {
    id: 'relay-race',
    title: 'Relay Race',
    stars: 2,
    brief: 'Turn the Orium relays so the signal runs down the line to the Lamp. You have 7 turns.',
    hint: 'A relay takes charge on its three back edges and passes it out of its front tab. Each turn is 60° clockwise, so count how far each one has to go.',
    parts: {},
    turns: 7,
    verified: true,
    build: () => {
      const k = mapKit(9, 5).fix('spark', 1, 2, { on: true, out: true }).lamp(7, 2)
      ;[5, 0, 4, 5, 3].forEach((rot, i) => k.fix('or', 2 + i, 2, { rot, lock: 'turn' }))
      return k.done()
    },
    check: lampCheck,
  },
  {
    id: 'fan-out',
    title: 'Fan Out',
    stars: 2,
    brief: 'Light all three Lamps from the one Spark, using no more than 11 conduits.',
    hint: 'Conduits that touch share their charge, so one trunk can feed several branches. Branch late.',
    parts: { conduit: 11 },
    verified: true,
    build: () =>
      mapKit(11, 9)
        .fix('spark', 1, 4, { on: true, out: true })
        .lamp(8, 1, 'l1')
        .lamp(9, 4, 'l2')
        .lamp(8, 7, 'l3')
        .done(),
    check: (c) => {
      const lit = ['l1', 'l2', 'l3'].filter((t) => lampLights(c, t)).length
      return lit === 3 ? ok('All three lamps are lit') : no(`${lit} of 3 lamps lit`)
    },
  },
  {
    id: 'polarity',
    title: 'Polarity',
    stars: 2,
    brief: 'Make the Lamp shine only while the switch is OFF.',
    hint: 'A Negon outputs the opposite of what it receives. Click the switch to try both positions.',
    parts: { not: 1, conduit: 4 },
    verified: true,
    build: () => mapKit(9, 5).switch(1, 2, 'a').lamp(7, 2).note(0, 1, 'SWITCH').done(),
    check: (c) => truthTable(c, ['a'], ['the switch'], ([a]) => !a),
  },
  {
    id: 'liftoff',
    title: 'Liftoff',
    stars: 2,
    brief: 'Build a ship in the blue bay and fly it into the green zone.',
    hint: 'A Propulsor pushes its whole molecule toward its nose while it is charged. Feed it from a Spark on one of its flank slots.',
    parts: { spark: 1, propulsor: 1 },
    build: () =>
      mapKit(14, 7)
        .zone('build', rect(1, 1, 3, 5))
        .zone('goal', rect(11, 1, 13, 5))
        .note(1, 0, 'BUILD')
        .note(11, 0, 'GOAL')
        .done(),
    check: (c) => (inGoal(c, playerAtoms(c.world)) ? ok('Touchdown') : no(`Your ship has not reached the goal${paused(c)}`)),
  },
  {
    id: 'both-keys',
    title: 'Both Keys',
    stars: 2,
    brief: 'The Lamp may light only when switch A and switch B are both ON.',
    hint: 'An Andium fires when every bonded slot is charged. Bring A and B to two of its back slots on separate wires that never touch.',
    parts: { and: 1, conduit: 11 },
    verified: true,
    build: () => mapKit(10, 8).switch(1, 1, 'a').switch(1, 6, 'b').lamp(8, 3).note(0, 0, 'A').note(0, 7, 'B').done(),
    check: (c) => truthTable(c, ['a', 'b'], ['A', 'B'], ([a, b]) => a && b),
  },
  {
    id: 'full-circle',
    title: 'Full Circle',
    stars: 2,
    brief: 'Make a molecule turn all the way round: six turns of 60°.',
    hint: 'A Gyron turns its whole molecule once each time its input switches on. A Pulsar switches on over and over.',
    parts: { gyron: 1, pulsar: 1 },
    build: () => mapKit(9, 9).done(),
    check: (c) => (c.totals.spins >= 6 ? ok('A full circle') : no(`${c.totals.spins} of 6 turns${paused(c)}`)),
  },
  {
    id: 'latch',
    title: 'Latch',
    stars: 3,
    brief: 'Press the switch once and the Lamp must stay lit, even after the switch goes off again.',
    hint: 'A Mnemon stores one bit. Its back slot flips the bit each time it is charged; its lower back slot sets it.',
    parts: { mnemon: 1, conduit: 4 },
    verified: true,
    build: () => mapKit(9, 5).switch(1, 2, 'a').lamp(7, 2).note(0, 1, 'SWITCH').done(),
    check: (c) => {
      const { a, lamp } = c.setup.tags
      let w = run(powerOn(setSwitch(c.world, a, false)), 6)
      if (outOf(w, lamp)) return no('The lamp must start dark')
      w = run(setSwitch(w, a, true), 4)
      w = run(setSwitch(w, a, false), 12)
      return outOf(w, lamp) ? ok('It remembers') : no('After one press and release, the lamp should stay lit')
    },
  },
  {
    id: 'pipe-maze',
    title: 'Pipe Maze',
    stars: 3,
    brief: 'A whole block of relays. Find a route from the Spark to the Lamp and turn just the relays on it. You have 10 turns.',
    hint: 'A relay can pass the signal straight on or bend it by 60°. Plan the route first; a cheap route may not be the straightest one.',
    parts: {},
    turns: 10,
    verified: true,
    build: () => {
      const k = mapKit(11, 7).fix('spark', 1, 3, { on: true, out: true }).lamp(9, 3)
      const rand = mulberry(104)
      for (const [x, y] of rect(2, 1, 8, 5)) k.fix('or', x, y, { rot: Math.floor(rand() * 6), lock: 'turn' })
      return k.done()
    },
    check: lampCheck,
  },
  {
    id: 'printer',
    title: 'Printer',
    stars: 3,
    brief: 'Fabricate 12 new atoms.',
    hint: 'A Fabricator copies whatever it grips at its back each time its input switches on, and puts the copy in front. A Repulsar behind the printer pushes the copies away, but it pushes the printer too, so pin it (P).',
    parts: { fabricator: 1, pulsar: 1, lumen: 1, repulsar: 1 },
    build: () => mapKit(12, 9).done(),
    check: (c) => (c.totals.born >= 12 ? ok('Twelve copies printed') : no(`${c.totals.born} of 12 printed${paused(c)}`)),
  },
  {
    id: 'shove',
    title: 'Shove',
    stars: 3,
    brief: 'Push the locked Lamp into the green zone. All you get is one Repulsar.',
    hint: 'A Repulsar pushes other molecules straight away from itself, until they leave its field. Its radius goes up to 10 in the Inspector.',
    parts: { repulsar: 1 },
    build: () =>
      mapKit(13, 9)
        .fix('lumen', 6, 4, { tag: 'crate', pinned: false })
        .zone('build', rect(1, 5, 3, 8))
        .zone('goal', rect(10, 0, 12, 2))
        .done(),
    check: (c) => {
      const crate = byTag(c, 'crate')
      return crate && inGoal(c, [crate]) ? ok('Delivered') : no(`The lamp is not in the goal yet${paused(c)}`)
    },
  },
  {
    id: 'no-orium',
    title: 'No Orium',
    stars: 3,
    brief: 'Make the Lamp light when A or B (or both) are ON, without an Orium.',
    hint: 'Either is on exactly when it is not true that both are off. Negons and one Andium are enough.',
    parts: { and: 1, not: 3, conduit: 10 },
    verified: true,
    build: () => mapKit(12, 9).switch(1, 2, 'a').switch(1, 6, 'b').lamp(10, 4).note(0, 1, 'A').note(0, 7, 'B').done(),
    check: (c) => truthTable(c, ['a', 'b'], ['A', 'B'], ([a, b]) => a || b),
  },
  {
    id: 'heartbeat',
    title: 'Heartbeat',
    stars: 4,
    brief: 'Make the Lamp blink with a rhythm of exactly 6 ticks, without a Pulsar.',
    hint: 'A Negon fed its own output flips every tick. Put a Chronon in the loop to slow it down, and tune its delay.',
    parts: { not: 1, chronon: 1, conduit: 6 },
    verified: true,
    build: () => mapKit(9, 7).lamp(5, 2).done(),
    check: (c) => {
      let w = run(powerOn(c.world), 30)
      const seq: boolean[] = []
      for (let i = 0; i < 48; i++) {
        w = step(w)
        seq.push(outOf(w, c.setup.tags.lamp))
      }
      const p = periodOf(seq)
      if (p === 6) return ok('A steady 6-tick heartbeat')
      if (p === 0) return no('The lamp is not blinking')
      if (p < 0) return no('The lamp blinks, but not to a steady rhythm')
      return no(`The lamp repeats every ${p} ticks; it should be every 6`)
    },
  },
  {
    id: 'slow-fuse',
    title: 'Slow Fuse',
    stars: 4,
    brief: `The Lamp must light exactly ${FUSE_TICKS} ticks after the switch turns on, and go dark ${FUSE_TICKS} ticks after it turns off. No Chronon may be set above 3.`,
    hint: 'Chronons in a row add their delays. Every hop has a cost too, so measure and adjust.',
    parts: { chronon: 4, conduit: 4 },
    verified: true,
    build: () => mapKit(12, 5).switch(1, 2, 'a').lamp(9, 2).note(0, 1, 'SWITCH').done(),
    check: (c) => {
      if (playerAtoms(c.world).some((a) => a.kind === 'chronon' && (a.delay ?? 4) > 3)) return no('Every Chronon must be set to 3 ticks or less')
      const { a, lamp } = c.setup.tags
      const w = run(powerOn(setSwitch(c.world, a, false)), 20)
      if (outOf(w, lamp)) return no('The lamp must be dark while the switch is off')
      const on = follow(w, a, lamp, true)
      if (on.ticks < 0) return no('The lamp never lights')
      if (on.ticks !== FUSE_TICKS) return no(`The lamp lights ${on.ticks} ticks after the switch; it should take ${FUSE_TICKS}`)
      const off = follow(run(on.w, 30), a, lamp, false)
      if (off.ticks !== FUSE_TICKS) return no(`The lamp goes dark ${off.ticks < 0 ? 'never' : `${off.ticks} ticks`} after release; it should take ${FUSE_TICKS}`)
      return ok(`Exactly ${FUSE_TICKS} ticks, both ways`)
    },
  },
  {
    id: 'corridor-run',
    title: 'Corridor Run',
    stars: 4,
    brief: 'Fly down the corridor, then turn into the green zone below. The ship has to make the turn on its own.',
    hint: 'A Gyron turns on a rising edge. Delay that edge with a Chronon so the turn comes once the ship is out of the corridor.',
    parts: { spark: 1, propulsor: 1, gyron: 1, chronon: 2, conduit: 2 },
    build: () =>
      mapKit(20, 9)
        .rock([...rect(4, 2, 10, 2), ...rect(4, 6, 10, 6)])
        .zone('build', rect(0, 3, 3, 5))
        .zone('goal', rect(13, 6, 19, 8))
        .note(0, 1, 'BUILD')
        .note(13, 5, 'GOAL')
        .done(),
    check: (c) => (inGoal(c, playerAtoms(c.world)) ? ok('Nailed the turn') : no(`Your ship has not reached the goal${paused(c)}`)),
  },
  {
    id: 'exclusive',
    title: 'Exclusive',
    stars: 4,
    brief: 'Light the Lamp when exactly one of A and B is ON, without a Xorium.',
    hint: 'One or the other, but not both: (A or B) and not (A and B). Each switch has to reach two gates, so one wire must go the long way round.',
    parts: { or: 1, and: 2, not: 1, conduit: 17 },
    verified: true,
    build: () => {
      const at = (q: number, r: number) => rel(8, 2, q, r)
      return mapKit(15, 9)
        .switch(...at(-5, 3), 'a')
        .switch(...at(0, 2), 'b')
        .lamp(...at(3, 2))
        .note(...at(-6, 4), 'A')
        .note(...at(-1, 2), 'B')
        .done()
    },
    check: (c) => truthTable(c, ['a', 'b'], ['A', 'B'], ([a, b]) => a !== b),
  },
  {
    id: 'count-four',
    title: 'Count to Four',
    stars: 4,
    brief: 'The Lamp must stay dark for the first three presses of the switch and light on the fourth.',
    hint: 'Each Mnemon is one bit of a binary counter. A Negon between two bits makes the next one flip when the previous one falls.',
    parts: { mnemon: 3, not: 2, conduit: 2 },
    verified: true,
    build: () => mapKit(10, 5).switch(1, 2, 'a').lamp(8, 2).note(0, 1, 'SWITCH').done(),
    check: (c) => {
      const { a, lamp } = c.setup.tags
      let w = powerOn(setSwitch(c.world, a, false))
      if (outOf(w, lamp)) return no('The lamp must start dark')
      for (let press = 1; press <= 4; press++) {
        w = run(setSwitch(w, a, true), 3)
        w = run(setSwitch(w, a, false), 12)
        const lit = outOf(w, lamp)
        if (press < 4 && lit) return no(`The lamp lit after press ${press}; it should wait for the fourth`)
        if (press === 4 && !lit) return no('The lamp should light on the fourth press')
      }
      return ok('Counts to four')
    },
  },
  {
    id: 'hungry',
    title: 'Hungry',
    stars: 5,
    brief: 'Build a creature that eats 6 of the drifting plankton.',
    hint: 'A Devourer eats whatever sits at its mouth while charged. Give it an engine to bump into food, or eyes to chase it, and a way to turn.',
    parts: { devourer: 1, oculus: 1, propulsor: 2, spark: 1, gyron: 1, quanta: 1, not: 2, and: 1, lumen: 8, conduit: 6 },
    build: () => {
      const k = mapKit(18, 12, 0.04)
      const rand = mulberry(29)
      const taken = new Set<string>()
      for (let n = 0; n < 30; ) {
        const x = 1 + Math.floor(rand() * 16)
        const y = 1 + Math.floor(rand() * 10)
        const key = `${x},${y}`
        if (taken.has(key) || (x > 4 && x < 13 && y > 2 && y < 9)) continue
        taken.add(key)
        k.fix('lumen', x, y, { pinned: false })
        n++
      }
      return k.note(5, 2, 'BUILD IN THE CLEARING').done()
    },
    check: (c) => (c.totals.eaten >= 6 ? ok('Well fed') : no(`${c.totals.eaten} of 6 eaten${paused(c)}`)),
  },
  {
    id: 'majority',
    title: 'Majority',
    stars: 5,
    brief: 'Three switches vote. Light the Lamp when at least two of them are ON.',
    hint: 'At least two means (A and B) or (C and (A or B)). A and B each feed two gates, so one of their wires must loop round the other.',
    parts: { and: 2, or: 2, conduit: 30 },
    verified: true,
    build: () => {
      const at = (q: number, r: number) => rel(7, 3, q, r)
      return mapKit(20, 10)
        .switch(...at(-5, 3), 'a')
        .switch(...at(0, 2), 'b')
        .switch(...at(6, -1), 'c')
        .lamp(...at(9, 2))
        .note(...at(-6, 4), 'A')
        .note(...at(-1, 2), 'B')
        .note(...at(5, -1), 'C')
        .done()
    },
    check: (c) => truthTable(c, ['a', 'b', 'c'], ['A', 'B', 'C'], (bits) => bits.filter(Boolean).length >= 2),
  },
]

export const challengeById = (id: string) => CHALLENGES.find((c) => c.id === id)

/** Challenges open two at a time beyond what you have solved, so one hard puzzle never blocks the rest. */
export const isUnlocked = (index: number, solved: Record<string, number>) => index < Object.keys(solved).length + 2
