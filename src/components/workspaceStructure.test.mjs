import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('workspace UI structure', () => {
  it('keeps settings cards in a responsive two-column grid without spanning cards', () => {
    const source = readSource('./shell/SettingsWorkspace.tsx')

    expect(source).toContain('grid grid-cols-1 gap-4 md:grid-cols-2')
    expect(source).not.toContain('md:col-span-2')
  })

  it('offers one upload action and does not claim to support camera capture', () => {
    const source = readSource('./InputBar.tsx')

    expect(source).toContain('上传图片')
    expect(source).not.toContain('拍照')
    expect(source).not.toContain('cameraInputRef')
  })

  it('places Agent model and search controls in the composer without exposing search pricing', () => {
    const inputBar = readSource('./InputBar.tsx')
    const workspace = readSource('./AgentWorkspace.tsx')

    expect(inputBar).toContain('data-agent-composer-tools')
    expect(inputBar).toContain('data-agent-search-toggle')
    expect(workspace).not.toContain('<select')
    expect(`${inputBar}\n${workspace}`).not.toMatch(/searchPrice|search_price|联网搜索.*¥/)
  })
})
