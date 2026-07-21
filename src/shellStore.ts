import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isMainShellView, normalizeShellView } from './lib/shellNavigation'
import type { MainShellView, ShellView } from './types'

interface ShellState {
  view: ShellView
  lastMainView: MainShellView
  sidebarCollapsed: boolean
  mobileMoreOpen: boolean
  setView: (view: ShellView) => void
  returnToMainView: () => void
  toggleSidebar: () => void
  setMobileMoreOpen: (open: boolean) => void
}

export const useShellStore = create<ShellState>()(
  persist(
    (set, get) => ({
      view: 'create',
      lastMainView: 'create',
      sidebarCollapsed: false,
      mobileMoreOpen: false,
      setView: (view) => set({
        view,
        mobileMoreOpen: false,
        ...(isMainShellView(view) ? { lastMainView: view } : {}),
      }),
      returnToMainView: () => set({ view: get().lastMainView, mobileMoreOpen: false }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileMoreOpen: (mobileMoreOpen) => set({ mobileMoreOpen }),
    }),
    {
      name: 'kunai-shell',
      partialize: (state) => ({
        view: isMainShellView(state.view) ? state.view : state.lastMainView,
        lastMainView: state.lastMainView,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<ShellState>
        const view = normalizeShellView(saved.view)
        return {
          ...current,
          ...saved,
          view,
          lastMainView: normalizeShellView(saved.lastMainView || view),
          mobileMoreOpen: false,
        }
      },
    },
  ),
)
