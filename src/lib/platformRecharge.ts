import type { PlatformPaymentType } from './platformCheckout'

interface RechargeValidationOptions {
  paymentEnabled: boolean
  amount: string
  min: number
  max: number
  requiresPaymentType: boolean
  payType: PlatformPaymentType | null
}

export function isValidRechargeAmount(amount: string, min: number, max: number) {
  const value = Number(amount)
  return Number.isFinite(value) && value >= min && value <= max && /^\d+(?:\.\d{1,2})?$/.test(amount.trim())
}

export function getDefaultPaymentType(paymentTypes: PlatformPaymentType[]) {
  if (paymentTypes.includes('wxpay')) return 'wxpay'
  return paymentTypes[0] ?? null
}

export function getRechargeValidationError(options: RechargeValidationOptions) {
  if (!options.paymentEnabled) return '支付服务暂不可用'
  if (!isValidRechargeAmount(options.amount, options.min, options.max)) {
    return `请输入 ¥${options.min.toFixed(2)}–¥${options.max.toFixed(2)} 的有效金额`
  }
  if (options.requiresPaymentType && !options.payType) return '请选择微信支付或支付宝'
  return null
}
