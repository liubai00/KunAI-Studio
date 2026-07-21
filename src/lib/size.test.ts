import { describe, expect, it } from 'vitest'
import { calculateImageSize, calculateImageSizeForTier, getImageSizeTier } from './size'

describe('calculateImageSize', () => {
  it('uses common 16:9 display resolutions for the built-in tiers', () => {
    expect(calculateImageSize('1K', '16:9')).toBe('1280x720')
    expect(calculateImageSize('2K', '16:9')).toBe('2560x1440')
    expect(calculateImageSize('4K', '16:9')).toBe('3840x2160')
  })

  it('uses matching portrait presets for common ratios', () => {
    expect(calculateImageSize('2K', '9:16')).toBe('1440x2560')
    expect(calculateImageSize('2K', '2:3')).toBe('1440x2160')
    expect(calculateImageSize('2K', '3:4')).toBe('1536x2048')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    expect(calculateImageSize('2K', '5:4')).toBe('2288x1824')
  })

  it('keeps the aspect ratio when switching resolution tiers', () => {
    expect(calculateImageSizeForTier('4K', '1280x720')).toBe('3840x2160')
    expect(calculateImageSizeForTier('2K', '1024x1536')).toBe('1440x2160')
    expect(getImageSizeTier('1024x1024')).toBe('1K')
    expect(getImageSizeTier('2048x2048')).toBe('2K')
    expect(getImageSizeTier('3840x2160')).toBe('4K')
  })
})
