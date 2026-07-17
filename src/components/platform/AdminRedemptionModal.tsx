import { Check, Copy, LoaderCircle, Ticket, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { usePlatformStore } from '../../platformStore'
import type { RedemptionCode } from '../../platformStore'

interface AdminRedemptionModalProps {
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

function describeGrant(code: Pick<RedemptionCode, 'credits' | 'membership_days' | 'balance'>) {
  const parts: string[] = []
  if (code.credits > 0) parts.push(`${code.credits} 次`)
  if (code.membership_days > 0) parts.push(`会员 ${code.membership_days} 天`)
  if (code.balance > 0) parts.push(`$${code.balance}`)
  return parts.join(' · ') || '—'
}

export default function AdminRedemptionModal(props: AdminRedemptionModalProps) {
  const listRedemptionCodes = usePlatformStore((s) => s.listRedemptionCodes)
  const createRedemptionCodes = usePlatformStore((s) => s.createRedemptionCodes)
  const dialogRef = useRef<HTMLElement>(null)
  const [codes, setCodes] = useState<RedemptionCode[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<string[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  const [credits, setCredits] = useState('')
  const [membershipDays, setMembershipDays] = useState('')
  const [balance, setBalance] = useState('')
  const [count, setCount] = useState('1')
  const [note, setNote] = useState('')
  const [expiresDays, setExpiresDays] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setCodes(await listRedemptionCodes())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { props.onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) return
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
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef.current?.focus()
    }
  }, [props.onClose, props.returnFocusRef])

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setGenerating(true)
    setError(null)
    try {
      const result = await createRedemptionCodes({
        credits: Number(credits) || 0,
        membership_days: Number(membershipDays) || 0,
        balance: balance.trim() || undefined,
        count: Number(count) || 1,
        note: note.trim() || undefined,
        expires_at: expiresDays.trim() && Number.isFinite(Number(expiresDays)) ? Date.now() + Number(expiresDays) * 24 * 60 * 60 * 1000 : null,
      })
      setGenerated(result.codes)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  const field = 'h-9 w-full rounded-[11px] border border-line bg-surface px-3 font-mono text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:font-sans placeholder:text-ink-3'

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(12,11,9,0.55)] p-3 backdrop-blur-sm animate-overlay-in" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-redemption-title" tabIndex={-1} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-lift outline-none animate-modal-in">
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 id="admin-redemption-title" className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><Ticket className="h-5 w-5 text-accent" />兑换码</h2>
            <p className="mt-1 text-sm text-ink-3">批量生成兑换码，用户在账单页输入即可到账</p>
          </div>
          <button type="button" onClick={props.onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface2 hover:text-ink" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        {error && <p role="alert" className="mx-5 mt-3 shrink-0 rounded-[11px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500 sm:mx-6">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 sm:px-6">
          <form onSubmit={submit} className="rounded-2xl border border-line bg-surface2 p-4">
            <div className="mb-3 text-sm font-semibold text-ink">生成兑换码</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs text-ink-3">生成次数</span>
                <input value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="如 100" inputMode="numeric" className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">会员天数</span>
                <input value={membershipDays} onChange={(e) => setMembershipDays(e.target.value)} placeholder="如 30" inputMode="numeric" className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">余额（USD）</span>
                <input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="如 5" inputMode="decimal" className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">生成数量</span>
                <input required value={count} onChange={(e) => setCount(e.target.value)} placeholder="1–1000" inputMode="numeric" className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">有效期（天，留空永久）</span>
                <input value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} placeholder="留空 = 永久" inputMode="numeric" className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">备注</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="活动名称" className={`${field} font-sans`} />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-ink-3">至少填写「次数 / 会员天数 / 余额」之一</p>
              <button type="submit" disabled={generating} className="h-9 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-transform hover:-translate-y-px disabled:opacity-50">{generating ? '生成中…' : '生成'}</button>
            </div>
          </form>

          {generated.length > 0 && (
            <div className="mt-4 rounded-2xl border border-accent/30 bg-accent-soft p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-accent-ink">已生成 {generated.length} 个兑换码</div>
                <button type="button" onClick={() => void copy(generated.join('\n'), '__all__')} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:border-line2">
                  {copied === '__all__' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}复制全部
                </button>
              </div>
              <div className="max-h-40 overflow-auto rounded-[10px] border border-line bg-surface p-2 font-mono text-xs text-ink">
                {generated.map((code) => <div key={code} className="px-1 py-0.5">{code}</div>)}
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-ink">最近生成</div>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载</div>
            ) : codes.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-3">还没有兑换码</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {codes.map((code) => (
                  <div key={code.code} className={`flex items-center gap-3 rounded-xl border border-line p-2.5 ${code.redeemed_by ? 'bg-surface2 opacity-60' : 'bg-surface'}`}>
                    <span className="shrink-0 font-mono text-sm font-semibold text-ink">{code.code}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{describeGrant(code)}{code.note ? ` · ${code.note}` : ''}</span>
                    <span className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium ${code.redeemed_by ? 'bg-ink-3/15 text-ink-3' : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'}`}>{code.redeemed_by ? '已使用' : '未使用'}</span>
                    <button type="button" onClick={() => void copy(code.code, code.code)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface2 hover:text-ink" aria-label={`复制 ${code.code}`}>
                      {copied === code.code ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
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
