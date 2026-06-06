import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { GlassPanel } from './GlassPanel'

type ConfirmDialogProps = {
  open: boolean
  busy?: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Renders a small confirm dialog that matches the shared glass dialog style.
 * Input: open state, body copy, action labels, and callbacks.
 * Output: modal confirm UI or null when closed.
 */
export function ConfirmDialog({
  open,
  busy = false,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [busy, onCancel, open])

  if (!open) {
    return null
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !busy && onCancel()}>
      <div className="dialog-card-shell confirm-dialog-shell" role="presentation" onClick={event => event.stopPropagation()}>
        <GlassPanel className="dialog-card confirm-dialog">
          <div className="dialog-header">
            <div className="confirm-dialog__title">
              <span className={`confirm-dialog__icon ${tone === 'danger' ? 'is-danger' : ''}`} aria-hidden="true">
                <AlertTriangle size={16} />
              </span>
              <div>
                <p className="eyebrow">{tone === 'danger' ? 'Confirm Delete' : 'Confirm Action'}</p>
                <h2>{title}</h2>
              </div>
            </div>
            <button className="icon-button" type="button" onClick={onCancel} disabled={busy} title="关闭弹框">
              <X size={16} />
            </button>
          </div>

          <div className="dialog-note confirm-dialog__note">
            <strong>{description}</strong>
          </div>

          <div className="dialog-actions confirm-dialog__actions">
            <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button className={tone === 'danger' ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </button>
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}
