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

    expect(inputBar).toContain('data-composer-control-row')
    expect(inputBar).toContain('data-agent-composer-tools')
    expect(inputBar).toContain('data-agent-search-toggle')
    expect(inputBar).toContain('selectAgentConversationModel')
    expect(inputBar).not.toContain('disabled={modelLocked}')
    expect(workspace).not.toContain('<select')
    expect(`${inputBar}\n${workspace}`).not.toMatch(/searchPrice|search_price|联网搜索.*¥/)
  })

  it('shows the login and creation workspaces in the product introduction', () => {
    const source = readSource('./SettingsModal.tsx')

    expect(source).toContain('./examples/kunai-login-workspace.jpg')
    expect(source).toContain('./examples/kunai-creation-workspace.jpg')
    expect(source).toContain('产品界面预览')
  })

  it('uses the KunAI brand mark as the browser icon', () => {
    const html = readSource('../../index.html')
    const favicon = readSource('../../public/favicon.svg')

    expect(html).toContain('./favicon.svg?v=kunai-2')
    expect(favicon).toContain('<title>KunAI Studio</title>')
    expect(favicon).toContain('id="kunai-favicon-core"')
  })

  it('keeps the license disclosure in About instead of repeating it on login', () => {
    const auth = readSource('./auth/AuthScreen.tsx')
    const settings = readSource('./SettingsModal.tsx')

    expect(auth).not.toContain('基于 GPT Image Playground（MIT）二次开发')
    expect(settings).toContain('KunAI Studio 基于 GPT Image Playground 的 MIT 许可代码进行二次开发')
  })
})
