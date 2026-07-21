export function getPlatformCsrfToken() {
  if (typeof document === 'undefined') return ''
  const cookies = Object.fromEntries(document.cookie.split(';').flatMap((part) => {
    const idx = part.indexOf('=')
    if (idx < 1) return []
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    try {
      return [[key, decodeURIComponent(value)]]
    } catch {
      return [[key, value]]
    }
  }))
  return cookies['__Host-kunai_studio_csrf']
    || cookies.kunai_studio_csrf
    || cookies['__Host-image_studio_csrf']
    || cookies.image_studio_csrf
    || ''
}

export function createPlatformRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}
