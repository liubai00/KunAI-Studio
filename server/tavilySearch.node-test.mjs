import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TavilySearchError,
  callTavilySearch,
  toSearchWebError,
  validateSearchWebInput,
} from './tavilySearch.mjs'

const API_KEY = 'server-secret-value'

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

test('validateSearchWebInput accepts only the strict search_web shape', () => {
  assert.deepEqual(validateSearchWebInput({ query: '  current news  ', topic: 'news', time_range: 'day' }), {
    query: 'current news',
    topic: 'news',
    time_range: 'day',
  })
  for (const topic of ['general', 'news', 'finance']) {
    assert.equal(validateSearchWebInput({ query: 'test', topic, time_range: 'none' }).topic, topic)
  }
  for (const timeRange of ['none', 'day', 'week', 'month', 'year']) {
    assert.equal(validateSearchWebInput({ query: 'test', topic: 'general', time_range: timeRange }).time_range, timeRange)
  }
})

test('validateSearchWebInput rejects missing, extra and invalid values', () => {
  const invalid = [
    null,
    [],
    { query: 'test', topic: 'general' },
    { query: 'test', topic: 'general', time_range: 'none', extra: true },
    { query: '', topic: 'general', time_range: 'none' },
    { query: 'x'.repeat(501), topic: 'general', time_range: 'none' },
    { query: 'test', topic: 'other', time_range: 'none' },
    { query: 'test', topic: 'general', time_range: 'hour' },
  ]
  for (const input of invalid) assert.throws(() => validateSearchWebInput(input), TavilySearchError)
})

test('callTavilySearch sends a fixed, bounded Tavily request', async () => {
  let request
  const result = await callTavilySearch({ query: 'latest model', topic: 'general', time_range: 'week' }, {
    apiKey: API_KEY,
    fetch: async (url, init) => {
      request = { url, init }
      return jsonResponse({ results: [] })
    },
  })

  assert.equal(request.url, 'https://api.tavily.com/search')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.redirect, 'error')
  assert.equal(request.init.headers.Authorization, `Bearer ${API_KEY}`)
  assert.equal(request.init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.init.body), {
    query: 'latest model',
    topic: 'general',
    time_range: 'week',
    search_depth: 'basic',
    max_results: 5,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    auto_parameters: false,
    include_usage: true,
  })
  assert.deepEqual(result, { ok: true, query: 'latest model', results: [] })
})

test('callTavilySearch omits none time range and compacts safe results', async () => {
  const result = await callTavilySearch({ query: 'query', topic: 'finance', time_range: 'none' }, {
    apiKey: API_KEY,
    fetch: async (_url, init) => {
      assert.equal('time_range' in JSON.parse(init.body), false)
      return jsonResponse({
        results: [
          { title: ' Result ', url: 'https://example.com/path', content: ` summary ${'x'.repeat(1300)} `, score: 0.75 },
          { title: 'unsafe', url: 'javascript:alert(1)', content: 'bad', score: 1 },
          { title: 'file', url: 'file:///etc/passwd', content: 'bad', score: 1 },
          { title: '', url: 'http://example.org', content: null, score: 'high' },
        ],
        request_id: ' request-1 ',
        usage: { credits: 1 },
      })
    },
  })

  assert.equal(result.results.length, 2)
  assert.equal(result.results[0].title, 'Result')
  assert.equal(Array.from(result.results[0].snippet).length, 1200)
  assert.equal(result.results[0].score, 0.75)
  assert.equal(result.results[1].url, 'http://example.org/')
  assert.equal(result.results[1].title, 'http://example.org/')
  assert.equal('score' in result.results[1], false)
  assert.equal(result.request_id, 'request-1')
  assert.deepEqual(result.usage, { credits: 1 })
})

test('callTavilySearch keeps the complete JSON output under 20KB', async () => {
  const result = await callTavilySearch({ query: '查找资料', topic: 'general', time_range: 'none' }, {
    apiKey: API_KEY,
    fetch: async () => jsonResponse({
      results: Array.from({ length: 5 }, (_, index) => ({
        title: `标题${'界'.repeat(298)}`,
        url: `https://example.com/${index}/${'a'.repeat(1800)}`,
        content: '内容'.repeat(1200),
        score: 0.9,
      })),
    }),
  })

  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 20 * 1024)
  assert.ok(result.results.every((item) => Array.from(item.snippet).length <= 1200))
})

test('callTavilySearch rejects oversized and invalid upstream responses', async () => {
  await assert.rejects(
    callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      apiKey: API_KEY,
      fetch: async () => new Response('{}', { status: 200, headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }),
    }),
    (err) => err.code === 'SEARCH_RESPONSE_TOO_LARGE',
  )
  await assert.rejects(
    callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      apiKey: API_KEY,
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024))
          controller.enqueue(new Uint8Array(1024 * 1024 + 1))
          controller.close()
        },
      })),
    }),
    (err) => err.code === 'SEARCH_RESPONSE_TOO_LARGE',
  )
  await assert.rejects(
    callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      apiKey: API_KEY,
      fetch: async () => new Response('not-json'),
    }),
    (err) => err.code === 'INVALID_SEARCH_RESPONSE',
  )
  await assert.rejects(
    callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      apiKey: API_KEY,
      fetch: async () => jsonResponse({ answer: 'missing results' }),
    }),
    (err) => err.code === 'INVALID_SEARCH_RESPONSE',
  )
})

test('callTavilySearch maps upstream statuses without exposing response bodies', async () => {
  const cases = [
    [400, 'SEARCH_INVALID_REQUEST', false],
    [401, 'SEARCH_AUTH_FAILED', false],
    [403, 'SEARCH_AUTH_FAILED', false],
    [429, 'SEARCH_RATE_LIMITED', true],
    [432, 'SEARCH_QUOTA_EXHAUSTED', false],
    [433, 'SEARCH_QUOTA_EXHAUSTED', false],
    [500, 'SEARCH_UPSTREAM_UNAVAILABLE', true],
    [418, 'SEARCH_UPSTREAM_FAILED', false],
  ]

  for (const [status, code, retryable] of cases) {
    try {
      await callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
        apiKey: API_KEY,
        fetch: async () => new Response(`upstream leaked ${API_KEY}`, {
          status,
          headers: status === 429 ? { 'Retry-After': '75.2' } : {},
        }),
      })
      assert.fail(`expected status ${status} to fail`)
    } catch (err) {
      const safe = toSearchWebError(err)
      assert.equal(safe.error.code, code)
      assert.equal(safe.error.retryable, retryable)
      assert.equal(JSON.stringify(safe).includes(API_KEY), false)
      if (status === 429) assert.equal(safe.error.retry_after_seconds, 76)
    }
  }
})

test('callTavilySearch enforces timeout and supports caller cancellation', async () => {
  const hangingFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
  await assert.rejects(
    callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      apiKey: API_KEY,
      fetch: hangingFetch,
      timeoutMs: 5,
    }),
    (err) => err.code === 'SEARCH_TIMEOUT' && err.retryable,
  )

  const controller = new AbortController()
  const request = callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
    apiKey: API_KEY,
    fetch: hangingFetch,
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(request, (err) => err.code === 'SEARCH_CANCELLED')

  await assert.rejects(
    callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      apiKey: API_KEY,
      fetch: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"results":['))
          init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
        },
      })),
      timeoutMs: 5,
    }),
    (err) => err.code === 'SEARCH_TIMEOUT' && err.retryable,
  )
})

test('safe error mapping hides unknown error messages and missing keys fail locally', async () => {
  assert.deepEqual(toSearchWebError(new Error(`do not leak ${API_KEY}`)), {
    ok: false,
    error: { code: 'SEARCH_FAILED', message: '搜索服务请求失败', retryable: true },
  })
  assert.equal(
    JSON.stringify(toSearchWebError(new TavilySearchError('SEARCH_AUTH_FAILED', `do not leak ${API_KEY}`))).includes(API_KEY),
    false,
  )
  try {
    await callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      apiKey: API_KEY,
      fetch: async () => { throw new Error(`network leaked ${API_KEY}`) },
    })
    assert.fail('expected network failure')
  } catch (err) {
    const safe = toSearchWebError(err)
    assert.equal(safe.error.code, 'SEARCH_UPSTREAM_UNAVAILABLE')
    assert.equal(JSON.stringify(safe).includes(API_KEY), false)
  }
  await assert.rejects(
    callTavilySearch({ query: 'test', topic: 'general', time_range: 'none' }, {
      fetch: async () => assert.fail('fetch should not run'),
    }),
    (err) => err.code === 'SEARCH_NOT_CONFIGURED',
  )
})
