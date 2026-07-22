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
})
