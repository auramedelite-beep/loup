package dz.loupgarou.game;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String APK_HOST = "sunny-shortbread-196c32.netlify.app";

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

        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(uri)
                .setTitle("LOUP-GAROU DZ")
                .setDescription("جارٍ تنزيل تحديث التطبيق")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(
                    getContext(),
                    Environment.DIRECTORY_DOWNLOADS,
                    "loup-garou-update.apk"
                );
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                request.setAllowedOverMetered(true);
                request.setAllowedOverRoaming(false);
            }

            long id = manager.enqueue(request);
            JSObject result = new JSObject();
            result.put("downloadId", id);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to start update download", error);
        }
    }

    @PluginMethod
    public void getDownloadState(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        if (id < 0) {
            call.reject("Invalid download ID");
            return;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                call.reject("Update download was not found");
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

            JSObject result = new JSObject();
            result.put("status", state);
            result.put("reason", reason);
            result.put("downloadedBytes", downloaded);
            result.put("totalBytes", total);
            result.put("progress", total > 0 ? Math.min(100, (int) ((downloaded * 100) / total)) : 0);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read update download status", error);
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        if (id < 0) {
            call.reject("Invalid download ID");
            return;
        }
        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            manager.remove(id);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to cancel update download", error);
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
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

            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            Uri apkUri = manager.getUriForDownloadedFile(id);
            if (apkUri == null) {
                call.reject("Downloaded update APK is unavailable");
                return;
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
