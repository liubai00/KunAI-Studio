import { Bot, Boxes, Coins, LayoutDashboard, ShieldCheck, Ticket, Users, WalletCards } from 'lucide-react'
import { useState } from 'react'
import { formatPlatformQuota } from '../../lib/platformCurrency'
import { usePlatformStore } from '../../platformStore'
import { useShellStore } from '../../shellStore'
import type { AdminSection } from '../../types'
import AdminAgentModelsModal from '../platform/AdminAgentModelsModal'
import AdminProductsModal from '../platform/AdminProductsModal'
import AdminRedemptionModal from '../platform/AdminRedemptionModal'
import AdminUsersModal from '../platform/AdminUsersModal'

const SECTIONS = [
  { id: 'overview' as const, label: '概览', icon: LayoutDashboard },
  { id: 'users' as const, label: '用户权限', icon: Users },
  { id: 'products' as const, label: '商品定价', icon: Boxes },
  { id: 'models' as const, label: 'Agent 模型', icon: Bot },
  { id: 'redemption' as const, label: '兑换码', icon: Ticket },
]

export default function AdminCenter() {
  const [section, setSection] = useState<AdminSection>('overview')
  const user = usePlatformStore((s) => s.user)
  const status = usePlatformStore((s) => s.status)
  const returnToMainView = useShellStore((s) => s.returnToMainView)
  const products = status?.image_studio?.products || []
  const models = usePlatformStore((s) => s.agentModels)

  if (!user?.image_studio_capabilities.admin) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-8"><section className="kunai-empty-panel"><ShieldCheck className="h-8 w-8" /><h2>无管理权限</h2><p>当前账户不能访问管理中心。</p></section></main>
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 pb-28 pt-5 sm:px-6 lg:px-8">
      <section className="kunai-page-intro"><div><p className="kunai-kicker"><ShieldCheck className="h-3.5 w-3.5" />Control center</p><h2>管理 KunAI Studio 业务运行</h2><p>用户、商品、模型和兑换权益在同一个工作区集中管理。</p></div></section>
      <nav className="kunai-admin-tabs" aria-label="管理中心模块">
        {SECTIONS.map((item) => {
          const Icon = item.icon
          return <button key={item.id} type="button" onClick={() => setSection(item.id)} className={section === item.id ? 'is-active' : ''}><Icon className="h-4 w-4" />{item.label}</button>
        })}
      </nav>
      <div className="mt-5">
        {section === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="kunai-metric-card"><span><WalletCards className="h-5 w-5" /></span><p>管理员余额</p><strong>{formatPlatformQuota(Math.max(0, user.quota - (user.reserved_quota || 0)), status)}</strong><small>Agent 与搜索可用</small></article>
              <article className="kunai-metric-card"><span><Coins className="h-5 w-5" /></span><p>生图次数</p><strong>{user.available_credits ?? 0}</strong><small>当前管理员账户</small></article>
              <article className="kunai-metric-card"><span><Boxes className="h-5 w-5" /></span><p>在售商品</p><strong>{products.filter((product) => product.active).length}</strong><small>共 {products.length} 个商品配置</small></article>
              <article className="kunai-metric-card"><span><Bot className="h-5 w-5" /></span><p>Agent 模型</p><strong>{models.filter((model) => model.enabled).length || '—'}</strong><small>点击模型标签查看详情</small></article>
            </div>
            <section className="kunai-admin-overview-panel">
              <div><p className="kunai-kicker">System readiness</p><h3>服务可用性</h3></div>
              <div className="grid gap-3 sm:grid-cols-3">
                <span><i className={status?.image_studio?.relay_configured ? 'ok' : ''} /><b>图像生成</b><small>{status?.image_studio?.relay_configured ? '服务正常' : '等待配置'}</small></span>
                <span><i className={status?.image_studio?.agent_configured ? 'ok' : ''} /><b>Agent 对话</b><small>{status?.image_studio?.agent_configured ? '服务正常' : '等待配置'}</small></span>
                <span><i className={status?.image_studio?.search_configured ? 'ok' : ''} /><b>联网搜索</b><small>{status?.image_studio?.search_configured ? '服务正常' : '等待配置'}</small></span>
              </div>
            </section>
          </div>
        )}
        {section === 'users' && <AdminUsersModal embedded onClose={returnToMainView} />}
        {section === 'products' && <AdminProductsModal embedded onClose={returnToMainView} />}
        {section === 'models' && <AdminAgentModelsModal embedded onClose={returnToMainView} />}
        {section === 'redemption' && <AdminRedemptionModal embedded onClose={returnToMainView} />}
      </div>
    </main>
  )
}
