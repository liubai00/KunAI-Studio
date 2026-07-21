import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface TurnstileWidgetProps {
  siteKey: string
  refreshKey: number
  onToken: (token: string) => void
}

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    let timer = 0
    const fail = () => {
      window.clearTimeout(timer)
      document.querySelector<HTMLScriptElement>('script[data-kunai-studio-turnstile]')?.remove()
      scriptPromise = null
      reject(new Error('人机验证加载失败'))
    }
    const loaded = () => {
      window.clearTimeout(timer)
      if (!window.turnstile) {
        fail()
        return
      }
      resolve()
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-kunai-studio-turnstile]')
    if (existing) {
      existing.addEventListener('load', loaded, { once: true })
      existing.addEventListener('error', fail, { once: true })
      timer = window.setTimeout(fail, 10000)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.kunaiStudioTurnstile = 'true'
    script.onload = loaded
    script.onerror = fail
    timer = window.setTimeout(fail, 10000)
    document.head.appendChild(script)
  })
  return scriptPromise
}

export default function TurnstileWidget(props: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    let disposed = false
    let widgetId = ''
    setError(false)
    props.onToken('')

    void loadTurnstile().then(() => {
      if (disposed || !containerRef.current || !window.turnstile) return
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: props.siteKey,
        theme: 'auto',
        size: 'flexible',
        callback: (token: string) => props.onToken(token),
        'expired-callback': () => props.onToken(''),
        'error-callback': () => props.onToken(''),
      })
    }).catch(() => {
      if (disposed) return
      props.onToken('')
      setError(true)
    })

    return () => {
      disposed = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [attempt, props.refreshKey, props.siteKey])

  if (error) {
    return (
      <button type="button" onClick={() => setAttempt((value) => value + 1)} className="flex min-h-[65px] w-full items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
        <RefreshCw className="h-4 w-4" />人机验证加载失败，点击重试
      </button>
    )
  }

  return <div ref={containerRef} className="min-h-[65px] w-full" />
}
