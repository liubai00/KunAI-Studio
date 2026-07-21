import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Select from './Select'

describe('Select', () => {
  it('renders an accessible custom combobox instead of a native select', () => {
    const html = renderToStaticMarkup(
      <Select
        value="gpt-5.5"
        onChange={() => undefined}
        ariaLabel="Agent 对话模型"
        options={[
          { label: 'gpt-5.5', value: 'gpt-5.5' },
          { label: 'gpt-5.6-terra（未启用或未定价）', value: 'gpt-5.6-terra', disabled: true },
        ]}
      />,
    )

    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-label="Agent 对话模型"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('gpt-5.5')
    expect(html).not.toContain('<select')
  })
})
