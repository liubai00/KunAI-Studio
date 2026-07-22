import { describe, expect, it } from 'vitest'
import { getDefaultPaymentType, getRechargeValidationError, isValidRechargeAmount } from './platformRecharge'

describe('platform recharge validation', () => {
  it('accepts only in-range amounts with at most two decimal places', () => {
    expect(isValidRechargeAmount('20.00', 1, 5000)).toBe(true)
    expect(isValidRechargeAmount('0.99', 1, 5000)).toBe(false)
    expect(isValidRechargeAmount('20.001', 1, 5000)).toBe(false)
    expect(isValidRechargeAmount('5000.01', 1, 5000)).toBe(false)
  })

  it('requires an available service and a selected QR payment type', () => {
    expect(getRechargeValidationError({ paymentEnabled: false, amount: '20', min: 1, max: 5000, requiresPaymentType: true, payType: null })).toBe('支付服务暂不可用')
    expect(getRechargeValidationError({ paymentEnabled: true, amount: '20', min: 1, max: 5000, requiresPaymentType: true, payType: null })).toBe('请选择微信支付或支付宝')
    expect(getRechargeValidationError({ paymentEnabled: true, amount: '20', min: 1, max: 5000, requiresPaymentType: true, payType: 'alipay' })).toBeNull()
  })

  it('defaults to WeChat and falls back to the first available payment type', () => {
    expect(getDefaultPaymentType(['alipay', 'wxpay'])).toBe('wxpay')
    expect(getDefaultPaymentType(['alipay'])).toBe('alipay')
    expect(getDefaultPaymentType([])).toBeNull()
  })
})
