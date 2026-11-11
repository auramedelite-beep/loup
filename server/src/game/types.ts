export type Team = 'village' | 'werewolf' | 'independent';

export type RoleId =
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter'
  | 'savior'
  | 'lion'
  | 'owl'
  | 'cupid'
  | 'bodyguard'
  | 'little_girl'
  | 'elder'
  | 'idiot'
  | 'raven'
  | 'werewolf'
  | 'big_bad_wolf'
  | 'white_wolf'
  | 'wolf_father'
  | 'black_wolf'
  | 'assassin'
  | 'piper'
  | 'angel'
  | 'wild_child';

export type NightActionType =
  | 'kill'
  | 'protect'
  | 'witch'
  | 'investigate'
  | 'weaken_vote'
  | 'lovers'
  | 'spy'
  | 'mark'
  | 'charm'
  | 'model'
  | 'infect'
  | 'big_bad_kill'
  | 'white_wolf_kill'
  | 'curse'
  | 'contract'
  | 'hunter_shot';

export type Phase =
  | 'role_reveal'
  | 'night'
  | 'dawn'
  | 'discussion'
  | 'voting'
  | 'vote_result'
  | 'hunter'
  | 'ended';

export type GameMode = 'classic' | 'ranked' | 'custom' | 'quick' | 'friends' | 'practice';

export interface RoleDef {
  id: RoleId;
  /** Raw team. Wild child starts independent and may become a werewolf. */
  team: Team;
  /** Deterministic night resolution priority (lower resolves first). */
  priority: number;
  /** Night action the role can perform, if any. */
  nightAction?: NightActionType;
  firstNightOnly?: boolean;
  /** Does the role count as a werewolf for victory / parity? */
  wolfSide: boolean;
  /** English display name (server-side admin + logs). UI is translated client-side. */
  name: string;
}

export interface GameSettings {
  mode: GameMode;
  minPlayers: number;
  maxPlayers: number;
  nightSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  revealRoleOnDeath: boolean;
  allowVoteChange: boolean;
  tieRule: 'no_elimination' | 'random';
  loversWin: boolean;
  witchSelfHeal: boolean;
  allowSpectators: boolean;
  voiceChat: boolean;
  language?: 'ar';
  roleCounts: Partial<Record<RoleId, number>>;
}

export interface GamePlayer {
  id: string;
  username: string;
  avatar: string;
  seat: number;
  role: RoleId;
  team: Team;
  alive: boolean;
  revealedRole: RoleId | null;
  isBot: boolean;
  roleHidden: boolean;
  isLover: boolean;
  loverId: string | null;
  charmed: boolean;
  infected: boolean;
  canVote: boolean;
  extraLife: boolean;
  modelId: string | null;
  contractTarget: string | null;
  /** Remaining limited uses, e.g. heal / poison / infect / curse. */
  uses: Record<string, number>;
  /** Bodyguard's previous protection target (cannot repeat). */
  lastProtected: string | null;
  deathCause: string | null;
  deathDay: number | null;
}

export interface NightAction {
  type: NightActionType;
  target?: string | null;
  targets?: [string, string] | null;
  heal?: string | null;
  poison?: string | null;
}

export interface GameEvent {
  id: number;
  day: number;
  phase: Phase;
  at: number;
  type: string;
  /** public = everyone, werewolf = living/dead wolves, private = one player */
  visibility: 'public' | 'werewolf' | 'private';
  userId?: string;
  data: Record<string, unknown>;
}

export interface GameWinner {
  team: Team | 'lovers';
  playerIds: string[];
  reason:
    | 'village_all_wolves_dead'
    | 'werewolves_parity'
    | 'white_wolf_alone'
    | 'piper_all_charmed'
    | 'assassin_contract'
    | 'angel_lynched'
    | 'lovers_last_two';
}

export interface VoteResult {
  eliminatedId: string | null;
  savedByIdiotId: string | null;
  tie: boolean;
  counts: Record<string, number>;
  day: number;
}

export interface Game {
  id: string;
  roomId: string;
  mode: GameMode;
  settings: GameSettings & { roleCounts: Record<RoleId, number> };
  day: number;
  phase: Phase;
  phaseEndsAt: number;
  createdAt: number;
  startedAt: number;
  endedAt: number | null;
  players: GamePlayer[];
  nightActions: Record<string, NightAction>;
  votes: Record<string, string>;
  voteRound: number;
  voteResult: VoteResult | null;
  nightDeaths: string[];
  wolfTargetId: string | null;
  events: GameEvent[];
  winner: GameWinner | null;
  pendingHunterId: string | null;
  hunterContext: 'night' | 'vote' | null;
  hunterUsed: boolean;
  ravenTarget: string | null;
  owlTargetId: string | null;
  villagePowersLost: boolean;
  initialWolves: number;
  mvpId: string | null;
  impact: Record<string, number>;
  version: number;
  eventSeq: number;
}

export interface PublicPlayerView {
  id: string;
  username: string;
  avatar: string;
  seat: number;
  alive: boolean;
  revealedRole: RoleId | null;
  /** Only populated for the viewer, their lover, or revealed roles. */
  isLover: boolean;
  isSelf: boolean;
  connected: boolean;
  isBot: boolean;
  deathDay: number | null;
}

export interface NightPrompt {
  action: NightActionType;
  submitted: boolean;
  canSkip: boolean;
  minTargets: number;
  maxTargets: number;
  targetIds: string[];
  note?: string;
  extra?: Record<string, unknown>;
}

export interface GameView {
  id: string;
  isController?: boolean;
  day: number;
  phase: Phase;
  phaseEndsAt: number;
  serverNow: number;
  mode: GameMode;
  settings: Pick<
    GameSettings,
    'revealRoleOnDeath' | 'allowVoteChange' | 'tieRule' | 'loversWin' | 'allowSpectators'
  >;
  players: PublicPlayerView[];
  self: {
    id: string;
    role: RoleId;
    team: Team;
    alive: boolean;
    isLover: boolean;
    loverId: string | null;
    charmed: boolean;
    infected: boolean;
    canVote: boolean;
    uses: Record<string, number>;
    contractTarget: string | null;
    modelId: string | null;
  } | null;
  wolfTeammates: { id: string; username: string; role: RoleId; alive: boolean }[];
  prompt: NightPrompt | null;
  night: {
    deaths: { id: string; name: string; role: RoleId | null }[];
    wolfTargetId: string | null;
    wolfVotes: Record<string, string> | null;
    seerHistory: { targetId: string; targetName: string; isWolf: boolean; day: number }[];
    witchVictimId: string | null;
  };
  vote: {
    hasVoted: boolean;
    ownVote: string | null;
    counts: Record<string, number>;
    voterCount: number;
    votedCount: number;
    markedId: string | null;
    weakenedId: string | null;
    result: VoteResult | null;
  };
  events: GameEvent[];
  winner: GameWinner | null;
  mvpId: string | null;
}
