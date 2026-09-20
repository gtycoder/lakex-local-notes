package com.lakenotes.mobile;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** 与 src/styles/tokens.css 的 --b3-theme-background 同值（浅色 / 深色）；
     *  WebView 不延伸到状态栏/导航栏之下，栏后露出的是 window 背景色。 */
    private static final int BAR_COLOR_LIGHT = 0xFFFFFFFF;
    private static final int BAR_COLOR_DARK = 0xFF1E2126;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpenFilePlugin.class);
        registerPlugin(PinShortcutPlugin.class);
        super.onCreate(savedInstanceState);
        // 本地资产 HTTP 服务：canonical URL http://127.0.0.1:19876/{noteId}/{file} 本机可达，
        // Lake 原生渲染图片/附件，替代移动端 blob 注入方案（与桌面端资源服务器语义一致）。
        String assetToken = AssetServer.start(this);
        if (assetToken != null && getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new AssetTokenInterface(assetToken), "lakeAssetToken");
            // 系统栏跟随 App 主题：渲染层 applyTheme 时通过 lakeSystemBars.setDark(...) 告知。
            // （styles.xml 只写死了 windowLightStatusBar=true，深色下会留一条近白 #FAFAFA 的硬边。）
            getBridge().getWebView().addJavascriptInterface(new SystemBarsInterface(this), "lakeSystemBars");
        }
    }

    /**
     * 深浅主题下的系统栏：API 35+ 忽略 setStatusBarColor/setNavigationBarColor（强制 edge-to-edge），
     * 因此以 window 背景为准（栏是透明的，露出背景），再单独设置图标明暗。
     */
    void applySystemBarTheme(final boolean dark) {
        final int color = dark ? BAR_COLOR_DARK : BAR_COLOR_LIGHT;
        final Window window = getWindow();
        window.getDecorView().setBackgroundColor(color);
        if (Build.VERSION.SDK_INT < 35) {
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 关掉系统给导航栏加的对比度蒙层，否则深色下会看到一条灰带
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        final View decor = window.getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            final android.view.WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                final int lightBars = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : lightBars, lightBars);
            }
        } else {
            int flags = decor.getSystemUiVisibility();
            if (dark) {
                flags &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            } else {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
    }

    /** 仅暴露给本应用 WebView：让状态栏/导航栏跟随 App 主题（Capacitor 默认不接管系统栏）。 */
    private static final class SystemBarsInterface {
        private final MainActivity activity;

        SystemBarsInterface(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void setDark(final boolean dark) {
            activity.runOnUiThread(() -> activity.applySystemBarTheme(dark));
        }
    }

    /** 仅暴露给本应用 WebView；其他 App 无法读取该接口或伪造带 token 的请求。 */
    private static final class AssetTokenInterface {
        private final String token;

        AssetTokenInterface(String token) {
            this.token = token;
        }

        @JavascriptInterface
        public String getToken() {
            return token;
        }
    }
}
