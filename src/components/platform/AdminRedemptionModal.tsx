import { Ban, Check, Copy, LoaderCircle, Power, Search, Ticket, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { usePlatformStore } from '../../platformStore'
import type { RedemptionCode } from '../../platformStore'

interface AdminRedemptionModalProps {
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  embedded?: boolean
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'available', label: '可使用' },
  { value: 'disabled', label: '已停用' },
  { value: 'exhausted', label: '已用尽' },
  { value: 'expired', label: '已过期' },
]

function describeGrant(code: Pick<RedemptionCode, 'credits' | 'membership_days' | 'balance'>) {
  const parts: string[] = []
  if (code.credits > 0) parts.push(`${code.credits} 次生图`)
  if (code.membership_days > 0) parts.push(`兼容会员 ${code.membership_days} 天`)
  if (code.balance > 0) parts.push(`¥${code.balance.toFixed(2)} 余额`)
  return parts.join(' · ') || '—'
}

function describeStatus(code: RedemptionCode) {
  if (!code.enabled) return { label: '已停用', className: 'bg-red-500/10 text-red-500' }
  if (code.expires_at && code.expires_at <= Date.now()) return { label: '已过期', className: 'bg-amber-500/12 text-amber-600 dark:text-amber-400' }
  if (code.remaining_redemptions <= 0) return { label: '已用尽', className: 'bg-ink-3/15 text-ink-3' }
  return { label: '可使用', className: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' }
}

export default function AdminRedemptionModal(props: AdminRedemptionModalProps) {
  const listRedemptionCodes = usePlatformStore((s) => s.listRedemptionCodes)
  const createRedemptionCodes = usePlatformStore((s) => s.createRedemptionCodes)
  const setRedemptionCodeEnabled = usePlatformStore((s) => s.setRedemptionCodeEnabled)
  const dialogRef = useRef<HTMLElement>(null)
  const [codes, setCodes] = useState<RedemptionCode[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [updatingCode, setUpdatingCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<string[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [balance, setBalance] = useState('')
  const [count, setCount] = useState('1')
  const [maxRedemptions, setMaxRedemptions] = useState('1')
  const [note, setNote] = useState('')
  const [expiresDays, setExpiresDays] = useState('')
  const [enabled, setEnabled] = useState(true)

  const load = async (nextStatus = status, nextSearch = search) => {
    setLoading(true)
    setError(null)
    try {
      setCodes(await listRedemptionCodes({ status: nextStatus, search: nextSearch.trim() }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(status, search)
  }, [status])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    if (!props.embedded) {
      document.body.style.overflow = 'hidden'
      dialogRef.current?.focus()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (props.embedded) return
      if (event.key === 'Escape') { props.onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
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
      if (!props.embedded) document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef?.current?.focus()
    }
  }, [props.embedded, props.onClose, props.returnFocusRef])

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1500)
    } catch {
      setError('复制失败，请手动选择兑换码')
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setGenerating(true)
    setError(null)
    try {
      const result = await createRedemptionCodes({
        balance: balance.trim() || undefined,
        count: Number(count) || 1,
        max_redemptions: Number(maxRedemptions) || 1,
        enabled,
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

  const toggleCode = async (code: RedemptionCode) => {
    if (updatingCode) return
    setUpdatingCode(code.code)
    setError(null)
    try {
      const updated = await setRedemptionCodeEnabled(code.code, !code.enabled)
      setCodes((current) => current.map((item) => item.code === code.code ? updated : item))
      if (status !== 'all') await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdatingCode(null)
    }
  }

  const field = 'h-11 w-full rounded-xl border border-line bg-surface px-3 font-mono text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:font-sans placeholder:text-ink-3'

  return (
    <div className={props.embedded ? 'kunai-embedded-modal' : 'fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(5,8,24,0.72)] p-3 backdrop-blur-sm animate-overlay-in'} onMouseDown={(event) => !props.embedded && event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role={props.embedded ? 'region' : 'dialog'} aria-modal={props.embedded ? undefined : true} aria-labelledby="admin-redemption-title" tabIndex={-1} className={props.embedded ? 'flex min-h-[620px] w-full flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-card outline-none' : 'flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-lift outline-none animate-modal-in'}>
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div><h2 id="admin-redemption-title" className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><Ticket className="h-5 w-5 text-accent" />兑换码管理</h2><p className="mt-1 text-sm text-ink-3">创建权益码、跟踪使用次数并随时停用</p></div>
          <button type="button" onClick={props.onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-3 transition-colors hover:bg-surface2 hover:text-ink" aria-label="关闭"><X className="h-4 w-4" /></button>
        </header>

        {error && <p role="alert" className="mx-5 mt-3 shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500 sm:mx-6">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 sm:px-6">
          <form onSubmit={submit} className="rounded-2xl border border-line bg-surface2 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-semibold text-ink">创建兑换码</div><span className="text-xs text-ink-3">兑换后直接增加账户余额</span></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1"><span className="text-xs text-ink-3">账户余额（人民币）</span><input required value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="如 20" inputMode="decimal" className={field} /></label>
              <label className="space-y-1"><span className="text-xs text-ink-3">批量生成数量</span><input required value={count} onChange={(event) => setCount(event.target.value)} placeholder="1–1000" inputMode="numeric" className={field} /></label>
              <label className="space-y-1"><span className="text-xs text-ink-3">每码可使用次数</span><input required value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} placeholder="默认 1" inputMode="numeric" className={field} /></label>
              <label className="space-y-1"><span className="text-xs text-ink-3">有效期（天）</span><input value={expiresDays} onChange={(event) => setExpiresDays(event.target.value)} placeholder="留空永久" inputMode="numeric" className={field} /></label>
              <label className="space-y-1 lg:col-span-2"><span className="text-xs text-ink-3">名称 / 备注</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="如：夏季活动" className={`${field} font-sans`} /></label>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setEnabled((value) => !value)} aria-pressed={enabled} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-line bg-surface text-ink-3'}`}><Power className="h-4 w-4" />{enabled ? '创建后立即启用' : '创建后保持停用'}</button>
              <button type="submit" disabled={generating} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(150deg,var(--accent),#0891b2)] px-6 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition hover:-translate-y-px disabled:opacity-50">{generating && <LoaderCircle className="h-4 w-4 animate-spin" />}{generating ? '生成中…' : '生成兑换码'}</button>
            </div>
          </form>

          {generated.length > 0 && <div className="mt-4 rounded-2xl border border-accent/30 bg-accent-soft p-4"><div className="mb-2 flex items-center justify-between gap-2"><div className="text-sm font-semibold text-accent-ink">已生成 {generated.length} 个兑换码</div><button type="button" onClick={() => void copy(generated.join('\n'), '__all__')} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink">{copied === '__all__' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}复制全部</button></div><div className="max-h-40 overflow-auto rounded-xl border border-line bg-surface p-2 font-mono text-xs text-ink">{generated.map((code) => <div key={code} className="px-1 py-0.5">{code}</div>)}</div></div>}

          <div className="mt-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div><div className="text-sm font-semibold text-ink">兑换码列表</div><div className="mt-0.5 text-xs text-ink-3">已产生记录的权益内容不可修改，停用不会删除历史</div></div>
              <form onSubmit={(event) => { event.preventDefault(); void load() }} className="flex gap-2"><label className="flex min-h-11 min-w-0 flex-1 items-center rounded-xl border border-line bg-surface px-3 lg:w-64"><Search className="mr-2 h-4 w-4 text-ink-3" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索兑换码或备注" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" /></label><button type="submit" className="min-h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink">搜索</button></form>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="兑换码状态筛选">{STATUS_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setStatus(option.value)} aria-pressed={status === option.value} className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium transition ${status === option.value ? 'bg-accent text-white' : 'border border-line bg-surface text-ink-3 hover:text-ink'}`}>{option.label}</button>)}</div>

            {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载</div> : codes.length === 0 ? <div className="py-12 text-center text-sm text-ink-3">没有符合条件的兑换码</div> : (
              <div className="mt-3 grid gap-2">
                {codes.map((code) => {
                  const codeStatus = describeStatus(code)
                  return <article key={code.code} className="rounded-2xl border border-line bg-surface p-3 sm:p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-ink">{code.code}</span><span className={`rounded-lg px-2 py-1 text-[11px] font-medium ${codeStatus.className}`}>{codeStatus.label}</span></div><div className="mt-1 text-sm text-ink-2">{describeGrant(code)}</div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3"><span>已用 {code.redemption_count} / {code.max_redemptions}</span><span>剩余 {code.remaining_redemptions}</span><span>创建 {new Date(code.created_at).toLocaleString('zh-CN')}</span><span>{code.expires_at ? `到期 ${new Date(code.expires_at).toLocaleString('zh-CN')}` : '永久有效'}</span><span>创建人 #{code.created_by ?? '—'}</span>{code.note && <span>备注：{code.note}</span>}</div></div></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => void copy(code.code, code.code)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-ink"><Copy className="h-4 w-4" />{copied === code.code ? '已复制' : '复制'}</button><button type="button" onClick={() => void toggleCode(code)} disabled={updatingCode === code.code} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium disabled:opacity-50 ${code.enabled ? 'border-red-500/25 bg-red-500/8 text-red-500' : 'border-emerald-500/25 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400'}`}>{updatingCode === code.code ? <LoaderCircle className="h-4 w-4 animate-spin" /> : code.enabled ? <Ban className="h-4 w-4" /> : <Power className="h-4 w-4" />}{code.enabled ? '停用' : '启用'}</button></div></div></article>
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
