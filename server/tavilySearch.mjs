const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
const DEFAULT_TIMEOUT_MS = 15000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_BYTES = 20 * 1024
const MAX_QUERY_LENGTH = 500
const MAX_SNIPPET_LENGTH = 1200
const MAX_TITLE_LENGTH = 300
const MAX_URL_LENGTH = 2048
const ALLOWED_TOPICS = new Set(['general', 'news', 'finance'])
const ALLOWED_TIME_RANGES = new Set(['none', 'day', 'week', 'month', 'year'])
const SAFE_ERROR_MESSAGES = {
  INVALID_SEARCH_INPUT: '搜索参数格式无效',
  INVALID_SEARCH_QUERY: '搜索关键词格式无效',
  INVALID_SEARCH_TOPIC: '搜索主题无效',
  INVALID_SEARCH_TIME_RANGE: '搜索时间范围无效',
  SEARCH_NOT_CONFIGURED: '搜索服务尚未配置',
  SEARCH_CANCELLED: '搜索请求已取消',
  SEARCH_TIMEOUT: '搜索服务响应超时',
  SEARCH_INVALID_REQUEST: '搜索请求无效',
  SEARCH_AUTH_FAILED: '搜索服务认证失败',
  SEARCH_RATE_LIMITED: '搜索服务请求过于频繁，请稍后重试',
  SEARCH_QUOTA_EXHAUSTED: '搜索服务额度不足',
  SEARCH_UPSTREAM_UNAVAILABLE: '搜索服务暂时不可用',
  SEARCH_UPSTREAM_FAILED: '搜索服务请求失败',
  SEARCH_RESPONSE_TOO_LARGE: '搜索服务响应过大',
  INVALID_SEARCH_RESPONSE: '搜索服务响应格式无效',
  SEARCH_OUTPUT_TOO_LARGE: '搜索结果过大',
  SEARCH_FAILED: '搜索服务请求失败',
}

export class TavilySearchError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'TavilySearchError'
    this.code = code
    this.status = options.status || 500
    this.retryable = Boolean(options.retryable)
    if (options.retryAfterSeconds) this.retryAfterSeconds = options.retryAfterSeconds
  }
}

function createError(code, message, status = 500, retryable = false, retryAfterSeconds) {
  return new TavilySearchError(code, message, { status, retryable, retryAfterSeconds })
}

function truncateText(value, maxLength) {
  return Array.from(String(value || '').trim()).slice(0, maxLength).join('')
}

function parseRetryAfter(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.min(3600, Math.ceil(seconds))
}

function normalizeResultUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    const normalized = url.toString()
    return normalized.length <= MAX_URL_LENGTH ? normalized : null
  } catch {
    return null
  }
}

function getOutputSize(value) {
  return Buffer.byteLength(JSON.stringify(value))
}

function fitOutput(output) {
  while (getOutputSize(output) > MAX_OUTPUT_BYTES) {
    const snippets = output.results.map((item) => Array.from(item.snippet))
    const longest = snippets.reduce((best, chars, index) => chars.length > snippets[best].length ? index : best, 0)
    if (snippets[longest]?.length) {
      output.results[longest].snippet = snippets[longest].slice(0, Math.max(0, snippets[longest].length - 100)).join('')
      continue
    }
    if (output.results.length) {
      output.results.pop()
      continue
    }
    throw createError('SEARCH_OUTPUT_TOO_LARGE', '搜索结果过大', 502)
  }
  return output
}

async function readResponseBody(response) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw createError('SEARCH_RESPONSE_TOO_LARGE', '搜索服务响应过大', 502)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw createError('SEARCH_RESPONSE_TOO_LARGE', '搜索服务响应过大', 502)
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function getUpstreamError(response) {
  if (response.status === 400) return createError('SEARCH_INVALID_REQUEST', '搜索请求无效', 400)
  if (response.status === 401 || response.status === 403) return createError('SEARCH_AUTH_FAILED', '搜索服务认证失败', 503)
  if (response.status === 429) {
    return createError(
      'SEARCH_RATE_LIMITED',
      '搜索服务请求过于频繁，请稍后重试',
      429,
      true,
      parseRetryAfter(response.headers.get('retry-after')),
    )
  }
  if (response.status === 432 || response.status === 433) return createError('SEARCH_QUOTA_EXHAUSTED', '搜索服务额度不足', 503)
  if (response.status >= 500) return createError('SEARCH_UPSTREAM_UNAVAILABLE', '搜索服务暂时不可用', 502, true)
  return createError('SEARCH_UPSTREAM_FAILED', '搜索服务请求失败', 502)
}

export function validateSearchWebInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError('INVALID_SEARCH_INPUT', '搜索参数格式无效', 400)
  }
  const keys = Object.keys(input)
  if (keys.length !== 3 || !keys.includes('query') || !keys.includes('topic') || !keys.includes('time_range')) {
    throw createError('INVALID_SEARCH_INPUT', '搜索参数必须仅包含 query、topic 和 time_range', 400)
  }
  if (typeof input.query !== 'string') throw createError('INVALID_SEARCH_QUERY', '搜索关键词格式无效', 400)
  const query = input.query.trim()
  if (!query || Array.from(query).length > MAX_QUERY_LENGTH) {
    throw createError('INVALID_SEARCH_QUERY', `搜索关键词长度需要在 1 至 ${MAX_QUERY_LENGTH} 个字符之间`, 400)
  }
  if (!ALLOWED_TOPICS.has(input.topic)) throw createError('INVALID_SEARCH_TOPIC', '搜索主题无效', 400)
  if (!ALLOWED_TIME_RANGES.has(input.time_range)) throw createError('INVALID_SEARCH_TIME_RANGE', '搜索时间范围无效', 400)
  return { query, topic: input.topic, time_range: input.time_range }
}

export function toSearchWebError(err) {
  const error = err instanceof TavilySearchError
    ? err
    : createError('SEARCH_FAILED', '搜索服务请求失败', 500, true)
  const message = SAFE_ERROR_MESSAGES[error.code] || SAFE_ERROR_MESSAGES.SEARCH_FAILED
  return {
    ok: false,
    error: {
      code: error.code,
      message,
      retryable: error.retryable,
      ...(error.retryAfterSeconds ? { retry_after_seconds: error.retryAfterSeconds } : {}),
    },
  }
}

export async function callTavilySearch(input, options = {}) {
  const normalized = validateSearchWebInput(input)
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : ''
  if (!apiKey) throw createError('SEARCH_NOT_CONFIGURED', '搜索服务尚未配置', 503)

  const fetchImpl = options.fetch || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw createError('SEARCH_NOT_CONFIGURED', '搜索服务尚未配置', 503)
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromCaller = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const body = {
      query: normalized.query,
      topic: normalized.topic,
      ...(normalized.time_range === 'none' ? {} : { time_range: normalized.time_range }),
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
      include_usage: true,
    }
    let response
    try {
      response = await fetchImpl(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) {
        if (options.signal?.aborted) throw createError('SEARCH_CANCELLED', '搜索请求已取消', 499)
        throw createError('SEARCH_TIMEOUT', '搜索服务响应超时', 504, true)
      }
      throw createError('SEARCH_UPSTREAM_UNAVAILABLE', '无法连接搜索服务', 502, true)
    }

    let rawBody
    try {
      rawBody = await readResponseBody(response)
    } catch (err) {
      if (err instanceof TavilySearchError) throw err
      if (controller.signal.aborted) {
        if (options.signal?.aborted) throw createError('SEARCH_CANCELLED', '搜索请求已取消', 499)
        throw createError('SEARCH_TIMEOUT', '搜索服务响应超时', 504, true)
      }
      throw createError('SEARCH_UPSTREAM_UNAVAILABLE', '搜索服务暂时不可用', 502, true)
    }
    if (!response.ok) throw getUpstreamError(response)

    let payload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      throw createError('INVALID_SEARCH_RESPONSE', '搜索服务响应无法解析', 502)
    }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) {
      throw createError('INVALID_SEARCH_RESPONSE', '搜索服务响应格式无效', 502)
    }

    const results = payload.results.slice(0, 5).flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const url = normalizeResultUrl(item.url)
      if (!url) return []
      const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : undefined
      return [{
        title: truncateText(item.title, MAX_TITLE_LENGTH) || truncateText(url, MAX_TITLE_LENGTH),
        url,
        snippet: truncateText(item.content, MAX_SNIPPET_LENGTH),
        ...(score === undefined ? {} : { score }),
      }]
    })
    const credits = Number(payload.usage?.credits)
    const output = {
      ok: true,
      query: normalized.query,
      results,
      ...(typeof payload.request_id === 'string' && payload.request_id.trim()
        ? { request_id: truncateText(payload.request_id, 128) }
        : {}),
      ...(Number.isFinite(credits) && credits >= 0 ? { usage: { credits } } : {}),
    }
    return fitOutput(output)
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
