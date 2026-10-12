import { useEffect, useState } from 'react'
import type { Challenge, Verdict } from '../game/challenge'
import { CHALLENGES, isUnlocked } from '../game/challenges'

const Stars = ({ n }: { n: number }) => (
  <span className="stars" aria-label={`${n} of 5 stars`}>
    {'★'.repeat(n)}
    <i>{'★'.repeat(5 - n)}</i>
  </span>
)

export function ChallengeButton({ solved, active, onOpen }: { solved: number; active: boolean; onOpen: () => void }) {
  return (
    <button className={`challenge-btn${active ? ' active' : ''}`} onClick={onOpen} title={`Challenges · ${solved} of ${CHALLENGES.length} solved`}>
      <span className="challenge-gem">◆</span>
      <span>
        <b>Challenges</b>
        <small>
          {solved} / {CHALLENGES.length} solved
        </small>
      </span>
    </button>
  )
}

interface ListProps {
  solved: Record<string, number>
  activeId: string | null
  onStart: (id: string) => void
  onClose: () => void
}

export function ChallengeList({ solved, activeId, onStart, onClose }: ListProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const count = Object.keys(solved).length

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="challenges" role="dialog" aria-label="Challenges">
        <header className="challenges-head">
          <div>
            <span className="panel-title">Challenges</span>
            <h2>
              {count} of {CHALLENGES.length} solved
            </h2>
            <div className="progress-bar">
              <i style={{ width: `${(count / CHALLENGES.length) * 100}%` }} />
            </div>
          </div>
          <button className="btn" onClick={onClose}>
            ✕ Close <kbd>Esc</kbd>
          </button>
        </header>
        <div className="challenges-grid">
          {CHALLENGES.map((c, i) => {
            const done = !!solved[c.id]
            const open = isUnlocked(i, solved)
            return (
              <button
                key={c.id}
                className={`challenge-card${done ? ' done' : ''}${open ? '' : ' locked'}${c.id === activeId ? ' current' : ''}`}
                disabled={!open}
                onClick={() => onStart(c.id)}
                title={open ? c.brief : 'Solve more challenges to unlock this one'}
              >
                <span className="challenge-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="challenge-state">{done ? '✓ SOLVED' : open ? (c.id === activeId ? 'PLAYING' : 'OPEN') : 'LOCKED'}</span>
                <b>{c.title}</b>
                <Stars n={c.stars} />
                <span className="challenge-brief">{open ? c.brief : 'Solve more challenges to unlock.'}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface HudProps {
  challenge: Challenge
  index: number
  verdict: Verdict | null
  solved: boolean
  turnsLeft: number | null
  hasNext: boolean
  onRestart: () => void
  onExit: () => void
  onNext: () => void
}

export function ChallengeHud({ challenge: c, index, verdict, solved, turnsLeft, hasNext, onRestart, onExit, onNext }: HudProps) {
  const [hint, setHint] = useState(false)
  return (
    <div className={`challenge-hud${solved ? ' solved' : ''}`}>
      <div className="challenge-hud-top">
        <span>CHALLENGE {String(index + 1).padStart(2, '0')}</span>
        <Stars n={c.stars} />
      </div>
      <h3>{c.title}</h3>
      <p>{c.brief}</p>
      <div className={`challenge-status${solved ? ' ok' : ''}`}>
        <i />
        {solved ? 'Solved!' : (verdict?.status ?? 'Checking…')}
      </div>
      {turnsLeft !== null && (
        <div className="challenge-turns">
          Turns left <b>{turnsLeft}</b>
          <span>Shift+R turns a piece back and refunds its turns</span>
        </div>
      )}
      {hint && <p className="challenge-hint">{c.hint}</p>}
      <div className="challenge-actions">
        {solved && hasNext ? (
          <button className="btn play next" onClick={onNext}>
            Next →
          </button>
        ) : (
          <button className={`btn${hint ? ' active' : ''}`} onClick={() => setHint((h) => !h)}>
            ? Hint
          </button>
        )}
        <button className="btn" onClick={onRestart} title="Reset the map and your turns">
          ↺ Restart
        </button>
        <button className="btn" onClick={onExit} title="Leave the challenge and keep tinkering">
          Exit
        </button>
      </div>
      {c.verified && !solved && <p className="challenge-note">Checked automatically on a hidden copy, trying every switch position for you, so it works even while paused.</p>}
    </div>
  )
}
