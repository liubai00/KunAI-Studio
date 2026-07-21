import { describe, expect, it } from 'vitest'
import { getQualityDisplayLabel, getQualityValueForSizeTier, getSizeTierForQuality, QUALITY_TIER_OPTIONS } from './quality'

describe('quality display labels', () => {
  it('shows compatible API quality values as resolution tiers', () => {
    expect(QUALITY_TIER_OPTIONS).toEqual([
      { label: '1K', value: 'low' },
      { label: '2K', value: 'medium' },
      { label: '4K', value: 'high' },
    ])
    expect(getQualityDisplayLabel('auto')).toBe('auto')
    expect(getQualityDisplayLabel('medium')).toBe('2K')
    expect(getQualityDisplayLabel('vendor-value')).toBe('vendor-value')
  })

  it('maps the visible resolution tier to the stored API-compatible value', () => {
    expect(getQualityValueForSizeTier('1K')).toBe('low')
    expect(getQualityValueForSizeTier('2K')).toBe('medium')
    expect(getQualityValueForSizeTier('4K')).toBe('high')
    expect(getSizeTierForQuality('medium')).toBe('2K')
    expect(getSizeTierForQuality('auto')).toBeNull()
  })
})
