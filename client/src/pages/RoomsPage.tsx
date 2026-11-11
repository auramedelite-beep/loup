import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  Clock,
  Crown,
  Eye,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Swords,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, errorCode } from '@/lib/api';
import { currentLanguage } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/contexts/SocketContext';
import { useToast } from '@/contexts/ToastContext';
import { Field, LoadingBlock, Modal, PageHeader, ProgressBar, Spinner, Toggle } from '@/components/ui';
import { cn, formatNumber, timeAgo } from '@/lib/format';
import { ROLE_IDS, roleMeta } from '@/lib/roles';
import type { GameMode, GameSettings, RoleId, RoomSummary } from '@/types';

const MODES: GameMode[] = ['classic', 'ranked', 'custom', 'quick', 'friends', 'practice'];
const MODE_ICONS: Record<GameMode, typeof Swords> = {
  classic: Swords,
  ranked: Trophy,
  custom: SlidersHorizontal,
  quick: Zap,
  friends: Users,
  practice: Bot,
};

interface CreateForm {
  name: string;
  mode: GameMode;
  isPrivate: boolean;
  isController: boolean;
  minPlayers: number;
  maxPlayers: number;
  nightSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  revealRoleOnDeath: boolean;
  allowVoteChange: boolean;
  tieRule: GameSettings['tieRule'];
  loversWin: boolean;
  witchSelfHeal: boolean;
  allowSpectators: boolean;
  roleCounts: Partial<Record<RoleId, number>>;
}

const DEFAULT_FORM: CreateForm = {
  name: '',
  mode: 'classic',
  isPrivate: false,
  isController: false,
  minPlayers: 6,
  maxPlayers: 10,
  nightSeconds: 40,
  discussionSeconds: 120,
  votingSeconds: 45,
  revealRoleOnDeath: true,
  allowVoteChange: true,
  tieRule: 'no_elimination',
  loversWin: true,
  witchSelfHeal: true,
  allowSpectators: true,
  roleCounts: {},
};

export function RoomsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { room, queue, createRoom, joinRoom, joinQueue, leaveQueue, matched, clearMatch } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState<'all' | GameMode>('all');
  const [search, setSearch] = useState('');
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState<'quick' | 'ranked' | null>(null);

  const [joinCode, setJoinCode] = useState(params.get('code')?.toUpperCase() ?? '');
  const [joinBusy, setJoinBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(DEFAULT_FORM);

  const load = useCallback(async () => {
    try {
      const data = await api<{ rooms: RoomSummary[] }>('/api/rooms', { auth: false });
      setRooms(data.rooms ?? []);
    } catch {
      /* keep previous list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (params.get('join') === '1') {
      // Focus is handled by autofocus on the code field.
      document.getElementById('join-code')?.focus();
    }
  }, [params]);

  useEffect(() => {
    if (matched) {
      clearMatch();
    }
  }, [matched, clearMatch]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rooms.filter((item) => {
      if (modeFilter !== 'all' && item.mode !== modeFilter) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.hostName.toLowerCase().includes(needle) ||
        item.code.toLowerCase().includes(needle)
      );
    });
  }, [rooms, modeFilter, search]);

  const errText = (code: string) => t(`errors.${code}`, { defaultValue: t('errors.unknown_error') });

  const requireLogin = () => {
    if (user) return true;
    navigate(`/auth/login?next=${encodeURIComponent('/rooms')}`);
    return false;
  };

  const join = async (code: string, asSpectator = false) => {
    if (!requireLogin()) return;
    setBusyCode(code);
    try {
      const ack = await joinRoom(code, asSpectator);
      if (!ack.ok) {
        toast.error(errText(ack.error ?? 'unknown_error'));
        return;
      }
      navigate(`/room/${String(ack.roomCode ?? code).toUpperCase()}`);
    } finally {
      setBusyCode(null);
    }
  };

  const submitCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 3) {
      toast.error(t('errors.invalid_code'));
      return;
    }
    setJoinBusy(true);
    try {
      await join(code);
    } finally {
      setJoinBusy(false);
    }
  };

  const quickQueue = async (mode: 'quick' | 'ranked') => {
    if (!requireLogin()) return;
    setQueueBusy(mode);
    try {
      const ack = await joinQueue(mode, currentLanguage());
      if (!ack.ok) toast.error(errText(ack.error ?? 'unknown_error'));
    } finally {
      setQueueBusy(null);
    }
  };

  const startQueue = async (mode: 'quick' | 'ranked') => {
    if (!requireLogin()) return;
    setQueueBusy(mode);
    try {
      const ack = await joinQueue(mode, currentLanguage());
      if (!ack.ok) toast.error(errText(ack.error ?? 'unknown_error'));
    } finally {
      setQueueBusy(null);
    }
  };

  const cancelQueue = async () => {
    await leaveQueue();
  };

  const submitCreate = async () => {
    if (!requireLogin()) return;
    setCreating(true);
    try {
      const settings: Partial<GameSettings> = {
        minPlayers: form.minPlayers,
        maxPlayers: form.maxPlayers,
        nightSeconds: form.nightSeconds,
        discussionSeconds: form.discussionSeconds,
        votingSeconds: form.votingSeconds,
        revealRoleOnDeath: form.revealRoleOnDeath,
        allowVoteChange: form.allowVoteChange,
        tieRule: form.tieRule,
        loversWin: form.loversWin,
        witchSelfHeal: form.witchSelfHeal,
        allowSpectators: form.allowSpectators,
        ...(form.mode === 'custom' ? { roleCounts: form.roleCounts } : {}),
      };
      const ack = await createRoom({
        name: form.name.trim() || undefined,
        isPrivate: form.isPrivate,
        mode: form.mode,
        isController: form.isController && form.mode !== 'ranked' && form.mode !== 'quick',
        settings,
      });
      if (!ack.ok) {
        toast.error(errText(ack.error ?? 'unknown_error'));
        return;
      }
      setCreateOpen(false);
      setForm(DEFAULT_FORM);
      navigate(`/room/${String(ack.roomCode)}`);
    } finally {
      setCreating(false);
    }
  };

  const roleTotal = Object.values(form.roleCounts).reduce((sum, value) => sum + (value ?? 0), 0);

  return (
    <div>
      <PageHeader
        eyebrow={t('common.appName')}
        title={t('rooms.title')}
        subtitle={t('rooms.subtitle')}
        actions={
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}>
              <RefreshCw size={14} />
              {t('rooms.refresh')}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Plus size={15} />
              {t('rooms.create')}
            </button>
          </>
        }
      />

      {room && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-500/25 bg-gold-500/[0.07] p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 text-gold-300">
              <Swords size={18} />
            </span>
            <div className="min-w-0">
              <p className="eyebrow mb-0.5">{t('rooms.yourRoom')}</p>
              <p className="truncate text-sm font-semibold text-parchment-100">
                {room.name} · <span className="tabular-nums text-gold-300">{room.code}</span>
              </p>
            </div>
          </div>
          <Link to={`/room/${room.code}`} className="btn-primary btn-sm">
            {t('rooms.backToRoom')}
          </Link>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {/* Filters */}
          <div className="card p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setModeFilter('all')}
                  className={cn('chip', modeFilter === 'all' && 'chip-active')}
                >
                  {t('common.all')}
                </button>
                {MODES.map((mode) => {
                  const Icon = MODE_ICONS[mode];
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setModeFilter(mode)}
                      className={cn('chip', modeFilter === mode && 'chip-active')}
                    >
                      <Icon size={13} />
                      {t(`rooms.modes.${mode}`)}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-mist" />
                  <input
                    className="input ps-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('rooms.searchPlaceholder')}
                  />
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingBlock label={t('common.loading')} />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center">
              <span className="text-4xl opacity-70" aria-hidden>
                🏚️
              </span>
              <h3 className="font-display text-lg font-semibold text-parchment-100">
                {search || modeFilter !== 'all' ? t('rooms.noRoomsFiltered') : t('rooms.noRooms')}
              </h3>
              <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
                {t('rooms.create')}
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((item) => {
                const Icon = MODE_ICONS[item.mode];
                const full = item.players >= item.maxPlayers;
                const inGame = item.status !== 'waiting';
                const isBusy = busyCode === item.code;
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="card p-4 transition-colors hover:border-gold-500/25"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gold-300">
                          <Icon size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="truncate font-display text-base font-semibold text-parchment-100">{item.name}</h3>
                            <span className="badge text-[10px]">{t(`rooms.modes.${item.mode}`)}</span>
                            {item.isPrivate && (
                              <span className="badge text-[10px]">
                                <KeyRound size={9} />
                                {t('rooms.privateBadge')}
                              </span>
                            )}
                            {item.status === 'waiting' ? (
                              <span className="badge-live text-[10px]">{t('rooms.waiting')}</span>
                            ) : (
                              <span className="badge-gold text-[10px]">
                                {t('rooms.inGame', { day: item.game?.day ?? 1 })}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mist">
                            <span className="inline-flex items-center gap-1">
                              <Crown size={11} className="text-gold-400" />
                              {item.hostName}
                            </span>
                            {item.bots > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Bot size={11} />
                                {item.bots}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Clock size={11} />
                              {timeAgo(item.createdAt, i18n.language)}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <ProgressBar
                              value={item.players}
                              max={item.maxPlayers}
                              tone={full ? 'blood' : item.players >= item.minPlayers ? 'emerald' : 'gold'}
                              className="max-w-[220px]"
                            />
                            <span className="shrink-0 text-[11px] tabular-nums text-mist">
                              {t('rooms.playersCount', { count: item.players, max: item.maxPlayers })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        {!inGame && !full && (
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={isBusy}
                            onClick={() => void join(item.code)}
                          >
                            {isBusy ? <Spinner size={13} /> : <Users size={14} />}
                            {t('common.join')}
                          </button>
                        )}
                        {(inGame || full) && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={isBusy}
                            onClick={() => void join(item.code, true)}
                          >
                            {isBusy ? <Spinner size={13} /> : <Eye size={14} />}
                            {t('rooms.spectate')}
                          </button>
                        )}
                        {!inGame && full && (
                          <button
                            type="button"
                            className="btn-subtle btn-sm"
                            disabled={isBusy}
                            onClick={() => void join(item.code, true)}
                          >
                            <Eye size={14} />
                            {t('rooms.spectate')}
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Side rail */}
        <aside className="space-y-4">
          {/* Matchmaking */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Zap size={17} className="text-gold-400" />
              <h2 className="font-display text-base font-semibold text-parchment-100">{t('rooms.quickMatch')}</h2>
            </div>
            {queue ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 rounded-xl border border-gold-500/25 bg-gold-500/[0.07] px-3 py-3 text-sm text-gold-200">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-gold-400" />
                  </span>
                  {t('rooms.searching')}
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-white/[0.03] px-2 py-2">
                    <p className="font-display text-lg font-bold tabular-nums text-gold-300">
                      {queue.players}/{queue.needed}
                    </p>
                    <p className="text-[10px] text-mist">{t('common.players')}</p>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-2 py-2">
                    <p className="font-display text-lg font-bold tabular-nums text-gold-300">{queue.waiting}s</p>
                    <p className="text-[10px] text-mist">{t('common.time')}</p>
                  </div>
                </div>
                <button type="button" className="btn-danger btn-sm w-full" onClick={() => void cancelQueue()}>
                  <X size={14} />
                  {t('rooms.cancelQueue')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-mist">{t('rooms.quickMatchText')}</p>
                <button
                  type="button"
                  className="btn-primary btn-sm w-full"
                  disabled={queueBusy !== null}
                  onClick={() => void startQueue('quick')}
                >
                  {queueBusy === 'quick' ? <Spinner size={14} /> : <Zap size={14} />}
                  {t('home.quickPlay')}
                </button>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-parchment-200">
                    <Trophy size={13} className="text-gold-400" />
                    {t('rooms.rankedMatch')}
                  </div>
                  <p className="mb-2 text-[11px] leading-relaxed text-mist">{t('rooms.rankedMatchText')}</p>
                  <button
                    type="button"
                    className="btn-ghost btn-sm w-full"
                    disabled={queueBusy !== null}
                    onClick={() => void startQueue('ranked')}
                  >
                    {queueBusy === 'ranked' ? <Spinner size={14} /> : <Trophy size={14} />}
                    {t('rooms.rankedMatch')}
                  </button>
                </div>
                <p className="text-center text-[10px] text-mist/70">{t('rooms.estimatedWait')}</p>
              </div>
            )}
          </div>

          {/* Join by code */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound size={17} className="text-gold-400" />
              <h2 className="font-display text-base font-semibold text-parchment-100">{t('rooms.joinByCode')}</h2>
            </div>
            <div className="flex gap-2">
              <input
                id="join-code"
                className="input text-center font-display uppercase tracking-[0.2em]"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 12))}
                placeholder={t('rooms.codePlaceholder')}
                maxLength={12}
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitCode();
                }}
              />
              <button
                type="button"
                className="btn-primary shrink-0 px-4"
                disabled={joinBusy || joinCode.trim().length < 3}
                onClick={() => void submitCode()}
              >
                {joinBusy ? <Spinner size={15} /> : t('rooms.join')}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-mist">{t('rooms.spectateHint')}</p>
          </div>

          <div className="card p-5">
            <div className="mb-2 flex items-center gap-2">
              <Users size={16} className="text-gold-400" />
              <h2 className="font-display text-base font-semibold text-parchment-100">{t('rooms.create')}</h2>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-mist">{t('rooms.createSubtitle')}</p>
            <button type="button" className="btn-ghost btn-sm w-full" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />
              {t('rooms.createRoom')}
            </button>
          </div>

          <p className="px-1 text-[10px] leading-relaxed text-mist/60">{t('rooms.offlineNote')}</p>
        </aside>
      </div>

      {/* Create room modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('rooms.createTitle')}
        subtitle={t('rooms.createSubtitle')}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={creating} onClick={() => void submitCreate()}>
              {creating ? <Spinner size={15} /> : <Plus size={15} />}
              {creating ? t('rooms.creating') : t('rooms.createRoom')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('rooms.name')} htmlFor="room-name" hint={t('rooms.nameHint')}>
            <input
              id="room-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={t('rooms.namePlaceholder')}
              maxLength={40}
            />
          </Field>

          <div>
            <p className="label">{t('rooms.mode')}</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {MODES.filter((mode) => mode !== 'quick').map((mode) => {
                const Icon = MODE_ICONS[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForm({ ...form, mode })}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-2.5 text-start transition-colors',
                      form.mode === mode
                        ? 'border-gold-500/60 bg-gold-500/10'
                        : 'border-white/10 bg-white/[0.02] hover:border-gold-500/30',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-parchment-100">
                      <Icon size={13} className="text-gold-400" />
                      {t(`rooms.modes.${mode}`)}
                    </span>
                    <span className="text-[10px] leading-snug text-mist">{t(`rooms.modeHints.${mode}`)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {form.mode !== 'ranked' && form.mode !== 'quick' && (
            <Field label={t('rooms.controller')} htmlFor="room-controller" hint={t('rooms.controllerCreateHint')}>
              <select
                id="room-controller"
                className="select w-full"
                value={form.isController ? user?.id ?? '' : ''}
                onChange={(event) => setForm({ ...form, isController: event.target.value === user?.id })}
              >
                <option value="">{t('rooms.noController')}</option>
                {user && <option value={user.id}>{user.username} — {t('rooms.controller')}</option>}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('rooms.minPlayers')} htmlFor="min-players">
              <input
                id="min-players"
                type="number"
                className="input"
                min={6}
                max={form.maxPlayers}
                value={form.minPlayers}
                onChange={(event) =>
                  setForm({ ...form, minPlayers: Math.min(form.maxPlayers, Math.max(6, Number(event.target.value) || 6)) })
                }
              />
            </Field>
            <Field label={t('rooms.maxPlayers')} htmlFor="max-players">
              <input
                id="max-players"
                type="number"
                className="input"
                min={form.minPlayers}
                max={18}
                value={form.maxPlayers}
                onChange={(event) =>
                  setForm({ ...form, maxPlayers: Math.min(18, Math.max(form.minPlayers, Number(event.target.value) || 10)) })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ['nightSeconds', t('rooms.nightSeconds')],
                ['discussionSeconds', t('rooms.discussionSeconds')],
                ['votingSeconds', t('rooms.votingSeconds')],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label} htmlFor={key}>
                <input
                  id={key}
                  type="number"
                  className="input"
                  min={key === 'nightSeconds' ? 15 : key === 'votingSeconds' ? 15 : 30}
                  max={key === 'discussionSeconds' ? 600 : key === 'votingSeconds' ? 180 : 120}
                  value={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) || 0 })}
                />
              </Field>
            ))}
          </div>

          <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <ToggleRow
              label={t('rooms.private')}
              hint={t('rooms.privateHint')}
              checked={form.isPrivate}
              onChange={(value) => setForm({ ...form, isPrivate: value })}
            />
            <ToggleRow
              label={t('rooms.revealRole')}
              checked={form.revealRoleOnDeath}
              onChange={(value) => setForm({ ...form, revealRoleOnDeath: value })}
            />
            <ToggleRow
              label={t('rooms.allowVoteChange')}
              checked={form.allowVoteChange}
              onChange={(value) => setForm({ ...form, allowVoteChange: value })}
            />
            <ToggleRow
              label={t('rooms.loversWin')}
              checked={form.loversWin}
              onChange={(value) => setForm({ ...form, loversWin: value })}
            />
            <ToggleRow
              label={t('rooms.witchSelfHeal')}
              checked={form.witchSelfHeal}
              onChange={(value) => setForm({ ...form, witchSelfHeal: value })}
            />
            <ToggleRow
              label={t('rooms.allowSpectators')}
              checked={form.allowSpectators}
              onChange={(value) => setForm({ ...form, allowSpectators: value })}
            />
          </div>

          <div>
            <p className="label">{t('rooms.tieRule')}</p>
            <div className="flex gap-1.5">
              {(['no_elimination', 'random'] as const).map((rule) => (
                <button
                  key={rule}
                  type="button"
                  onClick={() => setForm({ ...form, tieRule: rule })}
                  className={cn('chip', form.tieRule === rule && 'chip-active')}
                >
                  {t(`rooms.tieRules.${rule}`)}
                </button>
              ))}
            </div>
          </div>

          <AnimatePresence>
            {form.mode === 'custom' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-parchment-100">{t('rooms.roleCounts')}</p>
                      <p className="text-[10px] text-mist">{t('rooms.roleCountsHint')}</p>
                    </div>
                    <span className="badge-gold text-[10px] tabular-nums">{roleTotal}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {ROLE_IDS.map((role) => {
                      const count = form.roleCounts[role] ?? 0;
                      const maxCopies = role === 'villager' || role === 'werewolf' ? form.maxPlayers : 1;
                      const meta = roleMeta(role);
                      const RoleIcon = meta.icon;
                      return (
                        <div
                          key={role}
                          className="flex items-center justify-between gap-1 rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5"
                        >
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-parchment-200">
                            <RoleIcon size={14} strokeWidth={1.8} aria-hidden />
                            <span className="truncate">{t(`roles.${role}.name`)}</span>
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.06] text-xs text-parchment-200 disabled:opacity-30"
                              disabled={count <= 0}
                              onClick={() => setForm({ ...form, roleCounts: { ...form.roleCounts, [role]: count - 1 } })}
                              aria-label="-"
                            >
                              −
                            </button>
                            <span className="w-4 text-center text-[11px] tabular-nums text-gold-300">{count}</span>
                            <button
                              type="button"
                              className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.06] text-xs text-parchment-200 disabled:opacity-30"
                              disabled={count >= maxCopies}
                              onClick={() => setForm({ ...form, roleCounts: { ...form.roleCounts, [role]: count + 1 } })}
                              aria-label="+"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Modal>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-parchment-200">{label}</p>
        {hint && <p className="text-[10px] leading-snug text-mist">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
