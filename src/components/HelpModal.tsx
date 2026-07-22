import { useState, useEffect, useRef } from 'react'
import type { AppMode } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import GlobalModal from './GlobalModal'

interface HelpModalProps {
  appMode: AppMode
  isFavoriteCollectionOverview?: boolean
  onClose: () => void
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

export default function HelpModal({ appMode, isFavoriteCollectionOverview = false, onClose }: HelpModalProps) {
  const isMobile = useIsMobile()
  const modalRef = useRef<HTMLDivElement>(null)
  const isAgentMode = appMode === 'agent'
  useCloseOnEscape(true, onClose)
  useModalFocus(true, modalRef)
  usePreventBackgroundScroll(true, modalRef)

  return (
    <GlobalModal onClose={onClose} className="p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-[22px] border border-line2 bg-surface p-5 shadow-lift animate-modal-in flex flex-col max-h-[85vh] custom-scrollbar"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 id="help-modal-title" className="text-base font-display font-semibold text-ink flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            操作指南
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="grid place-items-center h-[34px] w-[34px] rounded-[10px] text-ink-2 hover:bg-surface2 hover:text-ink transition-colors"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain mb-6 text-sm text-ink-2 space-y-6 custom-scrollbar pr-2">
          {isAgentMode ? (
            <>
              <section>
                <div className="space-y-4">
                  <ul className="list-disc pl-4 space-y-2">
                    <li>需要使用 Responses API 配置。</li>
                    <li>如需 Agent 搜索互联网或读取 URL 内容，可在设置的 Agent 配置中开启“网络搜索”。</li>
                    <li>输入 <strong className="text-accent font-medium">@</strong> 可引用参考图或前面轮次生成的图片；Agent 也会自行参考上下文中的图片。</li>
                    <li>编辑某轮消息重新发送，或重新生成某轮消息，会产生可切换的分支。</li>
                    <li>生成的图片会同步到画廊；删除对话默认不会删除画廊中的任务。</li>
                  </ul>
                </div>
              </section>
            </>
          ) : isFavoriteCollectionOverview ? (
            <>
              <section>
                <h4 className="mb-4 text-sm font-display font-medium text-ink flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-ink-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选收藏夹
                </h4>
                <div className="space-y-4">
                  {isMobile ? (
                    <p>在收藏夹卡片上<strong className="text-accent font-medium">左右滑动</strong>即可选中或取消选中该卡片。</p>
                  ) : (
                    <ul className="list-disc pl-4 space-y-2">
                      <li>使用鼠标在空白处<strong className="text-accent font-medium">拖拽框选</strong>收藏夹卡片。</li>
                      <li>按住 <kbd className="px-1.5 py-0.5 rounded-md bg-surface2 border border-line text-xs font-mono">Ctrl</kbd> 或 <kbd className="px-1.5 py-0.5 rounded-md bg-surface2 border border-line text-xs font-mono">⌘</kbd> 并点击卡片，可添加或移除单项。</li>
                      <li>再次框选已选中的卡片会将其取消选中。</li>
                      <li>点击卡片外任意空白处可取消所有选择。</li>
                    </ul>
                  )}
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-display font-medium text-ink flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-ink-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>选中一个或多个收藏夹后，页面底部会出现操作栏，支持<strong className="text-ink-2 font-medium">取消选择</strong>、<strong className="text-accent font-medium">全选收藏夹</strong>、<strong className="text-purple-500 dark:text-purple-400 font-medium">反选收藏夹</strong>、<strong className="text-green-500 dark:text-green-400 font-medium">下载选中</strong>，和<strong className="text-red-500 dark:text-red-400 font-medium">删除选中</strong>。</p>
                </div>
              </section>
            </>
          ) : isMobile ? (
            <>
              <section>
                <h4 className="mb-4 text-sm font-display font-medium text-ink flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-ink-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选任务
                </h4>
                <div className="space-y-4">
                  <p>在历史任务卡片上<strong className="text-accent font-medium">左右滑动</strong>即可选中或取消选中该卡片。</p>
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-display font-medium text-ink flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-ink-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>选中一个或多个任务后，页面底部会出现操作栏，支持<strong className="text-ink-2 font-medium">取消选择</strong>、<strong className="text-accent font-medium">全选任务</strong>、<strong className="text-purple-500 dark:text-purple-400 font-medium">反选任务</strong>、<strong className="text-yellow-500 dark:text-yellow-400 font-medium">编辑收藏夹</strong>、<strong className="text-green-500 dark:text-green-400 font-medium">下载选中</strong>，和<strong className="text-red-500 dark:text-red-400 font-medium">删除选中</strong>。</p>
                </div>
              </section>
            </>
          ) : (
            <>
              <section>
                <h4 className="mb-4 text-sm font-display font-medium text-ink flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-ink-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选任务
                </h4>
                <div className="space-y-4">
                  <ul className="list-disc pl-4 space-y-2">
                    <li>使用鼠标在空白处<strong className="text-accent font-medium">拖拽框选</strong>。</li>
                    <li>按住 <kbd className="px-1.5 py-0.5 rounded-md bg-surface2 border border-line text-xs font-mono">Ctrl</kbd> 或 <kbd className="px-1.5 py-0.5 rounded-md bg-surface2 border border-line text-xs font-mono">⌘</kbd> 并点击卡片，可添加或移除单项。</li>
                    <li>再次框选已选中的卡片会将其取消选中。</li>
                    <li>点击卡片外任意空白处可取消所有选择。</li>
                  </ul>
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-display font-medium text-ink flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-ink-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>选中一个或多个任务后，页面底部会出现操作栏，支持<strong className="text-ink-2 font-medium">取消选择</strong>、<strong className="text-accent font-medium">全选任务</strong>、<strong className="text-purple-500 dark:text-purple-400 font-medium">反选任务</strong>、<strong className="text-yellow-500 dark:text-yellow-400 font-medium">编辑收藏夹</strong>、<strong className="text-green-500 dark:text-green-400 font-medium">下载选中</strong>，和<strong className="text-red-500 dark:text-red-400 font-medium">删除选中</strong>。</p>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="pt-4 border-t border-line flex justify-center">
          <span className="text-sm font-medium text-ink-3">KunAI Studio · AI 视觉创作工作台</span>
        </div>
      </div>
    </GlobalModal>
  )
}
