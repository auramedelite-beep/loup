import { useState, useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Field, LoadingBlock, PageHeader, Spinner, Toggle } from '@/components/ui';
import { cn } from '@/lib/format';

export function SettingsPage() {
  const { user, updateUser } = useAuth();
  const { t } = useTranslation();
  const notify = useToast();

  // Read settings from profile service (for now just use auth user locale + reduced motion)
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundVolume, setSoundVolume] = useState(100);

  useEffect(() => {
    // Sync with server
    if (user) {
      const fetchSettings = async () => {
        try {
          const res = await fetch('/api/profile/me', {
            method: 'GET',
            headers: { Authorization: `Bearer ${user.token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.user?.settings) {
              const s = data.user.settings;
              if (s.reducedMotion !== undefined) setReducedMotion(s.reducedMotion);
            }
          }
        } catch { /* keep defaults */ }
      };
      fetchSettings();
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    try {
      await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
          settings: { reducedMotion, soundVolume },
        }),
      });
      notify.success(t('settings.saved'));
    } catch (e) {
      notify.error(t('errors.unknown_error'));
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader
        eyebrow={t('common.appName')}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      <form className="grid gap-6 mt-8" onSubmit={(e) => e.preventDefault()}>

        {/* Reduced motion */}
        <Toggle
          checked={reducedMotion}
          onChange={(v) => setReducedMotion(v)}
          label={t('settings.reducedMotion')}
        />

        {/* Sound volume */}
        <Field label={t('settings.soundVolume')} htmlFor="volume-slider">
          <input
            id="volume-slider"
            type="range"
            min={0}
            max={100}
            value={soundVolume}
            onChange={(e) => setSoundVolume(Number(e.target.value))}
            className="range sliders"
          />
          <span className="text-[11px] text-mist">{t('settings.volumeLevel', { value: soundVolume })}</span>
        </Field>

        {/* Save button */}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={!user}
            onClick={handleSave}
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => window.history.back()}
          >
            {t('common.cancel')}
          </button>
        </div>

      </form>
    </div>
  );
}