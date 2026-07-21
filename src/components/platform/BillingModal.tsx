import { Coins, Crown, ExternalLink, LoaderCircle, Ticket, Wallet, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPlatformBalanceCheckout, createPlatformProductCheckout } from '../../lib/platformCheckout'
import type { PlatformPaymentType } from '../../lib/platformCheckout'
import { formatPlatformPrice, formatPlatformQuota } from '../../lib/platformCurrency'
import { usePlatformStore } from '../../platformStore'
import type { PlatformBilling, PlatformProduct } from '../../platformStore'

interface BillingModalProps {
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  embedded?: boolean
}

export default function BillingModal(props: BillingModalProps) {
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const loadBilling = usePlatformStore((s) => s.loadBilling)
  const redeemCode = usePlatformStore((s) => s.redeemCode)
  const paymentEnabled = Boolean(status?.image_studio?.payment_enabled ?? status?.image_studio?.payment_url)
  const paymentProvider = status?.image_studio?.payment_provider
  const imageUnitPrice = status?.image_studio?.image_unit_price || 0
  const dialogRef = useRef<HTMLElement>(null)
  const [billing, setBilling] = useState<PlatformBilling | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [checkoutProductId, setCheckoutProductId] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [payType, setPayType] = useState<PlatformPaymentType>('wxpay')
  const [rechargeAmount, setRechargeAmount] = useState('20')
  const [recharging, setRecharging] = useState(false)
  const [redeemInput, setRedeemInput] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null)

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
  const products = billing?.products ?? status?.image_studio?.products ?? []
  const memberships = products.filter((product) => product.kind === 'membership')
  const creditPacks = products.filter((product) => product.kind === 'credits')
  const availableCredits = account.available_credits ?? Math.max(0, (account.image_credits ?? 0) - (account.reserved_credits ?? 0))
  const membershipActive = Boolean(account.membership_active && account.membership_expires_at)
  const rechargeMin = billing?.recharge_min ?? status?.image_studio?.recharge_min ?? 1
  const rechargeMax = billing?.recharge_max ?? status?.image_studio?.recharge_max ?? 5000
  const rechargeValue = Number(rechargeAmount)
  const rechargeValid = Number.isFinite(rechargeValue) && rechargeValue >= rechargeMin && rechargeValue <= rechargeMax && /^\d+(?:\.\d{1,2})?$/.test(rechargeAmount.trim())

  const handlePurchase = async (productId: string) => {
    if (!paymentEnabled || checkoutProductId || recharging) return
    setCheckoutProductId(productId)
    setCheckoutError(null)
    try {
      const checkout = await createPlatformProductCheckout(productId, payType)
      window.location.assign(checkout.checkout_url)
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err))
      setCheckoutProductId(null)
    }
  }

  const handleRecharge = async () => {
    if (!paymentEnabled || !rechargeValid || recharging || checkoutProductId) return
    setRecharging(true)
    setCheckoutError(null)
    try {
      const checkout = await createPlatformBalanceCheckout(rechargeAmount.trim(), payType)
      window.location.assign(checkout.checkout_url)
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
      if (granted.credits) parts.push(`${granted.credits} 次`)
      if (granted.membershipDays) parts.push(`会员 ${granted.membershipDays} 天`)
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

  const renderProductRow = (product: PlatformProduct) => {
    const isMembership = product.kind === 'membership'
    const spec = isMembership ? `${product.duration_days} 天不限次生成` : `${product.credits} 次生成额度`
    const buyLabel = isMembership && membershipActive ? '续费' : '购买'
    return (
      <div key={product.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-line2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
          {isMembership ? <Crown className="h-5 w-5" /> : <Coins className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-ink">{product.name}</span>
            <span className="shrink-0 font-mono text-sm font-semibold text-accent-ink">{formatPlatformPrice(product.price, status)}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-3">{spec}{product.description ? ` · ${product.description}` : ''}</div>
        </div>
        {paymentEnabled ? (
          <button type="button" onClick={() => void handlePurchase(product.id)} disabled={checkoutProductId !== null || recharging} className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#0891b2)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition hover:-translate-y-px active:scale-[0.99] disabled:opacity-50 disabled:hover:translate-y-0">
            {checkoutProductId === product.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <>{buyLabel}<ExternalLink className="h-3.5 w-3.5" /></>}
          </button>
        ) : (
          <button type="button" disabled className="h-9 shrink-0 rounded-[11px] border border-line bg-surface2 px-4 text-sm font-medium text-ink-3">未开放</button>
        )}
      </div>
    )
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
              <p className="mt-1 text-xs leading-5 text-ink-3">余额、次数、会员状态和历史账单仍可正常查看；充值与购买入口将在管理员完成 Dulupay 配置后开放。</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className={`min-w-0 rounded-2xl border p-4 ${membershipActive ? 'border-transparent bg-accent-soft' : 'border-line bg-surface2'}`}>
              <div className="flex items-center gap-2 text-xs font-medium text-ink-3"><Crown className="h-4 w-4 text-accent" />会员状态</div>
              <div className={`mt-2 break-words text-sm font-semibold sm:text-base ${membershipActive ? 'text-accent-ink' : 'text-ink'}`}>
                {membershipActive ? '生效中' : '未生效'}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">
                {membershipActive && account.membership_expires_at ? `有效期至 ${new Date(account.membership_expires_at).toLocaleDateString('zh-CN')}` : '已停止销售，新购请购买生图次数'}
              </div>
            </div>
            <div className="min-w-0 rounded-2xl border border-line bg-surface2 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-ink-3"><Coins className="h-4 w-4 text-accent" />剩余次数</div>
              <div className="mt-2 break-words font-mono text-lg font-semibold text-ink sm:text-xl">{availableCredits}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">生图仅使用次数，不扣对话余额</div>
            </div>
            <div id="billing-description" className="min-w-0 rounded-2xl border border-line bg-surface2 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-ink-3"><Wallet className="h-4 w-4 text-info" />可用余额</div>
              <div className="mt-2 break-words font-mono text-lg font-semibold text-ink sm:text-xl">{formatPlatformQuota(Math.max(0, account.quota - (account.reserved_quota || 0)), status)}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">用于 Agent 对话与联网搜索 · 累计消费 {formatPlatformQuota(account.used_quota, status)}</div>
            </div>
          </div>

          {paymentEnabled && paymentProvider === 'dulupay' && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface2 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-ink">支付方式</div>
                <div className="mt-0.5 text-xs text-ink-3">由 Dulupay 安全收银台处理</div>
              </div>
              <div className="flex rounded-[11px] border border-line bg-surface p-1">
                <button type="button" onClick={() => setPayType('wxpay')} aria-pressed={payType === 'wxpay'} className={`h-8 rounded-lg px-3 text-xs font-medium transition ${payType === 'wxpay' ? 'bg-accent text-white shadow-sm' : 'text-ink-3 hover:text-ink'}`}>微信支付</button>
                <button type="button" onClick={() => setPayType('alipay')} aria-pressed={payType === 'alipay'} className={`h-8 rounded-lg px-3 text-xs font-medium transition ${payType === 'alipay' ? 'bg-accent text-white shadow-sm' : 'text-ink-3 hover:text-ink'}`}>支付宝</button>
              </div>
            </div>
          )}

          {(memberships.length > 0 || creditPacks.length > 0) && (
            <div className="flex flex-col gap-4">
              {memberships.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><Crown className="h-4 w-4 text-accent" />{membershipActive ? '续费会员' : '开通会员'}</h3>
                  <div className="flex flex-col gap-2">{memberships.map(renderProductRow)}</div>
                </div>
              )}
              {creditPacks.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><Coins className="h-4 w-4 text-accent" />购买次数包</h3>
                  <div className="flex flex-col gap-2">{creditPacks.map(renderProductRow)}</div>
                </div>
              )}
              {imageUnitPrice > 0 && (
                <p className="text-xs text-ink-3">图片参考单价 {formatPlatformPrice(imageUnitPrice, status)}/张 · 实际按生图次数扣减 · 失败请求自动返还次数</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface2 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">对话余额充值</div>
              <div className="mt-0.5 text-xs text-ink-3">用于 Agent 模型调用与联网搜索；生图仍单独扣减次数</div>
              <div className="mt-1 text-[11px] text-ink-3">单次充值 ¥{rechargeMin.toFixed(2)}–¥{rechargeMax.toFixed(2)}</div>
            </div>
            {paymentEnabled ? (
              <div className="flex shrink-0 gap-2">
                <label className="flex h-10 w-32 items-center rounded-[11px] border border-line bg-surface px-3 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft">
                  <span className="mr-1 text-sm text-ink-3">¥</span>
                  <input type="number" min={rechargeMin} max={rechargeMax} step="0.01" inputMode="decimal" aria-label="充值金额" value={rechargeAmount} onChange={(event) => { setRechargeAmount(event.target.value); setCheckoutError(null) }} onKeyDown={(event) => { if (event.key === 'Enter') void handleRecharge() }} className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none" />
                </label>
                <button type="button" onClick={() => void handleRecharge()} disabled={!rechargeValid || recharging || checkoutProductId !== null} className="inline-flex h-10 items-center justify-center gap-2 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#0891b2)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition hover:-translate-y-px active:scale-[0.99] disabled:opacity-50 disabled:hover:translate-y-0">
                  {recharging ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <>前往支付<ExternalLink className="h-4 w-4" /></>}
                </button>
              </div>
            ) : (
              <button type="button" disabled className="h-10 shrink-0 rounded-[11px] border border-line bg-surface px-4 text-sm font-medium text-ink-3">暂未开放</button>
            )}
          </div>

          {checkoutError && <p className="rounded-[11px] bg-red-500/10 px-3 py-2 text-sm text-red-500">{checkoutError}</p>}

          <div className="rounded-2xl border border-line bg-surface2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><Ticket className="h-4 w-4 text-accent" />兑换码</h3>
            <div className="flex gap-2">
              <input
                value={redeemInput}
                onChange={(e) => { setRedeemInput(e.target.value); setRedeemMsg(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleRedeem() }}
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
                    <div className={`shrink-0 font-mono text-xs font-semibold ${entry.amount_micros > 0 ? 'text-emerald-500' : 'text-ink-2'}`}>
                      {entry.amount_micros > 0 ? '+' : ''}{formatPlatformQuota(entry.amount_micros, status)}
                    </div>
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
