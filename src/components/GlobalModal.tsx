import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type GlobalModalLayer = 'modal' | 'dialog' | 'lightbox'

interface GlobalModalProps {
  children: ReactNode
  onClose?: () => void
  closeOnBackdrop?: boolean
  layer?: GlobalModalLayer
  className?: string
  backdropClassName?: string
}

export default function GlobalModal({
  children,
  onClose,
  closeOnBackdrop = true,
  layer = 'modal',
  className = '',
  backdropClassName = '',
}: GlobalModalProps) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      data-global-layer={layer}
      className={`kunai-global-layer kunai-global-layer-${layer} ${className}`}
    >
      <div
        aria-hidden="true"
        className={`kunai-global-backdrop ${backdropClassName}`}
        onPointerDown={() => {
          if (closeOnBackdrop) onClose?.()
        }}
      />
      {children}
    </div>,
    document.body,
  )
}
