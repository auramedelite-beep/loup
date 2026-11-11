import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, ShieldCheck, Swords, Target, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { LoadingBlock, PageHeader, StatTile } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { api, errorCode } from '@/lib/api';
import type { PublicUser } from '@/types';

interface ProfileUser extends Pick<PublicUser, 'id' | 'username' | 'avatar'> {
  createdAt?: number;
  isGuest?: boolean;
  private?: boolean;
  profile?: PublicUser['profile'];
}

interface ProfileResponse {
  user: ProfileUser;
}

export function ProfilePage() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const { t } = useTranslation();
  const targetId = id ?? currentUser?.id;
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetId) return;
    let active = true;
    setLoading(true);
    setError(null);
    api<ProfileResponse>(`/api/profile/${encodeURIComponent(targetId)}`)
      .then((result) => {
        if (active) setProfile(result.user);
      })
      .catch((requestError: unknown) => {
        if (active) setError(errorCode(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [targetId]);

  if (loading) return <LoadingBlock label={t('common.loading')} />;

  if (error || !profile) {
    const message = error
      ? t(`errors.${error}`, { defaultValue: t('errors.unknown_error') })
      : t('errors.user_not_found');
    return (
      <div className="card mx-auto max-w-xl p-6 text-center sm:p-8" role="alert">
        <p className="text-sm text-blood-300">{message}</p>
        <Link to="/" className="btn-ghost mt-4">{t('common.back')}</Link>
      </div>
    );
  }

  const ownProfile = profile.id === currentUser?.id;
  const stats = profile.profile;

  return (
    <div className="mx-auto w-full max-w-4xl min-w-0 px-1 sm:px-2">
      <PageHeader
        eyebrow={t('profile.title')}
        title={profile.username}
        subtitle={
          profile.createdAt
            ? t('profile.memberSince', { date: new Date(profile.createdAt).toLocaleDateString('ar') })
            : t('profile.subtitle')
        }
        actions={ownProfile ? <Link to="/settings" className="btn-primary">{t('profile.edit')}</Link> : undefined}
      />

      <section className="panel mb-4 flex min-w-0 flex-col items-center gap-4 text-center sm:mb-6 sm:flex-row sm:text-start">
        <Avatar avatar={profile.avatar} size="2xl" />
        <div className="min-w-0">
          <h2 className="break-words text-xl font-bold text-parchment-100">{profile.username}</h2>
          {profile.isGuest && <p className="mt-1 text-sm text-mist">{t('profile.guestAccount')}</p>}
        </div>
      </section>

      {profile.private ? (
        <div className="card p-6 text-center text-sm text-mist">{t('profile.privateProfile')}</div>
      ) : stats ? (
        <>
          <h2 className="section-title mb-3">{t('profile.stats')}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
            <StatTile icon={<Swords size={17} />} label={t('common.games')} value={stats.gamesPlayed} />
            <StatTile icon={<Trophy size={17} />} label={t('common.wins')} value={stats.wins} accent="emerald" />
            <StatTile icon={<Target size={17} />} label={t('common.winRate')} value={`${stats.winRate}%`} accent="violet" />
            <StatTile icon={<ShieldCheck size={17} />} label={t('common.rating')} value={stats.rating} accent="blood" />
          </div>

          <section className="panel mt-4 grid grid-cols-2 gap-4 sm:mt-6 sm:grid-cols-3">
            <ProfileDetail icon={<CalendarDays size={16} />} label={t('profile.peakRating')} value={stats.peakRating} />
            <ProfileDetail icon={<Swords size={16} />} label={t('profile.villageStats')} value={`${stats.villageWins} / ${stats.villageGames}`} />
            <ProfileDetail icon={<ShieldCheck size={16} />} label={t('profile.wolfStats')} value={`${stats.wolfWins} / ${stats.wolfGames}`} />
          </section>
        </>
      ) : null}
    </div>
  );
}

function ProfileDetail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-gold-300">
        {icon}
        <span className="text-xs text-mist">{label}</span>
      </div>
      <p className="mt-2 break-words text-lg font-bold tabular-nums text-parchment-100">{value}</p>
    </div>
  );
}
