import type { PlatformStatus } from '../platformStore'

function getDisplayType(status: PlatformStatus | null) {
  return status?.quota_display_type || (status?.display_in_currency === false ? 'TOKENS' : 'USD')
}

function formatNumber(value: number, minDigits: number, maxDigits: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  }).format(value)
}

export function formatPlatformQuota(quota: number, status: PlatformStatus | null, digits = 2) {
  const type = getDisplayType(status)
  if (type === 'TOKENS') return `${formatNumber(quota, 0, 0)} Tokens`

  const quotaPerUnit = status?.quota_per_unit || 500000
  const base = Number.isFinite(quota) && quotaPerUnit > 0 ? quota / quotaPerUnit : 0
  if (type === 'CNY') return `¥${formatNumber(base, digits, digits)}`
  if (type === 'CUSTOM') {
    const rate = status?.custom_currency_exchange_rate || 1
    return `${status?.custom_currency_symbol || '¤'}${formatNumber(base * rate, digits, digits)}`
  }
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(base)
}

export function formatPlatformPrice(price: number, status: PlatformStatus | null) {
  const type = getDisplayType(status)
  if (type === 'TOKENS') {
    const quotaPerUnit = status?.quota_per_unit || 500000
    return `${formatNumber(price * quotaPerUnit, 0, 0)} Tokens`
  }

  const digits = price < 1 ? 3 : 2
  if (type === 'CNY') return `¥${formatNumber(price, digits, 4)}`
  if (type === 'CUSTOM') {
    const rate = status?.custom_currency_exchange_rate || 1
    return `${status?.custom_currency_symbol || '¤'}${formatNumber(price * rate, digits, 4)}`
  }
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: 4,
  }).format(price)
}
