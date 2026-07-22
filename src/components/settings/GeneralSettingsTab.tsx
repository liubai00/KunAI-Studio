import type { AppSettings } from '../../types'
import Select from '../Select'

interface GeneralSettingsTabProps {
  draft: AppSettings
  zipDownloadRouteSummary: string
  commitSettings: (nextDraft: AppSettings) => void
  onOpenZipDownloadRouteManager: () => void
  toggleTaskCompletionNotification: () => Promise<void>
}

const ROW = 'py-[15px] border-b border-line last:border-b-0'
const HEAD = 'mb-[7px] flex items-center justify-between gap-[14px]'
const LABEL = 'text-[13.5px] font-medium text-ink'
const DESC = 'text-[12px] leading-[1.55] text-ink-3'
const SEL = 'w-full h-10 px-3 rounded-[11px] border border-line bg-surface2 hover:border-line2 text-[13px] font-medium text-ink transition-colors outline-none'
const TSW_TRACK = 'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors'
const TSW_KNOB = 'inline-block h-4 w-4 transform rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform'

export default function GeneralSettingsTab({
  draft,
  zipDownloadRouteSummary,
  commitSettings,
  onOpenZipDownloadRouteManager,
  toggleTaskCompletionNotification,
}: GeneralSettingsTabProps) {
  return (
    <div>
      <div className={`first:pt-0.5 ${ROW}`}>
        <div className={HEAD}>
          <span className={LABEL}>任务提交方式</span>
          <span className="rounded-[9px] border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-ink">Enter 发送</span>
        </div>
        <div data-selectable-text className={DESC}>
          Enter 直接发送，Shift + Enter 换行；中文输入法选词时不会误触发送。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>提交任务后清空输入框</span>
          <button
            type="button"
            onClick={() => commitSettings({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })}
            className={`${TSW_TRACK} ${draft.clearInputAfterSubmit ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.clearInputAfterSubmit}
            aria-label="提交任务后清空输入框"
          >
            <span className={`${TSW_KNOB} ${draft.clearInputAfterSubmit ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          开启后，提交成功创建任务时会清空提示词和参考图。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>参考图编辑按钮</span>
          <div className="w-[130px] shrink-0">
            <Select
              value={draft.referenceImageEditAction}
              onChange={(val) => commitSettings({ ...draft, referenceImageEditAction: val as AppSettings['referenceImageEditAction'] })}
              options={[
                { label: '询问', value: 'ask' },
                { label: '替换参考图', value: 'replace-reference' },
                { label: '添加遮罩', value: 'add-mask' },
              ]}
              className={SEL}
            />
          </div>
        </div>
        <div data-selectable-text className={DESC}>
          控制未添加遮罩的参考图点击编辑按钮时，是每次询问、直接替换参考图，还是直接添加遮罩。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>使用压缩包进行的批量下载途径</span>
          <button
            type="button"
            onClick={onOpenZipDownloadRouteManager}
            className="shrink-0 rounded-[10px] border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-line2"
          >
            管理
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          {zipDownloadRouteSummary}
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>重启后加载上次的输入框</span>
          <button
            type="button"
            onClick={() => commitSettings({ ...draft, persistInputOnRestart: !draft.persistInputOnRestart })}
            className={`${TSW_TRACK} ${draft.persistInputOnRestart ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.persistInputOnRestart}
            aria-label="重启后加载上次的输入框"
          >
            <span className={`${TSW_KNOB} ${draft.persistInputOnRestart ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          关闭后，不再持久化提示词和参考图，下次启动会使用空输入框。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>复用配置时临时复用该任务的 API 配置</span>
          <button
            type="button"
            onClick={() => commitSettings({ ...draft, reuseTaskApiProfileTemporarily: !draft.reuseTaskApiProfileTemporarily })}
            className={`${TSW_TRACK} ${draft.reuseTaskApiProfileTemporarily ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.reuseTaskApiProfileTemporarily}
            aria-label="复用配置时临时复用该任务的 API 配置"
          >
            <span className={`${TSW_KNOB} ${draft.reuseTaskApiProfileTemporarily ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          开启后，复用历史任务时会临时使用该任务的 API 配置，找不到该配置时提交会提示；关闭后，会继续使用当前的 API 配置。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>成功任务仍然展示重试按钮</span>
          <button
            type="button"
            onClick={() => commitSettings({ ...draft, alwaysShowRetryButton: !draft.alwaysShowRetryButton })}
            className={`${TSW_TRACK} ${draft.alwaysShowRetryButton ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.alwaysShowRetryButton}
            aria-label="成功任务仍然展示重试按钮"
          >
            <span className={`${TSW_KNOB} ${draft.alwaysShowRetryButton ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          开启后，即使任务成功生成，也会在任务卡片和详情页显示重试按钮。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>允许模型改写优化提示词</span>
          <button
            type="button"
            onClick={() => commitSettings({ ...draft, allowPromptRewrite: !draft.allowPromptRewrite })}
            className={`${TSW_TRACK} ${draft.allowPromptRewrite ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.allowPromptRewrite}
            aria-label="允许模型改写优化提示词"
          >
            <span className={`${TSW_KNOB} ${draft.allowPromptRewrite ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          开启后，Codex CLI 兼容模式下的 Image API 请求和所有 Responses API 请求都不再附加防改写提示词，允许模型按服务商策略优化提示词。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>任务完成后发送系统通知</span>
          <button
            type="button"
            onClick={() => { void toggleTaskCompletionNotification() }}
            className={`${TSW_TRACK} ${draft.taskCompletionNotification ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.taskCompletionNotification}
            aria-label="任务完成后发送系统通知"
          >
            <span className={`${TSW_KNOB} ${draft.taskCompletionNotification ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          开启后，画廊模式图像生成完成、Agent 模式回复结束时，会发送浏览器系统通知。浏览器可能会请求通知权限或默认拒绝，请查看相关提示。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>发送消息后自动滚动到底部</span>
          <button
            type="button"
            onClick={() => commitSettings({ ...draft, agentScrollToBottomAfterSubmit: !draft.agentScrollToBottomAfterSubmit })}
            className={`${TSW_TRACK} ${draft.agentScrollToBottomAfterSubmit ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.agentScrollToBottomAfterSubmit}
            aria-label="发送消息后自动滚动到底部"
          >
            <span className={`${TSW_KNOB} ${draft.agentScrollToBottomAfterSubmit ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          开启后，在 Agent 模式发送消息成功后会自动滚动到对话底部。
        </div>
      </div>
      <div className={ROW}>
        <div className={HEAD}>
          <span className={LABEL}>公式输出提示</span>
          <button
            type="button"
            onClick={() => commitSettings({ ...draft, agentMathFormattingPrompt: !draft.agentMathFormattingPrompt })}
            className={`${TSW_TRACK} ${draft.agentMathFormattingPrompt ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.agentMathFormattingPrompt}
            aria-label="公式输出提示"
          >
            <span className={`${TSW_KNOB} ${draft.agentMathFormattingPrompt ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className={DESC}>
          开启后，Agent 会被要求使用 <code className="rounded-[5px] bg-surface2 px-[5px] py-px font-mono text-[0.92em] text-ink-2">$...$</code> 和 <code className="rounded-[5px] bg-surface2 px-[5px] py-px font-mono text-[0.92em] text-ink-2">$$...$$</code> 输出数学公式，确保渲染效果正常。
        </div>
      </div>
    </div>
  )
}
