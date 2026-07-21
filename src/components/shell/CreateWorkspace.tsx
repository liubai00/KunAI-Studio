import { Activity, Image, Orbit, Sparkles } from 'lucide-react'
import { useStore } from '../../store'
import InputBar from '../InputBar'
import TaskGrid from '../TaskGrid'

export default function CreateWorkspace() {
  const tasks = useStore((s) => s.tasks)
  const running = tasks.filter((task) => task.status === 'running').length
  const completed = tasks.filter((task) => task.status === 'done').length

  return (
    <div className="kunai-create-layout">
      <main data-home-main data-drag-select-surface className="min-w-0 px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pb-10">
        <section className="kunai-hero-panel">
          <div className="relative z-10 max-w-2xl">
            <span className="kunai-kicker"><Orbit className="h-3.5 w-3.5" />AI Visual Creation</span>
            <h2>让每一个想象，<span>抵达星图。</span></h2>
            <p>用自然语言生成与编辑高质量视觉内容，支持参考图、多轮创作与最高 4K 输出。</p>
          </div>
          <div className="kunai-orbit-visual" aria-hidden="true"><i /><i /><i /></div>
        </section>

        <div className="mb-5 mt-6 flex flex-wrap items-end justify-between gap-4">
          <div><p className="kunai-kicker"><Sparkles className="h-3.5 w-3.5" />Creation stream</p><h3 className="mt-2 font-display text-xl font-semibold text-ink">正在创作与最近结果</h3><p className="mt-1 text-sm text-ink-3">优先展示进行中的任务和最近 8 个作品</p></div>
          <div className="flex gap-2">
            <span className="kunai-stat-chip"><Activity className="h-3.5 w-3.5 text-cyan-400" />进行中 <b>{running}</b></span>
            <span className="kunai-stat-chip"><Image className="h-3.5 w-3.5 text-indigo-400" />已完成 <b>{completed}</b></span>
          </div>
        </div>
        <TaskGrid scope="create" />
      </main>
      <aside className="kunai-creator-panel">
        <div className="kunai-panel-heading"><div><p className="kunai-kicker">Creator console</p><h2>创作控制台</h2></div><span className="kunai-live-dot">在线</span></div>
        <InputBar variant="panel" />
      </aside>
    </div>
  )
}
