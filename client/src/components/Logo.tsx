import { useTranslation } from 'react-i18next';

export function Logo({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-9 w-9 shrink-0 drop-shadow-[0_0_12px_rgba(212,175,55,0.35)]" aria-hidden>
        <defs>
          <linearGradient id="logo-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f3e0a0" />
            <stop offset="55%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#8a6a1f" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="30" fill="#0b0b12" stroke="rgba(212,175,55,0.35)" />
        <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(212,175,55,0.2)" />
        <path d="M18 22l5 14 9-7z" fill="url(#logo-gold)" />
        <path d="M46 22l-5 14-9-7z" fill="url(#logo-gold)" />
        <path
          d="M32 20c-9 0-15 7-15 15 0 6 4 11 8 14l-2 5 7-3 2 4 2-4 7 3-2-5c4-3 8-8 8-14 0-8-6-15-15-15z"
          fill="url(#logo-gold)"
        />
        <circle cx="26.5" cy="34" r="1.8" fill="#e23b50" />
        <circle cx="37.5" cy="34" r="1.8" fill="#e23b50" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="font-display text-[15px] font-bold tracking-[0.14em] text-parchment-100">
            LOUP-GAROU <span className="text-gold-400">DZ</span>
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.32em] text-gold-500/60">{t('common.tagline')}</div>
        </div>
      )}
    </div>
  );
}
