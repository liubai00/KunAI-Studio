import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, RefreshCw, ShieldCheck } from 'lucide-react'
import { usePlatformStore } from '../../platformStore'
import TurnstileWidget from './TurnstileWidget'

type AuthMode = 'login' | 'register' | 'reset'

function Field(props: {
  label: string
  type?: string
  value: string
  placeholder: string
  autoComplete?: string
  icon: 'email' | 'password' | 'code'
  onChange: (value: string) => void
  trailing?: React.ReactNode
}) {
  const Icon = props.icon === 'email' ? Mail : props.icon === 'code' ? ShieldCheck : LockKeyhole
  return (
    <label className="block space-y-2">
      <span className="text-[13px] font-medium text-ink">{props.label}</span>
      <span className="flex h-11 items-center rounded-[11px] border border-line bg-surface2 transition-colors focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft">
        <Icon className="ml-3 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
        <input
          type={props.type || 'text'}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-3"
          required
        />
        {props.trailing}
      </span>
    </label>
  )
}

export default function AuthScreen() {
  const status = usePlatformStore((s) => s.status)
  const phase = usePlatformStore((s) => s.phase)
  const bootstrap = usePlatformStore((s) => s.bootstrap)
  const login = usePlatformStore((s) => s.login)
  const register = usePlatformStore((s) => s.register)
  const sendVerification = usePlatformStore((s) => s.sendVerification)
  const sendPasswordReset = usePlatformStore((s) => s.sendPasswordReset)
  const resetPassword = usePlatformStore((s) => s.resetPassword)
  const storeError = usePlatformStore((s) => s.error)
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [turnstile, setTurnstile] = useState('')
  const [turnstileKey, setTurnstileKey] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(storeError)
  const [notice, setNotice] = useState<string | null>(null)
  const turnstileEnabled = Boolean(status?.turnstile_check && status.turnstile_site_key)
  const emailVerificationEnabled = status?.email_verification === true
  const registrationEnabled = status?.register_enabled !== false && status?.password_register_enabled !== false

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  const resetFeedback = () => {
    setError(null)
    setNotice(null)
  }

  const changeMode = (nextMode: AuthMode) => {
    resetFeedback()
    setCode('')
    setCountdown(0)
    setPassword('')
    setConfirmPassword('')
    setTurnstile('')
    setTurnstileKey((value) => value + 1)
    setMode(nextMode)
  }

  const changeEmail = (value: string) => {
    setEmail(value)
    setCode('')
    setCountdown(0)
    resetFeedback()
  }

  const requireTurnstile = () => {
    if (!turnstileEnabled || turnstile) return true
    setError('请先完成人机验证')
    return false
  }

  const resetTurnstile = () => {
    setTurnstile('')
    setTurnstileKey((value) => value + 1)
  }

  const handleSendCode = async () => {
    resetFeedback()
    if (!email.trim()) {
      setError('请输入邮箱地址')
      return
    }
    if (!requireTurnstile()) return
    setSendingCode(true)
    try {
      const result = mode === 'reset'
        ? await sendPasswordReset(email, turnstile)
        : await sendVerification(email, turnstile)
      setCountdown(60)
      if (result.dev_code) {
        setCode(result.dev_code)
        setNotice(`开发环境验证码已自动填入：${result.dev_code}`)
      } else {
        setNotice('验证码已发送，请检查邮箱')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSendingCode(false)
      resetTurnstile()
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    resetFeedback()
    if (!requireTurnstile()) return
    if ((mode === 'register' || mode === 'reset') && password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    if ((mode === 'register' || mode === 'reset') && password.length < 8) {
      setError('密码至少需要 8 个字符')
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'login') {
        await login(email, password, turnstile)
      } else if (mode === 'register') {
        await register(email, password, code, turnstile)
        changeMode('login')
        setNotice('账户已创建，请使用邮箱登录')
      } else {
        await resetPassword(email, password, code, turnstile)
        changeMode('login')
        setNotice('密码已更新，请重新登录')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
      resetTurnstile()
    }
  }

  if (phase === 'error') {
    return (
      <main className="auth-shell min-h-screen flex items-center justify-center px-5">
        <section className="w-full max-w-md rounded-[22px] border border-line2 bg-surface p-8 text-center shadow-lift">
          <div className="gi-brandmark mx-auto mb-5 h-12 w-12"><span className="gi-aperture h-4 w-4" /></div>
          <h1 className="font-display text-xl font-semibold text-ink">暂时无法连接工作台</h1>
          <p className="mt-2 text-sm text-ink-3">{storeError}</p>
          <button type="button" onClick={() => void bootstrap()} className="mt-6 inline-flex h-10 items-center gap-2 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-all hover:brightness-105 active:scale-[0.99]">
            <RefreshCw className="h-4 w-4" />重试
          </button>
        </section>
      </main>
    )
  }

  const title = mode === 'login' ? '登录工作台' : mode === 'register' ? '创建账户' : '重置密码'
  const subtitle = mode === 'login' ? '继续管理你的创作与历史记录' : mode === 'register' ? '验证邮箱后即可开始创作' : '使用邮箱验证码设置新密码'

  return (
    <main className="auth-shell min-h-screen text-ink">
      <header className="flex h-20 items-center px-5 sm:px-9">
        <div className="flex items-center gap-3">
          <span className="gi-brandmark h-9 w-9"><span className="gi-aperture h-3 w-3" /></span>
          <span className="font-display text-[16.5px] font-semibold tracking-[-0.012em] text-ink">Image Studio</span>
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-5 pb-16 pt-6">
        <section className="w-full max-w-[440px] rounded-[22px] border border-line2 bg-surface p-6 shadow-lift sm:p-8">
          {mode !== 'login' && (
            <button type="button" onClick={() => changeMode('login')} className="mb-5 inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-3 hover:bg-surface2" aria-label="返回登录">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
          <p className="mt-2 text-sm text-ink-3">{subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <Field label="邮箱" icon="email" type="email" value={email} onChange={changeEmail} placeholder="name@example.com" autoComplete="email" />
            {(mode === 'login' || mode === 'register' || mode === 'reset') && (
              <Field
                label="密码"
                icon="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={setPassword}
                placeholder={mode === 'login' ? '输入密码' : '至少 8 个字符'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                trailing={
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="mr-2 inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-3 hover:bg-surface2 hover:text-ink-2" aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
              />
            )}
            {(mode === 'register' || mode === 'reset') && (
              <>
                <Field label="确认密码" icon="password" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={setConfirmPassword} placeholder="再次输入密码" autoComplete="new-password" />
                {emailVerificationEnabled ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <Field label="邮箱验证码" icon="code" value={code} onChange={setCode} placeholder="6 位验证码" autoComplete="one-time-code" />
                    <button type="button" onClick={() => void handleSendCode()} disabled={sendingCode || countdown > 0} className="h-11 rounded-[11px] border border-line bg-surface2 px-3 text-sm font-medium text-ink-2 hover:border-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50">
                      {sendingCode ? <LoaderCircle className="mx-auto h-4 w-4 animate-spin" /> : countdown > 0 ? `${countdown}s` : '发送验证码'}
                    </button>
                  </div>
                ) : (
                  <p className="rounded-[11px] bg-accent-soft px-3 py-2.5 text-xs leading-5 text-accent-ink">邮件验证服务尚未启用，请联系管理员。</p>
                )}
              </>
            )}

            {turnstileEnabled && <TurnstileWidget siteKey={status!.turnstile_site_key!} refreshKey={turnstileKey} onToken={setTurnstile} />}

            {error && <p role="alert" className="rounded-[11px] border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-300">{error}</p>}
            {notice && <p className="rounded-[11px] border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-600 dark:text-emerald-300">{notice}</p>}

            <button
              type="submit"
              disabled={submitting || (mode === 'register' && (!registrationEnabled || !emailVerificationEnabled)) || (mode === 'reset' && !emailVerificationEnabled)}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <>{mode === 'login' ? '登录' : mode === 'register' ? '创建账户' : '更新密码'}<ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          {mode === 'login' && (
            <div className="mt-5 flex items-center justify-between text-sm">
              <button type="button" onClick={() => changeMode('register')} className="font-medium text-accent-ink hover:brightness-110">创建账户</button>
              <button type="button" onClick={() => changeMode('reset')} className="text-ink-3 transition-colors hover:text-ink">忘记密码？</button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
