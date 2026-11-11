import { useEffect, useState } from 'react';
import { Bell, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { Avatar } from '@/components/Avatar';
import { Field, PageHeader, Toggle } from '@/components/ui';
import { useToast } from '@/contexts/ToastContext';
import { api, errorCode } from '@/lib/api';
import type { PublicUser } from '@/types';

const AVATARS = ['wolf', 'moon', 'owl', 'raven', 'skull', 'candle', 'rose', 'dagger', 'crown', 'fog'];

export function SettingsPage() {
  const { user, updateUser } = useAuth();
  const { settings, update, requestNotifications } = useSettings();
  const { t } = useTranslation();
  const notify = useToast();
  const [username, setUsername] = useState(user?.username ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? 'wolf');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUsername(user?.username ?? '');
    setAvatar(user?.avatar ?? 'wolf');
  }, [user?.id, user?.username, user?.avatar]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const result = await api<{ user: PublicUser }>('/api/profile/me', {
        method: 'PATCH',
        body: {
          username: username.trim(),
          avatar,
          settings,
          locale: 'ar',
          publicProfile: settings.privacy,
        },
      });
      updateUser(result.user);
      notify.success(t('settings.saved'));
    } catch (error) {
      notify.error(t(`errors.${errorCode(error)}`, { defaultValue: t('errors.unknown_error') }));
    } finally {
      setSaving(false);
    }
  };

  const enableNotifications = async () => {
    try {
      const granted = await requestNotifications();
      notify.info(t(granted ? 'notifications.permissionGranted' : 'notifications.permissionDenied'));
    } catch (error) {
      console.error('[settings] Failed to enable notifications', error);
      notify.error(t('notifications.permissionError'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 px-1 sm:px-2">
      <PageHeader
        eyebrow={t('common.appName')}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      <div className="grid gap-4 sm:gap-6">
        <section className="panel min-w-0">
          <h2 className="section-title mb-4">{t('profile.edit')}</h2>
          <div className="grid gap-5">
            <Field label={t('profile.username')} htmlFor="profile-username">
              <input
                id="profile-username"
                className="input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={20}
                disabled={user?.isGuest}
                autoComplete="nickname"
              />
              {user?.isGuest && <p className="mt-1 text-xs text-mist">{t('profile.usernameNote')}</p>}
            </Field>

            <div>
              <p className="label">{t('profile.avatar')}</p>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAvatar(option)}
                    className={`rounded-2xl border p-1.5 transition-colors ${
                      avatar === option
                        ? 'border-gold-400 bg-gold-500/10'
                        : 'border-white/10 hover:border-gold-500/40'
                    }`}
                    aria-label={`${t('profile.avatar')}: ${option}`}
                    aria-pressed={avatar === option}
                  >
                    <Avatar avatar={option} size="sm" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="panel min-w-0">
          <h2 className="section-title mb-4">
            <Volume2 size={18} />
            {t('settings.audio')}
          </h2>
          <div className="grid gap-5">
            <label className="grid gap-2 text-sm text-parchment-200">
              <span>{t('settings.music')}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(settings.music * 100)}
                onChange={(event) => update({ music: Number(event.target.value) / 100 })}
                aria-label={t('settings.music')}
              />
              <span className="text-xs text-mist">{t('settings.volumeLevel', { value: Math.round(settings.music * 100) })}</span>
            </label>
            <label className="grid gap-2 text-sm text-parchment-200">
              <span>{t('settings.sound')}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(settings.sound * 100)}
                onChange={(event) => update({ sound: Number(event.target.value) / 100 })}
                aria-label={t('settings.sound')}
              />
              <span className="text-xs text-mist">{t('settings.volumeLevel', { value: Math.round(settings.sound * 100) })}</span>
            </label>
            <SettingToggle
              label={t('settings.turnMusicOn')}
              checked={settings.musicEnabled}
              onChange={(musicEnabled) => update({ musicEnabled })}
            />
          </div>
        </section>

        <section className="panel min-w-0">
          <h2 className="section-title mb-4">{t('settings.gameplay')}</h2>
          <div className="grid gap-4">
            <SettingToggle
              label={t('settings.animations')}
              checked={settings.animations}
              onChange={(animations) => update({ animations })}
            />
            <SettingToggle
              label={t('settings.reducedMotion')}
              checked={settings.reducedMotion}
              onChange={(reducedMotion) => update({ reducedMotion })}
            />
          </div>
        </section>

        <section className="panel min-w-0">
          <h2 className="section-title mb-4">
            <Bell size={18} />
            {t('settings.notifications')}
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-mist">{t('settings.notificationsHint')}</p>
          <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => void enableNotifications()}>
            <Bell size={16} />
            {settings.notifications ? t('notifications.permissionGranted') : t('notifications.enable')}
          </button>
        </section>

        <section className="panel min-w-0">
          <h2 className="section-title mb-4">{t('settings.privacy')}</h2>
          <SettingToggle
            label={t('settings.publicProfile')}
            checked={settings.privacy}
            onChange={(privacy) => update({ privacy })}
          />
          <p className="mt-2 text-xs leading-relaxed text-mist">{t('settings.publicProfileHint')}</p>
        </section>

        <div className="flex flex-col-reverse gap-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-ghost w-full sm:w-auto"
            onClick={() => window.history.back()}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={saving || !username.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? t('common.loading') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4">
      <span className="text-sm leading-relaxed text-parchment-200">{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
