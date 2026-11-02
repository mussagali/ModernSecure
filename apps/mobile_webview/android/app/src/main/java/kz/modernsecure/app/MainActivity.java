package kz.modernsecure.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private WebView web;
    private ScrollView errorPanel;
    private TextView errorText;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private JavaScriptReplyProxy permissionReply;
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private String lastPage = BuildConfig.SITE_URL + "/login";
    private static final int FILE_PICK = 30, PUSH_PERMISSION = 31;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(getColor(R.color.app_canvas));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                int left = insets.getSystemWindowInsetLeft(), top = insets.getSystemWindowInsetTop();
                int right = insets.getSystemWindowInsetRight(), bottom = insets.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                    android.view.DisplayCutout cutout = insets.getDisplayCutout();
                    left = Math.max(left, cutout.getSafeInsetLeft());
                    top = Math.max(top, cutout.getSafeInsetTop());
                    right = Math.max(right, cutout.getSafeInsetRight());
                    bottom = Math.max(bottom, cutout.getSafeInsetBottom());
                }
                v.setPadding(left, top, right, bottom);
            }
            return insets;
        });
        FrameLayout content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.app_canvas));
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        createErrorPanel(content);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(ColorStateList.valueOf(getColor(R.color.app_accent)));
        progress.setProgressBackgroundTintList(ColorStateList.valueOf(getColor(R.color.app_line)));
        progress.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        progress.setVisibility(View.INVISIBLE);
        content.addView(progress, new FrameLayout.LayoutParams(-1, dp(2), Gravity.TOP));
        setContentView(root);
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightNavigationBars(true);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(true); settings.setBuiltInZoomControls(true); settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ModernSecureAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return navigate(request.getUrl(), request.hasGesture());
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!NavigationPolicy.sameOrigin(BuildConfig.SITE_URL, url)) { view.stopLoading(); return; }
                lastPage = url; errorPanel.setVisibility(View.GONE); web.setVisibility(View.VISIBLE);
                if ("/login".equals(Uri.parse(url).getPath())) clearDownloads();
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("Не удалось открыть сайт. Проверьте интернет и повторите попытку.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) showError("Сайт временно недоступен. Попробуйте ещё раз позже.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); showError("Не удалось установить защищённое соединение. Обратитесь в поддержку.");
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value < 100 && errorPanel.getVisibility() != View.VISIBLE ? View.VISIBLE : View.INVISIBLE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!NavigationPolicy.sameOrigin(BuildConfig.SITE_URL, web.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                String[] types = params.getAcceptTypes();
                if (types.length > 0 && types[0].contains("/")) pick.putExtra(Intent.EXTRA_MIME_TYPES, types);
                try { startActivityForResult(pick, FILE_PICK); } catch (Exception e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> download(url));
        setupPushBridge();
        if (state == null || web.restoreState(state) == null) web.loadUrl(lastPage);
        openNotification(getIntent());
    }

    private boolean navigate(Uri uri, boolean userGesture) {
        if (NavigationPolicy.sameOrigin(BuildConfig.SITE_URL, uri.toString())) {
            if (NavigationPolicy.filePath(uri.getPath())) { download(uri.toString()); return true; }
            return false;
        }
        String scheme = uri.getScheme();
        if (userGesture && ("https".equals(scheme) || "tel".equals(scheme) || "mailto".equals(scheme))) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception e) { toast("Не найдено приложение для этой ссылки"); }
        }
        return true;
    }
    private void createErrorPanel(FrameLayout content) {
        errorPanel = new ScrollView(this);
        errorPanel.setFillViewport(true);
        errorPanel.setBackgroundColor(getColor(R.color.app_canvas));
        ViewCompat.setAccessibilityPaneTitle(errorPanel, "Не удалось загрузить страницу");
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        column.setPadding(dp(24), dp(32), dp(24), dp(32));
        errorPanel.addView(column, new ScrollView.LayoutParams(-1, -1));

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_launcher);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        column.addView(mark, new LinearLayout.LayoutParams(dp(40), dp(40)));

        TextView title = new TextView(this);
        title.setText("Не удалось загрузить страницу");
        title.setTextSize(24);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setTextColor(getColor(R.color.app_ink));
        title.setGravity(Gravity.CENTER);
        title.setMaxWidth(dp(360));
        ViewCompat.setAccessibilityHeading(title, true);
        LinearLayout.LayoutParams titleLayout = new LinearLayout.LayoutParams(-2, -2);
        titleLayout.topMargin = dp(20);
        column.addView(title, titleLayout);

        errorText = new TextView(this);
        errorText.setTextSize(16);
        errorText.setTextColor(getColor(R.color.app_muted));
        errorText.setGravity(Gravity.CENTER);
        errorText.setMaxWidth(dp(360));
        errorText.setLineSpacing(dp(4), 1);
        errorText.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        LinearLayout.LayoutParams textLayout = new LinearLayout.LayoutParams(-2, -2);
        textLayout.topMargin = dp(12);
        column.addView(errorText, textLayout);

        Button retry = new Button(this);
        retry.setText("Повторить попытку");
        retry.setTextSize(16);
        retry.setAllCaps(false);
        retry.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        retry.setTextColor(getColor(R.color.app_surface));
        retry.setBackgroundResource(R.drawable.bg_native_retry);
        retry.setPadding(dp(24), dp(12), dp(24), dp(12));
        retry.setMinHeight(dp(48));
        retry.setMinWidth(dp(240));
        retry.setStateListAnimator(null);
        retry.setOnClickListener(v -> web.loadUrl(lastPage));
        LinearLayout.LayoutParams retryLayout = new LinearLayout.LayoutParams(-2, -2);
        retryLayout.topMargin = dp(24);
        column.addView(retry, retryLayout);
        content.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        errorPanel.setVisibility(View.GONE);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void showError(String text) { progress.setVisibility(View.INVISIBLE); web.setVisibility(View.GONE); errorText.setText(text); errorPanel.setVisibility(View.VISIBLE); }
    private void toast(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }

    private void download(String url) {
        if (!NavigationPolicy.sameOrigin(BuildConfig.SITE_URL, url)) { toast("Откройте документ из своего кабинета"); return; }
        String cookie = CookieManager.getInstance().getCookie(url);
        toast("Загружаем документ…");
        downloads.execute(() -> {
            HttpURLConnection connection = null;
            File output = null;
            try {
                connection = (HttpURLConnection)new URL(url).openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(60000);
                if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                if (connection.getResponseCode() == 302) {
                    String location = connection.getHeaderField("Location");
                    Uri signed = Uri.parse(location == null ? "" : location);
                    if (!"https".equals(signed.getScheme()) || signed.getHost() == null || !signed.getHost().endsWith(".supabase.co")
                        || signed.getUserInfo() != null || signed.getPath() == null || !signed.getPath().startsWith("/storage/v1/object/sign/")) throw new Exception("Invalid redirect");
                    connection.disconnect();
                    connection = (HttpURLConnection)new URL(location).openConnection();
                    // The signed URL is the credential. Never forward web cookies.
                    connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(60000);
                }
                if (connection.getResponseCode() != 200) throw new Exception("Unavailable");
                String mime = connection.getContentType();
                if (mime == null || mime.startsWith("text/") || mime.contains("json")) throw new Exception("Invalid document");
                String name = android.webkit.URLUtil.guessFileName(url, connection.getHeaderField("Content-Disposition"), mime);
                name = name.replaceAll("[^\\p{L}\\p{N}._ -]", "_"); if(name.length() > 160) name = name.substring(name.length()-160);
                File directory = new File(getCacheDir(), "downloads"); directory.mkdirs();
                output = new File(directory, UUID.randomUUID() + "-" + name);
                try (var input = connection.getInputStream(); var file = new FileOutputStream(output)) {
                    byte[] buffer = new byte[65536]; int n; long total = 0;
                    while ((n = input.read(buffer)) != -1) { total += n; if (total > 21L * 1024 * 1024) throw new Exception("Too large"); file.write(buffer, 0, n); }
                }
                File completed = output; String type = mime.split(";", 2)[0];
                runOnUiThread(() -> {
                    Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", completed);
                    Intent open = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivity(Intent.createChooser(open, "Открыть документ")); }
                    catch(Exception e) { toast("Установите приложение для просмотра этого типа файла"); }
                });
            } catch(Exception e) { if(output != null) output.delete(); toast("Не удалось скачать документ. Проверьте подключение и доступ к файлу."); }
            finally { if(connection != null) connection.disconnect(); }
        });
    }

    private void setupPushBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web, "ModernSecureNative", Collections.singleton(BuildConfig.SITE_URL), (view, message, origin, mainFrame, reply) -> {
            if (!mainFrame || !NavigationPolicy.sameOrigin(BuildConfig.SITE_URL, origin.toString())) return;
            if ("settings".equals(message.getData())) {
                startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName()));
            } else if ("enable".equals(message.getData())) {
                if (!BuildConfig.PUSH_CONFIGURED) { reply.postMessage("{\"configured\":false}"); return; }
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("asked", true).apply();
                    permissionReply = reply; requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PUSH_PERMISSION);
                } else sendPushToken(reply, true);
            } else if ("status".equals(message.getData())) sendPushToken(reply, false);
            else if ("disable".equals(message.getData())) {
                getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
                if(BuildConfig.PUSH_CONFIGURED) FirebaseMessaging.getInstance().deleteToken();
                reply.postMessage("{\"enabled\":false}");
            }
        });
    }
    private void sendPushToken(JavaScriptReplyProxy reply, boolean enable) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        var prefs = getSharedPreferences("push", MODE_PRIVATE);
        if (BuildConfig.PUSH_CONFIGURED && !NotificationManagerCompat.from(this).areNotificationsEnabled()
            && (enable || prefs.getBoolean("asked", false) || prefs.getBoolean("enabled", false))) { reply.postMessage("{\"configured\":true,\"enabled\":false,\"denied\":true}"); return; }
        if (!BuildConfig.PUSH_CONFIGURED || (!enable && !prefs.getBoolean("enabled", false))) { reply.postMessage("{\"configured\":" + BuildConfig.PUSH_CONFIGURED + ",\"enabled\":false}"); return; }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { reply.postMessage("{\"configured\":true,\"enabled\":false,\"denied\":true}"); return; }
        if (FirebaseApp.getApps(this).isEmpty()) FirebaseApp.initializeApp(this);
        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
            String installation = prefs.getString("installation", UUID.randomUUID().toString());
            String secret = prefs.getString("secret", UUID.randomUUID().toString());
            prefs.edit().putBoolean("enabled", true).putString("installation", installation).putString("secret", secret).apply();
            try { reply.postMessage(new JSONObject().put("configured", true).put("enabled", true).put("token", token).put("installationId", installation).put("secret", secret).put("platform", "android").toString()); }
            catch(Exception ignored) { reply.postMessage("{\"configured\":true,\"error\":true}"); }
        }).addOnFailureListener(e -> reply.postMessage("{\"configured\":true,\"error\":true}"));
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == PUSH_PERMISSION && permissionReply != null) {
            if(results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) sendPushToken(permissionReply, true);
            else if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) permissionReply.postMessage("{\"configured\":true,\"enabled\":false,\"denied\":true}");
            permissionReply = null;
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_PICK && fileCallback != null) { fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null; }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); openNotification(intent); }
    private void openNotification(Intent intent) {
        String id = intent.getStringExtra("notificationId");
        if(id != null && id.matches("[0-9a-fA-F-]{36}")) { web.loadUrl(BuildConfig.SITE_URL + "/notifications/open/" + id); intent.removeExtra("notificationId"); }
    }
    @Override public void onBackPressed() { if(web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onPause() { CookieManager.getInstance().flush(); super.onPause(); }
    private void clearDownloads() {
        File[] files = new File(getCacheDir(), "downloads").listFiles();
        if (files != null) for (File file : files) {
            revokeUriPermission(FileProvider.getUriForFile(this, getPackageName() + ".files", file), Intent.FLAG_GRANT_READ_URI_PERMISSION);
            file.delete();
        }
    }
    @Override protected void onDestroy() {
        if(fileCallback != null) fileCallback.onReceiveValue(null);
        downloads.shutdownNow(); web.destroy(); super.onDestroy();
    }
}
