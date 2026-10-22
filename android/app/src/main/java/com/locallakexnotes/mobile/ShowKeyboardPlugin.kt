package com.locallakexnotes.mobile

import android.content.Context
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 主动弹软键盘（Android 原生 InputMethodManager）。
 *
 * 为什么需要：**WebView 里程序化 focus 不会弹软键盘** —— Android 只允许「用户手势」触发软键盘，
 * 而长按桌面图标走深链（locallakexnotes://quick-note）进来时**没有手势** ⇒ 「小记」写作卡虽然拿到了焦点
 * （内核 focus 命令），键盘却不弹（261013 AVD 实测：innerHeight 842→842；页面路点按钮进的有手势，842→530）。
 * 思源没这问题是因为它的闪念速记是**原生 EditText**（requestFocus + showSoftInput）；这里给 WebView 补上同一步。
 *
 * 调用时机由 JS 决定（写作卡就绪且已自动聚焦之后，见 src/mobile/home/QuickNoteComposer.tsx）。
 * 失败一律 reject 给 JS，由 JS 静默吞掉 —— 键盘没弹不该阻断输入（用户手点一下照样能用）。
 */
@CapacitorPlugin(name = "ShowKeyboard")
class ShowKeyboardPlugin : Plugin() {
    @PluginMethod
    fun show(call: PluginCall) {
        val activity = getActivity()
        if (activity == null) {
            call.reject("no activity")
            return
        }
        activity.runOnUiThread {
            try {
                val view = activity.currentFocus ?: activity.window.decorView
                view.requestFocus()
                val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
                imm?.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
                call.resolve()
            } catch (e: Exception) {
                call.reject("showSoftInput failed: " + e.message)
            }
        }
    }
}
