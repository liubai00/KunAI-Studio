import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('theme preference', () => {
  it('defaults to light even when the operating system prefers dark', async () => {
    const toggle = vi.fn()
    const setAttribute = vi.fn()
    const addEventListener = vi.fn()
    vi.stubGlobal('window', {
      matchMedia: vi.fn(() => ({ matches: true, addEventListener })),
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    })
    vi.stubGlobal('document', {
      documentElement: { classList: { toggle } },
      querySelector: vi.fn(() => ({ setAttribute })),
    })

    const theme = await import('./theme')
    theme.initTheme()

    expect(theme.getThemePreference()).toBe('light')
    expect(theme.getResolvedTheme()).toBe('light')
    expect(toggle).toHaveBeenCalledWith('dark', false)
    expect(setAttribute).toHaveBeenCalledWith('content', '#f4f7ff')
    expect(addEventListener).not.toHaveBeenCalled()
  })

  it('keeps a saved dark theme selected by the user', async () => {
    const toggle = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === 'kunai-theme-preference' ? 'dark' : null),
      setItem: vi.fn(),
    })
    vi.stubGlobal('document', {
      documentElement: { classList: { toggle } },
      querySelector: vi.fn(() => ({ setAttribute: vi.fn() })),
    })

    const theme = await import('./theme')
    theme.initTheme()

    expect(theme.getThemePreference()).toBe('dark')
    expect(theme.getResolvedTheme()).toBe('dark')
    expect(toggle).toHaveBeenCalledWith('dark', true)
  })

  it('migrates the legacy system preference to light', async () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === 'kunai-theme-preference' ? 'system' : null),
      setItem: vi.fn(),
    })

    const theme = await import('./theme')

    expect(theme.resolveTheme('system')).toBe('light')
  })
})
