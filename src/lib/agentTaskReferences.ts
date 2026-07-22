import type { AgentConversation, AgentRound, TaskRecord } from '../types'

export interface AgentRoundTaskSlot {
  taskId: string
  task: TaskRecord | null
  removed: boolean
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)))
}

export function getVisibleAgentRoundTaskSlots(round: AgentRound | null, tasks: TaskRecord[]): AgentRoundTaskSlot[] {
  if (!round) return []
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const removedTaskIds = new Set(round.removedOutputTaskIds ?? [])
  const slots: AgentRoundTaskSlot[] = []
  for (const taskId of uniqueIds(round.outputTaskIds)) {
    const task = tasksById.get(taskId)
    if (task) slots.push({ taskId, task, removed: false })
    else if (removedTaskIds.has(taskId)) slots.push({ taskId, task: null, removed: true })
  }
  return slots
}

export function getFinalAgentResponseTaskIds(taskIds: string[], tasks: TaskRecord[]) {
  const uniqueTaskIds = uniqueIds(taskIds)
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const successfulTaskIds = uniqueTaskIds.filter((taskId) => {
    const task = tasksById.get(taskId)
    return task?.status === 'done' && task.outputImages.length > 0
  })
  if (successfulTaskIds.length > 0) return successfulTaskIds
  const existingTaskIds = uniqueTaskIds.filter((taskId) => tasksById.has(taskId))
  return existingTaskIds.length > 1 ? existingTaskIds.slice(-1) : existingTaskIds
}

export function normalizeAgentConversationTaskReferences(conversations: AgentConversation[], tasks: TaskRecord[]) {
  const existingTaskIds = new Set(tasks.map((task) => task.id))
  let changed = false
  const normalized = conversations.map((conversation) => {
    const validTaskIdsByRound = new Map<string, Set<string>>()
    const rounds = conversation.rounds.map((round) => {
      const removedOutputTaskIds = uniqueIds(round.removedOutputTaskIds ?? [])
      const removedTaskIds = new Set(removedOutputTaskIds)
      const outputTaskIds = uniqueIds(round.outputTaskIds).filter((taskId) => existingTaskIds.has(taskId) || removedTaskIds.has(taskId))
      const validRemovedTaskIds = removedOutputTaskIds.filter((taskId) => outputTaskIds.includes(taskId) && !existingTaskIds.has(taskId))
      validTaskIdsByRound.set(round.id, new Set(outputTaskIds))
      if (
        outputTaskIds.length !== round.outputTaskIds.length ||
        outputTaskIds.some((taskId, index) => taskId !== round.outputTaskIds[index]) ||
        validRemovedTaskIds.length !== removedOutputTaskIds.length
      ) changed = true
      return {
        ...round,
        outputTaskIds,
        ...(validRemovedTaskIds.length > 0 ? { removedOutputTaskIds: validRemovedTaskIds } : { removedOutputTaskIds: undefined }),
      }
    })
    const messages = conversation.messages.map((message) => {
      if (!message.outputTaskIds) return message
      const validTaskIds = validTaskIdsByRound.get(message.roundId) ?? new Set<string>()
      const outputTaskIds = uniqueIds(message.outputTaskIds).filter((taskId) => validTaskIds.has(taskId))
      if (outputTaskIds.length === message.outputTaskIds.length && outputTaskIds.every((taskId, index) => taskId === message.outputTaskIds?.[index])) return message
      changed = true
      return { ...message, outputTaskIds }
    })
    return { ...conversation, rounds, messages }
  })

  return { conversations: changed ? normalized : conversations, changed }
}
