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
  }), /额度不足/)
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

const settleResult = { path: 'result.bin', hash: 'result-hash', contentType: 'image/png', httpStatus: 200 }

test('image credits are consumed before balance and refunded on failure', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-credits@example.com', 0, 10)
  const user = createUser(db, 'credits@example.com', 1000000)
  db.adminGrantCredits(admin.id, user.id, 2, 'test grant')
  assert.equal(db.getUserById(user.id).imageCredits, 2)

  const reservation = db.reserveGeneration({ userId: user.id, idempotencyKey: 'k1', requestHash: 'h1', priceMicros: 70000 })
  assert.equal(reservation.job.charge_source, 'credits')
  assert.equal(db.getUserById(user.id).reservedCredits, 1)
  assert.equal(db.getUserById(user.id).reservedMicros, 0)

  db.settleGeneration(reservation.job.id, settleResult)
  const afterSettle = db.getUserById(user.id)
  assert.equal(afterSettle.imageCredits, 1)
  assert.equal(afterSettle.reservedCredits, 0)
  assert.equal(afterSettle.balanceMicros, 1000000)
  assert.equal(db.listLedger(user.id).filter((entry) => entry.kind === 'credit_charge').length, 1)

  const failing = db.reserveGeneration({ userId: user.id, idempotencyKey: 'k2', requestHash: 'h2', priceMicros: 70000 })
  db.failGeneration(failing.job.id, 'boom')
  assert.equal(db.getUserById(user.id).imageCredits, 1)
  assert.equal(db.getUserById(user.id).reservedCredits, 0)

  const consume = db.reserveGeneration({ userId: user.id, idempotencyKey: 'k3', requestHash: 'h3', priceMicros: 70000 })
  db.settleGeneration(consume.job.id, settleResult)
  assert.equal(db.getUserById(user.id).imageCredits, 0)

  const fallback = db.reserveGeneration({ userId: user.id, idempotencyKey: 'k4', requestHash: 'h4', priceMicros: 70000 })
  assert.equal(fallback.job.charge_source, 'balance')
  db.close()
})

test('active membership makes generations free', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-member@example.com', 0, 10)
  const user = createUser(db, 'member@example.com', 100000)
  db.adminGrantMembership(admin.id, user.id, 30, 'test membership')
  assert.ok(db.getUserById(user.id).membershipExpiresAt > Date.now())

  const reservation = db.reserveGeneration({ userId: user.id, idempotencyKey: 'mk', requestHash: 'mh', priceMicros: 70000 })
  assert.equal(reservation.job.charge_source, 'membership')
  assert.equal(reservation.job.price_micros, 0)
  db.settleGeneration(reservation.job.id, settleResult)

  const after = db.getUserById(user.id)
  assert.equal(after.balanceMicros, 100000)
  assert.equal(after.imageCredits, 0)
  assert.equal(after.requestCount, 1)
  db.close()
})

test('products drive membership and credit purchases via payment', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-shop@example.com', 0, 10)
  const user = createUser(db, 'buyer@example.com', 0)

  db.upsertProduct(admin.id, { id: 'pro-monthly', kind: 'membership', name: 'Pro 月卡', priceMicros: 9990000, durationDays: 30 })
  db.upsertProduct(admin.id, { id: 'credits-100', kind: 'credits', name: '100 次生成', priceMicros: 5000000, credits: 100 })
  assert.throws(() => db.upsertProduct(admin.id, { id: 'bad', kind: 'membership', name: 'x', priceMicros: 100, durationDays: 0 }), /有效天数/)
  assert.equal(db.listProducts({ activeOnly: true }).length, 2)

  const membership = db.creditPayment({ provider: 'pay', externalId: 'order-1', userId: user.id, productId: 'pro-monthly', payloadHash: 'p' })
  assert.equal(membership.kind, 'membership')
  assert.ok(db.getUserById(user.id).membershipExpiresAt > Date.now())
  const duplicate = db.creditPayment({ provider: 'pay', externalId: 'order-1', userId: user.id, productId: 'pro-monthly', payloadHash: 'p' })
  assert.equal(duplicate.duplicate, true)

  const credits = db.creditPayment({ provider: 'pay', externalId: 'order-2', email: user.email, productId: 'credits-100', payloadHash: 'p' })
  assert.equal(credits.creditsAdded, 100)
  assert.equal(db.getUserById(user.id).imageCredits, 100)

  const topup = db.creditPayment({ provider: 'pay', externalId: 'order-3', email: user.email, amountMicros: 1000000, payloadHash: 'p' })
  assert.equal(topup.balanceMicros, 1000000)

  db.deleteProduct(admin.id, 'credits-100')
  assert.equal(db.listProducts().length, 1)
  db.close()
})

test('redemption codes grant credits/membership and are single-use', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-redeem@example.com', 0, 10)
  const user = createUser(db, 'redeemer@example.com', 0)

  const codes = db.createRedemptionCodes(admin.id, { credits: 50, membershipDays: 7, count: 3, note: 'promo' })
  assert.equal(codes.length, 3)
  assert.match(codes[0], /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.equal(db.listRedemptionCodes().length, 3)
  assert.equal(db.listRedemptionCodes({ unusedOnly: true }).length, 3)

  assert.throws(() => db.createRedemptionCodes(admin.id, { credits: 0, membershipDays: 0, count: 1 }), /至少/)

  // redeem: case-insensitive + dash-insensitive input
  const messy = codes[0].toLowerCase().replace(/-/g, '')
  const result = db.redeemCode(user.id, messy)
  assert.equal(result.granted.credits, 50)
  assert.equal(result.granted.membershipDays, 7)
  const after = db.getUserById(user.id)
  assert.equal(after.imageCredits, 50)
  assert.ok(after.membershipExpiresAt > Date.now())
  assert.equal(db.listRedemptionCodes({ unusedOnly: true }).length, 2)

  // single use
  assert.throws(() => db.redeemCode(user.id, codes[0]), /已被使用/)
  // unknown / bad format
  assert.throws(() => db.redeemCode(user.id, 'ZZZZ-ZZZZ-ZZZZ'), /不存在/)
  assert.throws(() => db.redeemCode(user.id, 'too-short'), /格式无效/)

  // expired code
  const [expiredCode] = db.createRedemptionCodes(admin.id, { credits: 10, count: 1, expiresAt: Date.now() - 1000 })
  assert.throws(() => db.redeemCode(user.id, expiredCode), /已过期/)
  db.close()
})

test('QA regression: product/redemption/access hardening', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-reg@example.com', 0, 10)

  // charset excludes ambiguous 0 O 1 I L
  const codes = db.createRedemptionCodes(admin.id, { credits: 1, count: 300 })
  const chars = new Set(codes.join('').replace(/-/g, '').split(''))
  for (const c of ['0', 'O', '1', 'I', 'L']) assert.equal(chars.has(c), false, `charset must exclude ${c}`)

  // count 0 is rejected; an omitted count still defaults to 1
  assert.throws(() => db.createRedemptionCodes(admin.id, { credits: 1, count: 0 }), /数量/)
  assert.equal(db.createRedemptionCodes(admin.id, { credits: 1 }).length, 1)

  // credits / durationDays are range-checked like price (no unsafe-integer corruption)
  assert.throws(() => db.upsertProduct(admin.id, { id: 'huge-c', kind: 'credits', name: 'x', priceMicros: 1000000, credits: 1e16 }), /次数/)
  assert.throws(() => db.upsertProduct(admin.id, { id: 'huge-m', kind: 'membership', name: 'x', priceMicros: 1000000, durationDays: 1e15 }), /天数/)

  // editing a hidden product without `active` must not silently re-list it
  db.upsertProduct(admin.id, { id: 'hidden', kind: 'credits', name: 'Hidden', priceMicros: 5000000, credits: 100, active: false })
  assert.equal(db.getProduct('hidden').active, false)
  db.upsertProduct(admin.id, { id: 'hidden', kind: 'credits', name: 'Hidden', priceMicros: 6000000, credits: 100 })
  assert.equal(db.getProduct('hidden').active, false)
  assert.equal(db.listProducts({ activeOnly: true }).some((p) => p.id === 'hidden'), false)

  // no-op user PATCH must not bump auth_version or revoke sessions
  const session = db.createSession(admin.id, { ttlMs: 60000 })
  const authVersionBefore = db.getUserById(admin.id).authVersion
  db.updateUserAccess(admin.id, admin.id, { role: 10, status: 1, group: 'admin' })
  assert.equal(db.getUserById(admin.id).authVersion, authVersionBefore)
  assert.ok(db.getSession(session.token))
  db.close()
})
