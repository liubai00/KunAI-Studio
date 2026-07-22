import { describe, expect, it } from 'vitest'
import { formatPlatformPrice, formatPlatformQuota, getPlatformGenerationPriceMicros, getPlatformImagePrice } from './platformCurrency'

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

  it('selects the image price for the active resolution tier', () => {
    const status = {
      image_studio: {
        image_unit_price: 0.15,
        image_prices: { '1k': 0.15, '2k': 0.2, '4k': 0.5 },
        generation_min_role: 1,
        agent_min_role: 1,
      },
    }
    expect(getPlatformImagePrice(status, '1K')).toBe(0.15)
    expect(getPlatformImagePrice(status, '2K')).toBe(0.2)
    expect(getPlatformImagePrice(status, '4K')).toBe(0.5)
  })

  it('rounds converted Agent rates to two decimal places for display', () => {
    expect(formatPlatformQuota(1548000, { quota_display_type: 'CNY', quota_per_unit: 1000000 })).toBe('¥1.55')
    expect(formatPlatformQuota(252000, { quota_display_type: 'CNY', quota_per_unit: 1000000 })).toBe('¥0.25')
  })
})
