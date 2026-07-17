import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FavoriteCollection } from '../../types'
import {
  createFavoriteCollection,
  deleteFavoriteCollection,
  getTaskFavoriteCollectionIds,
  renameFavoriteCollection,
  updateTasksFavoriteCollections,
  useStore,
} from '../../store'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'
import { Checkbox } from '../Checkbox'
import { TooltipButton as FavoriteActionButton } from '../TooltipButton'
import { CloseIcon, DragHandleIcon, EditIcon, FavoriteIcon, TrashIcon } from '../icons'
import { getInitialCheckedCollectionIds } from './favoriteUtils'

export function FavoriteCollectionPickerModal() {
  const taskIds = useStore((s) => s.favoritePickerTaskIds)
  const tasks = useStore((s) => s.tasks)
  const collections = useStore((s) => s.favoriteCollections)
  const defaultFavoriteCollectionId = useStore((s) => s.defaultFavoriteCollectionId)
  const setDefaultFavoriteCollectionId = useStore((s) => s.setDefaultFavoriteCollectionId)
  const setFavoriteCollections = useStore((s) => s.setFavoriteCollections)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const closePicker = useStore((s) => s.closeFavoritePicker)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const open = Boolean(taskIds?.length)

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragDropPosition, setDragDropPosition] = useState<'before' | 'after' | null>(null)

  const [touchDragPreview, setTouchDragPreview] = useState<{
    label: string
    x: number
    y: number
    width: number
    height: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const touchDragRef = useRef<{ id: string, startX: number, startY: number, moved: boolean } | null>(null)

  const selectedTasks = useMemo(() => tasks.filter((task) => taskIds?.includes(task.id)), [tasks, taskIds])
  const selectableCollections = collections

  useEffect(() => {
    if (!open) return
    setCheckedIds(getInitialCheckedCollectionIds(selectedTasks, defaultFavoriteCollectionId))
    setDraft('')
    setEditingId(null)
    setEditingName('')
  }, [defaultFavoriteCollectionId, open, selectedTasks])

  useCloseOnEscape(open, closePicker)
  usePreventBackgroundScroll(open, modalRef)

  useEffect(() => {
    if (!touchDragPreview) return

    const preventTouchScroll = (event: TouchEvent) => {
      event.preventDefault()
    }
    const listenerOptions = { passive: false, capture: true } as AddEventListenerOptions
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior

    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    window.addEventListener('touchmove', preventTouchScroll, listenerOptions)

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
      window.removeEventListener('touchmove', preventTouchScroll, listenerOptions)
    }
  }, [touchDragPreview])

  if (!open || !taskIds) return null

  const toggleChecked = (id: string, checked: boolean) => {
    setCheckedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id))
  }

  const handleCreate = () => {
    const collection = createFavoriteCollection(draft)
    if (!collection) return
    setCheckedIds((current) => Array.from(new Set([...current, collection.id])))
    setDraft('')
  }

  const handleConfirm = () => {
    void updateTasksFavoriteCollections(taskIds, checkedIds)
    closePicker()
  }

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const targetElement = e.currentTarget as HTMLElement
    const rect = targetElement.getBoundingClientRect()
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    if (dragOverId !== targetId || dragDropPosition !== position) {
      setDragOverId(targetId)
      setDragDropPosition(position)
    }

    const scrollContainer = targetElement.closest('.custom-scrollbar')
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const scrollThreshold = 30
      if (e.clientY < containerRect.top + scrollThreshold) {
        scrollContainer.scrollTop -= 10
      } else if (e.clientY > containerRect.bottom - scrollThreshold) {
        scrollContainer.scrollTop += 10
      }
    }
  }

  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
    setDragDropPosition(null)
    setTouchDragPreview(null)
    touchDragRef.current = null
  }

  const handleTouchStart = (e: React.TouchEvent, collection: FavoriteCollection) => {
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()

    e.preventDefault()
    e.stopPropagation()
    touchDragRef.current = { id: collection.id, startX: touch.clientX, startY: touch.clientY, moved: false }
    setDraggedId(collection.id)
    setTouchDragPreview({
      label: collection.name,
      x: touch.clientX,
      y: touch.clientY,
      width: rect.width,
      height: rect.height,
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top,
    })
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const drag = touchDragRef.current
    if (!drag) return
    const touch = e.touches[0]

    if (!drag.moved) {
      if (Math.abs(touch.clientX - drag.startX) > 5 || Math.abs(touch.clientY - drag.startY) > 5) {
        drag.moved = true
      } else {
        return
      }
    }

    e.preventDefault()
    setTouchDragPreview((current) => current ? { ...current, x: touch.clientX, y: touch.clientY } : current)

    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    const targetElement = el?.closest('[data-collection-id]') as HTMLElement | null
    if (!targetElement) return

    const targetId = targetElement.getAttribute('data-collection-id')
    if (!targetId) return

    const rect = targetElement.getBoundingClientRect()
    const position = touch.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDragOverId(targetId)
    setDragDropPosition(position)

    const scrollContainer = targetElement.closest('.custom-scrollbar') as HTMLElement | null
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const scrollThreshold = 30
      if (touch.clientY < containerRect.top + scrollThreshold) {
        scrollContainer.scrollTop -= 10
      } else if (touch.clientY > containerRect.bottom - scrollThreshold) {
        scrollContainer.scrollTop += 10
      }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const drag = touchDragRef.current
    if (!drag) return
    if (drag.moved && dragOverId && dragOverId !== drag.id) {
      e.preventDefault()
      const sourceId = drag.id
      const targetId = dragOverId
      
      const sourceIndex = selectableCollections.findIndex((c) => c.id === sourceId)
      const targetIndex = selectableCollections.findIndex((c) => c.id === targetId)
      if (sourceIndex >= 0 && targetIndex >= 0) {
        const newCollections = [...selectableCollections]
        const [removed] = newCollections.splice(sourceIndex, 1)

        let newTargetIndex = targetIndex
        if (dragDropPosition === 'after') newTargetIndex++
        if (sourceIndex < targetIndex) newTargetIndex--

        newCollections.splice(newTargetIndex, 0, removed)
        setFavoriteCollections(newCollections)
      }
    }
    handleDragEnd()
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const sourceId = draggedId || e.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId) return handleDragEnd()

    const sourceIndex = selectableCollections.findIndex((c) => c.id === sourceId)
    const targetIndex = selectableCollections.findIndex((c) => c.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return handleDragEnd()

    const newCollections = [...selectableCollections]
    const [removed] = newCollections.splice(sourceIndex, 1)

    let newTargetIndex = targetIndex
    if (dragDropPosition === 'after') newTargetIndex++
    if (sourceIndex < targetIndex) newTargetIndex--

    newCollections.splice(newTargetIndex, 0, removed)
    setFavoriteCollections(newCollections)
    handleDragEnd()
  }

  const startRename = (e: React.MouseEvent, collection: FavoriteCollection) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(collection.id)
    setEditingName(collection.name)
  }

  const confirmRename = () => {
    if (editingId && editingName.trim()) renameFavoriteCollection(editingId, editingName.trim())
    setEditingId(null)
    setEditingName('')
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingId(null)
      setEditingName('')
    }
  }

  const handleDelete = (e: React.MouseEvent, collection: FavoriteCollection) => {
    e.preventDefault()
    e.stopPropagation()
    if (collections.length <= 1) return
    const collectionTasks = tasks.filter(t => getTaskFavoriteCollectionIds(t).includes(collection.id))
    const imageCount = new Set(collectionTasks.flatMap((task) => task.outputImages || [])).size
    setConfirmDialog({
      title: '删除收藏夹',
      message: `确定要删除收藏夹「${collection.name}」吗？`,
      checkbox: imageCount > 0
        ? {
            label: `同时删除收藏夹中的图片（${imageCount} 张）`,
            tone: 'danger',
          }
        : undefined,
      action: (deleteImages = false) => {
        void deleteFavoriteCollection(collection.id, deleteImages)
      },
    })
  }

  const handleSetDefault = (e: React.MouseEvent, collection: FavoriteCollection) => {
    e.preventDefault()
    e.stopPropagation()
    if (collection.id === defaultFavoriteCollectionId) {
      setDefaultFavoriteCollectionId(null)
      return
    }
    const current = collections.find((item) => item.id === defaultFavoriteCollectionId)
    if (!current) {
      setDefaultFavoriteCollectionId(collection.id)
      return
    }
    setConfirmDialog({
      title: '修改默认收藏夹',
      message: `确定要将默认收藏夹从「${current.name}」改为「${collection.name}」吗？`,
      action: () => setDefaultFavoriteCollectionId(collection.id),
    })
  }

  return createPortal(
    <div data-no-drag-select className="fixed inset-0 z-[105] flex items-center justify-center p-4 sm:p-0" onClick={closePicker}>
      <div className="absolute inset-0 bg-[rgba(12,11,9,0.55)] backdrop-blur-sm animate-overlay-in" />
      <div ref={modalRef} className="relative z-10 flex max-h-[85vh] w-full max-w-[400px] flex-col overflow-hidden rounded-[22px] border border-line2 bg-surface shadow-lift animate-modal-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 shrink-0 relative border-b border-line">
          <FavoriteActionButton tooltip="关闭" onClick={closePicker} wrapperClassName="absolute right-5 top-5 inline-flex" className="shrink-0 rounded-[10px] p-1.5 text-ink-2 transition hover:bg-surface2 hover:text-ink">
            <CloseIcon className="h-5 w-5" />
          </FavoriteActionButton>
          <h2 className="mb-2 pr-8 flex items-center gap-2.5 font-display text-lg font-semibold text-ink leading-snug">
            <FavoriteIcon filled className="h-5 w-5 shrink-0 text-accent" />
            保存到收藏夹
          </h2>
          <p className="text-[13px] text-ink-3 leading-relaxed">
            取消勾选会将任务从对应的收藏夹中移除。
          </p>
        </div>
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden pt-3 pb-1">
          <div className="flex items-center justify-between mb-1.5 px-6 shrink-0">
            <span className="text-[13px] font-medium text-ink-3">选择要保存的收藏夹</span>
            <div className="flex gap-4">
              <button type="button" onClick={() => setCheckedIds(selectableCollections.map((collection) => collection.id))} className="text-[13px] font-medium text-accent-ink hover:text-accent transition-colors">全选</button>
              <button type="button" onClick={() => setCheckedIds([])} className="text-[13px] font-medium text-ink-3 hover:text-ink transition-colors">取消</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar relative">
            {selectableCollections.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-3">暂无收藏夹</div>
            ) : selectableCollections.map((collection) => {
              const isDefault = collection.id === defaultFavoriteCollectionId
              const canDelete = collections.length > 1
              return (
              <div 
                key={collection.id} 
                data-collection-id={collection.id}
                draggable={editingId !== collection.id}
                onDragStart={(e) => handleDragStart(e, collection.id)}
                onDragEnd={handleDragEnd}
                onTouchStart={(e) => handleTouchStart(e, collection)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleDragEnd}
                onClick={(e) => {
                  const target = e.target as HTMLElement
                  if (editingId === collection.id || target.closest('button,input,[data-drag-handle]')) return
                  toggleChecked(collection.id, !checkedIds.includes(collection.id))
                }}
                className={`group relative flex items-center justify-between transition-colors ${
                  draggedId === collection.id ? 'opacity-40 bg-surface2' : 'hover:bg-surface2'
                }`}
                onDragOver={(e) => handleDragOver(e, collection.id)}
                onDrop={(e) => handleDrop(e, collection.id)}
              >
                {dragOverId === collection.id && dragDropPosition === 'before' && draggedId !== collection.id && (
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent z-40 pointer-events-none" />
                )}
                {dragOverId === collection.id && dragDropPosition === 'after' && draggedId !== collection.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent z-40 pointer-events-none" />
                )}
                <div className="flex h-12 cursor-pointer items-center flex-1 min-w-0 gap-3 pl-4 pr-3">
                  <div 
                    data-drag-handle
                    className="flex cursor-grab active:cursor-grabbing items-center justify-center text-ink-3 opacity-60 transition-opacity hover:opacity-100 shrink-0"
                    style={{ touchAction: 'none' }}
                  >
                    <DragHandleIcon className="h-3.5 w-3.5" />
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={checkedIds.includes(collection.id)}
                      onChange={(checked) => toggleChecked(collection.id, checked)}
                      className="shrink-0 scale-110"
                    />
                  </div>
                  {editingId === collection.id ? (
                    <input
                      type="text"
                      className="h-6 min-w-0 flex-1 rounded-[7px] border border-line bg-surface2 px-1.5 py-0 text-[15px] leading-6 text-ink outline-none transition focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      onBlur={confirmRename}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink" title={collection.name}>{collection.name}</span>
                  )}
                </div>
                <div className={`flex shrink-0 items-center justify-end gap-2 overflow-hidden pr-4 transition-all duration-150 ${editingId === collection.id ? 'w-12' : 'w-28'}`}>
                    {editingId === collection.id ? (
                      <FavoriteActionButton
                        tooltip="确认"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          confirmRename()
                        }}
                        className="p-1.5 hover:bg-surface2 rounded-[8px] text-emerald-500 hover:text-emerald-600 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </FavoriteActionButton>
                    ) : (
                      <>
                        <FavoriteActionButton tooltip={isDefault ? '取消默认收藏夹' : '设为默认收藏夹'} onClick={(e) => handleSetDefault(e, collection)} className={`p-1.5 hover:bg-surface2 rounded-[8px] transition-colors ${isDefault ? 'text-accent' : 'text-ink-3 hover:text-accent'}`}><FavoriteIcon filled={isDefault} className="w-3.5 h-3.5" /></FavoriteActionButton>
                        <FavoriteActionButton tooltip="重命名" onClick={(e) => startRename(e, collection)} className="p-1.5 hover:bg-surface2 rounded-[8px] text-ink-3 hover:text-ink transition-colors"><EditIcon className="w-3.5 h-3.5" /></FavoriteActionButton>
                        <FavoriteActionButton tooltip={canDelete ? '删除' : '至少保留一个收藏夹'} disabled={!canDelete} onClick={(e) => handleDelete(e, collection)} className={`p-1.5 hover:bg-surface2 rounded-[8px] transition-colors ${canDelete ? 'text-ink-3 hover:text-red-500' : 'text-ink-3 opacity-40 cursor-not-allowed'}`}><TrashIcon className="w-3.5 h-3.5" /></FavoriteActionButton>
                      </>
                    )}
                  </div>
              </div>
            )})}
          </div>
        </div>
        <div className="border-t border-line p-6 shrink-0">
          <div className="flex gap-3">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreate()
              }}
              type="text"
              placeholder="新建收藏夹..."
              className="min-w-0 flex-1 h-10 rounded-[11px] border border-line bg-surface2 px-4 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!draft.trim()}
              className="inline-flex h-10 items-center justify-center rounded-[11px] border border-line bg-surface2 px-5 text-sm font-medium text-ink transition hover:border-line2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              新建
            </button>
          </div>
          <div className="mt-5 flex gap-4">
            <button type="button" onClick={closePicker} className="flex-1 rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-line2">取消</button>
            <button type="button" onClick={handleConfirm} className="flex-1 rounded-xl bg-[linear-gradient(150deg,var(--accent),#e07a1f)] px-4 py-2.5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_var(--accent-glow)] border border-transparent transition hover:brightness-105">确认</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
