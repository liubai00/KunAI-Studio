import { CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, ScanLine, X } from 'lucide-react'
import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { PlatformPaymentStatus, PlatformProductCheckout } from '../../lib/platformCheckout'
import { recheckPlatformPayment } from '../../lib/platformCheckout'

interface PaymentQrModalProps {
  checkout: PlatformProductCheckout
  productName: string
  onClose: () => void
  onPaid: (status: PlatformPaymentStatus) => Promise<void> | void
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function shouldPollPlatformPayment(visible: boolean, state: string, expiresAt: number, now = Date.now()) {
  return visible && state === 'pending' && expiresAt > now
}

export default function PaymentQrModal(props: PaymentQrModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const settledRef = useRef(false)
  const checkingRef = useRef(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [state, setState] = useState<'pending' | 'paid' | 'expired' | 'failed'>('pending')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('请使用手机扫码完成支付')

  useEffect(() => {
    let active = true
    QRCode.toDataURL(props.checkout.qr_content || '', {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then((url) => {
      if (active) setQrDataUrl(url)
    }).catch(() => {
      if (!active) return
      setState('failed')
      setMessage('支付二维码生成失败，请关闭后重新发起支付')
    })
    return () => { active = false }
  }, [props.checkout.qr_content])

  const checkPayment = useCallback(async (manual = false) => {
    if (checkingRef.current || settledRef.current || state !== 'pending') return
    if (Date.now() >= props.checkout.expires_at) {
      setState('expired')
      setMessage('订单已过期，请关闭后重新发起支付')
      return
    }
    checkingRef.current = true
    setChecking(true)
    if (manual) setMessage('正在向服务端核对支付结果…')
    try {
      const result = await recheckPlatformPayment(props.checkout.checkout_intent_id)
      if (result.status === 'expired') {
        setState('expired')
        setMessage('订单已过期，请关闭后重新发起支付')
        return
      }
      if (!result.paid) {
        if (manual) setMessage('暂未查询到付款，请完成扫码支付后再试')
        return
      }
      settledRef.current = true
      setState('paid')
      setMessage(props.checkout.kind === 'credits' ? `支付成功，${props.checkout.credits} 次生图额度已到账` : `支付成功，¥${props.checkout.amount.toFixed(2)} 对话余额已到账`)
      await props.onPaid(result)
    } catch (err) {
      if (manual) setMessage(err instanceof Error ? err.message : '暂时无法核对支付结果，请稍后重试')
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }, [props, state])

  useEffect(() => {
    if (state !== 'pending') return
    const tick = () => {
      if (!shouldPollPlatformPayment(document.visibilityState === 'visible', state, props.checkout.expires_at)) {
        if (state === 'pending' && Date.now() >= props.checkout.expires_at) {
          setState('expired')
          setMessage('订单已过期，请关闭后重新发起支付')
        }
        return
      }
      void checkPayment()
    }
    const timer = window.setInterval(tick, 2500)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [checkPayment, props.checkout.expires_at, state])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { props.onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const focusOutside = !dialogRef.current.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current || focusOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef?.current?.focus()
    }
  }, [props.onClose, props.returnFocusRef])

  const expiresText = new Date(props.checkout.expires_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const payLabel = props.checkout.pay_type === 'alipay' ? '支付宝扫码支付' : '微信扫码支付'

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(5,8,24,0.78)] p-3 backdrop-blur-md animate-overlay-in" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="payment-qr-title" tabIndex={-1} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-[24px] border border-line2 bg-surface p-5 shadow-lift outline-none animate-modal-in sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent"><ScanLine className="h-4 w-4" />Secure payment</div>
            <h2 id="payment-qr-title" className="font-display text-xl font-semibold text-ink">{payLabel}</h2>
          </div>
          <button type="button" onClick={props.onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-3 transition hover:bg-surface2 hover:text-ink" aria-label="关闭支付弹窗"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 rounded-2xl border border-line bg-white p-3">
          {qrDataUrl && state !== 'failed' ? <img src={qrDataUrl} alt={`${payLabel}二维码`} className="mx-auto aspect-square w-full max-w-[280px] object-contain" /> : <div className="mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center text-sm text-slate-500">{state === 'failed' ? '二维码不可用' : <><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />正在生成二维码</>}</div>}
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-surface2 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><div className="truncate text-sm font-semibold text-ink">{props.productName}</div><div className="mt-1 font-mono text-xs text-ink-3">{props.checkout.checkout_intent_id}</div></div>
            <div className="shrink-0 font-mono text-2xl font-semibold text-accent-ink">¥{props.checkout.amount.toFixed(2)}</div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-3"><span>订单有效期</span><span>今天 {expiresText} 前</span></div>
        </div>

        <div role="status" className={`mt-4 flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm ${state === 'paid' ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : state === 'expired' || state === 'failed' ? 'bg-red-500/10 text-red-500' : 'bg-accent-soft text-accent-ink'}`}>
          {state === 'paid' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : checking ? <LoaderCircle className="h-5 w-5 shrink-0 animate-spin" /> : <ScanLine className="h-5 w-5 shrink-0" />}{message}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {state === 'paid' ? (
            <button type="button" onClick={props.onClose} className="col-span-full inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-white">完成</button>
          ) : (
            <>
              <button type="button" onClick={() => void checkPayment(true)} disabled={checking || state !== 'pending'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />我已完成支付</button>
              <button type="button" onClick={() => void checkPayment(true)} disabled={checking || state !== 'pending'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />刷新支付状态</button>
            </>
          )}
        </div>
        {props.checkout.checkout_url && <a href={props.checkout.checkout_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 text-sm text-ink-3 transition hover:text-ink">无法扫码？打开安全收银台<ExternalLink className="h-4 w-4" /></a>}
      </section>
    </div>
  )
}
