import * as React from 'react'
import { SparklesIcon, BrainIcon } from './icons'
import styles from './ThinkingIndicator.module.css'

interface ThinkingIndicatorProps {
  agentName?: string
  modelName?: string
  activeThought?: string
}

export function ThinkingIndicator({
  agentName = 'Unified Agent',
  modelName = 'Gemini 3.8 Flash',
  activeThought,
}: ThinkingIndicatorProps) {
  return (
    <div className={styles.container} role="status" aria-live="polite">
      <div className={styles.header}>
        <div className={styles.iconWrapper}>
          <BrainIcon size={16} />
        </div>
        <div className={styles.statusText}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Agent Thinking & Reasoning</span>
            <span className={styles.shimmerDot} />
          </div>
          <div className={styles.subtitle}>
            <span>Synergizing Build, Review & Chat</span>
            <span className={styles.waveDots}>
              <span />
              <span />
              <span />
            </span>
          </div>
        </div>
      </div>
      {activeThought ? (
        <div className={styles.thoughtPreview}>
          {activeThought}
        </div>
      ) : null}
    </div>
  )
}
