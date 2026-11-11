import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { get } from '../db';
import { authenticate, optionalAuth } from '../auth/middleware';
import { roomManager, type RoomActor } from '../game/rooms';
import { findUserById, getProfile } from '../services/users';

export const roomsRouter = express.Router();

const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

function actorFor(userId: string): RoomActor | null {
  const user = findUserById(userId);
  if (!user) return null;
  const profile = getProfile(user.id);
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    isGuest: Boolean(user.is_guest),
    level: profile?.level ?? 1,
    rating: profile?.rating ?? 1000,
  };
}

function fail(res: express.Response, error: unknown, status = 400): void {
  res.status(status).json({ error: error instanceof Error ? error.message : 'unknown_error' });
}

roomsRouter.get('/', optionalAuth, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rooms = roomManager.publicRooms(status).filter((room) => {
    if (typeof req.query.mode === 'string' && req.query.mode && room.mode !== req.query.mode) return false;
    if (typeof req.query.language === 'string' && req.query.language && room.language !== req.query.language) return false;
    if (typeof req.query.minPlayers === 'string') {
      const min = Number(req.query.minPlayers);
      if (Number.isFinite(min) && room.players < min) return false;
    }
    return true;
  });
  res.json({ rooms });
});

const roleCountsSchema = z.record(z.number().int().min(0).max(18)).optional();

const settingsSchema = z.object({
  minPlayers: z.number().int().min(6).max(18).optional(),
  maxPlayers: z.number().int().min(6).max(18).optional(),
  nightSeconds: z.number().int().min(15).max(120).optional(),
  discussionSeconds: z.number().int().min(30).max(600).optional(),
  votingSeconds: z.number().int().min(15).max(180).optional(),
  revealRoleOnDeath: z.boolean().optional(),
  allowVoteChange: z.boolean().optional(),
  tieRule: z.enum(['no_elimination', 'random']).optional(),
  loversWin: z.boolean().optional(),
  witchSelfHeal: z.boolean().optional(),
  allowSpectators: z.boolean().optional(),
  voiceChat: z.boolean().optional(),
  roleCounts: roleCountsSchema,
});

const createSchema = z.object({
  name: z.string().max(40).optional(),
  isPrivate: z.boolean().optional(),
  mode: z.enum(['classic', 'ranked', 'custom', 'quick', 'friends', 'practice']).optional(),
  isController: z.boolean().optional(),
  locale: z.literal('ar').optional(),
  settings: settingsSchema.optional(),
});

roomsRouter.post('/', authenticate, createLimiter, (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    return;
  }
  const actor = actorFor(req.auth!.id);
  if (!actor) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const { room, player } = roomManager.createRoom(actor, parsed.data);
    res.status(201).json({
      room: roomManager.publicState(room),
      reconnectToken: player.reconnectToken,
    });
  } catch (error) {
    fail(res, error);
  }
});

function findRoom(codeOrId: string) {
  return roomManager.getRoomByCode(codeOrId) ?? roomManager.getRoomById(codeOrId);
}

roomsRouter.get('/:code', optionalAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'room_not_found' });
    return;
  }
  res.json({ room: roomManager.publicState(room) });
});

roomsRouter.get('/:code/state', authenticate, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'room_not_found' });
    return;
  }
  const player = room.players.find((p) => p.id === req.auth!.id);
  const spectator = room.spectators.find((s) => s.id === req.auth!.id);
  if (!player && !spectator) {
    res.status(403).json({ error: 'not_in_room' });
    return;
  }
  res.json({
    room: roomManager.publicState(room),
    game: roomManager.gameStateFor(room, req.auth!.id),
    chat: roomManager.chatHistoryFor(room, req.auth!.id),
    reconnectToken: player?.reconnectToken,
    isSpectator: Boolean(spectator),
  });
});

const joinSchema = z.object({ asSpectator: z.boolean().optional() });

roomsRouter.post('/:code/join', authenticate, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'room_not_found' });
    return;
  }
  const actor = actorFor(req.auth!.id);
  if (!actor) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = roomManager.joinRoom(actor, room.code, {
      viaCode: true,
      asSpectator: Boolean(req.body?.asSpectator),
    });
    res.json({
      room: roomManager.publicState(result.room),
      game: roomManager.gameStateFor(result.room, actor.id),
      reconnectToken: result.reconnectToken ?? result.player?.reconnectToken,
      isSpectator: Boolean(result.spectator),
    });
  } catch (error) {
    fail(res, error);
  }
});

roomsRouter.post('/:code/leave', authenticate, (req, res) => {
  roomManager.leaveRoom(req.auth!.id);
  res.json({ ok: true });
});

roomsRouter.post('/:code/ready', authenticate, (req, res) => {
  try {
    roomManager.setReady(req.auth!.id, Boolean(req.body?.ready));
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

roomsRouter.post('/:code/start', authenticate, (req, res) => {
  try {
    roomManager.startGame(req.auth!.id);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

roomsRouter.post('/:code/kick', authenticate, (req, res) => {
  if (typeof req.body?.targetId !== 'string') {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  try {
    roomManager.kick(req.auth!.id, req.body.targetId);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

roomsRouter.post('/:code/transfer', authenticate, (req, res) => {
  if (typeof req.body?.targetId !== 'string') {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  try {
    roomManager.transferHost(req.auth!.id, req.body.targetId);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

const updateSchema = createSchema.partial().extend({
  settings: settingsSchema.optional(),
});

roomsRouter.patch('/:code', authenticate, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'room_not_found' });
    return;
  }
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  try {
    roomManager.updateSettings(
      req.auth!.id,
      parsed.data.settings ?? {},
      parsed.data.name,
      parsed.data.isPrivate,
    );
    res.json({ ok: true, room: roomManager.publicState(room) });
  } catch (error) {
    fail(res, error);
  }
});

roomsRouter.post('/:code/rematch', authenticate, (req, res) => {
  try {
    roomManager.rematch(req.auth!.id);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

roomsRouter.post('/:code/chat', authenticate, (req, res) => {
  const result = roomManager.sendChat(req.auth!.id, req.body?.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

roomsRouter.get('/:code/chat', authenticate, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'room_not_found' });
    return;
  }
  const player = room.players.find((p) => p.id === req.auth!.id);
  const spectator = room.spectators.find((s) => s.id === req.auth!.id);
  if (!player && !spectator) {
    res.status(403).json({ error: 'not_in_room' });
    return;
  }
  res.json({ messages: roomManager.chatHistoryFor(room, req.auth!.id) });
});

/** Matchmaking -------------------------------------------------------------- */

export const matchmakingRouter = express.Router();
matchmakingRouter.use(authenticate);

const queueSchema = z.object({ mode: z.enum(['quick', 'ranked']), locale: z.literal('ar').optional() });

matchmakingRouter.post('/queue', (req, res) => {
  const parsed = queueSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const actor = actorFor(req.auth!.id);
  if (!actor) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const result = roomManager.joinQueue(actor, parsed.data.mode, parsed.data.locale ?? 'ar');
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, queue: roomManager.queueInfo(actor.id) });
});

matchmakingRouter.delete('/queue', (req, res) => {
  roomManager.leaveQueue(req.auth!.id);
  res.json({ ok: true });
});

matchmakingRouter.get('/queue', (req, res) => {
  res.json({ queue: roomManager.queueInfo(req.auth!.id) });
});

/** Health / metrics (public minimal) -------------------------------------- */

export const publicStatsRouter = express.Router();
publicStatsRouter.get('/stats', (_req, res) => {
  const players = get<{ count: number }>('SELECT COUNT(*) as count FROM users WHERE is_guest = 0')?.count ?? 0;
  const matches = get<{ count: number }>('SELECT COUNT(*) as count FROM games WHERE ended_at IS NOT NULL')?.count ?? 0;
  res.json({
    players,
    matches,
    rooms: roomManager.publicRooms().length,
    liveGames: roomManager.countLiveGames(),
  });
});
