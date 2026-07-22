import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getParamDisplay } from './paramDisplay'

const task = (params: Partial<TaskRecord['params']> = {}): TaskRecord => ({
  id: 'task-a',
  prompt: '提示词',
  params: { ...DEFAULT_PARAMS, ...params },
  inputImageIds: [],
  maskTargetImageId: null,
  maskImageId: null,
  outputImages: [],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
})

describe('localized task parameters', () => {
  it('localizes automatic and boolean values', () => {
    expect(getParamDisplay(task({ size: 'auto' }), 'size').displayValue).toBe('自动')
    expect(getParamDisplay(task({ transparent_output: false }), 'transparent_output').displayValue).toBe('关闭')
    expect(getParamDisplay(task({ transparent_output: true }), 'transparent_output').displayValue).toBe('开启')
  })

  it('normalizes image formats to uppercase', () => {
    expect(getParamDisplay(task({ output_format: 'png' }), 'output_format').displayValue).toBe('PNG')
  })
})
