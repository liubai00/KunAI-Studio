import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('failed image jobs release balance reservations and successful jobs charge once', () => {
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
  assert.equal(chargedUser.imageCredits, 0)
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

test('image idempotency replay cannot change its agent billing round', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'image-context-admin@example.com', 0, 10)
  const user = createUser(db, 'image-context-user@example.com')
  db.upsertDiscoveredAgentModels(['agent-image-context'])
  db.configureAgentModel(admin.id, 'agent-image-context', {
    enabled: true,
    inputTokenPriceMicros: 1,
    cachedInputTokenPriceMicros: 1,
    outputTokenPriceMicros: 1,
    maxStepReserveMicros: 1000,
    isDefault: true,
  })

  for (const roundId of ['round-context-a', 'round-context-b']) {
    const call = db.reserveAgentCall({
      userId: user.id,
      conversationId: 'conversation-context',
      roundId,
      stepKey: `step-${roundId}`,
      requestHash: `hash-${roundId}`,
      modelId: 'agent-image-context',
      reserveMicros: 1000,
    })
    db.failAgentCall(call.call.id, 'test setup')
  }
  const firstRound = db.getBillingRound({
    userId: user.id,
    conversationId: 'conversation-context',
    roundId: 'round-context-a',
  })
  const secondRound = db.getBillingRound({
    userId: user.id,
    conversationId: 'conversation-context',
    roundId: 'round-context-b',
  })

  db.applyCredits(user.id, 1, Date.now())
  const first = db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'agent-image-context-key',
    requestHash: 'agent-image-context-hash',
    priceMicros: 70000,
    billingRoundId: firstRound.id,
  })
  assert.equal(db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'agent-image-context-key',
    requestHash: 'agent-image-context-hash',
    priceMicros: 70000,
    billingRoundId: firstRound.id,
  }).existing, true)

  for (const billingRoundId of [secondRound.id, null]) {
    assert.throws(() => db.reserveGeneration({
      userId: user.id,
      idempotencyKey: 'agent-image-context-key',
      requestHash: 'agent-image-context-hash',
      priceMicros: 70000,
      billingRoundId,
    }), (err) => err.code === 'IDEMPOTENCY_CONFLICT' && err.status === 409)
  }
  db.failGeneration(first.job.id, 'test cleanup')
  db.close()
})

test('concurrent image reservations cannot exceed available balance', () => {
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
  }), (err) => err.code === 'INSUFFICIENT_BALANCE' && /余额不足/.test(err.message))
  assert.equal(db.getUserById(user.id).reservedMicros, 70000)
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
  assert.throws(() => db.creditPayment({
    provider: 'test',
    externalId: 'order-1',
    email: user.email,
    amountMicros: 2500000,
    payloadHash: 'different-payload',
  }), /不同内容/)
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

test('successful images charge balance while failures only release the reservation', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-credits@example.com', 0, 10)
  const user = createUser(db, 'credits@example.com', 200000)
  db.adminGrantCredits(admin.id, user.id, 2, 'test grant')
  assert.equal(db.getUserById(user.id).imageCredits, 2)

  const reservation = db.reserveGeneration({ userId: user.id, idempotencyKey: 'k1', requestHash: 'h1', priceMicros: 70000 })
  assert.equal(reservation.job.charge_source, 'balance')
  assert.equal(db.getUserById(user.id).reservedCredits, 0)
  assert.equal(db.getUserById(user.id).reservedMicros, 70000)

  db.settleGeneration(reservation.job.id, settleResult)
  const afterSettle = db.getUserById(user.id)
  assert.equal(afterSettle.imageCredits, 2)
  assert.equal(afterSettle.reservedCredits, 0)
  assert.equal(afterSettle.reservedMicros, 0)
  assert.equal(afterSettle.balanceMicros, 130000)
  assert.equal(db.listLedger(user.id).filter((entry) => entry.kind === 'image_charge').length, 1)

  const failing = db.reserveGeneration({ userId: user.id, idempotencyKey: 'k2', requestHash: 'h2', priceMicros: 70000 })
  db.failGeneration(failing.job.id, 'boom')
  assert.equal(db.getUserById(user.id).imageCredits, 2)
  assert.equal(db.getUserById(user.id).reservedCredits, 0)
  assert.equal(db.getUserById(user.id).reservedMicros, 0)
  assert.equal(db.getUserById(user.id).balanceMicros, 130000)

  const consume = db.reserveGeneration({ userId: user.id, idempotencyKey: 'k3', requestHash: 'h3', priceMicros: 70000 })
  db.settleGeneration(consume.job.id, settleResult)
  assert.equal(db.getUserById(user.id).imageCredits, 2)

  assert.throws(() => db.reserveGeneration({ userId: user.id, idempotencyKey: 'k4', requestHash: 'h4', priceMicros: 70000 }), (err) => err.code === 'INSUFFICIENT_BALANCE')
  assert.equal(db.getUserById(user.id).balanceMicros, 60000)
  assert.equal(db.getUserById(user.id).reservedMicros, 0)
  assert.equal(db.getGenerationByKey(user.id, 'k4'), undefined)
  db.close()
})

test('active membership no longer bypasses image balance charges', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-member@example.com', 0, 10)
  const user = createUser(db, 'member@example.com', 100000)
  db.adminGrantMembership(admin.id, user.id, 30, 'test membership')
  assert.ok(db.getUserById(user.id).membershipExpiresAt > Date.now())

  const reservation = db.reserveGeneration({ userId: user.id, idempotencyKey: 'mk', requestHash: 'mh', priceMicros: 70000 })
  assert.equal(reservation.job.charge_source, 'balance')
  assert.equal(reservation.job.price_micros, 70000)
  db.settleGeneration(reservation.job.id, settleResult)

  const after = db.getUserById(user.id)
  assert.equal(after.balanceMicros, 30000)
  assert.equal(after.imageCredits, 0)
  assert.equal(after.requestCount, 1)
  db.close()
})

test('credit products can be sold in CNY while membership products stay disabled', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-shop@example.com', 0, 10)
  const user = createUser(db, 'buyer@example.com', 0)

  assert.throws(() => db.upsertProduct(admin.id, { id: 'pro-monthly', kind: 'membership', name: 'Pro 月卡', priceMicros: 72000000, durationDays: 30 }), /停止销售/)
  db.upsertProduct(admin.id, { id: 'pro-monthly', kind: 'membership', name: 'Pro 月卡', priceMicros: 72000000, durationDays: 30, active: false })
  assert.equal(db.getProduct('pro-monthly').active, false)
  assert.throws(() => db.upsertProduct(admin.id, { id: 'pro-monthly', kind: 'membership', name: 'Pro 月卡', priceMicros: 72000000, durationDays: 30, active: true }), /停止销售/)
  db.upsertProduct(admin.id, { id: 'credits-100', kind: 'credits', name: '100 次生成', priceMicros: 36000000, credits: 100 })
  assert.throws(() => db.upsertProduct(admin.id, { id: 'credits-100', kind: 'credits', name: '100 次生成', priceMicros: 35000000, credits: 100 }), (err) => err.code === 'PRODUCT_TERMS_IMMUTABLE')
  assert.throws(() => db.upsertProduct(admin.id, { id: 'credits-100', kind: 'credits', name: '101 次生成', priceMicros: 36000000, credits: 101 }), (err) => err.code === 'PRODUCT_TERMS_IMMUTABLE')
  assert.throws(() => db.upsertProduct(admin.id, { id: 'bad', kind: 'membership', name: 'x', priceMicros: 100, durationDays: 0 }), /有效天数/)
  assert.throws(() => db.upsertProduct(admin.id, { id: 'free', kind: 'credits', name: '免费', priceMicros: 0, credits: 1 }), (err) => err.code === 'INVALID_PRODUCT_PRICE')
  assert.deepEqual(db.listProducts({ activeOnly: true }).map((product) => product.id), ['credits-100'])

  // 即使旧库中仍残留 active 会员商品，结算意向入口也必须拒绝销售。
  db.db.prepare("UPDATE products SET active = 1 WHERE id = 'pro-monthly'").run()
  assert.throws(() => db.createCheckoutIntent({ userId: user.id, productId: 'pro-monthly' }), /停止销售/)
  assert.equal(db.getUserById(user.id).membershipExpiresAt, null)
  db.db.prepare("UPDATE products SET active = 0 WHERE id = 'pro-monthly'").run()

  const intent = db.createCheckoutIntent({ userId: user.id, productId: 'credits-100' })
  assert.match(intent.id, /^[a-f0-9]{48}$/)
  assert.equal(intent.amountMicros, 36000000)
  assert.equal(intent.credits, 100)
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'copied-link', email: user.email, amountMicros: 36000000, productId: 'credits-100', payloadHash: 'copied' }), (err) => err.code === 'CHECKOUT_INTENT_REQUIRED')
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'wrong-amount', email: user.email, amountMicros: 35999999, productId: 'credits-100', checkoutIntentId: intent.id, payloadHash: 'wrong' }), (err) => err.code === 'PAYMENT_AMOUNT_MISMATCH')
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'wrong-product', email: user.email, amountMicros: 36000000, productId: 'credits-other', checkoutIntentId: intent.id, payloadHash: 'wrong-product' }), (err) => err.code === 'PAYMENT_PRODUCT_MISMATCH')
  const other = createUser(db, 'other-buyer@example.com', 0)
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'wrong-user', userId: other.id, amountMicros: 36000000, productId: 'credits-100', checkoutIntentId: intent.id, payloadHash: 'wrong-user' }), (err) => err.code === 'PAYMENT_USER_MISMATCH')
  const expired = db.createCheckoutIntent({ userId: user.id, productId: 'credits-100' })
  db.db.prepare('UPDATE product_checkout_intents SET expires_at = ? WHERE id = ?').run(Date.now() - 1, expired.id)
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'expired', userId: user.id, amountMicros: 36000000, productId: 'credits-100', checkoutIntentId: expired.id, payloadHash: 'expired' }), (err) => err.code === 'CHECKOUT_INTENT_EXPIRED')

  db.deleteProduct(admin.id, 'credits-100')
  const delisted = db.getProduct('credits-100')
  assert.equal(delisted.active, false)
  assert.equal(delisted.priceMicros, 36000000)
  assert.equal(delisted.credits, 100)
  assert.throws(() => db.createCheckoutIntent({ userId: user.id, productId: 'credits-100' }), (err) => err.code === 'PRODUCT_INACTIVE')
  const credits = db.creditPayment({ provider: 'pay', externalId: 'order-2', email: user.email, amountMicros: 36000000, productId: 'credits-100', checkoutIntentId: intent.id, payloadHash: 'p' })
  assert.equal(credits.creditsAdded, 100)
  assert.equal(db.getUserById(user.id).imageCredits, 100)
  assert.equal(db.getCheckoutIntent(intent.id).status, 'paid')
  assert.equal(db.db.prepare("SELECT amount_micros FROM payment_events WHERE external_id = 'order-2'").get().amount_micros, 36000000)
  assert.equal(db.creditPayment({ provider: 'pay', externalId: 'order-2', email: user.email, amountMicros: 36000000, productId: 'credits-100', checkoutIntentId: intent.id, payloadHash: 'p' }).duplicate, true)
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'order-2', email: user.email, amountMicros: 36000000, productId: 'credits-100', checkoutIntentId: intent.id, payloadHash: 'changed' }), /不同内容/)
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'order-4', email: user.email, amountMicros: 36000000, productId: 'credits-100', checkoutIntentId: intent.id, payloadHash: 'new-order' }), (err) => err.code === 'CHECKOUT_INTENT_PAID')

  const balanceIntent = db.createBalanceCheckoutIntent({ userId: user.id, amountMicros: 20000000 })
  assert.match(balanceIntent.id, /^bal_[a-f0-9]{44}$/)
  assert.equal(balanceIntent.amountMicros, 20000000)
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'balance-wrong-amount', userId: user.id, amountMicros: 19990000, balanceCheckoutIntentId: balanceIntent.id, payloadHash: 'wrong' }), (err) => err.code === 'PAYMENT_AMOUNT_MISMATCH')
  assert.throws(() => db.creditPayment({ provider: 'pay', externalId: 'balance-wrong-user', userId: other.id, amountMicros: 20000000, balanceCheckoutIntentId: balanceIntent.id, payloadHash: 'wrong-user' }), (err) => err.code === 'PAYMENT_USER_MISMATCH')
  const balance = db.creditPayment({ provider: 'pay', externalId: 'balance-order', userId: user.id, amountMicros: 20000000, balanceCheckoutIntentId: balanceIntent.id, payloadHash: 'balance' })
  assert.equal(balance.balanceMicros, 20000000)
  assert.equal(db.getBalanceCheckoutIntent(balanceIntent.id).status, 'paid')
  assert.equal(db.creditPayment({ provider: 'pay', externalId: 'balance-order', userId: user.id, amountMicros: 20000000, balanceCheckoutIntentId: balanceIntent.id, payloadHash: 'balance' }).duplicate, true)

  const topup = db.creditPayment({ provider: 'pay', externalId: 'order-3', email: user.email, amountMicros: 7200000, payloadHash: 'p' })
  assert.equal(topup.balanceMicros, 27200000)

  assert.equal(db.listProducts().length, 2)
  assert.deepEqual(db.listProducts({ activeOnly: true }), [])
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
  assert.equal(new Set(codes).size, codes.length)
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
  db.upsertProduct(admin.id, { id: 'hidden', kind: 'credits', name: 'Hidden renamed', priceMicros: 5000000, credits: 100 })
  assert.equal(db.getProduct('hidden').active, false)
  assert.equal(db.listProducts({ activeOnly: true }).some((p) => p.id === 'hidden'), false)
  assert.throws(() => db.upsertProduct(admin.id, { id: 'hidden', kind: 'credits', name: 'Hidden', priceMicros: 6000000, credits: 100 }), (err) => err.code === 'PRODUCT_TERMS_IMMUTABLE')
  assert.throws(() => db.upsertProduct(admin.id, { id: 'hidden', kind: 'credits', name: 'Hidden', priceMicros: 5000000, credits: 101 }), (err) => err.code === 'PRODUCT_TERMS_IMMUTABLE')

  // no-op user PATCH must not bump auth_version or revoke sessions
  const session = db.createSession(admin.id, { ttlMs: 60000 })
  const authVersionBefore = db.getUserById(admin.id).authVersion
  db.updateUserAccess(admin.id, admin.id, { role: 10, status: 1, group: 'admin' })
  assert.equal(db.getUserById(admin.id).authVersion, authVersionBefore)
  assert.ok(db.getSession(session.token))
  db.close()
})

test('redemption codes support bounded multi-use, per-user idempotency and disable controls', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'admin-multi-redeem@example.com', 0, 10)
  const first = createUser(db, 'first-redeemer@example.com', 0)
  const second = createUser(db, 'second-redeemer@example.com', 0)
  const third = createUser(db, 'third-redeemer@example.com', 0)
  const [code] = db.createRedemptionCodes(admin.id, { credits: 5, balanceMicros: 2000000, maxRedemptions: 2, count: 1, note: 'shared' })

  assert.equal(db.redeemCode(first.id, code).granted.credits, 5)
  assert.throws(() => db.redeemCode(first.id, code), (err) => err.code === 'CODE_ALREADY_REDEEMED')
  assert.equal(db.redeemCode(second.id, code).granted.balanceMicros, 2000000)
  assert.throws(() => db.redeemCode(third.id, code), (err) => err.code === 'CODE_EXHAUSTED')
  let saved = db.listRedemptionCodes({ search: code }).at(0)
  assert.equal(saved.redemptionCount, 2)
  assert.equal(saved.maxRedemptions, 2)
  assert.equal(db.listRedemptionCodes({ status: 'exhausted' }).length, 1)

  saved = db.setRedemptionCodeEnabled(admin.id, code, false)
  assert.equal(saved.enabled, false)
  assert.equal(db.listRedemptionCodes({ status: 'disabled' }).length, 1)
  assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM redemption_records WHERE code = ?').get(code).count, 2)
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE reference LIKE ?").get(`redeem:${code}:%`).count, 4)
  db.close()
})

test('agent models are selectable only with complete pricing and conversations lock the model', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'agent-admin@example.com', 0, 10)
  const user = createUser(db, 'agent-user@example.com')

  const discovered = db.upsertDiscoveredAgentModels([
    { id: 'agent-a', label: 'Agent A' },
    { id: 'agent-b', label: 'Agent B' },
  ])
  assert.equal(discovered.length, 2)
  assert.equal(db.getAgentModel('agent-a').selectable, false)
  assert.deepEqual(db.listAgentModels({ selectableOnly: true }), [])

  db.configureAgentModel(admin.id, 'agent-a', { enabled: true, inputTokenPriceMicros: 1000000 })
  assert.equal(db.getAgentModel('agent-a').selectable, false)
  db.configureAgentModel(admin.id, 'agent-b', {
    enabled: true,
    inputTokenPriceMicros: 1000000,
    cachedInputTokenPriceMicros: 500000,
    outputTokenPriceMicros: 2000000,
    maxStepReserveMicros: 100000,
  })
  assert.equal(db.getAgentModel('agent-b').selectable, true)
  assert.equal(db.getDefaultAgentModel(), null)
  const configured = db.configureAgentModel(admin.id, 'agent-a', {
    enabled: true,
    inputTokenPriceMicros: 1000000,
    cachedInputTokenPriceMicros: 500000,
    outputTokenPriceMicros: 2000000,
    maxStepReserveMicros: 100000,
    sortOrder: 2,
    isDefault: true,
  })
  assert.deepEqual(configured, {
    ...configured,
    id: 'agent-a',
    enabled: true,
    selectable: true,
    isDefault: true,
    inputTokenPriceMicros: 1000000,
    cachedInputTokenPriceMicros: 500000,
    outputTokenPriceMicros: 2000000,
    maxStepReserveMicros: 100000,
  })
  assert.equal(db.listAgentModels({ selectableOnly: true })[0].id, 'agent-a')
  db.configureAgentModel(admin.id, 'agent-a', { isDefault: false })
  assert.equal(db.getDefaultAgentModel(), null)
  db.configureAgentModel(admin.id, 'agent-a', { isDefault: true })

  const conversation = db.lockAgentConversation({ userId: user.id, conversationId: 'conversation-1', modelId: 'agent-a' })
  assert.equal(conversation.modelId, 'agent-a')
  assert.equal(db.lockAgentConversation({ userId: user.id, conversationId: 'conversation-1', modelId: 'agent-a' }).id, conversation.id)
  assert.throws(() => db.lockAgentConversation({ userId: user.id, conversationId: 'conversation-1', modelId: 'agent-b' }), /锁定其他模型/)

  db.upsertDiscoveredAgentModels([{ id: 'agent-b', label: 'Agent B' }])
  assert.equal(db.getAgentModel('agent-a').lastSeenAt, null)
  assert.equal(db.getAgentModel('agent-a').enabled, false)
  assert.equal(db.getAgentModel('agent-a').selectable, false)
  assert.equal(db.getDefaultAgentModel(), null)
  assert.equal(db.getAgentConversation(user.id, 'conversation-1').modelId, 'agent-a')
  assert.throws(() => db.configureAgentModel(admin.id, 'agent-a', { enabled: true }), (err) => err.code === 'MODEL_NOT_DISCOVERED')
  db.close()
})

test('agent and search calls reserve, settle and aggregate idempotently by visible round', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'billing-admin@example.com', 0, 10)
  const user = createUser(db, 'billing-user@example.com')
  db.upsertDiscoveredAgentModels([{ id: 'agent-priced', label: 'Priced Agent' }])
  db.configureAgentModel(admin.id, 'agent-priced', {
    enabled: true,
    inputTokenPriceMicros: 1000000,
    cachedInputTokenPriceMicros: 500000,
    outputTokenPriceMicros: 2000000,
    maxStepReserveMicros: 100000,
    isDefault: true,
  })

  const reserved = db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    stepKey: 'step-a',
    requestHash: 'agent-hash-a',
    modelId: 'agent-priced',
    reserveMicros: 10000,
  })
  assert.equal(reserved.existing, false)
  assert.equal(reserved.call.status, 'reserved')
  assert.equal(db.getUserById(user.id).reservedMicros, 10000)
  db.markAgentCallSubmitted(reserved.call.id, 'upstream-agent-a')
  const charged = db.settleAgentCall(reserved.call.id, {
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 10,
    chargeMicros: 500,
    upstreamId: 'upstream-agent-a',
    resultStatus: 200,
    resultContentType: 'application/json',
    resultBody: '{"ok":true}',
  })
  assert.equal(charged.status, 'charged')
  assert.equal(charged.chargedMicros, 500)
  assert.equal(charged.resultStatus, 200)
  assert.equal(charged.resultContentType, 'application/json')
  assert.equal(charged.resultBody.toString(), '{"ok":true}')
  assert.equal(db.getAgentCallByStep(user.id, 'step-a').id, charged.id)
  assert.equal(db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    stepKey: 'step-a',
    requestHash: 'agent-hash-a',
    modelId: 'agent-priced',
    reserveMicros: 10000,
  }).existing, true)
  assert.throws(() => db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    stepKey: 'step-a',
    requestHash: 'different-agent-hash',
    modelId: 'agent-priced',
    reserveMicros: 10000,
  }), /不同内容/)

  const search = db.reserveSearchCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    callId: 'search-a',
    requestHash: 'search-hash-a',
    reserveMicros: 2000,
  })
  db.markSearchCallSubmitted(search.call.id, 'search-request-a')
  const chargedSearch = db.settleSearchCall(search.call.id, {
    chargeMicros: 300,
    credits: 2,
    requestId: 'search-request-a',
    resultJson: { results: ['a'] },
  })
  assert.equal(chargedSearch.status, 'charged')
  assert.equal(chargedSearch.resultJson, '{"results":["a"]}')
  assert.equal(db.reserveSearchCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    callId: 'search-a',
    requestHash: 'search-hash-a',
    reserveMicros: 2000,
  }).existing, true)
  assert.throws(() => db.reserveSearchCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    callId: 'search-a',
    requestHash: 'different-search-hash',
    reserveMicros: 2000,
  }), /不同内容/)

  const failedSearch = db.reserveSearchCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    callId: 'search-failed',
    requestHash: 'search-hash-failed',
    reserveMicros: 2000,
  })
  db.failSearchCall(failedSearch.call.id, 'search failed')
  assert.equal(db.getSearchCall(user.id, 'search-failed').status, 'failed')
  assert.equal(db.getUserById(user.id).reservedMicros, 0)

  const failed = db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-a',
    roundId: 'round-a',
    stepKey: 'step-failed',
    requestHash: 'agent-hash-failed',
    modelId: 'agent-priced',
    reserveMicros: 5000,
  })
  db.failAgentCall(failed.call.id, 'upstream failed')
  assert.equal(db.getUserById(user.id).reservedMicros, 0)

  const round = db.getBillingRound({ userId: user.id, conversationId: 'conversation-a', roundId: 'round-a' })
  const image = db.reserveGeneration({
    userId: user.id,
    idempotencyKey: 'agent-image-a',
    requestHash: 'agent-image-hash-a',
    priceMicros: 70000,
    billingRoundId: round.id,
  })
  db.settleGeneration(image.job.id, settleResult)

  const aggregated = db.getBillingRound({ userId: user.id, conversationId: 'conversation-a', roundId: 'round-a' })
  assert.deepEqual(aggregated, {
    ...aggregated,
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 10,
    searchCount: 1,
    searchCredits: 2,
    imageCount: 1,
    imageCreditsUsed: 0,
    totalMicros: 70800,
  })
  assert.equal(aggregated.agentMicros, 500)
  assert.equal(aggregated.searchMicros, 300)
  assert.equal(db.getUserById(user.id).balanceMicros, 929200)
  assert.equal(db.listLedger(user.id).filter((entry) => ['agent_charge', 'search_charge', 'image_charge'].includes(entry.kind)).length, 3)
  assert.equal(db.finishBillingRound({ userId: user.id, conversationId: 'conversation-a', roundId: 'round-a' }).status, 'completed')
  assert.equal(db.listBillingRounds(user.id)[0].id, round.id)
  db.close()
})

test('server-side Agent and search limits apply per visible round', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'limit-admin@example.com', 0, 10)
  const user = createUser(db, 'limit-user@example.com')
  db.upsertDiscoveredAgentModels(['agent-limited'])
  db.configureAgentModel(admin.id, 'agent-limited', {
    enabled: true,
    isDefault: true,
    inputTokenPriceMicros: 1,
    cachedInputTokenPriceMicros: 1,
    outputTokenPriceMicros: 1,
    maxStepReserveMicros: 1000,
  })

  const firstAgent = db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-limit',
    roundId: 'round-limit',
    stepKey: 'agent-limit-1',
    requestHash: 'agent-limit-hash-1',
    modelId: 'agent-limited',
    reserveMicros: 1000,
    maxCallsPerRound: 1,
  })
  assert.throws(() => db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-limit',
    roundId: 'round-limit',
    stepKey: 'agent-limit-2',
    requestHash: 'agent-limit-hash-2',
    modelId: 'agent-limited',
    reserveMicros: 1000,
    maxCallsPerRound: 1,
  }), (err) => err.code === 'AGENT_ROUND_LIMIT_REACHED' && err.status === 429)
  db.failAgentCall(firstAgent.call.id, 'done')

  const firstSearch = db.reserveSearchCall({
    userId: user.id,
    conversationId: 'conversation-limit',
    roundId: 'round-limit',
    callId: 'search-limit-1',
    requestHash: 'search-limit-hash-1',
    reserveMicros: 1000,
    maxCallsPerRound: 1,
  })
  assert.throws(() => db.reserveSearchCall({
    userId: user.id,
    conversationId: 'conversation-limit',
    roundId: 'round-limit',
    callId: 'search-limit-2',
    requestHash: 'search-limit-hash-2',
    reserveMicros: 1000,
    maxCallsPerRound: 1,
  }), (err) => err.code === 'SEARCH_ROUND_LIMIT_REACHED' && err.status === 429)
  db.failSearchCall(firstSearch.call.id, 'done')
  assert.equal(db.getUserById(user.id).reservedMicros, 0)
  db.close()
})

test('failed Agent attempts do not consume logical steps but retries stay bounded', () => {
  const db = new PlatformDatabase({ path: ':memory:' })
  const admin = createUser(db, 'retry-limit-admin@example.com', 0, 10)
  const user = createUser(db, 'retry-limit-user@example.com')
  db.upsertDiscoveredAgentModels(['agent-retry-limited'])
  db.configureAgentModel(admin.id, 'agent-retry-limited', {
    enabled: true,
    isDefault: true,
    inputTokenPriceMicros: 1,
    cachedInputTokenPriceMicros: 1,
    outputTokenPriceMicros: 1,
    maxStepReserveMicros: 1000,
  })

  const failed = db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-retry-steps',
    roundId: 'round-retry-steps',
    stepKey: 'agent-retry-failed-1',
    requestHash: 'agent-retry-failed-hash-1',
    modelId: 'agent-retry-limited',
    reserveMicros: 1000,
    maxCallsPerRound: 2,
  })
  db.failAgentCall(failed.call.id, 'first attempt failed')

  const charged = db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-retry-steps',
    roundId: 'round-retry-steps',
    stepKey: 'agent-retry-charged-2',
    requestHash: 'agent-retry-charged-hash-2',
    modelId: 'agent-retry-limited',
    reserveMicros: 1000,
    maxCallsPerRound: 2,
  })
  db.settleAgentCall(charged.call.id, {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    chargeMicros: 0,
  })

  const submitted = db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-retry-steps',
    roundId: 'round-retry-steps',
    stepKey: 'agent-retry-submitted-3',
    requestHash: 'agent-retry-submitted-hash-3',
    modelId: 'agent-retry-limited',
    reserveMicros: 1000,
    maxCallsPerRound: 2,
  })
  db.markAgentCallSubmitted(submitted.call.id, 'upstream-retry-3')
  assert.throws(() => db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-retry-steps',
    roundId: 'round-retry-steps',
    stepKey: 'agent-retry-rejected-4',
    requestHash: 'agent-retry-rejected-hash-4',
    modelId: 'agent-retry-limited',
    reserveMicros: 1000,
    maxCallsPerRound: 2,
  }), (err) => err.code === 'AGENT_ROUND_LIMIT_REACHED' && err.status === 429)
  db.failAgentCall(submitted.call.id, 'cleanup')

  for (let idx = 1; idx <= 4; idx += 1) {
    const attempt = db.reserveAgentCall({
      userId: user.id,
      conversationId: 'conversation-retry-attempts',
      roundId: 'round-retry-attempts',
      stepKey: `agent-total-retry-${idx}`,
      requestHash: `agent-total-retry-hash-${idx}`,
      modelId: 'agent-retry-limited',
      reserveMicros: 1000,
      maxCallsPerRound: 2,
    })
    db.failAgentCall(attempt.call.id, `failed attempt ${idx}`)
  }
  assert.throws(() => db.reserveAgentCall({
    userId: user.id,
    conversationId: 'conversation-retry-attempts',
    roundId: 'round-retry-attempts',
    stepKey: 'agent-total-retry-5',
    requestHash: 'agent-total-retry-hash-5',
    modelId: 'agent-retry-limited',
    reserveMicros: 1000,
    maxCallsPerRound: 2,
  }), (err) => err.code === 'AGENT_ROUND_RETRY_LIMIT_REACHED' && err.status === 429)
  assert.equal(db.getUserById(user.id).reservedMicros, 0)
  db.close()
})

test('legacy USD monetary data migrates to CNY exactly once and disables membership sales', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'platform-db-currency-'))
  const path = join(dir, 'currency.sqlite')
  t.after(() => rm(dir, { recursive: true, force: true }))

  let db = new PlatformDatabase({ path })
  const admin = createUser(db, 'currency-admin@example.com', 1000000, 10)
  db.applyCredits(admin.id, 7, Date.now())
  const now = Date.now()
  db.db.prepare(`
    INSERT INTO products (
      id, kind, name, description, price_micros, duration_days,
      credits, sort_order, active, created_at, updated_at
    ) VALUES ('pro-monthly', 'membership', 'Monthly', '', 10000000, 30, 0, 0, 1, ?, ?)
  `).run(now, now)
  db.upsertProduct(admin.id, { id: 'credits-100', kind: 'credits', name: '100 Credits', priceMicros: 5000000, credits: 100 })
  db.db.prepare(`
    INSERT INTO payment_events (provider, external_id, user_id, amount_micros, payload_hash, created_at)
    VALUES ('legacy', 'payment-a', ?, 2000000, 'hash', ?)
  `).run(admin.id, Date.now())
  db.createRedemptionCodes(admin.id, { balanceMicros: 1000000, count: 1 })
  db.db.prepare("DELETE FROM platform_metadata WHERE key = 'currency_migration_usd_to_cny_v1'").run()
  db.close()

  db = new PlatformDatabase({ path })
  assert.equal(db.getUserById(admin.id).balanceMicros, 7200000)
  assert.equal(db.getUserById(admin.id).imageCredits, 7)
  const signup = db.listLedger(admin.id).find((entry) => entry.kind === 'signup_credit')
  assert.equal(signup.amount_micros, 7200000)
  assert.equal(signup.balance_after_micros, 7200000)
  assert.equal(db.db.prepare("SELECT amount_micros FROM payment_events WHERE external_id = 'payment-a'").get().amount_micros, 14400000)
  assert.equal(db.getProduct('pro-monthly').priceMicros, 72000000)
  assert.equal(db.getProduct('pro-monthly').active, false)
  assert.equal(db.getProduct('credits-100').priceMicros, 36000000)
  assert.equal(db.db.prepare('SELECT balance_micros FROM redemption_codes').get().balance_micros, 7200000)
  db.close()

  db = new PlatformDatabase({ path })
  assert.equal(db.getUserById(admin.id).balanceMicros, 7200000)
  assert.equal(db.getProduct('credits-100').priceMicros, 36000000)
  db.close()
})
