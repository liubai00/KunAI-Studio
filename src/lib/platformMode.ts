import type { ApiProfile, AppSettings } from '../types'
import { readRuntimeEnv } from './runtimeEnv'

export const PLATFORM_IMAGE_PROFILE_ID = 'platform-managed-image'
export const PLATFORM_AGENT_PROFILE_ID = 'platform-managed-agent'

export function isPlatformModeEnabled() {
  const configured = readRuntimeEnv(import.meta.env.VITE_PLATFORM_MODE)
  if (configured) return configured !== 'false'
  return import.meta.env.MODE !== 'test'
}

export function createPlatformSettings(settings: AppSettings): AppSettings {
  const imageProfile: ApiProfile = {
    id: PLATFORM_IMAGE_PROFILE_ID,
    name: '平台图像服务',
    provider: 'openai',
    baseUrl: 'https://platform.invalid/v1',
    apiKey: 'managed-session',
    model: readRuntimeEnv(import.meta.env.VITE_PLATFORM_IMAGE_MODEL) || 'gpt-image-2',
    timeout: settings.timeout,
    apiMode: 'images',
    codexCli: false,
    apiProxy: true,
    responseFormatB64Json: true,
    streamImages: false,
  }
  const agentProfile: ApiProfile = {
    id: PLATFORM_AGENT_PROFILE_ID,
    name: '平台 Agent 服务',
    provider: 'openai',
    baseUrl: 'https://platform.invalid/v1',
    apiKey: 'managed-session',
    model: readRuntimeEnv(import.meta.env.VITE_PLATFORM_AGENT_MODEL) || 'gpt-5.5',
    timeout: settings.timeout,
    apiMode: 'responses',
    codexCli: false,
    apiProxy: true,
    streamImages: true,
    streamPartialImages: 1,
  }

  return {
    ...settings,
    baseUrl: imageProfile.baseUrl,
    apiKey: imageProfile.apiKey,
    model: imageProfile.model,
    apiMode: imageProfile.apiMode,
    apiProxy: true,
    customProviders: [],
    providerOrder: ['openai'],
    profiles: [imageProfile, agentProfile],
    activeProfileId: imageProfile.id,
    agentApiConfigMode: 'hybrid',
    agentTextProfileId: agentProfile.id,
    agentImageProfileId: imageProfile.id,
  }
}
