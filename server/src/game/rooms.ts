import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { all, get, int, run } from '../db';
import { BASE_SETTINGS, defaultRoleCounts, normalizeRoleCounts } from './roles';
import {
  allNightActorsSubmitted,
  allVotersVoted,
  advancePhase,
  buildView,
  createGame,
  getPlayer,
  livingPlayers,
  nightPromptFor,
  resolveHunter,
  secureRng,
  submitNightAction,
  submitVote,
} from './engine';
import type { Game, GameMode, GameSettings, GameView, NightAction, NightPrompt, RoleId } from './types';
import { finalizeGame } from '../services/stats';
import { cleanChatBody, clampInt } from '../utils/validate';

export interface RoomActor {
  id: string;
  username: string;
  avatar: string;
  isGuest: boolean;
  level: number;
  rating: number;
}

export interface LivePlayer extends RoomActor {
  seat: number;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
  reconnectToken: string;
  joinedAt: number;
  graceTimer?: NodeJS.Timeout | null;
}

export interface Spectator {
  id: string;
  username: string;
  avatar: string;
  connected: boolean;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface ChatMessage {
  id: string;
  channel: 'lobby' | 'day' | 'dead' | 'system';
  userId: string | null;
  username: string;
  body: string;
  at: number;
}

export interface LiveRoom {
  id: string;
  code: string;
  name: string;
  hostId: string;
  controllerId: string | null;
  mode: GameMode;
  isPrivate: boolean;
  settings: GameSettings;
  status: RoomStatus;
  players: LivePlayer[];
  spectators: Spectator[];
  game: Game | null;
  chat: ChatMessage[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  timer: NodeJS.Timeout | null;
  botTimers: NodeJS.Timeout[];
  botPhaseKey: string | null;
  abandonTimer: NodeJS.Timeout | null;
  lastActivity: number;
}

export interface QueueEntry {
  actor: RoomActor;
  mode: 'quick' | 'ranked';
  locale: string;
  joinedAt: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['Karim', 'Yacine', 'Amine', 'Sofiane', 'Mehdi', 'Nadia', 'Lina', 'Rania', 'Walid', 'Samir', 'Hakim', 'Farid'];
const BOT_AVATARS = ['wolf', 'moon', 'owl', 'raven', 'skull', 'candle', 'rose', 'dagger', 'crown', 'fog'];
const CHAT_WINDOW_MS = 60_000;
const CHAT_MAX_PER_WINDOW = 22;
const CHAT_MIN_INTERVAL_MS = 900;

function makeCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normalizeSettings(
  input: Partial<GameSettings> | undefined,
  mode: GameMode,
): GameSettings {
  const i = input ?? {};
  const maxPlayers = clampInt(i.maxPlayers, 6, 18, mode === 'ranked' || mode === 'quick' ? 8 : 10);
  const minPlayers = clampInt(i.minPlayers, 6, maxPlayers, mode === 'ranked' || mode === 'quick' ? 8 : 6);
  const roleCounts: Partial<Record<RoleId, number>> = {};
  if (i.roleCounts && typeof i.roleCounts === 'object') {
    for (const [key, value] of Object.entries(i.roleCounts)) {
      if (typeof value === 'number' && value > 0) roleCounts[key as RoleId] = Math.floor(value);
    }
  }
  const rankedFixed = mode === 'ranked' || mode === 'quick';
  return {
    mode,
    minPlayers,
    maxPlayers,
    nightSeconds: clampInt(i.nightSeconds, 15, 120, BASE_SETTINGS.nightSeconds),
    discussionSeconds: clampInt(i.discussionSeconds, 30, 600, mode === 'ranked' ? 90 : BASE_SETTINGS.discussionSeconds),
    votingSeconds: clampInt(i.votingSeconds, 15, 180, BASE_SETTINGS.votingSeconds),
    revealRoleOnDeath: typeof i.revealRoleOnDeath === 'boolean' ? i.revealRoleOnDeath : BASE_SETTINGS.revealRoleOnDeath,
    allowVoteChange: typeof i.allowVoteChange === 'boolean' ? i.allowVoteChange : BASE_SETTINGS.allowVoteChange,
    tieRule: i.tieRule === 'random' ? 'random' : BASE_SETTINGS.tieRule,
    loversWin: typeof i.loversWin === 'boolean' ? i.loversWin : BASE_SETTINGS.loversWin,
    witchSelfHeal: typeof i.witchSelfHeal === 'boolean' ? i.witchSelfHeal : BASE_SETTINGS.witchSelfHeal,
    allowSpectators: typeof i.allowSpectators === 'boolean' ? i.allowSpectators : BASE_SETTINGS.allowSpectators,
    voiceChat: mode === 'friends' ? Boolean(i.voiceChat) : false,
    roleCounts: rankedFixed ? {} : roleCounts,
  };
}

export class RoomManager {
  private rooms = new Map<string, LiveRoom>();
  private codes = new Map<string, string>();
  private userRoom = new Map<string, string>();
  private queue = new Map<string, QueueEntry>();
  private chatTimes = new Map<string, number[]>();
  private io: Server | null = null;
  private queueTimer: NodeJS.Timeout | null = null;
  private onLobbyUpdate: (() => void) | null = null;
  private disabledRoles = new Set<RoleId>();

  setIo(io: Server): void {
    this.io = io;
  }

  setLobbyListener(listener: () => void): void {
    this.onLobbyUpdate = listener;
  }

  private emitLobby(): void {
    this.onLobbyUpdate?.();
  }

  private toDB(fn: () => void, label: string): void {
    try {
      fn();
    } catch (error) {
      console.error(`[rooms] db error (${label})`, error);
    }
  }

  private persistRoom(room: LiveRoom): void {
    this.toDB(() => {
      run(
        `INSERT INTO rooms (id, code, name, host_id, mode, is_private, max_players, min_players, settings_json, status, created_at, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, host_id = excluded.host_id, mode = excluded.mode,
           is_private = excluded.is_private, max_players = excluded.max_players, min_players = excluded.min_players,
           settings_json = excluded.settings_json, status = excluded.status, started_at = excluded.started_at, ended_at = excluded.ended_at`,
        room.id,
        room.code,
        room.name,
        room.hostId,
        room.mode,
        int(room.isPrivate),
        room.settings.maxPlayers,
        room.settings.minPlayers,
        JSON.stringify(room.settings),
        room.status,
        room.createdAt,
        room.startedAt,
        room.endedAt,
      );
    }, 'persistRoom');
  }

  private persistPlayer(room: LiveRoom, player: LivePlayer): void {
    this.toDB(() => {
      run(
        `INSERT INTO room_players (room_id, user_id, seat, ready, joined_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room_id, user_id) DO UPDATE SET seat = excluded.seat, ready = excluded.ready, left_at = NULL`,
        room.id,
        player.id,
        player.seat,
        int(player.ready),
        player.joinedAt,
      );
    }, 'persistPlayer');
  }

  getRoomForUser(userId: string): LiveRoom | undefined {
    const roomId = this.userRoom.get(userId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  getRoomById(id: string): LiveRoom | undefined {
    return this.rooms.get(id);
  }

  getRoomByCode(code: string): LiveRoom | undefined {
    const id = this.codes.get(code.trim().toUpperCase());
    return id ? this.rooms.get(id) : undefined;
  }

  countLiveGames(): number {
    return [...this.rooms.values()].filter((r) => r.status === 'playing').length;
  }

  countWaitingRooms(): number {
    return [...this.rooms.values()].filter((r) => r.status === 'waiting').length;
  }

  listRooms(status?: string): any[] {
    return this.publicRooms(status);
  }

  publicRooms(statusFilter?: string): any[] {
    const rooms = [...this.rooms.values()]
      .filter((r) => !r.isPrivate)
      .filter((r) => (statusFilter ? r.status === statusFilter : true))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'waiting' ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
    return rooms.map((r) => this.publicSummary(r));
  }

  private publicSummary(room: LiveRoom) {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      hostName: room.players.find((p) => p.id === room.hostId)?.username ?? '—',
      mode: room.mode,
      isPrivate: room.isPrivate,
      status: room.status,
      players: room.players.filter((p) => !p.isBot && p.id !== room.controllerId).length,
      bots: room.players.filter((p) => p.isBot && p.id !== room.controllerId).length,
      controllerId: room.controllerId,
      maxPlayers: room.settings.maxPlayers,
      minPlayers: room.settings.minPlayers,
      spectators: room.spectators.length,
      language: room.settings.language ?? 'ar',
      voiceChat: room.settings.voiceChat,
      createdAt: room.createdAt,
      game: room.game
        ? { day: room.game.day, phase: room.game.phase, playersAlive: room.game.players.filter((p) => p.alive).length }
        : null,
    };
  }

  createRoom(
    actor: RoomActor,
    options: {
      name?: string;
      isPrivate?: boolean;
      mode?: GameMode;
      isController?: boolean;
      settings?: Partial<GameSettings>;
      locale?: string;
    },
  ): { room: LiveRoom; player: LivePlayer } {
    if (this.rooms.size >= 500) throw new Error('server_full');
    this.queue.delete(actor.id);
    if (this.getRoomForUser(actor.id)) throw new Error('already_in_room');
    const mode = options.mode ?? 'classic';
    if (options.isController && (mode === 'ranked' || mode === 'quick')) {
      throw new Error('controller_not_allowed');
    }
    if (mode === 'ranked' && actor.isGuest) throw new Error('guest_not_ranked');
    if (mode === 'ranked') {
      const profile = get<{ games_played: number }>('SELECT games_played FROM profiles WHERE user_id = ?', actor.id);
      if ((profile?.games_played ?? 0) < 3) throw new Error('ranked_requires_3_games');
    }
    const settings = normalizeSettings(options.settings, mode);
    const maxPlayers = mode === 'ranked' || mode === 'quick' ? 8 : settings.maxPlayers;
    settings.maxPlayers = maxPlayers;
    settings.minPlayers = Math.min(settings.minPlayers, maxPlayers);
    if (mode === 'ranked' || mode === 'quick') settings.minPlayers = maxPlayers;
    const id = randomUUID();
    let code = makeCode();
    while (this.codes.has(code)) code = makeCode();
    const now = Date.now();
    const room: LiveRoom = {
      id,
      code,
      name: (options.name || `${actor.username}'s village`).slice(0, 40),
      hostId: actor.id,
      controllerId: options.isController ? actor.id : null,
      mode,
      isPrivate: Boolean(options.isPrivate ?? (mode === 'ranked' || mode === 'quick' || mode === 'friends')),
      settings: { ...settings, language: 'ar' },
      status: 'waiting',
      players: [],
      spectators: [],
      game: null,
      chat: [],
      createdAt: now,
      startedAt: null,
      endedAt: null,
      timer: null,
      botTimers: [],
      botPhaseKey: null,
      abandonTimer: null,
      lastActivity: now,
    };
    const player = this.makePlayer(actor, 0);
    room.players.push(player);
    this.rooms.set(id, room);
    this.codes.set(code, id);
    this.userRoom.set(actor.id, id);
    this.persistRoom(room);
    this.persistPlayer(room, player);
    this.systemChat(room, `${actor.username} created the room`);
    this.emitLobby();
    return { room, player };
  }

  private makePlayer(actor: RoomActor, seat: number, isBot = false): LivePlayer {
    return {
      id: actor.id,
      username: actor.username,
      avatar: actor.avatar,
      isGuest: actor.isGuest,
      level: actor.level,
      rating: actor.rating,
      seat,
      ready: isBot,
      connected: !isBot,
      isBot,
      reconnectToken: randomUUID(),
      joinedAt: Date.now(),
      graceTimer: null,
    };
  }

  private nextSeat(room: LiveRoom): number {
    const used = new Set(room.players.map((p) => p.seat));
    for (let i = 0; i < 64; i++) if (!used.has(i)) return i;
    return room.players.length;
  }

  joinRoom(
    actor: RoomActor,
    reference: string,
    opts: { viaCode?: boolean; asSpectator?: boolean } = {},
  ): { room: LiveRoom; player?: LivePlayer; spectator?: Spectator; reconnectToken?: string } {
    this.queue.delete(actor.id);
    const lookup = reference.trim();
    let room = this.codes.has(lookup.toUpperCase())
      ? this.getRoomByCode(lookup)
      : this.rooms.get(lookup);
    if (!room) throw new Error('room_not_found');
    if (room.isPrivate && !opts.viaCode) {
      const existing = room.players.find((p) => p.id === actor.id);
      if (!existing) throw new Error('private_room');
    }
    const existingPlayer = room.players.find((p) => p.id === actor.id);
    if (existingPlayer) {
      this.userRoom.set(actor.id, room.id);
      existingPlayer.connected = true;
      if (existingPlayer.graceTimer) {
        clearTimeout(existingPlayer.graceTimer);
        existingPlayer.graceTimer = null;
      }
      this.broadcast(room);
      return { room, player: existingPlayer, reconnectToken: existingPlayer.reconnectToken };
    }
    const current = this.getRoomForUser(actor.id);
    if (current && current.id !== room.id) throw new Error('already_in_room');

    if (room.status === 'playing') {
      if (!room.settings.allowSpectators || !opts.asSpectator) throw new Error('game_in_progress');
      if (room.spectators.some((s) => s.id === actor.id)) {
        const spectator = room.spectators.find((s) => s.id === actor.id)!;
        spectator.connected = true;
        this.broadcast(room);
        return { room, spectator };
      }
      if (room.players.length + room.spectators.length >= room.settings.maxPlayers + 20) {
        throw new Error('spectator_full');
      }
      const spectator: Spectator = {
        id: actor.id,
        username: actor.username,
        avatar: actor.avatar,
        connected: true,
      };
      room.spectators.push(spectator);
      this.userRoom.set(actor.id, room.id);
      this.broadcast(room);
      return { room, spectator };
    }
    if (room.status === 'finished') throw new Error('room_finished');
    const gamePlayers = room.players.filter((p) => p.id !== room.controllerId);
    if (gamePlayers.length >= room.settings.maxPlayers) throw new Error('room_full');

    const player = this.makePlayer(actor, this.nextSeat(room));
    room.players.push(player);
    this.userRoom.set(actor.id, room.id);
    this.persistPlayer(room, player);
    this.systemChat(room, `${actor.username} joined the room`);
    this.emitLobby();
    this.broadcast(room);
    return { room, player, reconnectToken: player.reconnectToken };
  }

  resume(userId: string, reconnectToken?: string): { room: LiveRoom; player?: LivePlayer; spectator?: Spectator } | null {
    const room = this.getRoomForUser(userId);
    if (!room) return null;
    const player = room.players.find((p) => p.id === userId);
    if (player) {
      if (reconnectToken && player.reconnectToken !== reconnectToken) return null;
      player.connected = true;
      if (player.graceTimer) {
        clearTimeout(player.graceTimer);
        player.graceTimer = null;
      }
    }
    const spectator = room.spectators.find((s) => s.id === userId);
    if (spectator) spectator.connected = true;
    if (room.abandonTimer) {
      clearTimeout(room.abandonTimer);
      room.abandonTimer = null;
    }
    if (userId === room.controllerId) this.schedule(room);
    this.broadcast(room);
    return { room, player, spectator };
  }

  setReady(userId: string, ready: boolean): void {
    const room = this.getRoomForUser(userId);
    if (!room || room.status !== 'waiting') throw new Error('invalid_state');
    const player = room.players.find((p) => p.id === userId);
    if (!player) throw new Error('not_in_room');
    if (player.id === room.controllerId) throw new Error('controller_cannot_ready');
    player.ready = ready;
    this.persistPlayer(room, player);
    this.broadcast(room);
  }

  setController(userId: string, controllerId: string | null): void {
    const room = this.getRoomForUser(userId);
    if (!room || room.hostId !== userId) throw new Error('not_host');
    if (room.status !== 'waiting') throw new Error('game_in_progress');
    if (controllerId && (room.mode === 'ranked' || room.mode === 'quick')) throw new Error('controller_not_allowed');
    if (controllerId) {
      const target = room.players.find((player) => player.id === controllerId);
      if (!target || target.isBot || !target.connected) throw new Error('invalid_controller');
    }
    const previous = room.players.find((player) => player.id === room.controllerId);
    if (previous) previous.ready = false;
    room.controllerId = controllerId;
    if (controllerId) {
      const controller = room.players.find((player) => player.id === controllerId);
      if (controller) controller.ready = false;
    }
    this.persistRoom(room);
    this.broadcast(room);
    this.emitLobby();
  }

  transferHost(userId: string, targetId: string): void {
    const room = this.getRoomForUser(userId);
    if (!room || room.hostId !== userId) throw new Error('not_host');
    const target = room.players.find((p) => p.id === targetId);
    if (!target) throw new Error('invalid_target');
    room.hostId = targetId;
    this.persistRoom(room);
    this.systemChat(room, `${target.username} is now the host`);
    this.broadcast(room);
  }

  kick(userId: string, targetId: string): void {
    const room = this.getRoomForUser(userId);
    if (!room || room.hostId !== userId) throw new Error('not_host');
    if (room.status === 'playing') throw new Error('game_in_progress');
    if (targetId === userId) throw new Error('cannot_kick_self');
    const target = room.players.find((p) => p.id === targetId);
    if (!target) throw new Error('not_in_room');
    this.removePlayer(room, targetId);
    this.emitToUser(targetId, 'room:kicked', { roomId: room.id });
    this.emitLobby();
    this.broadcast(room);
  }

  updateSettings(userId: string, settings: Partial<GameSettings>, name?: string, isPrivate?: boolean): void {
    const room = this.getRoomForUser(userId);
    if (!room || room.hostId !== userId) throw new Error('not_host');
    if (room.status !== 'waiting') throw new Error('game_in_progress');
    const merged = normalizeSettings({ ...room.settings, ...settings, maxPlayers: settings.maxPlayers ?? room.settings.maxPlayers }, room.mode);
    room.settings = { ...merged, ...((room.settings as any).language ? { language: room.settings.language } : {}) } as GameSettings;
    if (!room.settings.voiceChat) room.settings.voiceChat = false;
    if (typeof name === 'string' && name.trim()) room.name = name.trim().slice(0, 40);
    if (typeof isPrivate === 'boolean') room.isPrivate = isPrivate;
    for (const p of room.players) {
      if (p.seat >= room.settings.maxPlayers && p.id !== room.hostId) this.removePlayer(room, p.id);
    }
    this.persistRoom(room);
    this.broadcast(room);
    this.emitLobby();
  }

  private removePlayer(room: LiveRoom, userId: string): void {
    const player = room.players.find((p) => p.id === userId);
    if (!player) return;
    if (player.graceTimer) clearTimeout(player.graceTimer);
    const wasController = room.controllerId === userId;
    if (wasController) room.controllerId = null;
    room.players = room.players.filter((p) => p.id !== userId);
    room.spectators = room.spectators.filter((s) => s.id !== userId);
    if (room.hostId === userId) {
      const next = room.players.filter((p) => p.connected).sort((a, b) => a.seat - b.seat)[0] ?? room.players[0];
      if (next) {
        room.hostId = next.id;
        this.systemChat(room, `${next.username} is now the host`);
      }
    }
    if (this.userRoom.get(userId) === room.id) this.userRoom.delete(userId);
    this.toDB(() => {
      run('UPDATE room_players SET left_at = ? WHERE room_id = ? AND user_id = ?', Date.now(), room.id, userId);
    }, 'removePlayer');
    if (room.players.length === 0) {
      this.closeRoom(room);
      return;
    }
    this.persistRoom(room);
    this.broadcast(room);
    this.emitLobby();
    if (wasController && room.status === 'playing') this.schedule(room);
  }

  private closeRoom(room: LiveRoom): void {
    if (room.timer) clearTimeout(room.timer);
    if (room.abandonTimer) clearTimeout(room.abandonTimer);
    for (const t of room.botTimers) clearTimeout(t);
    room.timer = null;
    room.abandonTimer = null;
    room.botTimers = [];
    for (const p of room.players) {
      if (this.userRoom.get(p.id) === room.id) this.userRoom.delete(p.id);
      if (p.graceTimer) clearTimeout(p.graceTimer);
    }
    for (const s of room.spectators) {
      if (this.userRoom.get(s.id) === room.id) this.userRoom.delete(s.id);
    }
    this.rooms.delete(room.id);
    this.codes.delete(room.code);
    this.toDB(() => {
      run("UPDATE rooms SET status = 'finished', ended_at = ? WHERE id = ?", Date.now(), room.id);
    }, 'closeRoom');
    this.emitLobby();
  }

  leaveRoom(userId: string): void {
    const room = this.getRoomForUser(userId);
    if (!room) return;
    if (room.status === 'playing') {
      const player = room.players.find((p) => p.id === userId);
      if (player) {
        player.connected = false;
        this.systemChat(room, `${player.username} left the game`);
        if (userId === room.controllerId) this.schedule(room);
        this.broadcast(room);
        this.watchAbandonment(room);
      }
      return;
    }
    this.removePlayer(room, userId);
  }

  startGame(userId: string): void {
    const room = this.getRoomForUser(userId);
    if (!room) throw new Error('not_in_room');
    if (room.hostId !== userId) throw new Error('not_host');
    if (room.status !== 'waiting') throw new Error('invalid_state');

    const connected = room.players.filter((p) => p.connected && !p.isBot && p.id !== room.controllerId);
    const isPractice = room.mode === 'practice';
    if (!isPractice && connected.length < room.settings.minPlayers) throw new Error('not_enough_players');
    if (room.mode === 'ranked' && connected.some((p) => p.isGuest)) throw new Error('guest_not_ranked');
    if (room.mode === 'ranked' && connected.length < 8) throw new Error('ranked_requires_8');
    for (const p of connected) {
      if (p.id !== room.hostId && p.id !== room.controllerId && !p.ready) throw new Error('players_not_ready');
    }
    // Drop disconnected players before the game starts.
    for (const p of [...room.players]) if (!p.connected && !p.isBot) this.removePlayer(room, p.id);
    if (!isPractice && room.players.filter((p) => !p.isBot && p.id !== room.controllerId).length < room.settings.minPlayers) {
      throw new Error('not_enough_players');
    }

    if (room.mode === 'practice') this.fillBots(room);
    if (room.mode === 'ranked' || room.mode === 'quick') {
      room.settings.roleCounts = {};
      room.settings.maxPlayers = room.players.length;
      room.settings.minPlayers = room.players.length;
    } else if (this.disabledRoles.size > 0) {
      const counts = normalizeRoleCounts(room.settings.roleCounts, room.players.length);
      for (const role of this.disabledRoles) {
        if (role === 'werewolf') continue;
        counts[role] = 0;
      }
      room.settings.roleCounts = counts;
    }

    const game = createGame({
      roomId: room.id,
      mode: room.mode,
      settings: room.settings,
      players: room.players.filter((p) => p.id !== room.controllerId).map((p) => ({
        id: p.id,
        username: p.username,
        avatar: p.avatar,
        seat: p.seat,
        isBot: p.isBot,
      })),
      rng: secureRng,
    });
    room.game = game;
    room.status = 'playing';
    room.startedAt = Date.now();
    room.endedAt = null;
    this.persistGameStart(room);
    this.persistRoom(room);
    for (const p of room.players) this.persistPlayer(room, p);
    this.systemChat(room, 'The game has started');
    this.emitLobby();
    this.broadcast(room);
    this.schedule(room);
    this.scheduleBots(room);
  }

  advanceAsController(userId: string): { ok: boolean; error?: string } {
    const room = this.getRoomForUser(userId);
    if (!room?.game || room.status !== 'playing') return { ok: false, error: 'not_in_game' };
    if (room.controllerId !== userId || !room.players.some((player) => player.id === userId && player.connected)) {
      return { ok: false, error: 'not_controller' };
    }
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    this.advanceGame(room);
    return { ok: true };
  }

  private fillBots(room: LiveRoom): void {
    const target = Math.max(room.settings.minPlayers, Math.min(room.settings.maxPlayers, 8));
    let index = 0;
    while (room.players.filter((player) => player.id !== room.controllerId).length < target) {
      const name = `${BOT_NAMES[index % BOT_NAMES.length]}${index >= BOT_NAMES.length ? `-${index}` : ''}`;
      const bot = this.makePlayer(
        {
          id: `bot:${randomUUID()}`,
          username: name,
          avatar: BOT_AVATARS[index % BOT_AVATARS.length],
          isGuest: false,
          level: 1,
          rating: 1000,
        },
        this.nextSeat(room),
        true,
      );
      room.players.push(bot);
      index += 1;
    }
  }

  private schedule(room: LiveRoom): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    if (!room.game || room.status !== 'playing') return;
    if (room.game.winner) {
      this.finalizeRoom(room);
      return;
    }
    if (this.hasConnectedController(room)) return;
    const delay = Math.max(0, room.game.phaseEndsAt - Date.now()) + 150;
    room.timer = setTimeout(() => {
      try {
        this.advanceGame(room);
      } catch (error) {
        console.error('[rooms] advance failed', error);
        this.schedule(room);
      }
    }, delay);
  }

  private hasConnectedController(room: LiveRoom): boolean {
    return Boolean(room.controllerId && room.players.some((player) => player.id === room.controllerId && player.connected));
  }

  private advanceGame(room: LiveRoom): void {
    const game = room.game;
    if (!game || game.winner) {
      if (game?.winner) this.finalizeRoom(room);
      return;
    }
    const previousPhase = game.phase;
    if (previousPhase === 'voting') this.persistVotes(room);
    advancePhase(game, secureRng);
    if (game.winner) {
      this.finalizeRoom(room);
      return;
    }
    this.broadcast(room);
    this.schedule(room);
    this.scheduleBots(room);
  }

  private persistVotes(room: LiveRoom): void {
    const game = room.game;
    if (!game) return;
    this.toDB(() => {
      for (const [voterId, targetId] of Object.entries(game.votes)) {
        run(
          `INSERT INTO votes (id, game_id, day, vote_round, voter_id, target_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_id, day, vote_round, voter_id) DO UPDATE SET target_id = excluded.target_id`,
          randomUUID(),
          game.id,
          game.day,
          game.voteRound,
          voterId,
          targetId,
          Date.now(),
        );
      }
    }, 'persistVotes');
  }

  private persistGameStart(room: LiveRoom): void {
    const game = room.game;
    if (!game) return;
    this.toDB(() => {
      run(
        `INSERT INTO games (id, room_id, room_code, mode, started_at, ended_at, winner_team, winner_ids_json,
           reason, mvp_id, duration_seconds, player_count, day_count, ranked, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, '[]', NULL, NULL, NULL, ?, 0, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        game.id,
        room.id,
        room.code,
        game.mode,
        game.startedAt,
        game.players.length,
        int(game.mode === 'ranked'),
        Date.now(),
      );
    }, 'persistGameStart');
  }

  submitNight(userId: string, action: NightAction): { ok: boolean; error?: string } {
    const room = this.getRoomForUser(userId);
    if (!room?.game || room.status !== 'playing') return { ok: false, error: 'not_in_game' };
    const result = submitNightAction(room.game, userId, action);
    if (!result.ok) return result;
    this.toDB(() => {
      run(
        `INSERT INTO game_actions (id, game_id, day, phase, actor_id, action_type, target_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        room.game!.id,
        room.game!.day,
        room.game!.phase,
        userId,
        `night:${action.type}`,
        action.target ?? action.heal ?? action.poison ?? null,
        JSON.stringify(action),
        Date.now(),
      );
    }, 'nightAction');
    this.broadcast(room);
    if (allNightActorsSubmitted(room.game) && !this.hasConnectedController(room)) {
      if (room.timer) clearTimeout(room.timer);
      room.timer = null;
      // Let players see the last action choice briefly, then resolve.
      room.timer = setTimeout(() => this.advanceGame(room), 500);
    }
    return { ok: true };
  }

  vote(userId: string, targetId: string): { ok: boolean; error?: string } {
    const room = this.getRoomForUser(userId);
    if (!room?.game || room.status !== 'playing') return { ok: false, error: 'not_in_game' };
    const result = submitVote(room.game, userId, targetId);
    if (!result.ok) return result;
    this.toDB(() => {
      run(
        `INSERT INTO votes (id, game_id, day, vote_round, voter_id, target_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, day, vote_round, voter_id) DO UPDATE SET target_id = excluded.target_id`,
        randomUUID(),
        room.game!.id,
        room.game!.day,
        room.game!.voteRound,
        userId,
        targetId,
        Date.now(),
      );
    }, 'vote');
    this.broadcast(room);
    if (allVotersVoted(room.game) && !this.hasConnectedController(room)) {
      if (room.timer) clearTimeout(room.timer);
      room.timer = null;
      room.timer = setTimeout(() => this.advanceGame(room), 700);
    }
    return { ok: true };
  }

  hunterShot(userId: string, targetId: string | null): { ok: boolean; error?: string } {
    const room = this.getRoomForUser(userId);
    if (!room?.game || room.game.phase !== 'hunter' || room.game.pendingHunterId !== userId) {
      return { ok: false, error: 'not_hunter' };
    }
    resolveHunter(room.game, targetId);
    this.afterManualResolution(room);
    return { ok: true };
  }

  private afterManualResolution(room: LiveRoom): void {
    if (!room.game) return;
    this.broadcast(room);
    if (room.game.winner) {
      this.finalizeRoom(room);
      return;
    }
    this.schedule(room);
    this.scheduleBots(room);
  }

  private finalizeRoom(room: LiveRoom): void {
    if (!room.game) return;
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    if (room.status !== 'finished') {
      room.status = 'finished';
      room.endedAt = Date.now();
      room.game.endedAt = room.game.endedAt ?? room.endedAt;
      this.toDB(() => {
        finalizeGame(room.game!, { roomCode: room.code });
        run("UPDATE rooms SET status = 'finished', ended_at = ? WHERE id = ?", room.endedAt, room.id);
      }, 'finalizeRoom');
      this.emitLobby();
    }
    this.broadcast(room);
    this.emitRoom(room, 'game:ended', {
      roomId: room.id,
      winner: room.game.winner,
      mvpId: room.game.mvpId,
      summary: room.game.players.map((p) => ({
        id: p.id,
        username: p.username,
        role: p.role,
        team: p.team,
        alive: p.alive,
        won: Boolean(room.game!.winner?.playerIds.includes(p.id)),
        isMvp: room.game!.mvpId === p.id,
        isBot: p.isBot,
      })),
    });
    setTimeout(() => {
      const current = this.rooms.get(room.id);
      if (current && current.status === 'finished' && current.players.length === 0) this.closeRoom(current);
    }, 20 * 60 * 1000);
  }

  rematch(userId: string): void {
    const room = this.getRoomForUser(userId);
    if (!room || room.hostId !== userId) throw new Error('not_host');
    if (room.status !== 'finished') throw new Error('invalid_state');
    room.game = null;
    room.status = 'waiting';
    room.startedAt = null;
    room.endedAt = null;
    for (const p of room.players) {
      p.ready = p.isBot || p.id === room.hostId;
      p.connected = p.isBot ? true : p.connected;
    }
    this.persistRoom(room);
    for (const p of room.players) this.persistPlayer(room, p);
    this.systemChat(room, 'The host started a rematch lobby');
    this.emitLobby();
    this.broadcast(room);
  }

  sendChat(userId: string, bodyInput: unknown): { ok: boolean; error?: string } {
    const room = this.getRoomForUser(userId);
    if (!room) return { ok: false, error: 'not_in_room' };
    const body = cleanChatBody(bodyInput, 400);
    if (!body) return { ok: false, error: 'empty_message' };
    const now = Date.now();
    const times = (this.chatTimes.get(userId) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (times.length >= CHAT_MAX_PER_WINDOW) return { ok: false, error: 'rate_limited' };
    if (times.length > 0 && now - times[times.length - 1] < CHAT_MIN_INTERVAL_MS) {
      return { ok: false, error: 'slow_down' };
    }
    times.push(now);
    this.chatTimes.set(userId, times);

    let channel: ChatMessage['channel'];
    const player = room.players.find((p) => p.id === userId);
    const spectator = room.spectators.find((s) => s.id === userId);
    if (room.status === 'waiting') {
      channel = 'lobby';
    } else if (room.status === 'finished') {
      channel = 'lobby';
    } else if (room.game) {
      const gp = getPlayer(room.game, userId);
      if (!gp) {
        channel = 'lobby';
      } else if (!gp.alive) {
        channel = 'dead';
      } else if (room.game.phase === 'discussion' || room.game.phase === 'voting' || room.game.phase === 'dawn') {
        channel = 'day';
      } else {
        return { ok: false, error: 'chat_closed' };
      }
    } else {
      channel = 'lobby';
    }

    const message: ChatMessage = {
      id: randomUUID(),
      channel,
      userId,
      username: player?.username ?? spectator?.username ?? '—',
      body,
      at: now,
    };
    room.chat.push(message);
    if (room.chat.length > 200) room.chat.shift();
    room.lastActivity = now;
    this.toDB(() => {
      run(
        `INSERT INTO chat_messages (id, room_id, game_id, user_id, username, channel, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        message.id,
        room.id,
        room.game?.id ?? null,
        userId,
        message.username,
        channel,
        body,
        now,
      );
    }, 'chat');
    this.emitChat(room, message);
    return { ok: true };
  }

  private systemChat(room: LiveRoom, body: string): void {
    const message: ChatMessage = {
      id: randomUUID(),
      channel: 'system',
      userId: null,
      username: 'system',
      body,
      at: Date.now(),
    };
    room.chat.push(message);
    if (room.chat.length > 200) room.chat.shift();
    this.emitChat(room, message);
    this.toDB(() => {
      run(
        `INSERT INTO chat_messages (id, room_id, game_id, user_id, username, channel, body, created_at)
         VALUES (?, ?, ?, NULL, 'system', 'system', ?, ?)`,
        message.id,
        room.id,
        room.game?.id ?? null,
        body,
        message.at,
      );
    }, 'systemChat');
  }

  private emitChat(room: LiveRoom, message: ChatMessage): void {
    const recipients = new Set<string>();
    const game = room.game;
    const publicChannel = message.channel === 'lobby' || message.channel === 'system';
    for (const p of room.players) {
      if (!p.connected || p.isBot) continue;
      if (publicChannel) recipients.add(p.id);
      else if (game) {
        const gp = getPlayer(game, p.id);
        if (!gp) {
          // A room member without a game player only receives lobby/system chat.
        } else if (message.channel === 'day' && gp.alive) recipients.add(p.id);
        else if (message.channel === 'dead' && !gp.alive) recipients.add(p.id);
      }
    }
    // Spectators never get private day/dead chat, but they follow the lobby
    // and system feed (including phase announcements) like everyone else.
    if (publicChannel) {
      for (const s of room.spectators) recipients.add(s.id);
    }
    for (const id of recipients) this.emitToUser(id, 'chat:message', { roomId: room.id, message });
  }

  chatHistoryFor(room: LiveRoom, userId: string): ChatMessage[] {
    const game = room.game;
    const gp = game ? getPlayer(game, userId) : undefined;
    return room.chat.filter((m) => {
      if (m.channel === 'lobby' || m.channel === 'system') return true;
      if (m.channel === 'day') return Boolean(gp?.alive);
      if (m.channel === 'dead') return Boolean(gp && !gp.alive);
      return false;
    }).slice(-100);
  }

  publicState(room: LiveRoom): any {
    return {
      ...this.publicSummary(room),
      players: room.players.map((p) => ({
        id: p.id,
        username: p.username,
        avatar: p.avatar,
        seat: p.seat,
        ready: p.ready,
        connected: p.connected,
        isHost: p.id === room.hostId,
        isController: p.id === room.controllerId,
        isBot: p.isBot,
        isGuest: p.isGuest,
        level: p.level,
        rating: p.rating,
      })),
      spectators: room.spectators.map((s) => ({ id: s.id, username: s.username, avatar: s.avatar })),
      settings: room.settings,
      game: room.game
        ? {
            id: room.game.id,
            day: room.game.day,
            phase: room.game.phase,
            phaseEndsAt: room.game.phaseEndsAt,
            winner: room.game.winner,
            aliveCount: room.game.players.filter((p) => p.alive).length,
          }
        : null,
    };
  }

  gameStateFor(room: LiveRoom, userId: string | null): (GameView & { roomCode: string; roomName: string }) | null {
    if (!room.game) return null;
    const view = buildView(room.game, userId, Date.now());
    const connected = new Map(room.players.map((p) => [p.id, p.connected]));
    view.players = view.players.map((p) => ({ ...p, connected: connected.get(p.id) ?? false }));
    if (userId && userId === room.controllerId) {
      view.isController = true;
      view.self = null;
      view.prompt = null;
      view.wolfTeammates = [];
      view.players = view.players.map((player) => ({
        ...player,
        revealedRole: getPlayer(room.game!, player.id)?.role ?? player.revealedRole,
      }));
    }
    return { ...view, roomCode: room.code, roomName: room.name };
  }

  broadcast(room: LiveRoom): void {
    if (!this.io) return;
    this.io.to(`room:${room.id}`).emit('room:state', this.publicState(room));
    for (const p of room.players) {
      if (!p.connected || p.isBot) continue;
      const state = this.gameStateFor(room, p.id);
      if (state) this.emitToUser(p.id, 'game:state', state);
      this.emitToUser(p.id, 'room:you', { roomId: room.id, isHost: p.id === room.hostId });
    }
    for (const s of room.spectators) {
      if (!s.connected) continue;
      const state = this.gameStateFor(room, null);
      if (state) this.emitToUser(s.id, 'game:state', state);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, payload);
  }

  emitRoom(room: LiveRoom, event: string, payload: unknown): void {
    this.io?.to(`room:${room.id}`).emit(event, payload);
  }

  handleDisconnect(userId: string): void {
    const room = this.getRoomForUser(userId);
    if (!room) return;
    const player = room.players.find((p) => p.id === userId);
    const spectator = room.spectators.find((s) => s.id === userId);
    if (spectator) {
      spectator.connected = false;
      room.spectators = room.spectators.filter((s) => s.id !== userId);
      if (this.userRoom.get(userId) === room.id) this.userRoom.delete(userId);
      this.broadcast(room);
      return;
    }
    if (!player) return;
    player.connected = false;
    if (room.status === 'playing' && userId === room.controllerId) this.schedule(room);
    if (room.status === 'waiting') {
      if (player.graceTimer) clearTimeout(player.graceTimer);
      player.graceTimer = setTimeout(() => {
        const current = this.rooms.get(room.id);
        if (!current || current.status !== 'waiting') return;
        const p = current.players.find((x) => x.id === userId);
        if (p && !p.connected) this.removePlayer(current, userId);
      }, 45_000);
      if (room.hostId === userId) {
        const next = room.players.filter((p) => p.connected && p.id !== userId).sort((a, b) => a.seat - b.seat)[0];
        if (next) {
          room.hostId = next.id;
          this.systemChat(room, `${next.username} is now the host`);
        }
      }
    } else if (room.status === 'playing') {
      this.systemChat(room, `${player.username} disconnected`);
      this.watchAbandonment(room);
    }
    this.broadcast(room);
  }

  private watchAbandonment(room: LiveRoom): void {
    if (room.status !== 'playing') return;
    if (room.abandonTimer) clearTimeout(room.abandonTimer);
    room.abandonTimer = setTimeout(() => {
      const current = this.rooms.get(room.id);
      if (!current || current.status !== 'playing' || !current.game) return;
      const humansConnected = current.players.some((p) => !p.isBot && p.connected);
      if (!humansConnected) {
        current.game.events.push({
          id: (current.game.eventSeq += 1),
          day: current.game.day,
          phase: current.game.phase,
          at: Date.now(),
          type: 'game_abandoned',
          visibility: 'public',
          data: {},
        });
        current.game.winner = null;
        current.game.phase = 'ended';
        current.game.endedAt = Date.now();
        this.finalizeRoom(current);
      }
    }, 120_000);
  }

  /** Matchmaking ------------------------------------------------------------ */

  joinQueue(actor: RoomActor, mode: 'quick' | 'ranked', locale: string): { ok: boolean; error?: string } {
    if (this.getRoomForUser(actor.id)) return { ok: false, error: 'already_in_room' };
    if (mode === 'ranked') {
      if (actor.isGuest) return { ok: false, error: 'guest_not_ranked' };
      const profile = get<{ games_played: number }>('SELECT games_played FROM profiles WHERE user_id = ?', actor.id);
      if ((profile?.games_played ?? 0) < 3) return { ok: false, error: 'ranked_requires_3_games' };
    }
    this.queue.set(actor.id, { actor, mode, locale, joinedAt: Date.now() });
    if (!this.queueTimer) {
      this.queueTimer = setInterval(() => {
        this.tryMatch();
        this.emitQueueStatus();
        if (this.queue.size === 0 && this.queueTimer) {
          clearInterval(this.queueTimer);
          this.queueTimer = null;
        }
      }, 3000);
    }
    this.emitQueueStatus();
    this.tryMatch();
    return { ok: true };
  }

  leaveQueue(userId: string): void {
    if (this.queue.delete(userId)) {
      this.emitQueueStatus();
      if (this.queue.size === 0 && this.queueTimer) {
        clearInterval(this.queueTimer);
        this.queueTimer = null;
      }
    }
  }

  queueInfo(userId: string): { mode: string; players: number; needed: number; waiting: number } | null {
    const entry = this.queue.get(userId);
    if (!entry) return null;
    const group = [...this.queue.values()].filter((q) => q.mode === entry.mode);
    return {
      mode: entry.mode,
      players: group.length,
      needed: 8,
      waiting: Math.floor((Date.now() - entry.joinedAt) / 1000),
    };
  }

  private emitQueueStatus(): void {
    for (const [userId, entry] of this.queue) {
      const group = [...this.queue.values()].filter((q) => q.mode === entry.mode);
      this.emitToUser(userId, 'matchmaking:status', {
        inQueue: true,
        mode: entry.mode,
        players: group.length,
        needed: 8,
        waiting: Math.floor((Date.now() - entry.joinedAt) / 1000),
      });
    }
  }

  private tryMatch(): string[] {
    const matched: string[] = [];
    for (const mode of ['ranked', 'quick'] as const) {
      const entries = [...this.queue.values()]
        .filter((q) => q.mode === mode)
        .sort((a, b) => a.joinedAt - b.joinedAt);
      if (entries.length < 2) continue;
      const group: QueueEntry[] = [];
      for (const entry of entries) {
        if (group.length === 0) {
          group.push(entry);
          continue;
        }
        const groupRating = group.reduce((s, q) => s + q.actor.rating, 0) / group.length;
        const spreadOk =
          mode === 'quick' ||
          Math.abs(entry.actor.rating - groupRating) <= 250 + Math.floor((Date.now() - entry.joinedAt) / 1000) * 2;
        if (spreadOk) group.push(entry);
        if (group.length >= 8) break;
      }
      if (group.length >= 8) {
        const selected = group.slice(0, 8);
        for (const q of selected) this.queue.delete(q.actor.id);
        matched.push(...selected.map((q) => q.actor.id));
        const host = selected[0].actor;
        let created: LiveRoom;
        try {
          const result = this.createRoom(host, {
            name: mode === 'ranked' ? 'Ranked Match' : 'Quick Match',
            isPrivate: true,
            mode,
            settings: { maxPlayers: 8, minPlayers: 8 },
            locale: selected[0].locale,
          });
          created = result.room;
          for (const entry of selected.slice(1)) {
            this.joinRoom(entry.actor, created.code, { viaCode: true });
          }
          for (const p of created.players) p.ready = true;
          this.broadcast(created);
          this.startGame(host.id);
          for (const entry of selected) {
            this.emitToUser(entry.actor.id, 'matchmaking:matched', {
              roomCode: created.code,
              roomId: created.id,
              mode,
            });
          }
        } catch (error) {
          console.error('[matchmaking] failed to create match', error);
          for (const q of selected) this.queue.set(q.actor.id, q);
        }
      }
    }
    if (matched.length) this.emitQueueStatus();
    return matched;
  }

  /** Practice bots ---------------------------------------------------------- */

  private scheduleBots(room: LiveRoom): void {
    for (const t of room.botTimers) clearTimeout(t);
    room.botTimers = [];
    const game = room.game;
    if (!game || room.status !== 'playing' || game.winner) return;
    const key = `${game.phase}:${game.day}:${game.voteRound}:${game.pendingHunterId ?? ''}`;
    if (room.botPhaseKey === key) return;
    room.botPhaseKey = key;
    const bots = room.players.filter((p) => p.isBot);
    if (bots.length === 0) return;

    for (const bot of bots) {
      const delay = 1200 + randomInt(3200);
      if (game.phase === 'night') {
        const gp = getPlayer(game, bot.id);
        if (!gp || !gp.alive) continue;
        const prompt = nightPromptFor(game, gp);
        if (!prompt || prompt.submitted) continue;
        const t = setTimeout(() => {
          try {
            this.botNightAction(room, bot.id, prompt);
          } catch (error) {
            console.error('[bots] night action failed', error);
          }
        }, delay);
        room.botTimers.push(t);
      } else if (game.phase === 'voting') {
        const gp = getPlayer(game, bot.id);
        if (!gp || !gp.alive || !gp.canVote || game.votes[bot.id]) continue;
        const targets = livingPlayers(game).filter((p) => p.id !== bot.id);
        if (targets.length === 0) continue;
        const t = setTimeout(() => {
          const target = targets[randomInt(targets.length)];
          if (room.game?.phase === 'voting' && room.game.voteRound === game.voteRound) {
            this.vote(bot.id, target.id);
          }
        }, delay);
        room.botTimers.push(t);
      } else if (game.phase === 'hunter' && game.pendingHunterId === bot.id) {
        const t = setTimeout(() => {
          const targets = livingPlayers(game).filter((p) => p.id !== bot.id);
          this.hunterShot(bot.id, targets.length ? targets[randomInt(targets.length)].id : null);
        }, delay);
        room.botTimers.push(t);
      }
    }
  }

  private botNightAction(room: LiveRoom, botId: string, prompt: NightPrompt): void {
    const game = room.game;
    if (!game || game.phase !== 'night') return;
    const bot = getPlayer(game, botId);
    if (!bot || !bot.alive || game.nightActions[botId]) return;
    const targetId = prompt.targetIds.length ? prompt.targetIds[randomInt(prompt.targetIds.length)] : null;
    let action: NightAction;
    switch (prompt.action) {
      case 'spy':
        action = { type: 'spy' };
        break;
      case 'lovers': {
        if (prompt.targetIds.length < 2) return;
        const first = prompt.targetIds[randomInt(prompt.targetIds.length)];
        const rest = prompt.targetIds.filter((id) => id !== first);
        action = { type: 'lovers', targets: [first, rest[randomInt(rest.length)]] };
        break;
      }
      case 'witch': {
        const extra = prompt.extra as { healAvailable?: boolean; poisonAvailable?: boolean; witchVictimId?: string | null };
        if (extra?.healAvailable && extra.witchVictimId && Math.random() < 0.6) {
          action = { type: 'witch', heal: extra.witchVictimId, poison: null };
        } else if (extra?.poisonAvailable && prompt.targetIds.length && Math.random() < 0.45) {
          const poisonTarget = prompt.targetIds.filter((id) => id !== botId);
          action = { type: 'witch', heal: null, poison: poisonTarget[randomInt(poisonTarget.length)] };
        } else {
          action = { type: 'witch', heal: null, poison: null };
        }
        break;
      }
      default:
        if (!targetId) {
          if (prompt.canSkip) {
            action = { type: prompt.action, target: null };
          } else return;
        } else {
          action = { type: prompt.action, target: targetId };
        }
    }
    this.submitNight(botId, action);
  }

  /** Metrics for admin. */
  metrics(): { rooms: number; liveGames: number; waitingRooms: number; queued: number; spectators: number } {
    return {
      rooms: this.rooms.size,
      liveGames: this.countLiveGames(),
      waitingRooms: this.countWaitingRooms(),
      queued: this.queue.size,
      spectators: [...this.rooms.values()].reduce((sum, r) => sum + r.spectators.length, 0),
    };
  }

  setDisabledRoles(roles: RoleId[]): void {
    this.disabledRoles = new Set(roles);
  }

  disconnectUser(userId: string): void {
    this.leaveQueue(userId);
    this.handleDisconnect(userId);
    this.io?.in(`user:${userId}`).disconnectSockets(true);
  }

  removeChatMessage(roomId: string | null, messageId: string): void {
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.chat = room.chat.filter((m) => m.id !== messageId);
    this.emitRoom(room, 'chat:deleted', { roomId, messageId });
  }

  allRoomsForAdmin(): any[] {
    return [...this.rooms.values()].map((r) => ({
      ...this.publicSummary(r),
      isPrivate: r.isPrivate,
      chatCount: r.chat.length,
      createdAt: r.createdAt,
    }));
  }

  adminCloseRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) this.closeRoom(room);
  }

  /** Used on boot to clear state left behind by a previous process. */
  static recoverStaleState(): void {
    try {
      const now = Date.now();
      run("UPDATE rooms SET status = 'finished', ended_at = ? WHERE status IN ('waiting', 'playing')", now);
      run('UPDATE room_players SET left_at = ? WHERE left_at IS NULL', now);
    } catch (error) {
      console.error('[rooms] stale state recovery failed', error);
    }
  }
}

export const roomManager = new RoomManager();
