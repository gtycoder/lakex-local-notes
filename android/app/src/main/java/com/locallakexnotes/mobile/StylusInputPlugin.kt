package com.locallakexnotes.mobile

import android.os.Build
import com.getcapacitor.BridgeActivity
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 手写板编辑态临时关闭 WebView 的系统手写接管。
 *
 * Android 13+ 会把触控笔输入交给系统手写输入法；画布需要原始 PointerEvent/笔迹时，
 * 这会把事件从 WebView 抢走。离开手写板后恢复，避免影响普通文本输入框。
 */
@CapacitorPlugin(name = "StylusInput")
class StylusInputPlugin : Plugin() {
    @PluginMethod
    fun setHandwritingEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: true
        val activity = activity
        val bridgeActivity = activity as? BridgeActivity
        val webView = bridgeActivity?.getBridge()?.webView
        if (activity == null || webView == null) {
            call.reject("WebView 尚未就绪")
            return
        }
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                webView.setAutoHandwritingEnabled(enabled)
            }
            call.resolve()
        }
    }
}
