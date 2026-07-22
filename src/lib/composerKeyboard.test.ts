import { describe, expect, it } from 'vitest'
import { getComposerEnterAction } from './composerKeyboard'

describe('composer keyboard', () => {
  it('submits with Enter and inserts a newline with Shift + Enter', () => {
    expect(getComposerEnterAction({ key: 'Enter' })).toBe('submit')
    expect(getComposerEnterAction({ key: 'Enter', shiftKey: true })).toBe('newline')
    expect(getComposerEnterAction({ key: 'Escape' })).toBeNull()
  })

  it('does not submit while an IME composition is active', () => {
    expect(getComposerEnterAction({ key: 'Enter', isComposing: true })).toBe('ignore')
    expect(getComposerEnterAction({ key: 'Enter', keyCode: 229 })).toBe('ignore')
  })
})
