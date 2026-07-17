import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Checkbox } from './Checkbox'
import { CopyIcon } from './icons'

function renderMessage(message: string) {
  return message.split(/(`[^`]+`|「[^」]+」|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-surface2 px-1 py-0.5 font-mono text-[0.85em] text-ink-2">
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith('「') && part.endsWith('」')) {
      return (
        <strong key={index} className="font-semibold text-ink">
          {part}
        </strong>
      )
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }

    return part
  })
}

function getActionButtonClass(tone: 'primary' | 'secondary' | 'danger' | 'warning' = 'primary') {
  if (tone === 'secondary') {
    return 'bg-surface2 text-ink border border-line hover:border-line2'
  }
  if (tone === 'danger') {
    return 'bg-red-500 text-white shadow-[0_8px_20px_-6px_rgba(229,72,77,0.45)] hover:bg-red-600 hover:-translate-y-px'
  }
  return 'bg-[linear-gradient(150deg,var(--accent),#e07a1f)] text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] hover:-translate-y-px'
}

export default function ConfirmDialog() {
  const confirmDialog = useStore((s) => s.confirmDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [canConfirm, setCanConfirm] = useState(true)
  const [checkboxChecked, setCheckboxChecked] = useState(false)

  useEffect(() => {
    const delay = confirmDialog?.minConfirmDelayMs ?? 0
    if (!confirmDialog || delay <= 0) {
      setCanConfirm(true)
      return
    }

    setCanConfirm(false)
    const timer = window.setTimeout(() => setCanConfirm(true), delay)
    return () => window.clearTimeout(timer)
  }, [confirmDialog])

  useEffect(() => {
    setCheckboxChecked(confirmDialog?.checkbox?.defaultChecked ?? false)
  }, [confirmDialog])

  const handleClose = () => {
    if (!canConfirm) return
    setConfirmDialog(null)
  }

  const handleCancel = () => {
    confirmDialog?.cancelAction?.(checkboxChecked)
    handleClose()
  }

  useCloseOnEscape(Boolean(confirmDialog) && canConfirm, handleClose)
  usePreventBackgroundScroll(Boolean(confirmDialog))

  if (!confirmDialog) return null
  const isDestructive = confirmDialog.title.includes('删除') || confirmDialog.title.includes('清空')
  const confirmTone = confirmDialog.tone ?? (isDestructive ? 'danger' : undefined)
  const confirmClassName = getActionButtonClass(confirmTone === 'danger' || confirmTone === 'warning' ? confirmTone : 'primary')
  const confirmText = confirmDialog.confirmText ?? (isDestructive ? '确认删除' : '确认')
  const cancelText = confirmDialog.cancelText ?? '取消'
  const customButtons = confirmDialog.buttons?.filter((button) => button.label.trim()) ?? []

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-[rgba(12,11,9,0.55)] backdrop-blur-sm animate-overlay-in" />
      <div
        className="relative bg-surface border border-line2 rounded-2xl shadow-lift max-w-sm w-full p-6 z-10 animate-confirm-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 flex items-center gap-2 text-base font-display font-semibold text-ink">
          {confirmDialog.icon === 'info' && (
            <svg className="h-5 w-5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          )}
          {confirmDialog.icon === 'copy' && (
            <CopyIcon className="h-5 w-5 shrink-0 text-accent" />
          )}
          {confirmDialog.title}
        </h3>
        <p className={`text-sm text-ink-2 ${confirmDialog.checkbox ? 'mb-4' : 'mb-6'} leading-relaxed whitespace-pre-line ${confirmDialog.messageAlign === 'center' ? 'text-center' : ''}`}>
          {renderMessage(confirmDialog.message)}
        </p>
        {confirmDialog.checkbox && (
          <Checkbox
            checked={checkboxChecked}
            onChange={setCheckboxChecked}
            label={confirmDialog.checkbox.label}
            tone={confirmDialog.checkbox.tone}
            disabled={confirmDialog.checkbox.disabled}
            className="mb-6"
          />
        )}
        {customButtons.length > 0 ? (
          <div className="flex gap-2">
            {customButtons.map((button) => (
              <button
                key={button.label}
                onClick={() => {
                  if (!canConfirm) return
                  button.action(checkboxChecked)
                  setConfirmDialog(null)
                }}
                disabled={!canConfirm}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${getActionButtonClass(button.tone)}`}
              >
                {button.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            {confirmDialog.showCancel !== false && (
              <button
                onClick={handleCancel}
                className="flex-1 py-2.5 rounded-xl border border-line bg-surface2 text-[13px] font-semibold text-ink hover:border-line2 transition"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={() => {
                if (!canConfirm) return
                confirmDialog.action?.(checkboxChecked)
                setConfirmDialog(null)
              }}
              disabled={!canConfirm}
              className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${confirmClassName}`}
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
