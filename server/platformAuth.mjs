import { createHmac, randomBytes, randomInt, scrypt as scryptCallback, scryptSync, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import nodemailer from 'nodemailer'
import { hashToken, normalizeEmail } from './platformDb.mjs'

const scrypt = promisify(scryptCallback)
const LOCAL_SESSION_COOKIE = 'kunai_studio_session'
const SECURE_SESSION_COOKIE = '__Host-kunai_studio_session'
const LOCAL_CSRF_COOKIE = 'kunai_studio_csrf'
const SECURE_CSRF_COOKIE = '__Host-kunai_studio_csrf'
const LEGACY_LOCAL_SESSION_COOKIE = 'image_studio_session'
const LEGACY_SECURE_SESSION_COOKIE = '__Host-image_studio_session'
const LEGACY_LOCAL_CSRF_COOKIE = 'image_studio_csrf'
const LEGACY_SECURE_CSRF_COOKIE = '__Host-image_studio_csrf'
const PASSWORD_KEY_BYTES = 64
const SCRYPT_COST = 32768
const DUMMY_PASSWORD_SALT = Buffer.from('kunai-studio-login-dummy-salt')
const DUMMY_PASSWORD_HASH = `scrypt$${SCRYPT_COST}$${DUMMY_PASSWORD_SALT.toString('base64url')}$${scryptSync('not-a-real-password', DUMMY_PASSWORD_SALT, PASSWORD_KEY_BYTES, {
  N: SCRYPT_COST,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
}).toString('base64url')}`

function createError(message, status = 400, code) {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

export function validatePassword(value) {
  const password = String(value || '')
  if (password.length < 8 || password.length > 128) {
    throw createError('密码长度需要在 8 至 128 个字符之间', 400, 'INVALID_PASSWORD')
  }
  return password
}

export async function hashPassword(value) {
  const password = validatePassword(value)
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, PASSWORD_KEY_BYTES, {
    N: SCRYPT_COST,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  return `scrypt$${SCRYPT_COST}$${Buffer.from(salt).toString('base64url')}$${Buffer.from(key).toString('base64url')}`
}

export async function verifyPassword(value, encoded) {
  const parts = String(encoded || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false
  const cost = Number(parts[1])
  const salt = Buffer.from(parts[2], 'base64url')
  const expected = Buffer.from(parts[3], 'base64url')
  if (!Number.isInteger(cost) || cost < 16384 || expected.length !== PASSWORD_KEY_BYTES) return false
  const actual = await scrypt(String(value || ''), salt, expected.length, {
    N: cost,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  return timingSafeEqual(expected, Buffer.from(actual))
}

export function parseCookies(value = '') {
  const cookies = {}
  for (const part of value.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 1) continue
    const key = part.slice(0, idx).trim()
    const raw = part.slice(idx + 1).trim()
    try {
      cookies[key] = decodeURIComponent(raw)
    } catch {
      cookies[key] = raw
    }
  }
  return cookies
}

export function getSessionToken(req, secureOnly = false) {
  const cookies = parseCookies(req.headers.cookie)
  return cookies[SECURE_SESSION_COOKIE]
    || cookies[LEGACY_SECURE_SESSION_COOKIE]
    || (secureOnly ? '' : cookies[LOCAL_SESSION_COOKIE] || cookies[LEGACY_LOCAL_SESSION_COOKIE])
    || ''
}

export function getCsrfToken(req) {
  return String(req.headers['x-csrf-token'] || '')
}

function createCookie(name, value, options = {}) {
  const parts = [
    `${name}=${options.clear ? '' : encodeURIComponent(String(value))}`,
    'Path=/',
    'SameSite=Lax',
    options.clear ? 'Max-Age=0' : `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds || 0))}`,
  ]
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

export function createAuthCookies(session, secure, ttlMs) {
  const sessionName = secure ? SECURE_SESSION_COOKIE : LOCAL_SESSION_COOKIE
  const csrfName = secure ? SECURE_CSRF_COOKIE : LOCAL_CSRF_COOKIE
  const maxAgeSeconds = ttlMs / 1000
  return [
    createCookie(sessionName, session.token, { httpOnly: true, secure, maxAgeSeconds }),
    createCookie(csrfName, session.csrfToken, { secure, maxAgeSeconds }),
  ]
}

export function clearAuthCookies(secure) {
  return [
    createCookie(LOCAL_SESSION_COOKIE, '', { httpOnly: true, clear: true }),
    createCookie(LOCAL_CSRF_COOKIE, '', { clear: true }),
    createCookie(SECURE_SESSION_COOKIE, '', { httpOnly: true, secure: true, clear: true }),
    createCookie(SECURE_CSRF_COOKIE, '', { secure: true, clear: true }),
    createCookie(LEGACY_LOCAL_SESSION_COOKIE, '', { httpOnly: true, clear: true }),
    createCookie(LEGACY_LOCAL_CSRF_COOKIE, '', { clear: true }),
    createCookie(LEGACY_SECURE_SESSION_COOKIE, '', { httpOnly: true, secure: true, clear: true }),
    createCookie(LEGACY_SECURE_CSRF_COOKIE, '', { secure: true, clear: true }),
  ]
}

function createMailer(options) {
  if (!options.smtpHost) return null
  return nodemailer.createTransport({
    host: options.smtpHost,
    port: options.smtpPort,
    secure: options.smtpSecure,
    auth: options.smtpUser && options.smtpPass
      ? { user: options.smtpUser, pass: options.smtpPass }
      : undefined,
    connectionTimeout: options.smtpConnectionTimeoutMs,
    greetingTimeout: options.smtpConnectionTimeoutMs,
    socketTimeout: options.smtpSocketTimeoutMs,
    tls: { rejectUnauthorized: true },
  })
}

export class PlatformAuth {
  constructor(options) {
    this.db = options.db
    this.systemName = options.systemName || 'KunAI Studio'
    this.production = Boolean(options.production)
    this.secret = String(options.secret || '')
    this.sessionTtlMs = Number(options.sessionTtlMs) || 30 * 24 * 60 * 60 * 1000
    this.codeTtlMs = Number(options.codeTtlMs) || 10 * 60 * 1000
    this.codeCooldownMs = Number(options.codeCooldownMs) || 60 * 1000
    this.codeMaxAttempts = Number(options.codeMaxAttempts) || 5
    this.codeEmailHourlyLimit = Number(options.codeEmailHourlyLimit) || 6
    this.codeEmailDailyLimit = Number(options.codeEmailDailyLimit) || 20
    this.codeIpHourlyLimit = Number(options.codeIpHourlyLimit) || 30
    this.codeIpDailyLimit = Number(options.codeIpDailyLimit) || 100
    this.registrationEnabled = options.registrationEnabled !== false
    this.allowedEmailDomains = new Set(options.allowedEmailDomains || [])
    this.adminEmails = new Set(options.adminEmails || [])
    this.defaultRole = Number(options.defaultRole ?? 1)
    this.defaultGroup = options.defaultGroup || 'default'
    this.signupCreditMicros = Number(options.signupCreditMicros) || 0
    this.smtpFrom = options.smtpFrom || options.smtpUser || ''
    this.mailer = createMailer(options)
    this.turnstileSiteKey = String(options.turnstileSiteKey || '')
    this.turnstileSecretKey = String(options.turnstileSecretKey || '')
    this.fetch = options.fetch || globalThis.fetch
    this.maxPasswordHashConcurrency = Math.max(1, Number(options.maxPasswordHashConcurrency) || 4)
    this.activePasswordHashes = 0

    if (this.production && (this.secret.length < 32 || /^replace-|placeholder/i.test(this.secret))) {
      throw new Error('生产环境必须配置至少 32 个字符的 PLATFORM_AUTH_SECRET')
    }
    if (this.production && this.registrationEnabled && (!this.mailer || !this.smtpFrom)) {
      throw new Error('生产环境启用注册时必须完整配置 SMTP_HOST 和 SMTP_FROM')
    }
    if (Boolean(this.turnstileSiteKey) !== Boolean(this.turnstileSecretKey)) {
      throw new Error('TURNSTILE_SITE_KEY 与 TURNSTILE_SECRET_KEY 必须同时配置')
    }
    if (!Number.isInteger(this.defaultRole) || this.defaultRole < 0 || this.defaultRole >= 10) {
      throw new Error('PLATFORM_DEFAULT_ROLE 必须是 0 至 9 的整数，管理员只能通过 PLATFORM_ADMIN_EMAILS 授予')
    }
    for (const email of this.adminEmails) this.assertEmailDomain(email)
  }

  get turnstileEnabled() {
    return Boolean(this.turnstileSiteKey && this.turnstileSecretKey)
  }

  async runPasswordHash(fn) {
    if (this.activePasswordHashes >= this.maxPasswordHashConcurrency) {
      throw createError('登录与注册请求较多，请稍后重试', 429, 'PASSWORD_HASH_BUSY')
    }
    this.activePasswordHashes += 1
    try {
      return await fn()
    } finally {
      this.activePasswordHashes -= 1
    }
  }

  hashCode(email, purpose, code) {
    return createHmac('sha256', this.secret).update(`${purpose}:${normalizeEmail(email)}:${code}`).digest('hex')
  }

  async verifyTurnstile(token, ip) {
    if (!this.turnstileEnabled) return
    if (!token) throw createError('请先完成人机验证', 400, 'TURNSTILE_REQUIRED')
    const body = new URLSearchParams({ secret: this.turnstileSecretKey, response: String(token) })
    if (ip) body.set('remoteip', ip)
    let response
    try {
      response = await this.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      throw createError('人机验证服务暂时不可用', 503, 'TURNSTILE_UNAVAILABLE')
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success) throw createError('人机验证未通过，请重试', 400, 'TURNSTILE_FAILED')
  }

  assertEmailDomain(email) {
    if (this.allowedEmailDomains.size === 0) return
    const domain = normalizeEmail(email).split('@')[1]
    if (!this.allowedEmailDomains.has(domain)) {
      throw createError('当前邮箱域名不在允许注册范围内', 400, 'EMAIL_DOMAIN_BLOCKED')
    }
  }

  async sendCode({ email, purpose, ip }) {
    const normalizedEmail = normalizeEmail(email)
    if (purpose === 'register') {
      if (!this.registrationEnabled) throw createError('当前暂未开放注册', 403, 'REGISTRATION_DISABLED')
      this.assertEmailDomain(normalizedEmail)
    }
    const existing = this.db.findUserByEmail(normalizedEmail)
    const shouldSend = purpose === 'register' ? !existing : Boolean(existing)
    if (!shouldSend) return {}

    const code = String(randomInt(0, 1000000)).padStart(6, '0')
    const challengeId = this.db.createChallenge({
      email: normalizedEmail,
      purpose,
      codeHash: this.hashCode(normalizedEmail, purpose, code),
      expiresAt: Date.now() + this.codeTtlMs,
      requestedIpHash: ip ? hashToken(ip) : null,
      cooldownMs: this.codeCooldownMs,
      emailHourlyLimit: this.codeEmailHourlyLimit,
      emailDailyLimit: this.codeEmailDailyLimit,
      ipHourlyLimit: this.codeIpHourlyLimit,
      ipDailyLimit: this.codeIpDailyLimit,
    })
    const purposeLabel = purpose === 'register' ? '注册' : '重置密码'
    if (!this.mailer) {
      if (this.production) throw createError('邮件服务尚未配置', 503, 'SMTP_NOT_CONFIGURED')
      console.log(`[开发验证码] ${normalizedEmail} ${purposeLabel}: ${code}`)
      return { dev_code: code }
    }

    try {
      await this.mailer.sendMail({
        from: this.smtpFrom,
        to: normalizedEmail,
        subject: `${this.systemName} ${purposeLabel}验证码`,
        text: `你的${purposeLabel}验证码是 ${code}，${Math.floor(this.codeTtlMs / 60000)} 分钟内有效。若非本人操作，请忽略本邮件。`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#282724"><h2>${this.systemName}</h2><p>你的${purposeLabel}验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>${Math.floor(this.codeTtlMs / 60000)} 分钟内有效。若非本人操作，请忽略本邮件。</p></div>`,
      })
      return {}
    } catch (err) {
      this.db.deleteChallenge(challengeId)
      console.error('发送验证码邮件失败', err)
      throw createError('验证码邮件发送失败，请稍后重试', 502, 'SMTP_SEND_FAILED')
    }
  }

  async register({ email, password, code }) {
    const normalizedEmail = normalizeEmail(email)
    if (!this.registrationEnabled) throw createError('当前暂未开放注册', 403, 'REGISTRATION_DISABLED')
    this.assertEmailDomain(normalizedEmail)
    const codeHash = this.hashCode(normalizedEmail, 'register', String(code || '').trim())
    this.db.validateChallenge({
      email: normalizedEmail,
      purpose: 'register',
      codeHash,
      maxAttempts: this.codeMaxAttempts,
    })
    const passwordHash = await this.runPasswordHash(() => hashPassword(password))
    const isAdmin = this.adminEmails.has(normalizedEmail)
    return this.db.registerUser({
      email: normalizedEmail,
      passwordHash,
      displayName: normalizedEmail.split('@')[0],
      role: isAdmin ? 10 : this.defaultRole,
      group: isAdmin ? 'admin' : this.defaultGroup,
      signupCreditMicros: this.signupCreditMicros,
      codeHash,
      maxAttempts: this.codeMaxAttempts,
    })
  }

  async login({ email, password, ip, userAgent }) {
    const normalizedEmail = normalizeEmail(email)
    const user = this.db.findUserByEmail(normalizedEmail)
    const valid = await this.runPasswordHash(() => verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH))
    if (!user || !valid || user.status !== 1) throw createError('邮箱或密码错误', 401, 'INVALID_CREDENTIALS')
    this.db.recordLogin(user.id)
    const session = this.db.createSession(user.id, {
      ttlMs: this.sessionTtlMs,
      ipHash: ip ? hashToken(ip) : null,
      userAgentHash: userAgent ? hashToken(userAgent) : null,
    })
    return { user: this.db.getUserById(user.id), session }
  }

  async resetPassword({ email, password, code }) {
    const normalizedEmail = normalizeEmail(email)
    const codeHash = this.hashCode(normalizedEmail, 'password_reset', String(code || '').trim())
    this.db.validateChallenge({
      email: normalizedEmail,
      purpose: 'password_reset',
      codeHash,
      maxAttempts: this.codeMaxAttempts,
    })
    const passwordHash = await this.runPasswordHash(() => hashPassword(password))
    return this.db.resetPassword({
      email: normalizedEmail,
      passwordHash,
      codeHash,
      maxAttempts: this.codeMaxAttempts,
    })
  }
}

export function createAuthOptionsFromEnv(env, options = {}) {
  return {
    ...options,
    systemName: env.PLATFORM_SYSTEM_NAME || 'KunAI Studio',
    production: env.NODE_ENV === 'production',
    secret: env.PLATFORM_AUTH_SECRET || (env.NODE_ENV === 'production' ? '' : 'development-only-secret-change-me'),
    sessionTtlMs: Number(env.PLATFORM_SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000,
    codeTtlMs: Number(env.PLATFORM_CODE_TTL_MINUTES || 10) * 60 * 1000,
    codeCooldownMs: Number(env.PLATFORM_CODE_COOLDOWN_SECONDS || 60) * 1000,
    codeMaxAttempts: Number(env.PLATFORM_CODE_MAX_ATTEMPTS || 5),
    codeEmailHourlyLimit: Number(env.PLATFORM_CODE_EMAIL_HOURLY_LIMIT || 6),
    codeEmailDailyLimit: Number(env.PLATFORM_CODE_EMAIL_DAILY_LIMIT || 20),
    codeIpHourlyLimit: Number(env.PLATFORM_CODE_IP_HOURLY_LIMIT || 30),
    codeIpDailyLimit: Number(env.PLATFORM_CODE_IP_DAILY_LIMIT || 100),
    registrationEnabled: parseBoolean(env.PLATFORM_REGISTER_ENABLED, true),
    allowedEmailDomains: String(env.PLATFORM_ALLOWED_EMAIL_DOMAINS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
    adminEmails: String(env.PLATFORM_ADMIN_EMAILS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
    defaultRole: Number(env.PLATFORM_DEFAULT_ROLE || 1),
    defaultGroup: env.PLATFORM_DEFAULT_GROUP || 'default',
    signupCreditMicros: options.signupCreditMicros || 0,
    smtpHost: env.SMTP_HOST || env.SMTP_SERVER || '',
    smtpPort: Number(env.SMTP_PORT || 465),
    smtpSecure: parseBoolean(env.SMTP_SECURE ?? env.SMTP_SSL_ENABLED, Number(env.SMTP_PORT || 465) === 465),
    smtpUser: env.SMTP_USER || env.SMTP_ACCOUNT || '',
    smtpPass: env.SMTP_PASS || env.SMTP_TOKEN || '',
    smtpFrom: env.SMTP_FROM || '',
    smtpConnectionTimeoutMs: Number(env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    smtpSocketTimeoutMs: Number(env.SMTP_SOCKET_TIMEOUT_MS || 20000),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY || '',
    maxPasswordHashConcurrency: Number(env.PLATFORM_PASSWORD_HASH_CONCURRENCY || 4),
  }
}
