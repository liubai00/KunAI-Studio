import { describe, expect, it } from 'vitest'
import type { AgentConversation, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getChineseImageDescription, getTaskImageDescription } from './taskDescription'

const task = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task-a',
  prompt: 'cinematic cyberpunk workspace',
  params: { ...DEFAULT_PARAMS },
  inputImageIds: [],
  maskTargetImageId: null,
  maskImageId: null,
  outputImages: ['image-a'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
  ...patch,
})

describe('task image descriptions', () => {
  it('extracts a stable Chinese paragraph from an Agent response', () => {
    expect(getChineseImageDescription('![图](data:image/png;base64,abc)\n\n**赛博朋克工作区，青紫霓虹照亮多屏终端。**'))
      .toBe('赛博朋克工作区，青紫霓虹照亮多屏终端。')
  })

  it('prioritizes a persisted description without changing the original prompt', () => {
    const record = task({ displayDescription: '持久化的中文图片介绍。' })
    expect(getTaskImageDescription(record)).toBe('持久化的中文图片介绍。')
    expect(record.prompt).toBe('cinematic cyberpunk workspace')
  })

  it('uses the matching Agent assistant message for historical tasks', () => {
    const record = task({ sourceMode: 'agent', agentConversationId: 'conversation-a', agentRoundId: 'round-a', agentMessageId: 'assistant-a' })
    const conversations: AgentConversation[] = [{
      id: 'conversation-a',
      title: '会话',
      modelId: 'gpt-5.5',
      searchEnabled: true,
      createdAt: 1,
      updatedAt: 2,
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '生成赛博朋克图片',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '生成赛博朋克图片', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '赛博朋克程序员坐在多屏工作区，画面采用青紫霓虹光。', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
      ],
    }]

    expect(getTaskImageDescription(record, conversations)).toBe('赛博朋克程序员坐在多屏工作区，画面采用青紫霓虹光。')
  })

  it('provides a Chinese fallback for legacy English-only tasks', () => {
    expect(getTaskImageDescription(task())).toBe('这是一张由 KunAI Studio 根据原始提示词生成的图片。')
  })
})
