import { Check, CircleDollarSign, LoaderCircle, Search, Shield, UserRoundCheck, UserRoundX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { formatPlatformQuota } from '../../lib/platformCurrency'
import { usePlatformStore } from '../../platformStore'
import type { PlatformUser } from '../../platformStore'

interface AdminUsersModalProps {
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

export default function AdminUsersModal(props: AdminUsersModalProps) {
  const status = usePlatformStore((s) => s.status)
  const currentUser = usePlatformStore((s) => s.user)
  const listUsers = usePlatformStore((s) => s.listUsers)
  const updateUserAccess = usePlatformStore((s) => s.updateUserAccess)
  const adjustUserBalance = usePlatformStore((s) => s.adjustUserBalance)
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
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
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
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef.current?.focus()
    }
  }, [props.onClose, props.returnFocusRef])

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

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] animate-overlay-in" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-users-title" tabIndex={-1} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-black/[0.07] bg-white shadow-2xl outline-none animate-modal-in dark:border-white/10 dark:bg-[#1b1a18]">
        <header className="flex shrink-0 items-start justify-between border-b border-black/[0.06] px-5 py-4 dark:border-white/10 sm:px-6 sm:py-5">
          <div>
            <h2 id="admin-users-title" className="flex items-center gap-2 text-lg font-semibold text-[#282724] dark:text-white"><Shield className="h-5 w-5 text-amber-500" />用户与权限</h2>
            <p className="mt-1 text-sm text-[#77716a] dark:text-gray-400">角色、状态和余额修改会立即由服务端生效</p>
          </div>
          <button type="button" onClick={props.onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); void load() }} className="flex shrink-0 gap-2 border-b border-black/[0.06] px-5 py-3 dark:border-white/10 sm:px-6">
          <label className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-[#dedbd6] bg-white focus-within:border-amber-500 dark:border-white/10 dark:bg-white/[0.04]">
            <Search className="ml-3 h-4 w-4 shrink-0 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索邮箱或名称" className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none dark:text-white" />
          </label>
          <button type="submit" className="h-10 shrink-0 rounded-md bg-[#282724] px-4 text-sm font-medium text-white hover:bg-black dark:bg-white dark:text-[#282724]">搜索</button>
        </form>

        {error && <p role="alert" className="mx-5 mt-3 shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 sm:mx-6">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[780px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#f8f7f5] text-xs font-medium text-[#77716a] dark:bg-[#242320] dark:text-gray-400">
              <tr>
                <th className="px-6 py-3">账户</th>
                <th className="px-3 py-3">用户组</th>
                <th className="px-3 py-3">角色</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3">可用余额</th>
                <th className="px-6 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06] dark:divide-white/10">
              {users.map((user) => (
                <tr key={user.id} className="text-[#3f3a35] dark:text-gray-200">
                  <td className="px-6 py-3">
                    <div className="max-w-64 truncate font-medium">{user.email}</div>
                    <div className="mt-0.5 text-xs text-gray-400">ID {user.id}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <input
                        value={groupDrafts[user.id] ?? user.group}
                        disabled={savingId === user.id || currentUser?.id === user.id}
                        onChange={(event) => setGroupDrafts((items) => ({ ...items, [user.id]: event.target.value }))}
                        className="h-8 w-24 rounded-md border border-black/10 bg-transparent px-2 text-xs outline-none focus:border-amber-500 disabled:opacity-60 dark:border-white/10"
                        aria-label={`${user.email} 用户组`}
                      />
                      <button type="button" disabled={savingId === user.id || currentUser?.id === user.id || (groupDrafts[user.id] ?? user.group).trim() === user.group} onClick={() => void updateUser(user, { group: groupDrafts[user.id] })} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 dark:hover:bg-emerald-500/10" aria-label={`保存 ${user.email} 用户组`}>
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <select value={user.role >= 10 ? 10 : 1} disabled={savingId === user.id || currentUser?.id === user.id} onChange={(event) => void updateUser(user, { role: Number(event.target.value) })} className="h-8 rounded-md border border-black/10 bg-transparent px-2 text-xs outline-none focus:border-amber-500 disabled:opacity-60 dark:border-white/10 dark:bg-[#1b1a18]" aria-label={`${user.email} 角色`}>
                      <option value={1}>用户</option>
                      <option value={10}>管理员</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" disabled={savingId === user.id || currentUser?.id === user.id} onClick={() => void updateUser(user, { status: user.status === 1 ? 0 : 1 })} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium disabled:opacity-60 ${user.status === 1 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
                      {user.status === 1 ? <UserRoundCheck className="h-3.5 w-3.5" /> : <UserRoundX className="h-3.5 w-3.5" />}
                      {user.status === 1 ? '正常' : '停用'}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs font-semibold">{formatPlatformQuota(Math.max(0, user.quota - (user.reserved_quota || 0)), status)}</td>
                  <td className="px-6 py-3 text-right">
                    <button type="button" disabled={savingId === user.id} onClick={() => { setBalanceTarget(user); setAmount(''); setNote('') }} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-500/10" aria-label={`调整 ${user.email} 余额`} title="调整余额">
                      {savingId === user.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && users.length === 0 && <div className="px-6 py-16 text-center text-sm text-gray-400">没有匹配的用户</div>}
          {loading && <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-gray-400"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载</div>}
        </div>

        {balanceTarget && (
          <form onSubmit={submitBalance} className="grid shrink-0 gap-3 border-t border-black/[0.06] bg-[#faf9f7] px-5 py-4 dark:border-white/10 dark:bg-white/[0.025] sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto] sm:items-end sm:px-6">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[#36322e] dark:text-white">{balanceTarget.email}</div>
              <div className="mt-1 text-xs text-gray-500">当前 {formatPlatformQuota(Math.max(0, balanceTarget.quota - (balanceTarget.reserved_quota || 0)), status)}</div>
            </div>
            <label className="space-y-1">
              <span className="text-xs text-gray-500">调整金额（USD）</span>
              <input required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="10 或 -5" inputMode="decimal" className="h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-amber-500 dark:border-white/10 dark:bg-white/[0.04]" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-500">备注</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="充值、退款或修正" className="h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-amber-500 dark:border-white/10 dark:bg-white/[0.04]" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setBalanceTarget(null)} className="h-9 rounded-md border border-black/10 px-3 text-sm dark:border-white/10">取消</button>
              <button type="submit" disabled={savingId === balanceTarget.id} className="h-9 rounded-md bg-amber-500 px-4 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">确认</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
