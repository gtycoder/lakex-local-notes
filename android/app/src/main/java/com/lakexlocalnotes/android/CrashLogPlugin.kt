package com.lakexlocalnotes.android

import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 原生崩溃记录插件（261105）：只做「最近一条未捕获异常」的落盘与读取。
 *
 * 背景（261105 容错审计）：移动端此前没有任何原生崩溃落盘 —— 现场只有"闪退"，没有堆栈可查；
 * 桌面有 installCrashLogging（electron/main.ts:323）。这里由 MainActivity 安装
 * Thread.setDefaultUncaughtExceptionHandler，崩溃前写 filesDir/crash/last-crash.txt（只留最近一条，
 * 避免无限增长），下次启动由渲染层 consumeNativeCrashLog() 读进移动端崩溃记录并清空。
 *
 * 安全：只写应用私有目录；写入内容 = 摘要行 + 堆栈，不含正文/密钥。
 */
@CapacitorPlugin(name = "CrashLog")
class CrashLogPlugin : Plugin() {
    companion object {
        private const val DIR = "crash"
        private const val FILE = "last-crash.txt"

        /** 崩溃前落盘（尽力而为：这里再抛异常就只剩系统默认处理，不放大问题）。 */
        fun record(context: Context, throwable: Throwable) {
            try {
                val dir = File(context.filesDir, DIR)
                if (!dir.exists() && !dir.mkdirs()) return
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
                val header = "time=" + stamp + " device=" + android.os.Build.MANUFACTURER + " " +
                    android.os.Build.MODEL + " sdk=" + android.os.Build.VERSION.SDK_INT
                val text = header + "\n" + throwable.stackTraceToString()
                // 临时文件 + rename：进程可能在写一半时被杀，避免下次读到半截 JSON/文本。
                val target = File(dir, FILE)
                val tmp = File(dir, FILE + ".tmp")
                tmp.writeText(text)
                if (!tmp.renameTo(target)) {
                    target.delete()
                    if (!tmp.renameTo(target)) tmp.delete()
                }
            } catch (_: Throwable) {
                // 记录失败不能影响原始崩溃处理（系统默认 handler 接着跑）。
            }
        }
    }

    /** 读最近一条崩溃：{ text: String?, at: Long? }（at = 文件修改时间）。 */
    @PluginMethod
    fun read(call: PluginCall) {
        try {
            val file = File(File(context.filesDir, DIR), "last-crash.txt")
            val result = JSObject()
            if (file.isFile) {
                result.put("text", file.readText())
                result.put("at", file.lastModified())
            } else {
                result.put("text", null)
                result.put("at", null)
            }
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("读取崩溃记录失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    /** 清掉最近一条（渲染层消费后调用，保证同一条只展示一次）。 */
    @PluginMethod
    fun clear(call: PluginCall) {
        try {
            val file = File(File(context.filesDir, DIR), "last-crash.txt")
            if (file.exists()) file.delete()
            call.resolve()
        } catch (e: Exception) {
            call.reject("清除崩溃记录失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }
}
