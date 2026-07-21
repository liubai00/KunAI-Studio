import type { AppMode, MainShellView, ShellView } from '../types'

export interface ShellAccess {
  authenticated: boolean
  agent: boolean
  admin: boolean
}

export const MAIN_SHELL_VIEWS: MainShellView[] = ['create', 'agent', 'library']

export function normalizeShellView(value: unknown): MainShellView {
  return MAIN_SHELL_VIEWS.includes(value as MainShellView) ? value as MainShellView : 'create'
}

export function shellViewToAppMode(view: ShellView): AppMode {
  return view === 'agent' ? 'agent' : 'gallery'
}

export function appModeToShellView(mode: AppMode): MainShellView {
  return mode === 'agent' ? 'agent' : 'create'
}

export function isMainShellView(view: ShellView): view is MainShellView {
  return MAIN_SHELL_VIEWS.includes(view as MainShellView)
}

export function canAccessShellView(view: ShellView, access: ShellAccess) {
  if (view === 'account' || view === 'settings') return access.authenticated
  if (view === 'admin') return access.authenticated && access.admin
  if (view === 'agent') return access.agent
  return true
}
