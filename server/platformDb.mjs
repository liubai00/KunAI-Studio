import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
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
    imageCredits: row.image_credits ?? 0,
    reservedCredits: row.reserved_credits ?? 0,
    membershipExpiresAt: row.membership_expires_at ?? null,
    requestCount: row.request_count,
    authVersion: row.auth_version,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

function mapProduct(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    priceMicros: row.price_micros,
    durationDays: row.duration_days,
    credits: row.credits,
    sortOrder: row.sort_order,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCheckoutIntent(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    productName: row.product_name,
    amountMicros: row.amount_micros,
    credits: row.credits,
    status: row.status,
    expiresAt: row.expires_at,
    paymentEventId: row.payment_event_id ?? null,
    paymentProvider: row.payment_provider ?? null,
    paymentExternalId: row.payment_external_id ?? null,
    paymentType: row.payment_type ?? null,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? null,
  }
}

function mapBalanceCheckoutIntent(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    amountMicros: row.amount_micros,
    status: row.status,
    expiresAt: row.expires_at,
    paymentEventId: row.payment_event_id ?? null,
    paymentProvider: row.payment_provider ?? null,
    paymentExternalId: row.payment_external_id ?? null,
    paymentType: row.payment_type ?? null,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? null,
  }
}

function mapAgentModel(row) {
  if (!row) return null
  const selectable = Boolean(
    row.enabled &&
    row.last_seen_at != null &&
    row.input_token_price_micros != null &&
    row.cached_input_token_price_micros != null &&
    row.output_token_price_micros != null &&
    row.max_step_reserve_micros > 0,
  )
  return {
    id: row.id,
    label: row.label,
    enabled: Boolean(row.enabled),
    selectable,
    sortOrder: row.sort_order,
    isDefault: Boolean(row.is_default),
    inputTokenPriceMicros: row.input_token_price_micros,
    cachedInputTokenPriceMicros: row.cached_input_token_price_micros,
    outputTokenPriceMicros: row.output_token_price_micros,
    maxStepReserveMicros: row.max_step_reserve_micros,
    lastSeenAt: row.last_seen_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAgentConversation(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBillingRound(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    roundId: row.round_id,
    status: row.status,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    searchCount: row.search_count,
    searchCredits: row.search_credits,
    imageCount: row.image_count,
    imageCreditsUsed: row.image_credits_used,
    agentMicros: row.agent_micros ?? 0,
    searchMicros: row.search_micros ?? 0,
    totalMicros: row.total_micros,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  }
}

function mapAgentCall(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    billingRoundId: row.billing_round_id,
    stepKey: row.step_key,
    requestHash: row.request_hash,
    status: row.status,
    modelId: row.model_id,
    reservedMicros: row.reserved_micros,
    chargedMicros: row.charged_micros,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    upstreamRequestId: row.upstream_request_id ?? null,
    resultStatus: row.result_status ?? null,
    resultContentType: row.result_content_type ?? null,
    resultBody: row.result_body ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSearchToolCall(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    billingRoundId: row.billing_round_id,
    callId: row.call_id,
    requestHash: row.request_hash,
    status: row.status,
    reservedMicros: row.reserved_micros,
    chargedMicros: row.charged_micros,
    credits: row.credits,
    requestId: row.request_id ?? null,
    resultJson: row.result_json ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** A user has an active membership when the expiry timestamp is in the future. */
export function isMembershipActive(user, now = Date.now()) {
  const expiry = user?.membershipExpiresAt ?? user?.membership_expires_at ?? null
  return Boolean(expiry && Number(expiry) > now)
}

function mapRedemptionCode(row) {
  if (!row) return null
  return {
    code: row.code,
    credits: row.credits,
    membershipDays: row.membership_days,
    balanceMicros: row.balance_micros,
    note: row.note,
    expiresAt: row.expires_at ?? null,
    redeemedBy: row.redeemed_by ?? null,
    redeemedAt: row.redeemed_at ?? null,
    enabled: Boolean(row.enabled),
    maxRedemptions: row.max_redemptions ?? 1,
    redemptionCount: row.redemption_count ?? (row.redeemed_by ? 1 : 0),
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  }
}

// Unambiguous charset (no 0/O/1/I/L) for human-typed redemption codes.
const REDEMPTION_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateRedemptionCode() {
  const bytes = randomBytes(12)
  let raw = ''
  for (let i = 0; i < 12; i += 1) raw += REDEMPTION_CHARSET[bytes[i] % REDEMPTION_CHARSET.length]
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

/** Normalize user input (case / spaces / missing dashes) to the canonical XXXX-XXXX-XXXX form. */
export function canonicalizeRedemptionCode(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length !== 12) return null
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`
}

export class PlatformDatabase {
  constructor(options = {}) {
    const defaultPath = resolve('data', 'kunai-studio.sqlite')
    const legacyPath = resolve('data', 'image-studio.sqlite')
    this.path = options.path || (existsSync(defaultPath) || !existsSync(legacyPath) ? defaultPath : legacyPath)
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

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('membership', 'credits')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_micros INTEGER NOT NULL CHECK (price_micros >= 0),
        duration_days INTEGER NOT NULL DEFAULT 0 CHECK (duration_days >= 0),
        credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS products_active_sort_idx ON products(active, sort_order ASC, price_micros ASC);

      CREATE TABLE IF NOT EXISTS product_checkout_intents (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
        credits INTEGER NOT NULL CHECK (credits > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
        expires_at INTEGER NOT NULL,
        payment_event_id INTEGER UNIQUE REFERENCES payment_events(id) ON DELETE SET NULL,
        payment_provider TEXT,
        payment_external_id TEXT,
        payment_type TEXT,
        created_at INTEGER NOT NULL,
        paid_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS product_checkout_intents_user_created_idx
        ON product_checkout_intents(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS product_checkout_intents_pending_expiry_idx
        ON product_checkout_intents(status, expires_at);

      CREATE TABLE IF NOT EXISTS balance_checkout_intents (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
        expires_at INTEGER NOT NULL,
        payment_event_id INTEGER UNIQUE REFERENCES payment_events(id) ON DELETE SET NULL,
        payment_provider TEXT,
        payment_external_id TEXT,
        payment_type TEXT,
        created_at INTEGER NOT NULL,
        paid_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS balance_checkout_intents_user_created_idx
        ON balance_checkout_intents(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS balance_checkout_intents_pending_expiry_idx
        ON balance_checkout_intents(status, expires_at);

      CREATE TABLE IF NOT EXISTS redemption_codes (
        code TEXT PRIMARY KEY,
        credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
        membership_days INTEGER NOT NULL DEFAULT 0 CHECK (membership_days >= 0),
        balance_micros INTEGER NOT NULL DEFAULT 0 CHECK (balance_micros >= 0),
        note TEXT NOT NULL DEFAULT '',
        expires_at INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        max_redemptions INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
        redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
        redeemed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        redeemed_at INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS redemption_codes_created_idx ON redemption_codes(created_at DESC);

      CREATE TABLE IF NOT EXISTS redemption_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL REFERENCES redemption_codes(code),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
        membership_days INTEGER NOT NULL DEFAULT 0 CHECK (membership_days >= 0),
        balance_micros INTEGER NOT NULL DEFAULT 0 CHECK (balance_micros >= 0),
        redeemed_at INTEGER NOT NULL,
        UNIQUE(code, user_id)
      );
      CREATE INDEX IF NOT EXISTS redemption_records_code_created_idx ON redemption_records(code, redeemed_at DESC);

      CREATE TABLE IF NOT EXISTS platform_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_models (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        input_token_price_micros INTEGER CHECK (input_token_price_micros >= 0),
        cached_input_token_price_micros INTEGER CHECK (cached_input_token_price_micros >= 0),
        output_token_price_micros INTEGER CHECK (output_token_price_micros >= 0),
        max_step_reserve_micros INTEGER CHECK (max_step_reserve_micros >= 0),
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agent_models_one_default_idx ON agent_models(is_default) WHERE is_default = 1;
      CREATE INDEX IF NOT EXISTS agent_models_selectable_sort_idx ON agent_models(enabled, sort_order ASC, id ASC);

      CREATE TABLE IF NOT EXISTS agent_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        model_id TEXT NOT NULL REFERENCES agent_models(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, conversation_id)
      );

      CREATE TABLE IF NOT EXISTS billing_rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'failed')),
        input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
        cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
        output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
        search_count INTEGER NOT NULL DEFAULT 0 CHECK (search_count >= 0),
        search_credits INTEGER NOT NULL DEFAULT 0 CHECK (search_credits >= 0),
        image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
        image_credits_used INTEGER NOT NULL DEFAULT 0 CHECK (image_credits_used >= 0),
        total_micros INTEGER NOT NULL DEFAULT 0 CHECK (total_micros >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        UNIQUE(user_id, conversation_id, round_id),
        FOREIGN KEY(user_id, conversation_id) REFERENCES agent_conversations(user_id, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS billing_rounds_user_created_idx ON billing_rounds(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS agent_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        billing_round_id INTEGER NOT NULL REFERENCES billing_rounds(id) ON DELETE CASCADE,
        step_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('reserved', 'submitted', 'charged', 'failed')),
        model_id TEXT NOT NULL REFERENCES agent_models(id),
        reserved_micros INTEGER NOT NULL CHECK (reserved_micros >= 0),
        charged_micros INTEGER NOT NULL DEFAULT 0 CHECK (charged_micros >= 0),
        input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
        cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
        output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
        upstream_request_id TEXT,
        result_status INTEGER,
        result_content_type TEXT,
        result_body BLOB,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, step_key)
      );
      CREATE INDEX IF NOT EXISTS agent_calls_round_created_idx ON agent_calls(billing_round_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS search_tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        billing_round_id INTEGER NOT NULL REFERENCES billing_rounds(id) ON DELETE CASCADE,
        call_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('reserved', 'submitted', 'charged', 'failed')),
        reserved_micros INTEGER NOT NULL CHECK (reserved_micros >= 0),
        charged_micros INTEGER NOT NULL DEFAULT 0 CHECK (charged_micros >= 0),
        credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
        request_id TEXT,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, call_id)
      );
      CREATE INDEX IF NOT EXISTS search_tool_calls_round_created_idx ON search_tool_calls(billing_round_id, created_at ASC);

      PRAGMA user_version = 5;
    `)
    const generationColumns = new Set(this.db.prepare('PRAGMA table_info(generation_jobs)').all().map((column) => column.name))
    if (!generationColumns.has('result_hash')) this.db.exec('ALTER TABLE generation_jobs ADD COLUMN result_hash TEXT')
    // Membership + credit-wallet columns (added idempotently for existing databases).
    if (!generationColumns.has('charge_source')) this.db.exec("ALTER TABLE generation_jobs ADD COLUMN charge_source TEXT NOT NULL DEFAULT 'balance'")
    if (!generationColumns.has('credits_used')) this.db.exec('ALTER TABLE generation_jobs ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 0')
    if (!generationColumns.has('billing_round_id')) this.db.exec('ALTER TABLE generation_jobs ADD COLUMN billing_round_id INTEGER REFERENCES billing_rounds(id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS generation_jobs_billing_round_idx ON generation_jobs(billing_round_id, created_at ASC)')
    const userColumns = new Set(this.db.prepare('PRAGMA table_info(users)').all().map((column) => column.name))
    if (!userColumns.has('image_credits')) this.db.exec('ALTER TABLE users ADD COLUMN image_credits INTEGER NOT NULL DEFAULT 0')
    if (!userColumns.has('reserved_credits')) this.db.exec('ALTER TABLE users ADD COLUMN reserved_credits INTEGER NOT NULL DEFAULT 0')
    if (!userColumns.has('membership_expires_at')) this.db.exec('ALTER TABLE users ADD COLUMN membership_expires_at INTEGER')
    const agentCallColumns = new Set(this.db.prepare('PRAGMA table_info(agent_calls)').all().map((column) => column.name))
    if (!agentCallColumns.has('result_status')) this.db.exec('ALTER TABLE agent_calls ADD COLUMN result_status INTEGER')
    if (!agentCallColumns.has('result_content_type')) this.db.exec('ALTER TABLE agent_calls ADD COLUMN result_content_type TEXT')
    if (!agentCallColumns.has('result_body')) this.db.exec('ALTER TABLE agent_calls ADD COLUMN result_body BLOB')
    const redemptionColumns = new Set(this.db.prepare('PRAGMA table_info(redemption_codes)').all().map((column) => column.name))
    if (!redemptionColumns.has('enabled')) this.db.exec('ALTER TABLE redemption_codes ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
    if (!redemptionColumns.has('max_redemptions')) this.db.exec('ALTER TABLE redemption_codes ADD COLUMN max_redemptions INTEGER NOT NULL DEFAULT 1')
    if (!redemptionColumns.has('redemption_count')) this.db.exec('ALTER TABLE redemption_codes ADD COLUMN redemption_count INTEGER NOT NULL DEFAULT 0')
    this.db.exec(`
      INSERT OR IGNORE INTO redemption_records (code, user_id, credits, membership_days, balance_micros, redeemed_at)
      SELECT code, redeemed_by, credits, membership_days, balance_micros, redeemed_at
      FROM redemption_codes
      WHERE redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL
    `)
    this.db.exec('UPDATE redemption_codes SET redemption_count = 1 WHERE redeemed_by IS NOT NULL AND redemption_count = 0')
    const productCheckoutColumns = new Set(this.db.prepare('PRAGMA table_info(product_checkout_intents)').all().map((column) => column.name))
    if (!productCheckoutColumns.has('payment_type')) this.db.exec('ALTER TABLE product_checkout_intents ADD COLUMN payment_type TEXT')
    const balanceCheckoutColumns = new Set(this.db.prepare('PRAGMA table_info(balance_checkout_intents)').all().map((column) => column.name))
    if (!balanceCheckoutColumns.has('payment_type')) this.db.exec('ALTER TABLE balance_checkout_intents ADD COLUMN payment_type TEXT')
    this.migrateUsdToCny()
    this.db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE active = 1 AND price_micros <= 0').run(this.now())
  }

  migrateUsdToCny() {
    const key = 'currency_migration_usd_to_cny_v1'
    if (this.db.prepare('SELECT 1 FROM platform_metadata WHERE key = ?').get(key)) return
    const now = this.now()
    const run = this.db.transaction(() => {
      const convert = (table, columns) => {
        for (const column of columns) {
          this.db.exec(`
            UPDATE ${table} SET ${column} = CASE
              WHEN ${column} >= 0 THEN CAST((${column} * 72 + 5) / 10 AS INTEGER)
              ELSE -CAST(((-${column}) * 72 + 5) / 10 AS INTEGER)
            END
          `)
        }
      }
      convert('users', ['balance_micros', 'reserved_micros', 'used_micros'])
      convert('generation_jobs', ['price_micros'])
      convert('ledger_entries', ['amount_micros', 'balance_after_micros'])
      convert('payment_events', ['amount_micros'])
      convert('products', ['price_micros'])
      convert('redemption_codes', ['balance_micros'])
      this.db.prepare("UPDATE products SET active = 0, updated_at = ? WHERE kind = 'membership'").run(now)
      this.db.prepare("UPDATE products SET price_micros = 36000000, updated_at = ? WHERE id = 'credits-100'").run(now)
      this.db.prepare('INSERT INTO platform_metadata (key, value, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify({ from: 'USD', to: 'CNY', rate: 7.2 }), now)
    })
    run()
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
    this.db.prepare("DELETE FROM product_checkout_intents WHERE status = 'pending' AND expires_at < ?").run(now - 7 * 24 * 60 * 60 * 1000)
    this.db.prepare("DELETE FROM balance_checkout_intents WHERE status = 'pending' AND expires_at < ?").run(now - 7 * 24 * 60 * 60 * 1000)
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

  upsertDiscoveredAgentModels(models) {
    const now = this.now()
    const rows = Array.from(models || []).map((item) => {
      const id = String(typeof item === 'string' ? item : item?.id || '').trim()
      const label = String(typeof item === 'string' ? item : item?.label || id).trim()
      if (!id || id.length > 252) throw createError('Agent 模型 ID 无效', 400, 'INVALID_MODEL_ID')
      if (!label || label.length > 200) throw createError('Agent 模型名称无效', 400, 'INVALID_MODEL_LABEL')
      return { id, label }
    })
    const run = this.db.transaction(() => {
      const existingStates = new Map(rows.map((row) => {
        const existing = this.db.prepare('SELECT enabled, is_default FROM agent_models WHERE id = ?').get(row.id)
        return [row.id, existing ? { enabled: existing.enabled, isDefault: existing.is_default } : null]
      }))
      this.db.prepare(`
        UPDATE agent_models SET enabled = 0, is_default = 0, last_seen_at = NULL, updated_at = ?
        WHERE last_seen_at IS NOT NULL
      `).run(now)
      const upsert = this.db.prepare(`
        INSERT INTO agent_models (id, label, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = CASE WHEN agent_models.label = '' THEN excluded.label ELSE agent_models.label END,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at
      `)
      const restore = this.db.prepare('UPDATE agent_models SET enabled = ?, is_default = ? WHERE id = ?')
      for (const row of rows) {
        upsert.run(row.id, row.label, now, now, now)
        const state = existingStates.get(row.id)
        if (state) restore.run(state.enabled, state.isDefault, row.id)
      }
      return rows.map((row) => this.getAgentModel(row.id))
    })
    return run()
  }

  configureAgentModel(actorUserId, id, changes = {}) {
    const modelId = String(id || '').trim()
    const existing = this.getAgentModel(modelId)
    if (!existing) throw createError('Agent 模型不存在', 404, 'MODEL_NOT_FOUND')
    const label = changes.label === undefined ? existing.label : String(changes.label || '').trim()
    const enabled = changes.enabled === undefined ? existing.enabled : Boolean(changes.enabled)
    const sortOrder = changes.sortOrder === undefined ? existing.sortOrder : Math.trunc(Number(changes.sortOrder))
    const readPrice = (key, current) => {
      if (changes[key] === undefined) return current
      if (changes[key] === null || changes[key] === '') return null
      const value = Number(changes[key])
      if (!Number.isSafeInteger(value) || value < 0) throw createError('Agent 模型价格无效', 400, 'INVALID_MODEL_PRICE')
      return value
    }
    const inputTokenPriceMicros = readPrice('inputTokenPriceMicros', existing.inputTokenPriceMicros)
    const cachedInputTokenPriceMicros = readPrice('cachedInputTokenPriceMicros', existing.cachedInputTokenPriceMicros)
    const outputTokenPriceMicros = readPrice('outputTokenPriceMicros', existing.outputTokenPriceMicros)
    const maxStepReserveMicros = readPrice('maxStepReserveMicros', existing.maxStepReserveMicros)
    const requestedDefault = changes.isDefault ?? changes.default
    if (!label || label.length > 200) throw createError('Agent 模型名称无效', 400, 'INVALID_MODEL_LABEL')
    if (!Number.isSafeInteger(sortOrder)) throw createError('Agent 模型排序值无效', 400, 'INVALID_SORT_ORDER')
    if (enabled && existing.lastSeenAt == null) throw createError('该 Agent 模型已不在上游目录中，请先刷新模型目录', 409, 'MODEL_NOT_DISCOVERED')
    const now = this.now()
    const run = this.db.transaction(() => {
      if (requestedDefault) this.db.prepare('UPDATE agent_models SET is_default = 0, updated_at = ? WHERE is_default = 1').run(now)
      const isDefault = requestedDefault === undefined
        ? (enabled ? existing.isDefault : false)
        : Boolean(requestedDefault)
      this.db.prepare(`
        UPDATE agent_models SET
          label = ?, enabled = ?, sort_order = ?, is_default = ?,
          input_token_price_micros = ?, cached_input_token_price_micros = ?,
          output_token_price_micros = ?, max_step_reserve_micros = ?, updated_at = ?
        WHERE id = ?
      `).run(
        label,
        enabled ? 1 : 0,
        sortOrder,
        isDefault ? 1 : 0,
        inputTokenPriceMicros,
        cachedInputTokenPriceMicros,
        outputTokenPriceMicros,
        maxStepReserveMicros,
        now,
        modelId,
      )
      const model = this.getAgentModel(modelId)
      if (model.isDefault && !model.selectable) throw createError('默认 Agent 模型必须启用并配置完整价格', 400, 'MODEL_NOT_SELECTABLE')
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, action, details, created_at)
        VALUES (?, 'agent_model_configured', ?, ?)
      `).run(actorUserId || null, JSON.stringify({ id: modelId, enabled, isDefault: model.isDefault }), now)
      return model
    })
    return run()
  }

  getAgentModel(id) {
    return mapAgentModel(this.db.prepare('SELECT * FROM agent_models WHERE id = ?').get(String(id || '')))
  }

  listAgentModels({ selectableOnly = false } = {}) {
    const rows = selectableOnly
      ? this.db.prepare(`
          SELECT * FROM agent_models
          WHERE enabled = 1
            AND last_seen_at IS NOT NULL
            AND input_token_price_micros IS NOT NULL
            AND cached_input_token_price_micros IS NOT NULL
            AND output_token_price_micros IS NOT NULL
            AND max_step_reserve_micros > 0
          ORDER BY is_default DESC, sort_order ASC, id ASC
        `).all()
      : this.db.prepare('SELECT * FROM agent_models ORDER BY is_default DESC, sort_order ASC, id ASC').all()
    return rows.map(mapAgentModel)
  }

  getDefaultAgentModel() {
    return this.listAgentModels({ selectableOnly: true }).find((model) => model.isDefault) ?? null
  }

  lockAgentConversation({ userId, conversationId, modelId }) {
    const clientConversationId = String(conversationId || '').trim()
    const selectedModelId = String(modelId || '').trim()
    if (!clientConversationId || clientConversationId.length > 200) throw createError('Agent 会话 ID 无效', 400, 'INVALID_CONVERSATION_ID')
    const now = this.now()
    const run = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT * FROM agent_conversations WHERE user_id = ? AND conversation_id = ?
      `).get(userId, clientConversationId)
      if (existing) {
        if (existing.model_id !== selectedModelId) throw createError('Agent 会话已锁定其他模型', 409, 'CONVERSATION_MODEL_LOCKED')
        return mapAgentConversation(existing)
      }
      const user = this.db.prepare('SELECT status FROM users WHERE id = ?').get(userId)
      if (!user || Number(user.status) !== 1) throw createError('账户已停用或不存在', 403, 'ACCOUNT_DISABLED')
      const model = this.getAgentModel(selectedModelId)
      if (!model?.selectable) throw createError('Agent 模型不可用或价格未配置完整', 400, 'MODEL_NOT_SELECTABLE')
      const result = this.db.prepare(`
        INSERT INTO agent_conversations (user_id, conversation_id, model_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, clientConversationId, selectedModelId, now, now)
      return mapAgentConversation(this.db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(result.lastInsertRowid))
    })
    return run()
  }

  getAgentConversation(userId, conversationId) {
    return mapAgentConversation(this.db.prepare(`
      SELECT * FROM agent_conversations WHERE user_id = ? AND conversation_id = ?
    `).get(userId, String(conversationId || '')))
  }

  getBillingRound({ userId, conversationId, roundId }) {
    return mapBillingRound(this.db.prepare(`
      SELECT br.*,
        COALESCE((SELECT SUM(charged_micros) FROM agent_calls WHERE billing_round_id = br.id AND status = 'charged'), 0) AS agent_micros,
        COALESCE((SELECT SUM(charged_micros) FROM search_tool_calls WHERE billing_round_id = br.id AND status = 'charged'), 0) AS search_micros
      FROM billing_rounds br WHERE user_id = ? AND conversation_id = ? AND round_id = ?
    `).get(userId, String(conversationId || ''), String(roundId || '')))
  }

  getBillingRoundById(userId, id) {
    return mapBillingRound(this.db.prepare(`
      SELECT br.*,
        COALESCE((SELECT SUM(charged_micros) FROM agent_calls WHERE billing_round_id = br.id AND status = 'charged'), 0) AS agent_micros,
        COALESCE((SELECT SUM(charged_micros) FROM search_tool_calls WHERE billing_round_id = br.id AND status = 'charged'), 0) AS search_micros
      FROM billing_rounds br WHERE user_id = ? AND id = ?
    `).get(userId, id))
  }

  listBillingRounds(userId, limit = 30) {
    const rows = this.db.prepare(`
      SELECT br.*,
        COALESCE((SELECT SUM(charged_micros) FROM agent_calls WHERE billing_round_id = br.id AND status = 'charged'), 0) AS agent_micros,
        COALESCE((SELECT SUM(charged_micros) FROM search_tool_calls WHERE billing_round_id = br.id AND status = 'charged'), 0) AS search_micros
      FROM billing_rounds br WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(100, Number(limit) || 30)))
    return rows.map(mapBillingRound)
  }

  finishBillingRound({ userId, conversationId, roundId, status = 'completed' }) {
    if (!['completed', 'failed'].includes(status)) throw createError('计费轮次状态无效', 400, 'INVALID_ROUND_STATUS')
    const now = this.now()
    this.db.prepare(`
      UPDATE billing_rounds SET status = ?, completed_at = ?, updated_at = ?
      WHERE user_id = ? AND conversation_id = ? AND round_id = ? AND status = 'open'
    `).run(status, now, now, userId, String(conversationId || ''), String(roundId || ''))
    return this.getBillingRound({ userId, conversationId, roundId })
  }

  getOrCreateBillingRound({ userId, conversationId, roundId }) {
    const clientConversationId = String(conversationId || '').trim()
    const clientRoundId = String(roundId || '').trim()
    if (!clientRoundId || clientRoundId.length > 200) throw createError('Agent 轮次 ID 无效', 400, 'INVALID_ROUND_ID')
    const existing = this.getBillingRound({ userId, conversationId: clientConversationId, roundId: clientRoundId })
    if (existing) return existing
    if (!this.getAgentConversation(userId, clientConversationId)) throw createError('Agent 会话不存在', 404, 'CONVERSATION_NOT_FOUND')
    const now = this.now()
    const result = this.db.prepare(`
      INSERT INTO billing_rounds (user_id, conversation_id, round_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, clientConversationId, clientRoundId, now, now)
    return mapBillingRound(this.db.prepare('SELECT * FROM billing_rounds WHERE id = ?').get(result.lastInsertRowid))
  }

  reserveBalance(userId, amountMicros) {
    if (!Number.isSafeInteger(amountMicros) || amountMicros < 0) throw createError('预留金额无效', 400, 'INVALID_AMOUNT')
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user || Number(user.status) !== 1) throw createError('账户已停用或不存在', 403, 'ACCOUNT_DISABLED')
    if (amountMicros === 0) return mapUser(user)
    const updated = this.db.prepare(`
      UPDATE users SET reserved_micros = reserved_micros + ?, updated_at = ?
      WHERE id = ? AND status = 1 AND balance_micros - reserved_micros >= ?
    `).run(amountMicros, this.now(), userId, amountMicros)
    if (updated.changes !== 1) throw createError('余额不足', 402, 'INSUFFICIENT_BALANCE')
    return this.getUserById(userId)
  }

  settleReservedBalance({ userId, reservedMicros, chargeMicros, kind, reference, description }) {
    if (!Number.isSafeInteger(reservedMicros) || reservedMicros < 0 || !Number.isSafeInteger(chargeMicros) || chargeMicros < 0 || chargeMicros > reservedMicros) {
      throw createError('结算金额超出预留额度', 500, 'BILLING_RESERVE_EXCEEDED')
    }
    const run = this.db.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
      if (!user || user.reserved_micros < reservedMicros || user.balance_micros < chargeMicros) {
        throw createError('计费结算状态异常', 500, 'BILLING_STATE_INVALID')
      }
      const balanceAfter = user.balance_micros - chargeMicros
      const now = this.now()
      this.db.prepare(`
        UPDATE users SET balance_micros = ?, reserved_micros = reserved_micros - ?,
          used_micros = used_micros + ?, request_count = request_count + 1, updated_at = ?
        WHERE id = ?
      `).run(balanceAfter, reservedMicros, chargeMicros, now, userId)
      this.insertLedger(userId, kind, -chargeMicros, balanceAfter, reference, description, now)
      return balanceAfter
    })
    return run()
  }

  releaseReservedBalance(userId, reservedMicros) {
    if (!Number.isSafeInteger(reservedMicros) || reservedMicros < 0) throw createError('释放金额无效', 400, 'INVALID_AMOUNT')
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user || user.reserved_micros < reservedMicros) throw createError('计费预留状态异常', 500, 'BILLING_STATE_INVALID')
    this.db.prepare('UPDATE users SET reserved_micros = reserved_micros - ?, updated_at = ? WHERE id = ?').run(reservedMicros, this.now(), userId)
    return this.getUserById(userId)
  }

  reserveAgentCall({ userId, conversationId, roundId, stepKey, requestHash, modelId, reserveMicros, maxCallsPerRound = 16 }) {
    const key = String(stepKey || '').trim()
    const hash = String(requestHash || '').trim()
    if (!key || key.length > 200 || !hash) throw createError('Agent 请求幂等参数无效', 400, 'INVALID_IDEMPOTENCY_KEY')
    const run = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM agent_calls WHERE user_id = ? AND step_key = ?').get(userId, key)
      if (existing) {
        const existingRound = this.db.prepare('SELECT * FROM billing_rounds WHERE id = ?').get(existing.billing_round_id)
        if (
          existing.request_hash !== hash ||
          existing.model_id !== modelId ||
          existingRound?.conversation_id !== String(conversationId || '') ||
          existingRound?.round_id !== String(roundId || '')
        ) {
          throw createError('同一 Agent 请求标识不能用于不同内容或轮次', 409, 'IDEMPOTENCY_CONFLICT')
        }
        return { existing: true, call: mapAgentCall(existing), round: mapBillingRound(existingRound) }
      }
      const model = this.getAgentModel(modelId)
      if (!model?.selectable) throw createError('Agent 模型不可用或价格未配置完整', 400, 'MODEL_NOT_SELECTABLE')
      this.lockAgentConversation({ userId, conversationId, modelId })
      const round = this.getOrCreateBillingRound({ userId, conversationId, roundId })
      if (round.status !== 'open') throw createError('Agent 轮次已结束', 409, 'ROUND_FINISHED')
      const callLimit = Math.max(1, Math.min(100, Math.trunc(Number(maxCallsPerRound) || 16)))
      const callCounts = this.db.prepare(`
        SELECT COUNT(*) AS total_count,
          SUM(CASE WHEN status != 'failed' THEN 1 ELSE 0 END) AS active_count
        FROM agent_calls WHERE billing_round_id = ?
      `).get(round.id)
      if (callCounts.active_count >= callLimit) throw createError('本轮 Agent 调用次数已达上限', 429, 'AGENT_ROUND_LIMIT_REACHED')
      // 每个逻辑步骤允许一次新幂等尝试，但失败记录不能被用来无限绕过轮次上限。
      if (callCounts.total_count >= callLimit * 2) throw createError('本轮 Agent 重试次数已达上限', 429, 'AGENT_ROUND_RETRY_LIMIT_REACHED')
      const amount = reserveMicros === undefined ? model.maxStepReserveMicros : Number(reserveMicros)
      if (!Number.isSafeInteger(amount) || amount < 0) throw createError('Agent 预留金额无效', 400, 'INVALID_AMOUNT')
      if (amount > model.maxStepReserveMicros) throw createError('Agent 预留金额超过模型单步上限', 400, 'RESERVE_LIMIT_EXCEEDED')
      this.reserveBalance(userId, amount)
      const now = this.now()
      const result = this.db.prepare(`
        INSERT INTO agent_calls (
          user_id, billing_round_id, step_key, request_hash, status, model_id,
          reserved_micros, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?, ?)
      `).run(userId, round.id, key, hash, modelId, amount, now, now)
      return { existing: false, call: mapAgentCall(this.db.prepare('SELECT * FROM agent_calls WHERE id = ?').get(result.lastInsertRowid)), round }
    })
    return run()
  }

  getAgentCallByStep(userId, stepKey) {
    return mapAgentCall(this.db.prepare('SELECT * FROM agent_calls WHERE user_id = ? AND step_key = ?').get(userId, String(stepKey || '')))
  }

  markAgentCallSubmitted(callId, upstreamId) {
    this.db.prepare(`
      UPDATE agent_calls SET status = 'submitted', upstream_request_id = COALESCE(?, upstream_request_id), updated_at = ?
      WHERE id = ? AND status = 'reserved'
    `).run(upstreamId || null, this.now(), callId)
    return mapAgentCall(this.db.prepare('SELECT * FROM agent_calls WHERE id = ?').get(callId))
  }

  settleAgentCall(callId, options = {}) {
    const inputTokens = Math.trunc(Number(options.inputTokens) || 0)
    const cachedInputTokens = Math.trunc(Number(options.cachedInputTokens) || 0)
    const outputTokens = Math.trunc(Number(options.outputTokens) || 0)
    if ([inputTokens, cachedInputTokens, outputTokens].some((value) => !Number.isSafeInteger(value) || value < 0) || cachedInputTokens > inputTokens) {
      throw createError('Agent token 用量无效', 400, 'INVALID_TOKEN_USAGE')
    }
    const resultBody = options.resultBody == null
      ? null
      : Buffer.isBuffer(options.resultBody) ? options.resultBody : Buffer.from(String(options.resultBody))
    if (resultBody && resultBody.length > 2 * 1024 * 1024) throw createError('Agent 结果超过 2MB', 413, 'RESULT_TOO_LARGE')
    const resultStatus = options.resultStatus == null ? null : Number(options.resultStatus)
    const resultContentType = options.resultContentType == null ? null : String(options.resultContentType)
    if (resultStatus != null && (!Number.isInteger(resultStatus) || resultStatus < 100 || resultStatus > 599)) {
      throw createError('Agent 结果状态码无效', 400, 'INVALID_RESULT_STATUS')
    }
    if (resultContentType && resultContentType.length > 200) throw createError('Agent 结果类型无效', 400, 'INVALID_RESULT_CONTENT_TYPE')
    const run = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM agent_calls WHERE id = ?').get(callId)
      if (!row || row.status === 'charged') return mapAgentCall(row)
      if (!['reserved', 'submitted'].includes(row.status)) throw createError('Agent 请求已结束', 409, 'JOB_FINISHED')
      const model = this.getAgentModel(row.model_id)
      if (!model) throw createError('Agent 模型不存在', 500, 'MODEL_NOT_FOUND')
      const chargeMicros = (() => {
        if (options.chargeMicros !== undefined) return Number(options.chargeMicros)
        if ([model.inputTokenPriceMicros, model.cachedInputTokenPriceMicros, model.outputTokenPriceMicros].some((value) => value == null)) {
          throw createError('Agent 模型价格不完整', 500, 'MODEL_PRICING_INCOMPLETE')
        }
        const price = (tokens, rate) => (BigInt(tokens) * BigInt(rate) + 999999n) / 1000000n
        const calculated = price(inputTokens - cachedInputTokens, model.inputTokenPriceMicros)
          + price(cachedInputTokens, model.cachedInputTokenPriceMicros)
          + price(outputTokens, model.outputTokenPriceMicros)
        return Number(calculated)
      })()
      if (!Number.isSafeInteger(chargeMicros) || chargeMicros < 0) throw createError('Agent 结算金额无效', 400, 'INVALID_AMOUNT')
      this.settleReservedBalance({
        userId: row.user_id,
        reservedMicros: row.reserved_micros,
        chargeMicros,
        kind: 'agent_charge',
        reference: `agent_call:${row.id}`,
        description: `Agent 调用 ${row.model_id}`,
      })
      const now = this.now()
      this.db.prepare(`
        UPDATE agent_calls SET status = 'charged', charged_micros = ?, input_tokens = ?,
          cached_input_tokens = ?, output_tokens = ?, upstream_request_id = COALESCE(?, upstream_request_id),
          result_status = ?, result_content_type = ?, result_body = ?, updated_at = ?
        WHERE id = ?
      `).run(
        chargeMicros,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        options.upstreamId || null,
        resultStatus,
        resultContentType,
        resultBody,
        now,
        row.id,
      )
      this.db.prepare(`
        UPDATE billing_rounds SET input_tokens = input_tokens + ?,
          cached_input_tokens = cached_input_tokens + ?, output_tokens = output_tokens + ?,
          total_micros = total_micros + ?, updated_at = ? WHERE id = ?
      `).run(inputTokens, cachedInputTokens, outputTokens, chargeMicros, now, row.billing_round_id)
      return mapAgentCall(this.db.prepare('SELECT * FROM agent_calls WHERE id = ?').get(row.id))
    })
    return run()
  }

  failAgentCall(callId, error) {
    const run = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM agent_calls WHERE id = ?').get(callId)
      if (!row || row.status === 'failed' || row.status === 'charged') return mapAgentCall(row)
      this.releaseReservedBalance(row.user_id, row.reserved_micros)
      this.db.prepare("UPDATE agent_calls SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run(String(error || 'Agent 请求失败').slice(0, 500), this.now(), row.id)
      return mapAgentCall(this.db.prepare('SELECT * FROM agent_calls WHERE id = ?').get(row.id))
    })
    return run()
  }

  reserveSearchCall({ userId, conversationId, roundId, callId, requestHash, reserveMicros, maxCallsPerRound = 12 }) {
    const key = String(callId || '').trim()
    const hash = String(requestHash || '').trim()
    const amount = Number(reserveMicros)
    if (!key || key.length > 200 || !hash) throw createError('搜索请求幂等参数无效', 400, 'INVALID_IDEMPOTENCY_KEY')
    if (!Number.isSafeInteger(amount) || amount < 0) throw createError('搜索预留金额无效', 400, 'INVALID_AMOUNT')
    const run = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM search_tool_calls WHERE user_id = ? AND call_id = ?').get(userId, key)
      if (existing) {
        const existingRound = this.db.prepare('SELECT * FROM billing_rounds WHERE id = ?').get(existing.billing_round_id)
        if (
          existing.request_hash !== hash ||
          existingRound?.conversation_id !== String(conversationId || '') ||
          existingRound?.round_id !== String(roundId || '')
        ) {
          throw createError('同一搜索请求标识不能用于不同内容或轮次', 409, 'IDEMPOTENCY_CONFLICT')
        }
        return { existing: true, call: mapSearchToolCall(existing), round: mapBillingRound(existingRound) }
      }
      const round = this.getOrCreateBillingRound({ userId, conversationId, roundId })
      if (round.status !== 'open') throw createError('Agent 轮次已结束', 409, 'ROUND_FINISHED')
      const callLimit = Math.max(1, Math.min(100, Math.trunc(Number(maxCallsPerRound) || 12)))
      const callCount = this.db.prepare('SELECT COUNT(*) AS count FROM search_tool_calls WHERE billing_round_id = ?').get(round.id).count
      if (callCount >= callLimit) throw createError('本轮搜索调用次数已达上限', 429, 'SEARCH_ROUND_LIMIT_REACHED')
      this.reserveBalance(userId, amount)
      const now = this.now()
      const result = this.db.prepare(`
        INSERT INTO search_tool_calls (
          user_id, billing_round_id, call_id, request_hash, status, reserved_micros, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?)
      `).run(userId, round.id, key, hash, amount, now, now)
      return { existing: false, call: mapSearchToolCall(this.db.prepare('SELECT * FROM search_tool_calls WHERE id = ?').get(result.lastInsertRowid)), round }
    })
    return run()
  }

  getSearchCall(userId, callId) {
    return mapSearchToolCall(this.db.prepare('SELECT * FROM search_tool_calls WHERE user_id = ? AND call_id = ?').get(userId, String(callId || '')))
  }

  markSearchCallSubmitted(callId, requestId) {
    this.db.prepare(`
      UPDATE search_tool_calls SET status = 'submitted', request_id = COALESCE(?, request_id), updated_at = ?
      WHERE id = ? AND status = 'reserved'
    `).run(requestId || null, this.now(), callId)
    return mapSearchToolCall(this.db.prepare('SELECT * FROM search_tool_calls WHERE id = ?').get(callId))
  }

  settleSearchCall(callId, options = {}) {
    const chargeMicros = Number(options.chargeMicros)
    const credits = Math.trunc(Number(options.credits) || 0)
    if (!Number.isSafeInteger(chargeMicros) || chargeMicros < 0 || !Number.isSafeInteger(credits) || credits < 0) {
      throw createError('搜索结算数据无效', 400, 'INVALID_SEARCH_USAGE')
    }
    const resultJson = options.resultJson == null
      ? null
      : typeof options.resultJson === 'string' ? options.resultJson : JSON.stringify(options.resultJson)
    const run = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM search_tool_calls WHERE id = ?').get(callId)
      if (!row || row.status === 'charged') return mapSearchToolCall(row)
      if (!['reserved', 'submitted'].includes(row.status)) throw createError('搜索请求已结束', 409, 'JOB_FINISHED')
      this.settleReservedBalance({
        userId: row.user_id,
        reservedMicros: row.reserved_micros,
        chargeMicros,
        kind: 'search_charge',
        reference: `search_call:${row.id}`,
        description: 'Agent 搜索调用',
      })
      const now = this.now()
      this.db.prepare(`
        UPDATE search_tool_calls SET status = 'charged', charged_micros = ?, credits = ?,
          request_id = COALESCE(?, request_id), result_json = ?, updated_at = ? WHERE id = ?
      `).run(chargeMicros, credits, options.requestId || null, resultJson, now, row.id)
      this.db.prepare(`
        UPDATE billing_rounds SET search_count = search_count + 1,
          search_credits = search_credits + ?, total_micros = total_micros + ?, updated_at = ? WHERE id = ?
      `).run(credits, chargeMicros, now, row.billing_round_id)
      return mapSearchToolCall(this.db.prepare('SELECT * FROM search_tool_calls WHERE id = ?').get(row.id))
    })
    return run()
  }

  failSearchCall(callId, error) {
    const run = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM search_tool_calls WHERE id = ?').get(callId)
      if (!row || row.status === 'failed' || row.status === 'charged') return mapSearchToolCall(row)
      this.releaseReservedBalance(row.user_id, row.reserved_micros)
      this.db.prepare("UPDATE search_tool_calls SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run(String(error || '搜索请求失败').slice(0, 500), this.now(), row.id)
      return mapSearchToolCall(this.db.prepare('SELECT * FROM search_tool_calls WHERE id = ?').get(row.id))
    })
    return run()
  }

  reserveGeneration({ userId, idempotencyKey, requestHash, priceMicros, billingRoundId = null }) {
    const now = this.now()
    const insertJob = (chargeSource, jobPrice, creditsUsed) => {
      const result = this.db.prepare(`
        INSERT INTO generation_jobs (
          user_id, idempotency_key, request_hash, status, price_micros,
          charge_source, credits_used, billing_round_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)
      `).run(userId, idempotencyKey, requestHash, jobPrice, chargeSource, creditsUsed, billingRoundId, now, now)
      return {
        existing: false,
        job: this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(result.lastInsertRowid),
      }
    }
    const run = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT * FROM generation_jobs WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, idempotencyKey)
      if (existing) {
        if (existing.request_hash !== requestHash) {
          return { error: createError('同一请求标识不能用于不同的生成内容', 409, 'IDEMPOTENCY_CONFLICT') }
        }
        const existingRoundId = existing.billing_round_id == null ? null : Number(existing.billing_round_id)
        const requestedRoundId = billingRoundId == null ? null : Number(billingRoundId)
        if (existingRoundId !== requestedRoundId) {
          return { error: createError('同一请求标识不能用于不同的 Agent 轮次', 409, 'IDEMPOTENCY_CONFLICT') }
        }
        return { existing: true, job: existing }
      }

      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
      if (!user || Number(user.status) !== 1) {
        return { error: createError('账户已停用或不存在', 403, 'ACCOUNT_DISABLED') }
      }

      if (billingRoundId != null) {
        const round = this.db.prepare('SELECT * FROM billing_rounds WHERE id = ? AND user_id = ?').get(billingRoundId, userId)
        if (!round || round.status !== 'open') return { error: createError('Agent 计费轮次无效或已结束', 409, 'ROUND_FINISHED') }
      }

      // 老会员权益继续有效；非会员只能使用图片次数，不再使用现金余额兜底。
      if (user.membership_expires_at && Number(user.membership_expires_at) > now) {
        return insertJob('membership', 0, 0)
      }

      const availableCredits = Number(user.image_credits) - Number(user.reserved_credits)
      if (availableCredits >= 1) {
        this.db.prepare(`
          UPDATE users SET reserved_credits = reserved_credits + 1, updated_at = ? WHERE id = ?
        `).run(now, userId)
        return insertJob('credits', 0, 1)
      }

      return { error: createError('生成次数不足，请开通会员或购买生成次数', 402, 'INSUFFICIENT_CREDITS') }
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
      const chargeSource = job.charge_source || 'balance'
      if (chargeSource === 'membership') {
        // Membership: unlimited generations, no wallet deduction.
        this.db.prepare(`
          UPDATE users SET request_count = request_count + 1, updated_at = ? WHERE id = ?
        `).run(now, job.user_id)
      } else if (chargeSource === 'credits') {
        const creditsUsed = Number(job.credits_used) || 1
        if (!user || user.reserved_credits < creditsUsed || user.image_credits < creditsUsed) {
          throw createError('生成任务结算状态异常', 500, 'BILLING_STATE_INVALID')
        }
        this.db.prepare(`
          UPDATE users
          SET image_credits = image_credits - ?, reserved_credits = reserved_credits - ?,
              request_count = request_count + 1, updated_at = ?
          WHERE id = ?
        `).run(creditsUsed, creditsUsed, now, job.user_id)
        this.db.prepare(`
          INSERT INTO ledger_entries (
            user_id, kind, amount_micros, balance_after_micros, reference, description, created_at
          ) VALUES (?, 'credit_charge', 0, ?, ?, ?, ?)
        `).run(job.user_id, user.balance_micros, `generation:${job.id}`, `图片生成成功 · 消耗 ${creditsUsed} 次`, now)
      } else {
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
      }
      if (job.billing_round_id != null) {
        const imageChargeMicros = chargeSource === 'balance' ? job.price_micros : 0
        this.db.prepare(`
          UPDATE billing_rounds SET image_count = image_count + 1,
            image_credits_used = image_credits_used + ?, total_micros = total_micros + ?, updated_at = ?
          WHERE id = ?
        `).run(Number(job.credits_used) || 0, imageChargeMicros, now, job.billing_round_id)
      }
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
      const chargeSource = job.charge_source || 'balance'
      if (chargeSource === 'credits') {
        this.db.prepare(`
          UPDATE users SET reserved_credits = MAX(0, reserved_credits - ?), updated_at = ? WHERE id = ?
        `).run(Number(job.credits_used) || 1, now, job.user_id)
      } else if (chargeSource === 'balance') {
        this.db.prepare(`
          UPDATE users SET reserved_micros = MAX(0, reserved_micros - ?), updated_at = ? WHERE id = ?
        `).run(job.price_micros, now, job.user_id)
      }
      // membership jobs freeze nothing, so there is nothing to refund.
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
      this.db.prepare('UPDATE users SET reserved_credits = 0 WHERE reserved_credits > 0').run()
      this.db.prepare(`
        UPDATE generation_jobs
        SET status = 'failed', error = '服务重启，未完成任务已释放额度', updated_at = ?
        WHERE status IN ('reserved', 'submitted')
      `).run(now)
      this.db.prepare(`
        UPDATE agent_calls
        SET status = 'failed', error = '服务重启，未完成任务已释放额度', updated_at = ?
        WHERE status IN ('reserved', 'submitted')
      `).run(now)
      this.db.prepare(`
        UPDATE search_tool_calls
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

  // Internal helpers — must be called inside an open transaction.
  applyMembershipDays(userId, days, now) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
    // Extend from the later of "now" and the current expiry so stacking purchases add up.
    const base = Math.max(Number(user.membership_expires_at) || now, now)
    const expiry = base + days * 24 * 60 * 60 * 1000
    this.db.prepare('UPDATE users SET membership_expires_at = ?, updated_at = ? WHERE id = ?').run(expiry, now, userId)
    return expiry
  }

  applyCredits(userId, credits, now) {
    this.db.prepare('UPDATE users SET image_credits = image_credits + ?, updated_at = ? WHERE id = ?').run(credits, now, userId)
  }

  insertLedger(userId, kind, amountMicros, balanceAfterMicros, reference, description, now) {
    this.db.prepare(`
      INSERT INTO ledger_entries (
        user_id, kind, amount_micros, balance_after_micros, reference, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, kind, amountMicros, balanceAfterMicros, reference, description, now)
  }

  getCheckoutIntent(id) {
    return mapCheckoutIntent(this.db.prepare('SELECT * FROM product_checkout_intents WHERE id = ?').get(String(id)))
  }

  getBalanceCheckoutIntent(id) {
    return mapBalanceCheckoutIntent(this.db.prepare('SELECT * FROM balance_checkout_intents WHERE id = ?').get(String(id)))
  }

  createCheckoutIntent({ userId, productId, ttlMs = 30 * 60 * 1000 }) {
    const duration = Math.trunc(Number(ttlMs))
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 24 * 60 * 60 * 1000) {
      throw createError('结算意向有效期无效', 400, 'INVALID_CHECKOUT_TTL')
    }
    const now = this.now()
    const run = this.db.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId))
      if (!user) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
      const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(String(productId))
      if (!product) throw createError('商品不存在', 404, 'PRODUCT_NOT_FOUND')
      if (product.kind !== 'credits') throw createError('会员商品已停止销售，请购买生图次数', 409, 'MEMBERSHIP_SALES_DISABLED')
      if (!product.active) throw createError('商品已下架', 409, 'PRODUCT_INACTIVE')
      if (!(product.price_micros > 0)) throw createError('商品价格无效', 400, 'INVALID_PRODUCT_PRICE')
      if (!(product.credits > 0)) throw createError('商品次数无效', 400, 'INVALID_CREDITS')
      const id = randomBytes(24).toString('hex')
      this.db.prepare(`
        INSERT INTO product_checkout_intents (
          id, user_id, product_id, product_name, amount_micros, credits, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, user.id, product.id, product.name, product.price_micros, product.credits, now + duration, now)
      return this.getCheckoutIntent(id)
    })
    return run()
  }

  createBalanceCheckoutIntent({ userId, amountMicros, ttlMs = 30 * 60 * 1000 }) {
    const duration = Math.trunc(Number(ttlMs))
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 24 * 60 * 60 * 1000) {
      throw createError('结算意向有效期无效', 400, 'INVALID_CHECKOUT_TTL')
    }
    const amount = Number(amountMicros)
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 10000 !== 0) {
      throw createError('充值金额必须大于 0 且最多保留两位小数', 400, 'INVALID_AMOUNT')
    }
    const now = this.now()
    const run = this.db.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId))
      if (!user) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
      const id = `bal_${randomBytes(22).toString('hex')}`
      this.db.prepare(`
        INSERT INTO balance_checkout_intents (
          id, user_id, amount_micros, status, expires_at, created_at
        ) VALUES (?, ?, ?, 'pending', ?, ?)
      `).run(id, user.id, amount, now + duration, now)
      return this.getBalanceCheckoutIntent(id)
    })
    return run()
  }

  recordCheckoutPayment(id, { provider, externalId, paymentType }) {
    const found = this.getCheckoutIntent(id) || this.getBalanceCheckoutIntent(id)
    if (!found) throw createError('支付结算意向不存在', 404, 'CHECKOUT_INTENT_NOT_FOUND')
    if (found.status !== 'pending') throw createError('支付结算意向状态无效', 409, 'CHECKOUT_INTENT_CONFLICT')
    const table = found.productId ? 'product_checkout_intents' : 'balance_checkout_intents'
    this.db.prepare(`
      UPDATE ${table}
      SET payment_provider = ?, payment_external_id = ?, payment_type = ?
      WHERE id = ? AND status = 'pending'
    `).run(String(provider), String(externalId).slice(0, 128), String(paymentType).slice(0, 32), found.id)
    return found.productId ? this.getCheckoutIntent(found.id) : this.getBalanceCheckoutIntent(found.id)
  }

  creditPayment({ provider, externalId, email, userId, amountMicros, productId, checkoutIntentId, balanceCheckoutIntentId, payloadHash }) {
    const now = this.now()
    const run = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT * FROM payment_events WHERE provider = ? AND external_id = ?
      `).get(provider, externalId)
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw createError('同一支付订单号不能对应不同内容', 409, 'PAYMENT_IDEMPOTENCY_CONFLICT')
        return { duplicate: true }
      }

      let user = null
      if (userId != null && userId !== '') {
        user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId))
      }
      const emailUser = email
        ? this.db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email))
        : null
      if (user && emailUser && user.id !== emailUser.id) {
        throw createError('支付账户信息不一致', 409, 'PAYMENT_USER_MISMATCH')
      }
      if (!user) user = emailUser
      if (!user) throw createError('支付事件对应的账户不存在', 404, 'USER_NOT_FOUND')

      const reference = `payment:${provider}:${externalId}`

      if (balanceCheckoutIntentId) {
        if (productId || checkoutIntentId) throw createError('充值结算意向不能与商品结算意向混用', 400, 'CHECKOUT_INTENT_CONFLICT')
        const intent = this.db.prepare('SELECT * FROM balance_checkout_intents WHERE id = ?').get(String(balanceCheckoutIntentId))
        if (!intent) throw createError('充值结算意向不存在', 404, 'CHECKOUT_INTENT_NOT_FOUND')
        if (intent.status === 'paid') throw createError('充值结算意向已经支付', 409, 'CHECKOUT_INTENT_PAID')
        if (intent.expires_at <= now) throw createError('充值结算意向已过期，请重新发起', 409, 'CHECKOUT_INTENT_EXPIRED')
        if (intent.user_id !== user.id) throw createError('充值结算意向与支付账户不一致', 409, 'PAYMENT_USER_MISMATCH')
        if (amountMicros !== intent.amount_micros) throw createError('支付金额与充值结算意向不一致', 409, 'PAYMENT_AMOUNT_MISMATCH')
        const balanceAfter = user.balance_micros + intent.amount_micros
        const event = this.db.prepare(`
          INSERT INTO payment_events (provider, external_id, user_id, amount_micros, payload_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(provider, externalId, user.id, intent.amount_micros, payloadHash, now)
        this.db.prepare('UPDATE users SET balance_micros = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
        this.insertLedger(user.id, 'payment_credit', intent.amount_micros, balanceAfter, reference, '支付充值', now)
        const eventId = Number(event.lastInsertRowid)
        const settled = this.db.prepare(`
          UPDATE balance_checkout_intents
          SET status = 'paid', payment_event_id = ?, payment_provider = ?, payment_external_id = ?, paid_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(eventId, provider, externalId, now, intent.id)
        if (settled.changes !== 1) throw createError('充值结算意向状态冲突', 409, 'CHECKOUT_INTENT_CONFLICT')
        return {
          duplicate: false,
          eventId,
          userId: user.id,
          kind: 'balance',
          balanceMicros: balanceAfter,
          checkoutIntentId: intent.id,
        }
      }

      if (productId || checkoutIntentId) {
        if (!productId) throw createError('商品支付缺少商品 ID', 400, 'PRODUCT_ID_REQUIRED')
        if (!checkoutIntentId) throw createError('商品支付缺少有效的结算意向', 400, 'CHECKOUT_INTENT_REQUIRED')
        const intent = this.db.prepare('SELECT * FROM product_checkout_intents WHERE id = ?').get(String(checkoutIntentId))
        if (!intent) throw createError('结算意向不存在', 404, 'CHECKOUT_INTENT_NOT_FOUND')
        if (intent.status === 'paid') throw createError('结算意向已经支付', 409, 'CHECKOUT_INTENT_PAID')
        if (intent.expires_at <= now) throw createError('结算意向已过期，请重新购买', 409, 'CHECKOUT_INTENT_EXPIRED')
        if (intent.user_id !== user.id) throw createError('结算意向与支付账户不一致', 409, 'PAYMENT_USER_MISMATCH')
        if (intent.product_id !== String(productId)) throw createError('结算意向与商品不一致', 409, 'PAYMENT_PRODUCT_MISMATCH')
        if (amountMicros !== intent.amount_micros) throw createError('支付金额与结算意向不一致', 409, 'PAYMENT_AMOUNT_MISMATCH')
        const event = this.db.prepare(`
          INSERT INTO payment_events (provider, external_id, user_id, amount_micros, payload_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(provider, externalId, user.id, intent.amount_micros, payloadHash, now)
        this.applyCredits(user.id, intent.credits, now)
        this.insertLedger(user.id, 'credits_payment', 0, user.balance_micros, reference, `购买次数包：${intent.product_name}（+${intent.credits} 次）`, now)
        const eventId = Number(event.lastInsertRowid)
        const settled = this.db.prepare(`
          UPDATE product_checkout_intents
          SET status = 'paid', payment_event_id = ?, payment_provider = ?, payment_external_id = ?, paid_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(eventId, provider, externalId, now, intent.id)
        if (settled.changes !== 1) throw createError('结算意向状态冲突', 409, 'CHECKOUT_INTENT_CONFLICT')
        return {
          duplicate: false,
          eventId,
          userId: user.id,
          kind: 'credits',
          creditsAdded: intent.credits,
          checkoutIntentId: intent.id,
        }
      }

      // 兼容原有余额充值流程；只有商品购买必须使用结算意向。
      if (!(amountMicros > 0)) throw createError('充值金额无效', 400, 'INVALID_AMOUNT')
      const balanceAfter = user.balance_micros + amountMicros
      const event = this.db.prepare(`
        INSERT INTO payment_events (provider, external_id, user_id, amount_micros, payload_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(provider, externalId, user.id, amountMicros, payloadHash, now)
      this.db.prepare('UPDATE users SET balance_micros = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
      this.insertLedger(user.id, 'payment_credit', amountMicros, balanceAfter, reference, '支付充值', now)
      return { duplicate: false, eventId: Number(event.lastInsertRowid), userId: user.id, balanceMicros: balanceAfter }
    })
    return run()
  }

  listProducts({ activeOnly = false } = {}) {
    const sql = activeOnly
      ? 'SELECT * FROM products WHERE active = 1 ORDER BY sort_order ASC, price_micros ASC'
      : 'SELECT * FROM products ORDER BY sort_order ASC, price_micros ASC'
    return this.db.prepare(sql).all().map(mapProduct)
  }

  getProduct(id) {
    return mapProduct(this.db.prepare('SELECT * FROM products WHERE id = ?').get(String(id)))
  }

  upsertProduct(actorUserId, input) {
    const id = String(input.id || '').trim()
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw createError('商品 ID 只能包含字母、数字、- 和 _，且以字母或数字开头', 400, 'INVALID_PRODUCT_ID')
    const kind = input.kind
    if (!['membership', 'credits'].includes(kind)) throw createError('商品类型无效', 400, 'INVALID_PRODUCT_KIND')
    const name = String(input.name || '').trim()
    if (!name || name.length > 100) throw createError('商品名称无效', 400, 'INVALID_PRODUCT_NAME')
    const priceMicros = Number(input.priceMicros)
    if (!Number.isSafeInteger(priceMicros) || priceMicros < 0) throw createError('商品价格无效', 400, 'INVALID_PRODUCT_PRICE')
    const durationDays = Math.trunc(Number(input.durationDays) || 0)
    const credits = Math.trunc(Number(input.credits) || 0)
    if (!Number.isSafeInteger(durationDays) || durationDays < 0 || durationDays > 100000) throw createError('会员天数无效', 400, 'INVALID_DURATION')
    if (!Number.isSafeInteger(credits) || credits < 0 || credits > 100000000) throw createError('次数数值无效', 400, 'INVALID_CREDITS')
    if (kind === 'membership' && durationDays <= 0) throw createError('会员商品必须设置有效天数', 400, 'INVALID_DURATION')
    if (kind === 'credits' && credits <= 0) throw createError('次数商品必须设置次数', 400, 'INVALID_CREDITS')
    const description = String(input.description || '').slice(0, 500)
    const sortOrder = Math.trunc(Number(input.sortOrder) || 0)
    // On edit, an omitted `active` must preserve the existing state (never silently re-list a hidden product).
    const existingProduct = this.getProduct(id)
    if (existingProduct && (
      existingProduct.kind !== kind ||
      existingProduct.priceMicros !== priceMicros ||
      existingProduct.durationDays !== durationDays ||
      existingProduct.credits !== credits
    )) {
      throw createError('已发布商品的价格和权益不可修改，请使用新的商品 ID 创建新版本', 409, 'PRODUCT_TERMS_IMMUTABLE')
    }
    const active = input.active === undefined ? (existingProduct ? (existingProduct.active ? 1 : 0) : 1) : (input.active ? 1 : 0)
    if (kind === 'membership' && active) throw createError('会员商品已停止销售，请创建生图次数商品', 400, 'MEMBERSHIP_SALES_DISABLED')
    if (active && priceMicros <= 0) throw createError('上架商品价格必须大于 0', 400, 'INVALID_PRODUCT_PRICE')
    const now = this.now()
    const run = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO products (id, kind, name, description, price_micros, duration_days, credits, sort_order, active, created_at, updated_at)
        VALUES (@id, @kind, @name, @description, @priceMicros, @durationDays, @credits, @sortOrder, @active, @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          kind = @kind, name = @name, description = @description, price_micros = @priceMicros,
          duration_days = @durationDays, credits = @credits, sort_order = @sortOrder, active = @active, updated_at = @now
      `).run({ id, kind, name, description, priceMicros, durationDays, credits, sortOrder, active, now })
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, action, details, created_at) VALUES (?, 'product_upserted', ?, ?)
      `).run(actorUserId, JSON.stringify({ id, kind, priceMicros, durationDays, credits, active }), now)
      return this.getProduct(id)
    })
    return run()
  }

  deleteProduct(actorUserId, id) {
    const now = this.now()
    const run = this.db.transaction(() => {
      const info = this.db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(now, String(id))
      if (info.changes) {
        this.db.prepare(`
          INSERT INTO audit_logs (actor_user_id, action, details, created_at) VALUES (?, 'product_deleted', ?, ?)
        `).run(actorUserId, JSON.stringify({ id: String(id) }), now)
      }
      return { deleted: info.changes > 0 }
    })
    return run()
  }

  adminGrantMembership(actorUserId, targetUserId, days, note = '') {
    const grantDays = Math.trunc(Number(days))
    if (!Number.isSafeInteger(grantDays) || grantDays <= 0) throw createError('会员天数无效', 400, 'INVALID_DURATION')
    const now = this.now()
    const run = this.db.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId)
      if (!user) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
      const expiry = this.applyMembershipDays(targetUserId, grantDays, now)
      const ref = `admin_membership:${actorUserId}:${targetUserId}:${now}:${randomBytes(6).toString('hex')}`
      this.insertLedger(targetUserId, 'membership_grant', 0, user.balance_micros, ref, String(note || `管理员开通会员 ${grantDays} 天`).slice(0, 200), now)
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, target_user_id, action, details, created_at)
        VALUES (?, ?, 'membership_granted', ?, ?)
      `).run(actorUserId, targetUserId, JSON.stringify({ days: grantDays, expiry, note }), now)
      return this.getUserById(targetUserId)
    })
    return run()
  }

  adminGrantCredits(actorUserId, targetUserId, credits, note = '') {
    const grantCredits = Math.trunc(Number(credits))
    if (!Number.isSafeInteger(grantCredits) || grantCredits === 0) throw createError('次数无效', 400, 'INVALID_CREDITS')
    const now = this.now()
    const run = this.db.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId)
      if (!user) throw createError('账户不存在', 404, 'USER_NOT_FOUND')
      if (user.image_credits + grantCredits < user.reserved_credits) {
        throw createError('调整后次数不能低于已冻结次数', 400, 'CREDITS_TOO_LOW')
      }
      this.applyCredits(targetUserId, grantCredits, now)
      const ref = `admin_credits:${actorUserId}:${targetUserId}:${now}:${randomBytes(6).toString('hex')}`
      const desc = note || (grantCredits > 0 ? `管理员赠送 ${grantCredits} 次` : `管理员扣减 ${-grantCredits} 次`)
      this.insertLedger(targetUserId, 'credit_grant', 0, user.balance_micros, ref, String(desc).slice(0, 200), now)
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, target_user_id, action, details, created_at)
        VALUES (?, ?, 'credits_granted', ?, ?)
      `).run(actorUserId, targetUserId, JSON.stringify({ credits: grantCredits, note }), now)
      return this.getUserById(targetUserId)
    })
    return run()
  }

  createRedemptionCodes(actorUserId, options = {}) {
    const credits = Math.trunc(Number(options.credits) || 0)
    const membershipDays = Math.trunc(Number(options.membershipDays) || 0)
    const balanceMicros = Math.trunc(Number(options.balanceMicros) || 0)
    // Distinguish an omitted count (→ default 1) from an explicit 0 (→ rejected below).
    const count = options.count == null || options.count === '' ? 1 : Math.trunc(Number(options.count))
    const note = String(options.note || '').slice(0, 200)
    const expiresAt = options.expiresAt ? Number(options.expiresAt) : null
    const maxRedemptions = options.maxRedemptions == null || options.maxRedemptions === '' ? 1 : Math.trunc(Number(options.maxRedemptions))
    const enabled = options.enabled === undefined ? true : Boolean(options.enabled)
    if (credits < 0 || membershipDays < 0 || balanceMicros < 0) throw createError('数值不能为负', 400, 'INVALID_VALUE')
    if (credits === 0 && membershipDays === 0 && balanceMicros === 0) throw createError('兑换码至少要包含次数、会员天数或余额之一', 400, 'EMPTY_REDEMPTION')
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw createError('生成数量需在 1–1000 之间', 400, 'INVALID_COUNT')
    if (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000) throw createError('每个兑换码可使用次数需在 1–100000 之间', 400, 'INVALID_MAX_REDEMPTIONS')
    if (expiresAt !== null && !Number.isSafeInteger(expiresAt)) throw createError('兑换码有效期无效', 400, 'INVALID_EXPIRY')
    const now = this.now()
    const insert = this.db.prepare(`
      INSERT INTO redemption_codes (code, credits, membership_days, balance_micros, note, expires_at, created_by, created_at, enabled, max_redemptions, redemption_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    const run = this.db.transaction(() => {
      const codes = []
      for (let i = 0; i < count; i += 1) {
        let inserted = false
        for (let attempt = 0; attempt < 8 && !inserted; attempt += 1) {
          const code = generateRedemptionCode()
          try {
            insert.run(code, credits, membershipDays, balanceMicros, note, expiresAt, actorUserId, now, enabled ? 1 : 0, maxRedemptions)
            codes.push(code)
            inserted = true
          } catch (err) {
            if (!/UNIQUE/i.test(String(err && err.message))) throw err
          }
        }
        if (!inserted) throw createError('生成兑换码失败，请重试', 500, 'CODE_GEN_FAILED')
      }
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, action, details, created_at)
        VALUES (?, 'redemption_codes_created', ?, ?)
      `).run(actorUserId, JSON.stringify({ count, credits, membershipDays, balanceMicros, maxRedemptions, enabled }), now)
      return codes
    })
    return run()
  }

  redeemCode(userId, code) {
    const canonical = canonicalizeRedemptionCode(code)
    if (!canonical) throw createError('兑换码格式无效', 400, 'INVALID_CODE_FORMAT')
    const now = this.now()
    const run = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM redemption_codes WHERE code = ?').get(canonical)
      if (!row) throw createError('兑换码不存在', 404, 'CODE_NOT_FOUND')
      if (!row.enabled) throw createError('该兑换码已停用', 409, 'CODE_DISABLED')
      if (row.expires_at && row.expires_at <= now) throw createError('兑换码已过期', 400, 'CODE_EXPIRED')
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
      if (!user || Number(user.status) !== 1) throw createError('账户已停用或不存在', 403, 'ACCOUNT_DISABLED')
      if (row.redeemed_by === userId || this.db.prepare('SELECT 1 FROM redemption_records WHERE code = ? AND user_id = ?').get(canonical, userId)) {
        throw createError('该兑换码已被使用，当前账户不能重复兑换', 409, 'CODE_ALREADY_REDEEMED')
      }
      if (row.redemption_count >= row.max_redemptions) throw createError('该兑换码已达到使用次数上限', 409, 'CODE_EXHAUSTED')

      const claimed = this.db.prepare(`
        UPDATE redemption_codes
        SET redemption_count = redemption_count + 1,
            redeemed_by = COALESCE(redeemed_by, ?),
            redeemed_at = COALESCE(redeemed_at, ?)
        WHERE code = ? AND enabled = 1 AND redemption_count < max_redemptions
      `).run(userId, now, canonical)
      if (claimed.changes !== 1) throw createError('兑换码已达到使用次数上限', 409, 'CODE_EXHAUSTED')
      this.db.prepare(`
        INSERT INTO redemption_records (code, user_id, credits, membership_days, balance_micros, redeemed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(canonical, userId, row.credits, row.membership_days, row.balance_micros, now)

      const granted = {}
      if (row.credits > 0) {
        this.applyCredits(userId, row.credits, now)
        this.insertLedger(userId, 'redeem_credits', 0, user.balance_micros, `redeem:${canonical}:${userId}:credits`, `兑换 ${row.credits} 次生成额度`, now)
        granted.credits = row.credits
      }
      if (row.membership_days > 0) {
        granted.membershipExpiresAt = this.applyMembershipDays(userId, row.membership_days, now)
        this.insertLedger(userId, 'redeem_membership', 0, user.balance_micros, `redeem:${canonical}:${userId}:membership`, `兑换会员 ${row.membership_days} 天`, now)
        granted.membershipDays = row.membership_days
      }
      if (row.balance_micros > 0) {
        const balanceAfter = user.balance_micros + row.balance_micros
        this.db.prepare('UPDATE users SET balance_micros = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, userId)
        this.insertLedger(userId, 'redeem_balance', row.balance_micros, balanceAfter, `redeem:${canonical}:${userId}:balance`, '兑换余额', now)
        granted.balanceMicros = row.balance_micros
      }
      this.db.prepare(`
        INSERT INTO audit_logs (actor_user_id, target_user_id, action, details, created_at)
        VALUES (?, ?, 'redemption_redeemed', ?, ?)
      `).run(userId, userId, JSON.stringify({ code: canonical, granted }), now)
      return { user: this.getUserById(userId), granted }
    })
    return run.immediate()
  }

  listRedemptionCodes(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100))
    const search = String(options.search || '').trim().toUpperCase().slice(0, 100)
    const status = String(options.status || (options.unusedOnly ? 'available' : 'all'))
    const clauses = []
    const params = []
    if (search) {
      clauses.push('(code LIKE ? OR note LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    if (status === 'available') {
      clauses.push('enabled = 1 AND redemption_count < max_redemptions AND (expires_at IS NULL OR expires_at > ?)')
      params.push(this.now())
    }
    if (status === 'disabled') clauses.push('enabled = 0')
    if (status === 'exhausted') clauses.push('redemption_count >= max_redemptions')
    if (status === 'expired') {
      clauses.push('expires_at IS NOT NULL AND expires_at <= ?')
      params.push(this.now())
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT * FROM redemption_codes ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit)
    return rows.map(mapRedemptionCode)
  }

  setRedemptionCodeEnabled(actorUserId, code, enabled) {
    const canonical = canonicalizeRedemptionCode(code)
    if (!canonical) throw createError('兑换码格式无效', 400, 'INVALID_CODE_FORMAT')
    const now = this.now()
    const result = this.db.prepare('UPDATE redemption_codes SET enabled = ? WHERE code = ?').run(enabled ? 1 : 0, canonical)
    if (result.changes !== 1) throw createError('兑换码不存在', 404, 'CODE_NOT_FOUND')
    this.db.prepare(`
      INSERT INTO audit_logs (actor_user_id, action, details, created_at)
      VALUES (?, 'redemption_code_status_changed', ?, ?)
    `).run(actorUserId, JSON.stringify({ code: canonical, enabled: Boolean(enabled) }), now)
    return mapRedemptionCode(this.db.prepare('SELECT * FROM redemption_codes WHERE code = ?').get(canonical))
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
    // No-op edit: nothing actually changed → don't bump auth_version or revoke sessions.
    if (role === target.role && status === target.status && group === target.group) {
      return target
    }
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
