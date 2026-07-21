import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMobileViewportGuards } from './viewport'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mobile viewport guards', () => {
  it('keeps browser zoom available without intercepting gestures', () => {
    const viewport = { content: '' }
    const addEventListener = vi.fn()
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => viewport),
      addEventListener,
    })

    installMobileViewportGuards()

    expect(viewport.content).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover')
    expect(addEventListener).not.toHaveBeenCalled()
  })
})
