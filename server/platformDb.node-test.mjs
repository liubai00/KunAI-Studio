import assert from 'node:assert/strict'
import test from 'node:test'
import { PlatformDatabase, parseMoneyToMicros } from './platformDb.mjs'

function createUser(db, email = 'user@example.com', credit = 1000000, role = 1) {
  db.createChallenge({
    email,
    purpose: 'register',
    codeHash: 'valid-code',
    expiresAt: Date.now() + 60000,
    cooldownMs: 0,
  })
  return db.registerUser({
    email,
    passwordHash: 'password-hash',
    displayName: 'User',
    role,
    group: role >= 10 ? 'admin' : 'default',
    signupCreditMicros: credit,
    codeHash: 'valid-code',
    maxAttempts: 5,
  })
}

test('money parsing uses integer micro units', () => {
  assert.equal(parseMoneyToMicros('0.07'), 70000)
  assert.equal(parseMoneyToMicros('12.345678'), 12345678)
  assert.equal(parseMoneyToMicros('-5'), -5000000)
  assert.throws(() => parseMoneyToMicros('0.0000001'), /金额格式无效/)
})

test('verification codes are purpose-bound, attempt-limited and single-use', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  db.createChallenge({
    email: 'User@Example.com',
    purpose: 'register',
    codeHash: 'valid-code',
    expiresAt: Date.now() + 60000,
    cooldownMs: 0,
  })
  assert.throws(() => db.registerUser({
    email: 'user@example.com',
    passwordHash: 'hash',
    role: 1,
    group: 'default',
    signupCreditMicros: 0,
    codeHash: 'wrong-code',
    maxAttempts: 5,
  }), /验证码不正确/)

  const user = db.registerUser({
    email: 'user@example.com',
    passwordHash: 'hash',
    role: 1,
    group: 'default',
    signupCreditMicros: 0,
    codeHash: 'valid-code',
    maxAttempts: 5,
  })
  assert.equal(user.email, 'user@example.com')
  assert.throws(() => db.registerUser({
    email: 'user@example.com',
    passwordHash: 'hash',
    role: 1,
    group: 'default',
    signupCreditMicros: 0,
    codeHash: 'valid-code',
    maxAttempts: 5,
  }), /已注册/)
  db.close()
})

test('opaque sessions validate CSRF and can be revoked', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const user = createUser(db)
  const session = db.createSession(user.id, { ttlMs: 60000 })
  assert.equal(db.getSession(session.token).user.id, user.id)
  assert.equal(db.verifyCsrf(session.token, session.csrfToken), true)
  assert.equal(db.verifyCsrf(session.token, 'wrong-token'), false)
  db.revokeSession(session.token)
  assert.equal(db.getSession(session.token), null)
  db.close()
})

test('failed image jobs release reservations and successful jobs charge once', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const user = createUser(db)
  const failed = db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'failed-request-key',
    requestHash: 'failed-hash',
    priceMicros: 70000,
  })
  assert.equal(db.getUserById(user.id).reservedMicros, 70000)
  db.failGeneration(failed.job.id, 'upstream failed')
  assert.equal(db.getUserById(user.id).balanceMicros, 1000000)
  assert.equal(db.getUserById(user.id).reservedMicros, 0)

  const successful = db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'successful-request-key',
    requestHash: 'successful-hash',
    priceMicros: 70000,
  })
  db.markGenerationSubmitted(successful.job.id, 'upstream-id')
  db.settleGeneration(successful.job.id, {
    path: 'result.json',
    contentType: 'application/json',
    httpStatus: 200,
  })
  db.settleGeneration(successful.job.id, {
    path: 'result.json',
    contentType: 'application/json',
    httpStatus: 200,
  })
  const chargedUser = db.getUserById(user.id)
  assert.equal(chargedUser.balanceMicros, 930000)
  assert.equal(chargedUser.usedMicros, 70000)
  assert.equal(chargedUser.requestCount, 1)
  assert.equal(db.listLedger(user.id).filter((entry) => entry.kind === 'image_charge').length, 1)

  const repeated = db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'successful-request-key',
    requestHash: 'successful-hash',
    priceMicros: 70000,
  })
  assert.equal(repeated.existing, true)
  assert.equal(repeated.job.status, 'charged')
  assert.throws(() => db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'successful-request-key',
    requestHash: 'different-hash',
    priceMicros: 70000,
  }), /不能用于不同/)
  db.close()
})

test('concurrent reservations cannot exceed available balance', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const user = createUser(db, 'small@example.com', 100000)
  db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'first-reservation',
    requestHash: 'first',
    priceMicros: 70000,
  })
  assert.throws(() => db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'second-reservation',
    requestHash: 'second',
    priceMicros: 70000,
  }), /余额不足/)
  db.close()
})

test('payment credits are idempotent and access changes revoke sessions', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin@example.com', 0, 10)
  const user = createUser(db, 'member@example.com', 0)
  const session = db.createSession(user.id, { ttlMs: 60000 })
  const first = db.creditPayment({
    provider: 'test',
    externalId: 'order-1',
    email: user.email,
    amountMicros: 2500000,
    payloadHash: 'payload',
  })
  const repeated = db.creditPayment({
    provider: 'test',
    externalId: 'order-1',
    email: user.email,
    amountMicros: 2500000,
    payloadHash: 'payload',
  })
  assert.equal(first.duplicate, false)
  assert.equal(repeated.duplicate, true)
  assert.equal(db.getUserById(user.id).balanceMicros, 2500000)

  db.updateUserAccess(admin.id, user.id, { status: 0 })
  assert.equal(db.getSession(session.token), null)
  assert.equal(db.getUserById(user.id).status, 0)
  db.close()
})

test('explicit admin email configuration promotes an existing account', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const user = createUser(db, 'owner@example.com', 0)
  const session = db.createSession(user.id, { ttlMs: 60000 })
  assert.equal(db.promoteAdminEmails(['OWNER@example.com']), 1)
  assert.equal(db.getUserById(user.id).role, 10)
  assert.equal(db.getSession(session.token), null)
  assert.equal(db.promoteAdminEmails(['owner@example.com']), 0)
  db.close()
})
