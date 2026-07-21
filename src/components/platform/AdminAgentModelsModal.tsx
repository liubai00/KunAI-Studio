import { Bot, LoaderCircle, RefreshCw, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { usePlatformStore } from '../../platformStore'
import type { AgentModelInput, PlatformAgentModel } from '../../platformStore'

interface AdminAgentModelsModalProps {
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  embedded?: boolean
}

interface Draft {
  enabled: boolean
  is_default: boolean
  sort_order: string
  input_price: string
  cached_input_price: string
  output_price: string
  max_step_reserve: string
}

const microsToYuan = (value: number | null) => value === null ? '' : String(value / 1000000)

const draftFromModel = (model: PlatformAgentModel): Draft => ({
  enabled: model.enabled,
  is_default: model.is_default,
  sort_order: String(model.sort_order),
  input_price: microsToYuan(model.input_price_micros),
  cached_input_price: microsToYuan(model.cached_input_price_micros),
  output_price: microsToYuan(model.output_price_micros),
  max_step_reserve: microsToYuan(model.max_step_reserve_micros),
})

function yuanToMicros(value: string) {
  const normalized = value.trim()
  if (!normalized) return null
  const amount = Number(normalized)
  const micros = Math.round(amount * 1000000)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(micros)) throw new Error('请输入有效的非负人民币金额')
  return micros
}

export default function AdminAgentModelsModal(props: AdminAgentModelsModalProps) {
  const listAgentModels = usePlatformStore((s) => s.listAgentModels)
  const refreshAgentModels = usePlatformStore((s) => s.refreshAgentModels)
  const saveAgentModel = usePlatformStore((s) => s.saveAgentModel)
  const dialogRef = useRef<HTMLElement>(null)
  const [models, setModels] = useState<PlatformAgentModel[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyModels = (items: PlatformAgentModel[]) => {
    setModels(items)
    setDrafts(Object.fromEntries(items.map((model) => [model.id, draftFromModel(model)])))
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      applyModels(await listAgentModels())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    if (!props.embedded) {
      document.body.style.overflow = 'hidden'
      dialogRef.current?.focus()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (props.embedded) return
      if (event.key === 'Escape') { props.onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
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
      if (!props.embedded) document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef?.current?.focus()
    }
  }, [props.embedded, props.onClose, props.returnFocusRef])

  const updateDraft = (id: string, changes: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...changes } }))
  }

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      applyModels(await refreshAgentModels())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  const save = async (model: PlatformAgentModel) => {
    const draft = drafts[model.id]
    if (!draft) return
    setSavingId(model.id)
    setError(null)
    try {
      const sortOrder = Number(draft.sort_order)
      if (!Number.isSafeInteger(sortOrder)) throw new Error('排序必须是整数')
      const changes: AgentModelInput = {
        enabled: draft.enabled,
        is_default: draft.is_default,
        sort_order: sortOrder,
        input_price_micros: yuanToMicros(draft.input_price),
        cached_input_price_micros: yuanToMicros(draft.cached_input_price),
        output_price_micros: yuanToMicros(draft.output_price),
        max_step_reserve_micros: yuanToMicros(draft.max_step_reserve),
      }
      await saveAgentModel(model.id, changes)
      applyModels(await listAgentModels())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  const field = 'h-9 w-full rounded-[11px] border border-line bg-surface px-3 font-mono text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:font-sans placeholder:text-ink-3'

  return (
    <div className={props.embedded ? 'kunai-embedded-modal' : 'fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(5,8,24,0.72)] p-3 backdrop-blur-sm animate-overlay-in'} onMouseDown={(event) => !props.embedded && event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role={props.embedded ? 'region' : 'dialog'} aria-modal={props.embedded ? undefined : true} aria-labelledby="admin-agent-models-title" tabIndex={-1} className={props.embedded ? 'flex min-h-[560px] w-full flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-card outline-none' : 'flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-lift outline-none animate-modal-in'}>
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 id="admin-agent-models-title" className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><Bot className="h-5 w-5 text-info" />Agent 模型与定价</h2>
            <p className="mt-1 text-sm text-ink-3">从 Kunai 同步模型，并配置每百万 Token 的人民币价格与单步预留</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={refreshing} onClick={() => void refresh()} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface2 px-3 text-sm font-medium text-ink transition-colors hover:border-line2 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? '同步中' : '刷新 Kunai'}
            </button>
            <button type="button" onClick={props.onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface2 hover:text-ink" aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error && <p role="alert" className="mx-5 mt-3 shrink-0 rounded-[11px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500 sm:mx-6">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载模型目录</div>
          ) : models.length === 0 ? (
            <div className="py-16 text-center text-sm text-ink-3">尚未发现 Agent 模型，请点击「刷新 Kunai」</div>
          ) : (
            <div className="flex flex-col gap-3">
              {models.map((model) => {
                const draft = drafts[model.id]
                if (!draft) return null
                const priced = Boolean(draft.input_price.trim() && draft.cached_input_price.trim() && draft.output_price.trim() && draft.max_step_reserve.trim())
                return (
                  <article key={model.id} className={`rounded-2xl border p-4 ${draft.enabled ? 'border-line bg-surface2' : 'border-line bg-surface2 opacity-70'}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-ink">{model.label || model.id}</span>
                          {model.label !== model.id && <span className="font-mono text-xs text-ink-3">{model.id}</span>}
                          {draft.is_default && <span className="rounded-[6px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">默认</span>}
                          {model.selectable ? (
                            <span className="rounded-[6px] bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">可选择</span>
                          ) : (
                            <span className="rounded-[6px] bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">{model.enabled ? '未完成定价 · 不可选' : '已停用 · 不可选'}</span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-ink-3">最近发现：{model.last_seen_at ? new Date(model.last_seen_at).toLocaleString('zh-CN') : '暂无记录'}</div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-ink-2">
                        <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(model.id, { enabled: event.target.checked, ...(!event.target.checked ? { is_default: false } : {}) })} className="h-4 w-4 accent-[var(--accent)]" />启用
                      </label>
                      <label className={`flex items-center gap-2 text-sm ${draft.enabled && priced ? 'text-ink-2' : 'text-ink-3'}`}>
                        <input type="radio" name="default-agent-model" checked={draft.is_default} disabled={!draft.enabled || !priced} onChange={() => setDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, item]) => [id, { ...item, is_default: id === model.id }]))) } className="h-4 w-4 accent-[var(--accent)]" />设为默认
                      </label>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <label className="space-y-1">
                        <span className="text-xs text-ink-3">输入 / 百万 Token（元）</span>
                        <input value={draft.input_price} onChange={(event) => updateDraft(model.id, { input_price: event.target.value })} placeholder="未定价" inputMode="decimal" className={field} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-ink-3">缓存输入 / 百万（元）</span>
                        <input value={draft.cached_input_price} onChange={(event) => updateDraft(model.id, { cached_input_price: event.target.value })} placeholder="未定价" inputMode="decimal" className={field} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-ink-3">输出 / 百万 Token（元）</span>
                        <input value={draft.output_price} onChange={(event) => updateDraft(model.id, { output_price: event.target.value })} placeholder="未定价" inputMode="decimal" className={field} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-ink-3">单步预留（元）</span>
                        <input value={draft.max_step_reserve} onChange={(event) => updateDraft(model.id, { max_step_reserve: event.target.value })} placeholder="未配置" inputMode="decimal" className={field} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-ink-3">排序（小在前）</span>
                        <input value={draft.sort_order} onChange={(event) => updateDraft(model.id, { sort_order: event.target.value })} inputMode="numeric" className={field} />
                      </label>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-ink-3">四项价格均配置后模型才可供用户选择；清空金额可取消定价。</p>
                      <button type="button" disabled={savingId !== null} onClick={() => void save(model)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-transform hover:-translate-y-px disabled:opacity-50">
                        {savingId === model.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{savingId === model.id ? '保存中' : '保存'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
