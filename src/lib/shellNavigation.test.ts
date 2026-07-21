import { describe, expect, it } from 'vitest'
import { appModeToShellView, canAccessShellView, isMainShellView, normalizeShellView, shellViewToAppMode } from './shellNavigation'

describe('shellNavigation', () => {
  it('restores only persistable main views', () => {
    expect(normalizeShellView('create')).toBe('create')
    expect(normalizeShellView('agent')).toBe('agent')
    expect(normalizeShellView('library')).toBe('library')
    expect(normalizeShellView('account')).toBe('create')
    expect(normalizeShellView('invalid')).toBe('create')
  })

  it('keeps the legacy AppMode mapping backward compatible', () => {
    expect(shellViewToAppMode('create')).toBe('gallery')
    expect(shellViewToAppMode('library')).toBe('gallery')
    expect(shellViewToAppMode('account')).toBe('gallery')
    expect(shellViewToAppMode('agent')).toBe('agent')
    expect(appModeToShellView('gallery')).toBe('create')
    expect(appModeToShellView('agent')).toBe('agent')
  })

  it('distinguishes transient workspace pages', () => {
    expect(isMainShellView('library')).toBe(true)
    expect(isMainShellView('settings')).toBe(false)
    expect(isMainShellView('admin')).toBe(false)
  })

  it('opens account billing to authenticated users and reserves admin tools for admins', () => {
    const normalUser = { authenticated: true, agent: true, admin: false }
    const adminUser = { authenticated: true, agent: true, admin: true }
    const anonymous = { authenticated: false, agent: false, admin: false }

    expect(canAccessShellView('account', normalUser)).toBe(true)
    expect(canAccessShellView('admin', normalUser)).toBe(false)
    expect(canAccessShellView('account', adminUser)).toBe(true)
    expect(canAccessShellView('admin', adminUser)).toBe(true)
    expect(canAccessShellView('account', anonymous)).toBe(false)
  })
})
