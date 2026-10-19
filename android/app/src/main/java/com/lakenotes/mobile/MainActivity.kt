package com.lakenotes.mobile

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.Window
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    companion object {
        /** 与 src/styles/tokens.css 的 --b3-theme-background 同值（浅色 / 深色）；
         *  WebView 不延伸到状态栏/导航栏之下，栏后露出的是 window 背景色。 */
        private val BAR_COLOR_LIGHT = 0xFFFFFFFF.toInt()
        private val BAR_COLOR_DARK = 0xFF1E2126.toInt()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(OpenFilePlugin::class.java)
        registerPlugin(PinShortcutPlugin::class.java)
        registerPlugin(SharedContentPlugin::class.java)
        registerPlugin(AssetSyncPlugin::class.java)
        registerPlugin(BodyStorePlugin::class.java)
        registerPlugin(SecureStorePlugin::class.java)
        // 主动弹软键盘：WebView 程序化 focus 不弹键盘（深链冷启动没有用户手势），见 ShowKeyboardPlugin 头注释
        registerPlugin(ShowKeyboardPlugin::class.java)
        super.onCreate(savedInstanceState)
        // 本地资产 HTTP 服务：canonical URL http://127.0.0.1:19876/{noteId}/{file} 本机可达，
        // Lake 原生渲染图片/附件，替代移动端 blob 注入方案（与桌面端资源服务器语义一致）。
        val assetToken = AssetServer.start(this)
        val bridge = getBridge()
        if (assetToken != null && bridge != null && bridge.webView != null) {
            bridge.webView.addJavascriptInterface(AssetTokenInterface(assetToken), "lakeAssetToken")
            // 系统栏跟随 App 主题：渲染层 applyTheme 时通过 lakeSystemBars.setDark(...) 告知。
            // （styles.xml 只写死了 windowLightStatusBar=true，深色下会留一条近白 #FAFAFA 的硬边。）
            bridge.webView.addJavascriptInterface(SystemBarsInterface(this), "lakeSystemBars")
        }
    }

    /**
     * 深浅主题下的系统栏：API 35+ 忽略 setStatusBarColor/setNavigationBarColor（强制 edge-to-edge），
     * 因此以 window 背景为准（栏是透明的，露出背景），再单独设置图标明暗。
     */
    fun applySystemBarTheme(dark: Boolean) {
        val color = if (dark) BAR_COLOR_DARK else BAR_COLOR_LIGHT
        val window = getWindow()
        window.getDecorView().setBackgroundColor(color)
        if (Build.VERSION.SDK_INT < 35) {
            window.setStatusBarColor(color)
            window.setNavigationBarColor(color)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 关掉系统给导航栏加的对比度蒙层，否则深色下会看到一条灰带
            window.setStatusBarContrastEnforced(false)
            window.setNavigationBarContrastEnforced(false)
        }
        val decor = window.getDecorView()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val controller = window.getInsetsController()
            if (controller != null) {
                val lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                controller.setSystemBarsAppearance(if (dark) 0 else lightBars, lightBars)
            }
        } else {
            var flags = decor.getSystemUiVisibility()
            flags = if (dark) {
                flags and (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR).inv()
            } else {
                flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            }
            decor.setSystemUiVisibility(flags)
        }
    }

    /** 仅暴露给本应用 WebView：让状态栏/导航栏跟随 App 主题（Capacitor 默认不接管系统栏）。 */
    private class SystemBarsInterface(private val activity: MainActivity) {
        @JavascriptInterface
        fun setDark(dark: Boolean) {
            activity.runOnUiThread { activity.applySystemBarTheme(dark) }
        }
    }

    /** 仅暴露给本应用 WebView；其他 App 无法读取该接口或伪造带 token 的请求。 */
    private class AssetTokenInterface(private val token: String) {
        @JavascriptInterface
        fun getToken(): String = token
    }
}
