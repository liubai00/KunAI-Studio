import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('settings workspace cards', () => {
  const source = readFileSync(new URL('./SettingsWorkspace.tsx', import.meta.url), 'utf8')

  it('keeps card actions without external-page icons', () => {
    expect(source).toContain('onClick={toggleTheme}')
    expect(source).toContain('onClick={() => setShowSettings(true, group.tab)}')
    expect(source).toContain("onClick={() => setShowSettings(true, 'data')}")
    expect(source).not.toContain('ExternalLink')
  })

  it('does not expose the About workspace', () => {
    const shellSource = readFileSync(new URL('./AppShell.tsx', import.meta.url), 'utf8')
    const modalSource = readFileSync(new URL('../SettingsModal.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('关于 KunAI Studio')
    expect(shellSource).not.toContain("setShowSettings(true, 'about')")
    expect(modalSource).not.toContain("setActiveTab('about')")
    expect(modalSource).not.toContain("activeTab === 'about'")
  })
})
