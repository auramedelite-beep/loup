import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const bundledDownloads = [
  resolve('dist/downloads/loup-garou-dz.apk'),
  resolve('android/app/src/main/assets/public/downloads/loup-garou-dz.apk'),
];

for (const bundledDownload of bundledDownloads) {
  if (existsSync(bundledDownload)) {
    try {
      unlinkSync(bundledDownload);
      console.info(`[android] Removed stale nested APK asset: ${bundledDownload}`);
    } catch (error) {
      console.error(`[android] Unable to remove stale nested APK asset: ${bundledDownload}`, error);
      process.exitCode = 1;
    }
  }
}
