import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('task card metadata chips', () => {
  it('keeps the source icon and label aligned on one line', () => {
    const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const chipRule = styles.match(/\.kunai-ui-chip\s*\{([^}]+)\}/)?.[1] ?? ''

    expect(chipRule).toContain('display: inline-flex')
    expect(chipRule).toContain('flex-wrap: nowrap')
    expect(chipRule).toContain('align-items: center')
    expect(chipRule).toContain('white-space: nowrap')
  })
})
