import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const apk = resolve('app-release/loup-garou-dz.apk');
const destination = resolve('dist/downloads/loup-garou-dz.apk');

try {
  if (statSync(apk).size === 0) throw new Error('APK file is empty.');
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(apk, destination);
} catch (error) {
  console.error(`[deploy] Unable to publish Android APK from ${apk}`, error);
  process.exitCode = 1;
}
