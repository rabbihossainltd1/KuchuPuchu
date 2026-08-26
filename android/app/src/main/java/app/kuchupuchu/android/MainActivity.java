package app.kuchupuchu.android;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioManager;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

public class MainActivity extends BridgeActivity {
    private static final int SHARE_REQ = 91;
    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private Handler mainHandler;
    private long lastFrameAt;

    public class CallAudio {
        @JavascriptInterface
        public void setSpeaker(boolean on) {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am == null) return;
            am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            am.setMode(on ? AudioManager.MODE_NORMAL : AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(on);
        }

        @JavascriptInterface
        public void startRing() {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am == null) return;
            am.setMode(AudioManager.MODE_NORMAL);
            am.setSpeakerphoneOn(true);
        }

        @JavascriptInterface
        public void endAudio() {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am == null) return;
            am.setSpeakerphoneOn(false);
            am.setMode(AudioManager.MODE_NORMAL);
        }

        @JavascriptInterface
        public void startScreen() {
            runOnUiThread(() -> beginScreenShare());
        }

        @JavascriptInterface
        public void stopScreen() {
            runOnUiThread(() -> endScreenShare());
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mainHandler = new Handler(Looper.getMainLooper());
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[] {
                    Manifest.permission.CAMERA,
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.MODIFY_AUDIO_SETTINGS,
                    Manifest.permission.POST_NOTIFICATIONS,
                    Manifest.permission.VIBRATE
                },
                42
            );
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptEnabled(true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setHapticFeedbackEnabled(true);
        webView.addJavascriptInterface(new CallAudio(), "KpCallAudio");
        webView.setWebChromeClient(
            new BridgeWebChromeClient(getBridge()) {
                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    request.grant(request.getResources());
                }
            }
        );
    }

    private void beginScreenShare() {
        MediaProjectionManager manager =
            (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) return;
        startActivityForResult(manager.createScreenCaptureIntent(), SHARE_REQ);
    }

    private void endScreenShare() {
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (projection != null) {
            projection.stop();
            projection = null;
        }
        stopService(new Intent(this, ScreenShareService.class));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SHARE_REQ || resultCode != Activity.RESULT_OK || data == null) return;
        Intent service = new Intent(this, ScreenShareService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
        else startService(service);
        MediaProjectionManager manager =
            (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) return;
        projection = manager.getMediaProjection(resultCode, data);
        if (projection == null) return;
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int width = Math.min(720, metrics.widthPixels);
        int height = Math.min(1280, metrics.heightPixels);
        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        virtualDisplay =
            projection.createVirtualDisplay(
                "kp-share",
                width,
                height,
                metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                mainHandler
            );
        imageReader.setOnImageAvailableListener(
            reader -> {
                Image image = reader.acquireLatestImage();
                if (image == null) return;
                long now = System.currentTimeMillis();
                if (now - lastFrameAt < 160) {
                    image.close();
                    return;
                }
                lastFrameAt = now;
                try {
                    Image.Plane plane = image.getPlanes()[0];
                    ByteBuffer buffer = plane.getBuffer();
                    int pixelStride = plane.getPixelStride();
                    int rowStride = plane.getRowStride();
                    int rowPadding = rowStride - pixelStride * width;
                    Bitmap bitmap =
                        Bitmap.createBitmap(
                            width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888);
                    bitmap.copyPixelsFromBuffer(buffer);
                    Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    cropped.compress(Bitmap.CompressFormat.JPEG, 55, out);
                    String payload = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge()
                            .getWebView()
                            .evaluateJavascript(
                                "window.KpOnScreenFrame&&window.KpOnScreenFrame('data:image/jpeg;base64,"
                                    + payload
                                    + "')",
                                null);
                    }
                    if (cropped != bitmap) cropped.recycle();
                    bitmap.recycle();
                } catch (Exception ignored) {
                    /* drop frame */
                } finally {
                    image.close();
                }
            },
            mainHandler
        );
    }

    @Override
    public void onDestroy() {
        endScreenShare();
        super.onDestroy();
    }
}
