export const PLATFORM_AGENT_MODEL_IDS = [
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
] as const

const PLATFORM_AGENT_MODEL_ID_SET = new Set<string>(PLATFORM_AGENT_MODEL_IDS)

export function filterPlatformAgentModels<T extends { id: string }>(models: T[]) {
  return models.filter((model) => PLATFORM_AGENT_MODEL_ID_SET.has(model.id))
}
