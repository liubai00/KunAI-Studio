import { createPortal } from 'react-dom'
import { useStore } from '../store'

export default function Toast() {
  const toast = useStore((s) => s.toast)

  if (!toast) return null

  const accentBorder =
    toast.type === 'success'
      ? 'border-l-emerald-500'
      : toast.type === 'error'
        ? 'border-l-red-500'
        : 'border-l-info'

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'error':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )
      default:
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-info/15 text-info">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
    }
  }

  return createPortal(
    <div className="fixed bottom-24 left-1/2 z-[var(--layer-toast)] pointer-events-none toast-enter">
      <div className={`flex items-center gap-2.5 w-max max-w-[calc(100vw-32px)] sm:max-w-[min(44rem,80vw)] px-5 py-3.5 bg-surface border border-line2 border-l-[3px] ${accentBorder} rounded-xl shadow-lift text-sm font-medium text-ink`}>
        <span className="flex-shrink-0">{getIcon()}</span>
        <span className="leading-5 whitespace-pre-line text-center">{toast.message}</span>
      </div>
    </div>,
    document.body,
  )
}
