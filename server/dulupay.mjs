import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto'

function createError(message, status = 502, code = 'DULUPAY_ERROR') {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function cleanProviderMessage(value, fallback) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return text ? text.slice(0, 200) : fallback
}

function parsePrivateKey(value) {
  if (value?.type === 'private') return value
  const key = String(value || '').trim().replace(/\\n/g, '\n')
  if (!key) throw createError('Dulupay 商户私钥未配置', 503, 'DULUPAY_NOT_CONFIGURED')
  if (key.includes('-----BEGIN')) return createPrivateKey(key)
  return createPrivateKey({ key: Buffer.from(key.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'pkcs8' })
}

function parsePublicKey(value) {
  if (value?.type === 'public') return value
  const key = String(value || '').trim().replace(/\\n/g, '\n')
  if (!key) throw createError('Dulupay 平台公钥未配置', 503, 'DULUPAY_NOT_CONFIGURED')
  if (key.includes('-----BEGIN')) return createPublicKey(key)
  return createPublicKey({ key: Buffer.from(key.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' })
}

function timestampWithinSkew(value, nowMs, skewSeconds) {
  if (!/^\d{10}$/.test(String(value || ''))) return false
  return Math.abs(Math.trunc(nowMs / 1000) - Number(value)) <= skewSeconds
}

export function buildDulupaySignContent(params) {
  return Object.entries(params || {})
    .filter(([key, value]) => key && key !== 'sign' && key !== 'sign_type' && value !== null && value !== '' && value !== undefined && !Array.isArray(value) && !(value instanceof Uint8Array))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&')
}

export function signDulupayParams(params, privateKey) {
  return cryptoSign('RSA-SHA256', Buffer.from(buildDulupaySignContent(params), 'utf8'), parsePrivateKey(privateKey)).toString('base64')
}

export function verifyDulupayParams(params, signature, publicKey) {
  const value = String(signature || '').trim()
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  try {
    return cryptoVerify(
      'RSA-SHA256',
      Buffer.from(buildDulupaySignContent(params), 'utf8'),
      parsePublicKey(publicKey),
      Buffer.from(value, 'base64'),
    )
  } catch {
    return false
  }
}

export function formatDulupayMoney(amountMicros) {
  const amount = Number(amountMicros)
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 10000 !== 0) {
    throw createError('支付金额必须大于 0 且最多保留两位小数', 400, 'INVALID_AMOUNT')
  }
  return `${Math.trunc(amount / 1000000)}.${String(Math.trunc(amount / 10000) % 100).padStart(2, '0')}`
}

export function parseDulupayMoney(value) {
  const text = String(value || '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw createError('Dulupay 回调金额无效', 400, 'INVALID_AMOUNT')
  const [whole, fraction = ''] = text.split('.')
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(2, '0')) * 10000n
  if (micros <= 0n || micros > BigInt(Number.MAX_SAFE_INTEGER)) throw createError('Dulupay 回调金额无效', 400, 'INVALID_AMOUNT')
  return Number(micros)
}

export function buildDulupayReturnUrl(returnUrl, intentId) {
  const url = new URL(returnUrl)
  url.searchParams.set('payment_intent', intentId)
  return url.toString()
}

export function normalizeDulupayPaymentInfo(payType, payInfo, production = false) {
  const type = String(payType || '').trim().toLowerCase()
  const value = String(payInfo || '').trim()
  if (!value || value.length > 4096) throw createError('Dulupay 未返回有效支付信息', 502, 'DULUPAY_INVALID_PAY_INFO')
  if (['qrcode', 'scan'].includes(type)) {
    return { presentation: 'qrcode', qrContent: value, payUrl: null }
  }
  if (['jump', 'h5'].includes(type)) {
    let url
    try {
      url = new URL(value)
    } catch {
      throw createError('Dulupay 支付地址无效', 502, 'DULUPAY_INVALID_PAY_URL')
    }
    if (!['https:', ...(production ? [] : ['http:'])].includes(url.protocol)) {
      throw createError('Dulupay 支付地址协议无效', 502, 'DULUPAY_INVALID_PAY_URL')
    }
    return { presentation: 'qrcode', qrContent: url.toString(), payUrl: url.toString() }
  }
  throw createError('Dulupay 返回了不支持的支付展示类型', 502, 'DULUPAY_PAY_TYPE_UNSUPPORTED')
}

export class DulupayClient {
  constructor(options) {
    this.apiBase = String(options.apiBase || 'https://api.dulupay.com').replace(/\/+$/, '')
    this.pid = String(options.pid || '').trim()
    this.privateKey = options.privateKey
    this.platformPublicKey = options.platformPublicKey
    this.notifyUrl = String(options.notifyUrl || '').trim()
    this.returnUrl = String(options.returnUrl || '').trim()
    this.method = String(options.method || 'qrcode').trim()
    this.timeoutMs = Number(options.timeoutMs || 10000)
    this.timestampSkewSeconds = Number(options.timestampSkewSeconds || 300)
    this.production = Boolean(options.production)
    this.fetch = options.fetch || fetch
    this.now = options.now || (() => Date.now())
    this.validateConfig()
  }

  validateConfig() {
    if (!this.pid || !this.privateKey || !this.platformPublicKey || !this.notifyUrl || !this.returnUrl) {
      throw createError('Dulupay 配置不完整', 503, 'DULUPAY_NOT_CONFIGURED')
    }
    const apiUrl = new URL(this.apiBase)
    const notifyUrl = new URL(this.notifyUrl)
    const returnUrl = new URL(this.returnUrl)
    if (this.production && [apiUrl, notifyUrl, returnUrl].some((url) => url.protocol !== 'https:')) {
      throw createError('生产环境 Dulupay 地址必须使用 HTTPS', 500, 'DULUPAY_INSECURE_URL')
    }
    if (!['qrcode', 'jump'].includes(this.method)) throw createError('Dulupay 支付展示方式无效', 500, 'DULUPAY_METHOD_UNSUPPORTED')
    this.privateKey = parsePrivateKey(this.privateKey)
    this.platformPublicKey = parsePublicKey(this.platformPublicKey)
  }

  async postForm(path, params) {
    const body = {
      ...params,
      timestamp: String(Math.trunc(this.now() / 1000)),
      sign_type: 'RSA',
    }
    body.sign = signDulupayParams(body, this.privateKey)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response
    try {
      response = await this.fetch(`${this.apiBase}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams(body).toString(),
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch (err) {
      const message = err?.name === 'AbortError' ? 'Dulupay 请求超时' : 'Dulupay 连接失败'
      throw createError(message, 502, 'DULUPAY_UPSTREAM_ERROR')
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) throw createError(`Dulupay HTTP ${response.status}`, 502, 'DULUPAY_UPSTREAM_ERROR')
    const text = await response.text()
    if (text.length > 256 * 1024) throw createError('Dulupay 响应过大', 502, 'DULUPAY_INVALID_RESPONSE')
    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      throw createError('Dulupay 响应不是有效 JSON', 502, 'DULUPAY_INVALID_RESPONSE')
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError('Dulupay 响应格式无效', 502, 'DULUPAY_INVALID_RESPONSE')
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)]))
  }

  verifyResponse(params) {
    if (params.sign_type !== 'RSA' || !verifyDulupayParams(params, params.sign, this.platformPublicKey)) {
      throw createError('Dulupay 返回验签失败', 502, 'DULUPAY_SIGNATURE_INVALID')
    }
    if (!timestampWithinSkew(params.timestamp, this.now(), this.timestampSkewSeconds)) {
      throw createError('Dulupay 返回时间戳无效', 502, 'DULUPAY_TIMESTAMP_INVALID')
    }
  }

  async createOrder(options) {
    const payType = String(options.payType || 'wxpay')
    if (!['alipay', 'wxpay'].includes(payType)) throw createError('不支持的支付方式', 400, 'DULUPAY_PAY_TYPE_INVALID')
    const response = await this.postForm('/api/pay/create', {
      pid: this.pid,
      method: this.method,
      type: payType,
      out_trade_no: options.outTradeNo,
      notify_url: this.notifyUrl,
      return_url: buildDulupayReturnUrl(this.returnUrl, options.outTradeNo),
      name: String(options.name || '订单').slice(0, 40),
      money: formatDulupayMoney(options.amountMicros),
      clientip: String(options.clientIp || '127.0.0.1'),
    })
    if (response.code !== '0') throw createError(`Dulupay：${cleanProviderMessage(response.msg, '下单失败')}`, 502, 'DULUPAY_ORDER_FAILED')
    this.verifyResponse(response)
    if (!response.trade_no || response.trade_no.length > 128) throw createError('Dulupay 未返回有效平台订单号', 502, 'DULUPAY_INVALID_RESPONSE')
    const display = normalizeDulupayPaymentInfo(response.pay_type, response.pay_info, this.production)
    return { ...display, tradeNo: response.trade_no, payType, providerPayType: response.pay_type }
  }

  async queryOrder(outTradeNo) {
    const response = await this.postForm('/api/pay/query', { pid: this.pid, out_trade_no: outTradeNo })
    if (response.code !== '0') throw createError(`Dulupay：${cleanProviderMessage(response.msg, '查单失败')}`, 502, 'DULUPAY_QUERY_FAILED')
    this.verifyResponse(response)
    if (response.pid !== this.pid || response.out_trade_no !== outTradeNo) {
      throw createError('Dulupay 查单信息不匹配', 502, 'DULUPAY_QUERY_MISMATCH')
    }
    if (response.status === '1' && !response.trade_no) throw createError('Dulupay 查单结果缺少平台订单号', 502, 'DULUPAY_QUERY_MISMATCH')
    return {
      paid: response.status === '1',
      tradeNo: String(response.trade_no || '').slice(0, 128),
      outTradeNo: response.out_trade_no,
      amountMicros: parseDulupayMoney(response.money),
      payType: String(response.type || '').slice(0, 32),
      params: response,
    }
  }

  verifyNotification(params) {
    if (params.sign_type !== 'RSA' || !verifyDulupayParams(params, params.sign, this.platformPublicKey)) {
      throw createError('Dulupay 回调验签失败', 401, 'DULUPAY_SIGNATURE_INVALID')
    }
    if (params.pid !== this.pid) throw createError('Dulupay 回调商户不匹配', 401, 'DULUPAY_PID_MISMATCH')
    if (!timestampWithinSkew(params.timestamp, this.now(), this.timestampSkewSeconds)) {
      throw createError('Dulupay 回调时间戳无效', 401, 'DULUPAY_TIMESTAMP_INVALID')
    }
    if (params.trade_status !== 'TRADE_SUCCESS') throw createError('Dulupay 订单尚未支付', 400, 'DULUPAY_NOT_PAID')
    if (!params.trade_no || !params.out_trade_no) throw createError('Dulupay 回调订单号缺失', 400, 'DULUPAY_ORDER_INVALID')
    return {
      paid: true,
      tradeNo: String(params.trade_no).slice(0, 128),
      outTradeNo: String(params.out_trade_no).slice(0, 128),
      amountMicros: parseDulupayMoney(params.money),
      payType: String(params.type || '').slice(0, 32),
      params,
    }
  }
}
