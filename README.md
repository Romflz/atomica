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

## Code map

| Path | What |
| --- | --- |
| `src/sim/hex.ts` | Hex grid maths: neighbours, rotation, rounding (odd-r offset storage, axial maths) |
| `src/sim/` | Pure simulation: atom definitions, bond graph, logic and physics step, preset scenes |
| `src/render/` | Renderer-agnostic atom artwork and board geometry (shared by the GPU field and SVG icons) |
| `src/gpu/FieldRenderer.ts` | PixiJS v8 field renderer (WebGPU, falls back to WebGL), atlas-baked sprites |
| `src/game/progress.ts` | Discoveries, XP and levels |
| `src/components/` | React UI: palette, inspector, top bar, Codex |

## Deploy

The game is a static Vite build, configured for Vercel in `vercel.ts` (Vite preset, `pnpm build`, output `dist`, long-lived caching for fingerprinted assets). Import the repo in Vercel, or from the CLI:

```sh
vercel deploy        # preview
vercel deploy --prod # production
```
