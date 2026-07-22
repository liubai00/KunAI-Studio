import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('billing page structure', () => {
  const source = readFileSync(new URL('./BillingModal.tsx', import.meta.url), 'utf8')

  it('keeps amount, payment type and QR output in the balance recharge card', () => {
    expect(source).toContain('账户余额充值')
    expect(source).toContain('aria-label="支付方式"')
    expect(source).toContain('<PaymentQrModal embedded')
    expect(source).toContain("if (refresh) void handleRecharge('wxpay')")
    expect(source).toContain("if (refresh) void handleRecharge('alipay')")
    expect(source).toContain('getDefaultPaymentType(status?.image_studio?.payment_types ?? [])')
  })

  it('shows tiered image and Agent model prices', () => {
    expect(source).toContain('IMAGE_PRICE_TIERS.map')
    expect(source).toContain('Agent 模型价格')
    expect(source).toContain('人民币 / 百万 tokens')
    expect(source).not.toContain('生图单价')
    expect(source).not.toContain('1 USD =')
    expect(source).toContain('formatPlatformLedgerAmount(entry.amount_micros, status)')
  })
})
