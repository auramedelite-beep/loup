import { useCallback, useEffect, useState } from 'react';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Download, X } from 'lucide-react';

const UPDATE_MANIFEST_URL = 'https://sunny-shortbread-196c32.netlify.app/app-update.json';
const UPDATE_HOST = new URL(UPDATE_MANIFEST_URL).host;

interface AppUpdate {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
}

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

export function AppUpdatePrompt() {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [downloadError, setDownloadError] = useState(false);

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
      setUpdate(candidate.versionCode > installedVersionCode ? candidate : null);
    } catch (error) {
      console.error('[app-update] Failed to check for updates', error);
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
      .catch((error: unknown) => console.error('[app-update] Failed to register app-state listener', error));

    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (removeAppStateListener) {
        void removeAppStateListener().catch((error: unknown) =>
          console.error('[app-update] Failed to remove app-state listener', error),
        );
      }
    };
  }, [checkForUpdate]);

  if (!update) return null;

  const openDownload = async () => {
    setDownloadError(false);
    try {
      await Browser.open({ url: update.downloadUrl });
    } catch (error) {
      console.error('[app-update] Failed to open APK download', error);
      setDownloadError(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        className="card w-full max-w-md p-5 shadow-card sm:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500/10 text-gold-300">
            <Download size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="app-update-title" className="text-lg font-bold text-parchment-100">
              يتوفر تحديث جديد
            </h2>
            <p className="mt-1 text-sm text-mist">الإصدار {update.versionName} جاهز للتثبيت.</p>
          </div>
          <button
            type="button"
            className="btn-icon -mt-1 -me-1"
            aria-label="لاحقًا"
            onClick={() => setUpdate(null)}
          >
            <X size={17} />
          </button>
        </div>
        <p className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 text-xs leading-relaxed text-mist">
          سيُفتح تنزيل التطبيق. بعد اكتماله، اضغط على ملف APK ووافق على التحديث. لن تحتاج إلى حذف التطبيق، وستبقى
          بياناتك محفوظة. قد يطلب Android السماح بالتثبيت من المتصفح.
        </p>
        {downloadError && (
          <p className="mt-3 text-xs text-blood-300" role="alert">
            تعذر فتح رابط التحديث. تحقق من اتصال الإنترنت وحاول مجددًا.
          </p>
        )}
        <button
          type="button"
          className="btn-primary mt-5 w-full"
          onClick={() => void openDownload()}
        >
          <Download size={16} />
          تحديث التطبيق
        </button>
      </section>
    </div>
  );
}
