import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

function createError(message, status = 400, code) {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw createError('请输入有效的邮箱地址', 400, 'INVALID_EMAIL')
  }
  return email
}

export function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function parseMoneyToMicros(value) {
  const text = String(value ?? '').trim()
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text)) throw createError('金额格式无效', 400, 'INVALID_AMOUNT')
  const negative = text.startsWith('-')
  const normalized = negative ? text.slice(1) : text
  const [whole, fraction = ''] = normalized.split('.')
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
  const signed = negative ? -micros : micros
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw createError('金额超出允许范围', 400, 'INVALID_AMOUNT')
  }
  return Number(signed)
}

function mapUser(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    group: row.group_name,
    balanceMicros: row.balance_micros,
    reservedMicros: row.reserved_micros,
    usedMicros: row.used_micros,
    requestCount: row.request_count,
    authVersion: row.auth_version,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

export class PlatformDatabase {
  constructor(options = {}) {
    this.path = options.path || resolve('data', 'image-studio.sqlite')
    this.now = options.now || (() => Date.now())
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true })
    this.db = new Database(this.path)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    if (this.path !== ':memory:') this.db.pragma('journal_mode = WAL')
    this.migrate()
    this.pruneAuthData()
    this.recoverInterruptedGenerations()
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role INTEGER NOT NULL DEFAULT 1,
        status INTEGER NOT NULL DEFAULT 1,
        group_name TEXT NOT NULL DEFAULT 'default',
        balance_micros INTEGER NOT NULL DEFAULT 0 CHECK (balance_micros >= 0),
        reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
        used_micros INTEGER NOT NULL DEFAULT 0 CHECK (used_micros >= 0),
        request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
        auth_version INTEGER NOT NULL DEFAULT 1,
        email_verified_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_hash TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        auth_version INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ip_hash TEXT,
        user_agent_hash TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS verification_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL COLLATE NOCASE,
        purpose TEXT NOT NULL CHECK (purpose IN ('register', 'password_reset')),
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at INTEGER,
        requested_ip_hash TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verification_email_purpose_idx
        ON verification_challenges(email, purpose, created_at DESC);

      CREATE TABLE IF NOT EXISTS generation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('reserved', 'submitted', 'charged', 'failed')),
        price_micros INTEGER NOT NULL CHECK (price_micros >= 0),
        result_path TEXT,
        result_hash TEXT,
        result_content_type TEXT,
        result_http_status INTEGER,
        upstream_request_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS generation_jobs_user_created_idx
        ON generation_jobs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        amount_micros INTEGER NOT NULL,
        balance_after_micros INTEGER NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ledger_user_created_idx
        ON ledger_entries(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS payment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
        payload_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(provider, external_id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      PRAGMA user_version = 1;
    `)
    const generationColumns = new Set(this.db.prepare('PRAGMA table_info(generation_jobs)').all().map((column) => column.name))
    if (!generationColumns.has('result_hash')) this.db.exec('ALTER TABLE generation_jobs ADD COLUMN result_hash TEXT')
  }

  close() {
    this.db.close()
  }

  pruneAuthData() {
    const now = this.now()
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
    this.db.prepare(`
      DELETE FROM verification_challenges
      WHERE (expires_at <= ? OR consumed_at IS NOT NULL) AND created_at < ?
    `).run(now, now - 24 * 60 * 60 * 1000)
  }

  findUserByEmail(value) {
    const email = normalizeEmail(value)
    return mapUser(this.db.prepare('SELECT * FROM users WHERE email = ?').get(email))
  }

  getUserById(id) {
    return mapUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id))
  }

  createChallenge({
    email,
    purpose,
    codeHash,
    expiresAt,
    requestedIpHash,
    cooldownMs,
    emailHourlyLimit = 6,
    emailDailyLimit = 20,
    ipHourlyLimit = 30,
    ipDailyLimit = 100,
  }) {
    const normalizedEmail = normalizeEmail(email)
    const now = this.now()
    const latest = this.db.prepare(`
      SELECT created_at FROM verification_challenges
      WHERE email = ? AND purpose = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(normalizedEmail, purpose)
    if (latest && latest.created_at + cooldownMs > now) {
      throw createError('验证码发送过于频繁，请稍后重试', 429, 'CODE_COOLDOWN')
    }
    const emailHourly = this.db.prepare(`
      SELECT COUNT(*) AS count FROM verification_challenges WHERE email = ? AND created_at >= ?
    `).get(normalizedEmail, now - 60 * 60 * 1000).count
    const emailDaily = this.db.prepare(`
      SELECT COUNT(*) AS count FROM verification_challenges WHERE email = ? AND created_at >= ?
    `).get(normalizedEmail, now - 24 * 60 * 60 * 1000).count
    if (emailHourly >= emailHourlyLimit || emailDaily >= emailDailyLimit) {
      throw createError('该邮箱获取验证码次数过多，请稍后重试', 429, 'CODE_EMAIL_LIMIT')
    }
    if (requestedIpHash) {
      const ipHourly = this.db.prepare(`
        SELECT COUNT(*) AS count FROM verification_challenges WHERE requested_ip_hash = ? AND created_at >= ?
      `).get(requestedIpHash, now - 60 * 60 * 1000).count
      const ipDaily = this.db.prepare(`
        SELECT COUNT(*) AS count FROM verification_challenges WHERE requested_ip_hash = ? AND created_at >= ?
      `).get(requestedIpHash, now - 24 * 60 * 60 * 1000).count
      if (ipHourly >= ipHourlyLimit || ipDaily >= ipDailyLimit) {
        throw createError('当前网络获取验证码次数过多，请稍后重试', 429, 'CODE_IP_LIMIT')
      }
    }

    const create = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE verification_challenges SET consumed_at = ?
        WHERE email = ? AND purpose = ? AND consumed_at IS NULL
      `).run(now, normalizedEmail, purpose)
      return this.db.prepare(`
        INSERT INTO verification_challenges (
          email, purpose, code_hash, expires_at, requested_ip_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(normalizedEmail, purpose, codeHash, expiresAt, requestedIpHash || null, now).lastInsertRowid
    })
    return Number(create())
  }

  deleteChallenge(id) {
    this.db.prepare('DELETE FROM verification_challenges WHERE id = ?').run(id)
  }

  validateChallenge({ email, purpose, codeHash, maxAttempts }) {
    const normalizedEmail = normalizeEmail(email)
    const now = this.now()
    const run = this.db.transaction(() => {
      const challenge = this.db.prepare(`
        SELECT * FROM verification_challenges
        WHERE email = ? AND purpose = ? AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(normalizedEmail, purpose)
      if (!challenge || challenge.expires_at <= now) {
        return createError('验证码已过期，请重新获取', 400, 'CODE_EXPIRED')
      }
      if (challenge.attempts >= maxAttempts) {
        return createError('验证码尝试次数过多，请重新获取', 429, 'CODE_ATTEMPTS')
      }
      if (challenge.code_hash !== codeHash) {
        this.db.prepare('UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id)
        return createError('邮箱验证码不正确', 400, 'INVALID_CODE')
      }
      return null
    })
    const err = run()
    if (err) throw err
  }

  registerUser(options) {
    const email = normalizeEmail(options.email)
    const now = this.now()
    const run = this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        return { error: createError('该邮箱已注册，请直接登录', 409, 'EMAIL_EXISTS') }
      }
      const challenge = this.db.prepare(`
        SELECT * FROM verification_challenges
        WHERE email = ? AND purpose = 'register' AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(email)
      if (!challenge || challenge.expires_at <= now) {
        return { error: createError('验证码已过期，请重新获取', 400, 'CODE_EXPIRED') }
      }
      if (challenge.attempts >= options.maxAttempts) {
        return { error: createError('验证码尝试次数过多，请重新获取', 429, 'CODE_ATTEMPTS') }
      }
      if (challenge.code_hash !== options.codeHash) {
        this.db.prepare('UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id)
        return { error: createError('邮箱验证码不正确', 400, 'INVALID_CODE') }
      }

      const result = this.db.prepare(`
        INSERT INTO users (
          email, password_hash, display_name, role, status, group_name,
          balance_micros, email_verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        email,
        options.passwordHash,
        options.displayName || email.split('@')[0],
        options.role,
        options.group,
        options.signupCreditMicros,
        now,
        now,
        now,
      )
      const userId = Number(result.lastInsertRowid)
      this.db.prepare('UPDATE verification_challenges SET consumed_at = ? WHERE id = ?').run(now, challenge.id)
      if (options.signupCreditMicros > 0) {
        this.db.prepare(`
          INSERT INTO ledger_entries (
            user_id, kind, amount_micros, balance_after_micros, reference, description, created_at
          ) VALUES (?, 'signup_credit', ?, ?, ?, ?, ?)
        `).run(userId, options.signupCreditMicros, options.signupCreditMicros, `signup:${userId}`, '注册赠送额度', now)
      }
      return { user: this.getUserById(userId) }
    })
    const result = run()
    if (result.error) throw result.error
    return result.user
  }

  resetPassword(options) {
    const email = normalizeEmail(options.email)
    const now = this.now()
    const run = this.db.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email)
      const challenge = this.db.prepare(`
        SELECT * FROM verification_challenges
        WHERE email = ? AND purpose = 'password_reset' AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(email)
      if (!user || !challenge || challenge.expires_at <= now) {
        return { error: createError('验证码已过期，请重新获取', 400, 'CODE_EXPIRED') }
      }
      if (challenge.attempts >= options.maxAttempts) {
        return { error: createError('验证码尝试次数过多，请重新获取', 429, 'CODE_ATTEMPTS') }
      }
      if (challenge.code_hash !== options.codeHash) {
        this.db.prepare('UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id)
        return { error: createError('邮箱验证码不正确', 400, 'INVALID_CODE') }
      }

      this.db.prepare(`
        UPDATE users
        SET password_hash = ?, auth_version = auth_version + 1, updated_at = ?
        WHERE id = ?
      `).run(options.passwordHash, now, user.id)
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
      this.db.prepare('UPDATE verification_challenges SET consumed_at = ? WHERE id = ?').run(now, challenge.id)
      return { userId: user.id }
    })
    const result = run()
    if (result.error) throw result.error
    return result.userId
  }

  createSession(userId, options = {}) {
    const user = this.getUserById(userId)
    if (!user) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(24).toString('base64url')
    const now = this.now()
    this.db.prepare(`
      INSERT INTO sessions (
        token_hash, csrf_hash, user_id, auth_version, expires_at,
        created_at, last_seen_at, ip_hash, user_agent_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hashToken(token),
      hashToken(csrfToken),
      userId,
      user.authVersion,
      now + options.ttlMs,
      now,
      now,
      options.ipHash || null,
      options.userAgentHash || null,
    )
    return { token, csrfToken, expiresAt: now + options.ttlMs }
  }

  getSession(token) {
    if (!token) return null
    const now = this.now()
    const row = this.db.prepare(`
      SELECT
        s.token_hash AS session_token_hash,
        s.csrf_hash AS session_csrf_hash,
        s.expires_at AS session_expires_at,
        s.auth_version AS session_auth_version,
        u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(hashToken(token))
    if (!row || row.session_expires_at <= now || row.session_auth_version !== row.auth_version) {
      if (row) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.session_token_hash)
      return null
    }
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, row.session_token_hash)
    return {
      tokenHash: row.session_token_hash,
      csrfHash: row.session_csrf_hash,
      expiresAt: row.session_expires_at,
      user: mapUser(row),
    }
  }

  verifyCsrf(token, csrfToken) {
    if (!csrfToken) return false
    const session = this.getSession(token)
    return Boolean(session && session.csrfHash === hashToken(csrfToken))
  }

  revokeSession(token) {
    if (!token) return
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  }

  recordLogin(userId) {
    this.db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(this.now(), this.now(), userId)
  }

  reserveGeneration({ userId, idempotencyKey, requestHash, priceMicros }) {
    const now = this.now()
    const run = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT * FROM generation_jobs WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, idempotencyKey)
      if (existing) {
        if (existing.request_hash !== requestHash) {
          return { error: createError('同一请求标识不能用于不同的生成内容', 409, 'IDEMPOTENCY_CONFLICT') }
        }
        return { existing: true, job: existing }
      }

      const updated = this.db.prepare(`
        UPDATE users
        SET reserved_micros = reserved_micros + ?, updated_at = ?
        WHERE id = ? AND status = 1 AND balance_micros - reserved_micros >= ?
      `).run(priceMicros, now, userId, priceMicros)
      if (updated.changes !== 1) {
        return { error: createError('账户余额不足，请先充值', 402, 'INSUFFICIENT_BALANCE') }
      }
      const result = this.db.prepare(`
        INSERT INTO generation_jobs (
          user_id, idempotency_key, request_hash, status, price_micros, created_at, updated_at
        ) VALUES (?, ?, ?, 'reserved', ?, ?, ?)
      `).run(userId, idempotencyKey, requestHash, priceMicros, now, now)
      return {
        existing: false,
        job: this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(result.lastInsertRowid),
      }
    })
    const result = run()
    if (result.error) throw result.error
    return result
  }

  markGenerationSubmitted(jobId, upstreamRequestId) {
    this.db.prepare(`
      UPDATE generation_jobs
      SET status = 'submitted', upstream_request_id = ?, updated_at = ?
      WHERE id = ? AND status = 'reserved'
    `).run(upstreamRequestId || null, this.now(), jobId)
  }

  settleGeneration(jobId, result) {
    const now = this.now()
    const run = this.db.transaction(() => {
      const job = this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId)
      if (!job || job.status === 'charged') return job
      if (job.status !== 'reserved' && job.status !== 'submitted') {
        throw createError('生成任务已结束，无法重复结算', 409, 'JOB_FINISHED')
      }
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(job.user_id)
      if (!user || user.reserved_micros < job.price_micros || user.balance_micros < job.price_micros) {
        throw createError('生成任务结算状态异常', 500, 'BILLING_STATE_INVALID')
      }
      const balanceAfter = user.balance_micros - job.price_micros
      this.db.prepare(`
        UPDATE users
        SET balance_micros = ?, reserved_micros = reserved_micros - ?,
            used_micros = used_micros + ?, request_count = request_count + 1, updated_at = ?
        WHERE id = ?
      `).run(balanceAfter, job.price_micros, job.price_micros, now, job.user_id)
      this.db.prepare(`
        INSERT INTO ledger_entries (
          user_id, kind, amount_micros, balance_after_micros, reference, description, created_at
        ) VALUES (?, 'image_charge', ?, ?, ?, ?, ?)
      `).run(job.user_id, -job.price_micros, balanceAfter, `generation:${job.id}`, '图片生成成功', now)
      this.db.prepare(`
        UPDATE generation_jobs
        SET status = 'charged', result_path = ?, result_hash = ?, result_content_type = ?,
            result_http_status = ?, updated_at = ?
        WHERE id = ?
      `).run(result.path, result.hash || null, result.contentType, result.httpStatus, now, job.id)
      return this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(job.id)
    })
    return run()
  }

  failGeneration(jobId, message) {
    const now = this.now()
    const run = this.db.transaction(() => {
      const job = this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId)
      if (!job || job.status === 'failed' || job.status === 'charged') return job
      this.db.prepare(`
        UPDATE users
        SET reserved_micros = MAX(0, reserved_micros - ?), updated_at = ?
        WHERE id = ?
      `).run(job.price_micros, now, job.user_id)
      this.db.prepare(`
        UPDATE generation_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?
      `).run(String(message || '生成失败').slice(0, 500), now, job.id)
      return this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(job.id)
    })
    return run()
  }

  recoverInterruptedGenerations() {
    const now = this.now()
    const run = this.db.transaction(() => {
      this.db.prepare('UPDATE users SET reserved_micros = 0 WHERE reserved_micros > 0').run()
      this.db.prepare(`
        UPDATE generation_jobs
        SET status = 'failed', error = '服务重启，未完成任务已释放额度', updated_at = ?
        WHERE status IN ('reserved', 'submitted')
      `).run(now)
    })
    run()
  }

  getGenerationByKey(userId, idempotencyKey) {
    return this.db.prepare(`
      SELECT * FROM generation_jobs WHERE user_id = ? AND idempotency_key = ?
    `).get(userId, idempotencyKey)
  }

  listLedger(userId, limit = 30) {
    return this.db.prepare(`
      SELECT id, kind, amount_micros, balance_after_micros, reference, description, created_at
      FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(100, Number(limit) || 30)))
  }

  creditPayment({ provider, externalId, email, amountMicros, payloadHash }) {
    const normalizedEmail = normalizeEmail(email)
    const now = this.now()
    const run = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id FROM payment_events WHERE provider = ? AND external_id = ?
      `).get(provider, externalId)
      if (existing) return { duplicate: true }
      const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail)
      if (!user) throw createError('支付事件对应的账户不存在', 404, 'USER_NOT_FOUND')
      const balanceAfter = user.balance_micros + amountMicros
      const event = this.db.prepare(`
        INSERT INTO payment_events (
          provider, external_id, user_id, amount_micros, payload_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(provider, externalId, user.id, amountMicros, payloadHash, now)
      this.db.prepare('UPDATE users SET balance_micros = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
      this.db.prepare(`
        INSERT INTO ledger_entries (
          user_id, kind, amount_micros, balance_after_micros, reference, description, created_at
        ) VALUES (?, 'payment_credit', ?, ?, ?, ?, ?)
      `).run(user.id, amountMicros, balanceAfter, `payment:${provider}:${externalId}`, '支付充值', now)
      return { duplicate: false, eventId: Number(event.lastInsertRowid), userId: user.id, balanceMicros: balanceAfter }
    })
    return run()
  }

  listUsers(search = '', limit = 100) {
    const normalized = String(search || '').trim().toLowerCase()
    const rows = normalized
      ? this.db.prepare(`
          SELECT * FROM users WHERE email LIKE ? OR display_name LIKE ? ORDER BY id DESC LIMIT ?
        `).all(`%${normalized}%`, `%${normalized}%`, Math.max(1, Math.min(200, Number(limit) || 100)))
      : this.db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(200, Number(limit) || 100)))
    return rows.map(mapUser)
  }

  countAdmins() {
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM users WHERE role >= 10 AND status = 1').get().count)
  }

  promoteAdminEmails(emails) {
    const normalizedEmails = Array.from(emails || [], normalizeEmail)
    if (!normalizedEmails.length) return 0
    const now = this.now()
    const run = this.db.transaction(() => {
      let promoted = 0
      for (const email of normalizedEmails) {
        const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email)
        if (!user || user.role >= 10) continue
        this.db.prepare(`
          UPDATE users SET role = 10, auth_version = auth_version + 1, updated_at = ? WHERE id = ?
        `).run(now, user.id)
        this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
        this.db.prepare(`
          INSERT INTO audit_logs (target_user_id, action, details, created_at)
          VALUES (?, 'admin_promoted_from_env', ?, ?)
        `).run(user.id, JSON.stringify({ email }), now)
        promoted += 1
      }
      return promoted
    })
    return run()
  }

  updateUserAccess(actorUserId, targetUserId, changes) {
    const target = this.getUserById(targetUserId)
    if (!target) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
    const role = changes.role === undefined ? target.role : Number(changes.role)
    const status = changes.status === undefined ? target.status : Number(changes.status)
    const group = changes.group === undefined ? target.group : String(changes.group).trim()
    if (![1, 10].includes(role)) throw createError('角色只能设置为普通用户或管理员', 400, 'INVALID_ROLE')
    if (![0, 1].includes(status)) throw createError('账户状态无效', 400, 'INVALID_STATUS')
    if (!group || group.length > 64) throw createError('用户组无效', 400, 'INVALID_GROUP')
    if (actorUserId === targetUserId && (role !== target.role || status !== target.status || group !== target.group)) {
      throw createError('不能修改自己的角色、状态或用户组', 400, 'SELF_LOCKOUT')
    }
    if (actorUserId !== targetUserId && target.role >= 10) {
      throw createError('不能修改其他管理员的权限', 403, 'ADMIN_PEER_PROTECTED')
    }
    const now = this.now()
    const run = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE users
        SET role = ?, status = ?, group_name = ?, auth_version = auth_version + 1, updated_at = ?
        WHERE id = ?
      `).run(role, status, group, now, targetUserId)
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId)
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, target_user_id, action, details, created_at)
        VALUES (?, ?, 'user_access_updated', ?, ?)
      `).run(actorUserId, targetUserId, JSON.stringify({ role, status, group }), now)
      return this.getUserById(targetUserId)
    })
    return run()
  }

  adjustBalance(actorUserId, targetUserId, amountMicros, note = '') {
    if (!Number.isSafeInteger(amountMicros) || amountMicros === 0) throw createError('调整金额无效', 400, 'INVALID_AMOUNT')
    const now = this.now()
    const run = this.db.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId)
      if (!user) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
      if (user.balance_micros + amountMicros < user.reserved_micros) {
        throw createError('调整后余额不能低于已冻结额度', 400, 'BALANCE_TOO_LOW')
      }
      const balanceAfter = user.balance_micros + amountMicros
      this.db.prepare('UPDATE users SET balance_micros = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, targetUserId)
      const ref = `admin:${actorUserId}:${targetUserId}:${now}:${randomBytes(6).toString('hex')}`
      this.db.prepare(`
        INSERT INTO ledger_entries (
          user_id, kind, amount_micros, balance_after_micros, reference, description, created_at
        ) VALUES (?, 'admin_adjustment', ?, ?, ?, ?, ?)
      `).run(targetUserId, amountMicros, balanceAfter, ref, String(note || '管理员调整').slice(0, 200), now)
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, target_user_id, action, details, created_at)
        VALUES (?, ?, 'balance_adjusted', ?, ?)
      `).run(actorUserId, targetUserId, JSON.stringify({ amountMicros, note }), now)
      return this.getUserById(targetUserId)
    })
    return run()
  }
}
