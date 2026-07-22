import { describe, expect, it } from 'vitest'
import type { PlatformAgentModel } from '../platformStore'
import { filterPlatformAgentModels } from './platformAgentModels'

function model(id: string): PlatformAgentModel {
  return {
    id,
    label: id,
    enabled: true,
    selectable: true,
    is_default: id === 'gpt-5.5',
    sort_order: 0,
    input_price_micros: 1,
    cached_input_price_micros: 1,
    output_price_micros: 1,
    max_step_reserve_micros: 1,
    last_seen_at: 1,
  }
}

describe('platform Agent models', () => {
  it('keeps only the 5.5 and configured 5.6 series', () => {
    expect(filterPlatformAgentModels([
      model('gpt-5.4'),
      model('gpt-5.5'),
      model('gpt-5.4-mini'),
      model('gpt-5.6-luna'),
      model('gpt-5.6-sol'),
      model('gpt-5.6-terra'),
    ]).map((item) => item.id)).toEqual([
      'gpt-5.5',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
    ])
  })
})
