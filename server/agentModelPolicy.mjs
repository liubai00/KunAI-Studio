const DEFAULT_TIMEOUT_MS = 10000

export const AGENT_MODEL_CATALOG_TTL_MS = 10 * 60 * 1000
export const AGENT_MODEL_CATALOG_MAX_BYTES = 1024 * 1024

export class AgentModelPolicyError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'AgentModelPolicyError'
    this.code = code
  }
}

export function isValidAgentModelId(value) {
  if (typeof value !== 'string' || value !== value.trim()) return false
  if (!/^gpt-[A-Za-z0-9][A-Za-z0-9._:/-]{0,251}$/i.test(value)) return false
  return !/(?:^|[-_.:/])image(?:$|[-_.:/])/i.test(value)
}

export function parseAgentModelCatalog(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    throw new AgentModelPolicyError('上游模型目录响应格式无效', 'INVALID_MODEL_CATALOG')
  }

  const ids = new Set()
  for (const item of payload.data) {
    if (!item || typeof item !== 'object' || !isValidAgentModelId(item.id)) continue
    if (item.supported_endpoint_types !== undefined) {
      if (!Array.isArray(item.supported_endpoint_types)) continue
      const supportsOpenAI = item.supported_endpoint_types.some((type) =>
        typeof type === 'string' && type.toLowerCase() === 'openai',
      )
      if (!supportsOpenAI) continue
    }
    ids.add(item.id)
  }

  return [...ids].sort((a, b) => {
    const normalizedA = a.toLowerCase()
    const normalizedB = b.toLowerCase()
    if (normalizedA < normalizedB) return -1
    if (normalizedA > normalizedB) return 1
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })
}

export function selectAllowedAgentModel(requested, allowedModels, fallback) {
  const allowed = new Set(Array.isArray(allowedModels) ? allowedModels.filter(isValidAgentModelId) : [])
  if (!isValidAgentModelId(fallback) || !allowed.has(fallback)) {
    throw new AgentModelPolicyError('Agent 默认模型配置无效', 'INVALID_AGENT_MODEL_POLICY')
  }

  if (requested === undefined || requested === null || requested === '') return fallback
  if (!isValidAgentModelId(requested) || !allowed.has(requested)) {
    throw new AgentModelPolicyError('请求的 Agent 模型未获授权', 'AGENT_MODEL_NOT_ALLOWED')
  }
  return requested
}

function buildModelsUrl(baseUrl) {
  const value = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  if (!value) throw new AgentModelPolicyError('上游模型目录尚未配置', 'MODEL_CATALOG_NOT_CONFIGURED')
  try {
    return new URL('models', `${value.replace(/\/+$/, '')}/`)
  } catch {
    throw new AgentModelPolicyError('上游模型目录地址无效', 'INVALID_MODEL_CATALOG_URL')
  }
}

async function readResponseBody(response, controller) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > AGENT_MODEL_CATALOG_MAX_BYTES) {
    controller.abort()
    throw new AgentModelPolicyError('上游模型目录响应过大', 'MODEL_CATALOG_TOO_LARGE')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    size += result.value.byteLength
    if (size > AGENT_MODEL_CATALOG_MAX_BYTES) {
      controller.abort()
      try {
        await reader.cancel()
      } catch {
        // 响应已中止，无需覆盖原始的大小错误。
      }
      throw new AgentModelPolicyError('上游模型目录响应过大', 'MODEL_CATALOG_TOO_LARGE')
    }
    chunks.push(result.value)
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export async function discoverAgentModels(options = {}) {
  const fetcher = options.fetch || globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new AgentModelPolicyError('当前环境不支持上游模型发现', 'MODEL_DISCOVERY_UNAVAILABLE')
  }
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey : ''
  if (!apiKey) throw new AgentModelPolicyError('上游模型目录尚未配置', 'MODEL_CATALOG_NOT_CONFIGURED')

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetcher(buildModelsUrl(options.baseUrl), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new AgentModelPolicyError(`上游模型目录请求失败（HTTP ${response.status}）`, 'MODEL_DISCOVERY_HTTP_ERROR')
    }

    const body = await readResponseBody(response, controller)
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      throw new AgentModelPolicyError('上游模型目录响应无法解析', 'INVALID_MODEL_CATALOG')
    }
    return parseAgentModelCatalog(payload)
  } catch (err) {
    if (timedOut) throw new AgentModelPolicyError('上游模型目录请求超时', 'MODEL_DISCOVERY_TIMEOUT')
    if (err instanceof AgentModelPolicyError) throw err
    throw new AgentModelPolicyError('无法获取上游模型目录', 'MODEL_DISCOVERY_FAILED')
  } finally {
    clearTimeout(timeoutId)
  }
}

export class AgentModelCatalog {
  constructor(options = {}) {
    this.options = { ...options }
    this.ttlMs = Number(options.ttlMs) >= 0 ? Number(options.ttlMs) : AGENT_MODEL_CATALOG_TTL_MS
    this.now = options.now || (() => Date.now())
    this.models = []
    this.refreshedAt = null
    this.expiresAt = 0
    this.lastError = null
    this.hasSnapshot = false
    this.refreshPromise = null
  }

  snapshot() {
    return {
      models: [...this.models],
      refreshedAt: this.refreshedAt,
      stale: Boolean(this.lastError),
      ...(this.lastError ? { error: this.lastError.message } : {}),
    }
  }

  async get(options = {}) {
    if (!options.force && this.hasSnapshot && this.now() < this.expiresAt) return this.snapshot()
    return this.refresh()
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.load()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  async load() {
    try {
      const models = await discoverAgentModels(this.options)
      const now = this.now()
      this.models = models
      this.refreshedAt = now
      this.expiresAt = now + this.ttlMs
      this.lastError = null
      this.hasSnapshot = true
      return this.snapshot()
    } catch (err) {
      if (!this.hasSnapshot) throw err
      this.lastError = err instanceof AgentModelPolicyError
        ? err
        : new AgentModelPolicyError('无法获取上游模型目录', 'MODEL_DISCOVERY_FAILED')
      this.expiresAt = this.now() + this.ttlMs
      return this.snapshot()
    }
  }
}
