import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import test from 'node:test'
import sharp from 'sharp'
import { createPlatformApp } from './index.mjs'
import { PlatformDatabase } from './platformDb.mjs'

function readCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  return values.map((value) => value.split(';')[0]).join('; ')
}

function readCookie(cookieHeader, name) {
  const match = cookieHeader.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

test('production refuses to start without an explicit HTTPS app origin', () => {
  assert.throws(() => createPlatformApp({
    env: { NODE_ENV: 'production' },
  }), /APP_ORIGIN/)
  assert.throws(() => createPlatformApp({
    env: { NODE_ENV: 'production', APP_ORIGIN: 'http://studio.test' },
  }), /HTTPS/)
})

test('self-contained platform charges image generations from CNY balance and keeps payment idempotent', async (t) => {
  const resultDir = await mkdtemp(join(tmpdir(), 'image-studio-results-'))
  const db = new PlatformDatabase({ path: ':memory:' })
  const validImage = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer()
  let upstreamMode = 'success'
  let upstreamCalls = 0
  const upstreamFetch = async () => {
    upstreamCalls += 1
    if (upstreamMode === 'failure') {
      return new Response(JSON.stringify({ error: { message: 'upstream failed' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const image = upstreamMode === 'invalid'
      ? Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('truncated')]).toString('base64')
      : validImage.toString('base64')
    return new Response(JSON.stringify({ data: [{ b64_json: image }, { b64_json: image }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const env = {
    NODE_ENV: 'test',
    PLATFORM_AUTH_SECRET: 'test-secret-with-more-than-thirty-two-characters',
    PLATFORM_ADMIN_EMAILS: 'admin@example.com',
    PLATFORM_REGISTER_ENABLED: 'true',
  }
  const app = createPlatformApp({
    env,
    db,
    fetch: upstreamFetch,
    config: {
      appOrigin: 'http://studio.test',
      cookieSecure: false,
      resultDir,
      relayBaseUrl: 'https://relay.test/v1',
      relayApiKey: 'server-only-key',
      imageUnitPriceMicros: 70000,
      signupCreditMicros: 1000000,
    },
  })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const address = app.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const originHeaders = { Origin: 'http://studio.test' }
  t.after(async () => {
    await app.close()
    await rm(resultDir, { recursive: true, force: true })
  })

  let response = await fetch(`${baseUrl}/api/platform/status`)
  assert.equal(response.status, 200)
  const status = await response.json()
  assert.equal(status.data.email_verification, true)
  assert.equal(status.data.quota_display_type, 'CNY')
  assert.equal(status.data.image_studio.relay_configured, true)

  response = await fetch(`${baseUrl}/api/platform/auth/verification`, {
    method: 'POST',
    headers: { ...originHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com' }),
  })
  assert.equal(response.status, 200)
  const verification = await response.json()
  assert.match(verification.data.dev_code, /^\d{6}$/)

  response = await fetch(`${baseUrl}/api/platform/auth/register`, {
    method: 'POST',
    headers: { ...originHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'correct horse battery staple',
      verification_code: verification.data.dev_code,
    }),
  })
  assert.equal(response.status, 201)

  response = await fetch(`${baseUrl}/api/platform/auth/login`, {
    method: 'POST',
    headers: { ...originHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'correct horse battery staple' }),
  })
  assert.equal(response.status, 200)
  const cookie = readCookies(response)
  const csrf = readCookie(cookie, 'kunai_studio_csrf')
  assert.ok(cookie.includes('kunai_studio_session='))
  assert.ok(csrf)

  response = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  const session = await response.json()
  assert.equal(session.data.role, 10)
  assert.equal(session.data.quota, 1000000)
  assert.equal(session.data.image_studio_capabilities.admin, true)

  response = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers: { ...originHeaders, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ product_id: 'credits-100' }),
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'PAYMENT_NOT_CONFIGURED')

  response = await fetch(`${baseUrl}/api/platform/admin/users/${session.data.id}/credits`, {
    method: 'POST',
    headers: { ...originHeaders, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ credits: 2, note: 'integration test' }),
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.available_credits, 2)

  const imageBody = JSON.stringify({ prompt: 'a test image', model: 'client-model', n: 9 })
  const imageHeaders = {
    ...originHeaders,
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf,
    'X-KunAI-User': String(session.data.id),
    'X-Idempotency-Key': 'generation-request-0001',
  }
  response = await fetch(`${baseUrl}/api-proxy/images/generations`, {
    method: 'POST',
    headers: {
      ...originHeaders,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      'X-KunAI-User': String(session.data.id),
    },
    body: imageBody,
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'INVALID_IDEMPOTENCY_KEY')
  assert.equal(upstreamCalls, 0)

  response = await fetch(`${baseUrl}/api-proxy/images/generations`, {
    method: 'POST',
    headers: imageHeaders,
    body: imageBody,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.length, 1)
  assert.equal(upstreamCalls, 1)

  response = await fetch(`${baseUrl}/api-proxy/images/generations`, {
    method: 'POST',
    headers: imageHeaders,
    body: imageBody,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.length, 1)
  assert.equal(upstreamCalls, 1)

  response = await fetch(`${baseUrl}/api/platform/billing`, { headers: { Cookie: cookie } })
  let billing = await response.json()
  assert.equal(billing.data.quota, 930000)
  assert.equal(billing.data.used_quota, 70000)
  assert.equal(billing.data.available_credits, 2)
  assert.equal(billing.data.entries.filter((entry) => entry.kind === 'image_charge').length, 1)

  upstreamMode = 'invalid'
  response = await fetch(`${baseUrl}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { ...imageHeaders, 'X-Idempotency-Key': 'generation-request-0002' },
    body: JSON.stringify({ prompt: 'this is invalid' }),
  })
  assert.equal(response.status, 502)
  upstreamMode = 'failure'
  response = await fetch(`${baseUrl}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { ...imageHeaders, 'X-Idempotency-Key': 'generation-request-0003' },
    body: JSON.stringify({ prompt: 'this fails' }),
  })
  assert.equal(response.status, 500)
  response = await fetch(`${baseUrl}/api/platform/billing`, { headers: { Cookie: cookie } })
  billing = await response.json()
  assert.equal(billing.data.quota, 930000)
  assert.equal(billing.data.used_quota, 70000)
  assert.equal(billing.data.available_credits, 2)

  const paymentBody = JSON.stringify({
    provider: 'internal',
    order_id: 'order-1001',
    email: 'admin@example.com',
    amount: '1.00',
    currency: 'CNY',
    status: 'paid',
  })
  app.config.paymentWebhookSecret = 'payment-test-secret'
  const signature = createHmac('sha256', app.config.paymentWebhookSecret).update(paymentBody).digest('hex')
  response = await fetch(`${baseUrl}/api/platform/payment/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Payment-Signature': signature },
    body: paymentBody,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.duplicate, false)
  response = await fetch(`${baseUrl}/api/platform/payment/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Payment-Signature': signature },
    body: paymentBody,
  })
  assert.equal((await response.json()).data.duplicate, true)

  response = await fetch(`${baseUrl}/api/platform/billing`, { headers: { Cookie: cookie } })
  billing = await response.json()
  assert.equal(billing.data.quota, 1930000)

  response = await fetch(`${baseUrl}/api/platform/auth/logout`, {
    method: 'POST',
    headers: { ...originHeaders, Cookie: cookie, 'X-CSRF-Token': csrf },
  })
  assert.equal(response.status, 200)
  response = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  assert.equal(response.status, 401)
})

async function bootAdmin(t, options = {}) {
  const resultDir = await mkdtemp(join(tmpdir(), 'image-studio-shop-'))
  const db = new PlatformDatabase({ path: ':memory:' })
  const app = createPlatformApp({
    env: {
      NODE_ENV: 'test',
      PLATFORM_AUTH_SECRET: 'test-secret-with-more-than-thirty-two-characters',
      PLATFORM_ADMIN_EMAILS: 'admin@example.com',
      PLATFORM_REGISTER_ENABLED: 'true',
    },
    db,
    fetch: options.fetch || (async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    ...(options.agentModelCatalog ? { agentModelCatalog: options.agentModelCatalog } : {}),
    ...(options.dulupay ? { dulupay: options.dulupay } : {}),
    config: {
      appOrigin: 'http://studio.test',
      cookieSecure: false,
      resultDir,
      relayBaseUrl: 'https://relay.test/v1',
      relayApiKey: 'server-only-key',
      imageUnitPriceMicros: 70000,
      signupCreditMicros: 0,
      paymentWebhookSecret: 'payment-test-secret',
      ...options.config,
    },
  })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`
  t.after(async () => {
    await app.close()
    await rm(resultDir, { recursive: true, force: true })
  })
  const originHeaders = { Origin: 'http://studio.test', 'Content-Type': 'application/json' }
  let r = await fetch(`${baseUrl}/api/platform/auth/verification`, { method: 'POST', headers: originHeaders, body: JSON.stringify({ email: 'admin@example.com' }) })
  const code = (await r.json()).data.dev_code
  await fetch(`${baseUrl}/api/platform/auth/register`, { method: 'POST', headers: originHeaders, body: JSON.stringify({ email: 'admin@example.com', password: 'correct horse battery staple', verification_code: code }) })
  r = await fetch(`${baseUrl}/api/platform/auth/login`, { method: 'POST', headers: originHeaders, body: JSON.stringify({ email: 'admin@example.com', password: 'correct horse battery staple' }) })
  const cookie = readCookies(r)
  const csrf = readCookie(cookie, 'kunai_studio_csrf')
  r = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  const adminId = (await r.json()).data.id
  return { baseUrl, cookie, csrf, adminId, app, db }
}

test('Dulupay checkout, callback and active recheck settle credit packs and CNY balance once', async (t) => {
  const orders = new Map()
  const dulupay = {
    async createOrder(options) {
      orders.set(options.outTradeNo, options)
      return { presentation: 'qrcode', qrContent: `weixin://wxpay/bizpayurl?order=${options.outTradeNo}`, payUrl: null, tradeNo: `provider-${options.outTradeNo}`, payType: options.payType }
    },
    verifyNotification(params) {
      if (params.sign !== 'valid') throw Object.assign(new Error('invalid'), { code: 'DULUPAY_SIGNATURE_INVALID' })
      return {
        paid: true,
        tradeNo: params.trade_no,
        outTradeNo: params.out_trade_no,
        amountMicros: Number(params.money) * 1000000,
        params,
      }
    },
    async queryOrder(outTradeNo) {
      const order = orders.get(outTradeNo)
      return {
        paid: true,
        tradeNo: `provider-${outTradeNo}`,
        outTradeNo,
        amountMicros: order.amountMicros,
        params: {},
      }
    },
  }
  const { baseUrl, cookie, csrf, adminId } = await bootAdmin(t, { dulupay })
  const headers = { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  let response = await fetch(`${baseUrl}/api/platform/status`)
  let payload = await response.json()
  assert.equal(payload.data.image_studio.payment_enabled, true)
  assert.equal(payload.data.image_studio.payment_provider, 'dulupay')

  response = await fetch(`${baseUrl}/api/platform/admin/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 'credits-20', kind: 'credits', name: '20 次', price: '8.00', credits: 20 }),
  })
  assert.equal(response.status, 200)
  response = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_id: 'credits-20', pay_type: 'alipay' }),
  })
  assert.equal(response.status, 201)
  const productCheckout = (await response.json()).data
  assert.equal(productCheckout.kind, 'credits')
  assert.equal(productCheckout.checkout_url, null)
  assert.equal(productCheckout.payment_display, 'qrcode')
  assert.equal(productCheckout.qr_content, `weixin://wxpay/bizpayurl?order=${productCheckout.checkout_intent_id}`)
  assert.equal(orders.get(productCheckout.checkout_intent_id).payType, 'alipay')

  const productNotify = new URLSearchParams({
    sign: 'valid',
    trade_no: `provider-${productCheckout.checkout_intent_id}`,
    out_trade_no: productCheckout.checkout_intent_id,
    money: '8.00',
  })
  response = await fetch(`${baseUrl}/api/platform/payment/dulupay/notify?${productNotify}`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'success')
  response = await fetch(`${baseUrl}/api/platform/payment/dulupay/notify?${productNotify}`)
  assert.equal(await response.text(), 'success')
  assert.equal((await (await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })).json()).data.image_credits, 20)

  response = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: '20.00', pay_type: 'wxpay' }),
  })
  assert.equal(response.status, 201)
  const balanceCheckout = (await response.json()).data
  assert.equal(balanceCheckout.kind, 'balance')
  const balanceNotify = new URLSearchParams({
    sign: 'valid',
    trade_no: `provider-${balanceCheckout.checkout_intent_id}`,
    out_trade_no: balanceCheckout.checkout_intent_id,
    money: '20.00',
  })
  assert.equal(await (await fetch(`${baseUrl}/api/platform/payment/dulupay/notify?${balanceNotify}`)).text(), 'success')
  assert.equal((await (await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })).json()).data.quota, 20000000)

  response = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: '10.00', pay_type: 'wxpay' }),
  })
  const recheckIntent = (await response.json()).data.checkout_intent_id
  response = await fetch(`${baseUrl}/api/platform/payment/recheck`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ checkout_intent_id: recheckIntent }),
  })
  payload = await response.json()
  assert.equal(payload.data.paid, true)
  assert.equal(payload.data.kind, 'balance')
  assert.equal((await (await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })).json()).data.quota, 30000000)

  response = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: '5.00', pay_type: 'wxpay' }),
  })
  const concurrentIntent = (await response.json()).data.checkout_intent_id
  const concurrentNotify = new URLSearchParams({
    sign: 'valid',
    trade_no: `provider-${concurrentIntent}`,
    out_trade_no: concurrentIntent,
    money: '5.00',
  })
  const [notifyResult, recheckResult] = await Promise.all([
    fetch(`${baseUrl}/api/platform/payment/dulupay/notify?${concurrentNotify}`),
    fetch(`${baseUrl}/api/platform/payment/recheck`, { method: 'POST', headers, body: JSON.stringify({ checkout_intent_id: concurrentIntent }) }),
  ])
  assert.equal(await notifyResult.text(), 'success')
  assert.equal((await recheckResult.json()).data.paid, true)
  assert.equal((await (await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })).json()).data.quota, 35000000)

  response = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: '7.00', pay_type: 'alipay' }),
  })
  const mismatchedIntent = (await response.json()).data.checkout_intent_id
  const mismatchedNotify = new URLSearchParams({
    sign: 'valid',
    trade_no: `provider-${mismatchedIntent}`,
    out_trade_no: mismatchedIntent,
    money: '7.01',
  })
  assert.equal(await (await fetch(`${baseUrl}/api/platform/payment/dulupay/notify?${mismatchedNotify}`)).text(), 'fail')
  assert.equal((await (await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })).json()).data.quota, 35000000)
  assert.equal(adminId, 1)
})

test('credit product terms stay immutable and paid callbacks survive product delisting', async (t) => {
  const { baseUrl, cookie, csrf, adminId } = await bootAdmin(t, {
    config: { paymentUrl: 'https://pay.test/checkout?merchant=studio' },
  })
  const jsonHeaders = { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  let r = await fetch(`${baseUrl}/api/platform/admin/products`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ id: 'pro-monthly', kind: 'membership', name: 'Pro 月卡', price: '9.99', duration_days: 30 }) })
  assert.equal(r.status, 400)
  assert.equal((await r.json()).code, 'MEMBERSHIP_SALES_DISABLED')
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ id: 'pro-monthly', kind: 'membership', name: 'Pro 月卡', price: '9.99', duration_days: 30, active: false }) })
  assert.equal(r.status, 200)
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ id: 'credits-100', kind: 'credits', name: '100 次', price: '36', credits: 100 }) })
  assert.equal(r.status, 200)
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { headers: { Cookie: cookie } })
  assert.equal((await r.json()).data.length, 2)

  r = await fetch(`${baseUrl}/api/platform/status`)
  const publicProducts = (await r.json()).data.image_studio.products
  assert.deepEqual(publicProducts.map((product) => product.id), ['credits-100'])

  r = await fetch(`${baseUrl}/api/platform/admin/products`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ id: 'credits-100', kind: 'credits', name: '100 credits', price: '35', credits: 100 }),
  })
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'PRODUCT_TERMS_IMMUTABLE')
  r = await fetch(`${baseUrl}/api/platform/admin/products`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ id: 'credits-100', kind: 'credits', name: '101 credits', price: '36', credits: 101 }),
  })
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'PRODUCT_TERMS_IMMUTABLE')

  r = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ product_id: 'credits-100' }),
  })
  assert.equal(r.status, 403)
  r = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers: { Origin: 'http://studio.test', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ product_id: 'credits-100' }),
  })
  assert.equal(r.status, 401)
  r = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers: { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: 'credits-100' }),
  })
  assert.equal(r.status, 403)
  r = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ product_id: 'credits-100' }),
  })
  assert.equal(r.status, 201)
  const checkout = (await r.json()).data
  assert.match(checkout.checkout_intent_id, /^[a-f0-9]{48}$/)
  assert.equal(checkout.amount_micros, 36000000)
  assert.equal(checkout.credits, 100)
  const checkoutUrl = new URL(checkout.checkout_url)
  assert.equal(checkoutUrl.searchParams.get('merchant'), 'studio')
  assert.equal(checkoutUrl.searchParams.get('checkout_intent_id'), checkout.checkout_intent_id)
  assert.equal(checkoutUrl.searchParams.get('product_id'), 'credits-100')
  assert.equal(checkoutUrl.searchParams.get('user_id'), String(adminId))
  assert.equal(checkoutUrl.searchParams.get('amount'), '36.00')
  assert.equal(checkoutUrl.searchParams.get('currency'), 'CNY')

  r = await fetch(`${baseUrl}/api/platform/admin/products/credits-100`, { method: 'DELETE', headers: jsonHeaders })
  assert.equal((await r.json()).data.deleted, true)
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { headers: { Cookie: cookie } })
  const adminProducts = (await r.json()).data
  assert.equal(adminProducts.length, 2)
  assert.equal(adminProducts.find((product) => product.id === 'credits-100').active, false)
  assert.equal(adminProducts.find((product) => product.id === 'credits-100').price_micros, 36000000)
  assert.equal(adminProducts.find((product) => product.id === 'credits-100').credits, 100)
  r = await fetch(`${baseUrl}/api/platform/status`)
  assert.deepEqual((await r.json()).data.image_studio.products, [])
  r = await fetch(`${baseUrl}/api/platform/payment/checkout`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ product_id: 'credits-100' }),
  })
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'PRODUCT_INACTIVE')

  const buy = (body) => {
    const raw = JSON.stringify(body)
    const sig = createHmac('sha256', 'payment-test-secret').update(raw).digest('hex')
    return fetch(`${baseUrl}/api/platform/payment/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Payment-Signature': sig }, body: raw })
  }

  r = await buy({ provider: 'pay', order_id: 'o-copied', product_id: 'credits-100', user_id: adminId, amount: '36', currency: 'CNY', status: 'paid' })
  assert.equal(r.status, 400)
  assert.equal((await r.json()).code, 'CHECKOUT_INTENT_REQUIRED')
  r = await buy({ provider: 'pay', order_id: 'o-wrong', product_id: 'credits-100', checkout_intent_id: checkout.checkout_intent_id, user_id: adminId, amount: '35.99', currency: 'CNY', status: 'paid' })
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'PAYMENT_AMOUNT_MISMATCH')

  const paidOrder = { provider: 'pay', order_id: 'o-2', product_id: 'credits-100', checkout_intent_id: checkout.checkout_intent_id, user_id: adminId, amount: '36.00', currency: 'CNY', status: 'paid' }
  r = await buy(paidOrder)
  assert.equal((await r.json()).data.creditsAdded, 100)
  r = await buy(paidOrder)
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.duplicate, true)
  r = await buy({ ...paidOrder, amount: '36' })
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'PAYMENT_IDEMPOTENCY_CONFLICT')
  r = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  let me = (await r.json()).data
  assert.equal(me.available_credits, 100)

  r = await fetch(`${baseUrl}/api/platform/admin/users/${adminId}/credits`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ credits: 5, note: 'test grant' }) })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.available_credits, 105)

  r = await fetch(`${baseUrl}/api/platform/admin/users/${adminId}/membership`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ days: 10, note: 'extend' }) })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.membership_active, true)

  // mutations require CSRF even for admins
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { method: 'POST', headers: { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x', kind: 'credits', name: 'x', price: '1', credits: 1 }) })
  assert.equal(r.status, 403)
})

test('agent model catalog supports user listing, admin refresh and priced defaults', async (t) => {
  const refreshForces = []
  const agentModelCatalog = {
    get: async ({ force }) => {
      refreshForces.push(force)
      return {
        models: ['gpt-5.2', 'gpt-5.3'],
        refreshedAt: 1700000000000,
        stale: false,
      }
    },
  }
  const { baseUrl, cookie, csrf } = await bootAdmin(t, {
    agentModelCatalog,
    config: { agentBaseUrl: 'https://agent.test/v1', agentApiKey: 'agent-test-key' },
  })
  const jsonHeaders = { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  let r = await fetch(`${baseUrl}/api/platform/admin/agent-models/refresh`, {
    method: 'POST',
    headers: jsonHeaders,
  })
  assert.equal(r.status, 200)
  const refreshed = (await r.json()).data
  assert.equal(refreshed.refreshed_at, 1700000000000)
  assert.equal(refreshed.stale, false)
  assert.deepEqual(refreshForces, [true])

  r = await fetch(`${baseUrl}/api/platform/agent-models`, { headers: { Cookie: cookie } })
  assert.equal(r.status, 200)
  let catalog = (await r.json()).data
  assert.deepEqual(catalog.models, [])
  assert.equal(catalog.default_model, null)

  r = await fetch(`${baseUrl}/api/platform/admin/agent-models`, { headers: { Cookie: cookie } })
  catalog = (await r.json()).data
  assert.deepEqual(catalog.models.map((model) => model.id), ['gpt-5.2', 'gpt-5.3'])
  assert.ok(catalog.models.every((model) => !model.selectable && model.input_price_micros === null))

  r = await fetch(`${baseUrl}/api/platform/admin/agent-models/gpt-5.3`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({
      enabled: true,
      input_price_micros: 1000000,
      cached_input_price_micros: 200000,
      output_price_micros: 4000000,
      max_step_reserve_micros: 3000000,
    }),
  })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.selectable, true)
  r = await fetch(`${baseUrl}/api/platform/agent-models`, { headers: { Cookie: cookie } })
  catalog = (await r.json()).data
  assert.deepEqual(catalog.models.map((model) => model.id), ['gpt-5.3'])
  assert.equal(catalog.default_model, null)

  r = await fetch(`${baseUrl}/api/platform/admin/agent-models/gpt-5.2`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({
      enabled: true,
      is_default: true,
      sort_order: 1,
      input_price_micros: 2000000,
      cached_input_price_micros: 400000,
      output_price_micros: 8000000,
      max_step_reserve_micros: 5000000,
    }),
  })
  assert.equal(r.status, 200)
  const configured = (await r.json()).data
  assert.equal(configured.selectable, true)
  assert.equal(configured.is_default, true)
  assert.equal(configured.output_price_micros, 8000000)

  r = await fetch(`${baseUrl}/api/platform/admin/agent-models`, { headers: { Cookie: cookie } })
  assert.equal(r.status, 200)
  catalog = (await r.json()).data
  assert.equal(catalog.default_model, 'gpt-5.2')
  assert.equal(catalog.models.find((model) => model.id === 'gpt-5.3').selectable, true)

  r = await fetch(`${baseUrl}/api/platform/agent-models`, { headers: { Cookie: cookie } })
  catalog = (await r.json()).data
  assert.equal(catalog.default_model, 'gpt-5.2')
  assert.equal(catalog.models.find((model) => model.id === 'gpt-5.2').selectable, true)
})

test('Agent relay replays settled calls before model and reserve policy checks', async (t) => {
  let agentCalls = 0
  const { baseUrl, cookie, csrf, adminId, db, app } = await bootAdmin(t, {
    config: {
      signupCreditMicros: 1000000,
      agentBaseUrl: 'https://agent.test/v1',
      agentApiKey: 'agent-server-key',
      agentRoundStepLimit: 1,
    },
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://agent.test/v1/responses')
      assert.equal(init.headers.Authorization, 'Bearer agent-server-key')
      agentCalls += 1
      return new Response(JSON.stringify({
        id: `response-${agentCalls}`,
        output: [],
        usage: { input_tokens: 4, output_tokens: 3, input_tokens_details: { cached_tokens: 0 } },
      }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  db.upsertDiscoveredAgentModels(['gpt-5.2'])
  db.configureAgentModel(adminId, 'gpt-5.2', {
    enabled: true,
    isDefault: true,
    inputTokenPriceMicros: 1000000,
    cachedInputTokenPriceMicros: 1000000,
    outputTokenPriceMicros: 1000000,
    maxStepReserveMicros: 100000,
  })
  const body = JSON.stringify({ model: 'gpt-5.2', input: 'hello', max_output_tokens: 16 })
  const headers = {
    Origin: 'http://studio.test',
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf,
    'X-KunAI-User': String(adminId),
    'X-Agent-Conversation-Id': 'conversation-0001',
    'X-Agent-Round-Id': 'round-0001',
    'X-Agent-Step-Key': 'agent-step-0001',
  }

  let r = await fetch(`${baseUrl}/api-proxy/responses`, { method: 'POST', headers, body })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).image_studio_billing.charge_micros, 7)
  assert.equal(agentCalls, 1)

  r = await fetch(`${baseUrl}/api-proxy/responses`, { method: 'POST', headers, body })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).image_studio_billing.charge_micros, 7)
  assert.equal(agentCalls, 1)

  db.configureAgentModel(adminId, 'gpt-5.2', { enabled: false })
  r = await fetch(`${baseUrl}/api-proxy/responses`, { method: 'POST', headers, body })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).image_studio_billing.charge_micros, 7)
  r = await fetch(`${baseUrl}/api-proxy/responses`, {
    method: 'POST',
    headers: { ...headers, 'X-Agent-Step-Key': 'agent-step-disabled' },
    body,
  })
  assert.equal(r.status, 400)
  assert.equal((await r.json()).code, 'AGENT_MODEL_NOT_AVAILABLE')

  db.configureAgentModel(adminId, 'gpt-5.2', { enabled: true })
  app.gateway.usageBlockedModels.add('gpt-5.2')
  r = await fetch(`${baseUrl}/api-proxy/responses`, { method: 'POST', headers, body })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).image_studio_billing.charge_micros, 7)
  r = await fetch(`${baseUrl}/api-proxy/responses`, {
    method: 'POST',
    headers: { ...headers, 'X-Agent-Step-Key': 'agent-step-usage' },
    body,
  })
  assert.equal(r.status, 503)
  assert.equal((await r.json()).code, 'AGENT_MODEL_USAGE_UNVERIFIED')

  app.gateway.usageBlockedModels.delete('gpt-5.2')
  db.configureAgentModel(adminId, 'gpt-5.2', { maxStepReserveMicros: 1 })
  r = await fetch(`${baseUrl}/api-proxy/responses`, { method: 'POST', headers, body })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).image_studio_billing.charge_micros, 7)
  r = await fetch(`${baseUrl}/api-proxy/responses`, {
    method: 'POST',
    headers: { ...headers, 'X-Agent-Step-Key': 'agent-step-reserve' },
    body,
  })
  assert.equal(r.status, 413)
  assert.equal((await r.json()).code, 'AGENT_CONTEXT_TOO_LARGE')
  assert.equal(agentCalls, 1)

  db.configureAgentModel(adminId, 'gpt-5.2', { maxStepReserveMicros: 100000 })

  r = await fetch(`${baseUrl}/api-proxy/responses`, {
    method: 'POST',
    headers: { ...headers, 'X-Agent-Step-Key': 'agent-step-0002' },
    body,
  })
  assert.equal(r.status, 429)
  assert.equal((await r.json()).code, 'AGENT_ROUND_LIMIT_REACHED')
  assert.equal(agentCalls, 1)
})

test('Tavily search BFF replays terminal results before config and limits, with split billing totals', async (t) => {
  let tavilyCalls = 0
  const { baseUrl, cookie, csrf, adminId, db, app } = await bootAdmin(t, {
    config: {
      signupCreditMicros: 1000000,
      tavilyApiKey: 'tavily-server-key',
      searchPriceMicros: 100000,
      searchRoundLimit: 1,
    },
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.tavily.com/search')
      assert.equal(init.headers.Authorization, 'Bearer tavily-server-key')
      tavilyCalls += 1
      return new Response(JSON.stringify({
        results: [{ title: 'Result', url: 'https://example.com/result', content: 'Summary', score: 0.9 }],
        request_id: 'tavily-request-1',
        usage: { credits: 1 },
      }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  db.upsertDiscoveredAgentModels(['gpt-5.2'])
  db.configureAgentModel(adminId, 'gpt-5.2', {
    enabled: true,
    isDefault: true,
    inputTokenPriceMicros: 1,
    cachedInputTokenPriceMicros: 1,
    outputTokenPriceMicros: 1,
    maxStepReserveMicros: 100000,
  })
  db.lockAgentConversation({ userId: adminId, conversationId: 'conversation-0001', modelId: 'gpt-5.2' })
  const agent = db.reserveAgentCall({
    userId: adminId,
    conversationId: 'conversation-0001',
    roundId: 'round-0001',
    stepKey: 'agent-step-0001',
    requestHash: 'agent-hash-0001',
    modelId: 'gpt-5.2',
    reserveMicros: 50000,
  })
  db.settleAgentCall(agent.call.id, {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 10,
    chargeMicros: 50000,
  })
  const jsonHeaders = { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
  const body = JSON.stringify({
    conversation_id: 'conversation-0001',
    round_id: 'round-0001',
    call_id: 'search-call-0001',
    input: { query: 'latest model news', topic: 'news', time_range: 'week' },
  })

  let r = await fetch(`${baseUrl}/api/platform/tools/search-web`, { method: 'POST', headers: jsonHeaders, body })
  const firstResponse = await r.json()
  assert.equal(r.status, 200, JSON.stringify(firstResponse))
  const first = firstResponse.data
  assert.equal(first.ok, true)
  assert.equal(first.results.length, 1)
  assert.deepEqual(first.billing, { charge_micros: 100000, currency: 'CNY' })
  assert.equal(tavilyCalls, 1)

  app.config.tavilyApiKey = ''
  app.config.searchMaxConcurrent = 0
  app.config.searchMinuteLimit = 0
  app.config.searchDailyLimit = 0
  r = await fetch(`${baseUrl}/api/platform/tools/search-web`, { method: 'POST', headers: jsonHeaders, body })
  assert.equal(r.status, 200)
  assert.deepEqual((await r.json()).data, first)
  assert.equal(tavilyCalls, 1)

  app.config.tavilyApiKey = 'tavily-server-key'
  app.config.searchMaxConcurrent = 1
  app.config.searchMinuteLimit = 100
  app.config.searchDailyLimit = 100
  r = await fetch(`${baseUrl}/api/platform/tools/search-web`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      conversation_id: 'conversation-0001',
      round_id: 'round-0001',
      call_id: 'search-call-0002',
      input: { query: 'another model query', topic: 'general', time_range: 'none' },
    }),
  })
  assert.equal(r.status, 429)
  assert.equal((await r.json()).code, 'SEARCH_ROUND_LIMIT_REACHED')
  assert.equal(tavilyCalls, 1)

  r = await fetch(`${baseUrl}/api/platform/billing`, { headers: { Cookie: cookie } })
  const billing = (await r.json()).data
  assert.equal(billing.quota, 850000)
  assert.equal(billing.used_quota, 150000)
  assert.equal(billing.entries.filter((entry) => entry.kind === 'agent_charge').length, 1)
  assert.equal(billing.entries.filter((entry) => entry.kind === 'search_charge').length, 1)
  assert.equal(billing.agent_rounds.length, 1)
  assert.equal(billing.agent_rounds[0].search_calls, 1)
  assert.equal(billing.agent_rounds[0].agent_micros, 50000)
  assert.equal(billing.agent_rounds[0].search_micros, 100000)
  assert.equal(billing.agent_rounds[0].total_micros, 150000)

  r = await fetch(`${baseUrl}/api/platform/agent-rounds/finish`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ conversation_id: 'conversation-0001', round_id: 'round-0001' }),
  })
  assert.equal(r.status, 200)
  const finished = (await r.json()).data
  assert.equal(finished.status, 'completed')
  assert.equal(finished.agent_micros, 50000)
  assert.equal(finished.search_micros, 100000)
  assert.equal(finished.total_micros, 150000)

  r = await fetch(`${baseUrl}/api/platform/agent-rounds/finish`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ conversation_id: 'conversation-0001', round_id: 'round-missing' }),
  })
  assert.equal(r.status, 404)
  assert.equal((await r.json()).code, 'ROUND_NOT_FOUND')
})

test('admins generate redemption codes and users redeem them over HTTP', async (t) => {
  const { baseUrl, cookie, csrf, adminId } = await bootAdmin(t)
  const jsonHeaders = { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  let r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ credits: 20, membership_days: 3, count: 2, note: 'launch' }) })
  assert.equal(r.status, 200)
  const codes = (await r.json()).data.codes
  assert.equal(codes.length, 2)

  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { headers: { Cookie: cookie } })
  let listed = (await r.json()).data
  assert.equal(listed.length, 2)
  assert.equal(listed[0].enabled, true)
  assert.equal(listed[0].max_redemptions, 1)

  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes/${codes[1]}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ enabled: false }) })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.enabled, false)
  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes?status=disabled`, { headers: { Cookie: cookie } })
  listed = (await r.json()).data
  assert.deepEqual(listed.map((item) => item.code), [codes[1]])

  // redeem (dash/case-insensitive)
  r = await fetch(`${baseUrl}/api/platform/redeem`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: codes[0].toLowerCase() }) })
  assert.equal(r.status, 200)
  let data = (await r.json()).data
  assert.equal(data.granted.credits, 20)
  assert.equal(data.available_credits, 20)
  assert.equal(data.membership_active, true)

  // single use
  r = await fetch(`${baseUrl}/api/platform/redeem`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: codes[0] }) })
  assert.equal(r.status, 409)

  // generating codes requires admin + CSRF
  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { method: 'POST', headers: { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ credits: 1, count: 1 }) })
  assert.equal(r.status, 403)

  const userEmail = 'ordinary-redeemer@example.com'
  r = await fetch(`${baseUrl}/api/platform/auth/verification`, { method: 'POST', headers: { Origin: 'http://studio.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail }) })
  const verificationCode = (await r.json()).data.dev_code
  await fetch(`${baseUrl}/api/platform/auth/register`, { method: 'POST', headers: { Origin: 'http://studio.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail, password: 'ordinary user password', verification_code: verificationCode }) })
  r = await fetch(`${baseUrl}/api/platform/auth/login`, { method: 'POST', headers: { Origin: 'http://studio.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail, password: 'ordinary user password' }) })
  const userCookie = readCookies(r)
  const userCsrf = readCookie(userCookie, 'kunai_studio_csrf')
  const userHeaders = { Origin: 'http://studio.test', Cookie: userCookie, 'Content-Type': 'application/json', 'X-CSRF-Token': userCsrf }
  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { method: 'POST', headers: userHeaders, body: JSON.stringify({ credits: 100, count: 1 }) })
  assert.equal(r.status, 403)
  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { headers: { Cookie: userCookie } })
  assert.equal(r.status, 403)
  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes/${codes[0]}`, { method: 'PATCH', headers: userHeaders, body: JSON.stringify({ enabled: false }) })
  assert.equal(r.status, 403)

  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ credits: 3, count: 1, max_redemptions: 1, note: 'concurrency' }) })
  const [limitedCode] = (await r.json()).data.codes
  const concurrentRedeems = await Promise.all([
    fetch(`${baseUrl}/api/platform/redeem`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: limitedCode }) }),
    fetch(`${baseUrl}/api/platform/redeem`, { method: 'POST', headers: userHeaders, body: JSON.stringify({ code: limitedCode }) }),
  ])
  assert.deepEqual(concurrentRedeems.map((response) => response.status).sort(), [200, 409])
  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes?search=${limitedCode}`, { headers: { Cookie: cookie } })
  const [limited] = (await r.json()).data
  assert.equal(limited.redemption_count, 1)
  assert.equal(limited.remaining_redemptions, 0)

  assert.ok(adminId)
})

test('QA regression: login with an unknown email never 500s (null-deref guard)', async (t) => {
  const { baseUrl } = await bootAdmin(t)
  // 'not-a-real-password' is the internal dummy-hash plaintext — it previously
  // made verifyPassword succeed for a null user and crashed on user.status.
  for (const password of ['not-a-real-password', 'anything-else']) {
    const r = await fetch(`${baseUrl}/api/platform/auth/login`, {
      method: 'POST',
      headers: { Origin: 'http://studio.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@example.com', password }),
    })
    assert.equal(r.status, 401)
    assert.equal((await r.json()).code, 'INVALID_CREDENTIALS')
  }
})
