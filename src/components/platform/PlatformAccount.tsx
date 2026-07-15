import { ChevronDown, LogOut, ShieldCheck, Users, Wallet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isPlatformModeEnabled } from '../../lib/platformMode'
import { formatPlatformQuota } from '../../lib/platformCurrency'
import { usePlatformStore } from '../../platformStore'
import BillingModal from './BillingModal'
import AdminUsersModal from './AdminUsersModal'

export default function PlatformAccount() {
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const logout = usePlatformStore((s) => s.logout)
  const [open, setOpen] = useState(false)
  const [showBilling, setShowBilling] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const closeBilling = useCallback(() => setShowBilling(false), [])
  const closeUsers = useCallback(() => setShowUsers(false), [])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  if (!isPlatformModeEnabled() || !user) return null

  const balance = formatPlatformQuota(Math.max(0, user.quota - (user.reserved_quota || 0)), status)
  const initials = (user.email || user.username || 'U').slice(0, 1).toUpperCase()

  return (
    <>
      <div ref={rootRef} className="relative ml-1">
        <button
          ref={accountButtonRef}
          type="button"
          onClick={() => {
            setOpen((value) => !value)
            if (!open) void refreshSession().catch(() => undefined)
          }}
          className="flex h-9 items-center gap-2 rounded-md border border-black/[0.07] bg-white px-1.5 pr-2 text-left shadow-sm transition-colors hover:border-amber-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-amber-500/40"
          aria-expanded={open}
          aria-label="账户菜单"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-amber-500 text-[11px] font-bold text-white">{initials}</span>
          <span className="hidden max-w-32 truncate font-mono text-xs font-semibold text-[#49443e] md:inline dark:text-gray-200">{balance}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-[#8d877f] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-lg border border-black/[0.07] bg-white shadow-[0_18px_50px_rgba(36,30,24,0.14)] animate-dropdown-down dark:border-white/10 dark:bg-[#1d1c1a]">
            <div className="border-b border-black/[0.06] px-4 py-3 dark:border-white/10">
              <div className="truncate text-sm font-medium text-[#302d29] dark:text-white">{user.email}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-[#858079] dark:text-gray-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />已验证账户
                {user.role >= 10 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">管理员</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setShowBilling(true)
              }}
              className="flex w-full items-center justify-between px-4 py-3 text-sm text-[#4a4540] hover:bg-[#faf8f5] dark:text-gray-200 dark:hover:bg-white/[0.05]"
            >
              <span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-amber-600" />账户与账单</span>
              <span className="max-w-28 truncate font-mono text-xs font-semibold">{balance}</span>
            </button>
            {user.image_studio_capabilities.admin && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setShowUsers(true)
                }}
                className="flex w-full items-center gap-2 border-t border-black/[0.06] px-4 py-3 text-sm text-[#4a4540] hover:bg-[#faf8f5] dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/[0.05]"
              >
                <Users className="h-4 w-4 text-sky-600" />用户与权限
              </button>
            )}
            <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 border-t border-black/[0.06] px-4 py-3 text-sm text-red-600 hover:bg-red-50 dark:border-white/10 dark:text-red-400 dark:hover:bg-red-500/10">
              <LogOut className="h-4 w-4" />退出登录
            </button>
          </div>
        )}
      </div>
      {showBilling && createPortal(<BillingModal onClose={closeBilling} returnFocusRef={accountButtonRef} />, document.body)}
      {showUsers && createPortal(<AdminUsersModal onClose={closeUsers} returnFocusRef={accountButtonRef} />, document.body)}
    </>
  )
}
