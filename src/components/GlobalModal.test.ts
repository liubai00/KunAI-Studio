import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('global modal layer', () => {
  it('portals full-screen layers to document.body with one shared backdrop', () => {
    const source = readFileSync(new URL('./GlobalModal.tsx', import.meta.url), 'utf8')
    expect(source).toContain('createPortal')
    expect(source).toContain('document.body')
    expect(source).toContain('kunai-global-backdrop')
    expect(source).toContain('data-global-layer')
  })

  it('uses the shared layer for image details and QR payments', () => {
    const detailSource = readFileSync(new URL('./DetailModal.tsx', import.meta.url), 'utf8')
    const paymentSource = readFileSync(new URL('./platform/PaymentQrModal.tsx', import.meta.url), 'utf8')
    expect(detailSource).toContain('<GlobalModal')
    expect(paymentSource).toContain('<GlobalModal layer="dialog"')
    expect(detailSource).toContain('usePreventBackgroundScroll')
    expect(paymentSource).toContain('usePreventBackgroundScroll')
  })

  it('defines layer tokens above the application shell and mobile navigation', () => {
    const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    expect(styles).toContain('--layer-overlay: 100')
    expect(styles).toContain('--layer-modal: 110')
    expect(styles).toContain('--layer-dialog: 120')
    expect(styles).toContain('--layer-toast: 130')
    expect(styles).toContain('.kunai-global-layer')
    expect(styles).toContain('position: fixed')
  })

  it('locks both document roots while a modal is open', () => {
    const source = readFileSync(new URL('../hooks/usePreventBackgroundScroll.ts', import.meta.url), 'utf8')
    expect(source).toContain("document.body.style.overflow = 'hidden'")
    expect(source).toContain("document.documentElement.style.overflow = 'hidden'")
    expect(source).toContain('document.documentElement.style.overflow = previousDocumentOverflow')
  })

  it('keeps the original prompt available while presenting a Chinese description', () => {
    const source = readFileSync(new URL('./DetailModal.tsx', import.meta.url), 'utf8')
    expect(source).toContain('图片介绍')
    expect(source).toContain('查看原始提示词')
    expect(source).toContain('复制原始提示词')
    expect(source).toContain('{task.prompt}')
  })
})
