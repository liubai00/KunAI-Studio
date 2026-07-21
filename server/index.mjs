import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, relative as getRelativePath, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import {
  PlatformAuth,
  clearAuthCookies,
  createAuthCookies,
  createAuthOptionsFromEnv,
  getCsrfToken,
  getSessionToken,
} from './platformAuth.mjs'
import { PlatformDatabase, isMembershipActive, parseMoneyToMicros } from './platformDb.mjs'
import { AgentModelCatalog } from './agentModelPolicy.mjs'
import { DulupayClient } from './dulupay.mjs'
import { callTavilySearch, toSearchWebError, validateSearchWebInput } from './tavilySearch.mjs'
import {
  PlatformGateway,
  createHttpError,
  isSameOriginRequest,
  readJsonBody,
  readRequestBody,
} from './platformGateway.mjs'

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST_DIR = join(ROOT_DIR, 'dist')
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

function parseOptionalMoneyToMicros(value) {
  if (value === undefined || value === '') return null
  return parseMoneyToMicros(value)
}

function loadConfig(env) {
  const production = env.NODE_ENV === 'production'
  const appOrigin = String(env.APP_ORIGIN || '').trim()
  const relayBaseUrl = String(env.IMAGE_UPSTREAM_BASE_URL || env.RELAY_BASE_URL || '').trim()
  const agentBaseUrl = String(env.AGENT_UPSTREAM_BASE_URL || '').trim()
  const rawPaymentUrl = String(env.PAYMENT_URL || '').trim()
  const paymentUrl = /^https?:\/\/pay\.example\.com(?:[/:?#]|$)/i.test(rawPaymentUrl) ? '' : rawPaymentUrl
  const paymentWebhookSecret = String(env.PAYMENT_WEBHOOK_SECRET || '').trim()
  const dulupayEnabled = parseBoolean(env.DULUPAY_ENABLED)
  const defaultDbPath = resolve(ROOT_DIR, 'data', 'kunai-studio.sqlite')
  const legacyDbPath = resolve(ROOT_DIR, 'data', 'image-studio.sqlite')
  if (production && !appOrigin) throw new Error('生产环境必须配置 APP_ORIGIN')
  if (production && new URL(appOrigin).protocol !== 'https:') throw new Error('生产环境 APP_ORIGIN 必须使用 HTTPS')
  if (production && env.PLATFORM_COOKIE_SECURE === 'false') throw new Error('生产环境不能关闭 Secure Cookie')
  if (production && relayBaseUrl && new URL(relayBaseUrl).protocol !== 'https:') {
    throw new Error('生产环境 IMAGE_UPSTREAM_BASE_URL 必须使用 HTTPS')
  }
  if (production && agentBaseUrl && new URL(agentBaseUrl).protocol !== 'https:') {
    throw new Error('生产环境 AGENT_UPSTREAM_BASE_URL 必须使用 HTTPS')
  }
  if (production && paymentWebhookSecret && (paymentWebhookSecret.length < 32 || /^replace-|placeholder/i.test(paymentWebhookSecret))) {
    throw new Error('生产环境 PAYMENT_WEBHOOK_SECRET 必须使用至少 32 个字符的随机密钥，留空可禁用支付回调')
  }

  return {
    production,
    host: env.HOST || '0.0.0.0',
    port: Number(env.PLATFORM_PORT || env.PORT || 3001),
    appOrigin,
    systemName: env.PLATFORM_SYSTEM_NAME || 'KunAI Studio',
    cookieSecure: env.PLATFORM_COOKIE_SECURE === undefined || env.PLATFORM_COOKIE_SECURE === ''
      ? production
      : parseBoolean(env.PLATFORM_COOKIE_SECURE),
    trustProxy: parseBoolean(env.PLATFORM_TRUST_PROXY),
    dbPath: env.PLATFORM_DB_PATH
      ? resolve(ROOT_DIR, env.PLATFORM_DB_PATH)
      : existsSync(defaultDbPath) || !existsSync(legacyDbPath) ? defaultDbPath : legacyDbPath,
    resultDir: resolve(ROOT_DIR, env.PLATFORM_RESULT_DIR || join('data', 'results')),
    relayBaseUrl,
    relayApiKey: env.IMAGE_UPSTREAM_API_KEY || env.RELAY_API_KEY || '',
    agentBaseUrl: agentBaseUrl || relayBaseUrl,
    agentApiKey: env.AGENT_UPSTREAM_API_KEY || (agentBaseUrl ? '' : env.IMAGE_UPSTREAM_API_KEY || env.RELAY_API_KEY || ''),
    agentModelDiscoveryTimeoutMs: Number(env.PLATFORM_AGENT_MODEL_DISCOVERY_TIMEOUT_MS || 10000),
    agentMaxOutputTokens: Number(env.PLATFORM_AGENT_MAX_OUTPUT_TOKENS || 4096),
    agentInputTokenOverhead: Number(env.PLATFORM_AGENT_INPUT_TOKEN_OVERHEAD || 8192),
    agentRoundStepLimit: Number(env.PLATFORM_AGENT_ROUND_STEP_LIMIT || 16),
    paymentUrl,
    paymentWebhookSecret,
    paymentCheckoutTtlMs: 30 * 60 * 1000,
    rechargeMinMicros: parseMoneyToMicros(env.PLATFORM_RECHARGE_MIN_CNY || '1'),
    rechargeMaxMicros: parseMoneyToMicros(env.PLATFORM_RECHARGE_MAX_CNY || '5000'),
    dulupay: {
      enabled: dulupayEnabled,
      apiBase: String(env.DULUPAY_API_BASE || 'https://api.dulupay.com').trim(),
      pid: String(env.DULUPAY_PID || '').trim(),
      privateKey: String(env.DULUPAY_MERCHANT_PRIVATE_KEY || '').trim(),
      platformPublicKey: String(env.DULUPAY_PLATFORM_PUBLIC_KEY || '').trim(),
      notifyUrl: String(env.DULUPAY_NOTIFY_URL || '').trim(),
      returnUrl: String(env.DULUPAY_RETURN_URL || '').trim(),
      method: String(env.DULUPAY_METHOD || 'web').trim(),
      timeoutMs: Number(env.DULUPAY_TIMEOUT_MS || 10000),
      timestampSkewSeconds: Number(env.DULUPAY_TIMESTAMP_SKEW_SECONDS || 300),
    },
    imageUnitPriceMicros: parseMoneyToMicros(env.IMAGE_UNIT_PRICE || '0.07'),
    signupCreditMicros: parseMoneyToMicros(env.PLATFORM_SIGNUP_CREDIT || '0'),
    imageModel: env.PLATFORM_IMAGE_MODEL || env.VITE_PLATFORM_IMAGE_MODEL || 'gpt-image-2',
    imageModels: {
      '1k': env.PLATFORM_IMAGE_MODEL_1K || '',
      '2k': env.PLATFORM_IMAGE_MODEL_2K || '',
      '4k': env.PLATFORM_IMAGE_MODEL_4K || '',
    },
    agentModel: env.PLATFORM_AGENT_MODEL || env.VITE_PLATFORM_AGENT_MODEL || 'gpt-5.5',
    agentSeedInputPriceMicros: parseOptionalMoneyToMicros(env.PLATFORM_AGENT_INPUT_PRICE_CNY_PER_M),
    agentSeedCachedInputPriceMicros: parseOptionalMoneyToMicros(env.PLATFORM_AGENT_CACHED_INPUT_PRICE_CNY_PER_M),
    agentSeedOutputPriceMicros: parseOptionalMoneyToMicros(env.PLATFORM_AGENT_OUTPUT_PRICE_CNY_PER_M),
    agentSeedMaxReserveMicros: parseOptionalMoneyToMicros(env.PLATFORM_AGENT_MAX_STEP_RESERVE_CNY),
    agentAutoEnableModels: new Set(String(env.PLATFORM_AGENT_AUTO_ENABLE_MODELS || '').split(',').map((item) => item.trim()).filter(Boolean)),
    tavilyApiKey: String(env.TAVILY_API_KEY || '').trim(),
    searchPriceMicros: parseMoneyToMicros(env.PLATFORM_SEARCH_PRICE_CNY || '0.10'),
    searchTimeoutMs: Number(env.PLATFORM_SEARCH_TIMEOUT_MS || 15000),
    searchMinuteLimit: Number(env.PLATFORM_SEARCH_MINUTE_LIMIT || 10),
    searchDailyLimit: Number(env.PLATFORM_SEARCH_DAILY_LIMIT || 100),
    searchMaxConcurrent: Number(env.PLATFORM_SEARCH_MAX_CONCURRENT || 8),
    searchRoundLimit: Number(env.PLATFORM_SEARCH_ROUND_LIMIT || 12),
    generationMinRole: Number(env.PLATFORM_GENERATION_MIN_ROLE || 1),
    agentMinRole: Number(env.PLATFORM_AGENT_MIN_ROLE || 1),
    allowedGroups: String(env.PLATFORM_ALLOWED_GROUPS || '').split(',').map((item) => item.trim()).filter(Boolean),
    maxRelayBodyBytes: Number(env.PLATFORM_MAX_RELAY_BODY_MB || 128) * 1024 * 1024,
    maxAgentBodyBytes: Number(env.PLATFORM_MAX_AGENT_BODY_MB || 4) * 1024 * 1024,
    maxUpstreamBodyBytes: Number(env.PLATFORM_MAX_UPSTREAM_BODY_MB || 128) * 1024 * 1024,
    maxImagePixels: Number(env.PLATFORM_MAX_IMAGE_PIXELS || 40000000),
    minResultFreeBytes: Number(env.PLATFORM_RESULT_MIN_FREE_MB || 512) * 1024 * 1024,
    maxConcurrentRelays: Number(env.PLATFORM_MAX_CONCURRENT_RELAYS || 24),
    maxQueuedRelaysPerUser: Number(env.PLATFORM_MAX_QUEUED_RELAYS_PER_USER || 8),
    queueTimeoutMs: Number(env.PLATFORM_QUEUE_TIMEOUT_MS || 600000),
    relayTimeoutMs: Number(env.PLATFORM_RELAY_TIMEOUT_MS || 600000),
    authRateWindowMs: Number(env.PLATFORM_AUTH_RATE_WINDOW_MS || 60000),
    authRateLimit: Number(env.PLATFORM_AUTH_RATE_LIMIT || 30),
    headersTimeoutMs: Number(env.PLATFORM_HEADERS_TIMEOUT_MS || 60000),
    requestTimeoutMs: Number(env.PLATFORM_REQUEST_TIMEOUT_MS || 300000),
    keepAliveTimeoutMs: Number(env.PLATFORM_KEEP_ALIVE_TIMEOUT_MS || 5000),
  }
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
}

function sendJson(res, status, payload, cookies) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (cookies?.length) res.setHeader('Set-Cookie', cookies)
  res.end(JSON.stringify(payload))
}

function serializeUser(user, gateway) {
  return {
    id: user.id,
    username: user.email.split('@')[0],
    display_name: user.displayName,
    email: user.email,
    email_verified: Boolean(user.emailVerifiedAt),
    role: user.role,
    status: user.status,
    group: user.group,
    quota: user.balanceMicros,
    reserved_quota: user.reservedMicros,
    used_quota: user.usedMicros,
    image_credits: user.imageCredits ?? 0,
    reserved_credits: user.reservedCredits ?? 0,
    available_credits: Math.max(0, (user.imageCredits ?? 0) - (user.reservedCredits ?? 0)),
    membership_expires_at: user.membershipExpiresAt ?? null,
    membership_active: isMembershipActive(user, Date.now()),
    request_count: user.requestCount,
    image_studio_capabilities: gateway.getCapabilities(user),
  }
}

function serializeProduct(product) {
  return {
    id: product.id,
    kind: product.kind,
    name: product.name,
    description: product.description,
    price: product.priceMicros / 1000000,
    price_micros: product.priceMicros,
    duration_days: product.durationDays,
    credits: product.credits,
    sort_order: product.sortOrder,
    active: product.active,
  }
}

function serializeRedemptionCode(code) {
  return {
    code: code.code,
    credits: code.credits,
    membership_days: code.membershipDays,
    balance: code.balanceMicros / 1000000,
    note: code.note,
    expires_at: code.expiresAt,
    redeemed_by: code.redeemedBy,
    redeemed_at: code.redeemedAt,
    enabled: code.enabled,
    max_redemptions: code.maxRedemptions,
    redemption_count: code.redemptionCount,
    remaining_redemptions: Math.max(0, code.maxRedemptions - code.redemptionCount),
    created_by: code.createdBy,
    created_at: code.createdAt,
  }
}

function sendText(res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(value)
}

function formatMicrosAmount(amountMicros) {
  const whole = Math.trunc(amountMicros / 1000000)
  const fraction = String(amountMicros % 1000000).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${fraction}`
}

function buildCheckoutUrl(paymentUrl, intent) {
  const params = {
    checkout_intent_id: intent.id,
    product_id: intent.productId,
    user_id: String(intent.userId),
    amount: formatMicrosAmount(intent.amountMicros),
    currency: 'CNY',
  }
  try {
    const url = new URL(paymentUrl)
    url.searchParams.delete('email')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  } catch {
    const separator = paymentUrl.includes('?') ? '&' : '?'
    return `${paymentUrl}${separator}${new URLSearchParams(params).toString()}`
  }
}

function buildBalanceCheckoutUrl(paymentUrl, intent) {
  const params = {
    balance_checkout_intent_id: intent.id,
    user_id: String(intent.userId),
    amount: formatMicrosAmount(intent.amountMicros),
    currency: 'CNY',
  }
  try {
    const url = new URL(paymentUrl)
    url.searchParams.delete('email')
    url.searchParams.delete('product_id')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  } catch {
    const separator = paymentUrl.includes('?') ? '&' : '?'
    return `${paymentUrl}${separator}${new URLSearchParams(params).toString()}`
  }
}

function serializeAgentModel(model) {
  return {
    id: model.id,
    label: model.label || model.id,
    enabled: Boolean(model.enabled),
    selectable: Boolean(model.selectable),
    is_default: Boolean(model.isDefault),
    sort_order: model.sortOrder || 0,
    input_price_micros: model.inputTokenPriceMicros ?? null,
    cached_input_price_micros: model.cachedInputTokenPriceMicros ?? null,
    output_price_micros: model.outputTokenPriceMicros ?? null,
    max_step_reserve_micros: model.maxStepReserveMicros ?? null,
    last_seen_at: model.lastSeenAt ?? null,
  }
}

function serializeBillingRound(round) {
  return {
    id: round.id,
    conversation_id: round.conversationId,
    round_id: round.roundId,
    status: round.status,
    input_tokens: round.inputTokens || 0,
    cached_input_tokens: round.cachedInputTokens || 0,
    output_tokens: round.outputTokens || 0,
    search_calls: round.searchCount || 0,
    image_count: round.imageCount || 0,
    image_credits_used: round.imageCreditsUsed || 0,
    agent_micros: round.agentMicros || 0,
    search_micros: round.searchMicros || 0,
    total_micros: round.totalMicros || 0,
    created_at: round.createdAt,
    updated_at: round.updatedAt,
  }
}

function isAdmin(user) {
  return user.status === 1 && user.role >= 10
}

function serveStatic(req, res, pathname) {
  if (!existsSync(DIST_DIR)) {
    sendJson(res, 503, { success: false, message: '前端尚未构建，请先运行 npm run build' })
    return
  }
  const assetPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = normalize(join(DIST_DIR, assetPath))
  const candidateRelative = getRelativePath(DIST_DIR, candidate)
  const filePath = !candidateRelative.startsWith('..') && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(DIST_DIR, 'index.html')
  res.statusCode = 200
  res.setHeader('Content-Type', MIME_TYPES[extname(filePath)] || 'application/octet-stream')
  res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

export function createPlatformApp(options = {}) {
  const env = options.env || process.env
  const config = { ...loadConfig(env), ...options.config }
  const db = options.db || new PlatformDatabase({ path: config.dbPath })
  const auth = options.auth || new PlatformAuth(createAuthOptionsFromEnv(env, {
    db,
    signupCreditMicros: config.signupCreditMicros,
    fetch: options.fetch,
  }))
  db.promoteAdminEmails(auth.adminEmails)
  if (config.production && !auth.registrationEnabled && db.countAdmins() === 0) {
    throw new Error('生产环境关闭注册前必须先创建至少一个 PLATFORM_ADMIN_EMAILS 管理员账户')
  }
  const gateway = options.gateway || new PlatformGateway({
    imageBaseUrl: config.relayBaseUrl,
    imageApiKey: config.relayApiKey,
    agentBaseUrl: config.agentBaseUrl,
    agentApiKey: config.agentApiKey,
    db,
    expectedOrigin: config.appOrigin,
    generationMinRole: config.generationMinRole,
    agentMinRole: config.agentMinRole,
    allowedGroups: config.allowedGroups,
    imageModel: config.imageModel,
    imageModels: config.imageModels,
    agentModel: config.agentModel,
    agentMaxOutputTokens: config.agentMaxOutputTokens,
    agentInputTokenOverhead: config.agentInputTokenOverhead,
    agentRoundStepLimit: config.agentRoundStepLimit,
    imagePriceMicros: config.imageUnitPriceMicros,
    resultDir: config.resultDir,
    maxImagePixels: config.maxImagePixels,
    minResultFreeBytes: config.minResultFreeBytes,
    secureCookies: config.cookieSecure,
    trustProxy: config.trustProxy,
    maxRelayBodyBytes: config.maxRelayBodyBytes,
    maxAgentBodyBytes: config.maxAgentBodyBytes,
    maxUpstreamBodyBytes: config.maxUpstreamBodyBytes,
    maxConcurrentRelays: config.maxConcurrentRelays,
    maxQueuedRelaysPerUser: config.maxQueuedRelaysPerUser,
    queueTimeoutMs: config.queueTimeoutMs,
    relayTimeoutMs: config.relayTimeoutMs,
    fetch: options.fetch,
  })
  const agentModelCatalog = options.agentModelCatalog || new AgentModelCatalog({
    baseUrl: config.agentBaseUrl,
    apiKey: config.agentApiKey,
    timeoutMs: config.agentModelDiscoveryTimeoutMs,
    fetch: options.fetch,
  })
  if (!Number.isSafeInteger(config.rechargeMinMicros) || !Number.isSafeInteger(config.rechargeMaxMicros) || config.rechargeMinMicros <= 0 || config.rechargeMaxMicros < config.rechargeMinMicros) {
    throw new Error('PLATFORM_RECHARGE_MIN_CNY / PLATFORM_RECHARGE_MAX_CNY 配置无效')
  }
  const dulupay = options.dulupay || (config.dulupay.enabled ? new DulupayClient({
    apiBase: config.dulupay.apiBase,
    pid: config.dulupay.pid,
    privateKey: config.dulupay.privateKey,
    platformPublicKey: config.dulupay.platformPublicKey,
    notifyUrl: config.dulupay.notifyUrl,
    returnUrl: config.dulupay.returnUrl,
    method: config.dulupay.method,
    timeoutMs: config.dulupay.timeoutMs,
    timestampSkewSeconds: config.dulupay.timestampSkewSeconds,
    production: config.production,
    fetch: options.fetch,
  }) : null)
  const paymentEnabled = Boolean(dulupay || config.paymentUrl)
  const authRateLimits = new Map()
  const searchRateLimits = new Map()
  let activeSearches = 0

  const enforceOrigin = (req) => {
    if (!isSameOriginRequest(req, config.appOrigin)) throw createHttpError('请求来源无效', 403, 'ORIGIN_INVALID')
  }

  const enforceAuthRateLimit = (req, key = '', identity = '') => {
    const ip = gateway.getClientIp(req) || 'unknown'
    const now = Date.now()
    const bucketKeys = [
      `ip:${ip}:${key}`,
      ...(identity ? [`identity:${createHash('sha256').update(String(identity).trim().toLowerCase()).digest('hex')}:${key}`] : []),
    ]
    if (authRateLimits.size > 10000) {
      for (const [itemKey, value] of authRateLimits) {
        if (value.resetAt <= now) authRateLimits.delete(itemKey)
      }
    }
    for (const bucketKey of bucketKeys) {
      const current = authRateLimits.get(bucketKey)
      if (current && current.resetAt > now && current.count >= config.authRateLimit) {
        throw createHttpError('认证请求过于频繁，请稍后重试', 429, 'RATE_LIMITED')
      }
    }
    for (const bucketKey of bucketKeys) {
      const current = authRateLimits.get(bucketKey)
      if (!current || current.resetAt <= now) authRateLimits.set(bucketKey, { count: 1, resetAt: now + config.authRateWindowMs })
      else current.count += 1
    }
  }

  const requireSession = (req, csrf = false) => {
    const session = gateway.getSession(req)
    if (csrf && !db.verifyCsrf(getSessionToken(req, config.cookieSecure), getCsrfToken(req))) {
      throw createHttpError('安全校验已失效，请刷新页面后重试', 403, 'CSRF_INVALID')
    }
    return session
  }

  const refreshAgentModels = async (force = false) => {
    const snapshot = await agentModelCatalog.get({ force })
    const existingIds = new Set(db.listAgentModels().map((model) => model.id))
    db.upsertDiscoveredAgentModels(snapshot.models)
    const seedPricingReady = [
      config.agentSeedInputPriceMicros,
      config.agentSeedCachedInputPriceMicros,
      config.agentSeedOutputPriceMicros,
      config.agentSeedMaxReserveMicros,
    ].every((value) => value != null)
    if (seedPricingReady) {
      for (const id of snapshot.models) {
        if (existingIds.has(id) || !config.agentAutoEnableModels.has(id)) continue
        db.configureAgentModel(null, id, {
          enabled: true,
          inputTokenPriceMicros: config.agentSeedInputPriceMicros,
          cachedInputTokenPriceMicros: config.agentSeedCachedInputPriceMicros,
          outputTokenPriceMicros: config.agentSeedOutputPriceMicros,
          maxStepReserveMicros: config.agentSeedMaxReserveMicros,
        })
      }
      if (!db.getDefaultAgentModel() && db.getAgentModel(config.agentModel)?.selectable) {
        db.configureAgentModel(null, config.agentModel, { isDefault: true })
      }
    }
    const models = db.listAgentModels()
    return {
      models: models.map(serializeAgentModel),
      default_model: models.find((model) => model.isDefault && model.selectable)?.id || null,
      refreshed_at: snapshot.refreshedAt,
      stale: snapshot.stale,
      ...(snapshot.error ? { error: snapshot.error } : {}),
    }
  }

  const enforceSearchRateLimit = (userId) => {
    const now = Date.now()
    const current = searchRateLimits.get(userId) || {
      minuteStartedAt: now,
      minuteCount: 0,
      dayStartedAt: now,
      dayCount: 0,
    }
    if (now - current.minuteStartedAt >= 60 * 1000) {
      current.minuteStartedAt = now
      current.minuteCount = 0
    }
    if (now - current.dayStartedAt >= 24 * 60 * 60 * 1000) {
      current.dayStartedAt = now
      current.dayCount = 0
    }
    if (current.minuteCount >= config.searchMinuteLimit || current.dayCount >= config.searchDailyLimit) {
      throw createHttpError('搜索调用过于频繁，请稍后重试', 429, 'SEARCH_RATE_LIMITED')
    }
    current.minuteCount += 1
    current.dayCount += 1
    searchRateLimits.set(userId, current)
  }

  const handleSearchWeb = async (req, res) => {
    const session = requireSession(req, true)
    const body = await readJsonBody(req, 64 * 1024)
    const conversationId = String(body.conversation_id || '').trim()
    const roundId = String(body.round_id || '').trim()
    const callId = String(body.call_id || '').trim()
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(conversationId)) throw createHttpError('Agent 对话 ID 无效', 400, 'INVALID_CONVERSATION_ID')
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(roundId)) throw createHttpError('Agent 轮次 ID 无效', 400, 'INVALID_ROUND_ID')
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(callId)) throw createHttpError('搜索调用 ID 无效', 400, 'INVALID_SEARCH_CALL_ID')
    const input = validateSearchWebInput(body.input)
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const existing = db.getSearchCall(session.user.id, callId)
    if (existing) {
      const round = db.getBillingRoundById(session.user.id, existing.billingRoundId)
      if (existing.requestHash !== requestHash || round?.conversationId !== conversationId || round?.roundId !== roundId) {
        throw createHttpError('同一搜索调用 ID 不能用于不同内容或轮次', 409, 'IDEMPOTENCY_CONFLICT')
      }
      if (existing.status === 'charged' && existing.resultJson) {
        sendJson(res, 200, { success: true, data: JSON.parse(existing.resultJson) })
        return
      }
      if (existing.status === 'failed') throw createHttpError(existing.error || '该搜索调用此前已失败', 409, 'SEARCH_CALL_FAILED')
      sendJson(res, 202, { success: true, data: { ok: false, pending: true } })
      return
    }

    if (!gateway.getCapabilities(session.user).agent) throw createHttpError('当前账户没有使用 Agent 的权限', 403, 'FORBIDDEN')
    if (!config.tavilyApiKey) throw createHttpError('搜索服务尚未配置', 503, 'SEARCH_NOT_CONFIGURED')
    if (activeSearches >= config.searchMaxConcurrent) throw createHttpError('搜索服务繁忙，请稍后重试', 429, 'SEARCH_BUSY')
    enforceSearchRateLimit(session.user.id)
    const reservation = db.reserveSearchCall({
      userId: session.user.id,
      conversationId,
      roundId,
      callId,
      requestHash,
      reserveMicros: config.searchPriceMicros,
      maxCallsPerRound: config.searchRoundLimit,
    })
    const call = reservation.call || reservation
    if (reservation.existing) {
      if (call.status === 'charged' && call.resultJson) {
        sendJson(res, 200, { success: true, data: JSON.parse(call.resultJson) })
        return
      }
      if (call.status === 'failed') throw createHttpError(call.error || '该搜索调用此前已失败', 409, 'SEARCH_CALL_FAILED')
      sendJson(res, 202, { success: true, data: { ok: false, pending: true } })
      return
    }

    activeSearches += 1
    try {
      db.markSearchCallSubmitted(call.id)
      const result = await callTavilySearch(input, {
        apiKey: config.tavilyApiKey,
        timeoutMs: config.searchTimeoutMs,
        fetch: options.fetch,
      })
      const billedResult = {
        ...result,
        billing: { charge_micros: config.searchPriceMicros, currency: 'CNY' },
      }
      db.settleSearchCall(call.id, {
        chargeMicros: config.searchPriceMicros,
        requestId: result.request_id || null,
        credits: result.usage?.credits || 1,
        resultJson: JSON.stringify(billedResult),
      })
      sendJson(res, 200, { success: true, data: billedResult })
    } catch (err) {
      db.failSearchCall(call.id, err instanceof Error ? err.message : String(err))
      sendJson(res, 200, { success: true, data: toSearchWebError(err) })
    } finally {
      activeSearches = Math.max(0, activeSearches - 1)
    }
  }

  const readDulupayNotification = async (req, url) => {
    const entries = [...url.searchParams.entries()]
    if (req.method === 'POST') {
      const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/x-www-form-urlencoded') throw createHttpError('Dulupay 回调格式无效', 400, 'DULUPAY_NOTIFY_INVALID')
      const body = await readRequestBody(req, 64 * 1024)
      entries.push(...new URLSearchParams(body.toString('utf8')).entries())
    }
    const params = {}
    for (const [key, value] of entries) {
      if (Object.hasOwn(params, key)) throw createHttpError('Dulupay 回调包含重复字段', 400, 'DULUPAY_NOTIFY_INVALID')
      params[key] = value
    }
    return params
  }

  const getPaymentIntent = (id) => {
    const product = db.getCheckoutIntent(id)
    if (product) return { kind: 'credits', intent: product }
    const balance = db.getBalanceCheckoutIntent(id)
    if (balance) return { kind: 'balance', intent: balance }
    return null
  }

  const settleDulupayPayment = (payment) => {
    if (!payment.paid) return { paid: false }
    const found = getPaymentIntent(payment.outTradeNo)
    if (!found) throw createHttpError('支付结算意向不存在', 404, 'CHECKOUT_INTENT_NOT_FOUND')
    if (found.intent.paymentProvider && found.intent.paymentProvider !== 'dulupay') throw createHttpError('支付渠道与结算意向不一致', 409, 'PAYMENT_PROVIDER_MISMATCH')
    if (found.intent.paymentExternalId && found.intent.paymentExternalId !== payment.tradeNo) throw createHttpError('支付订单号与结算意向不一致', 409, 'PAYMENT_TRADE_MISMATCH')
    if (payment.payType && found.intent.paymentType && payment.payType !== found.intent.paymentType) throw createHttpError('支付方式与结算意向不一致', 409, 'PAYMENT_TYPE_MISMATCH')
    const payloadHash = createHash('sha256').update(JSON.stringify({
      provider: 'dulupay',
      tradeNo: payment.tradeNo,
      outTradeNo: payment.outTradeNo,
      amountMicros: payment.amountMicros,
      paid: true,
    })).digest('hex')
    if (found.kind === 'credits') {
      return db.creditPayment({
        provider: 'dulupay',
        externalId: payment.tradeNo,
        userId: found.intent.userId,
        amountMicros: payment.amountMicros,
        productId: found.intent.productId,
        checkoutIntentId: found.intent.id,
        payloadHash,
      })
    }
    return db.creditPayment({
      provider: 'dulupay',
      externalId: payment.tradeNo,
      userId: found.intent.userId,
      amountMicros: payment.amountMicros,
      balanceCheckoutIntentId: found.intent.id,
      payloadHash,
    })
  }

  const handleDulupayNotify = async (req, res, url) => {
    if (!dulupay) {
      sendText(res, 503, 'fail')
      return
    }
    try {
      const params = await readDulupayNotification(req, url)
      settleDulupayPayment(dulupay.verifyNotification(params))
      sendText(res, 200, 'success')
    } catch (err) {
      console.warn(`[Dulupay notify] rejected: ${err?.code || 'UNKNOWN'}`)
      sendText(res, 200, 'fail')
    }
  }

  const handlePaymentWebhook = async (req, res) => {
    if (!config.paymentWebhookSecret) throw createHttpError('支付回调尚未配置', 503, 'PAYMENT_NOT_CONFIGURED')
    const body = await readRequestBody(req, 256 * 1024)
    const signature = String(req.headers['x-payment-signature'] || '').replace(/^sha256=/, '')
    const expected = createHmac('sha256', config.paymentWebhookSecret).update(body).digest('hex')
    const valid = signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    if (!valid) throw createHttpError('支付回调签名无效', 401, 'INVALID_PAYMENT_SIGNATURE')
    let payload
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      throw createHttpError('支付回调 JSON 无效', 400, 'INVALID_JSON')
    }
    if (payload.status !== 'paid') throw createHttpError('仅接受已支付事件', 400, 'PAYMENT_NOT_PAID')
    if (String(payload.currency || 'CNY').toUpperCase() !== 'CNY') throw createHttpError('支付币种不受支持', 400, 'UNSUPPORTED_CURRENCY')
    const externalId = String(payload.order_id || '').trim().slice(0, 128)
    if (!externalId) throw createHttpError('支付订单号不能为空', 400, 'INVALID_ORDER_ID')
    const productId = payload.product_id ? String(payload.product_id).trim().slice(0, 64) : ''
    const checkoutIntentId = payload.checkout_intent_id ? String(payload.checkout_intent_id).trim().slice(0, 128) : ''
    const balanceCheckoutIntentId = payload.balance_checkout_intent_id ? String(payload.balance_checkout_intent_id).trim().slice(0, 128) : ''
    const userId = payload.user_id != null && payload.user_id !== '' ? Number(payload.user_id) : undefined
    const amountMicros = parseMoneyToMicros(payload.amount)
    if (amountMicros <= 0) throw createHttpError('支付金额必须大于 0', 400, 'INVALID_AMOUNT')
    const result = db.creditPayment({
      provider: String(payload.provider || 'custom').slice(0, 64),
      externalId,
      email: payload.email,
      userId,
      amountMicros,
      productId: productId || undefined,
      checkoutIntentId: checkoutIntentId || undefined,
      balanceCheckoutIntentId: balanceCheckoutIntentId || undefined,
      payloadHash: createHash('sha256').update(body).digest('hex'),
    })
    sendJson(res, 200, { success: true, data: result })
  }

  const handlePlatformApi = async (req, res, url) => {
    const pathname = url.pathname
    if (pathname === '/api/platform/payment/dulupay/notify' && ['GET', 'POST'].includes(req.method)) {
      await handleDulupayNotify(req, res, url)
      return
    }
    if (pathname === '/api/platform/payment/webhook' && req.method === 'POST') {
      await handlePaymentWebhook(req, res)
      return
    }
    if (pathname === '/api/platform/payment/checkout' && req.method === 'POST') {
      enforceOrigin(req)
      const session = requireSession(req, true)
      enforceAuthRateLimit(req, 'payment-checkout', session.user.id)
      if (!paymentEnabled) throw createHttpError('支付入口尚未配置', 503, 'PAYMENT_NOT_CONFIGURED')
      const body = await readJsonBody(req, 32 * 1024)
      const productId = String(body.product_id || '').trim()
      const amountText = body.amount == null ? '' : String(body.amount).trim()
      if (productId && amountText) throw createHttpError('商品购买不能同时指定充值金额', 400, 'INVALID_CHECKOUT')
      if (!productId && !amountText) throw createHttpError('请选择商品或填写充值金额', 400, 'INVALID_CHECKOUT')
      const payType = String(body.pay_type || 'wxpay').trim()
      if (!['wxpay', 'alipay'].includes(payType)) throw createHttpError('不支持的支付方式', 400, 'DULUPAY_PAY_TYPE_INVALID')
      const rechargeAmountMicros = productId ? null : parseMoneyToMicros(amountText)
      if (rechargeAmountMicros != null && (rechargeAmountMicros < config.rechargeMinMicros || rechargeAmountMicros > config.rechargeMaxMicros)) {
        throw createHttpError(`充值金额需要在 ${formatMicrosAmount(config.rechargeMinMicros)} 至 ${formatMicrosAmount(config.rechargeMaxMicros)} 元之间`, 400, 'INVALID_AMOUNT')
      }
      const intent = productId
        ? db.createCheckoutIntent({
            userId: session.user.id,
            productId,
            ttlMs: config.paymentCheckoutTtlMs,
          })
        : db.createBalanceCheckoutIntent({
            userId: session.user.id,
            amountMicros: rechargeAmountMicros,
            ttlMs: config.paymentCheckoutTtlMs,
          })
      const order = dulupay ? await dulupay.createOrder({
        outTradeNo: intent.id,
        name: productId ? intent.productName : '对话余额充值',
        amountMicros: intent.amountMicros,
        clientIp: gateway.getClientIp(req),
        payType,
      }) : null
      if (dulupay) db.recordCheckoutPayment(intent.id, { provider: 'dulupay', externalId: order.tradeNo, paymentType: payType })
      const checkoutUrl = order?.payUrl || (!dulupay ? (productId ? buildCheckoutUrl(config.paymentUrl, intent) : buildBalanceCheckoutUrl(config.paymentUrl, intent)) : null)
      sendJson(res, 201, {
        success: true,
        data: {
          checkout_intent_id: intent.id,
          checkout_url: checkoutUrl,
          payment_display: dulupay ? order.presentation : 'redirect',
          qr_content: dulupay ? order.qrContent : null,
          kind: productId ? 'credits' : 'balance',
          product_id: productId ? intent.productId : null,
          user_id: intent.userId,
          amount: intent.amountMicros / 1000000,
          amount_micros: intent.amountMicros,
          credits: productId ? intent.credits : 0,
          expires_at: intent.expiresAt,
          pay_type: payType,
        },
      })
      return
    }
    if (pathname === '/api/platform/payment/recheck' && req.method === 'POST') {
      enforceOrigin(req)
      const session = requireSession(req, true)
      enforceAuthRateLimit(req, 'payment-recheck', session.user.id)
      if (!dulupay) throw createHttpError('Dulupay 尚未配置', 503, 'PAYMENT_NOT_CONFIGURED')
      const body = await readJsonBody(req, 32 * 1024)
      const intentId = String(body.checkout_intent_id || '').trim()
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(intentId)) throw createHttpError('支付结算意向无效', 400, 'INVALID_CHECKOUT_INTENT')
      const found = getPaymentIntent(intentId)
      if (!found) throw createHttpError('支付结算意向不存在', 404, 'CHECKOUT_INTENT_NOT_FOUND')
      if (found.intent.userId !== session.user.id) throw createHttpError('支付结算意向不属于当前账户', 403, 'CHECKOUT_INTENT_FORBIDDEN')
      if (found.intent.status === 'paid') {
        sendJson(res, 200, { success: true, data: { paid: true, duplicate: true, kind: found.kind, status: 'paid' } })
        return
      }
      if (found.intent.expiresAt <= Date.now()) {
        sendJson(res, 200, { success: true, data: { paid: false, kind: found.kind, status: 'expired' } })
        return
      }
      const payment = await dulupay.queryOrder(intentId)
      const result = payment.paid ? settleDulupayPayment(payment) : null
      sendJson(res, 200, { success: true, data: { paid: payment.paid, kind: found.kind, status: payment.paid ? 'paid' : 'pending', ...(result || {}) } })
      return
    }
    if (pathname === '/api/platform/tools/search-web' && req.method === 'POST') {
      enforceOrigin(req)
      await handleSearchWeb(req, res)
      return
    }
    if (pathname === '/api/platform/agent-rounds/finish' && req.method === 'POST') {
      enforceOrigin(req)
      const session = requireSession(req, true)
      const body = await readJsonBody(req, 32 * 1024)
      const conversationId = String(body.conversation_id || '').trim()
      const roundId = String(body.round_id || '').trim()
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(conversationId)) throw createHttpError('Agent 对话 ID 无效', 400, 'INVALID_CONVERSATION_ID')
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(roundId)) throw createHttpError('Agent 轮次 ID 无效', 400, 'INVALID_ROUND_ID')
      const round = db.finishBillingRound({ userId: session.user.id, conversationId, roundId, status: 'completed' })
      if (!round) throw createHttpError('Agent 计费轮次不存在', 404, 'ROUND_NOT_FOUND')
      sendJson(res, 200, { success: true, data: serializeBillingRound(round) })
      return
    }
    if (pathname === '/api/platform/status' && req.method === 'GET') {
      sendJson(res, 200, {
        success: true,
        data: {
          system_name: config.systemName,
          email_verification: true,
          register_enabled: auth.registrationEnabled,
          password_register_enabled: auth.registrationEnabled,
          turnstile_check: auth.turnstileEnabled,
          turnstile_site_key: auth.turnstileEnabled ? auth.turnstileSiteKey : '',
          quota_per_unit: 1000000,
          display_in_currency: true,
          quota_display_type: 'CNY',
          image_studio: {
            image_unit_price: config.imageUnitPriceMicros / 1000000,
            payment_url: config.paymentUrl,
            payment_enabled: paymentEnabled,
            payment_provider: dulupay ? 'dulupay' : config.paymentUrl ? 'custom' : null,
            payment_types: dulupay ? ['wxpay', 'alipay'] : [],
            recharge_min: config.rechargeMinMicros / 1000000,
            recharge_max: config.rechargeMaxMicros / 1000000,
            generation_min_role: config.generationMinRole,
            agent_min_role: config.agentMinRole,
            relay_configured: Boolean(config.relayBaseUrl),
            agent_configured: Boolean(config.agentBaseUrl && config.agentApiKey),
            search_configured: Boolean(config.tavilyApiKey),
            search_price: config.searchPriceMicros / 1000000,
            default_agent_model: db.getDefaultAgentModel?.()?.id || null,
            image_models: Object.values(config.imageModels).filter(Boolean),
            products: db.listProducts({ activeOnly: true }).map(serializeProduct),
          },
        },
      })
      return
    }
    if (pathname === '/api/platform/session' && req.method === 'GET') {
      const session = requireSession(req)
      sendJson(res, 200, { success: true, data: serializeUser(session.user, gateway) })
      return
    }
    if (pathname === '/api/platform/agent-models' && req.method === 'GET') {
      requireSession(req)
      let models = db.listAgentModels({ selectableOnly: true })
      if (models.length === 0 && config.agentBaseUrl && config.agentApiKey) {
        await refreshAgentModels(false)
        models = db.listAgentModels({ selectableOnly: true })
      }
      sendJson(res, 200, {
        success: true,
        data: {
          models: models.map(serializeAgentModel),
          default_model: models.find((model) => model.isDefault && model.selectable)?.id || null,
        },
      })
      return
    }
    if (pathname === '/api/platform/billing' && req.method === 'GET') {
      const session = requireSession(req)
      sendJson(res, 200, {
        success: true,
        data: {
          ...serializeUser(session.user, gateway),
          payment_url: config.paymentUrl,
          payment_enabled: paymentEnabled,
          payment_provider: dulupay ? 'dulupay' : config.paymentUrl ? 'custom' : null,
          payment_types: dulupay ? ['wxpay', 'alipay'] : [],
          recharge_min: config.rechargeMinMicros / 1000000,
          recharge_max: config.rechargeMaxMicros / 1000000,
          image_unit_price: config.imageUnitPriceMicros / 1000000,
          products: db.listProducts({ activeOnly: true }).map(serializeProduct),
          entries: db.listLedger(session.user.id, url.searchParams.get('limit')),
          agent_rounds: db.listBillingRounds?.(session.user.id, url.searchParams.get('round_limit') || 30).map(serializeBillingRound) || [],
        },
      })
      return
    }
    const generationMatch = pathname.match(/^\/api\/platform\/generations\/([A-Za-z0-9_-]{16,128})$/)
    if (generationMatch && req.method === 'GET') {
      await gateway.sendGenerationResult(req, res, generationMatch[1])
      return
    }

    if (req.method !== 'GET') enforceOrigin(req)
    if (pathname === '/api/platform/auth/login' && req.method === 'POST') {
      const body = await readJsonBody(req)
      enforceAuthRateLimit(req, 'login', body.email || body.username)
      await auth.verifyTurnstile(body.turnstile, gateway.getClientIp(req))
      const result = await auth.login({
        email: body.email || body.username,
        password: body.password,
        ip: gateway.getClientIp(req),
        userAgent: req.headers['user-agent'],
      })
      sendJson(res, 200, {
        success: true,
        data: { id: result.user.id, require_2fa: false },
      }, createAuthCookies(result.session, config.cookieSecure, auth.sessionTtlMs))
      return
    }
    if (pathname === '/api/platform/auth/verification' && req.method === 'POST') {
      const body = await readJsonBody(req)
      enforceAuthRateLimit(req, 'verification', body.email)
      await auth.verifyTurnstile(body.turnstile, gateway.getClientIp(req))
      const data = await auth.sendCode({ email: body.email, purpose: 'register', ip: gateway.getClientIp(req) })
      sendJson(res, 200, { success: true, data })
      return
    }
    if (pathname === '/api/platform/auth/register' && req.method === 'POST') {
      const body = await readJsonBody(req)
      enforceAuthRateLimit(req, 'register', body.email)
      await auth.verifyTurnstile(body.turnstile, gateway.getClientIp(req))
      await auth.register({ email: body.email, password: body.password, code: body.verification_code })
      sendJson(res, 201, { success: true, data: {} })
      return
    }
    if (pathname === '/api/platform/auth/reset-verification' && req.method === 'POST') {
      const body = await readJsonBody(req)
      enforceAuthRateLimit(req, 'reset-verification', body.email)
      await auth.verifyTurnstile(body.turnstile, gateway.getClientIp(req))
      const data = await auth.sendCode({ email: body.email, purpose: 'password_reset', ip: gateway.getClientIp(req) })
      sendJson(res, 200, { success: true, data })
      return
    }
    if (pathname === '/api/platform/auth/reset-password' && req.method === 'POST') {
      const body = await readJsonBody(req)
      enforceAuthRateLimit(req, 'reset-password', body.email)
      await auth.verifyTurnstile(body.turnstile, gateway.getClientIp(req))
      await auth.resetPassword({ email: body.email, password: body.password, code: body.verification_code })
      sendJson(res, 200, { success: true, data: {} }, clearAuthCookies(config.cookieSecure))
      return
    }
    if (pathname === '/api/platform/auth/logout' && req.method === 'POST') {
      const token = getSessionToken(req, config.cookieSecure)
      if (token) db.revokeSession(token)
      sendJson(res, 200, { success: true, data: {} }, clearAuthCookies(config.cookieSecure))
      return
    }
    if (pathname === '/api/platform/redeem' && req.method === 'POST') {
      const session = requireSession(req, true)
      const body = await readJsonBody(req)
      const result = db.redeemCode(session.user.id, body.code)
      sendJson(res, 200, { success: true, data: { ...serializeUser(result.user, gateway), granted: result.granted } })
      return
    }
    if (pathname === '/api/platform/admin/users' && req.method === 'GET') {
      const session = requireSession(req)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const users = db.listUsers(url.searchParams.get('search'), url.searchParams.get('limit'))
      sendJson(res, 200, { success: true, data: users.map((user) => serializeUser(user, gateway)) })
      return
    }
    if (pathname === '/api/platform/admin/agent-models' && req.method === 'GET') {
      const session = requireSession(req)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const models = db.listAgentModels()
      sendJson(res, 200, {
        success: true,
        data: {
          models: models.map(serializeAgentModel),
          default_model: db.getDefaultAgentModel()?.id || null,
        },
      })
      return
    }
    if (pathname === '/api/platform/admin/agent-models/refresh' && req.method === 'POST') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      sendJson(res, 200, { success: true, data: await refreshAgentModels(true) })
      return
    }
    const adminAgentModelMatch = pathname.match(/^\/api\/platform\/admin\/agent-models\/([^/]+)$/)
    if (adminAgentModelMatch && req.method === 'PATCH') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const body = await readJsonBody(req)
      const model = db.configureAgentModel(session.user.id, decodeURIComponent(adminAgentModelMatch[1]), {
        label: body.label,
        enabled: body.enabled,
        sortOrder: body.sort_order,
        isDefault: body.is_default,
        inputTokenPriceMicros: body.input_price_micros,
        cachedInputTokenPriceMicros: body.cached_input_price_micros,
        outputTokenPriceMicros: body.output_price_micros,
        maxStepReserveMicros: body.max_step_reserve_micros,
      })
      sendJson(res, 200, { success: true, data: serializeAgentModel(model) })
      return
    }
    const adminUserMatch = pathname.match(/^\/api\/platform\/admin\/users\/(\d+)$/)
    if (adminUserMatch && req.method === 'PATCH') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const user = db.updateUserAccess(session.user.id, Number(adminUserMatch[1]), await readJsonBody(req))
      sendJson(res, 200, { success: true, data: serializeUser(user, gateway) })
      return
    }
    const adminCreditMatch = pathname.match(/^\/api\/platform\/admin\/users\/(\d+)\/balance$/)
    if (adminCreditMatch && req.method === 'POST') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const body = await readJsonBody(req)
      const user = db.adjustBalance(session.user.id, Number(adminCreditMatch[1]), parseMoneyToMicros(body.amount), body.note)
      sendJson(res, 200, { success: true, data: serializeUser(user, gateway) })
      return
    }
    const adminMembershipMatch = pathname.match(/^\/api\/platform\/admin\/users\/(\d+)\/membership$/)
    if (adminMembershipMatch && req.method === 'POST') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const body = await readJsonBody(req)
      const user = db.adminGrantMembership(session.user.id, Number(adminMembershipMatch[1]), Number(body.days), body.note)
      sendJson(res, 200, { success: true, data: serializeUser(user, gateway) })
      return
    }
    const adminGrantCreditsMatch = pathname.match(/^\/api\/platform\/admin\/users\/(\d+)\/credits$/)
    if (adminGrantCreditsMatch && req.method === 'POST') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const body = await readJsonBody(req)
      const user = db.adminGrantCredits(session.user.id, Number(adminGrantCreditsMatch[1]), Number(body.credits), body.note)
      sendJson(res, 200, { success: true, data: serializeUser(user, gateway) })
      return
    }
    if (pathname === '/api/platform/admin/products' && req.method === 'GET') {
      const session = requireSession(req)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      sendJson(res, 200, { success: true, data: db.listProducts().map(serializeProduct) })
      return
    }
    if (pathname === '/api/platform/admin/products' && req.method === 'POST') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const body = await readJsonBody(req)
      const product = db.upsertProduct(session.user.id, {
        id: body.id,
        kind: body.kind,
        name: body.name,
        description: body.description,
        priceMicros: body.price != null ? parseMoneyToMicros(body.price) : Number(body.price_micros),
        durationDays: body.duration_days,
        credits: body.credits,
        sortOrder: body.sort_order,
        active: body.active,
      })
      sendJson(res, 200, { success: true, data: serializeProduct(product) })
      return
    }
    const adminProductMatch = pathname.match(/^\/api\/platform\/admin\/products\/([A-Za-z0-9][A-Za-z0-9_-]{1,63})$/)
    if (adminProductMatch && req.method === 'DELETE') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      sendJson(res, 200, { success: true, data: db.deleteProduct(session.user.id, adminProductMatch[1]) })
      return
    }
    if (pathname === '/api/platform/admin/redemption-codes' && req.method === 'GET') {
      const session = requireSession(req)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const unusedOnly = url.searchParams.get('unused') === '1'
      sendJson(res, 200, { success: true, data: db.listRedemptionCodes({
        limit: url.searchParams.get('limit'),
        unusedOnly,
        search: url.searchParams.get('search'),
        status: url.searchParams.get('status'),
      }).map(serializeRedemptionCode) })
      return
    }
    if (pathname === '/api/platform/admin/redemption-codes' && req.method === 'POST') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const body = await readJsonBody(req)
      const codes = db.createRedemptionCodes(session.user.id, {
        credits: body.credits,
        membershipDays: body.membership_days,
        balanceMicros: body.balance != null && body.balance !== '' ? parseMoneyToMicros(body.balance) : 0,
        count: body.count,
        note: body.note,
        expiresAt: body.expires_at,
        maxRedemptions: body.max_redemptions,
        enabled: body.enabled,
      })
      sendJson(res, 200, { success: true, data: { codes } })
      return
    }
    const adminRedemptionMatch = pathname.match(/^\/api\/platform\/admin\/redemption-codes\/([^/]+)$/)
    if (adminRedemptionMatch && req.method === 'PATCH') {
      const session = requireSession(req, true)
      if (!isAdmin(session.user)) throw createHttpError('需要管理员权限', 403, 'ADMIN_REQUIRED')
      const body = await readJsonBody(req)
      if (typeof body.enabled !== 'boolean') throw createHttpError('兑换码状态无效', 400, 'INVALID_REDEMPTION_STATUS')
      const code = db.setRedemptionCodeEnabled(session.user.id, decodeURIComponent(adminRedemptionMatch[1]), body.enabled)
      sendJson(res, 200, { success: true, data: serializeRedemptionCode(code) })
      return
    }
    throw createHttpError('Not Found', 404, 'NOT_FOUND')
  }

  const server = createServer(async (req, res) => {
    setSecurityHeaders(res)
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname === '/healthz') {
        sendJson(res, 200, { ok: true })
        return
      }
      if (url.pathname.startsWith('/api/platform/')) {
        await handlePlatformApi(req, res, url)
        return
      }
      if (url.pathname.startsWith('/api-proxy/')) {
        await gateway.relay(req, res, url.pathname.slice('/api-proxy/'.length))
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw createHttpError('Method Not Allowed', 405, 'METHOD_NOT_ALLOWED')
      serveStatic(req, res, url.pathname)
    } catch (err) {
      if ((err.status || 500) >= 500) console.error(err)
      if (!res.headersSent) {
        const cookies = err.status === 401 ? clearAuthCookies(config.cookieSecure) : undefined
        sendJson(res, err.status || 500, {
          success: false,
          message: err.message || '平台服务暂时不可用',
          ...(err.code ? { code: err.code } : {}),
        }, cookies)
      } else if (!res.destroyed) {
        res.destroy(err)
      }
    }
  })
  server.headersTimeout = config.headersTimeoutMs
  server.requestTimeout = config.requestTimeoutMs
  server.keepAliveTimeout = config.keepAliveTimeoutMs

  return {
    server,
    db,
    auth,
    gateway,
    dulupay,
    config,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else {
          db.close()
          resolvePromise()
        }
      })
    }),
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const app = createPlatformApp()
  app.server.listen(app.config.port, app.config.host, () => {
    console.log(`KunAI Studio server listening on http://${app.config.host}:${app.config.port}`)
    console.log(`Account database: ${app.config.dbPath}`)
    console.log(`Image upstream: ${app.config.relayBaseUrl || 'not configured'}`)
  })
}
