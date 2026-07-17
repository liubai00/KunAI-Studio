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

test('self-contained platform supports email auth, exact billing and payment idempotency', async (t) => {
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
  const csrf = readCookie(cookie, 'image_studio_csrf')
  assert.ok(cookie.includes('image_studio_session='))
  assert.ok(csrf)

  response = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  const session = await response.json()
  assert.equal(session.data.role, 10)
  assert.equal(session.data.quota, 1000000)
  assert.equal(session.data.image_studio_capabilities.admin, true)

  const imageBody = JSON.stringify({ prompt: 'a test image', model: 'client-model', n: 9 })
  const imageHeaders = {
    ...originHeaders,
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf,
    'X-Image-Studio-User': String(session.data.id),
    'X-Idempotency-Key': 'generation-request-0001',
  }
  response = await fetch(`${baseUrl}/api-proxy/images/generations`, {
    method: 'POST',
    headers: {
      ...originHeaders,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      'X-Image-Studio-User': String(session.data.id),
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

  const paymentBody = JSON.stringify({
    provider: 'internal',
    order_id: 'order-1001',
    email: 'admin@example.com',
    amount: '1.00',
    currency: 'USD',
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

async function bootAdmin(t) {
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
    fetch: async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    config: {
      appOrigin: 'http://studio.test',
      cookieSecure: false,
      resultDir,
      relayBaseUrl: 'https://relay.test/v1',
      relayApiKey: 'server-only-key',
      imageUnitPriceMicros: 70000,
      signupCreditMicros: 0,
      paymentWebhookSecret: 'payment-test-secret',
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
  const csrf = readCookie(cookie, 'image_studio_csrf')
  r = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  const adminId = (await r.json()).data.id
  return { baseUrl, cookie, csrf, adminId }
}

test('membership and credit products drive purchases and admin grants over HTTP', async (t) => {
  const { baseUrl, cookie, csrf, adminId } = await bootAdmin(t)
  const jsonHeaders = { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  let r = await fetch(`${baseUrl}/api/platform/admin/products`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ id: 'pro-monthly', kind: 'membership', name: 'Pro 月卡', price: '9.99', duration_days: 30 }) })
  assert.equal(r.status, 200)
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ id: 'credits-100', kind: 'credits', name: '100 次', price: '5', credits: 100 }) })
  assert.equal(r.status, 200)
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { headers: { Cookie: cookie } })
  assert.equal((await r.json()).data.length, 2)

  r = await fetch(`${baseUrl}/api/platform/status`)
  assert.equal((await r.json()).data.image_studio.products.length, 2)

  const buy = (body) => {
    const raw = JSON.stringify(body)
    const sig = createHmac('sha256', 'payment-test-secret').update(raw).digest('hex')
    return fetch(`${baseUrl}/api/platform/payment/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Payment-Signature': sig }, body: raw })
  }

  r = await buy({ provider: 'pay', order_id: 'o-1', product_id: 'pro-monthly', user_id: adminId, currency: 'USD', status: 'paid' })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.kind, 'membership')
  r = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  let me = (await r.json()).data
  assert.equal(me.membership_active, true)
  assert.ok(me.membership_expires_at > Date.now())

  r = await buy({ provider: 'pay', order_id: 'o-2', product_id: 'credits-100', user_id: adminId, currency: 'USD', status: 'paid' })
  assert.equal((await r.json()).data.creditsAdded, 100)
  r = await fetch(`${baseUrl}/api/platform/session`, { headers: { Cookie: cookie } })
  me = (await r.json()).data
  assert.equal(me.available_credits, 100)

  r = await fetch(`${baseUrl}/api/platform/admin/users/${adminId}/credits`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ credits: 5, note: 'test grant' }) })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.available_credits, 105)

  r = await fetch(`${baseUrl}/api/platform/admin/users/${adminId}/membership`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ days: 10, note: 'extend' }) })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).data.membership_active, true)

  r = await fetch(`${baseUrl}/api/platform/admin/products/credits-100`, { method: 'DELETE', headers: jsonHeaders })
  assert.equal((await r.json()).data.deleted, true)
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { headers: { Cookie: cookie } })
  assert.equal((await r.json()).data.length, 1)

  // mutations require CSRF even for admins
  r = await fetch(`${baseUrl}/api/platform/admin/products`, { method: 'POST', headers: { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x', kind: 'credits', name: 'x', price: '1', credits: 1 }) })
  assert.equal(r.status, 403)
})

test('admins generate redemption codes and users redeem them over HTTP', async (t) => {
  const { baseUrl, cookie, csrf, adminId } = await bootAdmin(t)
  const jsonHeaders = { Origin: 'http://studio.test', Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  let r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ credits: 20, membership_days: 3, count: 2, note: 'launch' }) })
  assert.equal(r.status, 200)
  const codes = (await r.json()).data.codes
  assert.equal(codes.length, 2)

  r = await fetch(`${baseUrl}/api/platform/admin/redemption-codes`, { headers: { Cookie: cookie } })
  assert.equal((await r.json()).data.length, 2)

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
