import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../../types'
import { createDefaultOpenAIProfile } from '../../lib/apiProfiles'
import { PLATFORM_IMAGE_PROFILE_ID } from '../../lib/platformMode'
import Select from '../Select'
import InputParamsPanel from './inputParamsPanel'

function createHint() {
  return {
    visible: false,
    show: vi.fn(),
    hide: vi.fn(),
    clearTimer: vi.fn(),
    startTouch: vi.fn(),
  }
}

function getQualitySelect(setParams: (patch: Partial<TaskParams>) => void) {
  const hint = createHint()
  const panel = InputParamsPanel({
    cols: 'grid-cols-2',
    params: { ...DEFAULT_PARAMS, size: '1024x1536', quality: 'low' },
    setParams,
    activeProfile: createDefaultOpenAIProfile({ id: PLATFORM_IMAGE_PROFILE_ID }),
    isFalProvider: false,
    isFalTextToImage: false,
    displaySize: '1024 × 1536',
    qualityOptions: [
      { label: '1K', value: 'low' },
      { label: '2K', value: 'medium' },
      { label: '4K', value: 'high' },
    ],
    selectClass: 'select',
    transparentOutputAvailable: false,
    showTransparentOutputControl: false,
    transparentOutputEnabled: false,
    transparentOutputHint: hint,
    onTransparentOutputMenuOpenChange: vi.fn(),
    compressionHint: hint,
    compressionDisabled: false,
    outputCompressionInput: '',
    setOutputCompressionInput: vi.fn(),
    commitOutputCompression: vi.fn(),
    moderationHint: hint,
    moderationDisabled: false,
    agentAutoImageCount: false,
    outputImageLimit: 4,
    nInput: '1',
    setNInputFocused: vi.fn(),
    commitN: vi.fn(),
    handleNInputChange: vi.fn(),
    handleNLimitIncreaseAttempt: vi.fn(),
    showAgentNHint: vi.fn(),
    hideNLimitHint: vi.fn(),
    startAgentNHintTouch: vi.fn(),
    clearAgentNHintTouchTimer: vi.fn(),
    nLimitHint: hint,
    nLimitHintText: '',
    streamConcurrentByN: false,
    streamConcurrentHint: hint,
    sizeHint: hint,
    qualityHint: hint,
    onOpenSizePicker: vi.fn(),
  }) as ReactElement<{ children?: ReactNode }>
  const qualityLabel = Children.toArray(panel.props.children)[1] as ReactElement<{ children?: ReactNode }>
  const select = Children.toArray(qualityLabel.props.children)
    .find((child) => isValidElement(child) && child.type === Select)

  return select as ReactElement<{ onChange: (value: string) => void }>
}

describe('platform image resolution routing', () => {
  it.each([
    ['low', '1024x1536'],
    ['medium', '1440x2160'],
    ['high', '2304x3456'],
  ])('routes %s to the matching size tier while preserving aspect ratio', (quality, size) => {
    const setParams = vi.fn<(patch: Partial<TaskParams>) => void>()
    const select = getQualitySelect(setParams)

    select.props.onChange(quality)

    expect(setParams).toHaveBeenCalledWith({ quality, size })
  })
})
