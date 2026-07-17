import { useEffect, useRef, type ReactNode } from 'react'
import { ALL_FAVORITES_COLLECTION_ID, clearFailedTasks, getTaskFavoriteCollectionIds, useStore, taskMatchesFilterStatus, taskMatchesSearchQuery } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import Select from './Select'
import { ChevronLeftIcon, CollectionManageIcon, FavoriteIcon, TrashIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

function SearchActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        onClick={() => {
          tooltipState.dismiss()
          if (disabled) return
          onClick()
        }}
        disabled={disabled}
        className={className}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export default function SearchBar() {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const clearSelection = useStore((s) => s.clearSelection)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const openManageCollectionsModal = useStore((s) => s.openManageCollectionsModal)
  const failedCount = useStore((s) => {
    const q = s.searchQuery.trim().toLowerCase()
    return s.tasks.filter((task) => {
      if (!taskMatchesFilterStatus(task, 'error')) return false
      if (s.filterFavorite) {
        if (!task.isFavorite) return false
        if (s.activeFavoriteCollectionId && s.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task).includes(s.activeFavoriteCollectionId)) return false
      }
      return taskMatchesSearchQuery(task, q)
    }).length
  })
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId
  const isFailedFilter = filterStatus === 'error'
  const favoriteTooltip = activeFavoriteCollectionId ? '返回收藏夹' : filterFavorite ? '退出收藏夹' : '收藏夹'

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (document.activeElement !== inputRef.current) return

      const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY)
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('.task-card-wrapper, .favorite-collection-card-wrapper')) return

      inputRef.current?.blur()
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true)
  }, [])

  const handleFavoriteClick = () => {
    if (activeFavoriteCollectionId) {
      setActiveFavoriteCollectionId(null)
      return
    }
    setFilterFavorite(!filterFavorite)
  }

  const handleClearFailed = () => {
    const state = useStore.getState()
    const q = state.searchQuery.trim().toLowerCase()
    const failedTaskIds = state.tasks
      .filter((task) => {
        if (!taskMatchesFilterStatus(task, 'error')) return false
        if (state.filterFavorite) {
          if (!task.isFavorite) return false
          if (state.activeFavoriteCollectionId && state.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task).includes(state.activeFavoriteCollectionId)) return false
        }
        return taskMatchesSearchQuery(task, q)
      })
      .map((task) => task.id)
    const failedTaskCount = failedTaskIds.length
    if (failedTaskCount === 0) return

    setConfirmDialog({
      title: '清除失败记录',
      message: `确定清除筛选范围内的失败记录吗？\n纯失败任务会被删除；部分失败任务只会清除失败标记，保留已成功图片。共 ${failedTaskCount} 条记录。`,
      confirmText: '清除',
      cancelText: '取消',
      tone: 'danger',
      action: () => clearFailedTasks(failedTaskIds),
    })
  }

  const handleStatusChange = (val: any) => {
    if (val === filterStatus) return
    setFilterStatus(val)
    clearSelection()
  }

  return (
    <div ref={rootRef} data-no-drag-select className="mt-6 mb-5 flex gap-2.5">
      <div className="flex gap-2.5 flex-shrink-0 z-20">
        <SearchActionButton
          tooltip={favoriteTooltip}
          onClick={handleFavoriteClick}
          className={`grid h-[42px] w-[42px] place-items-center rounded-[12px] border shadow-card transition-all ${
            filterFavorite
              ? 'border-transparent bg-accent-soft text-accent-ink'
              : 'border-line bg-surface text-ink-2 hover:border-line2 hover:text-ink'
          }`}
        >
          {activeFavoriteCollectionId ? <ChevronLeftIcon className="w-5 h-5" /> : <FavoriteIcon filled={filterFavorite} className="w-5 h-5" />}
        </SearchActionButton>
        {inCollectionOverview && (
          <SearchActionButton
            tooltip="管理收藏夹"
            onClick={openManageCollectionsModal}
            className="grid h-[42px] w-[42px] place-items-center rounded-[12px] border border-line bg-surface text-ink-2 shadow-card hover:border-line2 hover:text-ink transition-all"
          >
            <CollectionManageIcon className="w-5 h-5" />
          </SearchActionButton>
        )}
        {!inCollectionOverview && (
          <>
            <div className="relative w-[92px]">
              <Select
                value={filterStatus}
                onChange={handleStatusChange}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '已完成', value: 'done' },
                  { label: '生成中', value: 'running' },
                  { label: '失败', value: 'error' },
                ]}
                className="h-[42px] px-3.5 rounded-[12px] border border-line bg-surface text-ink-2 shadow-card hover:border-line2 hover:text-ink text-[13px] font-medium focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition"
              />
            </div>
            {isFailedFilter && (
              <button
                type="button"
                onClick={handleClearFailed}
                disabled={failedCount === 0}
                title={failedCount > 0 ? `清除 ${failedCount} 条失败记录` : '没有失败记录'}
                aria-label={failedCount > 0 ? `清除 ${failedCount} 条失败记录` : '没有失败记录'}
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface text-ink-2 shadow-card transition-all hover:border-line2 hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-line disabled:hover:text-ink-2"
              >
                <TrashIcon className="h-[18px] w-[18px]" />
              </button>
            )}
          </>
        )}
      </div>
      <div className="relative z-10 flex-1">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[17px] h-[17px] text-ink-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder={inCollectionOverview ? '搜索收藏夹名称...' : '搜索提示词、参数...'}
          className="w-full h-[42px] pl-10 pr-3.5 rounded-[12px] border border-line bg-surface text-[13.5px] text-ink placeholder:text-ink-3 shadow-card focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition"
        />
      </div>
    </div>
  )
}
