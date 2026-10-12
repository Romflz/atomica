import { memo, useId } from 'react'
import { atomArt } from '../render/art'
import type { Shape } from '../render/art'
import { CELL } from '../render/geometry'
import type { Atom } from '../sim/types'

/** SVG rendering of the shared atom artwork, for icons in the DOM panels. */
function ShapeView({ s, glowId }: { s: Shape; glowId: string }) {
  if (s.t === 'halo') return null
  if (s.t === 'text') {
    return (
      <text
        x={s.x}
        y={s.y}
        fill={s.color}
        fillOpacity={s.alpha ?? 1}
        fontSize={s.size}
        className={s.font === 'display' ? 'art-display' : 'art-mono'}
        textAnchor={s.anchor === 'middle' ? 'middle' : 'start'}
        dominantBaseline="central"
        letterSpacing={s.spacing}
      >
        {s.text}
      </text>
    )
  }
  const paint = {
    fill: s.p.fill ?? 'none',
    fillOpacity: s.p.fillAlpha,
    stroke: s.p.stroke,
    strokeOpacity: s.p.strokeAlpha,
    strokeWidth: s.p.width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    filter: s.glow ? `url(#${glowId})` : undefined,
  }
  switch (s.t) {
    case 'path':
      return <path d={s.d} {...paint} />
    case 'circle':
      return <circle cx={s.x} cy={s.y} r={s.r} {...paint} />
    case 'ellipse':
      return <ellipse cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} {...paint} />
    case 'line':
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...paint} fill="none" />
    case 'rect':
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...paint} />
  }
}

function AtomIconImpl({ atom, size = 64 }: { atom: Atom; size?: number }) {
  const glowId = `glow${useId().replace(/:/g, '')}`
  const pad = 22
  const vb = CELL / 2 + pad
  return (
    <svg className="atom-icon" width={size} height={size} viewBox={`${-vb} ${-vb} ${vb * 2} ${vb * 2}`}>
      <defs>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {atomArt(atom).map((s, i) => (
        <ShapeView key={i} s={s} glowId={glowId} />
      ))}
    </svg>
  )
}

export const AtomIcon = memo(AtomIconImpl)
