import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Bot, Eye, EyeOff, Image, LoaderCircle, LockKeyhole, Mail, Moon, RefreshCw, ScanLine, Search, ShieldCheck, Sparkles, Sun } from 'lucide-react'
import { usePlatformStore } from '../../platformStore'
import { toggleTheme, useResolvedTheme } from '../../lib/theme'
import { BrandLockup, BrandMark } from '../Brand'
import TurnstileWidget from './TurnstileWidget'

type AuthMode = 'login' | 'register' | 'reset'

function Field(props: {
  label: string
  type?: string
  value: string
  placeholder: string
  autoComplete?: string
  inputMode?: 'numeric'
  maxLength?: number
  pattern?: string
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
          inputMode={props.inputMode}
          maxLength={props.maxLength}
          pattern={props.pattern}
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
  const resolvedTheme = useResolvedTheme()
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
    if ((mode === 'register' || mode === 'reset') && !/^\d{6}$/.test(code.trim())) {
      setError('请输入 6 位数字验证码')
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
          <BrandMark className="mx-auto mb-5 h-12 w-12" />
          <h1 className="font-display text-xl font-semibold text-ink">暂时无法连接工作台</h1>
          <p className="mt-2 text-sm text-ink-3">{storeError}</p>
          <button type="button" onClick={() => void bootstrap()} className="kunai-primary-button mt-6 px-5">
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
      <header className="relative z-10 mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 sm:px-9">
        <BrandLockup />
        <button type="button" onClick={toggleTheme} className="kunai-icon-button border border-line bg-surface/70" aria-label={resolvedTheme === 'dark' ? '切换浅色主题' : '切换深色主题'}>
          {resolvedTheme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>
      </header>
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-5rem)] max-w-[1440px] items-center gap-12 px-5 pb-16 pt-6 lg:grid-cols-[minmax(0,1fr)_460px] lg:px-12 xl:gap-24">
        <section className="hidden max-w-2xl lg:block">
          <span className="kunai-kicker"><Sparkles className="h-3.5 w-3.5" />AI visual workspace</span>
          <h1 className="mt-6 max-w-xl font-display text-5xl font-semibold leading-[1.08] tracking-[-0.045em] text-ink xl:text-6xl">探索想象的边界，<span className="kunai-gradient-text">让创意穿越星海。</span></h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-ink-2">KunAI Studio 将图像生成、多轮 Agent 与联网研究汇聚到一个可靠的企业级创作空间。</p>
          <div className="mt-10 grid grid-cols-2 gap-3">
            <div className="kunai-feature-card"><Image className="h-5 w-5" /><div><b>多分辨率创作</b><span>1K · 2K · 4K 高质量输出</span></div></div>
            <div className="kunai-feature-card"><Bot className="h-5 w-5" /><div><b>多轮智能 Agent</b><span>理解上下文，持续打磨创意</span></div></div>
            <div className="kunai-feature-card"><Search className="h-5 w-5" /><div><b>独立联网搜索</b><span>按需检索公开信息与灵感</span></div></div>
            <div className="kunai-feature-card"><ScanLine className="h-5 w-5" /><div><b>安全资产空间</b><span>集中管理作品、账单与权限</span></div></div>
          </div>
          <figure className="mt-4 flex items-center gap-4 overflow-hidden rounded-[18px] border border-line bg-surface/70 p-3 backdrop-blur-xl">
            <img src="./examples/beach-portrait.png" alt="KunAI Studio 海岛人像创作示例" className="h-24 w-32 shrink-0 rounded-[13px] object-cover" />
            <figcaption className="min-w-0">
              <span className="kunai-kicker">Featured creation</span>
              <b className="mt-2 block text-sm font-semibold text-ink">海岛光影 · 写真人像示例</b>
              <span className="mt-1 block text-xs leading-5 text-ink-3">从灵感、参考图到 4K 成片，在同一工作台持续打磨。</span>
            </figcaption>
          </figure>
          <p className="mt-4 text-[11px] leading-5 text-ink-3">基于 GPT Image Playground（MIT）二次开发，并由 KunAI Studio 持续扩展平台账户、计费支付、Agent、联网搜索与企业管理能力。</p>
          <div className="kunai-auth-orbit" aria-hidden="true"><i /><i /><i /></div>
        </section>
        <section className="w-full max-w-[460px] justify-self-center rounded-[24px] border border-line2 bg-surface/95 p-6 shadow-lift backdrop-blur-2xl sm:p-8 lg:justify-self-end">
          <div className="mb-7 flex items-center gap-3 lg:hidden"><BrandMark className="h-10 w-10" /><div><div className="font-display text-base font-semibold text-ink">KunAI Studio</div><div className="text-xs text-ink-3">Visual Intelligence</div></div></div>
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
                    <Field
                      label="邮箱验证码"
                      icon="code"
                      value={code}
                      onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6 位验证码"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      pattern="[0-9]{6}"
                    />
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
              className="kunai-primary-button h-11 w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <>{mode === 'login' ? '登录' : mode === 'register' ? '创建账户' : '更新密码'}<ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          {mode === 'login' && registrationEnabled && emailVerificationEnabled && (
            <div className="mt-5 flex items-center justify-between text-sm">
              <button type="button" onClick={() => changeMode('register')} className="font-medium text-accent-ink hover:brightness-110">创建账户</button>
              <button type="button" onClick={() => changeMode('reset')} className="text-ink-3 transition-colors hover:text-ink">忘记密码？</button>
            </div>
          )}
          {mode === 'login' && (!registrationEnabled || !emailVerificationEnabled) && (
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-5 text-sm">
              <span className="text-ink-3">新账户由管理员统一开通</span>
              {emailVerificationEnabled && <button type="button" onClick={() => changeMode('reset')} className="shrink-0 text-accent-ink transition hover:text-ink">忘记密码？</button>}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
