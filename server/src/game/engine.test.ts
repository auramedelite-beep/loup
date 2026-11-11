import { describe, expect, it } from 'vitest';
import {
  allNightActorsSubmitted,
  allVotersVoted,
  advancePhase,
  buildView,
  checkVictory,
  createGame,
  getPlayer,
  livingPlayers,
  nightPromptFor,
  resolveHunter,
  resolveNight,
  resolveVote,
  startNight,
  startVoting,
  submitNightAction,
  submitVote,
  voteCounts,
} from './engine';
import { BASE_SETTINGS, PLAYABLE_ROLE_IDS, ROLES, defaultRoleCounts, emptyRoleCounts, normalizeRoleCounts } from './roles';
import type { Game, GameMode, GameSettings, RoleId } from './types';

/** Deterministic RNG so failure reports are reproducible. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function settingsFor(roleCounts: Record<RoleId, number>, overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    ...BASE_SETTINGS,
    mode: 'classic' as GameMode,
    roleCounts,
    ...overrides,
  };
}

function countRoles(roles: RoleId[]): Record<RoleId, number> {
  const counts = emptyRoleCounts();
  for (const role of roles) counts[role] += 1;
  return counts;
}

/** Creates a game whose seat roles are exactly `roles` (in seat order). */
function gameWithRoles(roles: RoleId[], overrides: Partial<GameSettings> = {}): Game {
  const players = roles.map((_, index) => ({
    id: `p${index + 1}`,
    username: `Player${index + 1}`,
    avatar: 'wolf',
    seat: index,
  }));
  const game = createGame({
    roomId: 'room-test',
    mode: 'classic',
    settings: settingsFor(countRoles(roles), overrides),
    players,
    rng: seededRng(42),
  });

  // createGame deals randomly; re-deal deterministically by seat for scenario tests.
  game.players.forEach((player, index) => {
    const role = roles[index];
    player.role = role;
    player.team = ROLES[role].team;
    player.uses =
      role === 'witch'
        ? { heal: 1, poison: 1 }
        : role === 'wolf_father'
          ? { infect: 1 }
          : role === 'black_wolf'
            ? { curse: 1 }
            : {};
    player.extraLife = role === 'elder';
    player.isLover = false;
    player.loverId = null;
    player.charmed = false;
    player.infected = false;
    player.alive = true;
    player.revealedRole = null;
  });
  game.initialWolves = game.players.filter((p) => p.team === 'werewolf').length;
  return game;
}

function byRole(game: Game, role: RoleId) {
  const player = game.players.find((p) => p.role === role);
  if (!player) throw new Error(`role ${role} not in game`);
  return player;
}

function aliveExcept(game: Game, id: string) {
  return game.players.filter((p) => p.alive && p.id !== id);
}

function toNight(game: Game): void {
  startNight(game, Date.now());
}

function allVoteFor(game: Game, targetId: string): void {
  for (const voter of game.players.filter((p) => p.alive && p.canVote && p.id !== targetId)) {
    const result = submitVote(game, voter.id, targetId);
    expect(result.ok).toBe(true);
  }
}

describe('game setup and role distribution', () => {
  it('1. starts a game with the minimum supported player count (6)', () => {
    const counts = defaultRoleCounts(6);
    const players = Array.from({ length: 6 }, (_, i) => ({
      id: `min-${i}`,
      username: `Min${i}`,
      avatar: 'wolf',
      seat: i,
    }));
    const game = createGame({
      roomId: 'min-room',
      mode: 'classic',
      settings: settingsFor(counts),
      players,
      rng: seededRng(1),
    });
    expect(game.players).toHaveLength(6);
    expect(game.players.filter((p) => p.team === 'werewolf')).toHaveLength(1);
    expect(game.phase).toBe('role_reveal');
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('2. starts a game with the maximum supported player count (18)', () => {
    const counts = defaultRoleCounts(18);
    const players = Array.from({ length: 18 }, (_, i) => ({
      id: `max-${i}`,
      username: `Max${i}`,
      avatar: 'moon',
      seat: i,
    }));
    const game = createGame({
      roomId: 'max-room',
      mode: 'classic',
      settings: settingsFor(counts),
      players,
      rng: seededRng(2),
    });
    expect(game.players).toHaveLength(18);
    expect(game.players.filter((p) => p.team === 'werewolf').length).toBeGreaterThanOrEqual(4);
    expect(new Set(game.players.map((p) => p.id)).size).toBe(18);
  });

  it('3. distributes exactly the configured roles, randomly, without duplicates', () => {
    const expected = defaultRoleCounts(10);
    for (let run = 0; run < 25; run++) {
      const players = Array.from({ length: 10 }, (_, i) => ({
        id: `dist-${run}-${i}`,
        username: `D${i}`,
        avatar: 'owl',
        seat: i,
      }));
      const game = createGame({
        roomId: `dist-${run}`,
        mode: 'classic',
        settings: settingsFor(expected),
        players,
        rng: seededRng(run + 100),
      });
      const actual = countRoles(game.players.map((p) => p.role));
      expect(actual).toEqual(expected);
    }
  });

  it('converts duplicate special roles to villagers during custom setup', () => {
    const counts = normalizeRoleCounts({ werewolf: 2, seer: 3 }, 6);
    expect(counts).toMatchObject({ werewolf: 2, seer: 1, villager: 3 });
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(6);
  });

  it('only assigns the nine configured roles', () => {
    const counts = defaultRoleCounts(18);
    expect(PLAYABLE_ROLE_IDS).toEqual([
      'villager', 'seer', 'werewolf', 'witch', 'hunter', 'lion', 'savior', 'raven', 'owl',
    ]);
    expect(Object.entries(counts).filter(([, count]) => count > 0).every(([role]) => PLAYABLE_ROLE_IDS.includes(role as RoleId))).toBe(true);
  });
});

describe('night resolution', () => {
  it('the lion kills the wolf that attacked it', () => {
    const game = gameWithRoles(['werewolf', 'lion', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const lion = byRole(game, 'lion');
    toNight(game);
    expect(submitNightAction(game, wolf.id, { type: 'kill', target: lion.id }).ok).toBe(true);

    resolveNight(game, seededRng(31));

    expect(lion.alive).toBe(false);
    expect(wolf.alive).toBe(false);
    expect(wolf.deathCause).toBe('lion_revenge');
    expect(game.nightDeaths).toContain(wolf.id);
    expect(game.winner?.team).toBe('village');
  });

  it('the owl removes one vote from its target in the next vote only', () => {
    const game = gameWithRoles(['werewolf', 'owl', 'villager', 'villager', 'villager', 'villager']);
    const owl = byRole(game, 'owl');
    const target = game.players.find((p) => p.role === 'villager')!;
    toNight(game);
    expect(submitNightAction(game, owl.id, { type: 'weaken_vote', target: target.id }).ok).toBe(true);

    resolveNight(game, seededRng(32));
    expect(game.owlTargetId).toBe(target.id);
    expect(buildView(game, owl.id).vote.weakenedId).toBe(target.id);
    expect(buildView(game, target.id).vote.weakenedId).toBeNull();

    startVoting(game);
    const voters = game.players.filter((p) => p.alive && p.id !== target.id);
    for (const voter of voters.slice(0, 2)) submitVote(game, voter.id, target.id);
    expect(voteCounts(game)[target.id]).toBe(1);
    resolveVote(game, seededRng(33));
    expect(game.owlTargetId).toBeNull();
  });

  it('4. eliminates a werewolf by vote and ends the game for the village', () => {
    const game = gameWithRoles(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    startVoting(game);
    allVoteFor(game, wolf.id);
    // The wolf also casts a vote (for a villager) so every voter has voted.
    submitVote(game, wolf.id, byRole(game, 'villager').id);
    expect(allVotersVoted(game)).toBe(true);
    resolveVote(game, seededRng(3));
    expect(getPlayer(game, wolf.id)?.alive).toBe(false);
    expect(game.winner?.team).toBe('village');
    expect(game.winner?.reason).toBe('village_all_wolves_dead');
    expect(game.phase).toBe('ended');
    expect(game.endedAt).not.toBeNull();
  });

  it('5. a bodyguard protects the werewolf victim', () => {
    const game = gameWithRoles(['werewolf', 'bodyguard', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const guard = byRole(game, 'bodyguard');
    const victim = byRole(game, 'villager');
    toNight(game);
    expect(submitNightAction(game, wolf.id, { type: 'kill', target: victim.id }).ok).toBe(true);
    expect(submitNightAction(game, guard.id, { type: 'protect', target: victim.id }).ok).toBe(true);
    resolveNight(game, seededRng(4));
    expect(getPlayer(game, victim.id)?.alive).toBe(true);
    expect(game.nightDeaths).toHaveLength(0);
    expect(guard.lastProtected).toBe(victim.id);
  });

  it('the savior protects the werewolf victim', () => {
    const game = gameWithRoles(['werewolf', 'savior', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const savior = byRole(game, 'savior');
    const victim = byRole(game, 'villager');
    toNight(game);
    expect(submitNightAction(game, wolf.id, { type: 'kill', target: victim.id }).ok).toBe(true);
    expect(submitNightAction(game, savior.id, { type: 'protect', target: victim.id }).ok).toBe(true);
    resolveNight(game, seededRng(34));
    expect(victim.alive).toBe(true);
    expect(savior.lastProtected).toBe(victim.id);
  });

  it('6. the witch heals the werewolf victim', () => {
    const game = gameWithRoles(['werewolf', 'witch', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const witch = byRole(game, 'witch');
    const victim = byRole(game, 'villager');
    toNight(game);
    submitNightAction(game, wolf.id, { type: 'kill', target: victim.id });
    expect(submitNightAction(game, witch.id, { type: 'witch', heal: victim.id, poison: null }).ok).toBe(true);
    // The witch privately sees who was attacked.
    expect(nightPromptFor(game, witch)?.extra?.witchVictimId).toBe(victim.id);
    resolveNight(game, seededRng(5));
    expect(getPlayer(game, victim.id)?.alive).toBe(true);
    expect(witch.uses.heal).toBe(0);
  });

  it('7. the witch poisons a player', () => {
    const game = gameWithRoles(['werewolf', 'witch', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const witch = byRole(game, 'witch');
    const victim = byRole(game, 'villager');
    toNight(game);
    submitNightAction(game, wolf.id, { type: 'kill', target: null });
    expect(submitNightAction(game, witch.id, { type: 'witch', heal: null, poison: victim.id }).ok).toBe(true);
    resolveNight(game, seededRng(6));
    expect(getPlayer(game, victim.id)?.alive).toBe(false);
    expect(game.nightDeaths).toContain(victim.id);
    expect(witch.uses.poison).toBe(0);
  });

  it('8. the seer learns a target is a werewolf — and only the seer sees it', () => {
    const game = gameWithRoles(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const seer = byRole(game, 'seer');
    const villager = byRole(game, 'villager');
    toNight(game);
    expect(submitNightAction(game, seer.id, { type: 'investigate', target: wolf.id }).ok).toBe(true);
    resolveNight(game, seededRng(7));

    const seerView = buildView(game, seer.id);
    expect(seerView.night.seerHistory).toHaveLength(1);
    expect(seerView.night.seerHistory[0]).toMatchObject({ targetId: wolf.id, isWolf: true });

    const villagerView = buildView(game, villager.id);
    expect(villagerView.night.seerHistory).toHaveLength(0);
    expect(villagerView.events.some((e) => e.type === 'seer_result')).toBe(false);
  });

  it('9. the hunter shoots a player when killed and can win the game', () => {
    const game = gameWithRoles(['werewolf', 'hunter', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const hunter = byRole(game, 'hunter');
    toNight(game);
    submitNightAction(game, wolf.id, { type: 'kill', target: hunter.id });
    resolveNight(game, seededRng(8));
    expect(hunter.alive).toBe(false);
    expect(game.phase).toBe('hunter');
    expect(game.pendingHunterId).toBe(hunter.id);
    expect(buildView(game, hunter.id).prompt?.action).toBe('hunter_shot');

    resolveHunter(game, wolf.id);
    expect(getPlayer(game, wolf.id)?.alive).toBe(false);
    expect(game.winner?.team).toBe('village');
    expect(game.hunterUsed).toBe(true);
  });

  it('11. resolves simultaneous night deaths (wolf attack + witch poison)', () => {
    const game = gameWithRoles(['werewolf', 'witch', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const witch = byRole(game, 'witch');
    const [victimA, victimB] = game.players.filter((p) => p.role === 'villager');
    toNight(game);
    submitNightAction(game, wolf.id, { type: 'kill', target: victimA.id });
    submitNightAction(game, witch.id, { type: 'witch', heal: null, poison: victimB.id });
    resolveNight(game, seededRng(9));
    expect(getPlayer(game, victimA.id)?.alive).toBe(false);
    expect(getPlayer(game, victimB.id)?.alive).toBe(false);
    expect(game.nightDeaths.sort()).toEqual([victimA.id, victimB.id].sort());
  });
});

describe('lovers', () => {
  it('10. Cupid links two lovers: both know, and one dies of heartbreak', () => {
    const game = gameWithRoles([
      'werewolf',
      'cupid',
      'villager',
      'villager',
      'villager',
      'villager',
      'villager',
      'villager',
    ]);
    const cupid = byRole(game, 'cupid');
    const [a, b] = game.players.filter((p) => p.role === 'villager');
    toNight(game);
    expect(submitNightAction(game, cupid.id, { type: 'lovers', targets: [a.id, b.id] }).ok).toBe(true);
    resolveNight(game, seededRng(10));

    expect(a.isLover).toBe(true);
    expect(b.isLover).toBe(true);
    expect(a.loverId).toBe(b.id);
    expect(b.loverId).toBe(a.id);
    // Each lover can see their partner, nobody else can.
    expect(buildView(game, a.id).players.find((p) => p.id === b.id)?.isLover).toBe(true);
    expect(buildView(game, cupid.id).players.find((p) => p.id === b.id)?.isLover).toBe(false);

    startVoting(game);
    allVoteFor(game, a.id);
    resolveVote(game, seededRng(11));
    expect(getPlayer(game, a.id)?.alive).toBe(false);
    expect(getPlayer(game, b.id)?.alive).toBe(false);
    expect(getPlayer(game, b.id)?.deathCause).toBe('heartbreak');
  });
});

describe('voting', () => {
  it('12. resolves a tie according to the configured rule', () => {
    const roles: RoleId[] = ['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager'];
    const game = gameWithRoles(roles, { tieRule: 'no_elimination' });
    const [p1, p2, p3, p4, p5, p6] = game.players;
    startVoting(game);
    expect(submitVote(game, p2.id, p3.id).ok).toBe(true);
    expect(submitVote(game, p3.id, p4.id).ok).toBe(true);
    expect(submitVote(game, p4.id, p5.id).ok).toBe(true);
    expect(submitVote(game, p5.id, p6.id).ok).toBe(true);
    expect(submitVote(game, p6.id, p3.id).ok).toBe(true);
    expect(submitVote(game, p1.id, p4.id).ok).toBe(true);
    // p3:2, p4:2, p5:1, p6:1 — force a three-way tie instead.
    game.votes = {};
    submitVote(game, p2.id, p3.id);
    submitVote(game, p3.id, p4.id);
    submitVote(game, p4.id, p5.id);
    submitVote(game, p5.id, p3.id);
    submitVote(game, p6.id, p4.id);
    submitVote(game, p1.id, p5.id);
    expect(voteCounts(game)).toEqual({ [p3.id]: 2, [p4.id]: 2, [p5.id]: 2 });

    resolveVote(game, seededRng(12));
    expect(game.voteResult?.tie).toBe(true);
    expect(game.voteResult?.eliminatedId).toBeNull();
    expect(game.players.filter((p) => !p.alive)).toHaveLength(0);

    const randomGame = gameWithRoles(roles, { tieRule: 'random' });
    const [r1, r2, r3, r4, r5, r6] = randomGame.players;
    startVoting(randomGame);
    submitVote(randomGame, r2.id, r3.id);
    submitVote(randomGame, r3.id, r4.id);
    submitVote(randomGame, r4.id, r5.id);
    submitVote(randomGame, r5.id, r3.id);
    submitVote(randomGame, r6.id, r4.id);
    submitVote(randomGame, r1.id, r5.id);
    resolveVote(randomGame, seededRng(13));
    expect(randomGame.voteResult?.tie).toBe(true);
    expect([r3.id, r4.id, r5.id]).toContain(randomGame.voteResult?.eliminatedId);
    expect(randomGame.voteResult?.eliminatedId).not.toBeNull();
  });

  it('16. ends the game with a winner, a phase and a duration', () => {
    const game = gameWithRoles(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
    expect(game.winner).toBeNull();
    const wolf = byRole(game, 'werewolf');
    startVoting(game);
    allVoteFor(game, wolf.id);
    resolveVote(game, seededRng(16));
    expect(checkVictory(game)).toBe(true);
    expect(game.phase).toBe('ended');
    expect(game.winner).not.toBeNull();
    expect(game.winner!.playerIds.length).toBeGreaterThan(0);
    expect(game.endedAt).toBeGreaterThanOrEqual(game.startedAt);
  });

  it('17. rejects unauthorized game actions', () => {
    const game = gameWithRoles(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    const wolf = byRole(game, 'werewolf');
    const seer = byRole(game, 'seer');
    const villager = byRole(game, 'villager');

    toNight(game);
    // Villagers have no night action.
    expect(submitNightAction(game, villager.id, { type: 'kill', target: seer.id })).toEqual({
      ok: false,
      error: 'no_action_available',
    });
    // A role may not use another role's ability.
    expect(submitNightAction(game, seer.id, { type: 'kill', target: villager.id })).toEqual({
      ok: false,
      error: 'invalid_action',
    });
    // Werewolves cannot kill their own team (including themselves).
    expect(submitNightAction(game, wolf.id, { type: 'kill', target: wolf.id })).toEqual({
      ok: false,
      error: 'cannot_target_wolf',
    });
    // Dead players cannot act.
    villager.alive = false;
    expect(submitNightAction(game, villager.id, { type: 'kill', target: seer.id }).ok).toBe(false);
    wolf.alive = false;
    expect(submitNightAction(game, wolf.id, { type: 'kill', target: seer.id })).toEqual({
      ok: false,
      error: 'not_alive',
    });
    wolf.alive = true;
    expect(submitVote(game, wolf.id, seer.id)).toEqual({ ok: false, error: 'not_voting' });
    game.phase = 'voting';
    expect(submitVote(game, villager.id, wolf.id)).toEqual({ ok: false, error: 'not_alive' });
    expect(submitVote(game, seer.id, seer.id)).toEqual({ ok: false, error: 'cannot_vote_self' });
  });

  it('18. prevents duplicate votes when vote changes are disabled', () => {
    const game = gameWithRoles(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager'], {
      allowVoteChange: false,
    });
    const [wolf, a, b, c] = game.players;
    startVoting(game);
    expect(submitVote(game, wolf.id, a.id).ok).toBe(true);
    expect(submitVote(game, wolf.id, b.id)).toEqual({ ok: false, error: 'vote_locked' });
    expect(game.votes[wolf.id]).toBe(a.id);
    expect(voteCounts(game)[a.id]).toBe(1);

    const changing = gameWithRoles(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager'], {
      allowVoteChange: true,
    });
    const [w2, a2, b2] = changing.players;
    startVoting(changing);
    expect(submitVote(changing, w2.id, a2.id).ok).toBe(true);
    expect(submitVote(changing, w2.id, b2.id).ok).toBe(true);
    expect(voteCounts(changing)[a2.id]).toBeUndefined();
    expect(voteCounts(changing)[b2.id]).toBe(1);
    // One message per voter can never be counted twice.
    expect(Object.keys(changing.votes).filter((id) => id === w2.id)).toHaveLength(1);
    void c;
  });
});

describe('information security', () => {
  it('20. never leaks hidden roles, wolf actions or private events to a villager', () => {
    const game = gameWithRoles([
      'werewolf',
      'werewolf',
      'seer',
      'bodyguard',
      'villager',
      'villager',
    ]);
    const wolves = game.players.filter((p) => p.role === 'werewolf');
    const wolf = wolves[0];
    const otherWolf = wolves[1];
    const seer = byRole(game, 'seer');
    const villager = byRole(game, 'villager');
    const victim = game.players.filter((p) => p.role === 'villager')[1];
    toNight(game);
    submitNightAction(game, wolf.id, { type: 'kill', target: victim.id });
    submitNightAction(game, seer.id, { type: 'investigate', target: wolf.id });

    const view = buildView(game, villager.id);
    expect(view.players.find((p) => p.id === wolf.id)?.revealedRole).toBeNull();
    expect(view.players.find((p) => p.id === seer.id)?.revealedRole).toBeNull();
    expect(view.wolfTeammates).toHaveLength(0);
    expect(view.night.wolfTargetId).toBeNull();
    expect(view.night.wolfVotes).toBeNull();
    expect(view.night.seerHistory).toHaveLength(0);
    expect(view.events.every((e) => e.visibility === 'public')).toBe(true);
    expect(view.self?.role).toBe('villager');

    // Spectators do not receive a private self view either.
    const spectatorView = buildView(game, null);
    expect(spectatorView.self).toBeNull();
    expect(spectatorView.night.wolfVotes).toBeNull();

    // Werewolves do see their team and their votes.
    const wolfView = buildView(game, wolf.id);
    expect(wolfView.wolfTeammates.map((t) => t.id)).toEqual([otherWolf.id]);
    expect(wolfView.night.wolfVotes).not.toBeNull();

    // Once the game is over, roles are revealed to everyone.
    game.phase = 'ended';
    const revealed = buildView(game, villager.id);
    expect(revealed.players.every((p) => p.revealedRole !== null)).toBe(true);
  });

  it('hides the live tally but exposes aggregate vote progress during voting', () => {
    const game = gameWithRoles(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
    const [wolf, a, b] = game.players;
    startVoting(game);
    submitVote(game, wolf.id, a.id);
    submitVote(game, a.id, b.id);

    const view = buildView(game, b.id);
    expect(view.vote.votedCount).toBe(2);
    expect(view.vote.voterCount).toBe(6);
    expect(view.vote.counts).toEqual({});
    expect(view.vote.result).toBeNull();
    // A player still sees their own ballot.
    expect(buildView(game, wolf.id).vote.ownVote).toBe(a.id);

    resolveVote(game, seededRng(99));
    const revealed = buildView(game, b.id);
    expect(Object.keys(revealed.vote.counts).length).toBeGreaterThan(0);
    expect(revealed.vote.result).not.toBeNull();
  });

  it('handles role prompts correctly (no prompt outside the night / for dead players)', () => {
    const game = gameWithRoles(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    const seer = byRole(game, 'seer');
    expect(nightPromptFor(game, seer)).toBeNull();
    toNight(game);
    expect(nightPromptFor(game, seer)?.action).toBe('investigate');
    seer.alive = false;
    expect(nightPromptFor(game, seer)).toBeNull();
  });
});

describe('phase state machine', () => {
  it('advances role reveal → night → dawn → discussion → voting → result', () => {
    const game = gameWithRoles(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
    advancePhase(game);
    expect(game.phase).toBe('night');
    expect(game.day).toBe(1);
    advancePhase(game);
    expect(game.phase).toBe('dawn');
    advancePhase(game);
    expect(game.phase).toBe('discussion');
    advancePhase(game);
    expect(game.phase).toBe('voting');
    advancePhase(game);
    expect(game.phase).toBe('vote_result');
    advancePhase(game);
    expect(game.phase).toBe('night');
    expect(game.day).toBe(2);
  });

  it('auto-resolves the night when all night actors have submitted', () => {
    const game = gameWithRoles(['werewolf', 'seer', 'bodyguard', 'villager', 'villager', 'villager']);
    toNight(game);
    expect(allNightActorsSubmitted(game)).toBe(false);
    const wolf = byRole(game, 'werewolf');
    const seer = byRole(game, 'seer');
    const guard = byRole(game, 'bodyguard');
    const victim = byRole(game, 'villager');
    submitNightAction(game, wolf.id, { type: 'kill', target: victim.id });
    submitNightAction(game, seer.id, { type: 'investigate', target: wolf.id });
    submitNightAction(game, guard.id, { type: 'protect', target: victim.id });
    expect(allNightActorsSubmitted(game)).toBe(true);
  });

  it('lets all living voters be counted, and dead players excluded', () => {
    const game = gameWithRoles(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
    startVoting(game);
    game.players[5].alive = false;
    expect(livingPlayers(game)).toHaveLength(5);
    for (const p of game.players.filter((p) => p.alive)) {
      if (p.id !== game.players[0].id) submitVote(game, p.id, game.players[0].id);
    }
    submitVote(game, game.players[0].id, game.players[1].id);
    expect(allVotersVoted(game)).toBe(true);
  });
});
