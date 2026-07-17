import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'gi-theme-preference'
const LIGHT_THEME_COLOR = '#f6f5f2'
const DARK_THEME_COLOR = '#100f0e'

const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function hasStoredPreference(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY))
  } catch {
    return false
  }
}

function readStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    /* ignore */
  }
  return 'system'
}

let preference: ThemePreference = readStoredPreference()

export function resolveTheme(pref: ThemePreference = preference): ResolvedTheme {
  if (pref === 'system') return media?.matches ? 'dark' : 'light'
  return pref
}

function applyTheme() {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme()
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
}

function emit() {
  listeners.forEach((listener) => listener())
}

/**
 * Apply the persisted theme on boot. `defaultPreference` is used only when the
 * user has never chosen a preference (e.g. platform mode defaults to light).
 */
export function initTheme(defaultPreference: ThemePreference = 'system') {
  if (!hasStoredPreference()) preference = defaultPreference
  applyTheme()
  media?.addEventListener('change', () => {
    if (preference === 'system') {
      applyTheme()
      emit()
    }
  })
}

export function getThemePreference(): ThemePreference {
  return preference
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme()
}

export function setThemePreference(pref: ThemePreference) {
  preference = pref
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    /* ignore */
  }
  applyTheme()
  emit()
}

export function toggleTheme() {
  setThemePreference(resolveTheme() === 'dark' ? 'light' : 'dark')
}

export function subscribeTheme(callback: () => void) {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, getResolvedTheme)
}
