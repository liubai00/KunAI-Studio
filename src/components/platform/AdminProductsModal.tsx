import { Coins, Crown, LoaderCircle, Plus, Store, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { usePlatformStore } from '../../platformStore'
import type { PlatformProduct } from '../../platformStore'

interface AdminProductsModalProps {
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

interface Draft {
  id: string
  kind: 'membership' | 'credits'
  name: string
  description: string
  price: string
  duration_days: string
  credits: string
  sort_order: string
  active: boolean
  isNew: boolean
}

const emptyDraft = (): Draft => ({
  id: '',
  kind: 'membership',
  name: '',
  description: '',
  price: '',
  duration_days: '30',
  credits: '100',
  sort_order: '0',
  active: true,
  isNew: true,
})

const draftFromProduct = (product: PlatformProduct): Draft => ({
  id: product.id,
  kind: product.kind,
  name: product.name,
  description: product.description || '',
  price: String(product.price),
  duration_days: String(product.duration_days || 30),
  credits: String(product.credits || 0),
  sort_order: String(product.sort_order || 0),
  active: product.active,
  isNew: false,
})

export default function AdminProductsModal(props: AdminProductsModalProps) {
  const listProducts = usePlatformStore((s) => s.listProducts)
  const saveProduct = usePlatformStore((s) => s.saveProduct)
  const deleteProduct = usePlatformStore((s) => s.deleteProduct)
  const dialogRef = useRef<HTMLElement>(null)
  const [products, setProducts] = useState<PlatformProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setProducts(await listProducts())
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
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
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
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      props.returnFocusRef.current?.focus()
    }
  }, [props.onClose, props.returnFocusRef])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await saveProduct({
        id: draft.id.trim(),
        kind: draft.kind,
        name: draft.name.trim(),
        description: draft.description.trim(),
        price: draft.price.trim(),
        duration_days: Number(draft.duration_days) || 0,
        credits: Number(draft.credits) || 0,
        sort_order: Number(draft.sort_order) || 0,
        active: draft.active,
      })
      setDraft(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    setSaving(true)
    setError(null)
    try {
      await deleteProduct(id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-9 w-full rounded-[11px] border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:text-ink-3'

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(12,11,9,0.55)] p-3 backdrop-blur-sm animate-overlay-in" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-products-title" tabIndex={-1} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-lift outline-none animate-modal-in">
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 id="admin-products-title" className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><Store className="h-5 w-5 text-accent" />商品与定价</h2>
            <p className="mt-1 text-sm text-ink-3">配置会员套餐与次数包，用户在账单页购买</p>
          </div>
          <button type="button" onClick={props.onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface2 hover:text-ink" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        {error && <p role="alert" className="mx-5 mt-3 shrink-0 rounded-[11px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500 sm:mx-6">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载</div>
          ) : (
            <div className="flex flex-col gap-2">
              {products.length === 0 && <div className="py-10 text-center text-sm text-ink-3">尚未创建商品，点击下方「新建商品」开始</div>}
              {products.map((product) => (
                <div key={product.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${product.active ? 'border-line bg-surface2' : 'border-line bg-surface2 opacity-60'}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                    {product.kind === 'membership' ? <Crown className="h-4 w-4" /> : <Coins className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{product.name}</span>
                      {!product.active && <span className="rounded-[6px] bg-ink-3/15 px-1.5 py-0.5 text-[10px] text-ink-3">已下架</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-ink-3">
                      {product.id} · {product.kind === 'membership' ? `${product.duration_days} 天` : `${product.credits} 次`}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold text-ink">${product.price}</span>
                  <button type="button" onClick={() => { setDraft(draftFromProduct(product)); setConfirmDelete(null) }} className="h-8 shrink-0 rounded-[8px] border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:border-line2">编辑</button>
                  {confirmDelete === product.id ? (
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <button type="button" disabled={saving} onClick={() => void remove(product.id)} className="h-8 rounded-[8px] bg-red-500 px-2.5 text-xs font-semibold text-white disabled:opacity-50">确认删除</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-xs text-ink">取消</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(product.id)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-red-500 transition-colors hover:bg-red-500/10" aria-label={`删除 ${product.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {!draft && (
                <button type="button" onClick={() => setDraft(emptyDraft())} className="mt-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line2 text-sm font-medium text-ink-2 transition-colors hover:border-accent hover:text-ink">
                  <Plus className="h-4 w-4" />新建商品
                </button>
              )}
            </div>
          )}
        </div>

        {draft && (
          <form onSubmit={submit} className="shrink-0 border-t border-line bg-surface2 px-5 py-4 sm:px-6">
            <div className="mb-3 text-sm font-semibold text-ink">{draft.isNew ? '新建商品' : `编辑：${draft.name || draft.id}`}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-ink-3">商品 ID（英文/数字/-/_）</span>
                <input required value={draft.id} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="pro-monthly" className={`${field} font-mono disabled:opacity-60`} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">类型</span>
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })} className={field}>
                  <option value="membership">会员（有效期不限次）</option>
                  <option value="credits">次数包</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">名称</span>
                <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Pro 月卡" className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-3">价格（USD）</span>
                <input required value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="9.99" inputMode="decimal" className={`${field} font-mono`} />
              </label>
              {draft.kind === 'membership' ? (
                <label className="space-y-1">
                  <span className="text-xs text-ink-3">有效天数</span>
                  <input required value={draft.duration_days} onChange={(e) => setDraft({ ...draft, duration_days: e.target.value })} placeholder="30" inputMode="numeric" className={`${field} font-mono`} />
                </label>
              ) : (
                <label className="space-y-1">
                  <span className="text-xs text-ink-3">赠送次数</span>
                  <input required value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} placeholder="100" inputMode="numeric" className={`${field} font-mono`} />
                </label>
              )}
              <label className="space-y-1">
                <span className="text-xs text-ink-3">排序（小在前）</span>
                <input value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} placeholder="0" inputMode="numeric" className={`${field} font-mono`} />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs text-ink-3">描述（可选）</span>
                <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="面向重度用户，畅享不限次生成" className={field} />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setDraft({ ...draft, active: !draft.active })} className="inline-flex items-center gap-2 text-sm text-ink-2">
                <span className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors ${draft.active ? 'bg-accent' : 'bg-line2'}`}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform ${draft.active ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                </span>
                {draft.active ? '已上架' : '已下架'}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} className="h-9 rounded-[11px] border border-line bg-surface px-4 text-sm text-ink transition-colors hover:border-line2">取消</button>
                <button type="submit" disabled={saving} className="h-9 rounded-[11px] bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] transition-transform hover:-translate-y-px disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
              </div>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
