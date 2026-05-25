import type { CSSProperties, ReactNode } from 'react'

type GlassPanelProps = {
  children: ReactNode
  className?: string
  compact?: boolean
  style?: CSSProperties
}

/**
 * Renders the shared translucent surface used across the workbench.
 * Input: children, optional className, density flag, and inline style.
 * Output: a glass-styled panel element.
 */
export function GlassPanel({ children, className = '', compact = false, style }: GlassPanelProps) {
  return (
    <section className={`glass-panel ${compact ? 'glass-panel--compact' : ''} ${className}`.trim()} style={style}>
      {children}
    </section>
  )
}
