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

function loadConfig(env) {
  const production = env.NODE_ENV === 'production'
  const appOrigin = String(env.APP_ORIGIN || '').trim()
  const relayBaseUrl = String(env.IMAGE_UPSTREAM_BASE_URL || env.RELAY_BASE_URL || '').trim()
  const paymentWebhookSecret = String(env.PAYMENT_WEBHOOK_SECRET || '').trim()
  if (production && !appOrigin) throw new Error('生产环境必须配置 APP_ORIGIN')
  if (production && new URL(appOrigin).protocol !== 'https:') throw new Error('生产环境 APP_ORIGIN 必须使用 HTTPS')
  if (production && env.PLATFORM_COOKIE_SECURE === 'false') throw new Error('生产环境不能关闭 Secure Cookie')
  if (production && relayBaseUrl && new URL(relayBaseUrl).protocol !== 'https:') {
    throw new Error('生产环境 IMAGE_UPSTREAM_BASE_URL 必须使用 HTTPS')
  }
  if (production && paymentWebhookSecret && (paymentWebhookSecret.length < 32 || /^replace-|placeholder/i.test(paymentWebhookSecret))) {
    throw new Error('生产环境 PAYMENT_WEBHOOK_SECRET 必须使用至少 32 个字符的随机密钥，留空可禁用支付回调')
  }

  return {
    production,
    host: env.HOST || '0.0.0.0',
    port: Number(env.PLATFORM_PORT || env.PORT || 3001),
    appOrigin,
    systemName: env.PLATFORM_SYSTEM_NAME || 'Image Studio',
    cookieSecure: env.PLATFORM_COOKIE_SECURE === undefined || env.PLATFORM_COOKIE_SECURE === ''
      ? production
      : parseBoolean(env.PLATFORM_COOKIE_SECURE),
    trustProxy: parseBoolean(env.PLATFORM_TRUST_PROXY),
    dbPath: resolve(ROOT_DIR, env.PLATFORM_DB_PATH || join('data', 'image-studio.sqlite')),
    resultDir: resolve(ROOT_DIR, env.PLATFORM_RESULT_DIR || join('data', 'results')),
    relayBaseUrl,
    relayApiKey: env.IMAGE_UPSTREAM_API_KEY || env.RELAY_API_KEY || '',
    paymentUrl: env.PAYMENT_URL || '',
    paymentWebhookSecret,
    imageUnitPriceMicros: parseMoneyToMicros(env.IMAGE_UNIT_PRICE || '0.07'),
    signupCreditMicros: parseMoneyToMicros(env.PLATFORM_SIGNUP_CREDIT || '0'),
    imageModel: env.PLATFORM_IMAGE_MODEL || env.VITE_PLATFORM_IMAGE_MODEL || 'gpt-image-2',
    imageModels: {
      '1k': env.PLATFORM_IMAGE_MODEL_1K || '',
      '2k': env.PLATFORM_IMAGE_MODEL_2K || '',
      '4k': env.PLATFORM_IMAGE_MODEL_4K || '',
    },
    agentModel: env.PLATFORM_AGENT_MODEL || env.VITE_PLATFORM_AGENT_MODEL || 'gpt-5.5',
    generationMinRole: Number(env.PLATFORM_GENERATION_MIN_ROLE || 1),
    agentMinRole: Number(env.PLATFORM_AGENT_MIN_ROLE || 1),
    allowedGroups: String(env.PLATFORM_ALLOWED_GROUPS || '').split(',').map((item) => item.trim()).filter(Boolean),
    maxRelayBodyBytes: Number(env.PLATFORM_MAX_RELAY_BODY_MB || 128) * 1024 * 1024,
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
    created_at: code.createdAt,
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
    baseUrl: config.relayBaseUrl,
    apiKey: config.relayApiKey,
    db,
    expectedOrigin: config.appOrigin,
    generationMinRole: config.generationMinRole,
    agentMinRole: config.agentMinRole,
    allowedGroups: config.allowedGroups,
    imageModel: config.imageModel,
    imageModels: config.imageModels,
    agentModel: config.agentModel,
    imagePriceMicros: config.imageUnitPriceMicros,
    resultDir: config.resultDir,
    maxImagePixels: config.maxImagePixels,
    minResultFreeBytes: config.minResultFreeBytes,
    secureCookies: config.cookieSecure,
    trustProxy: config.trustProxy,
    maxRelayBodyBytes: config.maxRelayBodyBytes,
    maxUpstreamBodyBytes: config.maxUpstreamBodyBytes,
    maxConcurrentRelays: config.maxConcurrentRelays,
    maxQueuedRelaysPerUser: config.maxQueuedRelaysPerUser,
    queueTimeoutMs: config.queueTimeoutMs,
    relayTimeoutMs: config.relayTimeoutMs,
    fetch: options.fetch,
  })
  const authRateLimits = new Map()

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
    if (String(payload.currency || 'USD').toUpperCase() !== 'USD') throw createHttpError('支付币种不受支持', 400, 'UNSUPPORTED_CURRENCY')
    const externalId = String(payload.order_id || '').trim().slice(0, 128)
    if (!externalId) throw createHttpError('支付订单号不能为空', 400, 'INVALID_ORDER_ID')
    const productId = payload.product_id ? String(payload.product_id).trim().slice(0, 64) : ''
    const userId = payload.user_id != null && payload.user_id !== '' ? Number(payload.user_id) : undefined
    // Product purchases (membership / credit packs) derive the amount from the
    // product definition; only legacy raw top-ups require an `amount` field.
    let amountMicros = 0
    if (!productId) {
      amountMicros = parseMoneyToMicros(payload.amount)
      if (amountMicros <= 0) throw createHttpError('支付金额必须大于 0', 400, 'INVALID_AMOUNT')
    }
    const result = db.creditPayment({
      provider: String(payload.provider || 'custom').slice(0, 64),
      externalId,
      email: payload.email,
      userId,
      amountMicros,
      productId: productId || undefined,
      payloadHash: createHash('sha256').update(body).digest('hex'),
    })
    sendJson(res, 200, { success: true, data: result })
  }

  const handlePlatformApi = async (req, res, url) => {
    const pathname = url.pathname
    if (pathname === '/api/platform/payment/webhook' && req.method === 'POST') {
      await handlePaymentWebhook(req, res)
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
          quota_display_type: 'USD',
          image_studio: {
            image_unit_price: config.imageUnitPriceMicros / 1000000,
            payment_url: config.paymentUrl,
            generation_min_role: config.generationMinRole,
            agent_min_role: config.agentMinRole,
            relay_configured: Boolean(config.relayBaseUrl),
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
    if (pathname === '/api/platform/billing' && req.method === 'GET') {
      const session = requireSession(req)
      sendJson(res, 200, {
        success: true,
        data: {
          ...serializeUser(session.user, gateway),
          payment_url: config.paymentUrl,
          image_unit_price: config.imageUnitPriceMicros / 1000000,
          products: db.listProducts({ activeOnly: true }).map(serializeProduct),
          entries: db.listLedger(session.user.id, url.searchParams.get('limit')),
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
      sendJson(res, 200, { success: true, data: db.listRedemptionCodes({ limit: url.searchParams.get('limit'), unusedOnly }).map(serializeRedemptionCode) })
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
      })
      sendJson(res, 200, { success: true, data: { codes } })
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
    console.log(`Image Studio server listening on http://${app.config.host}:${app.config.port}`)
    console.log(`Account database: ${app.config.dbPath}`)
    console.log(`Image upstream: ${app.config.relayBaseUrl || 'not configured'}`)
  })
}
