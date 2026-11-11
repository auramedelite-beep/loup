import { Bot, Crown, LogOut, ShieldCheck, UserMinus, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoomPlayer } from '@/types';
import { Avatar } from './Avatar';
import { cn } from '@/lib/format';

export function PlayerCard({
  player,
  isSelf,
  canManage = false,
  onKick,
  onTransfer,
}: {
  player: RoomPlayer;
  isSelf: boolean;
  canManage?: boolean;
  onKick?: () => void;
  onTransfer?: () => void;
}) {
  const { t } = useTranslation();
  const offline = !player.connected && !player.isBot;

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 rounded-2xl border bg-ink-900/60 p-3 transition-colors',
        isSelf ? 'border-gold-500/35 bg-gold-500/[0.06]' : 'border-white/[0.07] hover:border-white/15',
        offline && 'opacity-65',
      )}
    >
      <div className="relative">
        <Avatar avatar={player.avatar} size="md" online={player.isBot ? undefined : player.connected} />
        <span className="absolute -start-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-white/10 bg-ink-950 px-1 text-[10px] font-bold text-mist">
          {player.seat + 1}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-parchment-100">{player.username}</p>
          {player.isHost && <Crown size={13} className="shrink-0 text-gold-400" aria-label={t('common.host')} />}
          {player.isBot && <Bot size={13} className="shrink-0 text-purple-300" aria-label={t('common.bots')} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-mist">
          <span>{t('common.level')} {player.level}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{player.rating}</span>
          {isSelf && <span className="rounded bg-gold-500/15 px-1.5 py-0.5 font-semibold text-gold-300">{t('common.you')}</span>}
          {player.isGuest && <span className="rounded bg-white/[0.06] px-1.5 py-0.5">{t('common.guest')}</span>}
          {offline && (
            <span className="inline-flex items-center gap-1 text-blood-400">
              <WifiOff size={10} /> {t('common.offline')}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {player.isBot ? (
          <span className="badge-live text-[10px]">AI</span>
        ) : player.ready ? (
          <span className="badge border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <ShieldCheck size={11} />
            {t('common.ready')}
          </span>
        ) : (
          <span className="badge text-[10px]">{t('common.notReady')}</span>
        )}
      </div>

      {canManage && !isSelf && !player.isBot && (
        <div className="absolute inset-y-0 end-0 flex items-center gap-0.5 rounded-e-2xl bg-gradient-to-l from-ink-900 via-ink-900/95 to-transparent pe-2 ps-6 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {onTransfer && (
            <button
              type="button"
              onClick={onTransfer}
              className="rounded-lg p-1.5 text-mist transition-colors hover:bg-gold-500/10 hover:text-gold-300"
              title={t('lobby.transferHost')}
              aria-label={t('lobby.transferHost')}
            >
              <LogOut size={14} className="rotate-180" />
            </button>
          )}
          {onKick && (
            <button
              type="button"
              onClick={onKick}
              className="rounded-lg p-1.5 text-mist transition-colors hover:bg-blood-900/40 hover:text-blood-400"
              title={t('lobby.kickPlayer')}
              aria-label={t('lobby.kickPlayer')}
            >
              <UserMinus size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
