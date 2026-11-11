import { motion } from 'framer-motion';
import { PawPrint } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-ink-950">
      <PageHeader
        eyebrow={t('common.appName')}
        title={t('notFound.title')}
        subtitle={t('notFound.subtitle')}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center space-y-6"
      >
        <PawPrint className="mx-auto h-20 w-20 opacity-20" strokeWidth={1.2} aria-hidden />
        <h1 className="font-display text-5xl font-bold text-parchment-100">{t('notFound.title')}</h1>
        <p className="text-3xl text-mist">{t('notFound.message')}</p>
        <button className="btn-primary" onClick={() => window.history.back()}>{t('common.back')}</button>
      </motion.div>
    </div>
  );
}