import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Beaker, Check, Crosshair, Eye, EyeOff, KeyRound, Mail, Moon, PawPrint, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Field, Spinner } from '@/components/ui';
import { API_BASE, api, errorCode } from '@/lib/api';

export type AuthMode = 'login' | 'forgot' | 'reset';

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/rooms';
  return value;
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = safeNext(params.get('next'));
  const resetToken = params.get('token') ?? '';
  const googleError = params.get('google_error');

  const copy = useMemo(() => {
    switch (mode) {
      case 'forgot':
        return { title: t('auth.forgotTitle'), subtitle: t('auth.forgotSubtitle') };
      case 'reset':
        return { title: t('auth.resetTitle'), subtitle: t('auth.resetSubtitle') };
      default:
        return { title: t('auth.loginTitle'), subtitle: t('auth.loginSubtitle') };
    }
  }, [mode, t]);

  const translateError = (code: string) =>
    t(`errors.${code}`, { defaultValue: t('errors.unknown_error') });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    setBusy(true);
    try {
      if (mode === 'login') {
        await login(identifier.trim(), password);
        navigate(next, { replace: true });
      } else if (mode === 'forgot') {
        const result = await api<{ ok: boolean; resetToken?: string; mailerConfigured?: boolean }>(
          '/api/auth/forgot-password',
          { method: 'POST', auth: false, body: { email: email.trim() } },
        );
        setNotice(t('auth.resetSent'));
        if (result.resetToken) setDevToken(result.resetToken);
      } else {
        await api('/api/auth/reset-password', {
          method: 'POST',
          auth: false,
          body: { token: resetToken, password },
        });
        setNotice(t('auth.resetDone'));
      }
    } catch (err) {
      setError(translateError(errorCode(err)));
    } finally {
      setBusy(false);
    }
  };

  const heading = mode === 'login'
    ? t('auth.login')
    : mode === 'forgot'
      ? t('auth.sendReset')
      : t('auth.resetPassword');

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-center">
      {/* Cinematic panel */}
      <div className="relative hidden overflow-hidden rounded-[2rem] border border-gold-500/15 bg-ink-900/60 p-8 shadow-card lg:block">
        <div className="absolute inset-0 bg-radial-blood opacity-80" aria-hidden />
        <div className="absolute -end-10 -top-10 opacity-20" aria-hidden>
          <Moon size={160} strokeWidth={0.8} />
        </div>
        <div className="relative">
          <p className="eyebrow mb-3">{t('home.eyebrow')}</p>
          <h2 className="font-display text-3xl font-bold leading-tight text-parchment-100">
            {t('home.heroTitle')}
            <span className="mt-1 block text-gold-300">{t('home.heroTitleAccent')}</span>
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-parchment-300">{t('home.heroSubtitle')}</p>
          <ul className="mt-6 space-y-2.5 text-sm text-parchment-200">
            {[t('home.featureRolesText'), t('home.featureRealtimeText'), t('home.featureVoiceText')].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check size={15} className="mt-0.5 shrink-0 text-emerald-300" />
                <span className="leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7 flex items-center gap-3 text-gold-300">
            <PawPrint size={26} aria-hidden />
            <Eye size={26} aria-hidden />
            <Beaker size={26} aria-hidden />
            <Crosshair size={26} aria-hidden />
          </div>
        </div>
      </div>

      {/* Form */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="card p-6 sm:p-8"
      >
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold leading-tight text-parchment-100">{copy.title}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-mist">{copy.subtitle}</p>
          </div>
        </div>

        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200">
            <Check size={16} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {devToken && (
          <div className="mb-4 rounded-xl border border-gold-500/25 bg-gold-500/[0.07] p-3 text-xs">
            <p className="mb-1.5 font-semibold text-gold-300">{t('auth.devResetToken')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1.5 text-[11px] text-parchment-200">
                {devToken}
              </code>
              <Link
                to={`/auth/reset?token=${encodeURIComponent(devToken)}`}
                className="btn-ghost btn-sm shrink-0"
              >
                {t('auth.resetPassword')}
              </Link>
            </div>
          </div>
        )}

        {error && (
          <div
            className="mb-4 flex items-start gap-2 rounded-xl border border-blood-500/35 bg-blood-900/35 px-3 py-2.5 text-sm text-red-200"
            role="alert"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!error && googleError && (
          <div className="mb-4 rounded-xl border border-blood-500/35 bg-blood-900/35 px-3 py-2.5 text-sm text-red-200" role="alert">
            {translateError(googleError)}
          </div>
        )}

        {mode === 'reset' && !resetToken ? (
          <div className="rounded-xl border border-gold-500/20 bg-gold-500/[0.06] p-4 text-sm leading-relaxed text-gold-200">
            {t('errors.invalid_reset_token')}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {mode === 'login' && (
              <>
                <Field label={t('auth.identifier')} htmlFor="identifier">
                  <div className="relative">
                    <UserRound size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-mist" />
                    <input
                      id="identifier"
                      className="input ps-9"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder={t('auth.identifierPlaceholder')}
                      autoComplete="username"
                      required
                    />
                  </div>
                </Field>
                <PasswordField
                  label={t('auth.password')}
                  value={password}
                  onChange={setPassword}
                  show={showPassword}
                  onToggle={() => setShowPassword((value) => !value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  autoComplete="current-password"
                />
              </>
            )}

            {mode === 'forgot' && (
              <Field label={t('auth.email')} htmlFor="email">
                <div className="relative">
                  <Mail size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-mist" />
                  <input
                    id="email"
                    type="email"
                    className="input ps-9"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                    autoComplete="email"
                    required
                  />
                </div>
              </Field>
            )}

            {mode === 'reset' && (
              <PasswordField
                label={t('auth.newPassword')}
                value={password}
                onChange={setPassword}
                show={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                placeholder={t('auth.passwordPlaceholder')}
                autoComplete="new-password"
                hint={t('auth.passwordHint')}
              />
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? (
                <>
                  <Spinner size={16} />
                  {mode === 'login' ? t('auth.loggingIn') : t('common.loading')}
                </>
              ) : (
                <>
                  {heading}
                  <ArrowRight size={16} className="rtl:rotate-180" />
                </>
              )}
            </button>
          </form>
        )}

        {mode === 'login' && (
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <a
              href={`${API_BASE}/api/auth/google?next=${encodeURIComponent(next)}`}
              className="btn-ghost flex w-full items-center justify-center gap-2"
            >
              <span className="font-display text-lg font-bold text-[#4285f4]" aria-hidden>G</span>
              {t('auth.continueWithGoogle')}
            </a>
          </div>
        )}

        <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-4 text-sm">
          {mode === 'login' && (
            <Link to="/auth/forgot" className="link text-xs">
              {t('auth.forgot')}
            </Link>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <p className="text-center text-xs text-mist">
              <Link to="/auth/login" className="link">
                {t('auth.signInInstead')}
              </Link>
            </p>
          )}
        </div>

        {mode === 'login' && (
          <p className="mt-4 flex items-start gap-1.5 text-center text-[11px] leading-relaxed text-mist/70">
            <KeyRound size={12} className="mt-0.5 shrink-0" />
            {t('auth.agree')}
          </p>
        )}
      </motion.div>
    </div>
  );
}

export function GoogleAuthCallbackPage() {
  const { t } = useTranslation();
  const { completeGoogleLogin } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    const next = safeNext(params.get('next'));
    if (!code) {
      navigate('/auth/login?google_error=google_code_invalid', { replace: true });
      return;
    }
    void completeGoogleLogin(code)
      .then(() => navigate(next, { replace: true }))
      .catch((error: unknown) => {
        const code = errorCode(error);
        navigate(`/auth/login?google_error=${encodeURIComponent(code)}`, { replace: true });
      });
  }, [completeGoogleLogin, navigate, params]);

  return <Spinner size={28} className="mx-auto my-16 text-gold-300" aria-label={t('auth.googleSigningIn')} />;
}

function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  autoComplete: string;
  hint?: string;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className="input pe-10"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={8}
          maxLength={128}
          required
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-mist transition-colors hover:text-parchment-200"
          aria-label={show ? 'hide password' : 'show password'}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <span className="sr-only">{t('auth.password')}</span>
      </div>
    </Field>
  );
}
