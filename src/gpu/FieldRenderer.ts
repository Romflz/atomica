/**
 * GPU field renderer (PixiJS v8: WebGPU with WebGL fallback).
 *
 * The React layer owns state and input; this class owns a Pixi scene graph and
 * reconciles it against each new world snapshot in `sync`.
 *
 * Scaling strategy: every distinct atom look (its `artKey`) is tessellated
 * once from the shared `atomArt` description and *baked* into a texture at a
 * resolution matched to the current zoom. Atoms are then plain sprites, which
 * the GPU draws in large batches, so cost stays nearly flat from a dozen atoms
 * to tens of thousands. Only small animated parts (spinning rings, flames,
 * sight beams) stay as live vector meshes, all well under Pixi's batching
 * limit. When the zoom crosses a resolution step, visible atoms are re-baked a
 * few dozen per frame so there is never a hitch. Glows are additive sprites,
 * and motion is interpolated per frame independently of the tick rate.
 */
import {
  Application,
  BitmapFont,
  BitmapText,
  CanvasSource,
  Container,
  Graphics,
  GraphicsContext,
  GraphicsPath,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TilingSprite,
} from 'pixi.js'
import type { RendererPreference } from 'pixi.js'
import { artKey, atomArt, sidesFor, unbonded } from '../render/art'
import type { Anim, Shape } from '../render/art'
import { CELL, H } from '../render/geometry'
import { isForce } from '../sim/atoms'
import type { Note } from '../sim/demos'
import { DX, DY } from '../sim/engine'
import type { Graph } from '../sim/engine'
import type { Atom, World } from '../sim/types'

export interface View {
  x: number
  y: number
  k: number
}

export interface Ghost {
  cells: { atom: Atom; x: number; y: number }[]
  valid: boolean
}

export interface FieldScene {
  world: World
  graph: Graph
  notes: Note[]
  selectedId: string | null
  ghost: Ghost | null
  showFields: boolean
  resizePreview: { cols: number; rows: number } | null
  moveMs: number
}

type ShapeNoText = Exclude<Shape, { t: 'text' } | { t: 'halo' }>
type TextShape = Extract<Shape, { t: 'text' }>
type HaloShape = Extract<Shape, { t: 'halo' }>

interface Layer {
  base: GraphicsContext
  glow: GraphicsContext | null
}

/** Tessellated artwork for one look, shared by every atom that has it. */
interface Built {
  base: GraphicsContext
  glow: GraphicsContext | null
  free: Layer | null
  anims: Partial<Record<Anim, Layer>>
  halos: HaloShape[]
  texts: TextShape[]
}

interface LiveLayer {
  c: Container
  base: Graphics
  glow: Graphics
}

interface AtomNode {
  c: Container
  mark: Graphics
  halos: Container
  free: LiveLayer
  sprite: Sprite
  anims: Partial<Record<Anim, LiveLayer>>
  key: string
  res: number
  /** A new look waiting for bake budget; the old texture shows until then. */
  pending: { key: string; b: Built } | null
  x: number
  y: number
  tx: number
  ty: number
  pop: number
}

interface FieldNode {
  c: Container
  area: Sprite
  edge: Sprite
  rings: Sprite[]
  atomId: string
  inward: boolean
  on: boolean
  R: number
}

const ANIMS: Anim[] = ['spin', 'flicker', 'pulse']
const FONT_DISPLAY = 'AtomDisplay'
const FONT_MONO = 'AtomMono'
/** Baked textures cover ±BAKE units around the cell centre (tabs and arms reach ~50). */
const BAKE = 56
const RES_STEPS = [0.25, 0.5, 1, 2, 4]
const REBAKE_PER_FRAME = 40
/** New looks baked synchronously per sync; the rest are spread over following frames. */
const BAKES_PER_SYNC = 150
const MAX_TEXTURES = 2500
const MAX_BUILT = 4000

export class FieldRenderer {
  readonly app = new Application()
  backend = 'webgl'
  hoverId: string | null = null
  onStats?: (fps: number) => void

  private root = new Container()
  private boardLayer = new Container()
  private noteLayer = new Container()
  private fieldLayer = new Container()
  private atomLayer = new Container()
  private fxLayer = new Container()
  private ghostLayer = new Container()
  private uiLayer = new Container()
  private bakeStage = new Container()

  private nodes = new Map<string, AtomNode>()
  private dying: { node: AtomNode; t: number }[] = []
  private fields = new Map<string, FieldNode>()
  private flashes: { s: Sprite; t: number }[] = []
  private built = new Map<string, Built>()
  private textures = new Map<string, { tex: Texture; used: number }>()
  private animated = new Set<AtomNode>()

  private tex!: { halo: Texture; ring: Texture; dash: Texture; grid: Texture }
  private markCtx = new GraphicsContext()
  private reticle = new Graphics()
  private hoverBox = new Graphics()
  private resizeGfx = new Graphics()
  private resizeLabel!: Text
  private grid?: TilingSprite
  private board = new Graphics()
  private edge = new Graphics()

  private scene: FieldScene | null = null
  private view: View = { x: 0, y: 0, k: 1 }
  private res = 1
  private boardSize = ''
  private notesRef: Note[] | null = null
  private ghostRef: Ghost | null = null
  private bondKeys = new Set<string>()
  private destroyed = false
  private inited = false
  private time = 0
  private frame = 0

  async init(host: HTMLElement, preference: RendererPreference) {
    await this.app.init({
      preference,
      antialias: true,
      backgroundAlpha: 0,
      resizeTo: host,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      // Input is handled on the host element, so skip Pixi's hit-testing entirely.
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    })
    this.inited = true
    if (this.destroyed) {
      this.app.destroy({ removeView: true }, { children: true })
      return
    }
    this.backend = this.app.renderer.name
    this.app.stage.eventMode = 'none'
    if (import.meta.env.DEV) (window as unknown as { __field: FieldRenderer }).__field = this
    host.appendChild(this.app.canvas)

    await loadFonts()
    if (this.destroyed) return
    BitmapFont.install({
      name: FONT_DISPLAY,
      style: { fontFamily: 'Orbitron, sans-serif', fontSize: 64, fontWeight: '800', fill: '#ffffff' },
      chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], ' %+-./'],
      resolution: 1,
      padding: 4,
    })
    BitmapFont.install({
      name: FONT_MONO,
      style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 40, fontWeight: '500', fill: '#ffffff' },
      chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], ' %+-./×:·'],
      resolution: 1,
      padding: 4,
    })

    this.tex = makeTextures()
    this.markCtx
      .roundRect(-CELL / 2 + 1, -CELL / 2 + 1, CELL - 2, CELL - 2, 14)
      .fill({ color: '#38e8ff', alpha: 0.06 })
      .stroke({ width: 1.5, color: '#38e8ff', alpha: 0.35 })
    this.drawReticle()
    this.hoverBox.roundRect(-H - 5, -H - 5, H * 2 + 10, H * 2 + 10, 13).stroke({ width: 1.5, color: '#ffffff', alpha: 0.22 })
    this.hoverBox.visible = false
    this.resizeLabel = new Text({ text: '', style: { fontFamily: 'Orbitron, sans-serif', fontSize: 22, fontWeight: '700', fill: '#38e8ff', letterSpacing: 2 } })
    this.resizeLabel.anchor.set(1, 1)

    this.app.stage.addChild(this.root)
    this.root.addChild(this.boardLayer, this.noteLayer, this.fieldLayer, this.atomLayer, this.fxLayer, this.ghostLayer, this.uiLayer)
    this.boardLayer.addChild(this.board, this.edge)
    this.uiLayer.addChild(this.hoverBox, this.reticle, this.resizeGfx, this.resizeLabel)

    let statT = 0
    this.app.ticker.add((t) => {
      this.update(t.deltaMS)
      statT += t.deltaMS
      if (statT > 500) {
        statT = 0
        this.onStats?.(Math.round(this.app.ticker.FPS))
      }
    })
    this.setView(this.view)
    if (this.scene) this.sync(this.scene)
  }

  get ready() {
    return !!this.tex && !this.destroyed
  }

  destroy() {
    this.destroyed = true
    // If init is still in flight, it tears the app down itself once it resolves.
    if (this.inited) this.app.destroy({ removeView: true }, { children: true })
  }

  setView(v: View) {
    this.view = v
    this.root.position.set(v.x, v.y)
    this.root.scale.set(v.k)
    const want = v.k * Math.min(window.devicePixelRatio || 1, 2)
    this.res = RES_STEPS.find((r) => r >= want * 0.85) ?? RES_STEPS[RES_STEPS.length - 1]
  }

  // ── Reconcile ─────────────────────────────────────────────────────

  sync(scene: FieldScene) {
    this.scene = scene
    if (!this.ready) return
    const { world, graph } = scene

    if (`${world.cols}x${world.rows}` !== this.boardSize) this.drawBoard(world.cols, world.rows)
    if (scene.notes !== this.notesRef) this.drawNotes(scene.notes)

    const sides = sidesFor(graph)
    const selectedMol = new Set<string>()
    if (scene.selectedId && graph.molOf.has(scene.selectedId)) {
      const mol = graph.molecules[graph.molOf.get(scene.selectedId)!]
      if (mol.length > 1) mol.forEach((id) => selectedMol.add(id))
    }

    const seen = new Set<string>()
    let bakes = 0
    for (const a of world.atoms) {
      seen.add(a.id)
      const s = sides.get(a.id)!
      const tx = a.x * CELL + CELL / 2
      const ty = a.y * CELL + CELL / 2
      let n = this.nodes.get(a.id)
      if (!n) {
        n = this.createNode(tx, ty)
        this.nodes.set(a.id, n)
      }
      const key = artKey(a, s)
      if (n.key !== key && n.pending?.key !== key) {
        let b = this.built.get(key)
        if (!b) {
          b = buildArt(atomArt(a, s))
          this.built.set(key, b)
        }
        const cached = this.textures.has(`${key}@${this.res}`)
        if (cached || bakes < BAKES_PER_SYNC || !n.key) {
          if (!cached) bakes++
          this.applyArt(n, key, b)
          n.pending = null
        } else {
          n.pending = { key, b }
        }
      }
      n.tx = tx
      n.ty = ty
      n.mark.visible = selectedMol.has(a.id)
    }
    for (const [id, n] of this.nodes) {
      if (seen.has(id)) continue
      this.nodes.delete(id)
      this.animated.delete(n)
      this.dying.push({ node: n, t: 0 })
    }

    this.syncFields(world, scene.showFields)
    this.syncBondFlashes(graph)
    if (scene.ghost !== this.ghostRef) this.drawGhost(scene.ghost)
    this.drawResize(world, scene.resizePreview)
    if (this.textures.size > MAX_TEXTURES || this.built.size > MAX_BUILT) this.prune()
  }

  private createNode(x: number, y: number): AtomNode {
    const c = new Container()
    const mark = new Graphics(this.markCtx)
    mark.visible = false
    const halos = new Container()
    const free = makeLiveLayer()
    const sprite = new Sprite()
    sprite.anchor.set(0.5)
    c.addChild(mark, halos, free.c, sprite)
    c.position.set(x, y)
    c.scale.set(0.3)
    this.atomLayer.addChild(c)
    return { c, mark, halos, free, sprite, anims: {}, key: '', res: 0, pending: null, x, y, tx: x, ty: y, pop: 0 }
  }

  private applyArt(n: AtomNode, key: string, b: Built) {
    n.key = key
    n.sprite.texture = this.textureFor(key, b, this.res)
    n.sprite.width = n.sprite.height = BAKE * 2
    n.res = this.res

    setLayer(n.free, b.free)

    let hasAnim = false
    for (const kind of ANIMS) {
      const src = b.anims[kind]
      let layer = n.anims[kind]
      if (src && !layer) {
        layer = n.anims[kind] = makeLiveLayer()
        n.c.addChild(layer.c)
      }
      if (layer) setLayer(layer, src ?? null)
      if (src) hasAnim = true
    }
    if (hasAnim) this.animated.add(n)
    else this.animated.delete(n)

    syncPool(n.halos, b.halos.length, () => {
      const s = new Sprite(this.tex.halo)
      s.anchor.set(0.5)
      s.blendMode = 'add'
      return s
    })
    b.halos.forEach((h, i) => {
      const s = n.halos.children[i] as Sprite
      s.tint = h.color
      s.alpha = h.alpha
      s.width = s.height = h.r * 2
    })
  }

  /** Baked texture for a look at a resolution, rendering it on first use. */
  private textureFor(key: string, b: Built, res: number): Texture {
    const id = `${key}@${res}`
    let e = this.textures.get(id)
    if (!e) {
      e = { tex: this.bake(b, res), used: this.frame }
      this.textures.set(id, e)
    }
    e.used = this.frame
    return e.tex
  }

  private bake(b: Built, res: number): Texture {
    const stage = this.bakeStage
    stage.addChild(new Graphics(b.base))
    if (b.glow) {
      const g = new Graphics(b.glow)
      g.blendMode = 'add'
      stage.addChild(g)
    }
    for (const t of b.texts) {
      const bt = new BitmapText({ text: t.text, style: { fontFamily: t.font === 'display' ? FONT_DISPLAY : FONT_MONO, fontSize: t.size, letterSpacing: t.spacing ?? 0 } })
      bt.anchor.set(t.anchor === 'middle' ? 0.5 : 0, 0.5)
      bt.position.set(t.x, t.y)
      bt.tint = t.color
      bt.alpha = t.alpha ?? 1
      stage.addChild(bt)
    }
    const tex = this.app.renderer.generateTexture({ target: stage, frame: new Rectangle(-BAKE, -BAKE, BAKE * 2, BAKE * 2), resolution: res, antialias: true })
    // Graphics built on shared contexts leave those contexts intact when destroyed.
    stage.removeChildren().forEach((c) => c.destroy())
    return tex
  }

  private syncFields(world: World, show: boolean) {
    this.fieldLayer.visible = show
    const seen = new Set<string>()
    for (const a of world.atoms) {
      if (!isForce(a.kind)) continue
      seen.add(a.id)
      let f = this.fields.get(a.id)
      if (!f) {
        const c = new Container()
        const area = new Sprite(this.tex.halo)
        const edge = new Sprite(this.tex.dash)
        area.anchor.set(0.5)
        edge.anchor.set(0.5)
        const rings = [0, 1, 2].map(() => {
          const r = new Sprite(this.tex.ring)
          r.anchor.set(0.5)
          r.blendMode = 'add'
          return r
        })
        c.addChild(area, edge, ...rings)
        this.fieldLayer.addChild(c)
        f = { c, area, edge, rings, atomId: a.id, inward: true, on: false, R: 0 }
        this.fields.set(a.id, f)
      }
      const inward = a.kind === 'magnetar'
      const color = inward ? '#5b8cff' : '#ff8a2a'
      f.inward = inward
      f.on = a.out
      f.R = ((a.radius ?? 5) + 0.5) * CELL
      f.area.tint = color
      f.area.alpha = a.out ? 0.42 : 0
      f.area.width = f.area.height = f.R * 2
      f.edge.tint = color
      f.edge.alpha = a.out ? 0.55 : 0.2
      f.edge.width = f.edge.height = f.R * 2
      for (const r of f.rings) {
        r.tint = inward ? '#7da3ff' : '#ffa45c'
        r.visible = a.out
      }
    }
    for (const [id, f] of this.fields) {
      if (seen.has(id)) continue
      f.c.destroy({ children: true })
      this.fields.delete(id)
    }
  }

  private syncBondFlashes(graph: Graph) {
    const keys = new Set<string>()
    let budget = 160
    for (const b of graph.bonds) {
      const k = `${b.a}|${b.b}`
      keys.add(k)
      if (this.bondKeys.has(k) || budget <= 0) continue
      budget--
      const a = graph.byId.get(b.a)!
      const s = new Sprite(this.tex.ring)
      s.anchor.set(0.5)
      s.blendMode = 'add'
      s.position.set(a.x * CELL + CELL / 2 + (DX[b.side] * CELL) / 2, a.y * CELL + CELL / 2 + (DY[b.side] * CELL) / 2)
      s.width = s.height = 6
      this.fxLayer.addChild(s)
      this.flashes.push({ s, t: 0 })
    }
    this.bondKeys = keys
  }

  // ── Static-ish layers ─────────────────────────────────────────────

  private drawBoard(cols: number, rows: number) {
    this.boardSize = `${cols}x${rows}`
    const W = cols * CELL
    const Hh = rows * CELL
    this.board.clear().roundRect(0, 0, W, Hh, 10).fill({ color: '#080e1f' })
    this.grid?.destroy()
    this.grid = new TilingSprite({ texture: this.tex.grid, width: W, height: Hh })
    this.boardLayer.addChildAt(this.grid, 1)
    this.edge.clear().roundRect(0, 0, W, Hh, 10).stroke({ width: 2, color: '#5a8cff', alpha: 0.4 })
  }

  private drawNotes(notes: Note[]) {
    this.notesRef = notes
    this.noteLayer.removeChildren().forEach((c) => c.destroy())
    for (const n of notes) {
      const t = new Text({ text: n.text, style: { fontFamily: 'Orbitron, sans-serif', fontSize: 15, fontWeight: '700', fill: '#96b4ff', letterSpacing: 3 } })
      t.alpha = 0.42
      t.anchor.set(0, 0.5)
      t.position.set(n.x * CELL + 8, n.y * CELL + CELL / 2)
      this.noteLayer.addChild(t)
    }
  }

  private drawGhost(ghost: Ghost | null) {
    this.ghostRef = ghost
    this.ghostLayer.removeChildren().forEach((c) => c.destroy({ children: true }))
    if (!ghost) return
    const tint = ghost.valid ? '#38e8ff' : '#ff3b5c'
    for (const { atom, x, y } of ghost.cells) {
      const c = new Container()
      c.position.set(x * CELL + CELL / 2, y * CELL + CELL / 2)
      const cell = new Graphics().roundRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4, 10).fill({ color: tint, alpha: 0.08 }).stroke({ width: 1.5, color: tint, alpha: 0.7 })
      const opts = { ghost: true, invalid: !ghost.valid }
      const key = `ghost|${artKey(atom, unbonded(atom), opts)}`
      let b = this.built.get(key)
      if (!b) {
        b = buildArt(atomArt(atom, undefined, opts))
        this.built.set(key, b)
      }
      const s = new Sprite(this.textureFor(key, b, this.res))
      s.anchor.set(0.5)
      s.width = s.height = BAKE * 2
      s.alpha = 0.78
      c.addChild(cell, s)
      this.ghostLayer.addChild(c)
    }
  }

  private drawResize(world: World, preview: { cols: number; rows: number } | null) {
    const g = this.resizeGfx.clear()
    const W = world.cols * CELL
    const Hh = world.rows * CELL
    // Corner grip: three diagonal strokes.
    for (let i = 0; i < 3; i++) {
      const o = 10 + i * 9
      g.moveTo(W - o, Hh + 14).lineTo(W + 14, Hh - o)
    }
    g.stroke({ width: 3, color: '#38e8ff', alpha: preview ? 1 : 0.55, cap: 'round' })
    this.resizeLabel.visible = !!preview
    if (!preview) return
    const pw = preview.cols * CELL
    const ph = preview.rows * CELL
    g.rect(0, 0, pw, ph).fill({ color: '#38e8ff', alpha: 0.04 }).stroke({ width: 3, color: '#38e8ff', alpha: 0.9 })
    // Shade whatever would be cropped away.
    if (pw < W) g.rect(pw, 0, W - pw, Hh).fill({ color: '#ff3b5c', alpha: 0.12 })
    if (ph < Hh) g.rect(0, ph, Math.min(pw, W), Hh - ph).fill({ color: '#ff3b5c', alpha: 0.12 })
    this.resizeLabel.text = `${preview.cols} × ${preview.rows}`
    this.resizeLabel.position.set(pw - 14, ph - 12)
  }

  private drawReticle() {
    const g = this.reticle
    const r = H + 8
    const l = 12
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      g.moveTo(sx * r, sy * (r - l)).lineTo(sx * r, sy * r).lineTo(sx * (r - l), sy * r)
    }
    g.stroke({ width: 2.5, color: '#ffffff', alpha: 0.95, cap: 'round', join: 'round' })
    g.visible = false
  }

  /** Free textures and tessellations that no on-screen atom uses any more. */
  private prune() {
    const liveTex = new Set<Texture>()
    const liveKeys = new Set<string>()
    for (const n of [...this.nodes.values(), ...this.dying.map((d) => d.node)]) {
      liveTex.add(n.sprite.texture)
      liveKeys.add(n.key)
      if (n.pending) liveKeys.add(n.pending.key)
    }
    for (const c of this.ghostLayer.children) for (const s of c.children) if (s instanceof Sprite) liveTex.add(s.texture)
    const entries = [...this.textures.entries()].sort((a, b) => a[1].used - b[1].used)
    for (const [id, e] of entries) {
      if (this.textures.size <= MAX_TEXTURES * 0.7) break
      if (liveTex.has(e.tex)) continue
      e.tex.destroy(true)
      this.textures.delete(id)
    }
    if (this.built.size > MAX_BUILT) {
      for (const [k, b] of this.built) {
        if (liveKeys.has(k) || k.startsWith('ghost|')) continue
        for (const ctx of [b.base, b.glow, b.free?.base, b.free?.glow, ...Object.values(b.anims).flatMap((l) => [l.base, l.glow])]) ctx?.destroy()
        this.built.delete(k)
      }
    }
  }

  // ── Per-frame ─────────────────────────────────────────────────────

  private update(dtMs: number) {
    if (!this.scene || !this.ready) return
    this.frame++
    this.time += dtMs / 1000
    const t = this.time
    const ease = 1 - Math.exp(-dtMs / Math.max(16, this.scene.moveMs * 0.32))

    // Visible world rectangle, for progressive re-baking after zoom changes.
    const k = this.view.k
    const vx0 = -this.view.x / k - CELL
    const vy0 = -this.view.y / k - CELL
    const vx1 = vx0 + this.app.screen.width / k + CELL * 2
    const vy1 = vy0 + this.app.screen.height / k + CELL * 2
    let bakes = 0

    for (const n of this.nodes.values()) {
      const dx = n.tx - n.x
      const dy = n.ty - n.y
      if (dx !== 0 || dy !== 0) {
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
          n.x = n.tx
          n.y = n.ty
        } else {
          n.x += dx * ease
          n.y += dy * ease
        }
        n.c.position.set(n.x, n.y)
      }
      if (n.pop < 1) {
        n.pop = Math.min(1, n.pop + dtMs / 260)
        n.c.scale.set(easeOutBack(n.pop))
      }
      if (n.pending && bakes < REBAKE_PER_FRAME) {
        if (!this.textures.has(`${n.pending.key}@${this.res}`)) bakes++
        this.applyArt(n, n.pending.key, n.pending.b)
        n.pending = null
      } else if (n.res !== this.res && bakes < REBAKE_PER_FRAME && n.x > vx0 && n.x < vx1 && n.y > vy0 && n.y < vy1) {
        const b = this.built.get(n.key)
        if (b) {
          if (!this.textures.has(`${n.key}@${this.res}`)) bakes++
          n.sprite.texture = this.textureFor(n.key, b, this.res)
          n.sprite.width = n.sprite.height = BAKE * 2
          n.res = this.res
        }
      }
    }

    for (const n of this.animated) {
      const spin = n.anims.spin
      if (spin?.c.visible) spin.c.rotation = t * 1.9
      const fl = n.anims.flicker
      if (fl?.c.visible) fl.c.alpha = 0.65 + Math.random() * 0.35
      const pu = n.anims.pulse
      if (pu?.c.visible) pu.c.scale.set(1 + 0.07 * Math.sin(t * 16))
    }

    for (const f of this.fields.values()) {
      const n = this.nodes.get(f.atomId)
      if (n) f.c.position.set(n.x, n.y)
      if (!f.on || !this.fieldLayer.visible) continue
      const lo = CELL * 0.55
      f.rings.forEach((r, i) => {
        const ph = (t / 2.4 + i / 3) % 1
        const rad = f.inward ? f.R + (lo - f.R) * ph : lo + (f.R - lo) * ph
        r.width = r.height = rad * 2
        r.alpha = Math.sin(ph * Math.PI) * 0.75
      })
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.t += dtMs / 700
      if (f.t >= 1) {
        f.s.destroy()
        this.flashes.splice(i, 1)
        continue
      }
      f.s.width = f.s.height = 6 + 40 * f.t
      f.s.alpha = 0.95 * (1 - f.t)
    }

    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i]
      d.t += dtMs / 320
      if (d.t >= 1) {
        d.node.c.destroy({ children: true })
        this.dying.splice(i, 1)
        continue
      }
      d.node.c.alpha = 1 - d.t
      d.node.c.scale.set(1 + d.t * 0.6)
    }

    const sel = this.scene.selectedId ? this.nodes.get(this.scene.selectedId) : undefined
    this.reticle.visible = !!sel
    if (sel) {
      this.reticle.position.set(sel.x, sel.y)
      this.reticle.scale.set(1 + 0.05 * Math.sin(t * 5))
    }
    const hov = this.hoverId && this.hoverId !== this.scene.selectedId ? this.nodes.get(this.hoverId) : undefined
    this.hoverBox.visible = !!hov
    if (hov) this.hoverBox.position.set(hov.x, hov.y)
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeLiveLayer(): LiveLayer {
  const c = new Container()
  const base = new Graphics()
  const glow = new Graphics()
  glow.blendMode = 'add'
  c.addChild(base, glow)
  c.visible = false
  return { c, base, glow }
}

function setLayer(l: LiveLayer, src: Layer | null) {
  l.c.visible = !!src
  if (!src) return
  l.base.context = src.base
  l.glow.visible = !!src.glow
  if (src.glow) l.glow.context = src.glow
}

function syncPool(parent: Container, n: number, make: () => Container) {
  while (parent.children.length < n) parent.addChild(make())
  parent.children.forEach((c, i) => (c.visible = i < n))
}

function drawGeometry(ctx: GraphicsContext, s: ShapeNoText) {
  switch (s.t) {
    case 'path':
      ctx.path(new GraphicsPath(s.d))
      break
    case 'circle':
      ctx.circle(s.x, s.y, s.r)
      break
    case 'ellipse':
      ctx.ellipse(s.x, s.y, s.rx, s.ry)
      break
    case 'line':
      ctx.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2)
      break
    case 'rect':
      ctx.roundRect(s.x, s.y, s.w, s.h, s.rx)
      break
  }
}

function paintShape(ctx: GraphicsContext, s: ShapeNoText) {
  drawGeometry(ctx, s)
  if (s.p.fill && s.t !== 'line') ctx.fill({ color: s.p.fill, alpha: s.p.fillAlpha ?? 1 })
  if (s.p.stroke) ctx.stroke({ width: s.p.width ?? 1, color: s.p.stroke, alpha: s.p.strokeAlpha ?? 1, cap: 'round', join: 'round' })
}

/** A soft neon edge: the same outline, wider and faint, drawn additively. */
function paintGlow(ctx: GraphicsContext, s: ShapeNoText) {
  const color = s.p.stroke && (s.p.strokeAlpha ?? 1) > 0.2 ? s.p.stroke : (s.p.fill ?? s.p.stroke)
  if (!color) return
  drawGeometry(ctx, s)
  ctx.stroke({ width: (s.p.width ?? 1.5) + 6, color, alpha: 0.26, cap: 'round', join: 'round' })
}

function buildArt(shapes: Shape[]): Built {
  const base = new GraphicsContext()
  let glow: GraphicsContext | null = null
  let free: Layer | null = null
  const anims: Built['anims'] = {}
  const halos: HaloShape[] = []
  const texts: TextShape[] = []
  const live = (l: Layer) => {
    // Live layers are small; force them into the sprite batch.
    l.base.batchMode = 'batch'
    if (l.glow) l.glow.batchMode = 'batch'
    return l
  }
  for (const s of shapes) {
    if (s.t === 'halo') {
      halos.push(s)
      continue
    }
    if (s.t === 'text') {
      texts.push(s)
      continue
    }
    let layer: Layer | null = null
    if (s.free) layer = free ??= live({ base: new GraphicsContext(), glow: null })
    else if (s.anim) layer = anims[s.anim] ??= live({ base: new GraphicsContext(), glow: null })
    if (layer) {
      paintShape(layer.base, s)
      if (s.glow) {
        layer.glow ??= new GraphicsContext()
        layer.glow.batchMode = 'batch'
        paintGlow(layer.glow, s)
      }
      continue
    }
    paintShape(base, s)
    if (s.glow) paintGlow((glow ??= new GraphicsContext()), s)
  }
  return { base, glow, free, anims, halos, texts }
}

function easeOutBack(x: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

async function loadFonts() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('800 64px Orbitron'), document.fonts.load('500 40px "JetBrains Mono"'), document.fonts.load('700 15px Orbitron')]),
      new Promise((r) => setTimeout(r, 2500)),
    ])
  } catch {
    /* fall back to system fonts */
  }
}

function makeTextures() {
  const canvas = (size: number) => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    return [c, c.getContext('2d')!] as const
  }

  const [hc, h] = canvas(256)
  const grad = h.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.3)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  h.fillStyle = grad
  h.fillRect(0, 0, 256, 256)

  const [rc, r] = canvas(512)
  r.strokeStyle = '#fff'
  r.lineWidth = 3
  r.beginPath()
  r.arc(256, 256, 252, 0, Math.PI * 2)
  r.stroke()

  const [dc, d] = canvas(1024)
  d.strokeStyle = '#fff'
  d.lineWidth = 3
  d.setLineDash([14, 22])
  d.beginPath()
  d.arc(512, 512, 508, 0, Math.PI * 2)
  d.stroke()

  const [gc, gx] = canvas(CELL * 2)
  gx.scale(2, 2)
  gx.strokeStyle = 'rgba(110,150,255,0.075)'
  gx.lineWidth = 1
  gx.beginPath()
  gx.moveTo(CELL, 0.5)
  gx.lineTo(0.5, 0.5)
  gx.lineTo(0.5, CELL)
  gx.stroke()
  gx.fillStyle = 'rgba(130,170,255,0.32)'
  gx.beginPath()
  gx.arc(0.5, 0.5, 1.6, 0, Math.PI * 2)
  gx.fill()

  // Drawn at 2× for crispness; resolution 2 keeps the logical tile one cell wide.
  const grid = new Texture({ source: new CanvasSource({ resource: gc, resolution: 2 }) })
  return { halo: Texture.from(hc), ring: Texture.from(rc), dash: Texture.from(dc), grid }
}
