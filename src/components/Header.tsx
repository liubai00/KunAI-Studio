import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import HistoryModal from './HistoryModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { EditIcon, HelpCircleIcon, HistoryIcon, InstallIcon, MoonIcon, SettingsIcon, SunIcon } from './icons'
import PlatformAccount from './platform/PlatformAccount'
import { hasPlatformCapability, usePlatformStore } from '../platformStore'
import { isPlatformModeEnabled } from '../lib/platformMode'
import { toggleTheme, useResolvedTheme } from '../lib/theme'

function BrandMark({ className = 'h-[31px] w-[31px]', apClassName = 'h-[11px] w-[11px]' }: { className?: string; apClassName?: string }) {
  return (
    <span className={`gi-brandmark ${className}`}>
      <span className={`gi-aperture ${apClassName}`} />
    </span>
  )
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const agentConversations = useStore((s) => s.agentConversations)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const activeConversation = agentConversations.find((item) => item.id === activeAgentConversationId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = appMode === 'gallery' && Boolean(activeFavoriteCollectionId)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const [hintVisible, setHintVisible] = useState(false)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const createConversation = useStore((s) => s.createAgentConversation)
  const platformUser = usePlatformStore((s) => s.user)
  const platformStatus = usePlatformStore((s) => s.status)
  const agentAllowed = !isPlatformModeEnabled() || hasPlatformCapability(platformUser, platformStatus, 'agent')
  const resolvedTheme = useResolvedTheme()
  const themeTooltip = useTooltip()

  useEffect(() => {
    if (appMode === 'agent') {
      setScrollDirection('up')
      return
    }

    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          if (currentScrollY < 20) {
            setScrollDirection('up')
          } else if (currentScrollY > lastScrollY + 10) {
            setScrollDirection('down')
          } else if (currentScrollY < lastScrollY - 10) {
            setScrollDirection('up')
          }
          lastScrollY = currentScrollY
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [appMode])

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => {
        setHintVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (installPrompt) {
      const promptEvent = installPrompt
      setInstallPrompt(null)

      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isIos) {
        setConfirmDialog({
          title: '安装为应用',
          message: '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      } else {
        setConfirmDialog({
          title: '安装为应用',
          message: '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      }
    }
  }

  return (
    <>
      <header data-no-drag-select className={`safe-area-top fixed top-0 left-0 right-0 z-40 bg-[var(--hdr-bg)] backdrop-blur-xl border-b border-line transition-transform duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}>
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative gap-2">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-3">
            <h1 className="inline-flex min-w-0 items-center relative">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-display font-bold tracking-tight text-ink sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <span className="hidden items-center gap-[11px] sm:inline-flex"><BrandMark /><b className="font-display text-[16.5px] font-semibold tracking-[-0.012em] text-ink whitespace-nowrap">GPT Image Playground</b></span>
                </>
              ) : (
                <span className="inline-flex items-center gap-[11px]"><BrandMark /><b className="font-display text-[16.5px] font-semibold tracking-[-0.012em] text-ink whitespace-nowrap hidden xs:inline sm:inline">GPT Image Playground</b></span>
              )}
              {hasUpdate && latestRelease && (
                <a
                  href={latestRelease.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={dismiss}
                  className="absolute -right-1 -top-1 translate-x-full -translate-y-1/4 px-1 py-0.5 rounded-[4px] border border-red-500/30 text-[9px] font-black bg-red-500 text-white hover:bg-red-600 transition-all animate-fade-in leading-none shadow-sm"
                  title={`新版本 ${latestRelease.tag}`}
                >
                  NEW
                </a>
              )}
            </h1>
            {appMode === 'agent' && <div className="hidden sm:flex items-center gap-0.5 relative pl-1.5 border-l border-line">
              <button
                ref={historyButtonRef}
                type="button"
                onClick={() => setShowHistoryModal((visible) => !visible)}
                className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface2 hover:text-ink transition-colors"
                title="历史任务"
              >
                <HistoryIcon className="w-[19px] h-[19px]" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppMode('agent')
                  createConversation()
                }}
                className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface2 hover:text-ink transition-colors"
                title="新对话"
              >
                <EditIcon className="w-[19px] h-[19px]" />
              </button>
              {showHistoryModal && (
                <HistoryModal onClose={() => setShowHistoryModal(false)} ignoreOutsideClickRef={historyButtonRef} />
              )}
            </div>}
          </div>
          {appMode === 'agent' && activeConversation && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden sm:flex max-w-[30%]">
              <button
                type="button"
                onClick={() => {
                  setShowHistoryModal(true)
                  // Use setTimeout to ensure HistoryModal is mounted before setting editing id
                  setTimeout(() => {
                    useStore.getState().setAgentEditingConversationId(activeConversation.id)
                  }, 0)
                }}
                className="text-sm font-semibold text-ink-2 truncate hover:bg-surface2 hover:text-ink px-2 py-1 rounded-md transition-colors"
              >
                {activeConversation.title || 'Agent'}
              </button>
            </div>
          )}
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-ink-2" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          <div className="hidden sm:flex items-center gap-[3px] rounded-[12px] border border-line bg-surface2 p-[3px] mr-1">
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-[18px] py-1.5 rounded-[9px] text-[13px] transition-colors ${appMode === 'gallery' ? 'bg-surface text-ink shadow-card font-semibold' : 'font-medium text-ink-2 hover:text-ink'}`}
            >
              画廊
            </button>
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              disabled={!agentAllowed}
              className={`px-[18px] py-1.5 rounded-[9px] text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${appMode === 'agent' ? 'bg-surface text-ink shadow-card font-semibold' : 'font-medium text-ink-2 hover:text-ink'}`}
            >
              Agent
            </button>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <div
              className="relative"
              {...themeTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  toggleTheme()
                }}
                className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface2 hover:text-ink transition-colors"
                aria-label="切换主题"
              >
                {resolvedTheme === 'dark' ? <SunIcon className="w-[19px] h-[19px]" /> : <MoonIcon className="w-[19px] h-[19px]" />}
              </button>
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                {resolvedTheme === 'dark' ? '浅色模式' : '深色模式'}
              </ViewportTooltip>
            </div>
            {!isPwaInstalled && (
              <div
                className="relative"
                {...installTooltip.handlers}
              >
                <button
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface2 hover:text-ink transition-colors"
                  aria-label="安装为应用"
                >
                  <InstallIcon className="w-[19px] h-[19px]" />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface2 hover:text-ink transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-[19px] h-[19px]" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface2 hover:text-ink transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-[19px] h-[19px]" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
            <PlatformAccount />
          </div>
        </div>
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}>
          <div className="grid grid-cols-2 gap-[3px] rounded-[12px] border border-line bg-surface2 p-[3px] mx-2">
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-4 py-1.5 rounded-[9px] text-[13px] transition-colors ${appMode === 'gallery' ? 'bg-surface text-ink shadow-card font-semibold' : 'font-medium text-ink-2 hover:text-ink'}`}
            >
              画廊
            </button>
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              disabled={!agentAllowed}
              className={`px-4 py-1.5 rounded-[9px] text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${appMode === 'agent' ? 'bg-surface text-ink shadow-card font-semibold' : 'font-medium text-ink-2 hover:text-ink'}`}
            >
              Agent
            </button>
          </div>
        </div>
      </header>
      
      {/* Hint for sliding down */}
      <div className={`fixed top-0 left-0 right-0 z-30 flex justify-center pointer-events-none transition-all duration-300 ease-in-out sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}>
        <div className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-b-xl shadow-lg">
          下拉展示顶栏
        </div>
      </div>

      <div className={`safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
        <div className="safe-header-inner" />
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}>
          <div className="p-1">
            <div className="py-1.5 text-sm">占位</div>
          </div>
        </div>
      </div>
      {showHelp && <HelpModal appMode={appMode} isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
