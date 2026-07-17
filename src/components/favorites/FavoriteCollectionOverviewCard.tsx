import { useEffect, useRef, useState, type SVGProps } from 'react'
import type { TaskRecord, FavoriteCollection } from '../../types'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../../store'
import { TooltipButton as FavoriteActionButton } from '../TooltipButton'
import { EditIcon, FavoriteIcon, TrashIcon } from '../icons'
import type { CollectionCard } from './favoriteUtils'

function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4.172a2 2 0 011.414.586L12 7h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}

function CoverThumbnail({ imageId }: { imageId: string }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    setSrc('')
    if (!imageId) return
    let cancelled = false
    const unsubscribe = subscribeImageThumbnail(imageId, (thumbnail) => {
      if (!cancelled) setSrc(thumbnail.dataUrl)
    })
    ensureImageThumbnailCached(imageId).then((thumbnail) => {
      if (!cancelled && thumbnail) setSrc(thumbnail.dataUrl)
    }).catch(() => {})
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  if (src) return <img src={src} alt="" className="h-full w-full object-cover" />
  return <div className="h-full w-full bg-surface2" />
}


export function FavoriteCollectionOverviewCard({
  card,
  isVirtualAll,
  isDefault,
  canDelete,
  isSelected,
  editingId,
  editingName,
  setEditingName,
  confirmRename,
  handleRenameKeyDown,
  startRename,
  handleSetDefault,
  handleDelete,
  onOpen,
  onToggleSelection,
  suppressClickUntilRef,
}: {
  card: CollectionCard
  isVirtualAll: boolean
  isDefault: boolean
  canDelete: boolean
  isSelected: boolean
  editingId: string | null
  editingName: string
  setEditingName: (value: string) => void
  confirmRename: () => void
  handleRenameKeyDown: (e: React.KeyboardEvent) => void
  startRename: (e: React.MouseEvent, collection: FavoriteCollection) => void
  handleSetDefault: (collection: FavoriteCollection) => void
  handleDelete: (collection: FavoriteCollection, collectionTasks: TaskRecord[]) => void
  onOpen: () => void
  onToggleSelection: () => void
  suppressClickUntilRef: { current: number }
}) {
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartedSelected, setSwipeStartedSelected] = useState(false)
  const [swipeActionActive, setSwipeActionActive] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<-1 | 0 | 1>(0)
  const cardRef = useRef<HTMLElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const horizontalSwipeRef = useRef(false)
  const suppressSwipeClickUntilRef = useRef(0)
  const swipeResetTimerRef = useRef<number | null>(null)
  const swipeFrameRef = useRef<number | null>(null)
  const swipeOffsetRef = useRef(0)
  const pendingSwipeOffsetRef = useRef(0)

  const applySwipeOffset = (offset: number) => {
    swipeOffsetRef.current = offset
    if (cardRef.current) cardRef.current.style.transform = offset ? `translateX(${offset}px)` : ''
  }

  const cancelSwipeFrame = () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
  }

  const scheduleSwipeOffset = (offset: number) => {
    if (swipeFrameRef.current == null && swipeOffsetRef.current === offset) return
    pendingSwipeOffsetRef.current = offset
    if (swipeFrameRef.current != null) return
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      applySwipeOffset(pendingSwipeOffsetRef.current)
    })
  }

  const resetSwipe = () => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    setIsSwiping(false)
    setSwipeDirection(0)
    setSwipeActionActive(false)
    cancelSwipeFrame()
    applySwipeOffset(0)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) {
      resetSwipe()
      return
    }
    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
      swipeResetTimerRef.current = null
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    horizontalSwipeRef.current = false
    setSwipeStartedSelected(isSelected)
    setSwipeActionActive(false)
    setSwipeDirection(0)
    cancelSwipeFrame()
    applySwipeOffset(0)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const deltaX = e.touches[0].clientX - touchStartRef.current.x
    const deltaY = e.touches[0].clientY - touchStartRef.current.y
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      horizontalSwipeRef.current = true
      e.preventDefault()
      const boundedOffset = Math.max(-60, Math.min(60, deltaX))
      setSwipeDirection(boundedOffset > 0 ? 1 : boundedOffset < 0 ? -1 : 0)
      setSwipeActionActive(Math.abs(deltaX) >= 40)
      scheduleSwipeOffset(boundedOffset)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    setIsSwiping(false)
    cancelSwipeFrame()
    setSwipeDirection(0)
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    touchStartRef.current = null
    const isSwipeAction = horizontalSwipeRef.current && Math.abs(deltaX) > 40
    horizontalSwipeRef.current = false
    setSwipeActionActive(isSwipeAction)
    swipeResetTimerRef.current = window.setTimeout(() => {
      setSwipeActionActive(false)
      swipeResetTimerRef.current = null
    }, 220)
    if (isSwipeAction) {
      suppressSwipeClickUntilRef.current = Date.now() + 350
      e.preventDefault()
      e.stopPropagation()
      onToggleSelection()
    }
  }

  useEffect(() => () => {
    if (swipeResetTimerRef.current != null) window.clearTimeout(swipeResetTimerRef.current)
    cancelSwipeFrame()
  }, [])

  useEffect(() => {
    if (!isSwiping) applySwipeOffset(0)
  }, [isSwiping])

  const showSwipeAction = swipeActionActive
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'bg-surface2'
      : 'bg-accent'
    : 'bg-surface2'

  const coverImageIds = [...card.tasks]
    .filter((task) => task.outputImages?.length)
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((task) => task.outputImages || [])
    .slice(0, 4)

  return (
    <div className="relative rounded-2xl">
      <div className={`absolute inset-0 rounded-2xl flex items-center transition-opacity duration-200 pointer-events-none ${isSwiping || swipeDirection !== 0 || swipeActionActive ? 'opacity-100' : 'opacity-0'} ${swipeBgClass} ${swipeDirection > 0 ? 'justify-start pl-6' : 'justify-end pr-6'}`}>
        <svg className={`w-8 h-8 transition-transform duration-150 ${showSwipeAction ? (swipeStartedSelected ? 'scale-110 text-ink-2' : 'scale-110 text-white') : 'scale-90 text-ink-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {swipeStartedSelected && showSwipeAction ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>
      <article
        ref={cardRef}
        className={`group relative flex flex-col bg-surface rounded-2xl border overflow-hidden cursor-pointer touch-pan-y will-change-transform duration-200 hover:-translate-y-1 hover:shadow-lift ${!isSwiping ? 'transition-[box-shadow,border-color,background-color,transform]' : 'transition-[box-shadow,border-color,background-color]'} ${isSelected ? 'border-accent shadow-card ring-2 ring-accent/40' : 'border-line shadow-card hover:border-line2'}`}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current || Date.now() < suppressSwipeClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          const isCtrl = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey
          if (isCtrl) {
            e.preventDefault()
            onToggleSelection()
            return
          }
          onOpen()
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={resetSwipe}
      >
        <div className="relative grid aspect-[16/10] grid-cols-2 grid-rows-2 gap-[2px] overflow-hidden bg-line">
          {coverImageIds.length === 0 ? (
            <div className="col-span-2 row-span-2 flex items-center justify-center bg-accent-soft text-accent">
              <FavoriteIcon filled className="h-8 w-8 opacity-80" />
            </div>
          ) : coverImageIds.length === 1 ? (
            <div className="col-span-2 row-span-2 overflow-hidden bg-surface2">
              <CoverThumbnail imageId={coverImageIds[0]} />
            </div>
          ) : (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="overflow-hidden bg-surface2">
                {coverImageIds[index] ? <CoverThumbnail imageId={coverImageIds[index]} /> : null}
              </div>
            ))
          )}
          {!isVirtualAll && card.collection && (
            <div className={`absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-[10px] bg-[rgba(12,11,9,0.55)] p-0.5 backdrop-blur-sm transition-opacity ${editingId === card.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
              <FavoriteActionButton
                tooltip={isDefault ? '取消默认收藏夹' : '设为默认收藏夹'}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSetDefault(card.collection!)
                }}
                className={`rounded-[7px] p-1.5 transition-colors ${isDefault ? 'text-accent' : 'text-white/70 hover:bg-white/10 hover:text-accent'}`}
              >
                <FavoriteIcon filled={isDefault} className="w-4 h-4" />
              </FavoriteActionButton>
              {editingId === card.id ? (
                <FavoriteActionButton
                  tooltip="确认"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    confirmRename()
                  }}
                  className="rounded-[7px] p-1.5 text-emerald-400 hover:bg-white/10 hover:text-emerald-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </FavoriteActionButton>
              ) : (
                <FavoriteActionButton
                  tooltip="编辑名称"
                  onClick={(e) => startRename(e, card.collection!)}
                  className="rounded-[7px] p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <EditIcon className="w-4 h-4" />
                </FavoriteActionButton>
              )}
              <FavoriteActionButton
                tooltip={canDelete ? '删除收藏夹' : '至少保留一个收藏夹'}
                disabled={!canDelete}
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(card.collection!, card.tasks)
                }}
                className={`rounded-[7px] p-1.5 transition-colors ${canDelete ? 'text-white/70 hover:bg-white/10 hover:text-red-400' : 'text-white/30 cursor-not-allowed'}`}
              >
                <TrashIcon className="w-4 h-4" />
              </FavoriteActionButton>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2.5 px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {isVirtualAll ? <FavoriteIcon filled className="h-4 w-4 shrink-0 text-accent" /> : <FolderIcon className="h-4 w-4 shrink-0 text-ink-3" />}
            {editingId === card.id ? (
              <input
                type="text"
                className="h-6 min-w-0 flex-1 rounded-[7px] border border-line2 bg-surface px-1.5 py-0 text-[13.5px] font-semibold leading-6 text-ink shadow-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                onBlur={confirmRename}
              />
            ) : (
              <span className="truncate text-[13.5px] font-semibold text-ink" title={card.name}>{card.name}</span>
            )}
          </div>
          <span className={`flex-none rounded-full px-2 py-[3px] font-mono text-[11px] font-medium ${isVirtualAll ? 'bg-accent-soft text-accent-ink' : 'bg-surface2 text-ink-2'}`}>
            {card.tasks.length}
          </span>
        </div>
      </article>
    </div>
  )
}
