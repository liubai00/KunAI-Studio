const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

export function installMobileViewportGuards() {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (viewport) viewport.content = VIEWPORT_CONTENT
}
