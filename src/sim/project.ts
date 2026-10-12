/**
 * Project files: a whole field (size, heat, atoms with their settings and
 * live state, and notes) as JSON, so builds can be saved, shared and loaded.
 *
 * Import never trusts the file. Structural problems (not JSON, wrong format,
 * a newer version, an impossible field size) reject it with a readable
 * message; individual bad atoms are skipped and reported as warnings. Every
 * atom is rebuilt through `makeAtom`, so ids are fresh and missing settings
 * fall back to defaults.
 */
import { DEFS, makeAtom } from './atoms'
import { MAX_SIZE, MIN_SIZE } from './demos'
import type { Note } from './demos'
import { MAX_ATOMS } from './engine'
import type { Atom, AtomKind, World } from './types'

export const PROJECT_FORMAT = 'atomforge-project'
export const PROJECT_VERSION = 1
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024
const MAX_NOTES = 200
const MAX_NOTE_LENGTH = 120

export interface Project {
  world: World
  notes: Note[]
}

export class ProjectError extends Error {}

/** Atom fields worth saving, in file order. Ids are left out and regenerated on import. */
const ATOM_FIELDS = ['kind', 'x', 'y', 'rot', 'pinned', 'out', 'on', 'period', 'radius', 'delay', 'chance', 'channel', 'mem', 'prev'] as const

/** Serialise a project: readable, with one atom per line so files diff and edit nicely. */
export function exportProject({ world, notes }: Project): string {
  const atom = (a: Atom) => {
    const o: Record<string, unknown> = {}
    for (const k of ATOM_FIELDS) if (a[k] !== undefined) o[k] = a[k]
    return JSON.stringify(o)
  }
  const head = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    grid: 'hex',
    exportedAt: new Date().toISOString(),
  }
  const lines = [
    '{',
    ...Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    `  "world": { "cols": ${world.cols}, "rows": ${world.rows}, "tick": ${world.tick}, "heat": ${world.heat ?? 0}, "atoms": [`,
    world.atoms.map((a) => `    ${atom(a)}`).join(',\n'),
    '  ] },',
    `  "notes": [${notes.length ? '\n' + notes.map((n) => `    ${JSON.stringify({ x: n.x, y: n.y, text: n.text })}`).join(',\n') + '\n  ' : ''}]`,
    '}',
  ]
  return lines.filter((l) => l !== '').join('\n') + '\n'
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Settings from a file atom, type-checked and clamped to what the inspector allows. */
function settingsOf(raw: Record<string, unknown>): Partial<Atom> {
  const s: Partial<Atom> = {}
  if (typeof raw.pinned === 'boolean') s.pinned = raw.pinned
  if (typeof raw.out === 'boolean') s.out = raw.out
  if (typeof raw.on === 'boolean') s.on = raw.on
  if (typeof raw.prev === 'boolean') s.prev = raw.prev
  if (isInt(raw.period)) s.period = clamp(raw.period, 2, 32)
  if (isInt(raw.radius)) s.radius = clamp(raw.radius, 1, 10)
  if (isInt(raw.delay)) s.delay = clamp(raw.delay, 1, 16)
  if (isNum(raw.chance)) s.chance = clamp(raw.chance, 0, 1)
  if (isInt(raw.channel)) s.channel = clamp(raw.channel, 0, 3)
  if (isInt(raw.mem)) s.mem = clamp(raw.mem, 0, 0xffff)
  return s
}

/** Parse and validate a project file. Throws `ProjectError` with a player-facing message. */
export function importProject(text: string): { project: Project; warnings: string[] } {
  if (text.length > MAX_PROJECT_BYTES) throw new ProjectError('That file is too large to be a project (over 8 MB).')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ProjectError('That file is not valid JSON.')
  }
  if (!isObj(data) || data.format !== PROJECT_FORMAT) throw new ProjectError('That file is not an AtomForge project.')
  if (!isInt(data.version) || data.version < 1) throw new ProjectError('The project file has no valid version.')
  if (data.version > PROJECT_VERSION) throw new ProjectError('This project was saved by a newer version of AtomForge. Reload the page to update.')
  if (data.grid !== undefined && data.grid !== 'hex') throw new ProjectError('This project uses a grid this version cannot open.')

  const w = data.world
  if (!isObj(w)) throw new ProjectError('The project has no field.')
  const { cols, rows } = w
  if (!isInt(cols) || !isInt(rows) || cols < MIN_SIZE.cols || rows < MIN_SIZE.rows || cols > MAX_SIZE.cols || rows > MAX_SIZE.rows) {
    throw new ProjectError(`The field size must be between ${MIN_SIZE.cols}×${MIN_SIZE.rows} and ${MAX_SIZE.cols}×${MAX_SIZE.rows}.`)
  }
  if (!Array.isArray(w.atoms)) throw new ProjectError('The project has no atom list.')
  if (w.atoms.length > MAX_ATOMS) throw new ProjectError(`The project has more than ${MAX_ATOMS.toLocaleString()} atoms.`)

  const atoms: Atom[] = []
  const taken = new Set<number>()
  let unknown = 0
  let outside = 0
  let overlapping = 0
  for (const raw of w.atoms) {
    if (!isObj(raw) || typeof raw.kind !== 'string' || !(raw.kind in DEFS)) {
      unknown++
      continue
    }
    const { x, y } = raw
    if (!isInt(x) || !isInt(y) || x < 0 || y < 0 || x >= cols || y >= rows) {
      outside++
      continue
    }
    const cell = y * cols + x
    if (taken.has(cell)) {
      overlapping++
      continue
    }
    taken.add(cell)
    const rot = isInt(raw.rot) ? ((raw.rot % 6) + 6) % 6 : 0
    atoms.push(makeAtom(raw.kind as AtomKind, x, y, rot, settingsOf(raw)))
  }

  const notes: Note[] = []
  if (Array.isArray(data.notes)) {
    for (const n of data.notes.slice(0, MAX_NOTES)) {
      if (isObj(n) && isInt(n.x) && isInt(n.y) && typeof n.text === 'string' && n.text.trim()) {
        notes.push({ x: n.x, y: n.y, text: n.text.slice(0, MAX_NOTE_LENGTH) })
      }
    }
  }

  const warnings: string[] = []
  const skipped = (n: number, why: string) => n && warnings.push(`${n} atom${n === 1 ? '' : 's'} ${why}`)
  skipped(unknown, 'of an unknown kind skipped')
  skipped(outside, 'outside the field skipped')
  skipped(overlapping, 'on an occupied cell skipped')

  return {
    project: {
      world: { cols, rows, tick: isInt(w.tick) && w.tick >= 0 ? w.tick : 0, heat: isNum(w.heat) ? clamp(w.heat, 0, 1) : 0, atoms },
      notes,
    },
    warnings,
  }
}
