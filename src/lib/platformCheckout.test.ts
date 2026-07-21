import { describe, expect, it, vi } from 'vitest'
import { createPlatformBalanceCheckout, createPlatformProductCheckout, recheckPlatformPayment } from './platformCheckout'

describe('createPlatformProductCheckout', () => {
  it('creates a server-side checkout intent before returning the payment URL', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        checkout_intent_id: 'intent-123',
        checkout_url: 'https://pay.test/checkout?checkout_intent_id=intent-123',
        product_id: 'credits-100',
        user_id: 42,
        amount: 36,
        amount_micros: 36000000,
        credits: 100,
        expires_at: 1700001800000,
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

    const result = await createPlatformProductCheckout('credits-100', 'alipay', fetcher)

    expect(result.checkout_intent_id).toBe('intent-123')
    expect(fetcher).toHaveBeenCalledWith('/api/platform/payment/checkout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ product_id: 'credits-100', pay_type: 'alipay' }),
    }))
  })

  it('surfaces an unavailable checkout response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      message: '支付入口尚未配置',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

    await expect(createPlatformProductCheckout('credits-100', 'wxpay', fetcher)).rejects.toThrow('支付入口尚未配置')
  })

  it('creates balance checkout and rechecks the provider order', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/recheck')) {
        return new Response(JSON.stringify({ success: true, data: { paid: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        success: true,
        data: {
          checkout_intent_id: 'bal_intent-123',
          checkout_url: 'https://pay.test/order/1',
          kind: 'balance',
          user_id: 42,
          amount: 20,
          amount_micros: 20000000,
          credits: 0,
          expires_at: 1700001800000,
        },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    })

    const checkout = await createPlatformBalanceCheckout('20.00', 'wxpay', fetcher as typeof fetch)
    expect(checkout.kind).toBe('balance')
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/platform/payment/checkout', expect.objectContaining({
      body: JSON.stringify({ amount: '20.00', pay_type: 'wxpay' }),
    }))
    await expect(recheckPlatformPayment(checkout.checkout_intent_id, fetcher as typeof fetch)).resolves.toEqual({ paid: true })
  })
})
