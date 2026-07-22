import { describe, expect, it } from 'vitest'
import type { AgentConversation, AgentRound, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getFinalAgentResponseTaskIds, getVisibleAgentRoundTaskSlots, normalizeAgentConversationTaskReferences } from './agentTaskReferences'

const task = (id: string, status: TaskRecord['status'] = 'done', outputImages = [`${id}-image`]): TaskRecord => ({
  id,
  prompt: '生成图片',
  params: { ...DEFAULT_PARAMS, n: 1 },
  inputImageIds: [],
  maskTargetImageId: null,
  maskImageId: null,
  outputImages,
  status,
  error: status === 'error' ? '生成失败' : null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
})

const round = (patch: Partial<AgentRound> = {}): AgentRound => ({
  id: 'round-a',
  index: 1,
  parentRoundId: null,
  userMessageId: 'user-a',
  assistantMessageId: 'assistant-a',
  prompt: '生成图片',
  inputImageIds: [],
  outputTaskIds: [],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  ...patch,
})

describe('Agent task references', () => {
  it('renders one successful task and ignores stale retry references', () => {
    const currentRound = round({ outputTaskIds: ['retry-a', 'task-live', 'retry-b', 'task-live'] })
    expect(getVisibleAgentRoundTaskSlots(currentRound, [task('task-live')])).toEqual([
      { taskId: 'task-live', task: expect.objectContaining({ id: 'task-live' }), removed: false },
    ])
  })

  it('keeps a placeholder only for an explicitly deleted successful image', () => {
    const currentRound = round({ outputTaskIds: ['task-removed'], removedOutputTaskIds: ['task-removed'] })
    expect(getVisibleAgentRoundTaskSlots(currentRound, [])).toEqual([
      { taskId: 'task-removed', task: null, removed: true },
    ])
  })

  it('migrates old conversations by dropping duplicate and unmarked missing task ids', () => {
    const conversation: AgentConversation = {
      id: 'conversation-a',
      title: '会话',
      modelId: 'gpt-5.5',
      searchEnabled: true,
      createdAt: 1,
      updatedAt: 2,
      activeRoundId: 'round-a',
      rounds: [round({ outputTaskIds: ['stale-a', 'task-live', 'task-live', 'task-removed'], removedOutputTaskIds: ['task-removed'] })],
      messages: [
        { id: 'user-a', role: 'user', content: '生成图片', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '完成', roundId: 'round-a', outputTaskIds: ['stale-a', 'task-live', 'task-live', 'task-removed'], createdAt: 2 },
      ],
    }

    const result = normalizeAgentConversationTaskReferences([conversation], [task('task-live')])
    expect(result.changed).toBe(true)
    expect(result.conversations[0].rounds[0]).toMatchObject({
      outputTaskIds: ['task-live', 'task-removed'],
      removedOutputTaskIds: ['task-removed'],
    })
    expect(result.conversations[0].messages[1].outputTaskIds).toEqual(['task-live', 'task-removed'])
  })

  it('keeps successful results and removes failed retry tasks from the final response', () => {
    expect(getFinalAgentResponseTaskIds(
      ['retry-a', 'task-live', 'retry-b', 'task-live'],
      [task('retry-a', 'error', []), task('task-live'), task('retry-b', 'error', [])],
    )).toEqual(['task-live'])
  })

  it('shows only the last failure when no image succeeds', () => {
    expect(getFinalAgentResponseTaskIds(
      ['retry-a', 'retry-b'],
      [task('retry-a', 'error', []), task('retry-b', 'error', [])],
    )).toEqual(['retry-b'])
  })
})
