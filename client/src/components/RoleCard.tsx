import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { RoleId, Team } from '@/types';
import { roleMeta, TEAM_META } from '@/lib/roles';
import { cn } from '@/lib/format';

export function RoleCard({
  role,
  team,
  variant = 'showcase',
  selected = false,
  onClick,
  className = '',
}: {
  role: RoleId;
  team?: Team;
  variant?: 'showcase' | 'tile' | 'mini';
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const meta = roleMeta(role);
  const resolvedTeam = team ?? meta.team;
  const teamMeta = TEAM_META[resolvedTeam] ?? TEAM_META.village;
  const RoleIcon = meta.icon;
  const TeamIcon = teamMeta.icon;
  const name = t(`roles.${role}.name`);
  const short = t(`roles.${role}.short`);
  const description = t(`roles.${role}.description`);

  if (variant === 'mini') {
    return (
      <span className={cn('badge gap-1.5', teamMeta.badge, className)} title={name}>
        <RoleIcon size={14} strokeWidth={1.8} aria-hidden />
        <span>{name}</span>
      </span>
    );
  }

  if (variant === 'tile') {
    const Component = onClick ? motion.button : motion.div;
    return (
      <Component
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        whileHover={onClick ? { y: -2 } : undefined}
        whileTap={onClick ? { scale: 0.985 } : undefined}
        className={cn(
          'role-tile w-full',
          selected && 'role-tile-selected',
          className,
        )}
        aria-pressed={onClick ? selected : undefined}
        title={description}
      >
        <span
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-xl border bg-gradient-to-br',
            meta.gradient,
            meta.ring,
          )}
          aria-hidden
        >
          <RoleIcon size={23} strokeWidth={1.7} />
        </span>
        <span className="text-[12px] font-semibold leading-tight text-parchment-100">{name}</span>
        <span className={cn('text-[10px] font-medium', teamMeta.color)}>{t(`teams.${resolvedTeam}`)}</span>
      </Component>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={cn(
        'relative overflow-hidden rounded-3xl border bg-gradient-to-b p-6 text-center shadow-card sm:p-8',
        meta.gradient,
        meta.ring,
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.14),transparent_55%)]" />
      <div className="relative">
        <span className={cn('badge mx-auto mb-4 w-fit', teamMeta.badge)}>
          <TeamIcon size={13} strokeWidth={1.8} aria-hidden />
          {t(`teams.${resolvedTeam}`)}
        </span>
        <motion.div
          className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-black/30 shadow-glow sm:h-28 sm:w-28"
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 180, damping: 16 }}
          aria-hidden
        >
          <RoleIcon className="h-12 w-12 sm:h-14 sm:w-14" strokeWidth={1.5} />
        </motion.div>
        <p className="eyebrow mb-1">{t('game.yourRole')}</p>
        <h2 className={cn('font-display text-3xl font-bold leading-tight sm:text-4xl', meta.text)}>{name}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-parchment-300">{description}</p>
        <div className="mx-auto mt-5 h-px w-24 bg-gold-line opacity-60" />
        <p className="mt-4 text-xs uppercase tracking-[0.22em] text-mist/80">{short}</p>
      </div>
    </motion.div>
  );
}
