# AtomForge

A molecular logic sandbox on a hex grid. Drag atoms onto the field; their six edges snap together like jigsaw pieces into rigid molecules that carry signals, feel force fields, move, see, eat and copy themselves.

```sh
pnpm install
pnpm dev
```

## How it works

- **Bonding:** every atom is a hexagon, and each of its six edges is a tab (output), slot (input), socket (conduit), grip or flat. Tabs fit slots, sockets and grips fit anything, and like never fits like. Bonded atoms form one rigid molecule.
- **Signals:** charge flows from tabs into slots. Conduit chains share charge instantly, and every gate adds one tick of delay, so loops make clocks and memory. Gates take inputs on their three back edges and drive their front tab.
- **Physics:** Magnetar and Repulsar fields act only on *other* molecules, so attract/repel pairs chase each other. Propulsors drive their molecule in any of six directions and Gyrons turn it 60° at a time. Heat jostles small molecules so new reactions keep happening.
- **Life:** Oculi see, Devourers eat, Fabricators copy whatever they hold, and Clasps let go to split a molecule.

## Challenges

Twenty puzzles, from wiring a lamp to building a majority-vote circuit or a creature that hunts. Open them from **Challenges** at the top right. Each loads its own map with fixed parts (padlocked), turnable parts (↻, rotate both ways on a turn budget), build and goal zones, and a limited set of parts. Logic, memory and timing challenges are verified on a hidden copy of the field that tries every switch combination or press sequence; motion and life challenges are judged live. Two unsolved challenges are always open, so one hard puzzle never blocks the rest. Every challenge has a reference solution that was checked against its detector.

## Project files

**Project → Export JSON** (⌘S / Ctrl+S) downloads the whole field: size, heat, every atom with its settings and live charge, and notes. **Import JSON** (⌘O / Ctrl+O), or dropping a `.json` file on the window, opens one. Files are validated on import: anything malformed is rejected with a message, and individual bad atoms are skipped and reported. The format (`atomforge-project`, version 1) keeps one atom per line, so files stay readable and easy to diff.

## Code map

| Path | What |
| --- | --- |
| `src/sim/hex.ts` | Hex grid maths: neighbours, rotation, rounding (odd-r offset storage, axial maths) |
| `src/sim/` | Pure simulation: atom definitions, bond graph, logic and physics step, preset scenes |
| `src/sim/project.ts` | Project file export and validated import |
| `src/game/challenge.ts` | Challenge framework: map kit, zones, budgets, hidden-copy verification |
| `src/game/challenges.ts` | The twenty challenges |
| `src/render/` | Renderer-agnostic atom artwork and board geometry (shared by the GPU field and SVG icons) |
| `src/gpu/FieldRenderer.ts` | PixiJS v8 field renderer (WebGPU, falls back to WebGL), atlas-baked sprites |
| `src/components/` | React UI: palette, inspector, top bar, challenges, toasts |

## Deploy

The game is a static Vite build, configured for Vercel in `vercel.ts` (Vite preset, `pnpm build`, output `dist`, long-lived caching for fingerprinted assets). Import the repo in Vercel, or from the CLI:

```sh
vercel deploy        # preview
vercel deploy --prod # production
```
