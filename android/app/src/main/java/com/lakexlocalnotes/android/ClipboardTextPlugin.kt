package com.lakexlocalnotes.android

import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 读系统剪贴板的**最新一条文本**（「剪切板小记」快捷入口，261119）。
 *
 * 只取文本：primaryClip 描述带 TEXT_PLAIN / TEXT_HTML 时取第一项的 item.text；
 * 图片/文件/URI 一律当「没有文本」（**不调 coerceToText** —— 它会把 content:// URI 拉成垃圾字符串）。
 * 空剪贴板 / 非文本 ⇒ 回 { text: "" }，由 JS（src/mobile/native/clipboardText.ts）给
 * 「剪贴板没有可用的文本」提示 + 空白写作卡，不抛错。
 *
 * 不声明权限：Android 10+ 只有前台（有窗口焦点）应用可读剪贴板，本调用只发生在用户点快捷方式
 * 进来的前台会话；读不到按「空」处理（JS 侧会复读一次兜启动时序）。
 */
@CapacitorPlugin(name = "ClipboardText")
class ClipboardTextPlugin : Plugin() {
    @PluginMethod
    fun readText(call: PluginCall) {
        val clipboard = getContext().getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val payload = JSObject()
        payload.put("text", readPrimaryText(clipboard))
        call.resolve(payload)
    }

    /** 最新一条剪贴板文本；非文本/空/读不到一律空串（对 JS 不报错，语义见类头注释）。 */
    private fun readPrimaryText(clipboard: ClipboardManager?): String {
        val clip = clipboard?.primaryClip ?: return ""
        if (clip.itemCount <= 0) return ""
        val description = clip.description
        val isText = description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) ||
            description.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML)
        if (!isText) return ""
        return clip.getItemAt(0).text?.toString() ?: ""
    }
}
