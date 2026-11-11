import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Bot, Feather, Heart, PawPrint, Skull, WifiOff } from 'lucide-react';
import type { PublicPlayerView } from '@/types';
import { Avatar } from './Avatar';
import { roleIcon, roleMeta } from '@/lib/roles';
import { cn } from '@/lib/format';

export function GamePlayerTile({
  player,
  selectable = false,
  selected = false,
  disabled = false,
  onSelect,
  voteCount,
  marked = false,
  wolfMate = false,
  compact = false,
}: {
  player: PublicPlayerView;
  selectable?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: (id: string) => void;
  voteCount?: number | null;
  marked?: boolean;
  wolfMate?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const dead = !player.alive;
  const meta = player.revealedRole ? roleMeta(player.revealedRole) : null;
  const RevealedRoleIcon = player.revealedRole ? roleIcon(player.revealedRole) : null;
  const interactive = selectable && !disabled;

  const content = (
    <>
      <div className="relative">
        <Avatar
          avatar={player.avatar}
          size={compact ? 'md' : 'lg'}
          ring={!dead}
          className={cn(dead && 'grayscale')}
        />
        {dead && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-parchment-200">
            <Skull size={compact ? 16 : 22} />
          </span>
        )}
        {player.isLover && (
          <span className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-rose-400/40 bg-ink-950 text-rose-300">
            <Heart size={10} fill="currentColor" />
          </span>
        )}
        {typeof voteCount === 'number' && voteCount > 0 && (
          <span className="absolute -bottom-1 -end-1 flex h-6 min-w-6 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500 px-1 text-[11px] font-bold text-ink-950">
            {voteCount}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 text-start">
        <div className="flex items-center gap-1.5">
          <p className={cn('truncate text-sm font-semibold', dead ? 'text-mist line-through' : 'text-parchment-100')}>
            {player.username}
          </p>
          {player.isSelf && (
            <span className="rounded bg-gold-500/15 px-1 py-0.5 text-[9px] font-bold text-gold-300">{t('common.you')}</span>
          )}
          {player.isBot && <Bot size={12} className="shrink-0 text-purple-300" />}
          {!player.connected && !player.isBot && <WifiOff size={11} className="shrink-0 text-blood-400" />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-mist">
          <span className="tabular-nums">#{player.seat + 1}</span>
          {player.revealedRole ? (
            <span className={cn('inline-flex items-center gap-1 font-semibold', meta?.text)}>
              {RevealedRoleIcon && <RevealedRoleIcon size={12} strokeWidth={1.8} aria-hidden />}
              {t(`roles.${player.revealedRole}.name`)}
            </span>
          ) : dead ? (
            <span>{t('common.dead')}</span>
          ) : (
            <span>{t('common.alive')}</span>
          )}
          {wolfMate && <PawPrint size={12} className="text-blood-400" aria-label={t('teams.werewolf')} />}
          {marked && <Feather size={12} className="text-purple-300" title={t('game.markedByRaven')} />}
        </div>
      </div>

      {interactive && (
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs transition-colors',
            selected
              ? 'border-gold-400 bg-gold-400 text-ink-950'
              : 'border-white/15 text-mist group-hover:border-gold-500/50 group-hover:text-gold-300',
          )}
          aria-hidden
        >
          {selected ? '✓' : player.isSelf ? '•' : '+'}
        </span>
      )}
    </>
  );

  const classes = cn(
    'group relative flex w-full items-center gap-3 rounded-2xl border p-2.5 text-start transition-all',
    dead ? 'border-white/[0.05] bg-ink-950/50' : 'border-white/[0.08] bg-ink-900/70',
    selected && 'border-gold-500/70 bg-gold-500/[0.1] shadow-glow',
    interactive && 'cursor-pointer hover:border-gold-500/40 hover:bg-white/[0.04]',
    interactive && disabled && 'cursor-not-allowed opacity-55',
    !interactive && !selected && 'hover:border-white/15',
  );

  if (interactive) {
    return (
      <motion.button
        type="button"
        whileTap={{ scale: 0.985 }}
        onClick={() => !disabled && onSelect?.(player.id)}
        disabled={disabled}
        className={classes}
        aria-pressed={selected}
      >
        {content}
      </motion.button>
    );
  }

  return <div className={classes}>{content}</div>;
}
