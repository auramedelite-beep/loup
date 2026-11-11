import type { GameSettings, RoleDef, RoleId } from './types';

export const ROLES: Record<RoleId, RoleDef> = {
  villager: { id: 'villager', team: 'village', priority: 0, wolfSide: false, name: 'Villager' },
  seer: { id: 'seer', team: 'village', priority: 10, nightAction: 'investigate', wolfSide: false, name: 'Seer' },
  witch: { id: 'witch', team: 'village', priority: 40, nightAction: 'witch', wolfSide: false, name: 'Witch' },
  hunter: { id: 'hunter', team: 'village', priority: 0, wolfSide: false, name: 'Hunter' },
  savior: { id: 'savior', team: 'village', priority: 20, nightAction: 'protect', wolfSide: false, name: 'Savior' },
  lion: { id: 'lion', team: 'village', priority: 0, wolfSide: false, name: 'Lion' },
  owl: { id: 'owl', team: 'village', priority: 55, nightAction: 'weaken_vote', wolfSide: false, name: 'Owl' },
  cupid: { id: 'cupid', team: 'village', priority: 5, nightAction: 'lovers', firstNightOnly: true, wolfSide: false, name: 'Cupid' },
  bodyguard: { id: 'bodyguard', team: 'village', priority: 20, nightAction: 'protect', wolfSide: false, name: 'Bodyguard' },
  little_girl: { id: 'little_girl', team: 'village', priority: 60, nightAction: 'spy', wolfSide: false, name: 'Little Girl' },
  elder: { id: 'elder', team: 'village', priority: 0, wolfSide: false, name: 'Elder' },
  idiot: { id: 'idiot', team: 'village', priority: 0, wolfSide: false, name: 'Village Idiot' },
  raven: { id: 'raven', team: 'village', priority: 50, nightAction: 'mark', wolfSide: false, name: 'Raven' },
  werewolf: { id: 'werewolf', team: 'werewolf', priority: 30, nightAction: 'kill', wolfSide: true, name: 'Werewolf' },
  big_bad_wolf: { id: 'big_bad_wolf', team: 'werewolf', priority: 31, nightAction: 'big_bad_kill', wolfSide: true, name: 'Big Bad Wolf' },
  white_wolf: { id: 'white_wolf', team: 'werewolf', priority: 32, nightAction: 'white_wolf_kill', wolfSide: true, name: 'White Wolf' },
  wolf_father: { id: 'wolf_father', team: 'werewolf', priority: 35, nightAction: 'infect', wolfSide: true, name: 'Wolf Father' },
  black_wolf: { id: 'black_wolf', team: 'werewolf', priority: 33, nightAction: 'curse', wolfSide: true, name: 'Black Wolf' },
  assassin: { id: 'assassin', team: 'independent', priority: 70, nightAction: 'contract', firstNightOnly: true, wolfSide: false, name: 'Assassin' },
  piper: { id: 'piper', team: 'independent', priority: 70, nightAction: 'charm', wolfSide: false, name: 'Piper' },
  angel: { id: 'angel', team: 'independent', priority: 0, wolfSide: false, name: 'Angel' },
  wild_child: { id: 'wild_child', team: 'independent', priority: 8, nightAction: 'model', firstNightOnly: true, wolfSide: false, name: 'Wild Child' },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
export const PLAYABLE_ROLE_IDS: RoleId[] = [
  'villager',
  'seer',
  'werewolf',
  'witch',
  'hunter',
  'lion',
  'savior',
  'raven',
  'owl',
];

export const BASE_SETTINGS: Omit<GameSettings, 'roleCounts' | 'mode'> = {
  minPlayers: 6,
  maxPlayers: 18,
  nightSeconds: 40,
  discussionSeconds: 120,
  votingSeconds: 45,
  revealRoleOnDeath: true,
  allowVoteChange: true,
  tieRule: 'no_elimination',
  loversWin: true,
  witchSelfHeal: true,
  allowSpectators: true,
  voiceChat: false,
};

/**
 * Builds a sensible Classic distribution for a player count.
 * Special roles are introduced gradually — never all at once.
 */
export function defaultRoleCounts(playerCount: number): Record<RoleId, number> {
  const counts = emptyRoleCounts();
  const n = Math.max(6, Math.min(18, playerCount));
  const wolves = n <= 7 ? 1 : n <= 10 ? 2 : n <= 13 ? 3 : 4;
  counts.werewolf = wolves;

  if (n >= 6) counts.seer = 1;
  if (n >= 6) counts.witch = 1;
  if (n >= 7) counts.hunter = 1;
  if (n >= 8) counts.savior = 1;
  if (n >= 9) counts.raven = 1;
  if (n >= 10) counts.lion = 1;
  if (n >= 11) counts.owl = 1;

  let used = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, n - used);
  counts.villager = remaining;
  used += remaining;
  // Extremely defensive: if over-allocated, trim villagers (never negative).
  if (used > n) counts.villager = Math.max(0, counts.villager - (used - n));
  return counts;
}

export function emptyRoleCounts(): Record<RoleId, number> {
  const counts = {} as Record<RoleId, number>;
  for (const id of ROLE_IDS) counts[id] = 0;
  return counts;
}

export function normalizeRoleCounts(
  requested: Partial<Record<RoleId, number>> | undefined | null,
  playerCount: number,
): Record<RoleId, number> {
  if (!requested || Object.keys(requested).length === 0) return defaultRoleCounts(playerCount);
  const counts = emptyRoleCounts();
  for (const id of PLAYABLE_ROLE_IDS) {
    const raw = requested[id];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      const maxCopies = id === 'villager' || id === 'werewolf' ? playerCount : 1;
      counts[id] = Math.min(maxCopies, Math.floor(raw));
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return defaultRoleCounts(playerCount);
  // Fill any missing slots with villagers; trim excess from villagers first.
  if (total < playerCount) {
    counts.villager += playerCount - total;
  } else if (total > playerCount) {
    let excess = total - playerCount;
    const trimOrder: RoleId[] = ['villager', 'owl', 'lion', 'raven', 'savior'];
    for (const id of trimOrder) {
      while (excess > 0 && counts[id] > 0 && !(id === 'werewolf')) {
        counts[id]--;
        excess--;
      }
      if (excess === 0) break;
    }
    // Never remove the last wolf.
    if (excess > 0 && counts.werewolf > 1) {
      const trim = Math.min(excess, counts.werewolf - 1);
      counts.werewolf -= trim;
      excess -= trim;
    }
    if (excess > 0) counts.villager = Math.max(0, counts.villager - excess);
  }
  if (counts.werewolf < 1) {
    counts.werewolf = 1;
    if (counts.villager > 0) counts.villager--;
  }
  const finalTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  if (finalTotal !== playerCount) {
    // Last-resort normalization to guarantee a valid game.
    return defaultRoleCounts(playerCount);
  }
  return counts;
}

export function teamOf(role: RoleId): 'village' | 'werewolf' | 'independent' {
  return ROLES[role].team;
}

export function isWolfRole(role: RoleId): boolean {
  return ROLES[role].wolfSide;
}
