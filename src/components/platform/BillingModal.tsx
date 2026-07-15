import { CreditCard, ExternalLink, Image, LoaderCircle, ReceiptText, Wallet, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { formatPlatformPrice, formatPlatformQuota } from '../../lib/platformCurrency'
import { usePlatformStore } from '../../platformStore'
import type { PlatformBilling } from '../../platformStore'

interface BillingModalProps {
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

export default function BillingModal(props: BillingModalProps) {
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const loadBilling = usePlatformStore((s) => s.loadBilling)
  const paymentUrl = status?.image_studio?.payment_url
  const imageUnitPrice = status?.image_studio?.image_unit_price || 0
  const dialogRef = useRef<HTMLElement>(null)
  const [billing, setBilling] = useState<PlatformBilling | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
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
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef.current?.focus()
    }
  }, [loadBilling, props.onClose, props.returnFocusRef, refreshSession])

  if (!user) return null

  const account = billing || user

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px] animate-overlay-in" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="billing-title" aria-describedby="billing-description" tabIndex={-1} className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-black/[0.07] bg-white shadow-2xl outline-none animate-modal-in dark:border-white/10 dark:bg-[#1b1a18]">
        <header className="flex items-start justify-between border-b border-black/[0.06] px-6 py-5 dark:border-white/10">
          <div>
            <h2 id="billing-title" className="text-lg font-semibold text-[#282724] dark:text-white">账户与账单</h2>
            <p className="mt-1 text-sm text-[#77716a] dark:text-gray-400">{user.email}</p>
          </div>
          <button type="button" onClick={props.onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-1 divide-y divide-black/[0.06] border-b border-black/[0.06] sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-white/10 dark:border-white/10">
          <div className="min-w-0 px-5 py-5">
            <div className="flex items-center gap-2 text-xs font-medium text-[#77716a] dark:text-gray-400"><Wallet className="h-4 w-4 text-amber-500" />可用余额</div>
            <div className="mt-2 break-words font-mono text-lg font-semibold text-[#282724] sm:text-xl dark:text-white">{formatPlatformQuota(Math.max(0, account.quota - (account.reserved_quota || 0)), status)}</div>
          </div>
          <div className="min-w-0 px-5 py-5">
            <div className="flex items-center gap-2 text-xs font-medium text-[#77716a] dark:text-gray-400"><ReceiptText className="h-4 w-4 text-sky-500" />累计消费</div>
            <div className="mt-2 break-words font-mono text-lg font-semibold text-[#282724] sm:text-xl dark:text-white">{formatPlatformQuota(account.used_quota, status)}</div>
          </div>
          <div className="min-w-0 px-5 py-5">
            <div className="flex items-center gap-2 text-xs font-medium text-[#77716a] dark:text-gray-400"><Image className="h-4 w-4 text-emerald-500" />成功单价</div>
            <div className="mt-2 break-words font-mono text-lg font-semibold text-[#282724] sm:text-xl dark:text-white">{imageUnitPrice > 0 ? formatPlatformPrice(imageUnitPrice, status) : '动态'}</div>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"><CreditCard className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#36322e] dark:text-gray-100">余额充值</div>
              <div id="billing-description" className="mt-0.5 text-xs text-[#858079] dark:text-gray-500">失败请求由平台自动释放预扣额度</div>
            </div>
          </div>
          {paymentUrl ? (
            <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-amber-500 px-4 text-sm font-semibold text-white hover:bg-amber-600 active:scale-[0.99]">
              前往充值<ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <button type="button" disabled className="h-10 shrink-0 rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-400 dark:bg-white/[0.05] dark:text-gray-600">暂未开放</button>
          )}
        </div>

        <div className="border-t border-black/[0.06] px-6 py-5 dark:border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#36322e] dark:text-gray-100">最近账单</h3>
            {!billing && !billingError && <LoaderCircle className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
          {billingError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{billingError}</p>}
          {billing && billing.entries.length === 0 && <p className="py-5 text-center text-sm text-gray-400">暂无账单记录</p>}
          {billing && billing.entries.length > 0 && (
            <div className="divide-y divide-black/[0.06] dark:divide-white/10">
              {billing.entries.slice(0, 10).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[#4a4540] dark:text-gray-200">{entry.description}</div>
                    <div className="mt-0.5 text-xs text-gray-400">{new Date(entry.created_at).toLocaleString('zh-CN')}</div>
                  </div>
                  <div className={`shrink-0 font-mono text-xs font-semibold ${entry.amount_micros > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#4a4540] dark:text-gray-200'}`}>
                    {entry.amount_micros > 0 ? '+' : ''}{formatPlatformQuota(entry.amount_micros, status)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
