package com.lakexlocalnotes.android

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * 本地资产占用统计（261103 十四批）。
 *
 * 为什么用原生：资产是 App 私有 Data 下的 note-assets/ 与 quick-notes/assets/ 目录，
 * 文件量可达数万；JS 侧 Capacitor Filesystem 每文件一次 stat = 每次约 68ms 桥往返，不可用。
 * 这里在原生一次性递归 walk，只读、不删不改，返回 { files, bytes }。
 */
@CapacitorPlugin(name = "AssetUsage")
class AssetUsagePlugin : Plugin() {
    @PluginMethod
    fun usage(call: PluginCall) {
        // 目录 walk 可能几万文件：放到后台线程，不占主线程/桥线程。
        Thread({
            var files = 0L
            var bytes = 0L
            val roots = listOf(File(context.filesDir, "note-assets"), File(context.filesDir, "quick-notes/assets"))
            fun walk(dir: File?) {
                val children = dir?.listFiles() ?: return
                for (child in children) {
                    if (child.isDirectory) {
                        walk(child)
                    } else if (child.isFile) {
                        files += 1
                        bytes += child.length()
                    }
                }
            }
            try {
                for (root in roots) walk(root)
                val ret = JSObject()
                ret.put("files", files)
                ret.put("bytes", bytes)
                call.resolve(ret)
            } catch (error: Throwable) {
                call.reject("读取资源占用失败：" + (error.message ?: error.javaClass.simpleName))
            }
        }, "asset-usage").start()
    }
}
