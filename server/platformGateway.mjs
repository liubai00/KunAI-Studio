import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, statfs, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import { getSessionToken, parseCookies } from './platformAuth.mjs'

const MAX_JSON_BODY_BYTES = 1024 * 1024
const ALLOWED_AGENT_FUNCTIONS = new Set(['generate_image', 'generate_image_batch', 'continue_generation'])
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

export function selectImageModel(size, models = {}, fallback = 'gpt-image-2') {
  const value = String(size || '').trim()
  if (!value || value === 'auto') return models['1k'] || fallback
  const match = value.match(/^(\d+)x(\d+)$/i)
  if (!match) throw createHttpError('图片尺寸格式无效', 400, 'INVALID_IMAGE_SIZE')
  const width = Number(match[1])
  const height = Number(match[2])
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || width <= 0 || height <= 0 || pixels > 8294400) {
    throw createHttpError('图片尺寸超出支持范围', 400, 'INVALID_IMAGE_SIZE')
  }
  if (pixels <= 1572864) return models['1k'] || fallback
  if (pixels <= 4194304) return models['2k'] || models['1k'] || fallback
  return models['4k'] || models['2k'] || models['1k'] || fallback
}

export async function normalizeRelayRequest(path, contentType, body, options = {}) {
  const normalizedPath = path.replace(/^\/+/, '').replace(/\/+$/, '')
  const imageModel = options.imageModel || 'gpt-image-2'
  const imageModels = options.imageModels || {}
  const agentModel = options.agentModel || 'gpt-5.5'

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
    formData.set('model', selectImageModel(formData.get('size'), imageModels, imageModel))
    formData.set('n', '1')
    formData.set('stream', 'false')
    formData.set('response_format', 'b64_json')
    formData.delete('partial_images')
    return { body: formData }
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
    const tools = Array.isArray(payload.tools) ? payload.tools : []
    const invalidTool = tools.find((tool) => {
      if (!tool || typeof tool !== 'object') return true
      if (tool.type === 'web_search') return false
      if (tool.type !== 'function') return true
      return !ALLOWED_AGENT_FUNCTIONS.has(String(tool.name || ''))
    })
    if (invalidTool) throw createHttpError('Agent 请求包含未授权工具', 403, 'UNAUTHORIZED_TOOL')
    payload.model = agentModel
  } else {
    payload.model = selectImageModel(payload.size, imageModels, imageModel)
    payload.n = 1
    payload.stream = false
    payload.response_format = 'b64_json'
    delete payload.partial_images
  }

  return {
    body: Buffer.from(JSON.stringify(payload)),
    contentType: 'application/json',
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

async function normalizeSuccessfulImageResponse(body, maxImagePixels) {
  let payload
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    throw createHttpError('上游返回的图片响应无法解析', 502, 'INVALID_UPSTREAM_RESPONSE')
  }
  const items = Array.isArray(payload?.data) ? payload.data : []
  for (const item of items.slice(0, 4)) {
    if (!item || typeof item !== 'object' || typeof item.b64_json !== 'string') continue
    const value = item.b64_json.replace(/\s/g, '')
    if (value.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) continue
    const image = Buffer.from(value, 'base64')
    try {
      const decoder = sharp(image, { failOn: 'error', limitInputPixels: maxImagePixels, sequentialRead: true })
      const metadata = await decoder.metadata()
      if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format || '')) continue
      await decoder.raw().toBuffer()
      return Buffer.from(JSON.stringify({ ...payload, data: [{ ...item, b64_json: value }] }))
    } catch {
      continue
    }
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
    this.baseUrl = options.baseUrl ? new URL(options.baseUrl) : null
    this.apiKey = String(options.apiKey || '')
    this.db = options.db
    this.expectedOrigin = String(options.expectedOrigin || '')
    this.generationMinRole = Number.isFinite(Number(options.generationMinRole)) ? Number(options.generationMinRole) : 1
    this.agentMinRole = Number.isFinite(Number(options.agentMinRole)) ? Number(options.agentMinRole) : this.generationMinRole
    this.allowedGroups = new Set(options.allowedGroups || [])
    this.imageModel = options.imageModel || 'gpt-image-2'
    this.imageModels = options.imageModels || {}
    this.agentModel = options.agentModel || 'gpt-5.5'
    this.imagePriceMicros = Math.max(0, Number(options.imagePriceMicros) || 0)
    this.resultDir = resolve(options.resultDir || join('data', 'results'))
    this.maxImagePixels = Number(options.maxImagePixels) > 0 ? Number(options.maxImagePixels) : 40 * 1000 * 1000
    this.minResultFreeBytes = Number(options.minResultFreeBytes) > 0 ? Number(options.minResultFreeBytes) : 512 * 1024 * 1024
    this.secureCookies = Boolean(options.secureCookies)
    this.trustProxy = Boolean(options.trustProxy)
    this.maxRelayBodyBytes = Number(options.maxRelayBodyBytes) > 0 ? Number(options.maxRelayBodyBytes) : 128 * 1024 * 1024
    this.maxUpstreamBodyBytes = Number(options.maxUpstreamBodyBytes) > 0 ? Number(options.maxUpstreamBodyBytes) : 128 * 1024 * 1024
    this.maxConcurrentRelays = Number(options.maxConcurrentRelays) > 0 ? Number(options.maxConcurrentRelays) : 24
    this.maxQueuedRelaysPerUser = Number(options.maxQueuedRelaysPerUser) > 0 ? Number(options.maxQueuedRelaysPerUser) : 8
    this.queueTimeoutMs = Number(options.queueTimeoutMs) > 0 ? Number(options.queueTimeoutMs) : 10 * 60 * 1000
    this.relayTimeoutMs = Number(options.relayTimeoutMs) > 0 ? Number(options.relayTimeoutMs) : 10 * 60 * 1000
    this.fetch = options.fetch || globalThis.fetch
    this.activeRelays = 0
    this.relayQueues = new Map()
    this.queuedRelaysByUser = new Map()
  }

  buildUrl(path) {
    if (!this.baseUrl) throw createHttpError('尚未配置第三方中转接口', 503, 'RELAY_NOT_CONFIGURED')
    return new URL(path.replace(/^\/+/, ''), `${this.baseUrl.toString().replace(/\/+$/, '')}/`)
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
    const relayReady = Boolean(this.baseUrl)
    return {
      generation: relayReady && groupAllowed && Number(user.status) === 1 && Number(user.role) >= this.generationMinRole,
      agent: relayReady && groupAllowed && Number(user.status) === 1 && Number(user.role) >= this.agentMinRole,
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
    if (String(req.headers['x-image-studio-user'] || '') !== String(user.id)) {
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
      const requestBody = await readRequestBody(req, this.maxRelayBodyBytes)
      const contentType = String(req.headers['content-type'] || '')
      const normalized = await normalizeRelayRequest(normalizedPath, contentType, requestBody, {
        imageModel: this.imageModel,
        imageModels: this.imageModels,
        agentModel: this.agentModel,
      })
      const headers = {
        Accept: req.headers.accept || 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        ...(normalized.contentType ? { 'Content-Type': normalized.contentType } : {}),
      }
      if (req.headers['openai-beta']) headers['OpenAI-Beta'] = req.headers['openai-beta']

      if (normalizedPath === 'responses') {
        const upstream = await this.fetch(this.buildUrl(normalizedPath), {
          method: 'POST',
          headers,
          body: normalized.body,
          signal: controller.signal,
          redirect: 'manual',
        })
        await sendUpstreamResponse(upstream, res)
        return
      }

      const idempotencyKey = String(req.headers['x-idempotency-key'] || '')
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
        throw createHttpError('生成请求缺少有效的幂等标识', 400, 'INVALID_IDEMPOTENCY_KEY')
      }
      await this.ensureResultCapacity()
      const requestHash = await hashNormalizedRelayRequest(normalizedPath, normalized)
      const reservation = this.db.reserveGeneration({
        userId: user.id,
        idempotencyKey,
        requestHash,
        priceMicros: this.imagePriceMicros,
      })
      job = reservation.job
      res.setHeader('X-Image-Studio-Request-Id', idempotencyKey)
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
      const resultBody = await normalizeSuccessfulImageResponse(upstreamBody, this.maxImagePixels)
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
