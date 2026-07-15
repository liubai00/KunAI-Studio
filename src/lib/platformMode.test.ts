import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { createPlatformSettings, isPlatformModeEnabled, PLATFORM_AGENT_PROFILE_ID, PLATFORM_IMAGE_PROFILE_ID } from './platformMode'
import { createUserScopedStorage, getScopedDatabaseName, setActiveStorageUser } from './userStorage'

describe('platform mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    setActiveStorageUser('local')
  })

  it('uses explicit environment configuration', () => {
    vi.stubEnv('VITE_PLATFORM_MODE', 'true')
    expect(isPlatformModeEnabled()).toBe(true)
    vi.stubEnv('VITE_PLATFORM_MODE', 'false')
    expect(isPlatformModeEnabled()).toBe(false)
  })

  it('creates locked image and Agent profiles without an upstream secret', () => {
    vi.stubEnv('VITE_PLATFORM_IMAGE_MODEL', 'image-model')
    vi.stubEnv('VITE_PLATFORM_AGENT_MODEL', 'agent-model')
    const settings = createPlatformSettings(DEFAULT_SETTINGS)

    expect(settings.activeProfileId).toBe(PLATFORM_IMAGE_PROFILE_ID)
    expect(settings.agentTextProfileId).toBe(PLATFORM_AGENT_PROFILE_ID)
    expect(settings.agentImageProfileId).toBe(PLATFORM_IMAGE_PROFILE_ID)
    expect(settings.agentApiConfigMode).toBe('hybrid')
    expect(settings.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: PLATFORM_IMAGE_PROFILE_ID, model: 'image-model', apiProxy: true, apiKey: 'managed-session' }),
      expect.objectContaining({ id: PLATFORM_AGENT_PROFILE_ID, model: 'agent-model', apiProxy: true, apiKey: 'managed-session' }),
    ]))
  })

  it('isolates persisted state and IndexedDB names by user', () => {
    setActiveStorageUser('101')
    const first = createUserScopedStorage()
    first.setItem('settings', 'first')
    expect(getScopedDatabaseName('images')).toBe('images-user-101')

    setActiveStorageUser('202')
    const second = createUserScopedStorage()
    expect(second.getItem('settings')).toBeNull()
    second.setItem('settings', 'second')

    setActiveStorageUser('101')
    expect(createUserScopedStorage().getItem('settings')).toBe('first')
  })
})
