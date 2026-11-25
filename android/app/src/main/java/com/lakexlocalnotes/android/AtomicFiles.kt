package com.lakexlocalnotes.android

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/**
 * 原子写收口（M-03，审计 03-mobile）：「同目录临时文件 → 写完 fsync → rename 收尾」的唯一实现。
 *
 * 收口前同一语义有 4 份实现、3 种临时名约定（BodyStorePlugin / AssetSyncPlugin / PortablePackagePlugin），
 * 残留过滤器只判 ".tmp-" 前缀 ⇒ 后缀式残留认不出来、命名与过滤器互相漂移。统一为：
 *  - 临时名 = ".tmp-<uuid>-<name>"（前缀式，残留判定见 [isTemp]）；
 *  - rename 失败先删目标再重试一次（某些文件系统 rename 覆盖已存在目标会失败），仍失败才抛；
 *  - 任何失败/中断都清理临时文件，目标保持旧内容（绝不落半文件）。
 */
internal object AtomicFiles {

    /** 写中断信号：writeBody 内抛出 ⇒ 不 rename、清临时文件、目标保持原状（如下载校验不符）。 */
    class AbortWrite(message: String = "原子写已中止") : IOException(message)

    /** 统一临时命名：".tmp-<uuid>-<name>"。 */
    fun tempName(target: File): String = ".tmp-" + UUID.randomUUID() + "-" + target.name

    /**
     * 残留临时文件判据（M-03：兼容三种历史命名，双判前/后缀）：
     * ① 前缀式 ".tmp-<...>"（本文件统一命名、旧 getFile ".tmp-<name>"、旧远端下载 ".tmp-download-<uuid>"）；
     * ② 后缀式 "<name>.tmp-<uuid>"（旧 BodyStorePlugin / AssetSyncPlugin 原子写）；
     * ③ "<name>.tmp"（旧 PortablePackagePlugin pending 标记）。
     * ①② 都含 ".tmp-"，③ 判 ".tmp" 结尾。
     */
    fun isTemp(name: String): Boolean = name.contains(".tmp-") || name.endsWith(".tmp")

    /** 原子写（整字节）。 */
    fun writeAtomic(target: File, bytes: ByteArray, sync: Boolean = true) {
        streamAtomic(target, sync) { out -> out.write(bytes) }
    }

    /**
     * 原子写（流式）：writeBody 把内容写进同目录临时文件，正常返回才 rename 收尾。
     * sync=false（批量导入/网络落盘）：原子 rename 仍在，只是不逐文件 fsync —— 进程被杀不会丢
     * （页缓存在），断电可能丢最近写入；内容在云端有同内容副本，下轮按 hash 自愈。
     */
    fun streamAtomic(target: File, sync: Boolean = true, writeBody: (FileOutputStream) -> Unit) {
        val parent = target.parentFile ?: throw IOException("原子写父目录无效")
        if (!parent.exists() && !parent.mkdirs()) throw IOException("原子写目录创建失败")
        val tmp = File(parent, tempName(target))
        try {
            FileOutputStream(tmp).use { out ->
                writeBody(out)
                out.flush()
                if (sync) out.fd.sync()
            }
            if (!tmp.renameTo(target)) {
                // 某些文件系统 rename 目标存在会失败：先删再 rename（同目录下仍是原子的）。
                if (target.exists() && !target.delete()) throw IOException("原子写旧目标删除失败")
                if (!tmp.renameTo(target)) throw IOException("原子写 rename 失败")
            }
        } finally {
            if (tmp.exists()) tmp.delete()
        }
    }
}
