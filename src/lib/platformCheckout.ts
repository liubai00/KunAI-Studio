import { getPlatformCsrfToken } from './platformSession'

export interface PlatformProductCheckout {
  checkout_intent_id: string
  checkout_url?: string | null
  payment_display: 'qrcode' | 'redirect'
  qr_content?: string | null
  kind: 'credits' | 'balance'
  product_id?: string | null
  user_id: number
  amount: number
  amount_micros: number
  credits: number
  expires_at: number
  pay_type?: PlatformPaymentType
}

export type PlatformPaymentType = 'wxpay' | 'alipay'

export interface PlatformPaymentStatus {
  paid: boolean
  status?: 'pending' | 'paid' | 'expired'
  kind?: 'credits' | 'balance'
  creditsAdded?: number
  balanceMicros?: number
}

interface CheckoutResponse {
  success?: boolean
  message?: string
  data?: PlatformProductCheckout
}

async function requestCheckout(body: Record<string, unknown>, fetcher: typeof fetch) {
  const csrf = getPlatformCsrfToken()
  const response = await fetcher('/api/platform/payment/checkout', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as CheckoutResponse | null
  const checkout = payload?.data
  const displayValid = checkout?.payment_display === 'qrcode'
    ? Boolean(checkout.qr_content)
    : checkout?.payment_display === 'redirect' && Boolean(checkout.checkout_url)
  if (!response.ok || !payload?.success || !checkout?.checkout_intent_id || !displayValid) {
    throw new Error(payload?.message || '暂时无法发起购买，请稍后重试')
  }
  return checkout
}

export function createPlatformProductCheckout(productId: string, payType: PlatformPaymentType = 'wxpay', fetcher: typeof fetch = fetch) {
  return requestCheckout({ product_id: productId, pay_type: payType }, fetcher)
}

export function createPlatformBalanceCheckout(amount: string, payType: PlatformPaymentType = 'wxpay', fetcher: typeof fetch = fetch) {
  return requestCheckout({ amount, pay_type: payType }, fetcher)
}

export async function recheckPlatformPayment(checkoutIntentId: string, fetcher: typeof fetch = fetch) {
  const csrf = getPlatformCsrfToken()
  const response = await fetcher('/api/platform/payment/recheck', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ checkout_intent_id: checkoutIntentId }),
  })
  const payload = await response.json().catch(() => null) as { success?: boolean, message?: string, data?: PlatformPaymentStatus } | null
  if (!response.ok || !payload?.success) throw new Error(payload?.message || '暂时无法核对支付结果，请稍后重试')
  return payload.data || { paid: false }
}
