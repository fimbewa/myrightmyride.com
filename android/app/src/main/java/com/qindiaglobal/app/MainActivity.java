package com.qindiaglobal.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.content.pm.PackageManager;
import java.util.ArrayList;
import java.util.List;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

/**
 * Qindiaglobal app: shows https://qindiaglobal.com in a full-screen WebView.
 * Pages of qindiaglobal.com stay inside the app; every other link (WhatsApp, Facebook,
 * email, phone, news sites) opens in the matching app or the browser.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://qindiaglobal.com/";
    private static final int FILE_REQUEST = 1001;
    private static final int MEDIA_PERMISSION_REQUEST = 1002;
    private PermissionRequest pendingWebPermission;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private OnBackInvokedCallback backCallback;
    private boolean backRegistered;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);
        keepClearOfSystemBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // Reels autoplay
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " QindiaglobalApp/" + BuildConfigHelper.versionName(this));

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "QIAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> download(url, userAgent, disposition, mime));

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(startUrl(getIntent()));
        }
        setupBack();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && isOurs(data)) web.loadUrl(data.toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    private String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        return (data != null && isOurs(data)) ? data.toString() : HOME;
    }

    static boolean isOurs(Uri uri) {
        String host = uri.getHost();
        return "https".equals(uri.getScheme()) && host != null
                && (host.equals("qindiaglobal.com") || host.equals("www.qindiaglobal.com"));
    }

    /** Android 15+ draws apps edge-to-edge; pad the page so it is not hidden under the status bar. */
    private void keepClearOfSystemBars() {
        if (Build.VERSION.SDK_INT < 30) return;
        web.setOnApplyWindowInsetsListener((View v, WindowInsets insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    // ---- Back button: go back inside the site first, then leave the app ----
    private void setupBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = () -> { if (web.canGoBack()) web.goBack(); };
            updateBack();
        }
    }

    private void updateBack() {
        if (Build.VERSION.SDK_INT < 33 || backCallback == null) return;
        boolean want = web.canGoBack();
        if (want && !backRegistered) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
            backRegistered = true;
        } else if (!want && backRegistered) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
            backRegistered = false;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    // ---- Links ----
    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isOurs(uri)) return false;
            if (!request.isForMainFrame() && !request.hasGesture()) return false; // let ad frames load
            openOutside(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            updateBack();
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            updateBack();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // The Android WebView has no navigator.share; send it to the phone's share sheet instead.
            view.evaluateJavascript(
                "if(!navigator.share&&window.QIAndroid){navigator.share=function(d){d=d||{};" +
                "QIAndroid.share(d.title||'',d.text||'',d.url||location.href);return Promise.resolve();};" +
                "navigator.canShare=function(){return true;};}", null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
        }
    }

    private void openOutside(Uri uri) {
        Intent intent;
        try {
            if ("intent".equals(uri.getScheme())) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            startActivity(intent);
        } catch (ActivityNotFoundException | java.net.URISyntaxException e) {
            Toast.makeText(this, "No app found to open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void share(String title, String text, String url) {
            String body = text == null || text.isEmpty() ? url : (url == null || url.isEmpty() || text.contains(url) ? text : text + "\n" + url);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.putExtra(Intent.EXTRA_TEXT, body);
            runOnUiThread(() -> startActivity(Intent.createChooser(send, "Share")));
        }
    }

    // ---- Photo / file uploads (community posts, profile photos) ----
    private class Chrome extends WebChromeClient {
        /** Camera/microphone for calls and voice notes: only for pages of qindiaglobal.com. */
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handleWebPermission(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingWebPermission == request) pendingWebPermission = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_REQUEST);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    private void handleWebPermission(PermissionRequest request) {
        if (!isOurs(request.getOrigin())) { request.deny(); return; }
        List<String> allowed = new ArrayList<>();
        List<String> needAndroid = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                allowed.add(r);
                if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                    needAndroid.add(android.Manifest.permission.CAMERA);
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                allowed.add(r);
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                    needAndroid.add(android.Manifest.permission.RECORD_AUDIO);
            }
        }
        if (allowed.isEmpty()) { request.deny(); return; }
        if (needAndroid.isEmpty()) { request.grant(allowed.toArray(new String[0])); return; }
        if (pendingWebPermission != null) pendingWebPermission.deny();
        pendingWebPermission = request;
        requestPermissions(needAndroid.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != MEDIA_PERMISSION_REQUEST || pendingWebPermission == null) return;
        PermissionRequest req = pendingWebPermission;
        pendingWebPermission = null;
        List<String> grant = new ArrayList<>();
        for (String r : req.getResources()) {
            String perm = PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) ? android.Manifest.permission.CAMERA
                    : PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) ? android.Manifest.permission.RECORD_AUDIO : null;
            if (perm != null && checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) grant.add(r);
        }
        if (grant.isEmpty()) req.deny(); else req.grant(grant.toArray(new String[0]));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ---- Downloads (posters, Excel list, backups) ----
    private void download(String url, String userAgent, String disposition, String mime) {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme())) {
            Toast.makeText(this, "This download works only in the browser", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, disposition, mime);
            DownloadManager.Request req = new DownloadManager.Request(uri);
            req.setMimeType(mime);
            req.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            req.setTitle(name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
            Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            openOutside(uri);
        }
    }
}
