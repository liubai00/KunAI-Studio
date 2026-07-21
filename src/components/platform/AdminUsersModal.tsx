import { Check, CircleDollarSign, Coins, Crown, LoaderCircle, Search, Shield, UserRoundCheck, UserRoundX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { formatPlatformQuota } from '../../lib/platformCurrency'
import { usePlatformStore } from '../../platformStore'
import type { PlatformUser } from '../../platformStore'

type GrantMode = 'membership' | 'credits'

interface AdminUsersModalProps {
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  embedded?: boolean
}

export default function AdminUsersModal(props: AdminUsersModalProps) {
  const status = usePlatformStore((s) => s.status)
  const currentUser = usePlatformStore((s) => s.user)
  const listUsers = usePlatformStore((s) => s.listUsers)
  const updateUserAccess = usePlatformStore((s) => s.updateUserAccess)
  const adjustUserBalance = usePlatformStore((s) => s.adjustUserBalance)
  const grantUserMembership = usePlatformStore((s) => s.grantUserMembership)
  const grantUserCredits = usePlatformStore((s) => s.grantUserCredits)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const dialogRef = useRef<HTMLElement>(null)
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [groupDrafts, setGroupDrafts] = useState<Record<number, string>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [balanceTarget, setBalanceTarget] = useState<PlatformUser | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [grantTarget, setGrantTarget] = useState<PlatformUser | null>(null)
  const [grantMode, setGrantMode] = useState<GrantMode>('membership')
  const [grantValue, setGrantValue] = useState('')
  const [grantNote, setGrantNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = async (query = search) => {
    setLoading(true)
    setError(null)
    try {
      const items = await listUsers(query)
      setUsers(items)
      setGroupDrafts(Object.fromEntries(items.map((user) => [user.id, user.group])))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('')
  }, [])

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
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
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

  const updateUser = async (user: PlatformUser, changes: { role?: number; status?: number; group?: string }) => {
    setSavingId(user.id)
    setError(null)
    try {
      const updated = await updateUserAccess(user.id, changes)
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item))
      setGroupDrafts((items) => ({ ...items, [updated.id]: updated.group }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  const submitBalance = async (event: FormEvent) => {
    event.preventDefault()
    if (!balanceTarget) return
    setSavingId(balanceTarget.id)
    setError(null)
    try {
      const updated = await adjustUserBalance(balanceTarget.id, amount, note)
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item))
      setBalanceTarget(null)
      setAmount('')
      setNote('')
      await refreshSession().catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  const openBalance = (user: PlatformUser) => { setGrantTarget(null); setBalanceTarget(user); setAmount(''); setNote('') }
  const openGrant = (user: PlatformUser, mode: GrantMode) => {
    setBalanceTarget(null)
    setGrantTarget(user)
    setGrantMode(mode)
    setGrantValue('')
    setGrantNote('')
  }

  const submitGrant = async (event: FormEvent) => {
    event.preventDefault()
    if (!grantTarget) return
    setError(null)
    const value = Number(grantValue)
    if (!Number.isFinite(value) || value === 0) {
      setError(grantMode === 'membership' ? '请输入有效的天数（正整数）' : '请输入有效的次数')
      return
    }
    setSavingId(grantTarget.id)
    try {
      const updated = grantMode === 'membership'
        ? await grantUserMembership(grantTarget.id, value, grantNote)
        : await grantUserCredits(grantTarget.id, value, grantNote)
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item))
      setGrantTarget(null)
      setGrantValue('')
      setGrantNote('')
      await refreshSession().catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className={props.embedded ? 'kunai-embedded-modal' : 'fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(5,8,24,0.72)] p-3 backdrop-blur-sm animate-overlay-in'} onMouseDown={(event) => !props.embedded && event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role={props.embedded ? 'region' : 'dialog'} aria-modal={props.embedded ? undefined : true} aria-labelledby="admin-users-title" tabIndex={-1} className={props.embedded ? 'flex min-h-[560px] w-full flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-card outline-none' : 'flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-lift outline-none animate-modal-in'}>
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 id="admin-users-title" className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><Shield className="h-5 w-5 text-accent" />用户与权限</h2>
            <p className="mt-1 text-sm text-ink-3">角色、状态和余额修改会立即由服务端生效</p>
          </div>
          <button type="button" onClick={props.onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface2 hover:text-ink" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); void load() }} className="flex shrink-0 gap-2 border-b border-line px-5 py-3 sm:px-6">
          <label className="flex h-10 min-w-0 flex-1 items-center rounded-[11px] border border-line bg-surface2 transition focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft">
            <Search className="ml-3 h-4 w-4 shrink-0 text-ink-3" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索邮箱或名称" className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-3" />
          </label>
          <button type="submit" className="h-10 shrink-0 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-transform hover:-translate-y-px">搜索</button>
        </form>

        {error && <p role="alert" className="mx-5 mt-3 shrink-0 rounded-[11px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500 sm:mx-6">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[920px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-surface2 text-xs font-medium text-ink-3">
              <tr>
                <th className="px-6 py-3">账户</th>
                <th className="px-3 py-3">用户组</th>
                <th className="px-3 py-3">角色</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3">可用余额</th>
                <th className="px-3 py-3">会员 / 次数</th>
                <th className="px-6 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => (
                <tr key={user.id} className="text-ink-2 transition-colors hover:bg-surface2">
                  <td className="px-6 py-3">
                    <div className="max-w-64 truncate font-medium text-ink">{user.email}</div>
                    <div className="mt-0.5 font-mono text-xs text-ink-3">ID {user.id}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <input
                        value={groupDrafts[user.id] ?? user.group}
                        disabled={savingId === user.id || currentUser?.id === user.id}
                        onChange={(event) => setGroupDrafts((items) => ({ ...items, [user.id]: event.target.value }))}
                        className="h-8 w-24 rounded-[8px] border border-line bg-surface2 px-2 font-mono text-xs text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:opacity-60"
                        aria-label={`${user.email} 用户组`}
                      />
                      <button type="button" disabled={savingId === user.id || currentUser?.id === user.id || (groupDrafts[user.id] ?? user.group).trim() === user.group} onClick={() => void updateUser(user, { group: groupDrafts[user.id] })} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-30 dark:text-emerald-400" aria-label={`保存 ${user.email} 用户组`}>
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <select value={user.role >= 10 ? 10 : 1} disabled={savingId === user.id || currentUser?.id === user.id} onChange={(event) => void updateUser(user, { role: Number(event.target.value) })} className="h-8 rounded-[8px] border border-line bg-surface2 px-2 text-xs text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:opacity-60" aria-label={`${user.email} 角色`}>
                      <option value={1}>用户</option>
                      <option value={10}>管理员</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" disabled={savingId === user.id || currentUser?.id === user.id} onClick={() => void updateUser(user, { status: user.status === 1 ? 0 : 1 })} className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-xs font-medium transition-colors disabled:opacity-60 ${user.status === 1 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-500'}`}>
                      {user.status === 1 ? <UserRoundCheck className="h-3.5 w-3.5" /> : <UserRoundX className="h-3.5 w-3.5" />}
                      {user.status === 1 ? '正常' : '停用'}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs font-semibold text-ink">{formatPlatformQuota(Math.max(0, user.quota - (user.reserved_quota || 0)), status)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit items-center gap-1 text-xs ${user.membership_active ? 'font-medium text-accent-ink' : 'text-ink-3'}`}>
                        <Crown className="h-3 w-3" />{user.membership_active && user.membership_expires_at ? new Date(user.membership_expires_at).toLocaleDateString('zh-CN') : '非会员'}
                      </span>
                      <span className="inline-flex w-fit items-center gap-1 font-mono text-xs text-ink-2">
                        <Coins className="h-3 w-3 text-ink-3" />{user.available_credits ?? Math.max(0, (user.image_credits ?? 0) - (user.reserved_credits ?? 0))} 次
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button type="button" disabled={savingId === user.id} onClick={() => openGrant(user, 'membership')} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-50" aria-label={`为 ${user.email} 开通会员`} title="开通会员">
                        <Crown className="h-4 w-4" />
                      </button>
                      <button type="button" disabled={savingId === user.id} onClick={() => openGrant(user, 'credits')} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-50" aria-label={`为 ${user.email} 赠送次数`} title="赠送次数">
                        <Coins className="h-4 w-4" />
                      </button>
                      <button type="button" disabled={savingId === user.id} onClick={() => openBalance(user)} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-50" aria-label={`调整 ${user.email} 余额`} title="调整余额">
                        {savingId === user.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && users.length === 0 && <div className="px-6 py-16 text-center text-sm text-ink-3">没有匹配的用户</div>}
          {loading && <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-ink-3"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载</div>}
        </div>

        {balanceTarget && (
          <form onSubmit={submitBalance} className="grid shrink-0 gap-3 border-t border-line bg-surface2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto] sm:items-end sm:px-6">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{balanceTarget.email}</div>
              <div className="mt-1 text-xs text-ink-3">当前 {formatPlatformQuota(Math.max(0, balanceTarget.quota - (balanceTarget.reserved_quota || 0)), status)}</div>
            </div>
            <label className="space-y-1">
              <span className="text-xs text-ink-3">调整对话余额（人民币）</span>
              <input required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="10 或 -5" inputMode="decimal" className="h-9 w-full rounded-[11px] border border-line bg-surface px-3 font-mono text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:text-ink-3" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-ink-3">备注</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="充值、退款或修正" className="h-9 w-full rounded-[11px] border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:text-ink-3" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setBalanceTarget(null)} className="h-9 rounded-[11px] border border-line bg-surface px-3 text-sm text-ink transition-colors hover:border-line2">取消</button>
              <button type="submit" disabled={savingId === balanceTarget.id} className="h-9 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-transform hover:-translate-y-px disabled:opacity-50">确认</button>
            </div>
          </form>
        )}

        {grantTarget && (
          <form onSubmit={submitGrant} className="grid shrink-0 gap-3 border-t border-line bg-surface2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto] sm:items-end sm:px-6">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{grantTarget.email}</div>
              <div className="mt-1 flex items-center gap-1 text-xs text-ink-3">
                {grantMode === 'membership'
                  ? <><Crown className="h-3 w-3" />{grantTarget.membership_active && grantTarget.membership_expires_at ? `会员至 ${new Date(grantTarget.membership_expires_at).toLocaleDateString('zh-CN')}` : '当前非会员'}</>
                  : <><Coins className="h-3 w-3" />{`当前 ${grantTarget.available_credits ?? Math.max(0, (grantTarget.image_credits ?? 0) - (grantTarget.reserved_credits ?? 0))} 次`}</>}
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-xs text-ink-3">{grantMode === 'membership' ? '增加天数' : '增加次数（可负）'}</span>
              <input required value={grantValue} onChange={(event) => setGrantValue(event.target.value)} placeholder={grantMode === 'membership' ? '30' : '100 或 -10'} inputMode="numeric" className="h-9 w-full rounded-[11px] border border-line bg-surface px-3 font-mono text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:text-ink-3" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-ink-3">备注</span>
              <input value={grantNote} onChange={(event) => setGrantNote(event.target.value)} placeholder={grantMode === 'membership' ? '开通/续费会员' : '赠送或修正次数'} className="h-9 w-full rounded-[11px] border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:text-ink-3" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setGrantTarget(null)} className="h-9 rounded-[11px] border border-line bg-surface px-3 text-sm text-ink transition-colors hover:border-line2">取消</button>
              <button type="submit" disabled={savingId === grantTarget.id} className="h-9 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-transform hover:-translate-y-px disabled:opacity-50">确认</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
