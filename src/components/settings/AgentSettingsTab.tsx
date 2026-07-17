import {
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  type AgentApiConfigMode,
  type ApiProfile,
  type AppSettings,
} from '../../types'
import { normalizeAgentMaxToolRounds } from '../../lib/apiProfiles'
import Select from '../Select'

interface SelectOption {
  label: string
  value: string
}

interface AgentSettingsTabProps {
  draft: AppSettings
  platformMode?: boolean
  agentMaxToolRoundsInput: string
  agentTextProfileOptions: SelectOption[]
  agentImageProfileOptions: SelectOption[]
  selectedAgentTextProfile: ApiProfile | null
  selectedAgentImageProfile: ApiProfile | null
  setAgentMaxToolRoundsInput: (value: string) => void
  updateAgentApiConfigMode: (mode: AgentApiConfigMode) => void
  commitSettings: (nextDraft: AppSettings) => void
  commitAgentMaxToolRounds: () => void
}

const AGENT_API_CONFIG_MODES: { label: string; value: AgentApiConfigMode }[] = [
  { label: '关闭', value: 'off' },
  { label: '原生', value: 'native' },
  { label: '混合', value: 'hybrid' },
]

export default function AgentSettingsTab({
  draft,
  platformMode = false,
  agentMaxToolRoundsInput,
  agentTextProfileOptions,
  agentImageProfileOptions,
  selectedAgentTextProfile,
  selectedAgentImageProfile,
  setAgentMaxToolRoundsInput,
  updateAgentApiConfigMode,
  commitSettings,
  commitAgentMaxToolRounds,
}: AgentSettingsTabProps) {
  return (
    <div>
      {/* 托管平台由服务端统一提供 Agent API，用户端不暴露独立 API 配置 */}
      {!platformMode && (
        <>
          <div className="border-b border-line py-[15px] first:pt-0.5 last:border-b-0">
            <div className="mb-[7px]">
              <span className="text-[13.5px] font-medium text-ink">使用独立的 API 配置</span>
            </div>
            <div className="inline-flex gap-[3px] rounded-[11px] border border-line bg-surface2 p-[3px]">
              {AGENT_API_CONFIG_MODES.map((mode) => {
                const active = draft.agentApiConfigMode === mode.value
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => updateAgentApiConfigMode(mode.value)}
                    className={`rounded-[8px] px-4 py-1.5 text-[12.5px] transition ${active ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink-2 hover:text-ink'}`}
                  >
                    {mode.label}
                  </button>
                )
              })}
            </div>
            <div data-selectable-text className="mt-[9px] space-y-1 text-[12px] leading-[1.55] text-ink-3">
              <div>原生：使用原生的 Responses API 配置，由模型调用 <code className="rounded-[5px] bg-surface2 px-[5px] py-px font-mono text-[0.92em] text-ink-2">image_generation</code> 工具生成图片。</div>
              <div>混合：使用非原生的混合 API 配置，由文本模型调用自定义工具，请求图像模型生成图像，解决部分服务商/模型不支持 <code className="rounded-[5px] bg-surface2 px-[5px] py-px font-mono text-[0.92em] text-ink-2">image_generation</code> 工具的问题。</div>
            </div>
          </div>

          {draft.agentApiConfigMode !== 'off' && (
            <>
              <div className="border-b border-line py-[15px] first:pt-0.5 last:border-b-0">
                <div className="mb-[7px] flex items-center justify-between gap-3.5">
                  <span className="text-[13.5px] font-medium text-ink">文本模型 API 配置</span>
                  <div className="w-40 shrink-0">
                    {agentTextProfileOptions.length > 0 ? (
                      <Select
                        value={selectedAgentTextProfile?.id ?? ''}
                        onChange={(value) => commitSettings({ ...draft, agentTextProfileId: String(value) })}
                        options={agentTextProfileOptions}
                        className="h-10 rounded-[11px] border border-line bg-surface2 px-3 text-[13px] font-medium text-ink transition-colors hover:border-line2"
                      />
                    ) : (
                      <div className="flex h-10 w-full items-center justify-center rounded-[11px] border border-line bg-surface2 px-3 text-center text-[13px] text-ink-3">
                        没有可用配置
                      </div>
                    )}
                  </div>
                </div>
                <div data-selectable-text className="text-[12px] leading-[1.55] text-ink-3">
                  用于对话和调用工具，仅支持 Responses API 配置。
                </div>
              </div>

              {draft.agentApiConfigMode === 'hybrid' && (
                <div className="border-b border-line py-[15px] first:pt-0.5 last:border-b-0">
                  <div className="mb-[7px] flex items-center justify-between gap-3.5">
                    <span className="text-[13.5px] font-medium text-ink">图像模型 API 配置</span>
                    <div className="w-40 shrink-0">
                      <Select
                        value={selectedAgentImageProfile?.id ?? ''}
                        onChange={(value) => commitSettings({ ...draft, agentImageProfileId: String(value) })}
                        options={agentImageProfileOptions}
                        className="h-10 rounded-[11px] border border-line bg-surface2 px-3 text-[13px] font-medium text-ink transition-colors hover:border-line2"
                      />
                    </div>
                  </div>
                  <div data-selectable-text className="text-[12px] leading-[1.55] text-ink-3">
                    用于生成图像，支持所有类型的 API 配置。
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      <label className="block border-b border-line py-[15px] first:pt-0.5 last:border-b-0">
        <span className="mb-[7px] block text-[13.5px] font-medium text-ink">最大工具调用轮数</span>
        <input
          value={agentMaxToolRoundsInput}
          onChange={(e) => setAgentMaxToolRoundsInput(e.target.value)}
          onBlur={commitAgentMaxToolRounds}
          type="number"
          min={1}
          max={50}
          className="h-10 w-full rounded-[11px] border border-line bg-surface2 px-3 font-mono text-[12.5px] text-ink outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
        />
        <div data-selectable-text className="mt-[7px] text-[12px] leading-[1.55] text-ink-3">
          默认 15。用于限制 Agent 连续调用工具时的最大轮数，防止无限循环。
        </div>
      </label>
      <div className="border-b border-line py-[15px] first:pt-0.5 last:border-b-0">
        <div className="mb-[7px] flex items-center justify-between gap-3.5">
          <span className="text-[13.5px] font-medium text-ink">网络搜索</span>
          <button
            type="button"
            onClick={() => {
              const agentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
                ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
                : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentMaxToolRounds)
              setAgentMaxToolRoundsInput(String(agentMaxToolRounds))
              commitSettings({ ...draft, agentMaxToolRounds, agentWebSearch: !draft.agentWebSearch })
            }}
            className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors ${draft.agentWebSearch ? 'bg-accent' : 'bg-line2'}`}
            role="switch"
            aria-checked={draft.agentWebSearch}
            aria-label="网络搜索"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${draft.agentWebSearch ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
        <div data-selectable-text className="text-[12px] leading-[1.55] text-ink-3">
          启用 Responses API 的 <code className="rounded-[5px] bg-surface2 px-[5px] py-px font-mono text-[0.92em] text-ink-2">web_search</code> 工具。模型每次调用此工具会产生少量固定价格的额外计费。
        </div>
      </div>
    </div>
  )
}
