import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { callAgentConversationTitleApi, callAgentResponsesApi, callPlatformSearchWeb, finishPlatformAgentRound, isPlatformAgentCallFailedError, isPlatformUserContextChangedError } from './agentApi'
import { PLATFORM_AGENT_PROFILE_ID } from './platformMode'

function createResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createPlatformProfile() {
  return {
    ...createDefaultOpenAIProfile({ apiKey: 'managed-session', apiMode: 'responses' }),
    id: PLATFORM_AGENT_PROFILE_ID,
  }
}

describe('platform Agent API requests', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses strict search_web and context headers for the platform profile', async () => {
    const billing = { model: 'agent-model', charge_micros: 12 }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse({
      id: 'response-1',
      output: [],
      image_studio_billing: billing,
    }))

    const result = await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile: createPlatformProfile(),
      params: DEFAULT_PARAMS,
      input: [],
      context: { conversationId: 'conversation-1', roundId: 'round-1', stepKey: 'step-1' },
    })
    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    const body = JSON.parse(String(init?.body))
    const tool = body.tools.find((item: Record<string, unknown>) => item.name === 'search_web')

    expect(body.tools).not.toContainEqual({ type: 'web_search' })
    expect(tool).toMatchObject({
      type: 'function',
      strict: true,
      parameters: {
        required: ['query', 'topic', 'time_range'],
        additionalProperties: false,
      },
    })
    expect(tool.parameters.properties.topic.enum).toEqual(['general', 'news', 'finance'])
    expect(tool.parameters.properties.time_range.enum).toEqual(['none', 'day', 'week', 'month', 'year'])
    expect(tool.description).toContain('untrusted')
    expect(tool.description).toContain('Markdown links')
    expect(headers['X-Agent-Conversation-Id']).toBe('conversation-1')
    expect(headers['X-Agent-Round-Id']).toBe('round-1')
    expect(headers['X-Agent-Step-Key']).toBe('step-1')
    expect(result.imageStudioBilling).toEqual(billing)
  })

  it('retries an ambiguous platform transport failure with the same step key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(createResponse({ id: 'response-replayed', output: [] }))

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: createPlatformProfile(),
      params: DEFAULT_PARAMS,
      input: [],
      context: { conversationId: 'conversation-1', roundId: 'round-1', stepKey: 'stable-step-1' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      expect((call[1]?.headers as Record<string, string>)['X-Agent-Step-Key']).toBe('stable-step-1')
      expect(call[1]?.body).toBe(fetchMock.mock.calls[0][1]?.body)
    }
  })

  it('keeps the exact idempotency context while polling ambiguous Agent responses', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(createResponse({ id: 'response-replayed', output: [] }))

    const pending = callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: createPlatformProfile(),
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: 'retry me' }],
      context: { conversationId: 'conversation-1', roundId: 'round-1', stepKey: 'stable-step-2' },
    })
    await vi.advanceTimersByTimeAsync(3000)
    const result = await pending

    expect(result.responseId).toBe('response-replayed')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const firstBody = fetchMock.mock.calls[0][1]?.body
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>
      expect(headers['X-Agent-Conversation-Id']).toBe('conversation-1')
      expect(headers['X-Agent-Round-Id']).toBe('round-1')
      expect(headers['X-Agent-Step-Key']).toBe('stable-step-2')
      expect(call[1]?.body).toBe(firstBody)
    }
  })

  it('recognizes the backend top-level AGENT_CALL_FAILED error shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: 'Agent upstream call failed',
      code: 'AGENT_CALL_FAILED',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }))

    const err = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: createPlatformProfile(),
      params: DEFAULT_PARAMS,
      input: [],
      context: { conversationId: 'conversation-1', roundId: 'round-1', stepKey: 'step-failed' },
    }).catch((value: unknown) => value)

    expect(isPlatformAgentCallFailedError(err)).toBe(true)
    expect(err).toMatchObject({
      name: 'PlatformAgentHttpError',
      status: 502,
      code: 'AGENT_CALL_FAILED',
      message: 'Agent upstream call failed',
    })
  })

  it('keeps structured account context errors free of unrelated streaming hints', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: '账户已在其他页面切换，请刷新后重试',
      code: 'USER_CONTEXT_CHANGED',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }))

    const err = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: { ...createPlatformProfile(), streamImages: true },
      params: DEFAULT_PARAMS,
      input: [],
      context: { conversationId: 'conversation-1', roundId: 'round-1', stepKey: 'step-context' },
    }).catch((value: unknown) => value)

    expect(isPlatformUserContextChangedError(err)).toBe(true)
    expect(err).toMatchObject({
      status: 409,
      code: 'USER_CONTEXT_CHANGED',
      message: '账户已在其他页面切换，请刷新后重试',
    })
    expect(String((err as Error).message)).not.toContain('流式传输')
  })

  it('retries an ambiguous round finish with the same idempotency context', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    const pending = finishPlatformAgentRound('conversation-finish', 'round-finish')
    await vi.advanceTimersByTimeAsync(500)
    await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/platform/agent-rounds/finish',
      '/api/platform/agent-rounds/finish',
    ])
    const firstInit = fetchMock.mock.calls[0][1]
    const secondInit = fetchMock.mock.calls[1][1]
    expect(firstInit?.body).toBe(JSON.stringify({
      conversation_id: 'conversation-finish',
      round_id: 'round-finish',
    }))
    expect(secondInit?.body).toBe(firstInit?.body)
    expect(secondInit?.headers).toEqual(firstInit?.headers)
    expect(firstInit).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store' })
  })

  it('keeps built-in web_search and omits platform context headers for non-platform profiles', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse({ output: [] }))
    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' }),
      params: DEFAULT_PARAMS,
      input: [],
      context: { conversationId: 'conversation-1', roundId: 'round-1', stepKey: 'step-1' },
    })
    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    const body = JSON.parse(String(init?.body))

    expect(body.tools).toContainEqual({ type: 'web_search' })
    expect(body.tools.some((item: Record<string, unknown>) => item.name === 'search_web')).toBe(false)
    expect(headers['X-Agent-Conversation-Id']).toBeUndefined()
    expect(headers['X-Agent-Round-Id']).toBeUndefined()
    expect(headers['X-Agent-Step-Key']).toBeUndefined()
  })

  it('adds context headers to platform title requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '<title>测试标题</title>' }] }],
    }))
    await callAgentConversationTitleApi({
      settings: DEFAULT_SETTINGS,
      profile: createPlatformProfile(),
      prompt: '测试',
      context: { conversationId: 'conversation-2', roundId: 'round-2', stepKey: 'title' },
    })
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['X-Agent-Conversation-Id']).toBe('conversation-2')
    expect(headers['X-Agent-Round-Id']).toBe('round-2')
    expect(headers['X-Agent-Step-Key']).toBe('title')
  })
})

describe('callPlatformSearchWeb', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('posts the tool context and safely parses the platform envelope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse({
      success: true,
      data: {
        ok: true,
        query: 'latest news',
        results: [{ title: 'Source', url: 'https://example.com/news', snippet: 'Summary', score: 0.9 }],
        request_id: 'request-1',
        usage: { credits: 1 },
        billing: { charge_micros: 100, currency: 'CNY' },
      },
    }))
    const controller = new AbortController()
    const result = await callPlatformSearchWeb({
      conversationId: 'conversation-1',
      roundId: 'round-1',
      callId: 'call-1',
      input: { query: 'latest news', topic: 'news', time_range: 'day' },
      signal: controller.signal,
    })
    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('/api/platform/tools/search-web')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal })
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({
      conversation_id: 'conversation-1',
      round_id: 'round-1',
      call_id: 'call-1',
      input: { query: 'latest news', topic: 'news', time_range: 'day' },
    })
    expect(result.results[0].url).toBe('https://example.com/news')
    expect(result.usage).toEqual({ credits: 1 })
    expect(result.billing).toEqual({ charge_micros: 100, currency: 'CNY' })
  })

  it('replays a search with the same call id after an ambiguous network failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(createResponse({
        success: true,
        data: {
          ok: true,
          query: 'replayed',
          results: [{ title: 'Source', url: 'https://example.com', snippet: 'Recovered' }],
          billing: { charge_micros: 100000, currency: 'CNY' },
        },
      }))

    await callPlatformSearchWeb({
      conversationId: 'conversation-1',
      roundId: 'round-1',
      callId: 'stable-search-call',
      input: { query: 'replayed', topic: 'general', time_range: 'none' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).call_id)).toEqual([
      'stable-search-call',
      'stable-search-call',
    ])
  })

  it('keeps the exact search call id while polling ambiguous results', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(createResponse({
        success: true,
        data: {
          ok: true,
          query: 'replayed',
          results: [{ title: 'Source', url: 'https://example.com', snippet: 'Recovered' }],
          billing: { charge_micros: 100000, currency: 'CNY' },
        },
      }))

    const pending = callPlatformSearchWeb({
      conversationId: 'conversation-1',
      roundId: 'round-1',
      callId: 'stable-search-call-2',
      input: { query: 'replayed', topic: 'general', time_range: 'none' },
    })
    await vi.advanceTimersByTimeAsync(2000)
    const result = await pending

    expect(result.query).toBe('replayed')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const bodies = fetchMock.mock.calls.map((call) => String(call[1]?.body))
    expect(new Set(bodies)).toEqual(new Set([bodies[0]]))
    expect(JSON.parse(bodies[0]).call_id).toBe('stable-search-call-2')
  })

  it('returns readable errors for platform failures and rejects malformed data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      message: '搜索额度不足',
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }))
    await expect(callPlatformSearchWeb({
      conversationId: 'conversation-1',
      roundId: 'round-1',
      callId: 'call-1',
      input: { query: 'test', topic: 'general', time_range: 'none' },
    })).rejects.toThrow('搜索额度不足')

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse({
      success: true,
      data: { ok: false, error: { code: 'SEARCH_RATE_LIMITED', message: '搜索过于频繁', retryable: true } },
    }))
    await expect(callPlatformSearchWeb({
      conversationId: 'conversation-1',
      roundId: 'round-1',
      callId: 'call-2',
      input: { query: 'test', topic: 'general', time_range: 'none' },
    })).rejects.toThrow('搜索过于频繁')

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse({
      success: true,
      data: { ok: true, query: 'test', results: [{ title: 'bad', url: 'javascript:alert(1)', snippet: '' }] },
    }))
    await expect(callPlatformSearchWeb({
      conversationId: 'conversation-1',
      roundId: 'round-1',
      callId: 'call-3',
      input: { query: 'test', topic: 'general', time_range: 'none' },
    })).rejects.toThrow('网络搜索服务返回了无效数据')
  })
})
