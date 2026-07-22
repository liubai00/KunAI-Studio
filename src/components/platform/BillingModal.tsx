import { Bot, Image, LoaderCircle, ScanLine, Ticket, Wallet, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPlatformBalanceCheckout } from '../../lib/platformCheckout'
import type { PlatformPaymentType, PlatformProductCheckout } from '../../lib/platformCheckout'
import { getComposerEnterAction } from '../../lib/composerKeyboard'
import { formatPlatformLedgerAmount, formatPlatformPrice, formatPlatformQuota } from '../../lib/platformCurrency'
import { getDefaultPaymentType, getRechargeValidationError, isValidRechargeAmount } from '../../lib/platformRecharge'
import { usePlatformStore } from '../../platformStore'
import type { PlatformBilling } from '../../platformStore'
import PaymentQrModal from './PaymentQrModal'

interface BillingModalProps {
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  embedded?: boolean
}

const IMAGE_PRICE_TIERS = [
  { key: '1k' as const, label: '1K' },
  { key: '2k' as const, label: '2K' },
  { key: '4k' as const, label: '4K' },
]

export default function BillingModal(props: BillingModalProps) {
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const loadBilling = usePlatformStore((s) => s.loadBilling)
  const redeemCode = usePlatformStore((s) => s.redeemCode)
  const paymentEnabled = Boolean(status?.image_studio?.payment_enabled ?? status?.image_studio?.payment_url)
  const paymentProvider = status?.image_studio?.payment_provider
  const dialogRef = useRef<HTMLElement>(null)
  const [billing, setBilling] = useState<PlatformBilling | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [activeCheckout, setActiveCheckout] = useState<PlatformProductCheckout | null>(null)
  const [payType, setPayType] = useState<PlatformPaymentType | null>(() => getDefaultPaymentType(status?.image_studio?.payment_types ?? []))
  const [rechargeAmount, setRechargeAmount] = useState('20')
  const [recharging, setRecharging] = useState(false)
  const [redeemInput, setRedeemInput] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const paymentTypes = billing?.payment_types ?? status?.image_studio?.payment_types ?? []

  useEffect(() => {
    setPayType((current) => current && paymentTypes.includes(current) ? current : getDefaultPaymentType(paymentTypes))
  }, [paymentTypes])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    if (!props.embedded) {
      document.body.style.overflow = 'hidden'
      dialogRef.current?.focus()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (props.embedded) return
      if (event.key === 'Escape') {
        props.onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const focusOutside = !dialogRef.current.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current || focusOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    void refreshSession().catch(() => undefined)
    void loadBilling().then(setBilling).catch((err) => setBillingError(err instanceof Error ? err.message : String(err)))
    return () => {
      if (!props.embedded) document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef?.current?.focus()
    }
  }, [loadBilling, props.embedded, props.onClose, props.returnFocusRef, refreshSession])

  if (!user) return null

  const account = billing || user
  const rechargeMin = billing?.recharge_min ?? status?.image_studio?.recharge_min ?? 1
  const rechargeMax = billing?.recharge_max ?? status?.image_studio?.recharge_max ?? 5000
  const rechargeValid = isValidRechargeAmount(rechargeAmount, rechargeMin, rechargeMax)
  const requiresPaymentType = paymentProvider === 'dulupay'
  const rechargeError = getRechargeValidationError({
    paymentEnabled,
    amount: rechargeAmount,
    min: rechargeMin,
    max: rechargeMax,
    requiresPaymentType,
    payType,
  })
  const rechargeReady = rechargeError === null
  const imagePrices = billing?.image_prices ?? status?.image_studio?.image_prices ?? {
    '1k': billing?.image_unit_price ?? status?.image_studio?.image_unit_price ?? 0,
    '2k': billing?.image_unit_price ?? status?.image_studio?.image_unit_price ?? 0,
    '4k': billing?.image_unit_price ?? status?.image_studio?.image_unit_price ?? 0,
  }
  const agentModelPrices = billing?.agent_model_prices ?? status?.image_studio?.agent_model_prices ?? []

  const handleRecharge = async (selectedPayType = payType) => {
    const validationError = getRechargeValidationError({
      paymentEnabled,
      amount: rechargeAmount,
      min: rechargeMin,
      max: rechargeMax,
      requiresPaymentType,
      payType: selectedPayType,
    })
    if (validationError) {
      setCheckoutError(validationError)
      return
    }
    if (recharging) return
    setRecharging(true)
    setCheckoutError(null)
    setActiveCheckout(null)
    try {
      const checkout = await createPlatformBalanceCheckout(rechargeAmount.trim(), selectedPayType || 'wxpay')
      if (checkout.payment_display === 'redirect' && checkout.checkout_url) {
        window.location.assign(checkout.checkout_url)
        return
      }
      setActiveCheckout(checkout)
      setRecharging(false)
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err))
      setRecharging(false)
    }
  }

  const handleRedeem = async () => {
    const code = redeemInput.trim()
    if (!code || redeeming) return
    setRedeeming(true)
    setRedeemMsg(null)
    try {
      const result = await redeemCode(code)
      const granted = result.granted || {}
      const parts: string[] = []
      if (granted.balanceMicros) parts.push(formatPlatformQuota(granted.balanceMicros, status))
      setRedeemMsg({ ok: true, text: `兑换成功：${parts.join(' + ') || '已到账'}` })
      setRedeemInput('')
      await refreshSession().catch(() => undefined)
      await loadBilling().then(setBilling).catch(() => undefined)
    } catch (err) {
      setRedeemMsg({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setRedeeming(false)
    }
  }

  const handlePaymentPaid = async () => {
    await refreshSession().catch(() => undefined)
    await loadBilling().then(setBilling).catch(() => undefined)
  }

  const closePayment = () => {
    setActiveCheckout(null)
    setRecharging(false)
  }

  return (
    <div className={props.embedded ? 'kunai-embedded-modal' : 'fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(5,8,24,0.72)] p-4 backdrop-blur-sm animate-overlay-in'} onMouseDown={(event) => !props.embedded && event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role={props.embedded ? 'region' : 'dialog'} aria-modal={props.embedded ? undefined : true} aria-labelledby="billing-title" aria-describedby="billing-description" tabIndex={-1} className={props.embedded ? 'w-full overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-card outline-none' : 'max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[22px] border border-line2 bg-surface shadow-lift outline-none animate-modal-in'}>
        <header className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <h2 id="billing-title" className="font-display text-lg font-semibold text-ink">账户与账单</h2>
            <p className="mt-1 text-sm text-ink-3">{user.email}</p>
          </div>
          <button type="button" onClick={props.onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-3 hover:bg-surface2 hover:text-ink" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-6">
          {!paymentEnabled && (
            <div role="status" className="rounded-2xl border border-line bg-surface2 px-4 py-3 text-sm text-ink-2">
              <div className="font-semibold text-ink">支付服务暂未配置</div>
              <p className="mt-1 text-xs leading-5 text-ink-3">余额和历史账单仍可正常查看；充值入口将在管理员完成 Dulupay 配置后开放。</p>
            </div>
          )}
          <section id="billing-description" className="rounded-2xl border border-line bg-surface2 p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-ink-3"><Wallet className="h-4 w-4 text-info" />可用余额</div>
                <div className="mt-2 break-words font-mono text-lg font-semibold text-ink sm:text-xl">{formatPlatformQuota(Math.max(0, account.quota - (account.reserved_quota || 0)), status)}</div>
                <div className="mt-0.5 text-[11px] text-ink-3">用于生图、Agent 对话与联网搜索 · 累计消费 {formatPlatformQuota(account.used_quota, status)}</div>
              </div>
              <div className="min-w-0 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-ink">账户余额充值</div>
                    <div className="mt-0.5 text-xs text-ink-3">单次充值 ¥{rechargeMin.toFixed(2)}–¥{rechargeMax.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {paymentEnabled ? (
                    <>
                      <label className="flex h-10 min-w-0 flex-1 items-center rounded-[11px] border border-line bg-surface px-3 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft">
                        <span className="mr-1 text-sm text-ink-3">¥</span>
                        <input type="number" min={rechargeMin} max={rechargeMax} step="0.01" inputMode="decimal" aria-label="充值金额" value={rechargeAmount} onChange={(event) => { setRechargeAmount(event.target.value); setCheckoutError(null); setActiveCheckout(null) }} onKeyDown={(event) => { if (getComposerEnterAction({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode }) === 'submit') void handleRecharge() }} className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none" />
                      </label>
                      {requiresPaymentType && (
                        <div className="flex h-10 shrink-0 rounded-[11px] border border-line bg-surface p-1" aria-label="支付方式">
                          {paymentTypes.includes('wxpay') && <button type="button" disabled={recharging} onClick={() => { const refresh = Boolean(activeCheckout); setPayType('wxpay'); setCheckoutError(null); setActiveCheckout(null); if (refresh) void handleRecharge('wxpay') }} aria-pressed={payType === 'wxpay'} className={`rounded-lg px-3 text-xs font-medium transition ${payType === 'wxpay' ? 'bg-accent text-white shadow-sm' : 'text-ink-3 hover:text-ink'}`}>微信支付</button>}
                          {paymentTypes.includes('alipay') && <button type="button" disabled={recharging} onClick={() => { const refresh = Boolean(activeCheckout); setPayType('alipay'); setCheckoutError(null); setActiveCheckout(null); if (refresh) void handleRecharge('alipay') }} aria-pressed={payType === 'alipay'} className={`rounded-lg px-3 text-xs font-medium transition ${payType === 'alipay' ? 'bg-accent text-white shadow-sm' : 'text-ink-3 hover:text-ink'}`}>支付宝</button>}
                        </div>
                      )}
                    </>
                  ) : (
                    <button type="button" disabled className="h-10 w-full rounded-[11px] border border-line bg-surface px-4 text-sm font-medium text-ink-3">暂未开放</button>
                  )}
                </div>
                {paymentEnabled && (
                  <button type="button" onClick={() => void handleRecharge()} disabled={!rechargeReady || recharging} className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#0891b2)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition hover:-translate-y-px active:scale-[0.99] disabled:opacity-50 disabled:hover:translate-y-0">
                    {recharging ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <>生成收款码<ScanLine className="h-4 w-4" /></>}
                  </button>
                )}
                {paymentEnabled && !rechargeValid && <p className="mt-2 text-xs text-red-500">请输入有效的充值金额</p>}
                {paymentEnabled && rechargeValid && requiresPaymentType && !payType && <p className="mt-2 text-xs text-ink-3">请选择微信支付或支付宝</p>}
                {checkoutError && <p className="mt-2 rounded-[11px] bg-red-500/10 px-3 py-2 text-sm text-red-500">{checkoutError}</p>}
                {activeCheckout && <PaymentQrModal embedded checkout={activeCheckout} productName="账户余额充值" onClose={closePayment} onPaid={handlePaymentPaid} />}
              </div>
            </div>
          </section>

          <div className="min-w-0 rounded-2xl border border-line bg-surface2 p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-ink-3"><Image className="h-4 w-4 text-accent" />生图价格</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {IMAGE_PRICE_TIERS.map((tier) => (
                <div key={tier.key} className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5">
                  <div className="text-xs font-medium text-ink-3">{tier.label}</div>
                  <div className="mt-1 break-words font-mono text-sm font-semibold text-ink sm:text-base">{formatPlatformPrice(imagePrices[tier.key], status)}/张</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-ink-3">按成功生成张数结算，失败或取消不扣费</div>
          </div>

          <details className="group rounded-2xl border border-line bg-surface2 p-4">
            <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-semibold text-ink">
              <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-accent" />Agent 模型价格</span>
            </summary>
            <div className="mt-3 grid gap-2">
              {agentModelPrices.map((model) => (
                <div key={model.id} className="rounded-xl border border-line bg-surface px-3 py-3">
                  <div className="font-mono text-sm font-semibold text-ink">{model.label}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><div className="text-ink-3">输入</div><div className="mt-1 font-mono font-medium text-ink">{formatPlatformQuota(model.input_price_micros, status)}</div></div>
                    <div><div className="text-ink-3">输出</div><div className="mt-1 font-mono font-medium text-ink">{formatPlatformQuota(model.output_price_micros, status)}</div></div>
                    <div><div className="text-ink-3">缓存读取</div><div className="mt-1 font-mono font-medium text-ink">{formatPlatformQuota(model.cached_input_price_micros, status)}</div></div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-ink-3">人民币 / 百万 tokens</div>
                </div>
              ))}
              {agentModelPrices.length === 0 && <p className="py-3 text-center text-sm text-ink-3">价格信息加载中</p>}
            </div>
          </details>

          <div className="rounded-2xl border border-line bg-surface2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><Ticket className="h-4 w-4 text-accent" />兑换码</h3>
            <div className="flex gap-2">
              <input
                value={redeemInput}
                onChange={(e) => { setRedeemInput(e.target.value); setRedeemMsg(null) }}
                onKeyDown={(e) => { if (getComposerEnterAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.nativeEvent.keyCode }) === 'submit') void handleRedeem() }}
                placeholder="输入兑换码，如 ABCD-EFGH-JKLM"
                className="h-10 min-w-0 flex-1 rounded-[11px] border border-line bg-surface px-3 font-mono text-sm uppercase tracking-wide text-ink outline-none transition placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-3 focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
              />
              <button type="button" onClick={() => void handleRedeem()} disabled={redeeming || !redeemInput.trim()} className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#0891b2)] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition hover:-translate-y-px disabled:opacity-50 disabled:hover:translate-y-0">
                {redeeming ? <LoaderCircle className="h-4 w-4 animate-spin" /> : '兑换'}
              </button>
            </div>
            {redeemMsg && <p className={`mt-2 text-xs ${redeemMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{redeemMsg.text}</p>}
          </div>

          <div className="rounded-2xl border border-line bg-surface2 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">最近账单</h3>
              {!billing && !billingError && <LoaderCircle className="h-4 w-4 animate-spin text-ink-3" />}
            </div>
            {billingError && <p className="rounded-[11px] bg-red-500/10 px-3 py-2 text-sm text-red-500">{billingError}</p>}
            {billing && billing.entries.length === 0 && <p className="py-5 text-center text-sm text-ink-3">暂无账单记录</p>}
            {billing && billing.entries.length > 0 && (
              <div className="divide-y divide-line">
                {billing.entries.slice(0, 10).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink-2">{entry.description}</div>
                      <div className="mt-0.5 text-xs text-ink-3">{new Date(entry.created_at).toLocaleString('zh-CN')}</div>
                    </div>
                    <div className={`shrink-0 font-mono text-xs font-semibold ${entry.amount_micros > 0 ? 'text-emerald-500' : 'text-ink-2'}`}>{formatPlatformLedgerAmount(entry.amount_micros, status)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
