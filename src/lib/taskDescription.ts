import type { AgentConversation, TaskRecord } from '../types'

const HAN_TEXT_RE = /\p{Script=Han}/u

export function getChineseImageDescription(value: string) {
  const paragraphs = value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map((part) => part
      .replace(/^\s{0,3}(?:#{1,6}|[-*+] |\d+[.)] )\s*/gm, '')
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
  const description = paragraphs.find((part) => HAN_TEXT_RE.test(part)) ?? ''
  return description.length > 500 ? `${description.slice(0, 500)}…` : description
}

export function getTaskImageDescription(task: TaskRecord, conversations: AgentConversation[] = []) {
  const storedDescription = getChineseImageDescription(task.displayDescription ?? '')
  if (storedDescription) return storedDescription

  if (task.sourceMode === 'agent' || task.agentConversationId || task.agentRoundId) {
    const conversation = conversations.find((item) =>
      item.id === task.agentConversationId || item.rounds.some((round) => round.id === task.agentRoundId),
    )
    const round = conversation?.rounds.find((item) => item.id === task.agentRoundId)
    const assistantMessage = conversation?.messages.find((message) =>
      message.role === 'assistant' && (
        message.id === task.agentMessageId ||
        message.id === round?.assistantMessageId ||
        message.roundId === task.agentRoundId
      ),
    )
    const assistantDescription = getChineseImageDescription(assistantMessage?.content ?? '')
    if (assistantDescription) return assistantDescription
  }

  const promptDescription = getChineseImageDescription(task.prompt)
  if (promptDescription) return promptDescription
  return '这是一张由 KunAI Studio 根据原始提示词生成的图片。'
}
