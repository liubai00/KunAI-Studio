import 'core-js/actual/array/at'
import { lazy, StrictMode, Suspense, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { isPlatformModeEnabled } from './lib/platformMode'
import { setActiveStorageUser } from './lib/userStorage'
import { PLATFORM_SESSION_EVENT_KEY, hasPlatformCapability, usePlatformStore } from './platformStore'
import AuthScreen from './components/auth/AuthScreen'

const App = lazy(() => import('./App'))
const platformModeEnabled = isPlatformModeEnabled()
const preferredDarkMode = window.matchMedia('(prefers-color-scheme: dark)')

const syncPreferredTheme = () => {
  const dark = !platformModeEnabled && preferredDarkMode.matches
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#09090b' : '#f7f7f5')
}

installMobileViewportGuards()
syncPreferredTheme()

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#f7f7f5] text-[#282724] flex items-center justify-center dark:bg-[#121211] dark:text-white">
      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        正在连接工作台
      </div>
    </div>
  )
}

function Root() {
  const platformMode = platformModeEnabled
  const phase = usePlatformStore((s) => s.phase)
  const bootstrap = usePlatformStore((s) => s.bootstrap)
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const logout = usePlatformStore((s) => s.logout)
  const refreshSession = usePlatformStore((s) => s.refreshSession)
  const bootstrapStarted = useRef(false)

  useEffect(() => {
    preferredDarkMode.addEventListener('change', syncPreferredTheme)
    return () => preferredDarkMode.removeEventListener('change', syncPreferredTheme)
  }, [])

  useEffect(() => {
    if (platformMode && !bootstrapStarted.current) {
      bootstrapStarted.current = true
      void bootstrap()
    }
  }, [bootstrap, platformMode])

  useEffect(() => {
    if (!platformMode || phase !== 'authenticated') return
    const refresh = () => void refreshSession().catch(() => undefined)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PLATFORM_SESSION_EVENT_KEY) window.location.reload()
    }
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', handleStorage)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', handleStorage)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [phase, platformMode, refreshSession])

  if (!platformMode) {
    setActiveStorageUser('local')
    return <Suspense fallback={<LoadingScreen />}><App /></Suspense>
  }
  if (phase === 'loading') return <LoadingScreen />
  if (phase === 'anonymous' || phase === 'error') return <AuthScreen />
  if (status?.image_studio?.relay_configured === false) {
    return (
      <main className="auth-shell min-h-screen flex items-center justify-center px-5">
        <section className="w-full max-w-md rounded-lg border border-black/[0.06] bg-white p-8 text-center shadow-[0_18px_60px_rgba(71,45,18,0.10)] dark:border-white/10 dark:bg-[#1c1b19]">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500 text-xl font-bold text-white">I</div>
          <h1 className="text-xl font-semibold text-[#282724] dark:text-white">生成服务待配置</h1>
          <p className="mt-2 text-sm text-[#77716a] dark:text-gray-400">第三方中转接口尚未接入，请联系管理员完成服务配置。</p>
          <button type="button" onClick={() => void logout()} className="mt-6 h-10 rounded-md border border-black/10 px-5 text-sm font-medium text-[#4a4540] hover:bg-black/[0.04] dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/[0.05]">退出登录</button>
        </section>
      </main>
    )
  }
  if (!hasPlatformCapability(user, status, 'generation')) {
    return (
      <main className="auth-shell min-h-screen flex items-center justify-center px-5">
        <section className="w-full max-w-md rounded-lg border border-black/[0.06] bg-white p-8 text-center shadow-[0_18px_60px_rgba(71,45,18,0.10)] dark:border-white/10 dark:bg-[#1c1b19]">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500 text-xl font-bold text-white">I</div>
          <h1 className="text-xl font-semibold text-[#282724] dark:text-white">账户暂未开通</h1>
          <p className="mt-2 text-sm text-[#77716a] dark:text-gray-400">请联系管理员开通图像工作台权限。</p>
          <button type="button" onClick={() => void logout()} className="mt-6 h-10 rounded-md border border-black/10 px-5 text-sm font-medium text-[#4a4540] hover:bg-black/[0.04] dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/[0.05]">退出登录</button>
        </section>
      </main>
    )
  }
  return <Suspense fallback={<LoadingScreen />}><App /></Suspense>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
