import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'
import sharp from 'sharp'
import {
  PlatformGateway,
  calculateAgentChargeMicros,
  calculateAgentRequestReserveMicros,
  getImagePriceMicrosForTier,
  isAllowedRelayPath,
  isSameOriginRequest,
  hashNormalizedRelayRequest,
  normalizeRelayRequest,
  normalizeSuccessfulImageResponse,
  parseAgentResponseUsage,
  parseCookies,
  selectImageModel,
} from './platformGateway.mjs'

function createImageRelayHarness(headers = {}, dbOverrides = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify({ prompt: 'agent image' }))])
  req.method = 'POST'
  req.headers = {
    origin: 'https://studio.test',
    cookie: 'image_studio_session=session-token',
    'content-type': 'application/json',
    'x-csrf-token': 'csrf-token',
    'x-idempotency-key': 'agent-image-request-001',
    'x-image-studio-user': '7',
    ...headers,
  }
  req.socket = { remoteAddress: '127.0.0.1' }

  const res = new EventEmitter()
  res.setHeader = () => {}
  res.end = () => {}
  res.destroyed = false

  const gateway = new PlatformGateway({
    baseUrl: 'https://relay.test/v1',
    expectedOrigin: 'https://studio.test',
    db: {
      verifyCsrf: () => true,
      getSession: () => ({ user: { id: 7, role: 1, status: 1, group: 'default' } }),
      getBillingRound: () => null,
      reserveGeneration: () => {
        throw new Error('unexpected reservation')
      },
      ...dbOverrides,
    },
  })
  gateway.ensureResultCapacity = async () => {}
  return () => gateway.relay(req, res, 'images/generations')
}

test('parseCookies handles encoded values and malformed input', () => {
  assert.deepEqual(parseCookies('session=abc; image_studio_uid=42; value=a%20b'), {
    session: 'abc',
    image_studio_uid: '42',
    value: 'a b',
  })
})

test('relay allowlist only accepts supported routes', () => {
  assert.equal(isAllowedRelayPath('/images/generations'), true)
  assert.equal(isAllowedRelayPath('images/edits/'), true)
  assert.equal(isAllowedRelayPath('responses'), true)
  assert.equal(isAllowedRelayPath('chat/completions'), false)
  assert.equal(isAllowedRelayPath('../api/platform/session'), false)
})

test('same-origin guard supports a fixed production origin', () => {
  assert.equal(isSameOriginRequest({ headers: { 'sec-fetch-site': 'cross-site' } }, 'https://studio.test'), false)
  assert.equal(isSameOriginRequest({ headers: { origin: 'https://studio.test' } }, 'https://studio.test'), true)
  assert.equal(isSameOriginRequest({ headers: { origin: 'https://evil.test' } }, 'https://studio.test'), false)
  assert.equal(isSameOriginRequest({ headers: {} }, 'https://studio.test'), false)
})

test('image relay locks model, output count, streaming and response format', async () => {
  const normalized = await normalizeRelayRequest(
    'images/generations',
    'application/json',
    Buffer.from(JSON.stringify({ model: 'other-model', prompt: 'test', n: 8, stream: true, partial_images: 3 })),
    { imageModel: 'managed-image' },
  )
  assert.deepEqual(JSON.parse(normalized.body.toString()), {
    model: 'managed-image',
    prompt: 'test',
    n: 1,
    stream: false,
    response_format: 'b64_json',
  })
})

test('image relay selects the managed model for each resolution tier', async () => {
  const models = {
    '1k': 'managed-image-1k',
    '2k': 'managed-image-2k',
    '4k': 'managed-image-4k',
  }
  assert.equal(selectImageModel('1024x1536', models), 'managed-image-1k')
  assert.equal(selectImageModel('1536x1025', models), 'managed-image-2k')
  assert.equal(selectImageModel('2048x2048', models), 'managed-image-2k')
  assert.equal(selectImageModel('2048x2049', models), 'managed-image-4k')
  assert.equal(selectImageModel('3840x2160', models), 'managed-image-4k')
  assert.equal(selectImageModel('auto', models), 'managed-image-1k')
  assert.throws(() => selectImageModel('1024*1024', models), /尺寸格式无效/)
  assert.throws(() => selectImageModel('3840x2161', models), /超出支持范围/)

  const normalized = await normalizeRelayRequest(
    'images/generations',
    'application/json',
    Buffer.from(JSON.stringify({ model: 'untrusted-model', prompt: 'test', size: '2560x1440' })),
    { imageModel: 'fallback-model', imageModels: models },
  )
  assert.equal(JSON.parse(normalized.body.toString()).model, 'managed-image-2k')
  assert.deepEqual(normalized.requestedImageSize, { width: 2560, height: 1440, tier: '2k' })
})

test('image billing selects the configured price for each resolution tier', () => {
  const prices = { '1k': 150000, '2k': 200000, '4k': 500000 }
  assert.equal(getImagePriceMicrosForTier('1k', prices), 150000)
  assert.equal(getImagePriceMicrosForTier('2k', prices), 200000)
  assert.equal(getImagePriceMicrosForTier('4k', prices), 500000)
  assert.equal(getImagePriceMicrosForTier('unknown', prices, 70000), 70000)
})

test('image relay rejects an upstream result materially below the requested dimensions', async () => {
  const image = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 30, g: 60, b: 90 } },
  }).png().toBuffer()
  const body = Buffer.from(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }))

  await assert.rejects(
    normalizeSuccessfulImageResponse(body, 40000000, { width: 3840, height: 2160 }),
    (err) => err.code === 'UPSTREAM_IMAGE_TIER_MISMATCH' && err.status === 502,
  )
  await assert.doesNotReject(normalizeSuccessfulImageResponse(body, 40000000, { width: 1024, height: 1024 }))

  const half4kImage = await sharp({
    create: { width: 2304, height: 1856, channels: 3, background: { r: 90, g: 60, b: 30 } },
  }).png().toBuffer()
  const half4kBody = Buffer.from(JSON.stringify({ data: [{ b64_json: half4kImage.toString('base64') }] }))
  await assert.rejects(
    normalizeSuccessfulImageResponse(half4kBody, 40000000, { width: 3840, height: 2160 }),
    (err) => err.code === 'UPSTREAM_IMAGE_TIER_MISMATCH',
  )
})

test('multipart image relay preserves files and locks billable fields', async () => {
  const source = new FormData()
  source.set('model', 'other-model')
  source.set('n', '9')
  source.set('prompt', 'edit')
  source.set('size', '3200x2400')
  source.append('image[]', new Blob(['image'], { type: 'image/png' }), 'input.png')
  const request = new Request('http://localhost', { method: 'POST', body: source })
  const normalized = await normalizeRelayRequest(
    'images/edits',
    request.headers.get('content-type'),
    Buffer.from(await request.arrayBuffer()),
    { imageModel: 'managed-image', imageModels: { '4k': 'managed-image-4k' } },
  )
  assert.equal(normalized.body.get('model'), 'managed-image-4k')
  assert.equal(normalized.body.get('n'), '1')
  assert.equal(normalized.body.get('stream'), 'false')
  assert.equal(normalized.body.get('response_format'), 'b64_json')
  assert.equal(normalized.body.getAll('image[]').length, 1)
})

test('multipart idempotency hash ignores transport boundaries', async () => {
  const build = async () => {
    const form = new FormData()
    form.set('prompt', 'same edit')
    form.append('image[]', new Blob(['same-image'], { type: 'image/png' }), 'input.png')
    const request = new Request('http://localhost', { method: 'POST', body: form })
    return normalizeRelayRequest(
      'images/edits',
      request.headers.get('content-type'),
      Buffer.from(await request.arrayBuffer()),
      { imageModel: 'managed-image' },
    )
  }
  assert.equal(
    await hashNormalizedRelayRequest('images/edits', await build()),
    await hashNormalizedRelayRequest('images/edits', await build()),
  )
})

test('agent image context is resolved and passed to generation reservation', async () => {
  const stop = new Error('stop after reservation')
  let lookup
  let reservation
  const relay = createImageRelayHarness({
    'x-agent-conversation-id': 'conversation-001',
    'x-agent-round-id': 'round-001',
  }, {
    getBillingRound: (input) => {
      lookup = input
      return { id: 37 }
    },
    reserveGeneration: (input) => {
      reservation = input
      throw stop
    },
  })

  await assert.rejects(relay(), (err) => err === stop)
  assert.deepEqual(lookup, {
    userId: 7,
    conversationId: 'conversation-001',
    roundId: 'round-001',
  })
  assert.equal(reservation.billingRoundId, 37)
})

test('image relay rejects incomplete, malformed and missing agent billing context', async () => {
  const invalid = [
    [{ 'x-agent-conversation-id': 'conversation-001' }, 'INVALID_AGENT_IMAGE_CONTEXT'],
    [{ 'x-agent-round-id': 'round-001' }, 'INVALID_AGENT_IMAGE_CONTEXT'],
    [{ 'x-agent-conversation-id': 'bad!', 'x-agent-round-id': 'round-001' }, 'INVALID_AGENT_CONVERSATION_ID'],
    [{ 'x-agent-conversation-id': 'conversation-001', 'x-agent-round-id': 'bad!' }, 'INVALID_AGENT_ROUND_ID'],
  ]
  for (const [headers, code] of invalid) {
    let reserved = false
    const relay = createImageRelayHarness(headers, {
      reserveGeneration: () => {
        reserved = true
      },
    })
    await assert.rejects(relay(), (err) => err.code === code && err.status === 400)
    assert.equal(reserved, false)
  }

  let reserved = false
  const relay = createImageRelayHarness({
    'x-agent-conversation-id': 'conversation-001',
    'x-agent-round-id': 'round-001',
  }, {
    reserveGeneration: () => {
      reserved = true
    },
  })
  await assert.rejects(relay(), (err) => err.code === 'INVALID_AGENT_IMAGE_CONTEXT' && err.status === 409)
  assert.equal(reserved, false)
})

test('agent relay preserves the requested model and locks bounded non-streaming output', async () => {
  const normalized = await normalizeRelayRequest(
    'responses',
    'application/json',
    Buffer.from(JSON.stringify({
      model: 'requested-agent',
      instructions: 'Use approved tools only.',
      input: 'test',
      stream: true,
      max_output_tokens: 100000,
      tools: [{ type: 'function', name: 'search_web' }],
    })),
    { agentModel: 'fallback-agent', agentMaxOutputTokens: 2048 },
  )
  assert.deepEqual(JSON.parse(normalized.body.toString()), {
    model: 'requested-agent',
    instructions: 'Use approved tools only.',
    input: 'test',
    stream: false,
    store: false,
    max_output_tokens: 2048,
    tools: [{ type: 'function', name: 'search_web' }],
  })

  const fallback = await normalizeRelayRequest(
    'responses',
    'application/json',
    Buffer.from(JSON.stringify({ input: 'test', max_output_tokens: 64 })),
    { agentModel: 'fallback-agent', agentMaxOutputTokens: 2048 },
  )
  assert.deepEqual(JSON.parse(fallback.body.toString()), {
    input: 'test',
    max_output_tokens: 64,
    model: 'fallback-agent',
    stream: false,
    store: false,
  })
})

test('agent relay rejects request fields outside the explicit allowlist', async () => {
  for (const field of ['store', 'metadata', 'previous_response_id', 'temperature']) {
    await assert.rejects(() => normalizeRelayRequest(
      'responses',
      'application/json',
      Buffer.from(JSON.stringify({ model: 'gpt-agent', input: 'test', [field]: field === 'store' ? false : 'value' })),
    ), (err) => err.code === 'UNAUTHORIZED_AGENT_FIELD')
  }
})

test('agent relay rejects built-in search and image generation tools', async () => {
  await assert.rejects(() => normalizeRelayRequest(
    'responses',
    'application/json',
    Buffer.from(JSON.stringify({ model: 'gpt-agent', tools: [{ type: 'web_search' }] })),
  ), (err) => err.code === 'UNAUTHORIZED_TOOL')

  await assert.rejects(() => normalizeRelayRequest(
    'responses',
    'application/json',
    Buffer.from(JSON.stringify({ model: 'gpt-agent', tools: [{ type: 'image_generation' }] })),
  ), (err) => err.code === 'UNAUTHORIZED_TOOL')
})

test('agent usage parsing requires non-negative safe integer token counts', () => {
  assert.deepEqual(parseAgentResponseUsage({
    usage: {
      input_tokens: 1500000,
      input_tokens_details: { cached_tokens: 500000 },
      output_tokens: 250000,
    },
  }), {
    inputTokens: 1500000,
    cachedInputTokens: 500000,
    outputTokens: 250000,
  })
  assert.deepEqual(parseAgentResponseUsage({
    usage: {
      input_tokens: 100,
      output_tokens: 20,
    },
  }), {
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 20,
  })

  const invalidUsage = [
    { input_tokens: -1, output_tokens: 1 },
    { input_tokens: 1, output_tokens: -1 },
    { input_tokens: 1, input_tokens_details: { cached_tokens: -1 }, output_tokens: 1 },
    { input_tokens: null, output_tokens: 1 },
    { input_tokens: 1, output_tokens: null },
    { input_tokens: 1, input_tokens_details: { cached_tokens: null }, output_tokens: 1 },
    { input_tokens: '1', output_tokens: 1 },
    { input_tokens: 1, output_tokens: '1' },
    { input_tokens: 1, input_tokens_details: { cached_tokens: '1' }, output_tokens: 1 },
    { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 1 },
    { input_tokens: 1, output_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { input_tokens: 100, input_tokens_details: { cached_tokens: 101 }, output_tokens: 1 },
  ]
  for (const usage of invalidUsage) assert.equal(parseAgentResponseUsage({ usage }), null)
  assert.equal(parseAgentResponseUsage({ usage: { input_tokens: 10 } }), null)
})

test('agent charge uses separate CNY rates for uncached input, cached input and output', () => {
  const chargeMicros = calculateAgentChargeMicros({
    inputTokenPriceMicros: 2000000,
    cachedInputTokenPriceMicros: 400000,
    outputTokenPriceMicros: 8000000,
  }, {
    inputTokens: 1500000,
    cachedInputTokens: 500000,
    outputTokens: 250000,
  })
  assert.equal(chargeMicros, 4200000)
  assert.equal(chargeMicros / 1000000, 4.2)

  assert.equal(calculateAgentChargeMicros({
    input_price_micros: 1,
    cached_input_price_micros: 1,
    output_price_micros: 1,
  }, {
    inputTokens: 2,
    cachedInputTokens: 1,
    outputTokens: 1,
  }), 3)
})

test('agent reserve is derived from request bytes and maximum output tokens', () => {
  const model = {
    inputTokenPriceMicros: 2000000,
    cachedInputTokenPriceMicros: 3000000,
    outputTokenPriceMicros: 8000000,
  }
  assert.equal(calculateAgentRequestReserveMicros(model, 1500000, 250000), 6500000)
  assert.equal(calculateAgentRequestReserveMicros({
    input_price_micros: 1,
    cached_input_price_micros: 2,
    output_price_micros: 1,
  }, 1, 1), 2)

  for (const [inputBytes, maxOutputTokens] of [
    [-1, 1],
    [1, -1],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [1, Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.throws(
      () => calculateAgentRequestReserveMicros(model, inputBytes, maxOutputTokens),
      (err) => err.code === 'INVALID_AGENT_LIMIT',
    )
  }

  assert.throws(
    () => calculateAgentRequestReserveMicros({
      inputTokenPriceMicros: Number.MAX_SAFE_INTEGER,
      cachedInputTokenPriceMicros: Number.MAX_SAFE_INTEGER,
      outputTokenPriceMicros: Number.MAX_SAFE_INTEGER,
    }, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    (err) => err.code === 'AGENT_CONTEXT_TOO_LARGE' && err.status === 413,
  )
})

test('relay authorization is based on current local role, status and group', () => {
  const gateway = new PlatformGateway({ baseUrl: 'https://relay.test/v1', generationMinRole: 1, agentMinRole: 10, allowedGroups: ['paid'] })
  assert.doesNotThrow(() => gateway.authorizeRelay({ role: 1, status: 1, group: 'paid' }, 'images/generations'))
  assert.throws(() => gateway.authorizeRelay({ role: 1, status: 1, group: 'paid' }, 'responses'), /没有使用该功能的权限/)
  assert.throws(() => gateway.authorizeRelay({ role: 10, status: 1, group: 'free' }, 'images/generations'), /没有使用该功能的权限/)
  assert.deepEqual(gateway.getCapabilities({ role: 10, status: 1, group: 'paid' }), {
    generation: true,
    agent: true,
    admin: true,
  })
})

test('relay requests are serialized for the same user', async () => {
  const gateway = new PlatformGateway()
  const firstRelease = await gateway.acquireRelay(7)
  let secondAcquired = false
  const second = gateway.acquireRelay(7).then((release) => {
    secondAcquired = true
    return release
  })

  await Promise.resolve()
  assert.equal(secondAcquired, false)
  firstRelease()
  const secondRelease = await second
  assert.equal(secondAcquired, true)
  secondRelease()
  assert.equal(gateway.activeRelays, 0)
})
