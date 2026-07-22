import { describe, expect, it } from 'vitest'
import { formatPlatformPrice, formatPlatformQuota, getPlatformGenerationPriceMicros } from './platformCurrency'

describe('platform currency', () => {
  it('formats wallet quota using the configured display type', () => {
    expect(formatPlatformQuota(500000, { quota_per_unit: 500000, quota_display_type: 'USD' })).toBe('US$1.00')
    expect(formatPlatformQuota(500000, { quota_display_type: 'TOKENS' })).toBe('500,000 Tokens')
    expect(formatPlatformQuota(500000, {
      quota_per_unit: 500000,
      quota_display_type: 'CUSTOM',
      custom_currency_symbol: 'C',
      custom_currency_exchange_rate: 2,
    })).toBe('C2.00')
  })

  it('converts a displayed image price to token units', () => {
    expect(formatPlatformPrice(0.02, { quota_per_unit: 500000, quota_display_type: 'TOKENS' })).toBe('10,000 Tokens')
    expect(formatPlatformPrice(0.2, { quota_display_type: 'CNY' })).toBe('¥0.20')
  })

  it('calculates the full image generation charge in integer micros', () => {
    expect(getPlatformGenerationPriceMicros(0.2, 3)).toBe(600000)
    expect(getPlatformGenerationPriceMicros(0.07, 0)).toBe(70000)
  })
})
