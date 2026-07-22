export interface ComposerEnterEvent {
  key: string
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

export function getComposerEnterAction(event: ComposerEnterEvent) {
  if (event.key !== 'Enter') return null
  if (event.isComposing || event.keyCode === 229) return 'ignore' as const
  return event.shiftKey ? 'newline' as const : 'submit' as const
}
