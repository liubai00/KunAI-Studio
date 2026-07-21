import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, statfs, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import { getSessionToken, parseCookies } from './platformAuth.mjs'

const MAX_JSON_BODY_BYTES = 1024 * 1024
const MAX_AGENT_RESULT_BYTES = 2 * 1024 * 1024 - 16 * 1024
const ALLOWED_AGENT_FUNCTIONS = new Set(['generate_image', 'generate_image_batch', 'continue_generation', 'search_web'])
const ALLOWED_AGENT_REQUEST_FIELDS = new Set(['model', 'instructions', 'input', 'tools', 'stream', 'max_output_tokens'])
const ALLOWED_RELAY_PATHS = new Set([
  'images/generations',
  'images/edits',
  'responses',
])

export { parseCookies }

export function createHttpError(message, status = 400, code) {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

export function isAllowedRelayPath(path) {
  return ALLOWED_RELAY_PATHS.has(path.replace(/^\/+/, '').replace(/\/+$/, ''))
}

export function isSameOriginRequest(req, expectedOrigin = '') {
  const fetchSite = String(req.headers['sec-fetch-site'] || '')
  if (fetchSite && fetchSite !== 'same-origin') return false

  const source = req.headers.origin || req.headers.referer
  if (expectedOrigin) {
    if (!source) return false
    try {
      return new URL(source).origin === new URL(expectedOrigin).origin
    } catch {
      return false
    }
  }

  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  if (!host) return false
  if (!source) return fetchSite === 'same-origin'
  try {
    return new URL(source).origin === `${proto}://${host}`
  } catch {
    return false
  }
}

export async function readRequestBody(req, maxBytes) {
  const contentLength = Number(req.headers['content-length'] || 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw createHttpError('请求内容过大', 413, 'BODY_TOO_LARGE')
  }

  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw createHttpError('请求内容过大', 413, 'BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)
}

export async function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const body = await readRequestBody(req, maxBytes)
  if (!body.length) return {}
  try {
    const payload = JSON.parse(body.toString('utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error()
    return payload
  } catch {
    throw createHttpError('请求 JSON 无效', 400, 'INVALID_JSON')
  }
}

function getRequestedImageSpec(size) {
  const value = String(size || '').trim()
  if (!value || value === 'auto') return null
  const match = value.match(/^(\d+)x(\d+)$/i)
  if (!match) throw createHttpError('图片尺寸格式无效', 400, 'INVALID_IMAGE_SIZE')
  const width = Number(match[1])
  const height = Number(match[2])
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || width <= 0 || height <= 0 || pixels > 8294400) {
    throw createHttpError('图片尺寸超出支持范围', 400, 'INVALID_IMAGE_SIZE')
  }
  const tier = pixels <= 1572864 ? '1k' : pixels <= 4194304 ? '2k' : '4k'
  return { width, height, tier }
}

export function getRequestedImageTier(size) {
  return getRequestedImageSpec(size)?.tier ?? '1k'
}

export function selectImageModel(size, models = {}, fallback = 'gpt-image-2') {
  const tier = getRequestedImageTier(size)
  if (tier === '1k') return models['1k'] || fallback
  if (tier === '2k') return models['2k'] || models['1k'] || fallback
  return models['4k'] || models['2k'] || models['1k'] || fallback
}

export async function normalizeRelayRequest(path, contentType, body, options = {}) {
  const normalizedPath = path.replace(/^\/+/, '').replace(/\/+$/, '')
  const imageModel = options.imageModel || 'gpt-image-2'
  const imageModels = options.imageModels || {}
  const agentModel = options.agentModel || ''

  if (normalizedPath === 'images/edits') {
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      throw createHttpError('图片编辑请求必须使用 multipart/form-data', 415, 'INVALID_CONTENT_TYPE')
    }
    let formData
    try {
      formData = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
    } catch {
      throw createHttpError('无法解析图片编辑请求', 400, 'INVALID_MULTIPART')
    }
    const requestedImageSize = getRequestedImageSpec(formData.get('size'))
    const requestedImageTier = requestedImageSize?.tier ?? '1k'
    formData.set('model', selectImageModel(formData.get('size'), imageModels, imageModel))
    formData.set('n', '1')
    formData.set('stream', 'false')
    formData.set('response_format', 'b64_json')
    formData.delete('partial_images')
    return { body: formData, requestedImageTier, requestedImageSize }
  }

  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw createHttpError('该接口仅接受 application/json', 415, 'INVALID_CONTENT_TYPE')
  }

  let payload
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    throw createHttpError('请求 JSON 无效', 400, 'INVALID_JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError('请求 JSON 必须是对象', 400, 'INVALID_JSON')
  }

  if (normalizedPath === 'responses') {
    const invalidField = Object.keys(payload).find((key) => !ALLOWED_AGENT_REQUEST_FIELDS.has(key))
    if (invalidField) throw createHttpError('Agent 请求包含未授权参数', 403, 'UNAUTHORIZED_AGENT_FIELD')
    const tools = Array.isArray(payload.tools) ? payload.tools : []
    const invalidTool = tools.find((tool) => {
      if (!tool || typeof tool !== 'object') return true
      if (tool.type !== 'function') return true
      return !ALLOWED_AGENT_FUNCTIONS.has(String(tool.name || ''))
    })
    if (invalidTool) throw createHttpError('Agent 请求包含未授权工具', 403, 'UNAUTHORIZED_TOOL')
    const requestedModel = String(payload.model || agentModel).trim()
    if (!requestedModel) throw createHttpError('Agent 模型不能为空', 400, 'AGENT_MODEL_REQUIRED')
    payload.model = requestedModel
    const requestHashBody = Buffer.from(JSON.stringify(payload))
    payload.stream = false
    payload.store = false
    const maxOutputTokens = Math.trunc(Number(payload.max_output_tokens) || Number(options.agentMaxOutputTokens) || 4096)
    payload.max_output_tokens = Math.max(1, Math.min(maxOutputTokens, Number(options.agentMaxOutputTokens) || 4096))
    return {
      body: Buffer.from(JSON.stringify(payload)),
      contentType: 'application/json',
      requestHashBody,
    }
  } else {
    const requestedImageSize = getRequestedImageSpec(payload.size)
    const requestedImageTier = requestedImageSize?.tier ?? '1k'
    payload.model = selectImageModel(payload.size, imageModels, imageModel)
    payload.n = 1
    payload.stream = false
    payload.response_format = 'b64_json'
    delete payload.partial_images
    return {
      body: Buffer.from(JSON.stringify(payload)),
      contentType: 'application/json',
      requestedImageTier,
      requestedImageSize,
    }
  }
}

function copyResponseHeaders(upstream, res) {
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase()
    if (['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(lower)) continue
    res.setHeader(key, value)
  }
  res.setHeader('Cache-Control', 'no-store')
}

export async function sendUpstreamResponse(upstream, res) {
  res.statusCode = upstream.status
  copyResponseHeaders(upstream, res)
  if (!upstream.body) {
    res.end()
    return
  }
  await pipeline(Readable.fromWeb(upstream.body), res)
}

async function readUpstreamBody(upstream, maxBytes) {
  if (!upstream.body) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  for await (const chunk of Readable.fromWeb(upstream.body)) {
    size += chunk.length
    if (size > maxBytes) throw createHttpError('上游图片响应过大', 502, 'UPSTREAM_BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function getSafeTokenCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function parseAgentResponseUsage(payload) {
  const usage = payload?.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null
  const inputTokens = getSafeTokenCount(usage.input_tokens)
  const outputTokens = getSafeTokenCount(usage.output_tokens)
  if (inputTokens == null || outputTokens == null) return null
  const cachedValue = usage.input_tokens_details?.cached_tokens
  const cachedInputTokens = cachedValue === undefined ? 0 : getSafeTokenCount(cachedValue)
  if (cachedInputTokens == null || cachedInputTokens > inputTokens) return null
  return { inputTokens, cachedInputTokens, outputTokens }
}

export function calculateAgentChargeMicros(model, usage) {
  const inputRate = getSafeTokenCount(model?.inputTokenPriceMicros ?? model?.inputPriceMicros ?? model?.input_price_micros) ?? 0
  const cachedRate = getSafeTokenCount(model?.cachedInputTokenPriceMicros ?? model?.cachedInputPriceMicros ?? model?.cached_input_price_micros) ?? 0
  const outputRate = getSafeTokenCount(model?.outputTokenPriceMicros ?? model?.outputPriceMicros ?? model?.output_price_micros) ?? 0
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  const price = (tokens, rate) => tokens > 0 && rate > 0 ? Math.ceil(tokens * rate / 1000000) : 0
  return price(uncachedInputTokens, inputRate) + price(usage.cachedInputTokens, cachedRate) + price(usage.outputTokens, outputRate)
}

export function calculateAgentRequestReserveMicros(model, inputBytes, maxOutputTokens, inputTokenOverhead = 0) {
  const byteCount = Math.trunc(Number(inputBytes))
  const outputCount = Math.trunc(Number(maxOutputTokens))
  const overheadCount = Math.trunc(Number(inputTokenOverhead))
  if (!Number.isSafeInteger(byteCount) || byteCount < 0 || !Number.isSafeInteger(outputCount) || outputCount < 0 || !Number.isSafeInteger(overheadCount) || overheadCount < 0) {
    throw createHttpError('Agent 请求大小或输出上限无效', 400, 'INVALID_AGENT_LIMIT')
  }
  const inputTokenBound = byteCount + overheadCount
  if (!Number.isSafeInteger(inputTokenBound)) throw createHttpError('Agent 请求超出计费范围', 413, 'AGENT_CONTEXT_TOO_LARGE')
  const inputRate = Math.max(
    getSafeTokenCount(model?.inputTokenPriceMicros ?? model?.inputPriceMicros ?? model?.input_price_micros) ?? 0,
    getSafeTokenCount(model?.cachedInputTokenPriceMicros ?? model?.cachedInputPriceMicros ?? model?.cached_input_price_micros) ?? 0,
  )
  const outputRate = getSafeTokenCount(model?.outputTokenPriceMicros ?? model?.outputPriceMicros ?? model?.output_price_micros) ?? 0
  const reserve = (BigInt(inputTokenBound) * BigInt(inputRate) + 999999n) / 1000000n
    + (BigInt(outputCount) * BigInt(outputRate) + 999999n) / 1000000n
  if (reserve > BigInt(Number.MAX_SAFE_INTEGER)) throw createHttpError('Agent 请求超出计费范围', 413, 'AGENT_CONTEXT_TOO_LARGE')
  return Number(reserve)
}

function parseAgentResponseBody(body) {
  try {
    const payload = JSON.parse(body.toString('utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    return payload
  } catch {
    return null
  }
}

function getRequiredAgentHeader(req, name, code) {
  const value = String(req.headers[name] || '').trim()
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw createHttpError(`Agent 请求缺少有效的 ${name}`, 400, code)
  return value
}

export async function normalizeSuccessfulImageResponse(body, maxImagePixels, requestedImageSize = null) {
  let payload
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    throw createHttpError('上游返回的图片响应无法解析', 502, 'INVALID_UPSTREAM_RESPONSE')
  }
  const items = Array.isArray(payload?.data) ? payload.data : []
  let tierMismatch = null
  for (const item of items.slice(0, 4)) {
    if (!item || typeof item !== 'object' || typeof item.b64_json !== 'string') continue
    const value = item.b64_json.replace(/\s/g, '')
    if (value.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) continue
    const image = Buffer.from(value, 'base64')
    try {
      const decoder = sharp(image, { failOn: 'error', limitInputPixels: maxImagePixels, sequentialRead: true })
      const metadata = await decoder.metadata()
      if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format || '')) continue
      const expectedWidth = Number(requestedImageSize?.width) || 0
      const expectedHeight = Number(requestedImageSize?.height) || 0
      const expectedAspectRatio = expectedWidth > 0 && expectedHeight > 0 ? expectedWidth / expectedHeight : 0
      const actualAspectRatio = metadata.width / metadata.height
      const belowRequestedSize = expectedWidth > 0 && expectedHeight > 0 && (
        metadata.width < Math.floor(expectedWidth * 0.9) ||
        metadata.height < Math.floor(expectedHeight * 0.9) ||
        Math.abs(actualAspectRatio / expectedAspectRatio - 1) > 0.12
      )
      if (belowRequestedSize) {
        tierMismatch = {
          actualWidth: metadata.width,
          actualHeight: metadata.height,
          expectedWidth,
          expectedHeight,
        }
        continue
      }
      await decoder.raw().toBuffer()
      return Buffer.from(JSON.stringify({ ...payload, data: [{ ...item, b64_json: value }] }))
    } catch {
      continue
    }
  }
  if (tierMismatch) {
    throw createHttpError(
      `上游返回 ${tierMismatch.actualWidth}x${tierMismatch.actualHeight}，低于请求尺寸 ${tierMismatch.expectedWidth}x${tierMismatch.expectedHeight}，本次不扣费`,
      502,
      'UPSTREAM_IMAGE_TIER_MISMATCH',
    )
  }
  throw createHttpError('上游未返回可解码的完整图片，本次不扣费', 502, 'EMPTY_IMAGE_RESULT')
}

export async function hashNormalizedRelayRequest(path, normalized) {
  const hash = createHash('sha256').update(path).update('\0')
  if (Buffer.isBuffer(normalized.body)) return hash.update(normalized.body).digest('hex')

  let fileIndex = 0
  for (const [key, value] of normalized.body.entries()) {
    hash.update(key).update('\0')
    if (typeof value === 'string') {
      hash.update('text\0').update(value).update('\0')
      continue
    }
    hash.update('file\0')
      .update(String(fileIndex++))
      .update('\0')
      .update(String(value.name || ''))
      .update('\0')
      .update(String(value.type || ''))
      .update('\0')
      .update(Buffer.from(await value.arrayBuffer()))
      .update('\0')
  }
  return hash.digest('hex')
}

function sendBufferedResponse(res, status, contentType, body, headers) {
  res.statusCode = status
  if (headers) {
    for (const [key, value] of headers) {
      const lower = key.toLowerCase()
      if (['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'content-type'].includes(lower)) continue
      res.setHeader(key, value)
    }
  }
  res.setHeader('Content-Type', contentType || 'application/json; charset=utf-8')
  res.setHeader('Content-Length', body.length)
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

export class PlatformGateway {
  constructor(options = {}) {
    this.imageBaseUrl = options.imageBaseUrl || options.baseUrl ? new URL(options.imageBaseUrl || options.baseUrl) : null
    this.imageApiKey = String(options.imageApiKey || options.apiKey || '')
    this.agentBaseUrl = options.agentBaseUrl ? new URL(options.agentBaseUrl) : this.imageBaseUrl
    this.agentApiKey = String(options.agentApiKey || (options.agentBaseUrl ? '' : this.imageApiKey))
    this.baseUrl = this.imageBaseUrl
    this.apiKey = this.imageApiKey
    this.db = options.db
    this.expectedOrigin = String(options.expectedOrigin || '')
    this.generationMinRole = Number.isFinite(Number(options.generationMinRole)) ? Number(options.generationMinRole) : 1
    this.agentMinRole = Number.isFinite(Number(options.agentMinRole)) ? Number(options.agentMinRole) : this.generationMinRole
    this.allowedGroups = new Set(options.allowedGroups || [])
    this.imageModel = options.imageModel || 'gpt-image-2'
    this.imageModels = options.imageModels || {}
    this.agentModel = options.agentModel || 'gpt-5.5'
    this.agentMaxOutputTokens = Number(options.agentMaxOutputTokens) > 0 ? Math.trunc(Number(options.agentMaxOutputTokens)) : 4096
    this.agentInputTokenOverhead = Number(options.agentInputTokenOverhead) >= 0 ? Math.trunc(Number(options.agentInputTokenOverhead)) : 8192
    this.agentRoundStepLimit = Number(options.agentRoundStepLimit) > 0 ? Math.trunc(Number(options.agentRoundStepLimit)) : 16
    this.imagePriceMicros = Math.max(0, Number(options.imagePriceMicros) || 0)
    this.resultDir = resolve(options.resultDir || join('data', 'results'))
    this.maxImagePixels = Number(options.maxImagePixels) > 0 ? Number(options.maxImagePixels) : 40 * 1000 * 1000
    this.minResultFreeBytes = Number(options.minResultFreeBytes) > 0 ? Number(options.minResultFreeBytes) : 512 * 1024 * 1024
    this.secureCookies = Boolean(options.secureCookies)
    this.trustProxy = Boolean(options.trustProxy)
    this.maxRelayBodyBytes = Number(options.maxRelayBodyBytes) > 0 ? Number(options.maxRelayBodyBytes) : 128 * 1024 * 1024
    this.maxAgentBodyBytes = Number(options.maxAgentBodyBytes) > 0 ? Number(options.maxAgentBodyBytes) : 4 * 1024 * 1024
    this.maxUpstreamBodyBytes = Number(options.maxUpstreamBodyBytes) > 0 ? Number(options.maxUpstreamBodyBytes) : 128 * 1024 * 1024
    this.maxConcurrentRelays = Number(options.maxConcurrentRelays) > 0 ? Number(options.maxConcurrentRelays) : 24
    this.maxQueuedRelaysPerUser = Number(options.maxQueuedRelaysPerUser) > 0 ? Number(options.maxQueuedRelaysPerUser) : 8
    this.queueTimeoutMs = Number(options.queueTimeoutMs) > 0 ? Number(options.queueTimeoutMs) : 10 * 60 * 1000
    this.relayTimeoutMs = Number(options.relayTimeoutMs) > 0 ? Number(options.relayTimeoutMs) : 10 * 60 * 1000
    this.fetch = options.fetch || globalThis.fetch
    this.activeRelays = 0
    this.relayQueues = new Map()
    this.queuedRelaysByUser = new Map()
    this.usageBlockedModels = new Set()
  }

  buildUrl(path) {
    const normalizedPath = path.replace(/^\/+/, '')
    const baseUrl = normalizedPath === 'responses' ? this.agentBaseUrl : this.imageBaseUrl
    if (!baseUrl) throw createHttpError('尚未配置第三方中转接口', 503, 'RELAY_NOT_CONFIGURED')
    return new URL(normalizedPath, `${baseUrl.toString().replace(/\/+$/, '')}/`)
  }

  getClientIp(req) {
    if (this.trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      if (forwarded) return forwarded
      const realIp = String(req.headers['x-real-ip'] || '').trim()
      if (realIp) return realIp
    }
    return req.socket?.remoteAddress || ''
  }

  getSession(req) {
    const session = this.db.getSession(getSessionToken(req, this.secureCookies))
    if (!session) throw createHttpError('登录状态已失效', 401, 'SESSION_EXPIRED')
    return session
  }

  getCapabilities(user) {
    const groupAllowed = this.allowedGroups.size === 0 || this.allowedGroups.has(String(user.group))
    return {
      generation: Boolean(this.imageBaseUrl) && groupAllowed && Number(user.status) === 1 && Number(user.role) >= this.generationMinRole,
      agent: Boolean(this.agentBaseUrl) && groupAllowed && Number(user.status) === 1 && Number(user.role) >= this.agentMinRole,
      admin: Number(user.status) === 1 && Number(user.role) >= 10,
    }
  }

  authorizeRelay(user, path) {
    const capability = path === 'responses' ? 'agent' : 'generation'
    if (!this.getCapabilities(user)[capability]) {
      throw createHttpError('当前账户没有使用该功能的权限', 403, 'FORBIDDEN')
    }
  }

  assertCsrf(req) {
    const sessionToken = getSessionToken(req, this.secureCookies)
    if (!this.db.verifyCsrf(sessionToken, req.headers['x-csrf-token'])) {
      throw createHttpError('安全校验已失效，请刷新页面后重试', 403, 'CSRF_INVALID')
    }
  }

  async acquireRelay(userId, signal) {
    const queuedCount = this.queuedRelaysByUser.get(userId) || 0
    if (queuedCount >= this.maxQueuedRelaysPerUser) throw createHttpError('当前账户排队任务较多，请稍后重试', 429, 'QUEUE_FULL')

    let releaseTurn
    const turn = new Promise((resolvePromise) => {
      releaseTurn = resolvePromise
    })
    const previous = this.relayQueues.get(userId) || Promise.resolve()
    const chain = previous.then(() => turn)
    this.relayQueues.set(userId, chain)
    this.queuedRelaysByUser.set(userId, queuedCount + 1)

    let abortWait = () => {}
    const aborted = new Promise((_, reject) => {
      abortWait = () => reject(createHttpError('请求已取消', 499, 'REQUEST_ABORTED'))
      if (signal?.aborted) abortWait()
      else signal?.addEventListener('abort', abortWait, { once: true })
    })
    try {
      await Promise.race([previous, aborted])
    } catch (err) {
      releaseTurn()
      if (this.relayQueues.get(userId) === chain) this.relayQueues.delete(userId)
      throw err
    } finally {
      signal?.removeEventListener('abort', abortWait)
      const nextCount = (this.queuedRelaysByUser.get(userId) || 1) - 1
      if (nextCount > 0) this.queuedRelaysByUser.set(userId, nextCount)
      else this.queuedRelaysByUser.delete(userId)
    }

    if (signal?.aborted) {
      releaseTurn()
      if (this.relayQueues.get(userId) === chain) this.relayQueues.delete(userId)
      throw createHttpError('请求已取消', 499, 'REQUEST_ABORTED')
    }
    if (this.activeRelays >= this.maxConcurrentRelays) {
      releaseTurn()
      if (this.relayQueues.get(userId) === chain) this.relayQueues.delete(userId)
      throw createHttpError('当前生成任务较多，请稍后重试', 429, 'GLOBAL_QUEUE_FULL')
    }

    this.activeRelays += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeRelays = Math.max(0, this.activeRelays - 1)
      releaseTurn()
      if (this.relayQueues.get(userId) === chain) this.relayQueues.delete(userId)
    }
  }

  async ensureResultCapacity() {
    await mkdir(this.resultDir, { recursive: true })
    const stats = await statfs(this.resultDir)
    const available = BigInt(stats.bavail) * BigInt(stats.bsize)
    if (available < BigInt(this.minResultFreeBytes)) {
      throw createHttpError('结果存储空间不足，请稍后重试', 507, 'RESULT_STORAGE_FULL')
    }
  }

  async writeResult(jobId, body) {
    await this.ensureResultCapacity()
    const filename = `${jobId}.json`
    const target = join(this.resultDir, filename)
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`
    const file = await open(temp, 'wx')
    let renamed = false
    try {
      try {
        await file.writeFile(body)
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temp, target)
      renamed = true
      try {
        const directory = await open(this.resultDir, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      } catch (err) {
        const unsupportedOnWindows = process.platform === 'win32' && ['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(err?.code)
        if (!unsupportedOnWindows) throw err
      }
    } catch (err) {
      await unlink(renamed ? target : temp).catch(() => undefined)
      throw err
    }
    return { filename, hash: createHash('sha256').update(body).digest('hex') }
  }

  async readResult(job) {
    if (!job?.result_path) throw createHttpError('生成结果不存在', 404, 'RESULT_NOT_FOUND')
    const filename = basename(job.result_path)
    if (filename !== job.result_path) throw createHttpError('生成结果路径无效', 500, 'RESULT_PATH_INVALID')
    const body = await readFile(join(this.resultDir, filename))
    if (!job.result_hash || createHash('sha256').update(body).digest('hex') !== job.result_hash) {
      throw createHttpError('生成结果校验失败，请联系管理员', 500, 'RESULT_HASH_INVALID')
    }
    return body
  }

  async sendGenerationResult(req, res, idempotencyKey) {
    const session = this.getSession(req)
    const job = this.db.getGenerationByKey(session.user.id, idempotencyKey)
    if (!job) throw createHttpError('生成任务不存在', 404, 'JOB_NOT_FOUND')
    if (job.status === 'failed') throw createHttpError(job.error || '生成失败，本次未扣费', 410, 'JOB_FAILED')
    if (job.status !== 'charged') {
      res.statusCode = 202
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Retry-After', '2')
      res.end(JSON.stringify({ success: true, data: { status: job.status } }))
      return
    }
    const body = await this.readResult(job)
    sendBufferedResponse(res, job.result_http_status || 200, job.result_content_type, body)
  }

  async relayAgentResponse(req, res, normalized, user, controller) {
    const conversationId = getRequiredAgentHeader(req, 'x-agent-conversation-id', 'AGENT_CONVERSATION_ID_REQUIRED')
    const roundId = getRequiredAgentHeader(req, 'x-agent-round-id', 'AGENT_ROUND_ID_REQUIRED')
    const stepKey = getRequiredAgentHeader(req, 'x-agent-step-key', 'AGENT_STEP_KEY_REQUIRED')
    const payload = parseAgentResponseBody(normalized.body)
    if (!payload) throw createHttpError('Agent 请求 JSON 无效', 400, 'INVALID_JSON')

    const requestHash = createHash('sha256').update(normalized.requestHashBody || normalized.body).digest('hex')
    const replayCall = this.db.getAgentCallByStep(user.id, stepKey)
    if (replayCall) {
      const replayRound = this.db.getBillingRoundById(user.id, replayCall.billingRoundId)
      if (
        replayCall.requestHash !== requestHash ||
        replayCall.modelId !== payload.model ||
        replayRound?.conversationId !== conversationId ||
        replayRound?.roundId !== roundId
      ) {
        throw createHttpError('同一 Agent 请求标识不能用于不同内容、模型或轮次', 409, 'IDEMPOTENCY_CONFLICT')
      }
      res.setHeader('X-Agent-Call-Id', String(replayCall.id))
      res.setHeader('X-Agent-Conversation-Id', conversationId)
      res.setHeader('X-Agent-Round-Id', roundId)
      if (replayCall.status === 'charged' && replayCall.resultBody) {
        const stored = Buffer.isBuffer(replayCall.resultBody) ? replayCall.resultBody : Buffer.from(replayCall.resultBody)
        sendBufferedResponse(res, replayCall.resultStatus || 200, replayCall.resultContentType || 'application/json; charset=utf-8', stored)
        return
      }
      if (replayCall.status === 'failed') throw createHttpError(replayCall.error || '该 Agent 步骤此前已失败', 409, 'AGENT_CALL_FAILED')
      res.statusCode = 202
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Retry-After', '2')
      res.end(JSON.stringify({ success: true, data: { status: replayCall.status } }))
      return
    }

    const model = this.db.getAgentModel(payload.model)
    if (!model?.selectable) throw createHttpError('所选 Agent 模型未启用或尚未完成定价', 400, 'AGENT_MODEL_NOT_AVAILABLE')
    if (this.usageBlockedModels.has(model.id)) throw createHttpError('该 Agent 模型的计费数据异常，已暂时停用', 503, 'AGENT_MODEL_USAGE_UNVERIFIED')
    this.db.lockAgentConversation({ userId: user.id, conversationId, modelId: model.id })

    const maxStepReserveMicros = Number(model.maxStepReserveMicros) || 0
    if (maxStepReserveMicros <= 0) throw createHttpError('所选 Agent 模型尚未配置单步预留金额', 503, 'AGENT_MODEL_PRICING_INCOMPLETE')
    const reserveMicros = calculateAgentRequestReserveMicros(model, normalized.body.length, payload.max_output_tokens, this.agentInputTokenOverhead)
    if (reserveMicros > maxStepReserveMicros) {
      throw createHttpError('Agent 上下文超过该模型的单步计费上限，请新建对话或减少输入内容', 413, 'AGENT_CONTEXT_TOO_LARGE')
    }
    const reservation = this.db.reserveAgentCall({
      userId: user.id,
      conversationId,
      roundId,
      stepKey,
      requestHash,
      modelId: model.id,
      reserveMicros,
      maxCallsPerRound: this.agentRoundStepLimit,
    })
    const call = reservation.call || reservation
    res.setHeader('X-Agent-Call-Id', String(call.id))
    res.setHeader('X-Agent-Conversation-Id', conversationId)
    res.setHeader('X-Agent-Round-Id', roundId)

    if (reservation.existing) {
      if (call.status === 'charged' && call.resultBody) {
        const stored = Buffer.isBuffer(call.resultBody) ? call.resultBody : Buffer.from(call.resultBody)
        sendBufferedResponse(res, call.resultStatus || 200, call.resultContentType || 'application/json; charset=utf-8', stored)
        return
      }
      if (call.status === 'failed') throw createHttpError(call.error || '该 Agent 步骤此前已失败', 409, 'AGENT_CALL_FAILED')
      res.statusCode = 202
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Retry-After', '2')
      res.end(JSON.stringify({ success: true, data: { status: call.status } }))
      return
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(this.agentApiKey ? { Authorization: `Bearer ${this.agentApiKey}` } : {}),
    }
    if (req.headers['openai-beta']) headers['OpenAI-Beta'] = req.headers['openai-beta']

    let upstream
    try {
      this.db.markAgentCallSubmitted(call.id)
      upstream = await this.fetch(this.buildUrl('responses'), {
        method: 'POST',
        headers,
        body: normalized.body,
        signal: controller.signal,
        redirect: 'manual',
      })
    } catch (err) {
      this.db.failAgentCall(call.id, err instanceof Error ? err.message : String(err))
      throw err
    }

    let upstreamBody
    try {
      upstreamBody = await readUpstreamBody(upstream, Math.min(this.maxUpstreamBodyBytes, MAX_AGENT_RESULT_BYTES))
    } catch (err) {
      this.db.failAgentCall(call.id, err instanceof Error ? err.message : String(err))
      throw err
    }
    if (!upstream.ok) {
      this.db.failAgentCall(call.id, `Agent 上游请求失败（HTTP ${upstream.status}）`)
      sendBufferedResponse(res, upstream.status, upstream.headers.get('content-type'), upstreamBody, upstream.headers)
      return
    }

    const responsePayload = parseAgentResponseBody(upstreamBody)
    const usage = parseAgentResponseUsage(responsePayload)
    if (!responsePayload || !usage) {
      this.usageBlockedModels.add(model.id)
      this.db.failAgentCall(call.id, 'Agent 上游响应缺少可核验的 usage，未向用户收费')
      throw createHttpError('Agent 上游未返回有效计费数据，该模型已暂时停用', 502, 'INVALID_AGENT_USAGE')
    }

    const chargeMicros = calculateAgentChargeMicros(model, usage)
    if (chargeMicros > reserveMicros) {
      this.usageBlockedModels.add(model.id)
      this.db.failAgentCall(call.id, 'Agent 实际费用超过单步预留上限，未向用户收费')
      throw createHttpError('Agent 本轮上下文超出计费上限，请新建对话或联系管理员', 502, 'AGENT_BILLING_LIMIT_EXCEEDED')
    }

    const resultPayload = {
      ...responsePayload,
      image_studio_billing: {
        model: model.id,
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens,
        charge_micros: chargeMicros,
        currency: 'CNY',
      },
    }
    const resultBody = Buffer.from(JSON.stringify(resultPayload))
    try {
      this.db.settleAgentCall(call.id, {
        ...usage,
        chargeMicros,
        upstreamId: typeof responsePayload.id === 'string' ? responsePayload.id : null,
        resultStatus: upstream.status,
        resultContentType: 'application/json; charset=utf-8',
        resultBody,
      })
    } catch (err) {
      this.db.failAgentCall(call.id, err instanceof Error ? err.message : String(err))
      throw err
    }
    res.setHeader('X-Agent-Charge-Micros', String(chargeMicros))
    sendBufferedResponse(res, upstream.status, 'application/json; charset=utf-8', resultBody, upstream.headers)
  }

  async relay(req, res, path) {
    const normalizedPath = path.replace(/^\/+/, '').replace(/\/+$/, '')
    if (req.method !== 'POST' || !isAllowedRelayPath(normalizedPath)) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }
    if (!isSameOriginRequest(req, this.expectedOrigin)) throw createHttpError('请求来源无效', 403, 'ORIGIN_INVALID')
    this.assertCsrf(req)
    const session = this.getSession(req)
    const user = session.user
    // 旧请求头仅用于平滑升级，所有新客户端统一发送 KunAI 请求头。
    const requestUser = req.headers['x-kunai-user'] || req.headers['x-image-studio-user']
    if (String(requestUser || '') !== String(user.id)) {
      throw createHttpError('账户已在其他页面切换，请刷新后重试', 409, 'USER_CONTEXT_CHANGED')
    }
    this.authorizeRelay(user, normalizedPath)

    const controller = new AbortController()
    let timeoutPhase = 'queue'
    let timeoutId = setTimeout(() => controller.abort(), this.queueTimeoutMs)
    const abortBeforeSubmit = () => controller.abort()
    req.once('aborted', abortBeforeSubmit)
    res.once('close', abortBeforeSubmit)
    let releaseRelay
    let job

    try {
      releaseRelay = await this.acquireRelay(user.id, controller.signal)
      clearTimeout(timeoutId)
      timeoutPhase = 'relay'
      timeoutId = setTimeout(() => controller.abort(), this.relayTimeoutMs)
      const requestBody = await readRequestBody(req, normalizedPath === 'responses' ? this.maxAgentBodyBytes : this.maxRelayBodyBytes)
      const contentType = String(req.headers['content-type'] || '')
      const normalized = await normalizeRelayRequest(normalizedPath, contentType, requestBody, {
        imageModel: this.imageModel,
        imageModels: this.imageModels,
        agentModel: this.agentModel,
        agentMaxOutputTokens: this.agentMaxOutputTokens,
      })
      const headers = {
        Accept: req.headers.accept || 'application/json',
        ...(this.imageApiKey ? { Authorization: `Bearer ${this.imageApiKey}` } : {}),
        ...(normalized.contentType ? { 'Content-Type': normalized.contentType } : {}),
      }
      if (req.headers['openai-beta']) headers['OpenAI-Beta'] = req.headers['openai-beta']

      if (normalizedPath === 'responses') {
        req.removeListener('aborted', abortBeforeSubmit)
        res.removeListener('close', abortBeforeSubmit)
        await this.relayAgentResponse(req, res, normalized, user, controller)
        return
      }

      const idempotencyKey = String(req.headers['x-idempotency-key'] || '')
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
        throw createHttpError('生成请求缺少有效的幂等标识', 400, 'INVALID_IDEMPOTENCY_KEY')
      }
      const agentConversationHeader = String(req.headers['x-agent-conversation-id'] || '').trim()
      const agentRoundHeader = String(req.headers['x-agent-round-id'] || '').trim()
      if (Boolean(agentConversationHeader) !== Boolean(agentRoundHeader)) {
        throw createHttpError('Agent 图片请求上下文不完整', 400, 'INVALID_AGENT_IMAGE_CONTEXT')
      }
      const billingRound = agentConversationHeader
        ? this.db.getBillingRound({
            userId: user.id,
            conversationId: getRequiredAgentHeader(req, 'x-agent-conversation-id', 'INVALID_AGENT_CONVERSATION_ID'),
            roundId: getRequiredAgentHeader(req, 'x-agent-round-id', 'INVALID_AGENT_ROUND_ID'),
          })
        : null
      if (agentConversationHeader && !billingRound) {
        throw createHttpError('Agent 计费轮次不存在', 409, 'INVALID_AGENT_IMAGE_CONTEXT')
      }
      await this.ensureResultCapacity()
      const requestHash = await hashNormalizedRelayRequest(normalizedPath, normalized)
      const reservation = this.db.reserveGeneration({
        userId: user.id,
        idempotencyKey,
        requestHash,
        priceMicros: this.imagePriceMicros,
        billingRoundId: billingRound?.id ?? null,
      })
      job = reservation.job
      res.setHeader('X-KunAI-Request-Id', idempotencyKey)
      if (reservation.existing) {
        if (job.status === 'charged') {
          const stored = await this.readResult(job)
          sendBufferedResponse(res, job.result_http_status || 200, job.result_content_type, stored)
          return
        }
        if (job.status === 'failed') throw createHttpError(job.error || '该生成任务此前已失败', 409, 'JOB_FAILED')
        res.statusCode = 202
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Retry-After', '2')
        res.end(JSON.stringify({ success: true, data: { status: job.status } }))
        return
      }

      this.db.markGenerationSubmitted(job.id, idempotencyKey)
      req.removeListener('aborted', abortBeforeSubmit)
      res.removeListener('close', abortBeforeSubmit)
      const upstream = await this.fetch(this.buildUrl(normalizedPath), {
        method: 'POST',
        headers: { ...headers, 'X-Idempotency-Key': idempotencyKey },
        body: normalized.body,
        signal: controller.signal,
        redirect: 'manual',
      })
      if (!upstream.ok) {
        this.db.failGeneration(job.id, `上游请求失败（HTTP ${upstream.status}）`)
        job = null
        if (!res.destroyed) await sendUpstreamResponse(upstream, res)
        return
      }

      const upstreamBody = await readUpstreamBody(upstream, this.maxUpstreamBodyBytes)
      const resultBody = await normalizeSuccessfulImageResponse(upstreamBody, this.maxImagePixels, normalized.requestedImageSize)
      const result = await this.writeResult(job.id, resultBody)
      this.db.settleGeneration(job.id, {
        path: result.filename,
        hash: result.hash,
        contentType: 'application/json; charset=utf-8',
        httpStatus: upstream.status,
      })
      job = null
      if (!res.destroyed) sendBufferedResponse(res, upstream.status, 'application/json; charset=utf-8', resultBody, upstream.headers)
    } catch (err) {
      if (job) this.db.failGeneration(job.id, err.message)
      if (controller.signal.aborted && res.destroyed) return
      if (controller.signal.aborted) {
        const message = timeoutPhase === 'queue' ? '等待生成队列超时' : '上游生成请求超时，本次未扣费'
        throw createHttpError(message, 504, 'RELAY_TIMEOUT')
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
      req.removeListener('aborted', abortBeforeSubmit)
      res.removeListener('close', abortBeforeSubmit)
      releaseRelay?.()
    }
  }
}
