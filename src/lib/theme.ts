import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'kunai-theme-preference'
const LEGACY_STORAGE_KEY = 'gi-theme-preference'
const LIGHT_THEME_COLOR = '#f4f7ff'
const DARK_THEME_COLOR = '#070b18'

const listeners = new Set<() => void>()

function hasStoredPreference(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY))
  } catch {
    return false
  }
}

function readStoredPreference(): ThemePreference {
  try {
    const current = localStorage.getItem(STORAGE_KEY)
    const value = current || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!current && value) localStorage.setItem(STORAGE_KEY, value)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    /* ignore */
  }
  return 'system'
}

let preference: ThemePreference = readStoredPreference()

export function resolveTheme(pref: ThemePreference = preference): ResolvedTheme {
  return pref === 'dark' ? 'dark' : 'light'
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

// 首次访问固定使用浅色主题；已保存的用户选择仍然优先。
export function initTheme(defaultPreference: ThemePreference = 'light') {
  if (!hasStoredPreference()) preference = defaultPreference
  applyTheme()
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
