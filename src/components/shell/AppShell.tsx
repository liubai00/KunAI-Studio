import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Bot, ChevronLeft, ChevronRight, Images, LayoutDashboard, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Sparkles, Sun, Wallet, X } from 'lucide-react'
import { hasPlatformCapability, usePlatformStore } from '../../platformStore'
import { toggleTheme, useResolvedTheme } from '../../lib/theme'
import { formatPlatformQuota } from '../../lib/platformCurrency'
import { isPlatformModeEnabled } from '../../lib/platformMode'
import { canAccessShellView } from '../../lib/shellNavigation'
import { useStore } from '../../store'
import { useShellStore } from '../../shellStore'
import type { ShellView } from '../../types'
import { BrandLockup, BrandMark } from '../Brand'

const VIEW_META: Record<ShellView, { title: string; eyebrow: string }> = {
  create: { title: '星图创作', eyebrow: 'Create' },
  agent: { title: '智能 Agent', eyebrow: 'Agent' },
  library: { title: '资产库', eyebrow: 'Library' },
  account: { title: '账户与账单', eyebrow: 'Billing' },
  settings: { title: '工作区设置', eyebrow: 'Preferences' },
  admin: { title: '管理中心', eyebrow: 'Administration' },
}

const MAIN_NAV = [
  { view: 'create' as const, label: '创作', icon: Sparkles },
  { view: 'agent' as const, label: 'Agent', icon: Bot },
  { view: 'library' as const, label: '资产库', icon: Images },
]

export default function AppShell({ children }: { children: ReactNode }) {
  const view = useShellStore((s) => s.view)
  const setView = useShellStore((s) => s.setView)
  const returnToMainView = useShellStore((s) => s.returnToMainView)
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useShellStore((s) => s.toggleSidebar)
  const mobileMoreOpen = useShellStore((s) => s.mobileMoreOpen)
  const setMobileMoreOpen = useShellStore((s) => s.setMobileMoreOpen)
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const logout = usePlatformStore((s) => s.logout)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const resolvedTheme = useResolvedTheme()
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountRootRef = useRef<HTMLDivElement>(null)
  const shellAccess = {
    authenticated: !isPlatformModeEnabled() || Boolean(user),
    agent: !isPlatformModeEnabled() || hasPlatformCapability(user, status, 'agent'),
    admin: Boolean(user?.image_studio_capabilities.admin),
  }
  const agentAllowed = shellAccess.agent
  const adminAllowed = Boolean(user?.image_studio_capabilities.admin)
  const initials = (user?.display_name || user?.email || user?.username || 'K').slice(0, 1).toUpperCase()
  const balance = user ? formatPlatformQuota(Math.max(0, user.quota - (user.reserved_quota || 0)), status) : ''

  useEffect(() => {
    if (!accountMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!accountRootRef.current?.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [accountMenuOpen])

  const navigate = (nextView: ShellView) => {
    if (!canAccessShellView(nextView, shellAccess)) return
    if (nextView === 'settings') setShowSettings(false)
    setView(nextView)
  }

  const NavButton = ({ item }: { item: typeof MAIN_NAV[number] }) => {
    const Icon = item.icon
    const active = view === item.view
    const disabled = item.view === 'agent' && !agentAllowed
    return (
      <button
        type="button"
        onClick={() => navigate(item.view)}
        disabled={disabled}
        className={`kunai-nav-item ${active ? 'is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        title={sidebarCollapsed ? item.label : undefined}
      >
        <Icon className="h-[19px] w-[19px] shrink-0" />
        {!sidebarCollapsed && <span>{item.label}</span>}
      </button>
    )
  }

  return (
    <div data-platform-shell data-shell-view={view} className={`kunai-shell ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <aside className="kunai-sidebar">
        <div className="flex h-[72px] items-center justify-between px-4">
          <BrandLockup compact={sidebarCollapsed} />
          {!sidebarCollapsed && (
            <button type="button" onClick={toggleSidebar} className="kunai-icon-button" aria-label="折叠侧栏">
              <PanelLeftClose className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
        {sidebarCollapsed && (
          <button type="button" onClick={toggleSidebar} className="kunai-icon-button mx-auto mb-2" aria-label="展开侧栏">
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          </button>
        )}
        <nav className="flex flex-1 flex-col gap-1.5 px-3 py-3" aria-label="主导航">
          <p className={`mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3 ${sidebarCollapsed ? 'sr-only' : ''}`}>Workspace</p>
          {MAIN_NAV.map((item) => <NavButton key={item.view} item={item} />)}
          <div className="my-3 h-px bg-line" />
          <button type="button" onClick={() => navigate('account')} className={`kunai-nav-item ${view === 'account' ? 'is-active' : ''}`} aria-label="账户与账单" title={sidebarCollapsed ? '账户与账单' : undefined}>
            <Wallet className="h-[19px] w-[19px] shrink-0" />{!sidebarCollapsed && <span>账户与账单</span>}
          </button>
          <button type="button" onClick={() => navigate('settings')} className={`kunai-nav-item ${view === 'settings' ? 'is-active' : ''}`} aria-label="设置" title={sidebarCollapsed ? '设置' : undefined}>
            <Settings className="h-[19px] w-[19px] shrink-0" />{!sidebarCollapsed && <span>设置</span>}
          </button>
          {adminAllowed && (
            <button type="button" onClick={() => navigate('admin')} className={`kunai-nav-item ${view === 'admin' ? 'is-active' : ''}`} aria-label="管理中心" title={sidebarCollapsed ? '管理中心' : undefined}>
              <ShieldCheck className="h-[19px] w-[19px] shrink-0" />{!sidebarCollapsed && <span>管理中心</span>}
            </button>
          )}
        </nav>
        <div className="p-3">
          <div className={`kunai-status-card ${sidebarCollapsed ? 'justify-center p-2' : ''}`}>
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent-ink">
              <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-surface" />
              <Sparkles className="h-4 w-4" />
            </span>
            {!sidebarCollapsed && <div className="min-w-0"><div className="text-xs font-medium text-ink">生成服务正常</div><div className="mt-0.5 text-[10px] text-ink-3">1K · 2K · 4K 已就绪</div></div>}
          </div>
        </div>
      </aside>

      <div className="kunai-main-column">
        <header className="kunai-topbar">
          <div className="flex min-w-0 items-center gap-3">
            {!['create', 'agent', 'library'].includes(view) && (
              <button type="button" onClick={returnToMainView} className="kunai-icon-button" aria-label="返回工作区"><ChevronLeft className="h-4 w-4" /></button>
            )}
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-ink">{VIEW_META[view].eyebrow}</div>
              <h1 className="truncate font-display text-[18px] font-semibold tracking-[-0.02em] text-ink">{VIEW_META[view].title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {user && (
              <button type="button" onClick={() => navigate('account')} className="kunai-usage-pill" aria-label="查看账户用量">
                <span className="hidden text-ink-3 sm:inline">余额</span><span className="font-mono font-semibold text-ink">{balance}</span>
              </button>
            )}
            <button type="button" onClick={toggleTheme} className="kunai-icon-button" aria-label={resolvedTheme === 'dark' ? '切换浅色主题' : '切换深色主题'}>
              {resolvedTheme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>
            {user && (
              <div ref={accountRootRef} className="relative">
                <button type="button" onClick={() => { setAccountMenuOpen((open) => !open); void refreshSession().catch(() => undefined) }} className="kunai-avatar" aria-expanded={accountMenuOpen}>{initials}</button>
                {accountMenuOpen && (
                  <div className="kunai-account-menu">
                    <div className="border-b border-line px-4 py-3"><div className="truncate text-sm font-medium text-ink">{user.email}</div><div className="mt-1 text-xs text-ink-3">{adminAllowed ? '管理员账户' : '已验证账户'}</div></div>
                    <button type="button" onClick={() => { setAccountMenuOpen(false); navigate('account') }}><Wallet className="h-4 w-4" />账户与账单<ChevronRight className="ml-auto h-4 w-4" /></button>
                    {adminAllowed && <button type="button" onClick={() => { setAccountMenuOpen(false); navigate('admin') }}><LayoutDashboard className="h-4 w-4" />管理中心<ChevronRight className="ml-auto h-4 w-4" /></button>}
                    <button type="button" className="text-red-400" onClick={() => void logout()}><LogOut className="h-4 w-4" />退出登录</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="kunai-content">{children}</div>
      </div>

      <nav className="kunai-mobile-nav" aria-label="移动端主导航">
        {MAIN_NAV.map((item) => {
          const Icon = item.icon
          const active = view === item.view
          return <button key={item.view} type="button" onClick={() => navigate(item.view)} disabled={item.view === 'agent' && !agentAllowed} className={active ? 'is-active' : ''}><Icon className="h-5 w-5" /><span>{item.label}</span></button>
        })}
        <button type="button" onClick={() => setMobileMoreOpen(true)} className={['account', 'settings', 'admin'].includes(view) ? 'is-active' : ''}><Menu className="h-5 w-5" /><span>更多</span></button>
      </nav>

      {mobileMoreOpen && (
        <div className="kunai-mobile-sheet" onClick={(event) => event.target === event.currentTarget && setMobileMoreOpen(false)}>
          <section>
            <header><BrandLockup /><button type="button" onClick={() => setMobileMoreOpen(false)} className="kunai-icon-button" aria-label="关闭"><X className="h-5 w-5" /></button></header>
            <div className="grid gap-2 p-4">
              <button type="button" onClick={() => navigate('account')}><Wallet className="h-5 w-5" />账户与账单</button>
              <button type="button" onClick={() => navigate('settings')}><Settings className="h-5 w-5" />工作区设置</button>
              {adminAllowed && <button type="button" onClick={() => navigate('admin')}><ShieldCheck className="h-5 w-5" />管理中心</button>}
              <button type="button" onClick={toggleTheme}>{resolvedTheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}{resolvedTheme === 'dark' ? '切换浅色主题' : '切换深色主题'}</button>
              {user && <button type="button" className="text-red-400" onClick={() => void logout()}><LogOut className="h-5 w-5" />退出登录</button>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
