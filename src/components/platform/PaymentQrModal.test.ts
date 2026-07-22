import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { shouldPollPlatformPayment } from './PaymentQrModal'

describe('payment QR polling', () => {
  it('runs only for visible, pending, unexpired orders', () => {
    expect(shouldPollPlatformPayment(true, 'pending', 2000, 1000)).toBe(true)
    expect(shouldPollPlatformPayment(false, 'pending', 2000, 1000)).toBe(false)
    expect(shouldPollPlatformPayment(true, 'paid', 2000, 1000)).toBe(false)
    expect(shouldPollPlatformPayment(true, 'pending', 1000, 1000)).toBe(false)
  })

  it('renders an accessible QR payment flow without browser dialogs', () => {
    const source = readFileSync(new URL('./PaymentQrModal.tsx', import.meta.url), 'utf8')
    expect(source).toContain('QRCode.toDataURL')
    expect(source).toContain('我已完成支付')
    expect(source).toContain('刷新支付状态')
    expect(source).toContain('document.visibilityState')
    expect(source).toContain('GlobalModal')
    expect(source).toContain("useCloseOnEscape(!props.embedded, props.onClose)")
    expect(source).toContain("role={props.embedded ? 'region' : 'dialog'}")
    expect(source).toContain('if (props.embedded) return panel')
    expect(source).not.toContain('window.alert')
    expect(source).not.toContain('window.confirm')
  })
})
