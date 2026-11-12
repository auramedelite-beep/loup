import { registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  LoaderCircle,
  PauseCircle,
  X,
} from 'lucide-react';

const UPDATE_MANIFEST_URL = 'https://sunny-shortbread-196c32.netlify.app/app-update.json';
const UPDATE_HOST = new URL(UPDATE_MANIFEST_URL).host;
const DOWNLOAD_KEY = 'lgdz.updateDownloadId';

interface AppUpdate {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
}

interface DownloadState {
  status: 'pending' | 'running' | 'paused' | 'successful' | 'failed' | 'unknown';
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  reason: number;
}

interface AppUpdaterPlugin {
  startDownload(options: { url: string }): Promise<{ downloadId: number }>;
  getDownloadState(options: { downloadId: number }): Promise<DownloadState>;
  cancelDownload(options: { downloadId: number }): Promise<void>;
  installUpdate(options: { downloadId: number }): Promise<{ permissionRequired: boolean }>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

function isAppUpdate(value: unknown): value is AppUpdate {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(update.versionCode) ||
    (update.versionCode as number) < 1 ||
    typeof update.versionName !== 'string' ||
    typeof update.downloadUrl !== 'string'
  ) {
    return false;
  }
  try {
    const url = new URL(update.downloadUrl);
    return url.protocol === 'https:' && url.host === UPDATE_HOST && url.pathname.endsWith('.apk');
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readDownloadId(): number | null {
  try {
    const id = Number(localStorage.getItem(DOWNLOAD_KEY));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function storeDownloadId(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(DOWNLOAD_KEY);
    else localStorage.setItem(DOWNLOAD_KEY, String(id));
  } catch (error) {
    console.error('[app-update] Failed to store download state', error);
  }
}

export function AppUpdatePrompt() {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [permissionRequired, setPermissionRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollInFlight = useRef(false);
  const restoreInFlight = useRef(false);
  const pollFailures = useRef(0);

  const checkForUpdate = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const [appInfo, response] = await Promise.all([
        CapacitorApp.getInfo(),
        fetch(`${UPDATE_MANIFEST_URL}?check=${Date.now()}`, { cache: 'no-store' }),
      ]);
      if (!response.ok) throw new Error(`Update manifest request failed (${response.status})`);
      const candidate: unknown = await response.json();
      if (!isAppUpdate(candidate)) throw new Error('Invalid app update manifest');

      const installedVersionCode = Number(appInfo.build);
      if (!Number.isSafeInteger(installedVersionCode)) {
        throw new Error(`Invalid installed Android version code: ${appInfo.build}`);
      }

      if (candidate.versionCode <= installedVersionCode) {
        setUpdate(null);
        storeDownloadId(null);
        setDownloadId(null);
        setDownload(null);
        return;
      }

      setUpdate(candidate);
      const savedId = readDownloadId();
      if (savedId && !restoreInFlight.current) {
        restoreInFlight.current = true;
        try {
          const currentDownload = await AppUpdater.getDownloadState({ downloadId: savedId });
          pollFailures.current = 0;
          setDownloadId(savedId);
          setDownload(currentDownload);
          setError(
            currentDownload.status === 'failed'
              ? 'تعذر تنزيل التحديث. تحقق من اتصال الإنترنت ثم أعد المحاولة.'
              : null,
          );
        } catch (restoreError) {
          console.warn('[app-update] Previous download is no longer available', restoreError);
          storeDownloadId(null);
        } finally {
          restoreInFlight.current = false;
        }
      }
    } catch (checkError) {
      console.error('[app-update] Failed to check for updates', checkError);
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    void checkForUpdate();
    const interval = window.setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000);
    let removeAppStateListener: (() => Promise<void>) | undefined;
    let disposed = false;

    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void checkForUpdate();
    })
      .then((listener) => {
        if (disposed) {
          void listener.remove();
          return;
        }
        removeAppStateListener = () => listener.remove();
      })
      .catch((listenerError: unknown) =>
        console.error('[app-update] Failed to register app-state listener', listenerError),
      );

    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (removeAppStateListener) {
        void removeAppStateListener().catch((listenerError: unknown) =>
          console.error('[app-update] Failed to remove app-state listener', listenerError),
        );
      }
    };
  }, [checkForUpdate]);

  useEffect(() => {
    if (!downloadId || download?.status === 'successful' || download?.status === 'failed') return;
    let disposed = false;
    const poll = async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const next = await AppUpdater.getDownloadState({ downloadId });
        if (!disposed) {
          pollFailures.current = 0;
          setDownload(next);
          setError(
            next.status === 'failed'
              ? 'تعذر تنزيل التحديث. تحقق من اتصال الإنترنت ثم أعد المحاولة.'
              : null,
          );
        }
      } catch (pollError) {
        if (!disposed) {
          console.error('[app-update] Failed to read download progress', pollError);
          pollFailures.current += 1;
          if (pollFailures.current >= 15) {
            setDownload((current) => (current ? { ...current, status: 'failed' } : current));
            setError('تعذر قراءة تقدم التنزيل. أعد المحاولة لبدء التنزيل من جديد.');
          }
        }
      } finally {
        pollInFlight.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [downloadId, download?.status]);

  if (!update) return null;

  const startDownload = async () => {
    setBusy(true);
    pollFailures.current = 0;
    setError(null);
    setPermissionRequired(false);
    try {
      if (downloadId && download?.status === 'failed') {
        await AppUpdater.cancelDownload({ downloadId });
      }
      const result = await AppUpdater.startDownload({ url: update.downloadUrl });
      setDownloadId(result.downloadId);
      storeDownloadId(result.downloadId);
      setDownload({
        status: 'pending',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        reason: 0,
      });
    } catch (downloadError) {
      console.error('[app-update] Failed to start update download', downloadError);
      setError('تعذر بدء التنزيل. تحقق من اتصال الإنترنت وحاول مجددًا.');
    } finally {
      setBusy(false);
    }
  };

  const cancelDownload = async () => {
    if (!downloadId) return;
    setBusy(true);
    pollFailures.current = 0;
    try {
      await AppUpdater.cancelDownload({ downloadId });
      storeDownloadId(null);
      setDownloadId(null);
      setDownload(null);
      setError(null);
    } catch (cancelError) {
      console.error('[app-update] Failed to cancel update download', cancelError);
      setError('تعذر إيقاف التنزيل. حاول مجددًا.');
    } finally {
      setBusy(false);
    }
  };

  const installUpdate = async () => {
    if (!downloadId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await AppUpdater.installUpdate({ downloadId });
      setPermissionRequired(result.permissionRequired);
    } catch (installError) {
      console.error('[app-update] Failed to open Android installer', installError);
      setError('تعذر فتح مثبت Android. حاول مجددًا.');
    } finally {
      setBusy(false);
    }
  };

  const isDownloading = download?.status === 'pending' || download?.status === 'running' || download?.status === 'paused';
  const isComplete = download?.status === 'successful';
  const progress = Math.max(0, Math.min(100, download?.progress ?? 0));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        className="card safe-bottom w-full max-w-md p-4 shadow-card sm:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500/10 text-gold-300">
            {isComplete ? <CheckCircle2 size={21} /> : isDownloading ? <LoaderCircle className="animate-spin" size={21} /> : <Download size={21} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="app-update-title" className="text-lg font-bold text-parchment-100">
              {isComplete
                ? 'اكتمل تنزيل التحديث'
                : download?.status === 'failed'
                  ? 'تعذر تنزيل التحديث'
                  : isDownloading
                    ? 'جارٍ تنزيل التحديث'
                    : 'يتوفر تحديث جديد'}
            </h2>
            <p className="mt-1 text-sm text-mist">الإصدار {update.versionName}</p>
          </div>
          {!isDownloading && (
            <button
              type="button"
              className="btn-icon -mt-1 -me-1"
              aria-label="لاحقًا"
              onClick={() => setUpdate(null)}
            >
              <X size={17} />
            </button>
          )}
        </div>

        {isDownloading ? (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-mist">
              <span>{download?.status === 'paused' ? 'التنزيل متوقف مؤقتًا' : 'يتم التنزيل في الخلفية بأمان'}</span>
              <span dir="ltr" className="shrink-0 tabular-nums">
                {download?.totalBytes
                  ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(download.totalBytes)}`
                  : 'جارٍ الاتصال…'}
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-label="تقدم تنزيل التحديث"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold-300 to-gold-600 transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-end text-xs font-semibold tabular-nums text-gold-300">{progress}%</p>
          </div>
        ) : isComplete ? (
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-sm leading-relaxed text-parchment-200">
            اكتمل التنزيل. اضغط «تثبيت الآن» ثم وافق على تحديث التطبيق في نافذة Android. لن تُحذف بياناتك.
          </div>
        ) : permissionRequired ? (
          <div className="mt-4 rounded-xl border border-gold-500/20 bg-gold-500/[0.06] p-3 text-sm leading-relaxed text-parchment-200">
            اسمح للتطبيق بتثبيت التحديث من إعدادات Android، ثم ارجع واضغط «متابعة التثبيت».
          </div>
        ) : download?.status === 'failed' ? (
          <div
            className="mt-4 rounded-xl border border-blood-500/20 bg-blood-500/[0.06] p-3 text-sm leading-relaxed text-parchment-200"
            role="alert"
          >
            {error ?? 'تعذر إكمال تنزيل التحديث. تحقق من اتصال الإنترنت ثم أعد المحاولة.'}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-mist">
            سننزّل التحديث بأمان في الخلفية، ثم نفتح مثبت Android لتأكيد التثبيت. لن تحتاج إلى حذف التطبيق، وستبقى بياناتك محفوظة.
          </p>
        )}

        {error && download?.status !== 'failed' && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-blood-300" role="alert">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {isDownloading ? (
            <>
              <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void cancelDownload()}>
                <PauseCircle size={16} />
                إيقاف التنزيل
              </button>
              <button type="button" className="btn-primary w-full" disabled>
                <LoaderCircle className="animate-spin" size={16} />
                جارٍ التنزيل
              </button>
            </>
          ) : isComplete ? (
            <button
              type="button"
              className="btn-primary w-full sm:col-span-2"
              disabled={busy}
              onClick={() => void installUpdate()}
            >
              <Download size={16} />
              {busy ? 'جارٍ فتح المثبت…' : permissionRequired ? 'متابعة التثبيت' : 'تثبيت الآن'}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary w-full sm:col-span-2"
              disabled={busy}
              onClick={() => void startDownload()}
            >
              {busy ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}
              {busy ? 'جارٍ بدء التنزيل…' : download?.status === 'failed' ? 'إعادة المحاولة' : 'تنزيل التحديث'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
