import type { TaskParams } from '../types'
import type { SizeTier } from './size'

export const QUALITY_TIER_OPTIONS: Array<{
  label: string
  value: Exclude<TaskParams['quality'], 'auto'>
}> = [
  { label: '1K', value: 'low' },
  { label: '2K', value: 'medium' },
  { label: '4K', value: 'high' },
]

export function getQualityDisplayLabel(value: string) {
  return QUALITY_TIER_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function getQualityValueForSizeTier(tier: SizeTier): Exclude<TaskParams['quality'], 'auto'> {
  if (tier === '1K') return 'low'
  if (tier === '2K') return 'medium'
  return 'high'
}

export function getSizeTierForQuality(value: TaskParams['quality']): SizeTier | null {
  if (value === 'low') return '1K'
  if (value === 'medium') return '2K'
  if (value === 'high') return '4K'
  return null
}
