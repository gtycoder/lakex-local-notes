package com.locallakexnotes.mobile

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import android.util.Base64
import java.io.File
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap

/**
 * 原生 AI 通道（261023 P0）。对应桌面 electron/ai/aiClient.ts 的角色，但只做文本流式对话。
 *
 * 红线：
 *  · **API Key 只在原生**：加密存 Android Keystore（SecretBox）后落私有 SharedPreferences；
 *    JS 侧永远拿不到明文（getSettings 只回尾号）；
 *  · 网络请求在原生后台线程发起，WebView 不参与；
 *  · 流式：SSE 逐块 `notifyListeners("ai:delta")`，结束 `ai:done`，失败 `ai:error`；
 *  · 取消幂等（按 requestId 断开连接）。
 */
@CapacitorPlugin(name = "AiChat")
class AiChatPlugin : Plugin() {
    companion object {
        private const val PREFS = "local-lakex-notes-ai"
        private const val SETTINGS_KEY = "settings"
        private const val ALIAS = "local-lakex-notes.ai.v1"
        private const val DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
        private const val DEFAULT_MODEL = "deepseek-chat"
        private const val DEFAULT_TEMPERATURE = 0.7
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 60_000
    }

    private val box = SecretBox(ALIAS, PREFS)
    private val inFlight = ConcurrentHashMap<String, HttpURLConnection>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    private data class AiConfig(
        val baseUrl: String,
        val model: String,
        val apiKey: String,
        val temperature: Double,
        val reasoningEffort: String?,
        val thinking: String?,
    )

    // ---- 设置 ----

    private fun loadStored(): JSONObject {
        val raw = box.get(context, SETTINGS_KEY) ?: return JSONObject()
        return try { JSONObject(raw) } catch (e: Exception) { JSONObject() }
    }

    private fun loadConfig(): AiConfig {
        val obj = loadStored()
        return AiConfig(
            baseUrl = obj.optString("baseUrl", DEFAULT_BASE_URL).trimEnd('/'),
            model = obj.optString("model", DEFAULT_MODEL),
            apiKey = obj.optString("apiKey", ""),
            temperature = obj.optDouble("temperature", DEFAULT_TEMPERATURE),
            reasoningEffort = obj.optString("reasoningEffort", "").ifEmpty { null },
            thinking = obj.optString("thinking", "").ifEmpty { null },
        )
    }

    @PluginMethod
    fun getSettings(call: PluginCall) {
        val cfg = loadConfig()
        val out = JSObject()
        out.put("baseUrl", cfg.baseUrl)
        out.put("model", cfg.model)
        out.put("temperature", cfg.temperature)
        out.put("reasoningEffort", cfg.reasoningEffort ?: JSONObject.NULL)
        out.put("thinking", cfg.thinking ?: JSONObject.NULL)
        out.put("hasKey", cfg.apiKey.isNotEmpty())
        out.put("keyTail", if (cfg.apiKey.length >= 4) "sk-****" + cfg.apiKey.takeLast(4) else "")
        call.resolve(out)
    }

    @PluginMethod
    fun saveSettings(call: PluginCall) {
        try {
            val obj = loadStored()
            call.getString("baseUrl")?.let { obj.put("baseUrl", it.trim()) }
            call.getString("model")?.let { obj.put("model", it.trim()) }
            call.getDouble("temperature")?.let { obj.put("temperature", it) }
            // null / 空串都表示清除；传了才覆盖
            if (call.hasOption("apiKey")) {
                val key = call.getString("apiKey") ?: ""
                if (key.isEmpty()) obj.remove("apiKey") else obj.put("apiKey", key.trim())
            }
            if (call.hasOption("reasoningEffort")) {
                val v = call.getString("reasoningEffort")
                if (v.isNullOrEmpty()) obj.remove("reasoningEffort") else obj.put("reasoningEffort", v)
            }
            if (call.hasOption("thinking")) {
                val v = call.getString("thinking")
                if (v.isNullOrEmpty()) obj.remove("thinking") else obj.put("thinking", v)
            }
            box.put(context, SETTINGS_KEY, obj.toString())
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            call.reject("保存 AI 设置失败: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    // ---- 连通性 ----

    @PluginMethod
    fun testConnection(call: PluginCall) {
        call.setKeepAlive(true)
        Thread {
            val cfg = loadConfig()
            if (cfg.apiKey.isEmpty()) {
                call.resolve(errorResult("not_configured", null, "未配置 API Key"))
                return@Thread
            }
            try {
                val obj = JSONObject()
                obj.put("model", cfg.model)
                obj.put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "ping")))
                obj.put("max_tokens", 1)
                obj.put("temperature", 0)
                val conn = openConnection(cfg, stream = false)
                writeBody(conn, obj.toString())
                val status = conn.responseCode
                if (status !in 200..299) {
                    val detail = readError(conn)
                    call.resolve(errorResult(codeForStatus(status), status, detail))
                    return@Thread
                }
                conn.inputStream.use { it.readBytes() }
                conn.disconnect()
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.resolve(errorResult(codeForException(e), null, e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    // ---- 对话（SSE） ----

    @PluginMethod
    fun chat(call: PluginCall) {
        val requestId = call.getString("requestId")
        if (requestId.isNullOrEmpty()) { call.reject("requestId 必填"); return }
        val messages = call.getArray("messages")
        if (messages == null || messages.length() == 0) { call.reject("messages 必填"); return }
        val cfg = loadConfig()
        if (cfg.apiKey.isEmpty()) {
            call.resolve(errorResult("not_configured", null, "未配置 API Key"))
            return
        }
        call.setKeepAlive(true)
        val model = call.getString("model") ?: cfg.model
        val temperature = call.getDouble("temperature") ?: cfg.temperature

        Thread {
            var conn: HttpURLConnection? = null
            val text = StringBuilder()
            try {
                val body = JSONObject()
                body.put("model", model)
                body.put("messages", resolveMessages(messages))
                body.put("temperature", temperature)
                body.put("stream", true)
                cfg.reasoningEffort?.let { body.put("reasoning_effort", it) }
                cfg.thinking?.let { body.put("thinking", JSONObject().put("type", it)) }

                conn = openConnection(cfg, stream = true)
                inFlight[requestId] = conn
                writeBody(conn, body.toString())

                val status = conn.responseCode
                if (status !in 200..299) {
                    val detail = readError(conn)
                    val code = codeForStatus(status)
                    emitError(requestId, code, status, detail)
                    call.resolve(errorResult(code, status, detail))
                    return@Thread
                }

                val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
                var pending = StringBuilder()
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) {
                        if (pending.isNotEmpty()) {
                            val payload = pending.toString()
                            pending = StringBuilder()
                            if (payload == "[DONE]") break
                            val delta = extractDelta(payload)
                            if (!delta.isNullOrEmpty()) {
                                text.append(delta)
                                emitDelta(requestId, delta)
                            }
                        }
                        continue
                    }
                    if (line.startsWith("data:")) {
                        if (pending.isNotEmpty()) pending.append("\n")
                        pending.append(line.removePrefix("data:").trimStart())
                    }
                }
                emitDone(requestId)
                val out = JSObject()
                out.put("ok", true)
                out.put("text", text.toString())
                call.resolve(out)
            } catch (e: Exception) {
                if (cancelled.contains(requestId)) {
                    val out = JSObject()
                    out.put("ok", false)
                    out.put("code", "aborted")
                    out.put("cancelled", true)
                    call.resolve(out)
                    emitError(requestId, "aborted", null, null)
                } else {
                    val code = codeForException(e)
                    val detail = e.message ?: e.javaClass.simpleName
                    emitError(requestId, code, null, detail)
                    call.resolve(errorResult(code, null, detail))
                }
            } finally {
                cancelled.remove(requestId)
                inFlight.remove(requestId)
                try { conn?.disconnect() } catch (e: Exception) { /* 已断开 */ }
            }
        }.start()
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val requestId = call.getString("requestId")
        if (requestId.isNullOrEmpty()) { call.reject("requestId 必填"); return }
        cancelled.add(requestId)
        inFlight.remove(requestId)?.let {
            try { it.disconnect() } catch (e: Exception) { /* 已断开 */ }
        }
        call.resolve(JSObject().put("ok", true))
    }

    // ---- 内部 ----

    /** 把 JS 的 messages（content 可为 string 或内容块数组）解析成 OpenAI 兼容请求体；图片 ≤10 张、总大小有上限。 */
    private fun resolveMessages(messages: JSONArray): JSONArray {
        val out = JSONArray()
        var imageCount = 0
        var totalImageChars = 0L
        for (i in 0 until messages.length()) {
            val message = messages.optJSONObject(i) ?: continue
            val role = message.optString("role", "user")
            val content = message.opt("content")
            val resolved = JSONObject().put("role", role)
            if (content is String) {
                if (content.isNotEmpty()) out.put(resolved.put("content", content))
                continue
            }
            if (content !is JSONArray) continue
            val parts = JSONArray()
            for (j in 0 until content.length()) {
                val part = content.optJSONObject(j) ?: continue
                when (part.optString("type", "")) {
                    "text" -> {
                        val text = part.optString("text", "")
                        if (text.isNotEmpty()) parts.put(JSONObject().put("type", "text").put("text", text))
                    }
                    "image" -> {
                        if (imageCount >= 10) continue
                        val inline = part.optString("dataUrl", "")
                        val url = if (inline.startsWith("data:image/")) inline else assetDataUrl(part.optJSONObject("asset")) ?: continue
                        if (url.length > 3 * 1024 * 1024) continue
                        totalImageChars += url.length.toLong()
                        if (totalImageChars > 12L * 1024 * 1024) continue
                        imageCount += 1
                        parts.put(JSONObject().put("type", "image_url").put("image_url", JSONObject().put("url", url)))
                    }
                }
            }
            if (parts.length() == 0) continue
            resolved.put("content", parts)
            out.put(resolved)
        }
        return out
    }

    /** 资料/笔记图片：按 `{noteId, filename}` 在私有目录读文件并编码 data URL（路径段严格校验）。 */
    private fun assetDataUrl(asset: JSONObject?): String? {
        if (asset == null) return null
        val noteId = asset.optString("noteId", "")
        val filename = asset.optString("filename", "")
        if (noteId.isEmpty() || filename.isEmpty()) return null
        if (noteId.contains('/') || noteId.contains("..") || filename.contains('/') || filename.contains("..")) return null
        val file = File(File(File(context.filesDir, "note-assets"), noteId), filename)
        if (!file.isFile || file.length() > 8L * 1024 * 1024) return null
        val bytes = try { file.readBytes() } catch (e: Exception) { return null }
        val extension = filename.substringAfterLast('.', "").lowercase()
        val mime = when (extension) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "heic" -> "image/heic"
            "heif" -> "image/heif"
            else -> "image/jpeg"
        }
        return "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun openConnection(cfg: AiConfig, stream: Boolean): HttpURLConnection {
        val url = URL(cfg.baseUrl.trimEnd('/') + "/chat/completions")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = CONNECT_TIMEOUT_MS
        conn.readTimeout = READ_TIMEOUT_MS
        conn.doOutput = true
        conn.setRequestProperty("Authorization", "Bearer " + cfg.apiKey)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Accept", if (stream) "text/event-stream" else "application/json")
        return conn
    }

    private fun writeBody(conn: HttpURLConnection, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        conn.setFixedLengthStreamingMode(bytes.size)
        conn.outputStream.use { out: OutputStream -> out.write(bytes) }
    }

    private fun readError(conn: HttpURLConnection): String {
        return try {
            val stream = conn.errorStream ?: return ""
            val raw = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            // 供应商错误体通常是 {"error":{"message":...}}：取 message 给用户看，别把整段 JSON 塞进气泡。
            try {
                val message = JSONObject(raw).optJSONObject("error")?.optString("message")
                if (!message.isNullOrEmpty()) message else raw
            } catch (e: Exception) { raw }
        } catch (e: Exception) { "" }
    }

    /** 从 `{"choices":[{"delta":{"content":"..."}}]}` 里取增量；解析失败忽略该块。 */
    private fun extractDelta(payload: String): String? {
        return try {
            val obj = JSONObject(payload)
            val choices = obj.optJSONArray("choices") ?: return null
            if (choices.length() == 0) return null
            val delta = choices.getJSONObject(0).optJSONObject("delta") ?: return null
            // 注意：JSON 里 content 可能是 null（role/心跳块）——optString 会把它变成字符串 "null"，
            // 必须用 opt 判类型，否则流式正文里会混入 "null"。
            val content = delta.opt("content")
            if (content is String && content.isNotEmpty()) content else null
        } catch (e: Exception) { null }
    }

    private fun emitDelta(requestId: String, delta: String) {
        val out = JSObject()
        out.put("requestId", requestId)
        out.put("delta", delta)
        notifyListeners("ai:delta", out)
    }

    private fun emitError(requestId: String, code: String, status: Int?, detail: String?) {
        val out = JSObject()
        out.put("requestId", requestId)
        out.put("code", code)
        if (status != null) out.put("status", status)
        if (!detail.isNullOrEmpty()) out.put("detail", detail.take(300))
        notifyListeners("ai:error", out)
    }

    private fun emitDone(requestId: String) {
        val out = JSObject()
        out.put("requestId", requestId)
        notifyListeners("ai:done", out)
    }

    private fun errorResult(code: String, status: Int?, detail: String?): JSObject {
        val out = JSObject()
        out.put("ok", false)
        out.put("code", code)
        if (status != null) out.put("status", status)
        if (!detail.isNullOrEmpty()) out.put("detail", detail.take(300))
        return out
    }

    private fun codeForStatus(status: Int): String = when {
        status == 401 -> "auth"
        status == 403 -> "forbidden"
        status == 404 -> "not_found"
        status == 408 -> "timeout"
        status == 429 -> "rate_limit"
        status >= 500 -> "server"
        status >= 400 -> "bad_request"
        else -> "unknown"
    }

    private fun codeForException(e: Exception): String = when (e) {
        is SocketTimeoutException -> "timeout"
        is UnknownHostException -> "network"
        is java.net.ConnectException -> "network"
        is java.net.SocketException -> "network"
        is java.io.IOException -> "network"
        else -> "unknown"
    }
}
