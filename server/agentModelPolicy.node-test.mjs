import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_MODEL_CATALOG_MAX_BYTES,
  AgentModelCatalog,
  discoverAgentModels,
  parseAgentModelCatalog,
  selectAllowedAgentModel,
} from './agentModelPolicy.mjs'

test('discovers models with bearer authentication and stable sorting', async () => {
  const apiKey = 'catalog-test-key'
  let request
  const models = await discoverAgentModels({
    baseUrl: 'https://relay.test/v1/',
    apiKey,
    fetch: async (url, options) => {
      request = { url: url.toString(), options }
      return new Response(JSON.stringify({
        data: [
          { id: 'gpt-5.2', supported_endpoint_types: ['openai'] },
          { id: 'gpt-4.1' },
          { id: 'gpt-5.2', supported_endpoint_types: ['openai'] },
        ],
      }), { headers: { 'Content-Type': 'application/json' } })
    },
  })

  assert.deepEqual(models, ['gpt-4.1', 'gpt-5.2'])
  assert.equal(request.url, 'https://relay.test/v1/models')
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(request.options.headers.Authorization, `Bearer ${apiKey}`)
  assert.ok(request.options.signal instanceof AbortSignal)
})

test('filters invalid ids, non-gpt models and incompatible endpoint types', () => {
  const models = parseAgentModelCatalog({
    data: [
      { id: 'gpt-5.3' },
      { id: 'GPT-5.2', supported_endpoint_types: ['OPENAI', 'anthropic'] },
      { id: 'gpt-5.1', supported_endpoint_types: ['anthropic'] },
      { id: 'claude-4', supported_endpoint_types: ['openai'] },
      { id: 'gpt-image-2', supported_endpoint_types: ['openai'] },
      { id: 'gpt-4o-image-preview', supported_endpoint_types: ['openai'] },
      { id: 'gpt- bad', supported_endpoint_types: ['openai'] },
      { id: ' gpt-5.4 ', supported_endpoint_types: ['openai'] },
      { id: '', supported_endpoint_types: ['openai'] },
      { supported_endpoint_types: ['openai'] },
      { id: 'gpt-5.0', supported_endpoint_types: 'openai' },
      null,
    ],
  })

  assert.deepEqual(models, ['GPT-5.2', 'gpt-5.3'])
})

test('selects only models in the allowlist', () => {
  const allowed = ['gpt-5.1', 'gpt-5.2']
  assert.equal(selectAllowedAgentModel('', allowed, 'gpt-5.1'), 'gpt-5.1')
  assert.equal(selectAllowedAgentModel('gpt-5.2', allowed, 'gpt-5.1'), 'gpt-5.2')
  assert.throws(
    () => selectAllowedAgentModel('gpt-5.3', allowed, 'gpt-5.1'),
    (err) => err.code === 'AGENT_MODEL_NOT_ALLOWED',
  )
})

test('reports HTTP errors without leaking the API key', async () => {
  const apiKey = 'never-print-this-key'
  await assert.rejects(
    discoverAgentModels({
      baseUrl: 'https://relay.test/v1',
      apiKey,
      fetch: async () => new Response('upstream failure', { status: 503 }),
    }),
    (err) => err.code === 'MODEL_DISCOVERY_HTTP_ERROR' && !err.message.includes(apiKey),
  )
})

test('aborts model discovery on timeout without leaking the API key', async () => {
  const apiKey = 'timeout-secret-key'
  await assert.rejects(
    discoverAgentModels({
      baseUrl: 'https://relay.test/v1',
      apiKey,
      timeoutMs: 10,
      fetch: async (_url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const err = new Error('request aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      }),
    }),
    (err) => err.code === 'MODEL_DISCOVERY_TIMEOUT' && !err.message.includes(apiKey),
  )
})

test('rejects responses larger than one megabyte', async () => {
  const body = JSON.stringify({ data: [], padding: 'x'.repeat(AGENT_MODEL_CATALOG_MAX_BYTES) })
  await assert.rejects(
    discoverAgentModels({
      baseUrl: 'https://relay.test/v1',
      apiKey: 'large-response-key',
      fetch: async () => new Response(body),
    }),
    (err) => err.code === 'MODEL_CATALOG_TOO_LARGE',
  )
})

test('catalog caches for its TTL and keeps the last known good result', async () => {
  let now = 1000
  let calls = 0
  const catalog = new AgentModelCatalog({
    baseUrl: 'https://relay.test/v1',
    apiKey: 'catalog-cache-key',
    ttlMs: 100,
    now: () => now,
    fetch: async () => {
      calls += 1
      if (calls > 1) throw new Error('temporary upstream failure')
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5.2' }] }))
    },
  })

  assert.deepEqual(await catalog.get(), {
    models: ['gpt-5.2'],
    refreshedAt: 1000,
    stale: false,
  })
  now = 1050
  assert.deepEqual((await catalog.get()).models, ['gpt-5.2'])
  assert.equal(calls, 1)

  now = 1100
  const stale = await catalog.get()
  assert.deepEqual(stale.models, ['gpt-5.2'])
  assert.equal(stale.refreshedAt, 1000)
  assert.equal(stale.stale, true)
  assert.equal(stale.error, '无法获取上游模型目录')
  assert.equal(calls, 2)
})
