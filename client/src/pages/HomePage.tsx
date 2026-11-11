import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  Globe2,
  Moon,
  MessageSquare,
  PawPrint,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, errorCode } from '@/lib/api';
import { currentLanguage } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/contexts/SocketContext';
import { useToast } from '@/contexts/ToastContext';
import { RoleCard } from '@/components/RoleCard';
import { TEAM_META, ROLE_IDS, roleMeta } from '@/lib/roles';
import { formatNumber } from '@/lib/format';
import type { AppStats, RoleId, Team } from '@/types';

const HERO_ROLES: RoleId[] = [...ROLE_IDS];

const GROUPS: { team: Team; roles: RoleId[] }[] = [
  { team: 'village', roles: ROLE_IDS.filter((role) => roleMeta(role).team === 'village') },
  { team: 'werewolf', roles: ROLE_IDS.filter((role) => roleMeta(role).team === 'werewolf') },
];

export function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { room, createRoom, joinQueue, queue } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState<AppStats | null>(null);
  const [busy, setBusy] = useState<'quick' | 'practice' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<AppStats>('/api/public/stats', { auth: false })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const requireAuth = (target: string) => {
    if (user) return true;
    navigate(`/auth/login?next=${encodeURIComponent(target)}`);
    return false;
  };

  const quickPlay = async () => {
    if (!requireAuth('/rooms')) return;
    setBusy('quick');
    try {
      const ack = await joinQueue('quick', currentLanguage());
      if (!ack.ok) {
        toast.error(t(`errors.${ack.error ?? 'unknown_error'}`, { defaultValue: t('errors.unknown_error') }));
        return;
      }
      navigate('/rooms');
    } finally {
      setBusy(null);
    }
  };

  const practice = async () => {
    if (!requireAuth('/rooms')) return;
    setBusy('practice');
    try {
      const ack = await createRoom({ mode: 'practice', isPrivate: false, name: t('home.modePractice') });
      if (!ack.ok) {
        toast.error(t(`errors.${ack.error ?? 'unknown_error'}`, { defaultValue: t('errors.unknown_error') }));
        return;
      }
      navigate(`/room/${String(ack.roomCode)}`);
    } finally {
      setBusy(null);
    }
  };

  const features = [
    { icon: Sparkles, title: t('home.featureRolesTitle'), text: t('home.featureRolesText') },
    { icon: ShieldCheck, title: t('home.featureRealtimeTitle'), text: t('home.featureRealtimeText') },
    { icon: MessageSquare, title: t('home.featureVoiceTitle'), text: t('home.featureVoiceText') },
    { icon: Globe2, title: t('home.featureCrossTitle'), text: t('home.featureCrossText') },
  ];

  const modes = [
    { icon: Swords, key: 'classic', label: t('home.modeClassic'), text: t('home.modeClassicText') },
    { icon: Trophy, key: 'ranked', label: t('home.modeRanked'), text: t('home.modeRankedText') },
    { icon: Users, key: 'custom', label: t('home.modeCustom'), text: t('home.modeCustomText') },
    { icon: Bot, key: 'practice', label: t('home.modePractice'), text: t('home.modePracticeText') },
  ];

  return (
    <div className="space-y-14 sm:space-y-20">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[2rem] border border-gold-500/15 bg-ink-900/50 px-5 py-10 shadow-card sm:px-10 sm:py-16">
        <div className="pointer-events-none absolute inset-0 bg-radial-blood opacity-70" aria-hidden />
        <div className="pointer-events-none absolute -end-16 -top-24 h-72 w-72 rounded-full border border-gold-500/10 sm:h-96 sm:w-96">
          <div className="absolute inset-6 rounded-full border border-gold-500/10" />
          <div className="absolute inset-14 rounded-full bg-gold-500/[0.04] blur-2xl" />
          <div className="absolute inset-0 flex items-center justify-center opacity-30 animate-float-slow">
            <Moon className="h-28 w-28 sm:h-40 sm:w-40" strokeWidth={0.8} />
          </div>
        </div>

        <div className="relative max-w-2xl">
          <p className="eyebrow mb-3">{t('home.eyebrow')}</p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="font-display text-4xl font-bold leading-[1.05] text-parchment-100 sm:text-6xl"
          >
            {t('home.heroTitle')}
            <span className="mt-2 block bg-gradient-to-r from-gold-300 via-gold-400 to-gold-600 bg-clip-text text-transparent">
              {t('home.heroTitleAccent')}
            </span>
          </motion.h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-parchment-300 sm:text-base">
            {t('home.heroSubtitle')}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => void quickPlay()} className="btn-primary btn-lg" disabled={busy !== null}>
              <Zap size={18} />
              {busy === 'quick' ? t('rooms.searching') : t('home.quickPlay')}
            </button>
            <Link to="/rooms" className="btn-ghost btn-lg">
              {t('home.browseRooms')}
              <ArrowRight size={17} className="rtl:rotate-180" />
            </Link>
            <button type="button" onClick={() => void practice()} className="btn-subtle btn-lg" disabled={busy !== null}>
              <Bot size={17} />
              {t('home.practice')}
            </button>
          </div>

          {queue && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold-500/25 bg-gold-500/10 px-3 py-1.5 text-xs text-gold-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400" />
              {t('rooms.searching')} · {queue.players}/{queue.needed}
            </p>
          )}

          {room && (
            <Link
              to={`/room/${room.code}`}
              className="mt-4 flex w-fit items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {t('rooms.backToRoom')} · {room.name} ({room.code})
            </Link>
          )}

          <dl className="mt-9 grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t('home.statPlayers'), value: stats?.players },
              { label: t('home.statMatches'), value: stats?.matches },
              { label: t('home.statRooms'), value: stats?.rooms },
              { label: t('home.statLive'), value: stats?.liveGames },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
                <dd className="font-display text-xl font-bold tabular-nums text-gold-300">
                  {typeof item.value === 'number' ? formatNumber(item.value) : '—'}
                </dd>
                <dt className="mt-0.5 text-[10px] leading-tight text-mist">{item.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="mb-6 text-center">
          <p className="eyebrow mb-2">{t('common.appName')}</p>
          <h2 className="font-display text-2xl font-bold text-parchment-100 sm:text-3xl">{t('home.featuresTitle')}</h2>
          <p className="mt-2 text-sm text-mist">{t('home.featuresSubtitle')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4 }}
              className="card p-5"
            >
              <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gold-500/20 bg-gold-500/10 text-gold-300">
                <feature.icon size={18} />
              </span>
              <h3 className="font-display text-base font-semibold text-parchment-100">{feature.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-mist">{feature.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Modes */}
      <section>
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow mb-2">{t('home.playNow')}</p>
            <h2 className="font-display text-2xl font-bold text-parchment-100 sm:text-3xl">{t('home.ctaTitle')}</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-mist">{t('home.ctaText')}</p>
          </div>
          <Link to="/rooms" className="btn-ghost btn-sm w-fit">
            {t('home.browseRooms')}
            <ArrowRight size={14} className="rtl:rotate-180" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modes.map((mode) => (
            <Link
              key={mode.key}
              to="/rooms"
              className="card group p-5 transition-colors hover:border-gold-500/30"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-gold-300 transition-colors group-hover:border-gold-500/30 group-hover:bg-gold-500/10">
                  <mode.icon size={18} />
                </span>
                <ArrowRight size={15} className="text-mist transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
              </div>
              <h3 className="font-display text-base font-semibold text-parchment-100">{mode.label}</h3>
              <p className="mt-1 text-xs leading-relaxed text-mist">{mode.text}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Hero roles */}
      <section className="rounded-3xl border border-white/[0.06] bg-ink-900/40 p-5 sm:p-8">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow mb-2">{t('common.role')}</p>
            <h2 className="font-display text-2xl font-bold text-parchment-100 sm:text-3xl">{t('home.rolesTitle')}</h2>
            <p className="mt-1.5 text-sm text-mist">{t('home.rolesSubtitle')}</p>
          </div>
          <Link to="/how-to-play" className="btn-ghost btn-sm w-fit">
            {t('nav.howTo')}
            <ArrowRight size={14} className="rtl:rotate-180" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {HERO_ROLES.map((role) => (
            <RoleCard key={role} role={role} variant="tile" />
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {GROUPS.map((group) => {
            const TeamIcon = TEAM_META[group.team].icon;
            return (
              <div key={group.team} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2">
                <span className={`badge ${TEAM_META[group.team].badge}`}>
                  <TeamIcon size={14} strokeWidth={1.8} aria-hidden />
                  {t(`teams.${group.team}`)}
                </span>
                <span className="text-xs tabular-nums text-mist">{group.roles.length}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden rounded-[2rem] border border-gold-500/20 bg-gradient-to-br from-ink-800/90 via-ink-900 to-ink-950 p-8 text-center shadow-card sm:p-12">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gold-line" aria-hidden />
        <PawPrint className="mx-auto mb-3 h-11 w-11 text-blood-400" strokeWidth={1.5} aria-hidden />
        <h2 className="font-display text-2xl font-bold text-parchment-100 sm:text-3xl">{t('home.ctaTitle')}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-mist">{t('home.ctaText')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link to="/rooms" className="btn-primary">
            {t('home.createRoom')}
          </Link>
          <Link to="/rooms?join=1" className="btn-ghost">
            {t('home.joinWithCode')}
          </Link>
        </div>
      </section>
    </div>
  );
}
