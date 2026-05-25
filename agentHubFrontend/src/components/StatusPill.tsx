import { CheckCircle2, CircleDashed, CircleDot, TriangleAlert } from 'lucide-react'

type StatusPillProps = {
  status: 'ready' | 'running' | 'success' | 'failed' | 'demo'
  label: string
}

/**
 * Renders a compact status pill with a matching icon.
 * Input: semantic status and label.
 * Output: a status badge for panels and list items.
 */
export function StatusPill({ status, label }: StatusPillProps) {
  const Icon =
    status === 'success' || status === 'ready'
      ? CheckCircle2
      : status === 'failed'
        ? TriangleAlert
        : status === 'running'
          ? CircleDot
          : CircleDashed

  return (
    <span className={`status-pill status-pill--${status}`}>
      <Icon size={14} />
      {label}
    </span>
  )
}
