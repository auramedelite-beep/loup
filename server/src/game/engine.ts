import { randomBytes, randomUUID } from 'node:crypto';
import { ROLES, normalizeRoleCounts } from './roles';
import type {
  Game,
  GameEvent,
  GameMode,
  GamePlayer,
  GameSettings,
  GameView,
  GameWinner,
  NightAction,
  NightActionType,
  NightPrompt,
  Phase,
  PublicPlayerView,
  RoleId,
  Team,
  VoteResult,
} from './types';

export type Rng = () => number;

/** Cryptographically secure RNG suitable for role assignment. */
export const secureRng: Rng = () => {
  const buf = randomBytes(6);
  return buf.readUIntBE(0, 6) / 2 ** 48;
};

export interface NewGamePlayer {
  id: string;
  username: string;
  avatar: string;
  seat: number;
  isBot?: boolean;
}

export interface CreateGameParams {
  roomId: string;
  mode: GameMode;
  settings: GameSettings;
  players: NewGamePlayer[];
  rng?: Rng;
  at?: number;
}

const ROLE_REVEAL_MS = 10_000;
const DAWN_MS = 7_000;
const VOTE_RESULT_MS = 7_000;
const HUNTER_MS = 20_000;

export function getPlayer(game: Game, id: string): GamePlayer | undefined {
  return game.players.find((p) => p.id === id);
}

export function livingPlayers(game: Game): GamePlayer[] {
  return game.players.filter((p) => p.alive);
}

export function livingWolves(game: Game): GamePlayer[] {
  return game.players.filter((p) => p.alive && p.team === 'werewolf');
}

export function isWolfSide(player: GamePlayer): boolean {
  return player.team === 'werewolf';
}

function shuffle<T>(input: T[], rng: Rng): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pushEvent(
  game: Game,
  type: string,
  data: Record<string, unknown>,
  visibility: GameEvent['visibility'] = 'public',
  userId?: string,
): void {
  game.eventSeq += 1;
  game.events.push({
    id: game.eventSeq,
    day: game.day,
    phase: game.phase,
    at: Date.now(),
    type,
    visibility,
    ...(userId ? { userId } : {}),
    data,
  });
}

function bump(game: Game): void {
  game.version += 1;
}

export function createGame(params: CreateGameParams): Game {
  const rng = params.rng ?? secureRng;
  const at = params.at ?? Date.now();
  const players = [...params.players].sort((a, b) => a.seat - b.seat);
  if (players.length < 2) throw new Error('At least 2 players are required');
  if (players.length > params.settings.maxPlayers) throw new Error('Too many players');

  const roleCounts = normalizeRoleCounts(params.settings.roleCounts, players.length);
  const deck: RoleId[] = [];
  for (const [role, count] of Object.entries(roleCounts) as [RoleId, number][]) {
    for (let i = 0; i < count; i++) deck.push(role);
  }
  if (deck.length !== players.length) {
    throw new Error(`Role distribution mismatch (${deck.length} roles for ${players.length} players)`);
  }
  const shuffled = shuffle(deck, rng);
  const usedIds = new Set<string>();

  const gamePlayers: GamePlayer[] = players.map((p, idx) => {
    if (usedIds.has(p.id)) throw new Error('Duplicate player in game');
    usedIds.add(p.id);
    const role = shuffled[idx];
    const uses: Record<string, number> = {};
    if (role === 'witch') {
      uses.heal = 1;
      uses.poison = 1;
    }
    if (role === 'wolf_father') uses.infect = 1;
    if (role === 'black_wolf') uses.curse = 1;
    return {
      id: p.id,
      username: p.username,
      avatar: p.avatar,
      seat: p.seat,
      role,
      team: ROLES[role].team,
      alive: true,
      revealedRole: null,
      isBot: Boolean(p.isBot),
      roleHidden: false,
      isLover: false,
      loverId: null,
      charmed: false,
      infected: false,
      canVote: true,
      extraLife: role === 'elder',
      modelId: null,
      contractTarget: null,
      uses,
      lastProtected: null,
      deathCause: null,
      deathDay: null,
    };
  });

  const game: Game = {
    id: randomUUID(),
    roomId: params.roomId,
    mode: params.mode,
    settings: {
      ...params.settings,
      roleCounts,
    },
    day: 0,
    phase: 'role_reveal',
    phaseEndsAt: at + ROLE_REVEAL_MS,
    createdAt: at,
    startedAt: at,
    endedAt: null,
    players: gamePlayers,
    nightActions: {},
    votes: {},
    voteRound: 0,
    voteResult: null,
    nightDeaths: [],
    wolfTargetId: null,
    events: [],
    winner: null,
    pendingHunterId: null,
    hunterContext: null,
    hunterUsed: false,
    ravenTarget: null,
    owlTargetId: null,
    villagePowersLost: false,
    initialWolves: gamePlayers.filter((p) => p.team === 'werewolf').length,
    mvpId: null,
    impact: Object.fromEntries(gamePlayers.map((p) => [p.id, 0])),
    version: 1,
    eventSeq: 0,
  };

  pushEvent(game, 'game_started', { playerCount: gamePlayers.length, mode: params.mode });
  return game;
}

function rolePowerActive(game: Game, player: GamePlayer): boolean {
  if (!player.alive) return false;
  if (game.villagePowersLost && ROLES[player.role].team === 'village') return false;
  return true;
}

function wolfSideHasDied(game: Game): boolean {
  return game.players.some((p) => !p.alive && ROLES[p.role].wolfSide);
}

export function isActorAvailable(game: Game, player: GamePlayer): boolean {
  const def = ROLES[player.role];
  if (!def.nightAction) return false;
  if (!rolePowerActive(game, player)) return false;
  if (def.firstNightOnly && game.day !== 1) return false;
  if (player.role === 'witch') return (player.uses.heal ?? 0) > 0 || (player.uses.poison ?? 0) > 0;
  if (player.role === 'wolf_father') return (player.uses.infect ?? 0) > 0;
  if (player.role === 'black_wolf') return (player.uses.curse ?? 0) > 0;
  if (player.role === 'white_wolf') return game.day % 2 === 0;
  if (player.role === 'big_bad_wolf') return !wolfSideHasDied(game);
  return true;
}

export function livingNightActors(game: Game): GamePlayer[] {
  return game.players.filter((p) => p.alive && isActorAvailable(game, p));
}

export function allNightActorsSubmitted(game: Game): boolean {
  const actors = livingNightActors(game);
  if (actors.length === 0) return true;
  return actors.every((p) => Boolean(game.nightActions[p.id]));
}

/** Current plurality of the werewolves' kill votes. Used by the witch and little girl. */
export function wolfPlurality(game: Game): { targetId: string | null; votes: Record<string, string>; tie: boolean } {
  const votes: Record<string, string> = {};
  for (const p of game.players) {
    if (!p.alive || p.team !== 'werewolf') continue;
    const action = game.nightActions[p.id];
    if (action?.type === 'kill' && action.target) votes[p.id] = action.target;
  }
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) tally[target] = (tally[target] ?? 0) + 1;
  let best = 0;
  for (const count of Object.values(tally)) best = Math.max(best, count);
  if (best === 0) return { targetId: null, votes, tie: false };
  const leaders = Object.keys(tally).filter((id) => tally[id] === best);
  return { targetId: leaders.length === 1 ? leaders[0] : null, votes, tie: leaders.length > 1 };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function aliveById(game: Game, id: string | null | undefined): GamePlayer | undefined {
  if (!id) return undefined;
  const p = getPlayer(game, id);
  return p && p.alive ? p : undefined;
}

export function submitNightAction(game: Game, actorId: string, action: NightAction): ActionResult {
  if (game.phase !== 'night') return { ok: false, error: 'not_night' };
  const actor = getPlayer(game, actorId);
  if (!actor || !actor.alive) return { ok: false, error: 'not_alive' };
  const def = ROLES[actor.role];
  if (!isActorAvailable(game, actor)) return { ok: false, error: 'no_action_available' };
  if (!def.nightAction || action.type !== def.nightAction) return { ok: false, error: 'invalid_action' };

  const target = action.target ? aliveById(game, action.target) : undefined;

  switch (action.type) {
    case 'kill': {
      if (target && target.team === 'werewolf') return { ok: false, error: 'cannot_target_wolf' };
      if (target && target.id === actor.id) return { ok: false, error: 'cannot_target_self' };
      break;
    }
    case 'protect': {
      if (target && target.id === actor.id) return { ok: false, error: 'cannot_target_self' };
      if (target && actor.lastProtected === target.id) return { ok: false, error: 'cannot_repeat_target' };
      break;
    }
    case 'investigate': {
      if (target && target.id === actor.id) return { ok: false, error: 'cannot_target_self' };
      break;
    }
    case 'weaken_vote': {
      if (!target) return { ok: false, error: 'invalid_target' };
      if (target.id === actor.id) return { ok: false, error: 'cannot_target_self' };
      break;
    }
    case 'witch': {
      const heal = action.heal ? aliveById(game, action.heal) : undefined;
      const poison = action.poison ? aliveById(game, action.poison) : undefined;
      if (action.heal && !heal) return { ok: false, error: 'invalid_target' };
      if (action.poison && !poison) return { ok: false, error: 'invalid_target' };
      if (heal && poison) return { ok: false, error: 'one_potion_per_night' };
      if (heal && (actor.uses.heal ?? 0) <= 0) return { ok: false, error: 'no_potion' };
      if (poison && (actor.uses.poison ?? 0) <= 0) return { ok: false, error: 'no_potion' };
      if (heal && heal.id === actor.id && !game.settings.witchSelfHeal) {
        return { ok: false, error: 'self_heal_disabled' };
      }
      if (poison && poison.id === actor.id) return { ok: false, error: 'cannot_target_self' };
      game.nightActions[actor.id] = { type: 'witch', heal: heal?.id ?? null, poison: poison?.id ?? null };
      bump(game);
      return { ok: true };
    }
    case 'lovers': {
      const [a, b] = action.targets ?? [null, null];
      if (!a && !b) {
        game.nightActions[actor.id] = { type: 'lovers', targets: null };
        bump(game);
        return { ok: true };
      }
      const pa = aliveById(game, a);
      const pb = aliveById(game, b);
      if (!pa || !pb || pa.id === pb.id) return { ok: false, error: 'invalid_lovers' };
      game.nightActions[actor.id] = { type: 'lovers', targets: [pa.id, pb.id] };
      bump(game);
      return { ok: true };
    }
    case 'spy': {
      game.nightActions[actor.id] = { type: 'spy' };
      bump(game);
      return { ok: true };
    }
    case 'mark': {
      if (target && target.id === actor.id) return { ok: false, error: 'invalid_target' };
      break;
    }
    case 'charm': {
      if (target && target.id === actor.id) return { ok: false, error: 'invalid_target' };
      if (target && target.charmed) return { ok: false, error: 'already_charmed' };
      break;
    }
    case 'model': {
      if (target && target.id === actor.id) return { ok: false, error: 'invalid_target' };
      break;
    }
    case 'infect': {
      if (target && target.team === 'werewolf') return { ok: false, error: 'cannot_target_wolf' };
      break;
    }
    case 'big_bad_kill': {
      if (target && target.team === 'werewolf') return { ok: false, error: 'cannot_target_wolf' };
      break;
    }
    case 'white_wolf_kill': {
      if (target && target.team !== 'werewolf') return { ok: false, error: 'must_target_wolf' };
      if (target && target.id === actor.id) return { ok: false, error: 'cannot_target_self' };
      break;
    }
    case 'curse': {
      if (target && target.id === actor.id) return { ok: false, error: 'invalid_target' };
      break;
    }
    case 'contract': {
      if (target && target.id === actor.id) return { ok: false, error: 'invalid_target' };
      break;
    }
    default:
      return { ok: false, error: 'invalid_action' };
  }

  game.nightActions[actor.id] = {
    type: action.type,
    target: target?.id ?? null,
  };
  bump(game);
  return { ok: true };
}

function addImpact(game: Game, playerId: string, points: number): void {
  game.impact[playerId] = (game.impact[playerId] ?? 0) + points;
}

interface DeathEntry {
  id: string;
  cause: string;
}

/**
 * Applies deaths atomically, chaining lovers, the wild child transformation,
 * the elder's extra life and triggering the hunter. Returns the ids that died.
 */
function applyDeaths(game: Game, entries: DeathEntry[]): string[] {
  const queue: DeathEntry[] = [...entries];
  const processed = new Set<string>();
  const died: string[] = [];
  const phaseAtDeath: Phase = game.phase === 'voting' ? 'vote_result' : game.phase;

  while (queue.length > 0) {
    const entry = queue.shift()!;
    if (processed.has(entry.id)) continue;
    processed.add(entry.id);
    const p = getPlayer(game, entry.id);
    if (!p || !p.alive) continue;

    if (p.role === 'elder' && p.extraLife && entry.cause === 'wolf') {
      p.extraLife = false;
      pushEvent(game, 'elder_survived', { playerId: p.id, name: p.username });
      addImpact(game, p.id, 1);
      continue;
    }

    p.alive = false;
    p.deathCause = entry.cause;
    p.deathDay = game.day;
    died.push(p.id);

    const shouldReveal = game.settings.revealRoleOnDeath;
    if (!p.roleHidden && shouldReveal) p.revealedRole = p.role;
    if (p.role === 'idiot' && entry.cause === 'vote') p.revealedRole = 'idiot';

    pushEvent(
      game,
      'death',
      {
        playerId: p.id,
        name: p.username,
        cause: entry.cause,
        role: p.revealedRole,
      },
      'public',
    );

    if (p.role === 'hunter' && !game.hunterUsed) {
      game.pendingHunterId = p.id;
      game.hunterContext = phaseAtDeath === 'vote_result' ? 'vote' : 'night';
    }

    if (p.isLover && p.loverId) {
      const lover = getPlayer(game, p.loverId);
      if (lover && lover.alive) queue.push({ id: lover.id, cause: 'heartbreak' });
    }

    for (const other of game.players) {
      if (other.alive && other.role === 'wild_child' && other.modelId === p.id && other.team !== 'werewolf') {
        other.team = 'werewolf';
        pushEvent(
          game,
          'wild_child_transformed',
          { playerId: other.id, modelId: p.id },
          'private',
          other.id,
        );
      }
    }

    if (p.role === 'lion' && entry.cause === 'wolf') {
      const regularAttack = game.wolfTargetId === p.id;
      const attacker = game.players
        .filter((other) => other.alive && other.team === 'werewolf')
        .filter((other) => {
          const action = game.nightActions[other.id];
          return regularAttack
            ? action?.type === 'kill' && action.target === p.id
            : other.role === 'big_bad_wolf' && action?.type === 'big_bad_kill' && action.target === p.id;
        })
        .sort((a, b) => a.seat - b.seat)[0];
      if (attacker) {
        pushEvent(game, 'lion_revenge', { lionId: p.id, wolfId: attacker.id, wolfName: attacker.username });
        queue.push({ id: attacker.id, cause: 'lion_revenge' });
      }
    }
  }

  bump(game);
  return died;
}

function finishGame(game: Game, team: Team | 'lovers', reason: GameWinner['reason'], playerIds: string[]): void {
  if (game.winner) return;
  game.winner = { team, reason, playerIds };
  game.phase = 'ended';
  game.endedAt = Date.now();
  game.phaseEndsAt = game.endedAt;
  game.mvpId = computeMvp(game, playerIds);
  pushEvent(
    game,
    'game_end',
    {
      team,
      reason,
      winners: playerIds,
      mvpId: game.mvpId,
    },
    'public',
  );
}

function computeMvp(game: Game, winnerIds: string[]): string | null {
  if (winnerIds.length === 0) return null;
  const candidates = game.players.filter((p) => winnerIds.includes(p.id));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const impactDiff = (game.impact[b.id] ?? 0) - (game.impact[a.id] ?? 0);
    if (impactDiff !== 0) return impactDiff;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return a.seat - b.seat;
  });
  return candidates[0].id;
}

export function checkVictory(game: Game): boolean {
  if (game.winner) return true;
  const living = livingPlayers(game);
  const wolves = living.filter((p) => p.team === 'werewolf');
  const nonWolves = living.filter((p) => p.team !== 'werewolf');

  const angel = game.players.find((p) => p.role === 'angel');
  if (angel && !angel.alive && angel.deathCause === 'vote' && angel.deathDay === 1) {
    finishGame(game, 'independent', 'angel_lynched', [angel.id]);
    return true;
  }

  const assassin = living.find((p) => p.role === 'assassin');
  if (assassin?.contractTarget) {
    const contract = getPlayer(game, assassin.contractTarget);
    if (contract && !contract.alive) {
      finishGame(game, 'independent', 'assassin_contract', [assassin.id]);
      return true;
    }
  }

  const piper = living.find((p) => p.role === 'piper');
  if (piper && living.length > 1 && living.every((p) => p.id === piper.id || p.charmed)) {
    finishGame(game, 'independent', 'piper_all_charmed', [piper.id]);
    return true;
  }

  const whiteWolf = game.players.find((p) => p.role === 'white_wolf');
  if (
    whiteWolf &&
    whiteWolf.alive &&
    game.initialWolves > 1 &&
    wolves.length === 1 &&
    wolves[0].id === whiteWolf.id
  ) {
    finishGame(game, 'independent', 'white_wolf_alone', [whiteWolf.id]);
    return true;
  }

  if (game.settings.loversWin && living.length === 2) {
    const [a, b] = living;
    if (a.isLover && b.isLover && a.loverId === b.id && b.loverId === a.id) {
      finishGame(game, 'lovers', 'lovers_last_two', [a.id, b.id]);
      return true;
    }
  }

  if (wolves.length === 0) {
    const winners = game.players.filter((p) => p.team === 'village').map((p) => p.id);
    finishGame(game, 'village', 'village_all_wolves_dead', winners);
    return true;
  }

  if (wolves.length >= nonWolves.length) {
    const winners = game.players.filter((p) => p.team === 'werewolf').map((p) => p.id);
    finishGame(game, 'werewolf', 'werewolves_parity', winners);
    return true;
  }

  return false;
}

export function startNight(game: Game, at = Date.now()): void {
  if (game.winner) return;
  game.day += 1;
  game.phase = 'night';
  game.phaseEndsAt = at + game.settings.nightSeconds * 1000;
  game.nightActions = {};
  game.votes = {};
  game.voteResult = null;
  game.nightDeaths = [];
  game.wolfTargetId = null;
  game.owlTargetId = null;
  game.version += 1;
  pushEvent(game, 'night_started', { day: game.day });
}

export function startDiscussion(game: Game, at = Date.now()): void {
  if (game.winner) return;
  game.phase = 'discussion';
  game.phaseEndsAt = at + game.settings.discussionSeconds * 1000;
  game.version += 1;
  pushEvent(game, 'discussion_started', { day: game.day });
}

export function startVoting(game: Game, at = Date.now()): void {
  if (game.winner) return;
  game.phase = 'voting';
  game.votes = {};
  game.voteRound += 1;
  game.voteResult = null;
  game.phaseEndsAt = at + game.settings.votingSeconds * 1000;
  game.version += 1;
  pushEvent(game, 'voting_started', { day: game.day, round: game.voteRound });
}

export function submitVote(game: Game, voterId: string, targetId: string): ActionResult {
  if (game.phase !== 'voting') return { ok: false, error: 'not_voting' };
  const voter = getPlayer(game, voterId);
  const target = getPlayer(game, targetId);
  if (!voter || !voter.alive) return { ok: false, error: 'not_alive' };
  if (!voter.canVote) return { ok: false, error: 'cannot_vote' };
  if (!target || !target.alive) return { ok: false, error: 'invalid_target' };
  if (voter.id === target.id) return { ok: false, error: 'cannot_vote_self' };
  if (game.votes[voterId] && !game.settings.allowVoteChange) return { ok: false, error: 'vote_locked' };
  game.votes[voterId] = targetId;
  game.version += 1;
  return { ok: true };
}

export function allVotersVoted(game: Game): boolean {
  const voters = game.players.filter((p) => p.alive && p.canVote);
  return voters.length > 0 && voters.every((p) => Boolean(game.votes[p.id]));
}

export function voteCounts(game: Game): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of game.players) {
    if (!p.alive || !p.canVote) continue;
    const target = game.votes[p.id];
    if (target) counts[target] = (counts[target] ?? 0) + 1;
  }
  if (game.ravenTarget) {
    const marked = getPlayer(game, game.ravenTarget);
    if (marked && marked.alive) counts[marked.id] = (counts[marked.id] ?? 0) + 2;
  }
  if (game.owlTargetId) {
    const weakened = getPlayer(game, game.owlTargetId);
    if (weakened && weakened.alive) counts[weakened.id] = Math.max(0, (counts[weakened.id] ?? 0) - 1);
  }
  return counts;
}

export function resolveVote(game: Game, rng: Rng = secureRng, at = Date.now()): void {
  if (game.phase !== 'voting' || game.winner) return;
  const counts = voteCounts(game);
  let best = 0;
  for (const count of Object.values(counts)) best = Math.max(best, count);
  const leaders = Object.keys(counts).filter((id) => counts[id] === best && best > 0);
  let eliminatedId: string | null = null;
  let tie = false;

  if (leaders.length === 1) {
    eliminatedId = leaders[0];
  } else if (leaders.length > 1) {
    tie = true;
    if (game.settings.tieRule === 'random') {
      const sorted = [...leaders].sort();
      eliminatedId = sorted[Math.floor(rng() * sorted.length)];
    }
  }

  const result: VoteResult = {
    eliminatedId,
    savedByIdiotId: null,
    tie,
    counts,
    day: game.day,
  };

  let toKill: string | null = eliminatedId;
  if (eliminatedId) {
    const target = getPlayer(game, eliminatedId);
    if (target && target.role === 'idiot' && target.revealedRole !== 'idiot') {
      target.revealedRole = 'idiot';
      target.canVote = false;
      result.savedByIdiotId = target.id;
      result.eliminatedId = null;
      toKill = null;
      pushEvent(game, 'idiot_saved', { playerId: target.id, name: target.username });
      addImpact(game, target.id, 1);
    }
    if (target && target.role === 'elder' && toKill) {
      game.villagePowersLost = true;
      pushEvent(game, 'elder_powers_lost', { playerId: target.id, name: target.username });
    }
    if (target && target.team === 'werewolf') {
      for (const [voterId, votedId] of Object.entries(game.votes)) {
        if (votedId === target.id) addImpact(game, voterId, 2);
      }
    }
  }

  game.voteResult = result;
  game.phase = 'vote_result';
  game.phaseEndsAt = at + VOTE_RESULT_MS;
  game.ravenTarget = null;
  game.owlTargetId = null;
  game.version += 1;

  if (toKill) {
    const deaths = applyDeaths(game, [{ id: toKill, cause: 'vote' }]);
    if (deaths.length === 0) result.eliminatedId = null;
  }

  if (game.pendingHunterId) {
    game.phase = 'hunter';
    game.phaseEndsAt = at + HUNTER_MS;
  } else if (!checkVictory(game)) {
    game.phase = 'vote_result';
    game.phaseEndsAt = at + VOTE_RESULT_MS;
  }
  bump(game);
}

export function resolveNight(game: Game, rng: Rng = secureRng, at = Date.now()): void {
  if (game.phase !== 'night' || game.winner) return;
  const actions = game.nightActions;

  const activeVillage = (p: GamePlayer): boolean => !game.villagePowersLost && p.alive;

  // ── Cupid ────────────────────────────────────────────────────────────────
  const cupid = game.players.find((p) => p.role === 'cupid');
  if (game.day === 1 && cupid && activeVillage(cupid)) {
    const action = actions[cupid.id];
    if (action?.type === 'lovers' && action.targets) {
      const a = getPlayer(game, action.targets[0]);
      const b = getPlayer(game, action.targets[1]);
      if (a && b && a.alive && b.alive && a.id !== b.id) {
        a.isLover = true;
        b.isLover = true;
        a.loverId = b.id;
        b.loverId = a.id;
        pushEvent(game, 'lovers_formed', { partnerId: b.id, partnerName: b.username }, 'private', a.id);
        pushEvent(game, 'lovers_formed', { partnerId: a.id, partnerName: a.username }, 'private', b.id);
      }
    }
  }

  // ── Wild child ───────────────────────────────────────────────────────────
  const wildChild = game.players.find((p) => p.role === 'wild_child');
  if (game.day === 1 && wildChild && wildChild.alive) {
    const action = actions[wildChild.id];
    if (action?.type === 'model' && action.target) {
      const model = getPlayer(game, action.target);
      if (model && model.alive) {
        wildChild.modelId = model.id;
        pushEvent(
          game,
          'model_chosen',
          { modelId: model.id, modelName: model.username },
          'private',
          wildChild.id,
        );
      }
    }
  }

  // ── Assassin contract ────────────────────────────────────────────────────
  const assassin = game.players.find((p) => p.role === 'assassin');
  if (game.day === 1 && assassin && assassin.alive) {
    const action = actions[assassin.id];
    if (action?.type === 'contract' && action.target) {
      const target = getPlayer(game, action.target);
      if (target && target.alive) {
        assassin.contractTarget = target.id;
        pushEvent(
          game,
          'contract_chosen',
          { targetId: target.id, targetName: target.username },
          'private',
          assassin.id,
        );
      }
    }
  }

  // ── Seer ────────────────────────────────────────────────────────────────
  const seer = game.players.find((p) => p.role === 'seer');
  if (seer && activeVillage(seer)) {
    const action = actions[seer.id];
    if (action?.type === 'investigate' && action.target) {
      const target = getPlayer(game, action.target);
      if (target) {
        const isWolf = target.team === 'werewolf';
        if (isWolf) addImpact(game, seer.id, 2);
        pushEvent(
          game,
          'seer_result',
          { targetId: target.id, targetName: target.username, isWolf, day: game.day },
          'private',
          seer.id,
        );
      }
    }
  }

  // ── Bodyguard ────────────────────────────────────────────────────────────
  const bodyguard = game.players.find((p) => p.role === 'savior' || p.role === 'bodyguard');
  let protectedId: string | null = null;
  if (bodyguard && activeVillage(bodyguard)) {
    const action = actions[bodyguard.id];
    if (action?.type === 'protect' && action.target) {
      protectedId = action.target;
      bodyguard.lastProtected = action.target;
    }
  }

  // ── Witch ────────────────────────────────────────────────────────────────
  const witch = game.players.find((p) => p.role === 'witch');
  let healedId: string | null = null;
  let poisonedId: string | null = null;
  if (witch && activeVillage(witch)) {
    const action = actions[witch.id];
    if (action?.type === 'witch') {
      if (action.heal && (witch.uses.heal ?? 0) > 0) {
        healedId = action.heal;
        witch.uses.heal = (witch.uses.heal ?? 0) - 1;
      }
      if (action.poison && (witch.uses.poison ?? 0) > 0) {
        poisonedId = action.poison;
        witch.uses.poison = (witch.uses.poison ?? 0) - 1;
      }
    }
  }

  // ── Raven ────────────────────────────────────────────────────────────────
  const raven = game.players.find((p) => p.role === 'raven');
  if (raven && activeVillage(raven)) {
    const action = actions[raven.id];
    if (action?.type === 'mark' && action.target) {
      const target = getPlayer(game, action.target);
      if (target && target.alive) {
        game.ravenTarget = target.id;
        pushEvent(
          game,
          'raven_marked',
          { targetId: target.id, targetName: target.username },
          'private',
          raven.id,
        );
      }
    }
  }

  const owl = game.players.find((p) => p.role === 'owl');
  if (owl && activeVillage(owl)) {
    const action = actions[owl.id];
    if (action?.type === 'weaken_vote' && action.target) {
      const target = aliveById(game, action.target);
      if (target && target.id !== owl.id) {
        game.owlTargetId = target.id;
        pushEvent(game, 'owl_weakened', { targetId: target.id, targetName: target.username }, 'private', owl.id);
      }
    }
  }

  // ── Piper ────────────────────────────────────────────────────────────────
  const piper = game.players.find((p) => p.role === 'piper');
  if (piper && piper.alive) {
    const action = actions[piper.id];
    if (action?.type === 'charm' && action.target) {
      const target = getPlayer(game, action.target);
      if (target && target.alive && !target.charmed) {
        target.charmed = true;
        pushEvent(game, 'charmed', { byId: piper.id }, 'private', target.id);
        pushEvent(game, 'charm_success', { targetId: target.id, targetName: target.username }, 'private', piper.id);
      }
    }
  }

  // ── Black wolf curse ─────────────────────────────────────────────────────
  const blackWolf = game.players.find((p) => p.role === 'black_wolf');
  if (blackWolf?.alive && (blackWolf.uses.curse ?? 0) > 0) {
    const action = actions[blackWolf.id];
    if (action?.type === 'curse' && action.target) {
      const target = getPlayer(game, action.target);
      if (target && target.alive) {
        target.roleHidden = true;
        blackWolf.uses.curse = 0;
        pushEvent(game, 'cursed', { targetId: target.id, targetName: target.username }, 'private', blackWolf.id);
      }
    }
  }

  // ── Werewolves ───────────────────────────────────────────────────────────
  const plurality = wolfPlurality(game);
  let wolfTargetId: string | null = plurality.targetId;

  // Wolf father infection replaces the kill for the night.
  let infectionTarget: GamePlayer | null = null;
  const wolfFather = game.players.find((p) => p.role === 'wolf_father');
  if (wolfFather?.alive && (wolfFather.uses.infect ?? 0) > 0) {
    const action = actions[wolfFather.id];
    if (action?.type === 'infect' && action.target) {
      const target = getPlayer(game, action.target);
      if (target && target.alive && target.team !== 'werewolf') {
        if (target.id === protectedId || target.id === healedId) {
          pushEvent(game, 'infection_blocked', { targetId: target.id }, 'private', wolfFather.id);
        } else {
          target.infected = true;
          target.team = 'werewolf';
          wolfFather.uses.infect = 0;
          infectionTarget = target;
          wolfTargetId = null;
          pushEvent(game, 'infected', { byId: wolfFather.id }, 'private', target.id);
          pushEvent(
            game,
            'infection_success',
            { targetId: target.id, targetName: target.username },
            'private',
            wolfFather.id,
          );
          addImpact(game, wolfFather.id, 2);
        }
      }
    }
  }

  game.wolfTargetId = wolfTargetId;

  // ── Little girl spy ──────────────────────────────────────────────────────
  const littleGirl = game.players.find((p) => p.role === 'little_girl');
  if (littleGirl && activeVillage(littleGirl)) {
    const action = actions[littleGirl.id];
    if (action?.type === 'spy') {
      const target = wolfTargetId ? getPlayer(game, wolfTargetId) : null;
      pushEvent(
        game,
        'spy_result',
        { targetId: target?.id ?? null, targetName: target?.username ?? null },
        'private',
        littleGirl.id,
      );
      pushEvent(game, 'spy_detected', {}, 'werewolf');
    }
  }

  // ── Resolve doctor / witch protections ───────────────────────────────────
  const deaths: DeathEntry[] = [];
  const attacked: string[] = [];
  const addDeath = (id: string | null | undefined, cause: string) => {
    if (!id) return;
    if (deaths.some((d) => d.id === id)) return;
    deaths.push({ id, cause });
  };
  const safeAttack = (id: string | null | undefined) => {
    if (!id) return;
    attacked.push(id);
    if (id === protectedId || id === healedId) return;
    addDeath(id, 'wolf');
  };

  safeAttack(wolfTargetId);

  const bigBad = game.players.find((p) => p.role === 'big_bad_wolf');
  if (bigBad?.alive && !wolfSideHasDied(game)) {
    const action = actions[bigBad.id];
    if (action?.type === 'big_bad_kill' && action.target) safeAttack(action.target);
  }

  const whiteWolf = game.players.find((p) => p.role === 'white_wolf');
  if (whiteWolf?.alive && game.day % 2 === 0) {
    const action = actions[whiteWolf.id];
    if (action?.type === 'white_wolf_kill' && action.target) {
      const target = getPlayer(game, action.target);
      if (target && target.team === 'werewolf' && target.alive) {
        safeAttack(target.id);
        addImpact(game, whiteWolf.id, 1);
      }
    }
  }

  if (poisonedId) addDeath(poisonedId, 'poison');
  if (healedId && attacked.includes(healedId)) addImpact(game, witch!.id, 1);

  const died = applyDeaths(game, deaths);
  game.nightDeaths = died;

  if (wolfTargetId && died.includes(wolfTargetId)) {
    for (const wolf of game.players.filter((p) => p.alive && p.team === 'werewolf')) {
      if (ROLES[wolf.role].wolfSide) addImpact(game, wolf.id, 1);
    }
  }

  game.nightActions = {};
  game.version += 1;

  if (game.pendingHunterId) {
    game.phase = 'hunter';
    game.phaseEndsAt = at + HUNTER_MS;
    bump(game);
    return;
  }

  game.phase = 'dawn';
  game.phaseEndsAt = at + DAWN_MS;
  checkVictory(game);
  bump(game);
}

export function resolveHunter(game: Game, targetId: string | null, at = Date.now()): void {
  if (game.phase !== 'hunter' || !game.pendingHunterId) return;
  const hunter = getPlayer(game, game.pendingHunterId);
  if (!hunter) return;
  const context = game.hunterContext;
  let shot: GamePlayer | null = null;
  if (targetId) {
    const target = getPlayer(game, targetId);
    if (target && target.alive && target.id !== hunter.id) shot = target;
  }
  const deaths = shot ? applyDeaths(game, [{ id: shot.id, cause: 'hunter' }]) : [];
  if (shot) {
    if (shot.team === 'werewolf') addImpact(game, hunter.id, 2);
    pushEvent(game, 'hunter_shot', {
      hunterId: hunter.id,
      hunterName: hunter.username,
      targetId: shot.id,
      targetName: shot.username,
      role: shot.revealedRole,
    });
  } else {
    pushEvent(game, 'hunter_skipped', { hunterId: hunter.id, hunterName: hunter.username });
  }
  game.hunterUsed = true;
  game.pendingHunterId = null;
  game.hunterContext = null;
  game.version += 1;
  game.nightDeaths = [...new Set([...game.nightDeaths, ...deaths])];

  if (!checkVictory(game)) {
    game.phase = context === 'vote' ? 'vote_result' : 'dawn';
    game.phaseEndsAt = at + (context === 'vote' ? VOTE_RESULT_MS : DAWN_MS);
  }
  bump(game);
}

/** Advances a phase when its timer expires. Night/vote resolution are special-cased. */
export function advancePhase(game: Game, rng: Rng = secureRng, at = Date.now()): void {
  if (game.winner) return;
  switch (game.phase) {
    case 'role_reveal':
      startNight(game, at);
      break;
    case 'night':
      resolveNight(game, rng, at);
      break;
    case 'dawn':
      startDiscussion(game, at);
      break;
    case 'discussion':
      startVoting(game, at);
      break;
    case 'voting':
      resolveVote(game, rng, at);
      break;
    case 'vote_result':
      startNight(game, at);
      break;
    case 'hunter':
      resolveHunter(game, null, at);
      break;
    case 'ended':
      break;
  }
}

export function nightPromptFor(game: Game, player: GamePlayer): NightPrompt | null {
  if (game.phase !== 'night' || !player.alive || !isActorAvailable(game, player)) return null;
  const def = ROLES[player.role];
  const action = def.nightAction;
  if (!action) return null;
  const alive = livingPlayers(game);
  const submitted = Boolean(game.nightActions[player.id]);
  const base = {
    action,
    submitted,
    canSkip: true,
    minTargets: 0,
    maxTargets: 1,
    targetIds: [] as string[],
  };

  switch (action) {
    case 'kill':
      return {
        ...base,
        minTargets: 1,
        targetIds: alive.filter((p) => p.team !== 'werewolf').map((p) => p.id),
        extra: { wolfVotes: wolfPlurality(game).votes },
      };
    case 'protect':
      return {
        ...base,
        minTargets: 1,
        targetIds: alive
          .filter((p) => p.id !== player.id && p.id !== player.lastProtected)
          .map((p) => p.id),
        note: player.lastProtected ? 'cannot_repeat' : undefined,
      };
    case 'investigate':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.id !== player.id).map((p) => p.id) };
    case 'weaken_vote':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.id !== player.id).map((p) => p.id) };
    case 'witch': {
      const victim = wolfPlurality(game).targetId;
      return {
        ...base,
        targetIds: alive.map((p) => p.id),
        extra: {
          healAvailable: (player.uses.heal ?? 0) > 0,
          poisonAvailable: (player.uses.poison ?? 0) > 0,
          witchVictimId: (player.uses.heal ?? 0) > 0 ? victim : null,
          selfHeal: game.settings.witchSelfHeal,
        },
      };
    }
    case 'lovers':
      return { ...base, minTargets: 2, maxTargets: 2, targetIds: alive.map((p) => p.id) };
    case 'spy':
      return { ...base, targetIds: [] };
    case 'mark':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.id !== player.id).map((p) => p.id) };
    case 'charm':
      return {
        ...base,
        minTargets: 1,
        targetIds: alive.filter((p) => p.id !== player.id && !p.charmed).map((p) => p.id),
      };
    case 'model':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.id !== player.id).map((p) => p.id) };
    case 'infect':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.team !== 'werewolf').map((p) => p.id) };
    case 'big_bad_kill':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.team !== 'werewolf').map((p) => p.id) };
    case 'white_wolf_kill':
      return {
        ...base,
        minTargets: 1,
        targetIds: alive.filter((p) => p.team === 'werewolf' && p.id !== player.id).map((p) => p.id),
      };
    case 'curse':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.id !== player.id).map((p) => p.id) };
    case 'contract':
      return { ...base, minTargets: 1, targetIds: alive.filter((p) => p.id !== player.id).map((p) => p.id) };
    default:
      return null;
  }
}

export function buildView(game: Game, viewerId: string | null, serverNow = Date.now()): GameView {
  const self = viewerId ? getPlayer(game, viewerId) ?? null : null;
  const isWolfViewer = Boolean(self && self.team === 'werewolf');
  const ended = game.phase === 'ended';
  const living = livingPlayers(game);

  const players: PublicPlayerView[] = game.players.map((p) => {
    const isSelf = p.id === self?.id;
    const isLoverView = Boolean(self && self.isLover && p.id === self.loverId);
    return {
      id: p.id,
      username: p.username,
      avatar: p.avatar,
      seat: p.seat,
      alive: p.alive,
      revealedRole: p.revealedRole ?? (ended ? p.role : null),
      isLover: Boolean(p.isLover && (isSelf || isLoverView)),
      isSelf,
      connected: true,
      isBot: p.isBot,
      deathDay: p.deathDay,
    };
  });

  let prompt: NightPrompt | null = null;
  if (self && game.phase === 'night') prompt = nightPromptFor(game, self);
  if (self && game.phase === 'hunter' && game.pendingHunterId === self.id) {
    prompt = {
      action: 'hunter_shot',
      submitted: false,
      canSkip: true,
      minTargets: 1,
      maxTargets: 1,
      targetIds: living.filter((p) => p.id !== self.id).map((p) => p.id),
    };
  }

  const seerHistory = self
    ? game.events
        .filter((e) => e.type === 'seer_result' && e.visibility === 'private' && e.userId === self.id)
        .map((e) => ({
          targetId: String(e.data.targetId),
          targetName: String(e.data.targetName),
          isWolf: Boolean(e.data.isWolf),
          day: Number(e.data.day ?? e.day),
        }))
    : [];

  const wolfVotes = isWolfViewer && game.phase === 'night' ? wolfPlurality(game).votes : null;

  const visibleEvents = game.events.filter((e) => {
    if (e.visibility === 'public') return true;
    if (e.visibility === 'werewolf') return isWolfViewer;
    return Boolean(self && e.userId === self.id);
  });

  const myVote = self ? game.votes[self.id] ?? null : null;
  // Individual tallies stay hidden while the vote is live: only the number of
  // players who already voted is public until the result is revealed.
  const voteRevealed = game.phase === 'vote_result' || game.phase === 'ended';
  const counts = voteRevealed && game.voteResult ? game.voteResult.counts : {};
  const voters = game.players.filter((p) => p.alive && p.canVote);

  return {
    id: game.id,
    day: game.day,
    phase: game.phase,
    phaseEndsAt: game.phaseEndsAt,
    serverNow,
    mode: game.mode,
    settings: {
      revealRoleOnDeath: game.settings.revealRoleOnDeath,
      allowVoteChange: game.settings.allowVoteChange,
      tieRule: game.settings.tieRule,
      loversWin: game.settings.loversWin,
      allowSpectators: game.settings.allowSpectators,
    },
    players,
    self: self
      ? {
          id: self.id,
          role: self.role,
          team: self.team,
          alive: self.alive,
          isLover: self.isLover,
          loverId: self.loverId,
          charmed: self.charmed,
          infected: self.infected,
          canVote: self.canVote,
          uses: { ...self.uses },
          contractTarget: self.role === 'assassin' ? self.contractTarget : null,
          modelId: self.role === 'wild_child' ? self.modelId : null,
        }
      : null,
    wolfTeammates: isWolfViewer && self
      ? game.players
          .filter((p) => p.id !== self.id && p.team === 'werewolf')
          .map((p) => ({ id: p.id, username: p.username, role: p.role, alive: p.alive }))
      : [],
    prompt,
    night: {
      deaths: game.nightDeaths
        .map((id) => getPlayer(game, id))
        .filter((p): p is GamePlayer => Boolean(p))
        .map((p) => ({ id: p.id, name: p.username, role: p.revealedRole })),
      wolfTargetId: (isWolfViewer || (self?.role === 'witch' && self.alive)) ? game.wolfTargetId : null,
      wolfVotes,
      seerHistory,
      witchVictimId:
        self?.role === 'witch' && self.alive && (self.uses.heal ?? 0) > 0
          ? wolfPlurality(game).targetId
          : null,
    },
    vote: {
      hasVoted: Boolean(myVote),
      ownVote: myVote,
      counts,
      voterCount: voters.length,
      votedCount: voters.filter((p) => game.votes[p.id]).length,
      markedId: self?.role === 'raven' || game.phase === 'ended' ? game.ravenTarget : null,
      weakenedId: self?.role === 'owl' && self.alive ? game.owlTargetId : null,
      result: voteRevealed ? game.voteResult : null,
    },
    events: visibleEvents.slice(-80),
    winner: game.winner,
    mvpId: game.mvpId,
  };
}

export function revealAllRoles(game: Game): { id: string; role: RoleId; team: Team }[] {
  return game.players.map((p) => ({ id: p.id, role: p.role, team: p.team }));
}

export function playerSummary(game: Game): {
  id: string;
  username: string;
  role: RoleId;
  team: Team;
  alive: boolean;
  isBot: boolean;
  won: boolean;
  isMvp: boolean;
}[] {
  return game.players.map((p) => ({
    id: p.id,
    username: p.username,
    role: p.role,
    team: p.team,
    alive: p.alive,
    isBot: p.isBot,
    won: Boolean(game.winner?.playerIds.includes(p.id)),
    isMvp: game.mvpId === p.id,
  }));
}

/** Exposed for unit tests: deterministic role dealing. */
export function assignRolesForTest(roleCounts: Record<RoleId, number>, rng: Rng): RoleId[] {
  const deck: RoleId[] = [];
  for (const [role, count] of Object.entries(roleCounts) as [RoleId, number][]) {
    for (let i = 0; i < count; i++) deck.push(role);
  }
  return shuffle(deck, rng);
}
