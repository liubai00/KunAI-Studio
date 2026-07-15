import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PlatformGateway,
  isAllowedRelayPath,
  isSameOriginRequest,
  hashNormalizedRelayRequest,
  normalizeRelayRequest,
  parseCookies,
  selectImageModel,
} from './platformGateway.mjs'

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

test('agent relay locks the text model and rejects built-in tools', async () => {
  const normalized = await normalizeRelayRequest(
    'responses',
    'application/json',
    Buffer.from(JSON.stringify({
      model: 'other-model',
      input: 'test',
      tools: [
        { type: 'function', name: 'generate_image' },
        { type: 'function', name: 'continue_generation' },
        { type: 'web_search' },
      ],
    })),
    { agentModel: 'managed-agent' },
  )
  assert.equal(JSON.parse(normalized.body.toString()).model, 'managed-agent')

  await assert.rejects(() => normalizeRelayRequest(
    'responses',
    'application/json',
    Buffer.from(JSON.stringify({ tools: [{ type: 'image_generation' }] })),
  ), /未授权工具/)
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
