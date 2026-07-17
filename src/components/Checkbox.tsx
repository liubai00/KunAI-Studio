import React from 'react'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  tone?: 'primary' | 'danger'
}

export function Checkbox({ checked, onChange, label, tone = 'primary', className, ...props }: CheckboxProps) {
  const toneClasses = tone === 'danger'
    ? 'checked:bg-red-500 checked:border-red-500 focus:ring-red-500/20'
    : 'checked:bg-accent checked:border-accent focus:ring-accent/25'

  return (
    <label className={`flex items-center gap-[9px] cursor-pointer group ${className || ''}`}>
      <div className="relative flex items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={`peer appearance-none w-[18px] h-[18px] rounded-[6px] border-[1.6px] border-line2 bg-surface focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface transition-[background-color,border-color] duration-[140ms] cursor-pointer ${toneClasses}`}
          {...props}
        />
        <svg className="absolute w-3 h-3 pointer-events-none opacity-0 peer-checked:opacity-100 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      {label && <span className="text-[12.5px] font-medium text-ink-2 group-hover:text-ink transition-colors">{label}</span>}
    </label>
  )
}
