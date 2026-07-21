import { create } from 'zustand'
import { getPlatformCsrfToken } from './lib/platformSession'
import { clearActiveStorageUser, setActiveStorageUser } from './lib/userStorage'

export const PLATFORM_SESSION_EVENT_KEY = 'kunai-studio-platform-session-event'

export interface PlatformUser {
  id: number
  username: string
  display_name?: string
  email: string
  email_verified?: boolean
  role: number
  status: number
  group: string
  quota: number
  reserved_quota?: number
  used_quota: number
  image_credits?: number
  reserved_credits?: number
  available_credits?: number
  membership_expires_at?: number | null
  membership_active?: boolean
  request_count: number
  image_studio_capabilities: {
    generation: boolean
    agent: boolean
    admin?: boolean
  }
}

export interface PlatformProduct {
  id: string
  kind: 'membership' | 'credits'
  name: string
  description?: string
  price: number
  price_micros: number
  duration_days: number
  credits: number
  sort_order: number
  active: boolean
}

export interface PlatformAgentModel {
  id: string
  label: string
  enabled: boolean
  selectable: boolean
  is_default: boolean
  sort_order: number
  input_price_micros: number | null
  cached_input_price_micros: number | null
  output_price_micros: number | null
  max_step_reserve_micros: number | null
  last_seen_at: number | null
}

export interface AgentModelInput {
  label?: string
  enabled?: boolean
  is_default?: boolean
  sort_order?: number
  input_price_micros?: number | null
  cached_input_price_micros?: number | null
  output_price_micros?: number | null
  max_step_reserve_micros?: number | null
}

interface AgentModelList {
  models: PlatformAgentModel[]
  default_model?: string | null
}

export interface PlatformStatus {
  system_name?: string
  email_verification?: boolean
  register_enabled?: boolean
  password_register_enabled?: boolean
  turnstile_check?: boolean
  turnstile_site_key?: string
  quota_per_unit?: number
  display_in_currency?: boolean
  quota_display_type?: string
  custom_currency_symbol?: string
  custom_currency_exchange_rate?: number
  image_studio?: {
    image_unit_price: number
    payment_url?: string
    payment_enabled?: boolean
    payment_provider?: 'dulupay' | 'custom' | null
    payment_types?: Array<'wxpay' | 'alipay'>
    recharge_min?: number
    recharge_max?: number
    generation_min_role: number
    agent_min_role: number
    relay_configured?: boolean
    agent_configured?: boolean
    search_configured?: boolean
    search_price?: number
    default_agent_model?: string | null
    image_models?: string[]
    products?: PlatformProduct[]
  }
}

export interface PlatformLedgerEntry {
  id: number
  kind: string
  amount_micros: number
  balance_after_micros: number
  reference: string
  description: string
  created_at: number
}

export interface PlatformBillingRound {
  id: number
  conversation_id: string
  round_id: string
  status: 'open' | 'completed' | 'failed'
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  search_calls: number
  image_count: number
  image_credits_used: number
  agent_micros: number
  search_micros: number
  total_micros: number
  created_at: number
  updated_at: number
}

export interface PlatformBilling extends PlatformUser {
  payment_url?: string
  payment_enabled?: boolean
  payment_provider?: 'dulupay' | 'custom' | null
  payment_types?: Array<'wxpay' | 'alipay'>
  recharge_min?: number
  recharge_max?: number
  image_unit_price: number
  products?: PlatformProduct[]
  entries: PlatformLedgerEntry[]
  agent_rounds?: PlatformBillingRound[]
}

export interface ProductInput {
  id: string
  kind: 'membership' | 'credits'
  name: string
  description?: string
  price: string
  duration_days?: number
  credits?: number
  sort_order?: number
  active?: boolean
}

export interface RedemptionCode {
  code: string
  credits: number
  membership_days: number
  balance: number
  note: string
  expires_at: number | null
  redeemed_by: number | null
  redeemed_at: number | null
  created_at: number
}

export interface RedemptionInput {
  credits?: number
  membership_days?: number
  balance?: string
  count: number
  note?: string
  expires_at?: number | null
}

export interface RedeemResult extends PlatformUser {
  granted: { credits?: number; membershipDays?: number; membershipExpiresAt?: number; balanceMicros?: number }
}

export function hasPlatformCapability(user: PlatformUser | null, _status: PlatformStatus | null, capability: 'generation' | 'agent') {
  if (!user || user.status !== 1) return false
  return user.image_studio_capabilities[capability] === true
}

type ApiResponse<T = unknown> = {
  success: boolean
  message?: string
  data?: T
}

interface CodeResponse {
  dev_code?: string
}

interface PlatformState {
  phase: 'loading' | 'anonymous' | 'authenticated' | 'error'
  user: PlatformUser | null
  status: PlatformStatus | null
  agentModels: PlatformAgentModel[]
  defaultAgentModel: string | null
  error: string | null
  bootstrap: () => Promise<void>
  refreshSession: () => Promise<void>
  login: (email: string, password: string, turnstile?: string) => Promise<void>
  register: (email: string, password: string, code: string, turnstile?: string) => Promise<void>
  sendVerification: (email: string, turnstile?: string) => Promise<CodeResponse>
  sendPasswordReset: (email: string, turnstile?: string) => Promise<CodeResponse>
  resetPassword: (email: string, password: string, code: string, turnstile?: string) => Promise<void>
  loadBilling: () => Promise<PlatformBilling>
  listUsers: (search?: string) => Promise<PlatformUser[]>
  updateUserAccess: (id: number, changes: { role?: number; status?: number; group?: string }) => Promise<PlatformUser>
  adjustUserBalance: (id: number, amount: string, note?: string) => Promise<PlatformUser>
  grantUserMembership: (id: number, days: number, note?: string) => Promise<PlatformUser>
  grantUserCredits: (id: number, credits: number, note?: string) => Promise<PlatformUser>
  listProducts: () => Promise<PlatformProduct[]>
  saveProduct: (product: ProductInput) => Promise<PlatformProduct>
  deleteProduct: (id: string) => Promise<{ deleted: boolean }>
  loadAgentModels: () => Promise<PlatformAgentModel[]>
  listAgentModels: () => Promise<PlatformAgentModel[]>
  refreshAgentModels: () => Promise<PlatformAgentModel[]>
  saveAgentModel: (id: string, changes: AgentModelInput) => Promise<PlatformAgentModel>
  redeemCode: (code: string) => Promise<RedeemResult>
  listRedemptionCodes: (unusedOnly?: boolean) => Promise<RedemptionCode[]>
  createRedemptionCodes: (input: RedemptionInput) => Promise<{ codes: string[] }>
  logout: () => Promise<void>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method || 'GET'
  const csrf = method === 'GET' || method === 'HEAD' ? '' : getPlatformCsrfToken()
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null) as ApiResponse<T> | null
  if (!response.ok || !payload?.success) {
    if (response.status === 401) {
      clearActiveStorageUser()
      usePlatformStore.setState({ phase: 'anonymous', user: null, error: null })
    }
    const err = new Error(payload?.message || (response.status === 401 ? '登录状态已失效' : '平台服务暂时不可用')) as Error & { status?: number }
    err.status = response.status
    throw err
  }
  return payload.data as T
}

async function loadStatus() {
  const status = await request<PlatformStatus>('/api/platform/status')
  if (!status || typeof status !== 'object' || !status.image_studio) throw new Error('平台状态响应无效')
  return status
}

async function loadSession() {
  const user = await request<PlatformUser>('/api/platform/session')
  if (!user || !Number.isFinite(user.id) || !user.email || !user.image_studio_capabilities) throw new Error('登录状态响应无效')
  return user
}

function readAgentModelList(value: AgentModelList | PlatformAgentModel[]) {
  if (Array.isArray(value)) return { models: value, defaultModel: value.find((model) => model.is_default)?.id ?? null }
  const models = Array.isArray(value?.models) ? value.models : []
  return { models, defaultModel: value?.default_model ?? models.find((model) => model.is_default)?.id ?? null }
}

function activateUser(user: PlatformUser) {
  setActiveStorageUser(String(user.id))
}

function notifySessionChanged() {
  try {
    window.localStorage.setItem(PLATFORM_SESSION_EVENT_KEY, `${Date.now()}-${Math.random()}`)
  } catch {
    // 浏览器禁用存储时仍由请求中的预期用户校验保证隔离。
  }
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  phase: 'loading',
  user: null,
  status: null,
  agentModels: [],
  defaultAgentModel: null,
  error: null,
  bootstrap: async () => {
    set({ phase: 'loading', error: null })
    try {
      const status = await loadStatus()
      set({ status })
      try {
        const user = await loadSession()
        activateUser(user)
        set({ phase: 'authenticated', user, error: null })
        await get().loadAgentModels().catch(() => [])
      } catch (err) {
        clearActiveStorageUser()
        if ((err as Error & { status?: number }).status === 401) {
          set({ phase: 'anonymous', user: null, error: null })
          return
        }
        set({ phase: 'error', user: null, error: err instanceof Error ? err.message : String(err) })
      }
    } catch (err) {
      clearActiveStorageUser()
      set({ phase: 'error', user: null, status: null, error: err instanceof Error ? err.message : String(err) })
    }
  },
  refreshSession: async () => {
    try {
      const user = await loadSession()
      const currentUser = get().user
      if (currentUser && currentUser.id !== user.id) {
        window.location.reload()
        throw new Error('账户已切换，正在重新加载')
      }
      activateUser(user)
      set({ phase: 'authenticated', user, error: null })
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) {
        clearActiveStorageUser()
        set({ phase: 'anonymous', user: null, error: null })
        window.location.reload()
      }
      throw err
    }
  },
  login: async (email, password, turnstile) => {
    await request('/api/platform/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase(), password, turnstile }),
    })
    notifySessionChanged()
    window.location.reload()
  },
  register: async (email, password, code, turnstile) => {
    await request('/api/platform/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        verification_code: code.trim(),
        turnstile,
      }),
    })
  },
  sendVerification: async (email, turnstile) => request('/api/platform/auth/verification', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), turnstile }),
  }),
  sendPasswordReset: async (email, turnstile) => request('/api/platform/auth/reset-verification', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), turnstile }),
  }),
  resetPassword: async (email, password, code, turnstile) => {
    await request('/api/platform/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        verification_code: code.trim(),
        turnstile,
      }),
    })
  },
  loadBilling: async () => {
    const billing = await request<PlatformBilling>('/api/platform/billing')
    set({ user: billing })
    return billing
  },
  listUsers: (search = '') => request(`/api/platform/admin/users?search=${encodeURIComponent(search)}`),
  updateUserAccess: (id, changes) => request(`/api/platform/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  }),
  adjustUserBalance: (id, amount, note) => request(`/api/platform/admin/users/${id}/balance`, {
    method: 'POST',
    body: JSON.stringify({ amount, note }),
  }),
  grantUserMembership: (id, days, note) => request(`/api/platform/admin/users/${id}/membership`, {
    method: 'POST',
    body: JSON.stringify({ days, note }),
  }),
  grantUserCredits: (id, credits, note) => request(`/api/platform/admin/users/${id}/credits`, {
    method: 'POST',
    body: JSON.stringify({ credits, note }),
  }),
  listProducts: () => request('/api/platform/admin/products'),
  saveProduct: (product) => request('/api/platform/admin/products', {
    method: 'POST',
    body: JSON.stringify(product),
  }),
  deleteProduct: (id) => request(`/api/platform/admin/products/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  loadAgentModels: async () => {
    const result = readAgentModelList(await request<AgentModelList | PlatformAgentModel[]>('/api/platform/agent-models'))
    set({ agentModels: result.models, defaultAgentModel: result.defaultModel })
    return result.models
  },
  listAgentModels: async () => {
    const result = readAgentModelList(await request<AgentModelList | PlatformAgentModel[]>('/api/platform/admin/agent-models'))
    return result.models
  },
  refreshAgentModels: async () => {
    const result = readAgentModelList(await request<AgentModelList | PlatformAgentModel[]>('/api/platform/admin/agent-models/refresh', {
      method: 'POST',
    }))
    await get().loadAgentModels()
    return result.models
  },
  saveAgentModel: async (id, changes) => {
    const model = await request<PlatformAgentModel>(`/api/platform/admin/agent-models/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    })
    await get().loadAgentModels()
    return model
  },
  redeemCode: (code) => request('/api/platform/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  listRedemptionCodes: (unusedOnly) => request(`/api/platform/admin/redemption-codes${unusedOnly ? '?unused=1' : ''}`),
  createRedemptionCodes: (input) => request('/api/platform/admin/redemption-codes', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
  logout: async () => {
    try {
      await request('/api/platform/auth/logout', { method: 'POST' })
    } finally {
      clearActiveStorageUser()
      notifySessionChanged()
      window.location.reload()
    }
  },
}))
