import { create } from 'zustand'
import { getPlatformCsrfToken } from './lib/platformSession'
import { clearActiveStorageUser, setActiveStorageUser } from './lib/userStorage'

export const PLATFORM_SESSION_EVENT_KEY = 'image-studio-platform-session-event'

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
  request_count: number
  image_studio_capabilities: {
    generation: boolean
    agent: boolean
    admin?: boolean
  }
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
    generation_min_role: number
    agent_min_role: number
    relay_configured?: boolean
    image_models?: string[]
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

export interface PlatformBilling extends PlatformUser {
  payment_url?: string
  image_unit_price: number
  entries: PlatformLedgerEntry[]
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
  loadBilling: () => request('/api/platform/billing'),
  listUsers: (search = '') => request(`/api/platform/admin/users?search=${encodeURIComponent(search)}`),
  updateUserAccess: (id, changes) => request(`/api/platform/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  }),
  adjustUserBalance: (id, amount, note) => request(`/api/platform/admin/users/${id}/balance`, {
    method: 'POST',
    body: JSON.stringify({ amount, note }),
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
