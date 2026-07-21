interface BrandMarkProps {
  className?: string
}

export function BrandMark({ className = 'h-10 w-10' }: BrandMarkProps) {
  return (
    <span className={`kunai-brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none">
        <defs>
          <linearGradient id="kunai-core" x1="10" y1="7" x2="39" y2="42" gradientUnits="userSpaceOnUse">
            <stop stopColor="#A5B4FC" />
            <stop offset="0.48" stopColor="#6366F1" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
          <linearGradient id="kunai-orbit" x1="3" y1="13" x2="44" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#818CF8" stopOpacity="0" />
            <stop offset="0.52" stopColor="#A5B4FC" />
            <stop offset="1" stopColor="#22D3EE" stopOpacity="0.24" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="46" height="46" rx="14" fill="#080D20" />
        <rect x="1" y="1" width="46" height="46" rx="14" stroke="url(#kunai-core)" strokeOpacity="0.5" />
        <path d="M15 12V36M16 26L29 12M21.5 22L33 36" stroke="url(#kunai-core)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 28.5C13 39 36.5 41 43 24.5" stroke="url(#kunai-orbit)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="39.5" cy="15" r="2.3" fill="#67E8F9" />
        <circle cx="39.5" cy="15" r="4.5" fill="#22D3EE" fillOpacity="0.16" />
      </svg>
    </span>
  )
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <BrandMark className="h-10 w-10 shrink-0" />
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">KunAI Studio</span>
          <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.2em] text-ink-3">Visual Intelligence</span>
        </span>
      )}
    </span>
  )
}
