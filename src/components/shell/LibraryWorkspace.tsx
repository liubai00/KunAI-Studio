import { FolderHeart, Images, Search } from 'lucide-react'
import { useStore } from '../../store'
import { FavoriteCollectionsView } from '../favorites/FavoriteCollectionsView'
import SearchBar from '../SearchBar'
import TaskGrid from '../TaskGrid'

export default function LibraryWorkspace() {
  const tasks = useStore((s) => s.tasks)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const favoriteCount = tasks.filter((task) => task.isFavorite).length

  return (
    <main data-drag-select-surface className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-5 sm:px-6 lg:px-8">
      <section className="kunai-page-intro">
        <div><p className="kunai-kicker"><Images className="h-3.5 w-3.5" />Asset intelligence</p><h2>沉淀每一次创作成果</h2><p>搜索、筛选、收藏和批量管理你的全部视觉资产。</p></div>
        <div className="grid grid-cols-2 gap-2"><span><Images className="h-4 w-4" /><b>{tasks.length}</b><small>全部资产</small></span><span><FolderHeart className="h-4 w-4" /><b>{favoriteCount}</b><small>已收藏</small></span></div>
      </section>
      <div className="mt-2"><SearchBar /></div>
      {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid scope="library" />}
      {!tasks.length && <div className="sr-only"><Search />暂无可搜索资产</div>}
    </main>
  )
}
