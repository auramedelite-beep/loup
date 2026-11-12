package dz.loupgarou.game;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String APK_HOST = "sunny-shortbread-196c32.netlify.app";
    private static final String PREFS = "app_updater";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final ConcurrentHashMap<Long, DownloadTask> TASKS = new ConcurrentHashMap<>();

    private static final class DownloadTask {
        final long id;
        volatile boolean cancelled;
        volatile HttpURLConnection connection;

        DownloadTask(long id) {
            this.id = id;
        }
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        String rawUrl = call.getString("url");
        Uri uri = rawUrl == null ? null : Uri.parse(rawUrl);
        if (uri == null
            || !"https".equals(uri.getScheme())
            || !APK_HOST.equals(uri.getHost())
            || uri.getPath() == null
            || !uri.getPath().endsWith(".apk")) {
            call.reject("Invalid update download URL");
            return;
        }

        long id = System.currentTimeMillis();
        DownloadTask task = new DownloadTask(id);
        TASKS.put(id, task);
        saveState(id, "pending", 0, 0, 0);
        EXECUTOR.execute(() -> download(task, rawUrl));

        JSObject result = new JSObject();
        result.put("downloadId", id);
        call.resolve(result);
    }

    private void download(DownloadTask task, String rawUrl) {
        Context context = getContext().getApplicationContext();
        File directory = new File(context.getFilesDir(), "updates");
        File partial = new File(directory, "loup-garou-update.apk.part");
        File apk = new File(directory, "loup-garou-update.apk");
        HttpURLConnection connection = null;

        try {
            if (!directory.exists() && !directory.mkdirs()) {
                throw new IllegalStateException("Unable to create update directory");
            }
            if (partial.exists() && !partial.delete()) {
                throw new IllegalStateException("Unable to clear incomplete update");
            }
            saveState(task.id, "running", 0, 0, 0);

            connection = (HttpURLConnection) new URL(rawUrl).openConnection();
            task.connection = connection;
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            connection.setRequestProperty("User-Agent", "LOUP-GAROU-DZ-Android-Updater");
            connection.setInstanceFollowRedirects(true);

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                throw new IllegalStateException("Update server returned HTTP " + responseCode);
            }
            long totalBytes = connection.getContentLengthLong();
            long downloadedBytes = 0;
            long lastPersistedBytes = 0;
            long lastPersistedAt = System.currentTimeMillis();
            byte[] buffer = new byte[64 * 1024];

            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(partial)) {
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (task.cancelled) return;
                    output.write(buffer, 0, count);
                    downloadedBytes += count;
                    long now = System.currentTimeMillis();
                    if (downloadedBytes - lastPersistedBytes >= 256 * 1024 || now - lastPersistedAt >= 500) {
                        saveState(task.id, "running", downloadedBytes, totalBytes, 0);
                        lastPersistedBytes = downloadedBytes;
                        lastPersistedAt = now;
                    }
                }
                output.getFD().sync();
            }

            if (task.cancelled) return;
            if (downloadedBytes < 1_000_000) {
                throw new IllegalStateException("Downloaded update is unexpectedly small");
            }
            if (totalBytes > 0 && downloadedBytes != totalBytes) {
                throw new IllegalStateException("Downloaded update is incomplete");
            }
            try (InputStream input = new FileInputStream(partial)) {
                if (input.read() != 'P' || input.read() != 'K') {
                    throw new IllegalStateException("Downloaded file is not an APK archive");
                }
            }
            if (apk.exists() && !apk.delete()) {
                throw new IllegalStateException("Unable to replace previous update");
            }
            if (!partial.renameTo(apk)) {
                throw new IllegalStateException("Unable to finalize update download");
            }
            saveState(task.id, "successful", downloadedBytes, totalBytes, 0);
        } catch (Exception error) {
            if (!task.cancelled) {
                android.util.Log.e("AppUpdater", "Update download failed", error);
                saveState(task.id, "failed", 0, 0, 1);
                if (partial.exists()) partial.delete();
            }
        } finally {
            if (connection != null) connection.disconnect();
            task.connection = null;
            TASKS.remove(task.id);
        }
    }

    @PluginMethod
    public void getDownloadState(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        if (id < 0) {
            call.reject("Invalid download ID");
            return;
        }

        Context context = getContext();
        android.content.SharedPreferences prefs = preferences();
        if (prefs.getLong("download_id", -1L) == id) {
            String status = prefs.getString("status", "pending");
            if ("running".equals(status) && !TASKS.containsKey(id)) {
                saveState(id, "failed", prefs.getLong("downloaded", 0), prefs.getLong("total", 0), 1);
                status = "failed";
            }
            long downloaded = prefs.getLong("downloaded", 0);
            long total = prefs.getLong("total", 0);
            resolveState(call, status, downloaded, total, prefs.getInt("reason", 0));
            return;
        }

        getLegacyDownloadState(call, id, context);
    }

    private void getLegacyDownloadState(PluginCall call, long id, Context context) {
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            resolveState(call, "failed", 0, 0, 1);
            return;
        }
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) {
                resolveState(call, "failed", 0, 0, 1);
                return;
            }

            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            String state;
            switch (status) {
                case DownloadManager.STATUS_PENDING:
                    state = "pending";
                    break;
                case DownloadManager.STATUS_RUNNING:
                    state = "running";
                    break;
                case DownloadManager.STATUS_PAUSED:
                    state = "paused";
                    break;
                case DownloadManager.STATUS_SUCCESSFUL:
                    state = "successful";
                    break;
                case DownloadManager.STATUS_FAILED:
                    state = "failed";
                    break;
                default:
                    state = "unknown";
                    break;
            }
            resolveState(call, state, downloaded, total, reason);
        } catch (Exception error) {
            android.util.Log.w("AppUpdater", "Unable to query legacy Android download", error);
            resolveState(call, "failed", 0, 0, 1);
        }
    }

    private void resolveState(PluginCall call, String status, long downloaded, long total, int reason) {
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("reason", reason);
        result.put("downloadedBytes", downloaded);
        result.put("totalBytes", total);
        result.put("progress", total > 0 ? Math.min(100, (int) ((downloaded * 100) / total)) : 0);
        call.resolve(result);
    }

    private android.content.SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void saveState(long id, String status, long downloaded, long total, int reason) {
        preferences().edit()
            .putLong("download_id", id)
            .putString("status", status)
            .putLong("downloaded", downloaded)
            .putLong("total", total)
            .putInt("reason", reason)
            .apply();
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        if (id < 0) {
            call.reject("Invalid download ID");
            return;
        }

        DownloadTask task = TASKS.remove(id);
        if (task != null) {
            task.cancelled = true;
            if (task.connection != null) task.connection.disconnect();
            saveState(id, "failed", 0, 0, 1);
            new File(getContext().getFilesDir(), "updates/loup-garou-update.apk.part").delete();
            call.resolve();
            return;
        }

        if (preferences().getLong("download_id", -1L) == id) {
            new File(getContext().getFilesDir(), "updates/loup-garou-update.apk.part").delete();
            saveState(id, "failed", 0, 0, 1);
            call.resolve();
            return;
        }
        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager != null) manager.remove(id);
            call.resolve();
        } catch (Exception error) {
            android.util.Log.w("AppUpdater", "Unable to cancel legacy Android download", error);
            call.resolve();
        }
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        if (id < 0) {
            call.reject("Invalid download ID");
            return;
        }

        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent permissionIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                permissionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(permissionIntent);
                JSObject result = new JSObject();
                result.put("permissionRequired", true);
                call.resolve(result);
                return;
            }

            Uri apkUri;
            if (preferences().getLong("download_id", -1L) == id
                && "successful".equals(preferences().getString("status", ""))) {
                File apk = new File(getContext().getFilesDir(), "updates/loup-garou-update.apk");
                if (!apk.isFile()) {
                    call.reject("Downloaded update APK is unavailable");
                    return;
                }
                apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apk
                );
            } else {
                DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                apkUri = manager == null ? null : manager.getUriForDownloadedFile(id);
                if (apkUri == null) {
                    call.reject("Downloaded update APK is unavailable");
                    return;
                }
            }

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(installIntent);
            JSObject result = new JSObject();
            result.put("permissionRequired", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open Android installer", error);
        }
    }
}
