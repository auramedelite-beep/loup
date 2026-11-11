import type { RoleId, Team } from '@/types';
import {
  AlertCircle,
  Archive,
  Beaker,
  Bird,
  Clock,
  Cloud,
  Crosshair,
  Crown,
  Droplet,
  Eye,
  Flame,
  Footprints,
  Heart,
  Home,
  Moon,
  Music,
  PawPrint,
  Feather,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface RoleMeta {
  icon: LucideIcon;
  team: Team;
  /** Tailwind gradient used on cinematic role cards. */
  gradient: string;
  ring: string;
  text: string;
  wolfSide: boolean;
}

export const ROLE_META: Partial<Record<RoleId, RoleMeta>> = {
  villager: {
    icon: Users,
    team: 'village',
    gradient: 'from-emerald-900/60 via-ink-850 to-ink-950',
    ring: 'border-emerald-400/30',
    text: 'text-emerald-300',
    wolfSide: false,
  },
  seer: {
    icon: Eye,
    team: 'village',
    gradient: 'from-indigo-900/60 via-ink-850 to-ink-950',
    ring: 'border-indigo-400/30',
    text: 'text-indigo-300',
    wolfSide: false,
  },
  witch: {
    icon: Beaker,
    team: 'village',
    gradient: 'from-fuchsia-900/50 via-ink-850 to-ink-950',
    ring: 'border-fuchsia-400/30',
    text: 'text-fuchsia-300',
    wolfSide: false,
  },
  hunter: {
    icon: Crosshair,
    team: 'village',
    gradient: 'from-amber-900/50 via-ink-850 to-ink-950',
    ring: 'border-amber-400/30',
    text: 'text-amber-300',
    wolfSide: false,
  },
  savior: {
    icon: Shield,
    team: 'village',
    gradient: 'from-sky-900/50 via-ink-850 to-ink-950',
    ring: 'border-sky-400/30',
    text: 'text-sky-300',
    wolfSide: false,
  },
  lion: {
    icon: PawPrint,
    team: 'village',
    gradient: 'from-orange-900/50 via-ink-850 to-ink-950',
    ring: 'border-orange-400/30',
    text: 'text-orange-300',
    wolfSide: false,
  },
  owl: {
    icon: Eye,
    team: 'village',
    gradient: 'from-indigo-900/50 via-ink-850 to-ink-950',
    ring: 'border-indigo-400/30',
    text: 'text-indigo-300',
    wolfSide: false,
  },
  raven: {
    icon: Bird,
    team: 'village',
    gradient: 'from-slate-800/70 via-ink-850 to-ink-950',
    ring: 'border-slate-300/30',
    text: 'text-slate-300',
    wolfSide: false,
  },
  werewolf: {
    icon: PawPrint,
    team: 'werewolf',
    gradient: 'from-blood-900/70 via-ink-850 to-ink-950',
    ring: 'border-blood-400/40',
    text: 'text-blood-400',
    wolfSide: true,
  },
};

export const ROLE_IDS: RoleId[] = [
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

export const TEAM_META: Record<Team | 'lovers', { icon: LucideIcon; color: string; badge: string }> = {
  village: { icon: Home, color: 'text-emerald-300', badge: 'badge border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  werewolf: { icon: PawPrint, color: 'text-blood-400', badge: 'badge border-blood-500/30 bg-blood-900/40 text-blood-400' },
  independent: { icon: Sparkles, color: 'text-purple-300', badge: 'badge border-purple-500/30 bg-purple-500/10 text-purple-300' },
  lovers: { icon: Heart, color: 'text-rose-300', badge: 'badge border-rose-500/30 bg-rose-500/10 text-rose-300' },
};

export const PHASE_ORDER = [
  'role_reveal',
  'night',
  'dawn',
  'discussion',
  'voting',
  'vote_result',
  'hunter',
  'ended',
] as const;

export const ICONS = Object.values(ROLE_META).map((meta) => meta.icon);

export function roleIcon(role: string | null | undefined): LucideIcon {
  if (!role) return AlertCircle;
  return ROLE_META[role as RoleId]?.icon ?? AlertCircle;
}

export function roleMeta(role: string | null | undefined): RoleMeta {
  return (
    ROLE_META[role as RoleId] ?? {
      icon: AlertCircle,
      team: 'village',
      gradient: 'from-ink-800 via-ink-850 to-ink-950',
      ring: 'border-white/10',
      text: 'text-parchment-200',
      wolfSide: false,
    }
  );
}

export const AVATAR_ICONS = ['wolf', 'moon', 'owl', 'raven', 'skull', 'candle', 'rose', 'dagger', 'crown', 'fog'] as const;

const AVATAR_ICON_MAP: Record<string, LucideIcon> = {
  wolf: PawPrint,
  moon: Moon,
  owl: Eye,
  raven: Bird,
  skull: Skull,
  candle: Flame,
  rose: Heart,
  dagger: Swords,
  crown: Crown,
  fog: Cloud,
  bat: Bird,
  coffin: Archive,
  '🐺': PawPrint,
  '🌙': Moon,
  '🦉': Eye,
  '🐦‍⬛': Bird,
  '💀': Skull,
  '🕯️': Flame,
  '🌹': Heart,
  '🗡️': Swords,
  '👑': Crown,
  '🌫️': Cloud,
  '🦇': Bird,
  '⚰️': Archive,
};

export function avatarIcon(avatar: string | null | undefined): LucideIcon {
  return avatar ? AVATAR_ICON_MAP[avatar] ?? PawPrint : PawPrint;
}
