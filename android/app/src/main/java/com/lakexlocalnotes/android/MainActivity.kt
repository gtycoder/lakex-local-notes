package com.lakexlocalnotes.android

import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.Window
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener

class MainActivity : BridgeActivity() {
    companion object {
        /** 与 src/styles/tokens.css 的 --b3-theme-background 同值（浅色 / 深色）；
         *  WebView 不延伸到状态栏/导航栏之下，栏后露出的是 window 背景色。 */
        private val BAR_COLOR_LIGHT = 0xFFFFFFFF.toInt()
        private val BAR_COLOR_DARK = 0xFF1E2126.toInt()
        /** 首屏看门狗：30s 内渲染层没报到就 reload 一次（WebView 卡死/白屏兜底）。 */
        private const val BOOT_WATCHDOG_MS = 30_000L
    }

    private val bootWatchdog = Handler(Looper.getMainLooper())
    private var bootReady = false
    private var bootWatchdogFired = false

    /** 系统栏/刘海的安全区（CSS px），由 WebView 的 WindowInsets 换算后交给渲染层。 */
    private var insetTopCss = 0f
    private var insetBottomCss = 0f

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(OpenFilePlugin::class.java)
        registerPlugin(PinShortcutPlugin::class.java)
        registerPlugin(SharedContentPlugin::class.java)
        registerPlugin(AssetSyncPlugin::class.java)
        registerPlugin(BodyStorePlugin::class.java)
        registerPlugin(StylusInputPlugin::class.java)
        registerPlugin(SecureStorePlugin::class.java)
        // 主动弹软键盘：WebView 程序化 focus 不弹键盘（深链冷启动没有用户手势），见 ShowKeyboardPlugin 头注释
        registerPlugin(ShowKeyboardPlugin::class.java)
        // AI 原生通道（261023 P0）：Key 只在原生，流式 SSE
        registerPlugin(AiChatPlugin::class.java)
        super.onCreate(savedInstanceState)
        // 261027：无论 Activity 最终落到哪个 theme（启动页 → NoActionBar），都保证内容可延伸到刘海区域；
        // 具体安全区由上面的 WindowInsets 注入交给 CSS，不依赖 theme 属性是否随启动页主题切换而丢失。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        // 本地资产 HTTP 服务：canonical URL http://127.0.0.1:19876/{noteId}/{file} 本机可达，
        // Lake 原生渲染图片/附件，替代移动端 blob 注入方案（与桌面端资源服务器语义一致）。
        val assetToken = AssetServer.start(this)
        val bridge = getBridge()
        // 261022：冷启动首帧 hint —— 本次 intent 的 data URL 同步可读，
        // React 首帧前就能判定「长按图标新建小记」，不再先画首页骨架再整树切换。
        // 不依赖 AssetServer（它失败时也要能判定），只要有 WebView 就注入。
        bridge?.webView?.let { webView ->
            webView.addJavascriptInterface(LaunchUrlInterface(intent?.data?.toString()), "lakeLaunchUrl")
        }
        if (assetToken != null && bridge != null && bridge.webView != null) {
            bridge.webView.addJavascriptInterface(AssetTokenInterface(assetToken), "lakeAssetToken")
            // 系统栏跟随 App 主题：渲染层 applyTheme 时通过 lakeSystemBars.setDark(...) 告知。
            // （styles.xml 只写死了 windowLightStatusBar=true，深色下会留一条近白 #FAFAFA 的硬边。）
            bridge.webView.addJavascriptInterface(SystemBarsInterface(this), "lakeSystemBars")
        }
        // 261027：把真实系统栏/刘海 inset 交给 Web UI —— 不能只信 env(safe-area-inset-*)：
        // Android WebView 在部分 ROM/edge-to-edge（targetSdk 36 / Android 15+ 强制）下返回 0，
        // 顶栏就会压到状态栏/刘海下面。这里按 WindowInsets 取 systemBars ∪ displayCutout，
        // 换成 CSS px 注入 --mobile-native-top-safe / -bottom，由 tokens.css 与 env 取 max。
        bridge?.webView?.let { webView ->
            webView.addJavascriptInterface(InsetsInterface(this), "lakeInsets")
            ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
                val density = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                insetTopCss = bars.top / density
                insetBottomCss = bars.bottom / density
                view.post {
                    webView.evaluateJavascript(
                        "window.__lakeSetNativeInsets&&window.__lakeSetNativeInsets($insetTopCss,$insetBottomCss)",
                        null,
                    )
                }
                insets
            }
            webView.requestApplyInsets()
        }
        bridge?.webView?.let { webView ->
            // 261027：锁定 WebView 文本缩放/强制深色 —— 我们的主题与字号由自有设置驱动，
            // 再叠一层系统缩放/反色会双重放大、深色下发灰。字号缩放的无障碍取舍见 docs/HANDOFF。
            webView.settings.textZoom = 100
            if (Build.VERSION.SDK_INT >= 33) {
                webView.settings.setAlgorithmicDarkeningAllowed(false)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                @Suppress("DEPRECATION")
                webView.settings.forceDark = WebSettings.FORCE_DARK_OFF
            }
            // 设备形态（平板 / 折叠屏展开）：交给 Web 切布局（body.lake-tablet）。
            webView.addJavascriptInterface(DeviceInterface(this), "lakeDevice")
            // 首屏看门狗：JS 启动后调 lakeBoot.ready()；超时未报到则 reload 一次。
            webView.addJavascriptInterface(BootInterface(this), "lakeBoot")
            bootWatchdog.postDelayed({
                if (!bootReady && !bootWatchdogFired) {
                    bootWatchdogFired = true
                    webView.reload()
                }
            }, BOOT_WATCHDOG_MS)
        }
        // 渲染进程崩溃：Capacitor 桥持有 WebView 引用，不能只换 WebView（会断桥）；
        // 走 recreate() 重建 Activity/Bridge，Web 侧按持久化状态恢复标签。
        bridge?.addWebViewListener(object : WebViewListener() {
            override fun onRenderProcessGone(webView: WebView, detail: RenderProcessGoneDetail): Boolean {
                runOnUiThread { recreate() }
                return true
            }
        })
    }

    /** 平板/折叠屏展开：smallestScreenWidthDp >= 600（与思源同口径）。 */
    private fun isTabletLayout(): Boolean = resources.configuration.smallestScreenWidthDp >= 600

    /** 把设备形态推给 Web（启动后的配置变化：折叠展开/旋转）。 */
    private fun pushDeviceProfile() {
        val tablet = isTabletLayout()
        getBridge()?.webView?.post {
            getBridge()?.webView?.evaluateJavascript("window.__lakeSetTablet&&window.__lakeSetTablet($tablet)", null)
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        pushDeviceProfile()
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

    /** 仅暴露给本应用 WebView：首屏就绪报到（看门狗用）。 */
    private class BootInterface(private val activity: MainActivity) {
        @JavascriptInterface
        fun ready() {
            activity.bootReady = true
            activity.bootWatchdog.removeCallbacksAndMessages(null)
        }
    }

    /** 仅暴露给本应用 WebView：设备形态（平板/折叠屏展开）。 */
    private class DeviceInterface(private val activity: MainActivity) {
        @JavascriptInterface
        fun isTablet(): Boolean = activity.isTabletLayout()
    }

    /** 仅暴露给本应用 WebView：系统栏/刘海安全区（CSS px；-1 表示尚未测量）。 */
    private class InsetsInterface(private val activity: MainActivity) {
        @JavascriptInterface
        fun getTop(): Float = activity.insetTopCss

        @JavascriptInterface
        fun getBottom(): Float = activity.insetBottomCss
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

    /** 仅本应用 WebView 可读的冷启动 URL（非敏感）：用于首帧决定进 capture 还是首页。 */
    private class LaunchUrlInterface(private val url: String?) {
        @JavascriptInterface
        fun getUrl(): String = url ?: ""
    }
}