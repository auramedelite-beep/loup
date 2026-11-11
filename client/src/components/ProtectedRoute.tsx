import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingBlock } from './ui';

export function ProtectedRoute({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (loading) {
    return <LoadingBlock label={t('common.loading')} />;
  }

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth/login?next=${next}`} replace />;
  }

  if (admin && !isAdmin) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <p className="mb-2 text-4xl" aria-hidden>
          🔒
        </p>
        <h1 className="font-display text-xl font-semibold text-parchment-100">{t('admin.accessDenied')}</h1>
        <p className="mt-2 text-sm text-mist">{t('errors.forbidden')}</p>
      </div>
    );
  }

  return <>{children}</>;
}
