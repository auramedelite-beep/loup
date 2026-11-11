import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  ClipboardCopy,
  Crown,
  DoorOpen,
  Eye,
  Gavel,
  LogOut,
  Moon,
  Play,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
  Skull,
  Swords,
  UserCheck,
  UserX,
  Users,
  Vote,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket, type NightActionInput } from '@/contexts/SocketContext';
import { useToast } from '@/contexts/ToastContext';
import { useClipboard } from '@/hooks/useClipboard';
import { Avatar } from '@/components/Avatar';
import { ChatPanel } from '@/components/ChatPanel';
import { RoleCard } from '@/components/RoleCard';
import {
  ConfirmDialog,
  Field,
  LoadingBlock,
  Modal,
  ProgressBar,
  SectionHeading,
  Spinner,
  TimerRing,
  Toggle,
} from '@/components/ui';
import { cn, formatClock } from '@/lib/format';
import { roleMeta, ROLE_META, TEAM_META } from '@/lib/roles';
import type {
  GameMode,
  GameSettings,
  GameView,
  RoleId,
  NightPrompt,
  Phase,
  Phase as PhaseType,
  RoomPlayer,
  RoomPublic,
  Team,
  PublicUser,
} from '@/types';
import type { GameEndPayload, NightActionInput as SIOInput } from '@/contexts/SocketContext';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const MODE_LABELS: Record<GameMode, string> = {
  classic: 'game.modeClassic',
  ranked: 'game.modeRanked',
  custom: 'game.modeCustom',
  quick: 'game.modeQuick',
  friends: 'game.modeFriends',
  practice: 'game.modePractice',
};

const TIE_RULE_LABELS: Record<'no_elimination' | 'random', string> = {
  no_elimination: 'game.tieRuleNoElimination',
  random: 'game.tieRuleRandom',
};

function TeamIcon({ team }: { team: Team }): React.ReactNode {
  const Icon = TEAM_META[team].icon;
  return <Icon size={13} strokeWidth={1.8} aria-hidden />;
}

function errText(code?: string): string {
  const fallback = 'errors.unknown_error';
  return code ? (/* i18n would handle but we have token available */ fallback) : fallback;
}

/* ── Main Component ──────────────────────────────────────────────────────── */

export function RoomPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const {
    room,
    game,
    gameEnd,
    isHost,
    isSpectator,
    connected,
    subscribe,
    joinRoom,
    leaveRoom,
    setReady,
    setController,
    startGame,
    advanceAsController,
    kick,
    transferHost,
    updateSettings,
    rematch,
    gameAction,
    gameVote,
    gameHunter,
    queue,
  } = useSocket();

  const me = useMemo(() => room?.players?.find((p: RoomPlayer) => p.id === user?.id) ?? null, [room?.players, user?.id]);
  const spectator = Array.isArray(room?.spectators) ? room!.spectators.some((s) => s.id === user?.id) : false;
  const isMember = me !== null;
  const roomPlayers = room?.players ?? [];

  const navigate = useNavigate();
  const { code: rtCode } = useParams<{ code: string }>();
  const clipboard = useClipboard();
  const toast = useToast();

  /* ── State ─────────────────────────────────────────────────────────────── */
  const [loading, setLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<Partial<GameSettings>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [kickTarget, setKickTarget] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [roleRevealDone, setRoleRevealDone] = useState(false);
  const [showWolfChat, setShowWolfChat] = useState(false);

  /* ── Subscribe on mount ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!rtCode || !user) return;
    let cancelled = false;
    void (async () => {
      setSubError(null);
      const ack = await subscribe(rtCode.toUpperCase());
      if (cancelled) return;
      if (!ack.ok) {
        if (ack.error === 'not_in_room') {
          setSubError('join_prompt');
        } else {
          toast.error(errText(ack.error));
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [rtCode, user, subscribe]);

  /* ── Navigate back if left room ────────────────────────────────────────── */
  useEffect(() => {
    if (room === null && !loading && !subError) {
      navigate('/rooms');
    }
  }, [room, loading, subError, navigate]);

  /* ── Reset actions when game changes ────────────────────────────────────── */
  useEffect(() => {
    setRoleRevealDone(false);
    setActionBusy(false);
  }, [game]);

  /* ── Show component based on state ─────────────────────────────────────── */

  // 1. Loading or join prompt
  if (loading) return <LoadingBlock />;
  if (subError === 'join_prompt' || !room) return <JoinPrompt code={rtCode} onJoin={joinRoom} />;
  if (subError) return <div className="card p-6 text-center">{t(subError)}</div>;

  // 2. Not a member at all
  if (!isMember && !me) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-6 p-6">
        <div className="card p-8 max-w-md w-full text-center">
          <h1 className="font-display text-xl font-semibold text-parchment-100">{t('rooms.title')}</h1>
          <p className="text-sm text-mist">{t('rooms.subtitle')}</p>
          <p className="mt-4 text-[12px] text-gold-300">{t('errors.join_code')}</p>
          <button className="btn-primary mt-3">{t('rooms.createNew')}</button>
        </div>
      </div>
    );
  }

  // ── 3. LOBBY ──────────────────────────────────────────────────────────
  if (game === null) {
    return <LobbyRender room={room!} user={user!} isHost={isHost!} subscribe={subscribe} joinRoom={joinRoom} leaveRoom={leaveRoom} setReady={setReady} setController={setController} kick={kick} startGame={startGame} updateSettings={updateSettings} rematch={rematch} />;
  }

  // ── 4. GAME PHASES ────────────────────────────────────────────────────
  return <GameRender room={room!} game={game!} gameEnd={gameEnd} isHost={isHost!} isSpectator={spectator} user={user!} actionBusy={actionBusy} setActionBusy={setActionBusy} roleRevealDone={roleRevealDone} setRoleRevealDone={setRoleRevealDone} gameAction={gameAction} gameVote={gameVote} gameHunter={gameHunter} advanceAsController={advanceAsController} updateSettings={updateSettings} rematch={rematch} />;
}

/* ── 5. Join Prompt ────────────────────────────────────────────────────── */

function JoinPrompt({ code: initCode, onJoin }: { code: string | undefined; onJoin: (code: string, asSpectator?: boolean) => Promise<{ ok: boolean; error?: string }> }) {
  const { t } = useTranslation();
  const [code, setCode] = useState(initCode ?? '');
  const [joinBusy, setJoinBusy] = useState(false);

  const handleJoin = async () => {
    if (!code.trim() || joinBusy) return;
    setJoinBusy(true);
    try {
      await onJoin(code);
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-6 p-6">
      <div className="card p-8 max-w-md w-full text-center space-y-4">
        <h1 className="font-display text-3xl font-bold text-parchment-100">{t('rooms.title')}</h1>
        <p className="text-sm text-mist">{t('rooms.subtitle')}</p>
        <div className="flex gap-2">
          <input
            className="input w-52 uppercase tracking-wider tracking-widest text-center placeholder:text-[2xl] font-display"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('rooms.codePlaceholder')}
            maxLength={12}
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-ghost btn-sm" onClick={() => window.open('/rooms', '_self')}>{t('common.cancel')}</button>
          <button className="btn-primary btn-sm" onClick={handleJoin} disabled={joinBusy}>
            {joinBusy ? <Spinner size={14} /> : <Eye size={15} />} {t('rooms.join')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 6. Lobby Render ───────────────────────────────────────────────────── */

function LobbyRender({
  room, user, isHost, subscribe, joinRoom, leaveRoom, setReady, setController, kick, startGame, updateSettings, rematch,
}: {
  room: RoomPublic; user: PublicUser; isHost: boolean; subscribe: any; joinRoom: any; leaveRoom: any; setReady: (ready: boolean) => Promise<{ ok: boolean; error?: string }>; setController: (controllerId: string | null) => Promise<{ ok: boolean; error?: string }>; kick: (targetId: string) => Promise<{ ok: boolean; error?: string }>; startGame: any; updateSettings: any; rematch: any;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();

  /* ── State ─────────────────────────────────────────────────────────────── */
  const [settings, setSettings] = useState<Partial<GameSettings>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [controllerBusy, setControllerBusy] = useState(false);
  const roomPlayers = room.players;
  const myPlayer = roomPlayers.find((player) => player.id === user.id);
  const isControllerModeAllowed = room.mode !== 'ranked' && room.mode !== 'quick';

  const updateController = async (controllerId: string | null) => {
    setControllerBusy(true);
    const ack = await setController(controllerId);
    setControllerBusy(false);
    if (!ack.ok) toast.error(t(`errors.${ack.error ?? 'unknown_error'}`));
  };

  const updateReady = async (value: boolean) => {
    const ack = await setReady(value);
    if (!ack.ok) toast.error(t(`errors.${ack.error ?? 'unknown_error'}`));
  };

  /* ── Leave confirm ────────────────────────────────────────────────────── */
  const doLeave = async () => {
    const result = await leaveRoom();
    if (result.ok) navigate('/rooms');
  };

  /* ── Settings modal ───────────────────────────────────────────────────── */
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);
  const handleSettings = async (newSettings: Partial<GameSettings>) => {
    setSettings(newSettings);
    if (isHost) {
      setSettingsBusy(true);
      try {
        const ack = await updateSettings(newSettings);
        if (!ack.ok) toast.error(errText(ack.error));
      } finally {
        setSettingsBusy(false);
      }
    }
  };

  /* ── Kick/transfer ────────────────────────────────────────────────────── */
  const doKick = async (targetId: string) => {
    const ack = await kick(targetId);
    if (ack.ok) toast.success(t('kick.success'));
  };
  /* ── Create form fields ────────────────────────────────────────────────── */
  const modeOptions = ['classic', 'ranked', 'custom', 'quick', 'friends', 'practice'] as const;

  return (
    <div className="space-y-6 pt-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-parchment-100">{t('rooms.title')}</h1>
          <p className="text-sm text-mist">{t('rooms.subtitle')}</p>
        </div>
        {isHost && (
          <div className="flex items-center gap-3">
            <button className="btn-primary btn-sm" onClick={() => void startGame()}>{t('rooms.startGame')}</button>
            <button className="btn-ghost btn-sm" onClick={openSettings}>{t('settings')}</button>
          </div>
        )}
      </header>

      {/* Your room info */}
      {room && (
        <div className="card p-4 mb-4 rounded-2xl border border-gold-500/25 bg-gold-500/[0.07]">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 text-gold-300">
              <Swords size={18} />
            </span>
            <div>
              <p className="eyebrow mb-0.5">{t('rooms.yourRoom')}</p>
              <p className="truncate font-display text-sm font-semibold text-parchment-100">{room.name}</p>
              <p className="text-[10px] tabular-nums text-gold-300">{t('rooms.code')} {room.code}</p>
            </div>
          </div>
        </div>
      )}

      {isHost && isControllerModeAllowed && (
        <div className="card space-y-2 p-4">
          <Field label={t('lobby.chooseController')} htmlFor="lobby-controller" hint={t('rooms.controllerHint')}>
            <select
              id="lobby-controller"
              className="select w-full"
              value={room.controllerId ?? ''}
              disabled={controllerBusy}
              onChange={(event) => void updateController(event.target.value || null)}
            >
              <option value="">{t('lobby.controllerUnset')}</option>
              {roomPlayers
                .filter((player) => player.connected && !player.isBot)
                .map((player) => (
                  <option key={player.id} value={player.id}>{player.username}</option>
                ))}
            </select>
          </Field>
        </div>
      )}

      {/* Players list */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roomPlayers.map((p: RoomPlayer) => (
          <motion.div
            key={p.id}
            layout
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="card p-3 sm:p-4 rounded-xl border border-white/10 bg-white/05 text-left"
          >
            <div className="flex items-center gap-2">
              {p.isHost && <span className="text-gold-400 text-xs">★</span>}
              <Avatar avatar={p.avatar} size="sm" />
              <span className="font-display text-sm font-medium text-parchment-100">{p.username}</span>
              {p.isController && <span className="badge-gold text-[10px]">{t('rooms.controller')}</span>}
            </div>
            <div className="mt-1 flex items-center gap-1">
              {p.isController
                ? <span className="text-xs text-gold-300">{t('rooms.controller')}</span>
                : <Toggle checked={p.ready} onChange={(value) => void updateReady(value)} label={t('rooms.ready')} />}
              {isHost && (
                <button
                  className="btn-ghost btn-xs text-gold-400"
                  onClick={() => doKick(p.id)}
                  title={t('rooms.kick', { username: p.username })}
                >
                  <Ban size={11} />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Start / Ready controls */}
      {isHost && (
        <div className="mt-4 flex gap-2">
          <button className="btn-primary" onClick={() => void startGame()}>{t('rooms.startGame')}</button>
          {!myPlayer?.isController && myPlayer && (
            <Toggle checked={myPlayer.ready} onChange={(value) => void updateReady(value)} label={t('rooms.ready')} />
          )}
        </div>
      )}

      {/* Leave button */}
      <button
        className="mt-2 btn-ghost w-full"
        onClick={() => setLeaveConfirm(true)}
      >
        {t('rooms.leave')}
      </button>

      <ConfirmDialog
        open={leaveConfirm}
        title={t('rooms.leaveConfirm')}
        message={t('rooms.leaveConfirmMsg')}
        onConfirm={doLeave}
        onClose={() => setLeaveConfirm(false)}
      />

      {/* Settings modal */}
      {settingsOpen && (
        <Modal open={settingsOpen} onClose={closeSettings} title={t('settings')} subtitle={t('settingsSubtitle')} size="lg">
          <Field label={t('rooms.mode')} htmlFor="mode-select">
            <select
              id="mode-select"
              className="select sm:w-48"
              value={settings.mode ?? 'classic'}
              onChange={(e) => setSettings({ ...settings, mode: e.target.value as GameMode })}
            >
              {modeOptions.map((m) => (
                <option key={m} value={m}>{t(MODE_LABELS[m])}</option>
              ))}
            </select>
          </Field>

          <Field label={t('rooms.minPlayers')} htmlFor="min-players">
            <input
              id="min-players"
              type="number"
              className="input"
              min={6}
              max={18}
              value={settings.minPlayers ?? room.settings?.minPlayers ?? 6}
              onChange={(e) => setSettings({ ...settings, minPlayers: Number(e.target.value) || 6 })}
            />
          </Field>
          <Field label={t('rooms.maxPlayers')} htmlFor="max-players">
            <input
              id="max-players"
              type="number"
              className="input"
              min={6}
              max={18}
              value={settings.maxPlayers ?? room.settings?.maxPlayers ?? 10}
              onChange={(e) => setSettings({ ...settings, maxPlayers: Number(e.target.value) || 10 })}
            />
          </Field>

          <Field label={t('rooms.nightSeconds')} htmlFor="night-seconds">
            <input
              id="night-seconds"
              type="number"
              className="input"
              min={15}
              max={120}
              value={settings.nightSeconds ?? room.settings?.nightSeconds ?? 40}
              onChange={(e) => setSettings({ ...settings, nightSeconds: Number(e.target.value) || 40 })}
            />
          </Field>
          <Field label={t('rooms.discussionSeconds')} htmlFor="discussion-seconds">
            <input
              id="discussion-seconds"
              type="number"
              className="input"
              min={30}
              max={600}
              value={settings.discussionSeconds ?? room.settings?.discussionSeconds ?? 120}
              onChange={(e) => setSettings({ ...settings, discussionSeconds: Number(e.target.value) || 120 })}
            />
          </Field>
          <Field label={t('rooms.votingSeconds')} htmlFor="voting-seconds">
            <input
              id="voting-seconds"
              type="number"
              className="input"
              min={15}
              max={180}
              value={settings.votingSeconds ?? room.settings?.votingSeconds ?? 45}
              onChange={(e) => setSettings({ ...settings, votingSeconds: Number(e.target.value) || 45 })}
            />
          </Field>

          <div className="mt-4">
            <Toggle checked={settings.revealRoleOnDeath ?? true} onChange={(v) => setSettings({ ...settings, revealRoleOnDeath: v })} label={t('rooms.revealRole')} />
            <Toggle checked={settings.allowVoteChange ?? true} onChange={(v) => setSettings({ ...settings, allowVoteChange: v })} label={t('rooms.allowVoteChange')} />
            <Toggle checked={settings.loversWin ?? true} onChange={(v) => setSettings({ ...settings, loversWin: v })} label={t('rooms.loversWin')} />
            <Toggle checked={settings.witchSelfHeal ?? true} onChange={(v) => setSettings({ ...settings, witchSelfHeal: v })} label={t('rooms.witchSelfHeal')} />
          </div>

          <div className="mt-4">
            <Toggle checked={settings.allowSpectators ?? true} onChange={(v) => setSettings({ ...settings, allowSpectators: v })} label={t('rooms.allowSpectators')} />
          </div>

          <div className="mt-6">
            <button className="btn-primary w-full" onClick={() => void handleSettings(settings)} disabled={settingsBusy}>
              {settingsBusy ? <Spinner size={16} /> : t('common.save')}
            </button>
            <button className="btn-ghost w-full mt-2" onClick={closeSettings}>{t('common.cancel')}</button>
          </div>
        </Modal>
      )}

    </div>
  );
}

/* ── 7. Game Render ────────────────────────────────────────────────────── */

function GameRender({
  room, game, gameEnd, isHost, isSpectator, user, actionBusy, setActionBusy, roleRevealDone, setRoleRevealDone, gameAction, gameVote, gameHunter, advanceAsController, updateSettings, rematch,
}: {
  room: RoomPublic;
  game: GameView;
  gameEnd: GameEndPayload | null;
  isHost: boolean;
  isSpectator: boolean;
  user: PublicUser;
  actionBusy: boolean;
  setActionBusy: (busy: boolean) => void;
  roleRevealDone: boolean;
  setRoleRevealDone: (done: boolean) => void;
  gameAction: (action: NightActionInput) => Promise<{ ok: boolean; error?: string }>;
  gameVote: (targetId: string) => Promise<{ ok: boolean; error?: string }>;
  gameHunter: (targetId: string | null) => Promise<{ ok: boolean; error?: string }>;
  advanceAsController: () => Promise<{ ok: boolean; error?: string }>;
  updateSettings: any;
  rematch: any;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  /* ── State ─────────────────────────────────────────────────────────────── */
  const alivePlayers = game.players.filter((p) => p.alive);
  const myPlayer = game.self;
  const prompt = game.prompt;
  const vote = game.vote;

  /* ── Night action selections (simple version) ──────────────────────────── */
  const [nightAction, setNightAction] = useState<NightActionInput | null>(null);
  const [voteTarget, setVoteTarget] = useState<string | null>(null);
  const [selectedVoter, setSelectedVoter] = useState<string | null>(null);

  /* ── Night prompt displayed to the active player ───────────────────────── */
  const showNightPrompt = useMemo(() => {
    if (!prompt) return null;
    const myRole = myPlayer?.role ?? null;
    const myTeam = myPlayer?.team ?? null;

    // Only show prompt to the player who has action
    if (myTeam && prompt.targetIds && prompt.targetIds.length > 0) {
      return prompt;
    }
    return null;
  }, [prompt, myPlayer]);

  /* ── Handle night action ───────────────────────────────────────────────── */
  const handleNightAction = async (action: NightActionInput) => {
    setActionBusy(true);
    const ack = await gameAction(action);
    setActionBusy(false);
    if (!ack.ok) toast.error(t(`errors.${ack.error ?? 'unknown_error'}`));
    return ack;
  };

  /* ── Handle vote ───────────────────────────────────────────────────────── */
  const handleVote = async (targetId: string) => {
    setActionBusy(true);
    const ack = await gameVote(targetId);
    setActionBusy(false);
    if (!ack.ok) toast.error(t(`errors.${ack.error ?? 'unknown_error'}`));
  };

  /* ── Handle hunter ─────────────────────────────────────────────────────── */
  const handleHunter = async (targetId: string | null) => {
    setActionBusy(true);
    const ack = await gameHunter(targetId);
    setActionBusy(false);
    if (!ack.ok) toast.error(t(`errors.${ack.error ?? 'unknown_error'}`));
  };

  if (game.isController) {
    const advance = async () => {
      const ack = await advanceAsController();
      if (!ack.ok) toast.error(t(`errors.${ack.error ?? 'unknown_error'}`));
    };

    return (
      <div className="phase-screen">
        <SectionHeading title={t('game.controllerTitle')} subtitle={t('rooms.controllerHint')} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-mist">
            {t('game.dayLabel', { day: game.day })} · {t(`game.phases.${game.phase}`)}
          </p>
          <TimerRing endsAt={game.phaseEndsAt} serverNow={game.serverNow} total={120} />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {game.players.map((player) => (
            <div key={player.id} className="card flex items-center justify-between gap-3 p-3">
              <span className="font-display text-sm text-parchment-100">{player.username}</span>
              <span className="text-xs text-gold-300">
                {player.revealedRole ? t(`roles.${player.revealedRole}.name`) : '—'}
                {' · '}
                {player.alive ? t('common.alive') : t('common.dead')}
              </span>
            </div>
          ))}
        </div>
        <button type="button" className="btn-primary mt-5 w-full" onClick={() => void advance()}>
          <Gavel size={15} />
          {t('game.controllerAdvance')}
        </button>
      </div>
    );
  }

  /* ── Render per phase ──────────────────────────────────────────────────── */

  // Role reveal
  if (game.phase === 'role_reveal' && !roleRevealDone) {
    return <RoleRevealCinematic role={myPlayer!.role} onDone={() => setRoleRevealDone(true)} />;
  }

  // Night
  if (game.phase === 'night') {
    return <NightPhase
      game={game}
      prompt={prompt!}
      myPlayer={myPlayer!}
      alivePlayers={alivePlayers}
      onAction={handleNightAction}
      isSpectator={isSpectator}
    />;
  }

  // Dawn
  if (game.phase === 'dawn') {
    return <div className="phase-screen">
      <h2 className="font-display text-xl font-bold text-parchment-100">{t('game.dawn')}</h2>
      <TimerRing endsAt={game.phaseEndsAt} serverNow={game.serverNow ?? Date.now()} total={60} />
    </div>;
  }

  // Discussion
  if (game.phase === 'discussion') {
    return (
      <div className="phase-screen">
        <SectionHeading
          title={t('game.discussion')}
          subtitle={t(`game.phase${game.day}Subtitle`, { day: game.day })}
        />
        <div className="mt-6">
          <h3 className="font-display text-base font-semibold text-parchment-100">{t('game.playersAlive', { count: alivePlayers.length })}</h3>
          <p className="text-mist text-sm">{t('game.day', { day: game.day })}</p>
          <ChatPanel height="h-[350px]" />
        </div>
      </div>
    );
  }

  // Voting
  if (game.phase === 'voting') {
    const votedCount = vote.votedCount ?? 0;
    const voterCount = vote.voterCount ?? 0;
    const ownVote = vote.ownVote ?? null;
    const counts = vote.counts ?? {};
    const hasVoted = !!ownVote;

    return (
      <div className="phase-screen">
        <SectionHeading
          title={t('game.voting')}
          subtitle={t('game.voteProgress', { voted: votedCount, total: voterCount })}
        />
        <div className="mt-6 space-y-4">
          <p className="text-sm text-mist">{t('game.voteCount', { voted: votedCount, voterCount })}</p>
          {vote.weakenedId && myPlayer?.role === 'owl' && (
            <p className="rounded-lg border border-indigo-400/20 bg-indigo-400/5 px-3 py-2 text-sm text-indigo-200">
              {t('game.owlTargetNote', { name: alivePlayers.find((player) => player.id === vote.weakenedId)?.username ?? '—' })}
            </p>
          )}

          {/* Show per-player votes only during live voting (privacy) */}
          {isHost || isSpectator ? (
            <div className="grid gap-2">
              {alivePlayers.map((p) => (
                <div key={p.id} className="p-2 rounded border border-white/10 bg-white/05">
                  <span className="font-display text-sm text-parchment-100">{p.username}</span>
                  <ProgressBar value={counts[p.id] ?? 0} max={voterCount} tone="gold" />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-mist/60">{t('game.votesHidden')}</p>
          )}

          {/* Vote buttons - only show to living players who haven't voted */}
          {!isSpectator && !hasVoted && myPlayer?.alive && (
            <div className="mt-4">
              <p className="text-xs text-mist/50">{t('game.voteFor')}</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {alivePlayers.map((p) => (
                  <button
                    key={p.id}
                    className="btn-primary btn-block text-xs"
                    onClick={() => handleVote(p.id)}
                    disabled={Boolean(vote.markedId && vote.markedId !== p.id)}
                  >
                    {p.username}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Vote result transition */}
          {vote.result && (
            <div className="mt-6 p-4 rounded border border-gold-500/20 bg-gold-500/05">
              <p className="font-display text-base text-gold-300">{t('game.eliminated', { player: t(`roles.${vote.result?.eliminatedId ?? 'unknown'}.name`) })}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Vote result
  if (game.phase === 'vote_result') {
    return (
      <div className="phase-screen">
        <SectionHeading title={t('game.voteResult')} subtitle={t('game.eliminated', { player: '—' }) } />
        <p className="mt-4 text-2xl text-gold-300">{t('game.noElimination')}</p>
        <div className="mt-6 text-center">
          <button className="btn-primary">{t('game.continue')}</button>
        </div>
      </div>
    );
  }

  // Hunter
  if (game.phase === 'hunter') {
    const hunterId = game.pendingHunterId;
    const alive = alivePlayers.filter((p) => p.alive);

    return (
      <div className="phase-screen">
        <SectionHeading
          title={t('game.hunter')}
          subtitle={
            hunterId
              ? t('game.hunterTarget', { player: t(`roles.${myPlayer?.role ?? 'villager'}.name`) })
              : t('game.noHunter')
          }
        />
        {hunterId && myPlayer?.team === 'village' && (
          <div className="mt-4">
            <p className="text-sm text-mist">{t('game.hunterShot', { target: t(`roles.${myPlayer?.role ?? 'villager'}.name`) })}</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {alive.map((p) => (
                <button
                  key={p.id}
                  className="btn-primary btn-block text-xs"
                  onClick={() => handleHunter(p.id === myPlayer?.id ? null : p.id)}
                  disabled={p.id === myPlayer?.id}
                >
                  {p.username}
                </button>
              ))}
            </div>
          </div>
        )}
        {!hunterId && (
          <p className="mt-4 text-gold-300">{t('game.hunterShotSent')}</p>
        )}
      </div>
    );
  }

  // Ended
  if (game.phase === 'ended' && gameEnd) {
    return (
      <div className="phase-screen ended-screen">
        <h2 className="font-display text-2xl font-bold text-gold-300">{t('game.' + (gameEnd.winner?.team === 'village' ? 'villageWins' : 'werewolvesWin'))}</h2>
        <p className="mt-4 text-lg text-parchment-200">{t('game.finalDay', { day: game.day })}</p>
        <div className="mt-6">
          {gameEnd.summary.map((p: any) => (
            <div key={p.id} className="p-3 rounded border border-white/10 bg-white/05 mb-2">
              <span className="font-display text-sm text-parchment-100">{p.username}: {t(`roles.${p.role}.name`)} - {p.won ? t('common.wins') : t('common.losses')}</span>
            </div>
          ))}
        </div>
        <button className="btn-primary mt-4">{t('rooms.rematch')}</button>
      </div>
    );
  }

  return <div>{t('game.unknownPhase', { phase: game.phase })}</div>;
}

function NightPhase({
  game,
  prompt,
  myPlayer,
  alivePlayers,
  onAction,
  isSpectator,
}: {
  game: GameView;
  prompt: NightPrompt | null;
  myPlayer: NonNullable<GameView['self']>;
  alivePlayers: GameView['players'];
  onAction: (action: NightActionInput) => Promise<{ ok: boolean; error?: string }>;
  isSpectator: boolean;
}) {
  const { t } = useTranslation();
  const [targetId, setTargetId] = useState('');
  const [potion, setPotion] = useState<'heal' | 'poison' | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const actionText = prompt ? t(`game.actionPrompt.${prompt.action}.label`) : t('game.waitingOthers');
  const actionHint = prompt ? t(`game.actionPrompt.${prompt.action}.hint`) : '';
  const targets = prompt?.targetIds
    .map((id) => alivePlayers.find((player) => player.id === id))
    .filter((player): player is GameView['players'][number] => Boolean(player && player.alive)) ?? [];

  const submit = async (skip = false) => {
    if (!prompt) return;
    setSubmitting(true);
    const action: NightActionInput = prompt.action === 'witch'
      ? {
          type: 'witch',
          heal: !skip && potion === 'heal' ? targetId || null : null,
          poison: !skip && potion === 'poison' ? targetId || null : null,
        }
      : { type: prompt.action, target: skip ? null : targetId || null };
    await onAction(action);
    setSubmitting(false);
  };

  return (
    <div className="phase-screen">
      <SectionHeading title={t('game.nightTitle')} subtitle={prompt ? actionHint : t('game.waitingOthers')} />
      {prompt && !prompt.submitted ? (
        <div className="mx-auto mt-6 max-w-xl space-y-4">
          <p className="text-center text-sm font-semibold text-gold-300">{actionText}</p>
          {prompt.action === 'witch' && (
            <label className="block space-y-1.5">
              <span className="text-xs text-mist">{t('game.choosePotion')}</span>
              <select className="select w-full" value={potion} onChange={(event) => setPotion(event.target.value as 'heal' | 'poison' | '')}>
                <option value="">{t('game.skipAction')}</option>
                {myPlayer.uses.heal > 0 && <option value="heal">{t('game.chooseHeal')}</option>}
                {myPlayer.uses.poison > 0 && <option value="poison">{t('game.choosePoison')}</option>}
              </select>
            </label>
          )}
          {targets.length > 0 && (prompt.action !== 'witch' || potion) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {targets.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  className={cn('btn-ghost btn-block text-xs', targetId === player.id && 'border-gold-400 text-gold-300')}
                  onClick={() => setTargetId(player.id)}
                >
                  {player.username}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-center gap-2">
            {prompt.canSkip && <button type="button" className="btn-ghost" disabled={submitting} onClick={() => void submit(true)}>{t('game.skipAction')}</button>}
            <button type="button" className="btn-primary" disabled={submitting || (!prompt.canSkip && !targetId)} onClick={() => void submit()}>{t('game.confirmAction')}</button>
          </div>
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-mist">
          {isSpectator ? t('game.spectatorNight', { day: game.day }) : prompt?.submitted ? t('game.actionSubmitted') : t('game.waitingOthers')}
        </p>
      )}
    </div>
  );
}

/* ── 8. Role Reveal Cinematic ──────────────────────────────────────────── */

interface RoleCardCinemaProps {
  role: RoleId;
  onDone: () => void;
}
function RoleRevealCinematic({ role, onDone }: RoleCardCinemaProps) {
  const { t } = useTranslation();
  const RoleIcon = roleMeta(role).icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 flex items-center justify-center bg-ink-950 z-50"
    >
      <div className="card p-8 max-w-md w-full text-center">
        <RoleIcon className="mx-auto mb-4 h-12 w-12 text-gold-300" strokeWidth={1.5} aria-hidden />
        <h2 className="font-display text-2xl font-bold text-parchment-100">{t(`roles.${role}.name`)}</h2>
        <p className="text-mist text-sm mb-8">{t('game.roleRevealSubtitle')}</p>
        <button className="btn-primary" onClick={onDone}>{t('common.start')}</button>
      </div>
    </motion.div>
  );
}

export default RoomPage;