import { lazy, Suspense, useEffect, useRef } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { activateFirstImportedProfile, buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { isDefaultConfigOnlyEnabled, mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import type { AppSettings } from './types'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { createPlatformSettings, isPlatformModeEnabled } from './lib/platformMode'
import { recheckPlatformPayment } from './lib/platformCheckout'
import { hasPlatformCapability, usePlatformStore } from './platformStore'
import { appModeToShellView, canAccessShellView, shellViewToAppMode } from './lib/shellNavigation'
import { useShellStore } from './shellStore'
import AppShell from './components/shell/AppShell'
import CreateWorkspace from './components/shell/CreateWorkspace'
import LibraryWorkspace from './components/shell/LibraryWorkspace'
import AccountWorkspace from './components/shell/AccountWorkspace'
import SettingsWorkspace from './components/shell/SettingsWorkspace'
import AdminCenter from './components/shell/AdminCenter'

let customProviderConfigUrlImportStarted = false
const AgentWorkspace = lazy(() => import('./components/AgentWorkspace'))
const DetailModal = lazy(() => import('./components/DetailModal'))
const FavoriteCollectionPickerModal = lazy(() => import('./components/favorites/FavoriteCollectionPickerModal')
  .then((module) => ({ default: module.FavoriteCollectionPickerModal })))
const Lightbox = lazy(() => import('./components/Lightbox'))
const ManageCollectionsModal = lazy(() => import('./components/favorites/ManageCollectionsModal')
  .then((module) => ({ default: module.ManageCollectionsModal })))
const MaskEditorModal = lazy(() => import('./components/MaskEditorModal'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const shellView = useShellStore((s) => s.view)
  const setShellView = useShellStore((s) => s.setView)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const favoritePickerTaskIds = useStore((s) => s.favoritePickerTaskIds)
  const isManageCollectionsModalOpen = useStore((s) => s.isManageCollectionsModalOpen)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  const showSettings = useStore((s) => s.showSettings)
  const showToast = useStore((s) => s.showToast)
  const runningTaskCount = useStore((s) => s.tasks.filter((task) => task.status === 'running').length)
  const refreshPlatformSession = usePlatformStore((s) => s.refreshSession)
  const platformPhase = usePlatformStore((s) => s.phase)
  const platformUser = usePlatformStore((s) => s.user)
  const platformStatus = usePlatformStore((s) => s.status)
  const previousRunningTaskCount = useRef(runningTaskCount)
  const paymentReturnHandled = useRef(false)
  const shellSyncStarted = useRef(false)
  const shellAccess = {
    authenticated: !isPlatformModeEnabled() || Boolean(platformUser),
    agent: !isPlatformModeEnabled() || hasPlatformCapability(platformUser, platformStatus, 'agent'),
    admin: Boolean(platformUser?.image_studio_capabilities.admin),
  }
  const activeShellView = canAccessShellView(shellView, shellAccess) ? shellView : 'create'
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const defaultConfigOnly = isDefaultConfigOnlyEnabled()

    const applyUrlSettings = (baseSettings: Partial<AppSettings>) => {
      const nextSettings = buildSettingsFromUrlParams(baseSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : baseSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return

      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    if (isPlatformModeEnabled()) {
      setSettings(createPlatformSettings(useStore.getState().settings))
      clearAppliedUrlSettings()
      initStore()
      return
    }

    if (customProviderConfigUrl && defaultConfigOnly && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          const state = useStore.getState()
          const baseSettings = importedSettings
            ? activateFirstImportedProfile(mergeImportedSettings(state.settings, importedSettings), importedSettings)
            : state.settings
          state.setSettings(applyUrlSettings(baseSettings))
          clearAppliedUrlSettings()
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
          const state = useStore.getState()
          state.setSettings(applyUrlSettings(state.settings))
          clearAppliedUrlSettings()
        })

      initStore()
      return
    }

    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    clearAppliedUrlSettings()

    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    initStore()
  }, [setSettings])

  useEffect(() => {
    if (isPlatformModeEnabled() && runningTaskCount < previousRunningTaskCount.current) {
      void refreshPlatformSession().catch(() => undefined)
    }
    previousRunningTaskCount.current = runningTaskCount
  }, [refreshPlatformSession, runningTaskCount])

  useEffect(() => {
    if (!isPlatformModeEnabled() || platformPhase !== 'authenticated' || paymentReturnHandled.current) return
    const params = new URLSearchParams(window.location.search)
    const intentId = params.get('payment_intent') || ''
    if (!intentId) return
    paymentReturnHandled.current = true
    const clearPaymentParams = () => {
      for (const key of ['payment_intent', 'pid', 'trade_no', 'out_trade_no', 'api_trade_no', 'type', 'trade_status', 'addtime', 'endtime', 'money', 'param', 'buyer', 'timestamp', 'sign', 'sign_type']) params.delete(key)
      const search = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(intentId)) {
      clearPaymentParams()
      showToast('支付回跳参数无效', 'error')
      return
    }
    void recheckPlatformPayment(intentId)
      .then(async (result) => {
        if (!result.paid) {
          showToast('支付结果仍在确认中，请稍后查看账户余额', 'info')
          return
        }
        await refreshPlatformSession()
        showToast('支付成功，权益已到账', 'success')
      })
      .catch((err) => showToast(err instanceof Error ? err.message : String(err), 'error'))
      .finally(clearPaymentParams)
  }, [platformPhase, refreshPlatformSession, showToast])

  useEffect(() => {
    if (isPlatformModeEnabled() && appMode === 'agent' && !hasPlatformCapability(platformUser, platformStatus, 'agent')) {
      setAppMode('gallery')
      setShellView('create')
    }
  }, [appMode, platformStatus, platformUser, setAppMode, setShellView])

  useEffect(() => {
    if (activeShellView !== shellView) {
      setShellView(activeShellView)
      return
    }
    if (!shellSyncStarted.current) {
      shellSyncStarted.current = true
      let hasPersistedShell = false
      try {
        hasPersistedShell = Boolean(window.localStorage.getItem('kunai-shell'))
      } catch {
        // localStorage 不可用时直接采用新工作区默认值。
      }
      if (!hasPersistedShell) {
        const legacyView = appModeToShellView(appMode)
        if (shellView !== legacyView) {
          setShellView(legacyView)
          return
        }
      }
    }
    const nextMode = shellViewToAppMode(activeShellView)
    if (appMode !== nextMode) setAppMode(nextMode)
  }, [activeShellView, appMode, setAppMode, setShellView, shellView])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const workspace = activeShellView === 'create'
    ? <CreateWorkspace />
    : activeShellView === 'agent'
      ? <><Suspense fallback={null}><AgentWorkspace /></Suspense><InputBar /></>
      : activeShellView === 'library'
        ? <LibraryWorkspace />
        : activeShellView === 'account'
          ? <AccountWorkspace />
          : activeShellView === 'settings'
            ? <SettingsWorkspace />
            : <AdminCenter />

  return (
    <AppShell>
      {workspace}
      {detailTaskId && <Suspense fallback={null}><DetailModal /></Suspense>}
      {lightboxImageId && <Suspense fallback={null}><Lightbox /></Suspense>}
      {showSettings && <Suspense fallback={null}><SettingsModal /></Suspense>}
      <ConfirmDialog />
      <SupportPromptModal />
      {Boolean(favoritePickerTaskIds?.length) && <Suspense fallback={null}><FavoriteCollectionPickerModal /></Suspense>}
      {isManageCollectionsModalOpen && <Suspense fallback={null}><ManageCollectionsModal /></Suspense>}
      <Toast />
      {maskEditorImageId && <Suspense fallback={null}><MaskEditorModal /></Suspense>}
      <ImageContextMenu />
    </AppShell>
  )
}
