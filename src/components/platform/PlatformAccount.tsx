import { Bot, ChevronDown, LogOut, ShieldCheck, Store, Ticket, Users, Wallet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isPlatformModeEnabled } from '../../lib/platformMode'
import { formatPlatformQuota } from '../../lib/platformCurrency'
import { usePlatformStore } from '../../platformStore'
import BillingModal from './BillingModal'
import AdminUsersModal from './AdminUsersModal'
import AdminProductsModal from './AdminProductsModal'
import AdminRedemptionModal from './AdminRedemptionModal'
import AdminAgentModelsModal from './AdminAgentModelsModal'

export default function PlatformAccount() {
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const logout = usePlatformStore((s) => s.logout)
  const [open, setOpen] = useState(false)
  const [showBilling, setShowBilling] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const [showProducts, setShowProducts] = useState(false)
  const [showRedemption, setShowRedemption] = useState(false)
  const [showAgentModels, setShowAgentModels] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const closeBilling = useCallback(() => setShowBilling(false), [])
  const closeUsers = useCallback(() => setShowUsers(false), [])
  const closeProducts = useCallback(() => setShowProducts(false), [])
  const closeRedemption = useCallback(() => setShowRedemption(false), [])
  const closeAgentModels = useCallback(() => setShowAgentModels(false), [])

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
          className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface2 px-1.5 pr-2 text-left shadow-card transition-colors hover:border-accent"
          aria-expanded={open}
          aria-label="账户菜单"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-accent text-[11px] font-bold text-white">{initials}</span>
          <span className="hidden max-w-32 truncate font-mono text-xs font-semibold text-ink md:inline">{balance}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-line2 bg-surface shadow-lift animate-dropdown-down">
            <div className="border-b border-line px-4 py-3">
              <div className="truncate text-sm font-medium text-ink">{user.email}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />已验证账户
                {user.role >= 10 && <span className="rounded-[7px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">管理员</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setShowBilling(true)
              }}
              className="flex w-full items-center justify-between px-4 py-3 text-sm text-ink-2 hover:bg-surface2"
            >
              <span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-accent-ink" />账户与账单</span>
              <span className="max-w-28 truncate font-mono text-xs font-semibold">{balance}</span>
            </button>
            {user.image_studio_capabilities.admin && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setShowUsers(true)
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-sm text-ink-2 hover:bg-surface2"
                >
                  <Users className="h-4 w-4 text-info" />用户与权限
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setShowProducts(true)
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-sm text-ink-2 hover:bg-surface2"
                >
                  <Store className="h-4 w-4 text-accent" />商品与定价
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setShowAgentModels(true)
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-sm text-ink-2 hover:bg-surface2"
                >
                  <Bot className="h-4 w-4 text-info" />Agent 模型与定价
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setShowRedemption(true)
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-sm text-ink-2 hover:bg-surface2"
                >
                  <Ticket className="h-4 w-4 text-accent" />兑换码
                </button>
              </>
            )}
            <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-sm text-red-500 hover:bg-red-500/10">
              <LogOut className="h-4 w-4" />退出登录
            </button>
          </div>
        )}
      </div>
      {showBilling && createPortal(<BillingModal onClose={closeBilling} returnFocusRef={accountButtonRef} />, document.body)}
      {showUsers && createPortal(<AdminUsersModal onClose={closeUsers} returnFocusRef={accountButtonRef} />, document.body)}
      {showProducts && createPortal(<AdminProductsModal onClose={closeProducts} returnFocusRef={accountButtonRef} />, document.body)}
      {showRedemption && createPortal(<AdminRedemptionModal onClose={closeRedemption} returnFocusRef={accountButtonRef} />, document.body)}
      {showAgentModels && createPortal(<AdminAgentModelsModal onClose={closeAgentModels} returnFocusRef={accountButtonRef} />, document.body)}
    </>
  )
}
