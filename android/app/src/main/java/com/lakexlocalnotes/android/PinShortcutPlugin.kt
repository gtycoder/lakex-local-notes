package com.lakexlocalnotes.android

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 「小记」桌面快捷方式（对齐思源 siyuan-android 的机型兼容做法）。
 *
 * 背景：Android 的**静态** App Shortcut（res/xml/shortcuts.xml）在原生与多数 ROM 上长按图标即可见，
 * 但部分机型/launcher 不展示或用户找不到入口。思源的兜底是在「小记」界面放一个「添加到桌面」按钮，
 * 调 `ShortcutManager.requestPinShortcut` 让系统**直接固定一个快捷方式**到桌面（并检测是否已固定）。
 * 本插件提供同一套能力的三个方法：
 *   - isAvailable：`isRequestPinShortcutSupported()`（机型/launcher 是否支持固定）
 *   - isPinned：该快捷方式是否已在桌面（已固定则 UI 隐藏入口）
 *   - requestPin：发起固定（系统会弹确认框）
 *
 * 固定的快捷方式用**深链**（`lakexlocalnotes://quick-note`），与静态快捷方式落到同一条 JS 处理路径
 * （src/mobile/native/quickNoteShortcut.ts）。
 */
@CapacitorPlugin(name = "PinShortcut")
class PinShortcutPlugin : Plugin() {
    private fun shortcutManager(): ShortcutManager? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        return getContext().getSystemService(Context.SHORTCUT_SERVICE) as? ShortcutManager
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val manager = shortcutManager()
        val supported = manager != null && manager.isRequestPinShortcutSupported
        val result = JSObject()
        result.put("available", supported)
        call.resolve(result)
    }

    @PluginMethod
    fun isPinned(call: PluginCall) {
        val manager = shortcutManager()
        var pinned = false
        if (manager != null) {
            for (info in manager.pinnedShortcuts) {
                if (SHORTCUT_ID == info.id) {
                    pinned = true
                    break
                }
            }
        }
        val result = JSObject()
        result.put("pinned", pinned)
        call.resolve(result)
    }

    @PluginMethod
    fun requestPin(call: PluginCall) {
        val manager = shortcutManager()
        val result = JSObject()
        if (manager == null || !manager.isRequestPinShortcutSupported) {
            result.put("requested", false)
            result.put("reason", "unsupported")
            call.resolve(result)
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK), getContext(), MainActivity::class.java)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val info = ShortcutInfo.Builder(getContext(), SHORTCUT_ID)
                .setShortLabel(getContext().getString(R.string.shortcut_quick_note_short))
                .setLongLabel(getContext().getString(R.string.shortcut_quick_note_long))
                .setIcon(Icon.createWithResource(getContext(), R.mipmap.ic_launcher))
                .setIntent(intent)
                .build()
            manager.requestPinShortcut(info, null)
            result.put("requested", true)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("请求固定快捷方式失败: " + error.message)
        }
    }

    private companion object {
        const val SHORTCUT_ID = "quick-note"
        const val DEEP_LINK = "lakexlocalnotes://quick-note"
    }
}
