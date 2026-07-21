import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import {
  buildDulupayReturnUrl,
  buildDulupaySignContent,
  DulupayClient,
  formatDulupayMoney,
  normalizeDulupayPaymentInfo,
  parseDulupayMoney,
  signDulupayParams,
  verifyDulupayParams,
} from './dulupay.mjs'

function createKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

test('Dulupay RSA content follows ASCII ordering and excludes signature fields', () => {
  const keys = createKeyPair()
  const params = { z: 'last', empty: '', sign: 'ignored', sign_type: 'RSA', a: 'first', amount: '1.00' }
  assert.equal(buildDulupaySignContent(params), 'a=first&amount=1.00&z=last')
  const signature = signDulupayParams(params, keys.privateKey)
  assert.equal(verifyDulupayParams(params, signature, keys.publicKey), true)
  assert.equal(verifyDulupayParams({ ...params, amount: '2.00' }, signature, keys.publicKey), false)
  assert.equal(formatDulupayMoney(36000000), '36.00')
  assert.equal(parseDulupayMoney('36.00'), 36000000)
  assert.throws(() => formatDulupayMoney(10001), (err) => err.code === 'INVALID_AMOUNT')
  assert.equal(buildDulupayReturnUrl('https://studio.test/?from=pay', 'intent-123'), 'https://studio.test/?from=pay&payment_intent=intent-123')
  assert.deepEqual(normalizeDulupayPaymentInfo('qrcode', 'weixin://wxpay/bizpayurl?pr=test', true), {
    presentation: 'qrcode',
    qrContent: 'weixin://wxpay/bizpayurl?pr=test',
    payUrl: null,
  })
  assert.deepEqual(normalizeDulupayPaymentInfo('jump', 'https://cashier.test/order/1', true), {
    presentation: 'qrcode',
    qrContent: 'https://cashier.test/order/1',
    payUrl: 'https://cashier.test/order/1',
  })
  assert.throws(() => normalizeDulupayPaymentInfo('jump', 'javascript:alert(1)', true), (err) => err.code === 'DULUPAY_INVALID_PAY_URL')
})

test('Dulupay client signs create/query requests and verifies provider responses and callbacks', async () => {
  const merchant = createKeyPair()
  const platform = createKeyPair()
  const now = 1721206072000
  const fetcher = async (url, init) => {
    const params = Object.fromEntries(new URLSearchParams(init.body))
    assert.equal(params.pid, '1001')
    assert.equal(params.timestamp, '1721206072')
    assert.equal(params.sign_type, 'RSA')
    assert.equal(verifyDulupayParams(params, params.sign, merchant.publicKey), true)
    if (String(url).endsWith('/api/pay/query')) {
      const response = {
        code: '0',
        pid: '1001',
        trade_no: 'DULU-2001',
        out_trade_no: params.out_trade_no,
        status: '1',
        money: '20.00',
        timestamp: '1721206072',
        sign_type: 'RSA',
      }
      response.sign = signDulupayParams(response, platform.privateKey)
      return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    assert.equal(params.method, 'qrcode')
    assert.equal(params.type, 'alipay')
    assert.equal(params.money, '20.00')
    assert.equal(new URL(params.return_url).searchParams.get('payment_intent'), params.out_trade_no)
    const response = {
      code: '0',
      trade_no: 'DULU-2001',
      pay_type: 'qrcode',
      pay_info: 'alipays://platformapi/startapp?appId=20000067&url=test',
      timestamp: '1721206072',
      sign_type: 'RSA',
    }
    response.sign = signDulupayParams(response, platform.privateKey)
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const client = new DulupayClient({
    apiBase: 'https://api.dulupay.com',
    pid: '1001',
    privateKey: merchant.privateKey,
    platformPublicKey: platform.publicKey,
    notifyUrl: 'https://studio.test/api/platform/payment/dulupay/notify',
    returnUrl: 'https://studio.test/',
    method: 'qrcode',
    production: true,
    now: () => now,
    fetch: fetcher,
  })

  const order = await client.createOrder({ outTradeNo: 'bal_1234567890123456', amountMicros: 20000000, name: '余额充值', payType: 'alipay', clientIp: '203.0.113.1' })
  assert.equal(order.payUrl, null)
  assert.equal(order.qrContent, 'alipays://platformapi/startapp?appId=20000067&url=test')
  assert.equal(order.presentation, 'qrcode')
  const query = await client.queryOrder('bal_1234567890123456')
  assert.equal(query.paid, true)
  assert.equal(query.amountMicros, 20000000)

  const callback = {
    pid: '1001',
    trade_no: 'DULU-2001',
    out_trade_no: 'bal_1234567890123456',
    trade_status: 'TRADE_SUCCESS',
    money: '20.00',
    timestamp: '1721206072',
    sign_type: 'RSA',
  }
  callback.sign = signDulupayParams(callback, platform.privateKey)
  assert.equal(client.verifyNotification(callback).paid, true)
  assert.throws(() => client.verifyNotification({ ...callback, money: '21.00' }), (err) => err.code === 'DULUPAY_SIGNATURE_INVALID')
})
