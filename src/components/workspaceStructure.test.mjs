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

  it('does not expose the product introduction after hiding About', () => {
    const source = readSource('./SettingsModal.tsx')

    expect(source).not.toContain('./examples/kunai-login-workspace.jpg')
    expect(source).not.toContain('./examples/kunai-creation-workspace.jpg')
    expect(source).not.toContain('产品界面预览')
  })

  it('uses the KunAI brand mark as the browser icon', () => {
    const html = readSource('../../index.html')
    const favicon = readSource('../../public/favicon.svg')

    expect(html).toContain('./favicon.svg?v=kunai-2')
    expect(favicon).toContain('<title>KunAI Studio</title>')
    expect(favicon).toContain('id="kunai-favicon-core"')
  })

  it('keeps the license disclosure in repository notices instead of the product UI', () => {
    const auth = readSource('./auth/AuthScreen.tsx')
    const settings = readSource('./SettingsModal.tsx')
    const notice = readSource('../../NOTICE')

    expect(auth).not.toContain('基于 GPT Image Playground（MIT）二次开发')
    expect(settings).not.toContain('KunAI Studio 基于 GPT Image Playground 的 MIT 许可代码进行二次开发')
    expect(notice).toContain('software derived from GPT Image Playground')
    expect(notice).toContain('licensed under the MIT License')
  })
})
