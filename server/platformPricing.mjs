export const DEFAULT_USD_CNY_RATE = 7.2

export const DEFAULT_IMAGE_PRICES_CNY = Object.freeze({
  '1k': 0.15,
  '2k': 0.2,
  '4k': 0.5,
})

export const AGENT_MODEL_USD_PRICES = Object.freeze([
  { id: 'gpt-5.5', label: 'gpt-5.5', input: 0.25, cachedInput: 0.0625, output: 1.5 },
  { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna', input: 0.215, cachedInput: 0.035, output: 0.625 },
  { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', input: 0.315, cachedInput: 0.625, output: 1.325 },
  { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra', input: 0.25, cachedInput: 0.0625, output: 1.625 },
])

export function parseUsdCnyRate(value) {
  const rate = Number(value === undefined || value === '' ? DEFAULT_USD_CNY_RATE : value)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('USD_CNY_RATE 必须是大于 0 的数字')
  return rate
}

export function createAgentModelPriceCatalog(usdCnyRate = DEFAULT_USD_CNY_RATE) {
  const rate = parseUsdCnyRate(usdCnyRate)
  return AGENT_MODEL_USD_PRICES.map((model, sortOrder) => ({
    id: model.id,
    label: model.label,
    sortOrder,
    inputPriceMicros: Math.round(model.input * rate * 1000000),
    cachedInputPriceMicros: Math.round(model.cachedInput * rate * 1000000),
    outputPriceMicros: Math.round(model.output * rate * 1000000),
  }))
}
