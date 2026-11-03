import * as React from 'react'
import { BrainIcon } from './icons'
import { Markdown } from './Markdown'

export type AgentActivityState = {
  running: boolean
  activeTurn?: { id: string; startedAt: number }
  phase?: 'working' | 'searching' | 'reasoning' | 'tool' | 'writing' | 'stopped'
  label?: string
  reasoningText?: string
  reasoningLive?: boolean
  stopped?: boolean
}

export function WorkingPulse() {
  return (
    <span className="agent-activity__glyph" aria-hidden="true">
      <span className="agent-activity__pulse" />
    </span>
  )
}

function WorkingTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  return <>{elapsed}s</>
}

export function ReasoningBlock({
  text,
  live,
  label: customLabel,
}: {
  text: string
  live?: boolean
  label?: string
}) {
  const [isOpen, setIsOpen] = React.useState(Boolean(live))

  React.useEffect(() => {
    if (live) setIsOpen(true)
  }, [live])

  const label = customLabel || (live ? 'Thinking and reasoning…' : 'Thought')

  return (
    <div className={`agent-reasoning ${live ? 'is-live' : ''}`}>
      <button
        type="button"
        className="agent-reasoning__row"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="agent-reasoning__glyph" aria-hidden="true">
          <BrainIcon size={14} />
        </span>
        <span className="agent-reasoning__label">{label}</span>
        <span
          className="agent-reasoning__chevron"
          aria-hidden="true"
          style={{
            transform: isOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform var(--dur-fast) var(--ease-out)',
          }}
        >
          ›
        </span>
      </button>
      <div className={`agent-reasoning__reveal ${isOpen ? 'is-open' : ''}`}>
        <div className="agent-reasoning__content">
          <Markdown>{text}</Markdown>
        </div>
      </div>
    </div>
  )
}

export function ThinkingIndicator({ state }: { state: AgentActivityState }) {
  const [currentLabel, setCurrentLabel] = React.useState(state.label || 'Thinking…')
  const [previousLabel, setPreviousLabel] = React.useState<string | null>(null)
  const [startedAt, setStartedAt] = React.useState<number>(
    state.activeTurn?.startedAt || Date.now(),
  )

  React.useEffect(() => {
    if (state.running) {
      if (state.activeTurn?.startedAt) {
        setStartedAt(state.activeTurn.startedAt)
      } else {
        setStartedAt(Date.now())
      }
    }
  }, [state.running, state.activeTurn?.startedAt])

  React.useEffect(() => {
    const next = state.label || 'Thinking…'
    if (next !== currentLabel) {
      setPreviousLabel(currentLabel)
      setCurrentLabel(next)
      const t = setTimeout(() => {
        setPreviousLabel(null)
      }, 480)
      return () => clearTimeout(t)
    }
  }, [state.label, currentLabel])

  if (!state.running && !state.stopped) return null

  if (state.stopped) {
    return (
      <div className="agent-working-rail" role="status" aria-live="polite">
        <div className="agent-stopped">
          <span className="agent-stopped__dot" aria-hidden="true" />
          <span>Stopped by you</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="agent-working-rail agent-activity--live"
      role="status"
      aria-live="polite"
    >
      <div className="agent-working-rail__summary">
        <WorkingPulse />

        <span
          className="agent-working-label-swap"
          aria-live="polite"
          aria-atomic="true"
        >
          {previousLabel ? (
            <span className="agent-working-status-previous" aria-hidden="true">
              <span className="agent-activity__label">{previousLabel}</span>
              <span className="agent-working-time">
                <WorkingTimer startedAt={startedAt} />
              </span>
            </span>
          ) : null}

          <span
            className={`agent-working-status ${previousLabel ? 'is-entering' : ''}`}
          >
            <span className="agent-activity__label">{currentLabel}</span>
            <span className="agent-working-time">
              <WorkingTimer startedAt={startedAt} />
            </span>
          </span>
        </span>
      </div>
    </div>
  )
}
