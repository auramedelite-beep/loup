import { afterAll, afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// Must be set before the database module is evaluated.
process.env.DATABASE_PATH = path.join(
  os.tmpdir(),
  `loupgarou-rooms-test-${process.pid}-${Date.now()}.db`,
);
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.NODE_ENV = 'test';

const { roomManager } = await import('./rooms');
const { createUser } = await import('../services/users');
const { closeDb } = await import('../db');

type Actor = {
  id: string;
  username: string;
  avatar: string;
  isGuest: boolean;
  level: number;
  rating: number;
};

const suffix = Math.random().toString(36).slice(2, 7);
let actorCounter = 0;
const openRooms: string[] = [];

function makeActor(): Actor {
  actorCounter += 1;
  const user = createUser({
    username: `t${suffix}${String(actorCounter).padStart(2, '0')}`.slice(0, 20),
    isGuest: false,
  });
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    isGuest: false,
    level: 1,
    rating: 1000,
  };
}

function startSixPlayerRoom(mode: 'classic' | 'custom' = 'classic') {
  const actors = Array.from({ length: 6 }, () => makeActor());
  const host = actors[0];
  const { room } = roomManager.createRoom(host, {
    name: `Test ${suffix}-${actorCounter}`,
    isPrivate: true,
    mode,
    settings: { minPlayers: 6, maxPlayers: 6 },
  });
  openRooms.push(room.id);
  for (const actor of actors.slice(1)) {
    roomManager.joinRoom(actor, room.code, { viaCode: true });
  }
  for (const player of room.players) {
    if (player.id !== host.id) roomManager.setReady(player.id, true);
  }
  roomManager.startGame(host.id);
  return { room, actors };
}

function advance(room: any): void {
  (roomManager as any).advanceGame(room);
}

afterEach(() => {
  while (openRooms.length) {
    const id = openRooms.pop()!;
    roomManager.adminCloseRoom(id);
  }
  // Close any room that a test created directly (defensive).
  for (const summary of roomManager.allRoomsForAdmin()) {
    roomManager.adminCloseRoom(summary.id);
  }
});

afterAll(() => {
  closeDb();
});

describe('room manager integration', () => {
  it('13. keeps the game consistent when a player disconnects during the night', () => {
    const { room } = startSixPlayerRoom();
    advance(room);
    expect(room.game?.phase).toBe('night');
    expect(room.status).toBe('playing');

    const disconnected = room.players[1];
    roomManager.handleDisconnect(disconnected.id);
    expect(disconnected.connected).toBe(false);
    expect(room.players).toHaveLength(6);

    // Night resolves on timeout even without the disconnected actor's action.
    advance(room);
    expect(room.status).toBe('playing');
    expect(room.game?.players).toHaveLength(6);
    expect(room.game?.phase).not.toBe('night');
    // The disconnected player's seat remains reserved for reconnection.
    expect(room.players.find((p) => p.id === disconnected.id)).toBeTruthy();
  });

  it('14. restores votes and private state when a player reconnects during voting', () => {
    const { room } = startSixPlayerRoom();
    // role reveal → night → dawn → discussion → voting
    advance(room);
    advance(room);
    advance(room);
    advance(room);
    expect(room.game?.phase).toBe('voting');

    const voter = room.players[1];
    const target = room.players.find((p) => p.id !== voter.id)!;
    const voteResult = roomManager.vote(voter.id, target.id);
    expect(voteResult.ok).toBe(true);
    expect(room.game?.votes[voter.id]).toBe(target.id);

    const token = voter.reconnectToken;
    roomManager.handleDisconnect(voter.id);
    expect(voter.connected).toBe(false);

    const resumed = roomManager.resume(voter.id, token);
    expect(resumed?.player?.connected).toBe(true);
    expect(room.game?.votes[voter.id]).toBe(target.id);
    const view = roomManager.gameStateFor(room, voter.id);
    expect(view?.vote.ownVote).toBe(target.id);
    expect(view?.self?.role).toBeTruthy();

    // A wrong reconnect token must not resume the seat.
    roomManager.handleDisconnect(voter.id);
    expect(roomManager.resume(voter.id, 'not-the-right-token')).toBeNull();
  });

  it('15. transfers ownership automatically when the host disconnects in the lobby', () => {
    const host = makeActor();
    const guest = makeActor();
    const { room } = roomManager.createRoom(host, {
      isPrivate: true,
      settings: { minPlayers: 6, maxPlayers: 6 },
    });
    openRooms.push(room.id);
    roomManager.joinRoom(guest, room.code, { viaCode: true });
    expect(room.hostId).toBe(host.id);

    roomManager.handleDisconnect(host.id);
    expect(room.hostId).toBe(guest.id);
    expect(room.players.find((p) => p.id === host.id)?.connected).toBe(false);
    expect(room.hostId).not.toBe(host.id);
  });

  it('keeps the controller outside the player count, roles, and votes', () => {
    const host = makeActor();
    const players = Array.from({ length: 6 }, () => makeActor());
    const { room } = roomManager.createRoom(host, {
      isPrivate: true,
      isController: true,
      settings: { minPlayers: 6, maxPlayers: 6 },
    });
    openRooms.push(room.id);
    for (const actor of players) {
      roomManager.joinRoom(actor, room.code, { viaCode: true });
      roomManager.setReady(actor.id, true);
    }

    expect(roomManager.publicSummary(room).players).toBe(6);
    roomManager.startGame(host.id);

    expect(room.game?.players).toHaveLength(6);
    expect(room.game?.players.some((player) => player.id === host.id)).toBe(false);
    const controllerView = roomManager.gameStateFor(room, host.id);
    expect(controllerView?.isController).toBe(true);
    expect(controllerView?.self).toBeNull();
    expect(controllerView?.players.every((player) => player.revealedRole !== null)).toBe(true);
    for (let phase = 0; phase < 4; phase += 1) {
      expect(roomManager.advanceAsController(host.id).ok).toBe(true);
    }
    expect(room.game?.phase).toBe('voting');
    expect(roomManager.vote(host.id, players[0].id)).toEqual({ ok: false, error: 'not_alive' });
  });

  it('lets the host appoint a connected room member as controller', () => {
    const host = makeActor();
    const players = Array.from({ length: 5 }, () => makeActor());
    const lastPlayer = makeActor();
    const { room } = roomManager.createRoom(host, {
      isPrivate: true,
      settings: { minPlayers: 6, maxPlayers: 6 },
    });
    openRooms.push(room.id);
    for (const actor of players) {
      roomManager.joinRoom(actor, room.code, { viaCode: true });
    }
    const controller = players[0];
    roomManager.setController(host.id, controller.id);
    roomManager.joinRoom(lastPlayer, room.code, { viaCode: true });
    for (const player of room.players) {
      if (player.id !== controller.id) roomManager.setReady(player.id, true);
    }
    roomManager.startGame(host.id);

    expect(room.game?.players).toHaveLength(6);
    expect(room.game?.players.some((player) => player.id === controller.id)).toBe(false);
    expect(roomManager.gameStateFor(room, controller.id)?.isController).toBe(true);
  });

  it('does not allow a player to be in two rooms at once', () => {
    const host = makeActor();
    const first = roomManager.createRoom(host, { isPrivate: true });
    openRooms.push(first.room.id);
    expect(() => roomManager.createRoom(host, { isPrivate: true })).toThrowError('already_in_room');
  });

  it('19. runs multiple independent rooms at the same time', () => {
    const roomA = startSixPlayerRoom();
    const roomB = startSixPlayerRoom();

    expect(roomA.room.id).not.toBe(roomB.room.id);
    expect(roomA.room.code).not.toBe(roomB.room.code);
    expect(roomA.room.status).toBe('playing');
    expect(roomB.room.status).toBe('playing');
    expect(roomA.room.game?.id).not.toBe(roomB.room.game?.id);
    expect(roomManager.metrics().liveGames).toBeGreaterThanOrEqual(2);

    advance(roomA.room);
    expect(roomA.room.game?.phase).toBe('night');
    // Room B is untouched by room A's phase change.
    expect(roomB.room.game?.phase).toBe('role_reveal');
    expect(roomB.room.game?.day).toBe(0);

    // Both rooms still expose independent private views.
    const viewA = roomManager.gameStateFor(roomA.room, roomA.actors[0].id);
    const viewB = roomManager.gameStateFor(roomB.room, roomB.actors[0].id);
    expect(viewA?.id).toBe(roomA.room.game?.id);
    expect(viewB?.id).toBe(roomB.room.game?.id);
    expect(viewA?.id).not.toBe(viewB?.id);
  });

  it('does not expose hidden roles through the public room state', () => {
    const { room, actors } = startSixPlayerRoom();
    const publicState = roomManager.publicState(room);
    const serialized = JSON.stringify(publicState);
    for (const player of room.game!.players) {
      expect(serialized).not.toContain(`"role":"${player.role}"`);
    }
    expect(publicState).not.toHaveProperty('game.players');
    expect(roomManager.gameStateFor(room, null)?.self).toBeNull();
    // Every seated player gets their own role.
    for (const actor of actors) {
      expect(roomManager.gameStateFor(room, actor.id)?.self?.role).toBeTruthy();
    }
  });
});
