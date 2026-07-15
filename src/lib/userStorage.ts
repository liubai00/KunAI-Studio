const ACTIVE_USER_KEY = 'image-studio-active-user'

let activeUser = readActiveUser()
const memoryStorage = new Map<string, string>()

function readActiveUser() {
  try {
    return window.sessionStorage.getItem(ACTIVE_USER_KEY) || 'local'
  } catch {
    return 'local'
  }
}

export function setActiveStorageUser(userId: string) {
  activeUser = userId || 'local'
  try {
    window.sessionStorage.setItem(ACTIVE_USER_KEY, activeUser)
  } catch {
    // 浏览器禁用存储时仍允许本次会话继续使用内存状态。
  }
}

export function getActiveStorageUser() {
  return activeUser
}

export function clearActiveStorageUser() {
  activeUser = 'local'
  try {
    window.sessionStorage.removeItem(ACTIVE_USER_KEY)
  } catch {
    // 同上。
  }
}

export function createUserScopedStorage(): Storage {
  const getKey = (key: string) => activeUser === 'local' ? key : `${key}:user:${activeUser}`
  if (typeof window === 'undefined') {
    return {
      get length() {
        return memoryStorage.size
      },
      clear: () => memoryStorage.clear(),
      getItem: (key) => memoryStorage.get(getKey(key)) ?? null,
      key: (index) => Array.from(memoryStorage.keys())[index] ?? null,
      removeItem: (key) => memoryStorage.delete(getKey(key)),
      setItem: (key, value) => memoryStorage.set(getKey(key), value),
    }
  }
  return {
    get length() {
      return window.localStorage.length
    },
    clear: () => {
      if (activeUser === 'local') {
        window.localStorage.clear()
        return
      }
      const suffix = `:user:${activeUser}`
      const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      for (const key of keys) {
        if (key?.endsWith(suffix)) window.localStorage.removeItem(key)
      }
    },
    getItem: (key) => window.localStorage.getItem(getKey(key)),
    key: (index) => window.localStorage.key(index),
    removeItem: (key) => window.localStorage.removeItem(getKey(key)),
    setItem: (key, value) => window.localStorage.setItem(getKey(key), value),
  }
}

export function getScopedDatabaseName(baseName: string) {
  return activeUser === 'local' ? baseName : `${baseName}-user-${activeUser}`
}
