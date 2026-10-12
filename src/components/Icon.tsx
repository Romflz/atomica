import type { CSSProperties } from 'react'

const paths = {
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  step: 'm5 5 10 7-10 7ZM19 5v14',
  reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12M6 18 18 6',
  left: 'M4 3h16v18H4ZM9 3v18',
  right: 'M4 3h16v18H4ZM15 3v18',
  grid: 'M3 3h18v18H3ZM3 9h18M3 15h18M9 3v18M15 3v18',
  fit: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  folder: 'M3 7V4h7l2 3h9v13H3Z',
  field: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  chevron: 'm9 5 7 7-7 7',
  book: 'M12 5v16M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-2-10 1',
} as const

export function Icon({ name, size = 16, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>
}
