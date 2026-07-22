import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_IMAGE_PRICES_CNY,
  createAgentModelPriceCatalog,
  parseUsdCnyRate,
} from './platformPricing.mjs'

test('uses the configured image prices for each resolution tier', () => {
  assert.deepEqual(DEFAULT_IMAGE_PRICES_CNY, { '1k': 0.15, '2k': 0.2, '4k': 0.5 })
})

test('converts the fixed Agent price catalog to CNY micros', () => {
  const catalog = createAgentModelPriceCatalog(7.2)
  assert.deepEqual(catalog.map((model) => model.id), [
    'gpt-5.5',
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
  ])
  assert.deepEqual(catalog.map((model) => [
    model.inputPriceMicros,
    model.outputPriceMicros,
    model.cachedInputPriceMicros,
  ]), [
    [1800000, 10800000, 450000],
    [1548000, 4500000, 252000],
    [2268000, 9540000, 4500000],
    [1800000, 11700000, 450000],
  ])
})

test('rejects invalid USD to CNY rates', () => {
  assert.equal(parseUsdCnyRate(''), 7.2)
  assert.throws(() => parseUsdCnyRate(0), /大于 0/)
})
