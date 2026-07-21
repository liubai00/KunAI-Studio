import { Bell, Bot, Database, ExternalLink, MonitorCog, Moon, SlidersHorizontal, Sparkles, Sun } from 'lucide-react'
import { toggleTheme, useResolvedTheme } from '../../lib/theme'
import { useStore } from '../../store'

export default function SettingsWorkspace() {
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const resolvedTheme = useResolvedTheme()

  const groups = [
    { icon: SlidersHorizontal, title: '创作偏好', text: `回车提交 ${settings.enterSubmit ? '已开启' : '已关闭'} · 任务完成通知 ${settings.taskCompletionNotification ? '已开启' : '已关闭'}`, tab: 'general' as const },
    { icon: Bot, title: 'Agent 配置', text: `最多 ${settings.agentMaxToolRounds} 个工具回合 · 管理模型与联网能力`, tab: 'agent' as const },
    { icon: Database, title: '数据管理', text: '导入、导出或清理本地创作数据与配置', tab: 'data' as const },
    { icon: MonitorCog, title: '关于 KunAI Studio', text: `当前版本 ${__APP_VERSION__} · 查看运行环境与更新信息`, tab: 'about' as const },
  ]

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-8">
      <section className="kunai-page-intro"><div><p className="kunai-kicker"><Sparkles className="h-3.5 w-3.5" />Workspace preferences</p><h2>让工作区更符合你的节奏</h2><p>主题、生成习惯、Agent 行为和本地数据都在这里管理。</p></div></section>
      <div data-settings-grid className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <button type="button" onClick={toggleTheme} className="kunai-settings-card text-left">
          <span className="kunai-settings-icon">{resolvedTheme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1"><h3>星空主题</h3><p>当前为{resolvedTheme === 'dark' ? '深空' : '晨星'}模式，点击切换显示风格</p></div><ExternalLink className="h-4 w-4 text-ink-3" />
        </button>
        {groups.map((group) => {
          const Icon = group.icon
          return <button key={group.title} type="button" onClick={() => setShowSettings(true, group.tab)} className="kunai-settings-card text-left"><span className="kunai-settings-icon"><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h3>{group.title}</h3><p>{group.text}</p></div><ExternalLink className="h-4 w-4 text-ink-3" /></button>
        })}
        <button type="button" onClick={() => setShowSettings(true, 'data')} className="kunai-settings-card text-left"><span className="kunai-settings-icon"><Bell className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h3>安全与隐私</h3><p>配置与创作记录保存在当前账户空间；敏感凭据不会显示在页面中。</p></div><ExternalLink className="h-4 w-4 shrink-0 text-ink-3" /></button>
      </div>
    </main>
  )
}
