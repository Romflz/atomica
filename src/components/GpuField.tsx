import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { RendererPreference } from 'pixi.js'
import { FieldRenderer } from '../gpu/FieldRenderer'
import type { FieldScene, View } from '../gpu/FieldRenderer'
import { CELL } from '../render/geometry'
import { cellKey } from '../sim/engine'
import type { Atom } from '../sim/types'

export interface RendererInfo {
  backend: string
  fps: number
}

interface Props {
  scene: FieldScene
  view: View
  hostRef: RefObject<HTMLDivElement | null>
  preference: RendererPreference
  onAtomPointerDown: (atom: Atom, e: PointerEvent) => void
  onAtomContextMenu: (atom: Atom) => void
  onBackgroundPointerDown: (e: PointerEvent) => void
  onResizeHandleDown: (e: PointerEvent) => void
  onInfo: (info: RendererInfo) => void
}

/** Screen distance (px) from the board's bottom-right corner that grabs the resize handle. */
const HANDLE_PX = 26

/**
 * Hosts the GPU renderer. Input is resolved here against the grid (cell
 * lookup) rather than through Pixi hit-testing, which stays O(1) no matter
 * how many atoms are on the field.
 */
export function GpuField({ scene, view, hostRef, preference, onAtomPointerDown, onAtomContextMenu, onBackgroundPointerDown, onResizeHandleDown, onInfo }: Props) {
  const rendererRef = useRef<FieldRenderer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef({ scene, view, onAtomPointerDown, onAtomContextMenu, onBackgroundPointerDown, onResizeHandleDown, onInfo })
  useEffect(() => {
    latest.current = { scene, view, onAtomPointerDown, onAtomContextMenu, onBackgroundPointerDown, onResizeHandleDown, onInfo }
  })

  // Create / recreate the renderer when the backend preference changes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const r = new FieldRenderer()
    rendererRef.current = r
    r.onStats = (fps) => latest.current.onInfo({ backend: r.backend, fps })
    r.setView(latest.current.view)
    r.sync(latest.current.scene)
    r.init(host, preference)
      .then(() => {
        setError(null)
        latest.current.onInfo({ backend: r.backend, fps: 0 })
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      r.destroy()
      if (rendererRef.current === r) rendererRef.current = null
    }
  }, [hostRef, preference])

  useEffect(() => {
    rendererRef.current?.sync(scene)
  }, [scene])

  useEffect(() => {
    rendererRef.current?.setView(view)
  }, [view])

  // Pointer input resolved against the grid.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const locate = (e: PointerEvent | MouseEvent) => {
      const { scene: s, view: v } = latest.current
      const rect = host.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const cornerX = v.x + s.world.cols * CELL * v.k
      const cornerY = v.y + s.world.rows * CELL * v.k
      const onHandle = Math.hypot(sx - cornerX, sy - cornerY) < HANDLE_PX
      const cx = Math.floor((sx - v.x) / v.k / CELL)
      const cy = Math.floor((sy - v.y) / v.k / CELL)
      const inside = cx >= 0 && cy >= 0 && cx < s.world.cols && cy < s.world.rows
      const id = inside ? s.graph.occ.get(cellKey(s.world, cx, cy)) : undefined
      return { onHandle, atom: id ? s.graph.byId.get(id) : undefined }
    }
    const down = (e: PointerEvent) => {
      const { onHandle, atom } = locate(e)
      if (e.button === 0 && onHandle) return latest.current.onResizeHandleDown(e)
      if (atom && e.button === 0) return latest.current.onAtomPointerDown(atom, e)
      if (e.button === 0 || e.button === 1) latest.current.onBackgroundPointerDown(e)
    }
    const move = (e: PointerEvent) => {
      const { onHandle, atom } = locate(e)
      host.style.cursor = onHandle ? 'nwse-resize' : atom ? 'pointer' : ''
      if (rendererRef.current) rendererRef.current.hoverId = atom?.id ?? null
    }
    const leave = () => {
      if (rendererRef.current) rendererRef.current.hoverId = null
    }
    const menu = (e: MouseEvent) => {
      e.preventDefault()
      const { atom } = locate(e)
      if (atom) latest.current.onAtomContextMenu(atom)
    }
    host.addEventListener('pointerdown', down)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', leave)
    host.addEventListener('contextmenu', menu)
    return () => {
      host.removeEventListener('pointerdown', down)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', leave)
      host.removeEventListener('contextmenu', menu)
    }
  }, [hostRef])

  return (
    <div ref={hostRef} className="field">
      {error && (
        <div className="gpu-error">
          <b>GPU renderer unavailable</b>
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
