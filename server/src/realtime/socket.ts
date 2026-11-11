import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { getSetting } from '../db';
import { resolveToken } from '../auth/jwt';
import { roomManager, type LiveRoom, type RoomActor } from '../game/rooms';
import { getProfile, findUserById, touchUser } from '../services/users';
import { registerSocket, unregisterSocket } from './presence';

interface SocketUser {
  id: string;
  username: string;
  avatar: string;
  role: 'player' | 'admin';
  isGuest: boolean;
  tokenVersion: number;
}

function actorFor(user: SocketUser): RoomActor {
  const profile = getProfile(user.id);
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    isGuest: user.isGuest,
    level: profile?.level ?? 1,
    rating: profile?.rating ?? 1000,
  };
}

function snapshot(room: LiveRoom, userId: string) {
  const player = room.players.find((p) => p.id === userId);
  const spectator = room.spectators.find((s) => s.id === userId);
  return {
    room: roomManager.publicState(room),
    game: roomManager.gameStateFor(room, userId),
    chat: roomManager.chatHistoryFor(room, userId),
    reconnectToken: player?.reconnectToken,
    isSpectator: Boolean(spectator),
  };
}

function subscribe(socket: Socket, room: LiveRoom, user: SocketUser): void {
  socket.join(`room:${room.id}`);
  socket.emit('chat:history', { roomId: room.id, messages: roomManager.chatHistoryFor(room, user.id) });
  socket.emit('room:snapshot', snapshot(room, user.id));
  roomManager.broadcast(room);
}

const actionSchema = z.object({
  type: z.string().min(1).max(30),
  target: z.string().max(80).nullable().optional(),
  targets: z.array(z.string().max(80)).max(2).optional(),
  heal: z.string().max(80).nullable().optional(),
  poison: z.string().max(80).nullable().optional(),
});

const createSchema = z.object({
  name: z.string().max(40).optional(),
  isPrivate: z.boolean().optional(),
  mode: z.enum(['classic', 'ranked', 'custom', 'quick', 'friends', 'practice']).optional(),
  isController: z.boolean().optional(),
  locale: z.literal('ar').optional(),
  settings: z.record(z.unknown()).optional(),
});

export function registerSocketHandlers(io: Server): void {
  io.use((socket, next) => {
    const token =
      (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
      (typeof socket.handshake.query?.token === 'string' && socket.handshake.query.token) ||
      null;
    const result = resolveToken(token);
    if (!result.ok) {
      next(new Error(result.error === 'banned' ? 'banned' : 'unauthorized'));
      return;
    }
    if (getSetting('maintenance_mode', 'false') === 'true' && result.user.role !== 'admin') {
      next(new Error('maintenance'));
      return;
    }
    const user: SocketUser = {
      id: result.user.id,
      username: result.user.username,
      avatar: result.user.avatar,
      role: result.user.role,
      isGuest: Boolean(result.user.is_guest),
      tokenVersion: result.user.token_version,
    };
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as SocketUser;
    socket.join(`user:${user.id}`);
    registerSocket(user.id, socket.id);
    touchUser(user.id);

    // Heartbeat response — clients use this to verify liveness.
    socket.on('app:ping', (ack?: (p: unknown) => void) => {
      ack?.({ ok: true, at: Date.now() });
    });

    // Auto-resume an existing room after reconnection.
    const reconnectToken =
      typeof socket.handshake.auth?.reconnectToken === 'string' ? socket.handshake.auth.reconnectToken : undefined;
    const resumed = roomManager.resume(user.id, reconnectToken);
    if (resumed?.room) subscribe(socket, resumed.room, user);

    const roomZod = z.object({ code: z.string().min(3).max(40) });

    socket.on('room:create', (payload: unknown, ack?: (p: unknown) => void) => {
      try {
        const parsed = createSchema.safeParse(payload ?? {});
        if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
        const settings = (parsed.data.settings ?? {}) as any;
        const { room, player } = roomManager.createRoom(actorFor(user), {
          name: parsed.data.name,
          isPrivate: parsed.data.isPrivate,
          mode: parsed.data.mode,
          isController: parsed.data.isController,
          locale: parsed.data.locale,
          settings,
        });
        subscribe(socket, room, user);
        ack?.({ ok: true, roomId: room.id, roomCode: room.code, reconnectToken: player.reconnectToken });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on(
      'room:join',
      (payload: unknown, ack?: (p: unknown) => void) => {
        try {
          const parsed = z
            .object({ code: z.string().min(3).max(40), asSpectator: z.boolean().optional() })
            .safeParse(payload ?? {});
          if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
          const result = roomManager.joinRoom(actorFor(user), parsed.data.code, {
            viaCode: true,
            asSpectator: parsed.data.asSpectator,
          });
          subscribe(socket, result.room, user);
          ack?.({
            ok: true,
            roomId: result.room.id,
            roomCode: result.room.code,
            reconnectToken: result.reconnectToken ?? result.player?.reconnectToken,
            isSpectator: Boolean(result.spectator),
          });
        } catch (error) {
          ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
        }
      },
    );

    socket.on('room:subscribe', (payload: unknown, ack?: (p: unknown) => void) => {
      const parsed = roomZod.safeParse(payload ?? {});
      if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
      const room = roomManager.getRoomByCode(parsed.data.code) ?? roomManager.getRoomById(parsed.data.code);
      if (!room) return ack?.({ ok: false, error: 'room_not_found' });
      const isMember =
        room.players.some((p) => p.id === user.id) || room.spectators.some((s) => s.id === user.id);
      if (!isMember) return ack?.({ ok: false, error: 'not_in_room' });
      subscribe(socket, room, user);
      ack?.({ ok: true, roomId: room.id });
    });

    socket.on('room:leave', (_payload: unknown, ack?: (p: unknown) => void) => {
      const room = roomManager.getRoomForUser(user.id);
      roomManager.leaveRoom(user.id);
      if (room) socket.leave(`room:${room.id}`);
      ack?.({ ok: true });
    });

    socket.on('room:ready', (payload: unknown, ack?: (p: unknown) => void) => {
      try {
        const parsed = z.object({ ready: z.boolean() }).safeParse(payload ?? {});
        if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
        roomManager.setReady(user.id, parsed.data.ready);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on('room:controller', (payload: unknown, ack?: (p: unknown) => void) => {
      try {
        const parsed = z.object({ controllerId: z.string().min(1).nullable() }).safeParse(payload ?? {});
        if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
        roomManager.setController(user.id, parsed.data.controllerId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on('room:start', (_payload: unknown, ack?: (p: unknown) => void) => {
      try {
        roomManager.startGame(user.id);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on('game:advance', (_payload: unknown, ack?: (p: unknown) => void) => {
      ack?.(roomManager.advanceAsController(user.id));
    });

    socket.on('room:kick', (payload: unknown, ack?: (p: unknown) => void) => {
      try {
        const parsed = z.object({ targetId: z.string().min(1) }).safeParse(payload ?? {});
        if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
        roomManager.kick(user.id, parsed.data.targetId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on('room:transfer', (payload: unknown, ack?: (p: unknown) => void) => {
      try {
        const parsed = z.object({ targetId: z.string().min(1) }).safeParse(payload ?? {});
        if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
        roomManager.transferHost(user.id, parsed.data.targetId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on('room:settings', (payload: unknown, ack?: (p: unknown) => void) => {
      try {
        const parsed = z
          .object({
            settings: z.record(z.unknown()).optional(),
            name: z.string().max(40).optional(),
            isPrivate: z.boolean().optional(),
          })
          .safeParse(payload ?? {});
        if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
        roomManager.updateSettings(user.id, (parsed.data.settings ?? {}) as any, parsed.data.name, parsed.data.isPrivate);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on('room:rematch', (_payload: unknown, ack?: (p: unknown) => void) => {
      try {
        roomManager.rematch(user.id);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' });
      }
    });

    socket.on('chat:send', (payload: unknown, ack?: (p: unknown) => void) => {
      const parsed = z.object({ body: z.string().min(1).max(500) }).safeParse(payload ?? {});
      if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
      const result = roomManager.sendChat(user.id, parsed.data.body);
      ack?.(result);
    });

    socket.on('chat:typing', (payload: unknown) => {
      const parsed = z.object({ typing: z.boolean() }).safeParse(payload ?? {});
      if (!parsed.success) return;
      const room = roomManager.getRoomForUser(user.id);
      if (!room) return;
      const player = room.players.find((p) => p.id === user.id);
      if (!player) return;
      // Typing indicators are only sent to living players during a game.
      const game = room.game;
      let recipients: string[];
      if (!game || room.status !== 'playing') {
        recipients = room.players.filter((p) => p.connected && !p.isBot).map((p) => p.id);
      } else {
        const gp = game.players.find((p) => p.id === user.id);
        recipients = room.players
          .filter((p) => {
            if (!p.connected || p.isBot) return false;
            const other = game.players.find((x) => x.id === p.id);
            if (!other) return false;
            if (!gp) return false;
            return gp.alive ? other.alive : !other.alive;
          })
          .map((p) => p.id);
      }
      for (const id of recipients) {
        roomManager.emitToUser(id, 'chat:typing', {
          roomId: room.id,
          userId: user.id,
          username: player.username,
          typing: parsed.data.typing,
        });
      }
    });

    socket.on('game:action', (payload: unknown, ack?: (p: unknown) => void) => {
      const parsed = actionSchema.safeParse(payload ?? {});
      if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
      const result = roomManager.submitNight(user.id, parsed.data as any);
      ack?.(result);
    });

    socket.on('game:vote', (payload: unknown, ack?: (p: unknown) => void) => {
      const parsed = z.object({ targetId: z.string().min(1).max(80) }).safeParse(payload ?? {});
      if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
      ack?.(roomManager.vote(user.id, parsed.data.targetId));
    });

    socket.on('game:hunter', (payload: unknown, ack?: (p: unknown) => void) => {
      const parsed = z.object({ targetId: z.string().min(1).max(80).nullable() }).safeParse(payload ?? {});
      if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
      ack?.(roomManager.hunterShot(user.id, parsed.data.targetId));
    });

    socket.on('matchmaking:queue', (payload: unknown, ack?: (p: unknown) => void) => {
      const parsed = z
        .object({ mode: z.enum(['quick', 'ranked']), locale: z.literal('ar').optional() })
        .safeParse(payload ?? {});
      if (!parsed.success) return ack?.({ ok: false, error: 'invalid_input' });
      const result = roomManager.joinQueue(actorFor(user), parsed.data.mode, parsed.data.locale ?? 'ar');
      ack?.({ ...result, queue: roomManager.queueInfo(user.id) });
    });

    socket.on('matchmaking:leave', (_payload: unknown, ack?: (p: unknown) => void) => {
      roomManager.leaveQueue(user.id);
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      const remaining = unregisterSocket(user.id, socket.id);
      if (remaining === 0) {
        roomManager.leaveQueue(user.id);
        roomManager.handleDisconnect(user.id);
        const dbUser = findUserById(user.id);
        if (dbUser) touchUser(user.id);
      }
    });
  });
}
