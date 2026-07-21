import { Coins, LogOut, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { usePlatformStore } from '../../platformStore'
import { useShellStore } from '../../shellStore'
import BillingModal from '../platform/BillingModal'

export default function AccountWorkspace() {
  const user = usePlatformStore((s) => s.user)
  const logout = usePlatformStore((s) => s.logout)
  const returnToMainView = useShellStore((s) => s.returnToMainView)

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="kunai-empty-panel"><Wallet className="h-8 w-8" /><h2>本地工作区</h2><p>平台账户模式开启后，可在这里查看余额、次数与账单。</p></section>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8">
      <section className="kunai-account-hero">
        <div className="relative z-10 min-w-0"><p className="kunai-kicker"><Sparkles className="h-3.5 w-3.5" />KunAI account</p><h2 className="truncate">{user.display_name || user.email}</h2><p>{user.email} · {user.image_studio_capabilities.admin ? '管理员' : '创作者'}账户</p></div>
        <div className="relative z-10 flex flex-wrap gap-2">
          <span><ShieldCheck className="h-4 w-4" />账户状态正常</span>
          <span><Coins className="h-4 w-4" />{user.available_credits ?? 0} 次可用</span>
          <button type="button" onClick={() => void logout()}><LogOut className="h-4 w-4" />退出登录</button>
        </div>
      </section>
      <div className="mt-6"><BillingModal embedded onClose={returnToMainView} /></div>
    </main>
  )
}
