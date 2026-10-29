package com.lakexlocalnotes.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class SharedContentPluginTest {
    @Test
    fun copiesWithinLimitAndReturnsByteCount() {
        val input = ByteArrayInputStream(byteArrayOf(1, 2, 3, 4))
        val output = ByteArrayOutputStream()

        val copied = copyStreamToFile(input, output, 4)

        assertEquals(4L, copied)
        assertTrue(output.toByteArray().contentEquals(byteArrayOf(1, 2, 3, 4)))
    }

    @Test
    fun stopsBeforeWritingPastLimit() {
        val input = ByteArrayInputStream(ByteArray(6) { it.toByte() })
        val output = ByteArrayOutputStream()
        var error: SharedContentTooLargeException? = null

        try {
            copyStreamToFile(input, output, 5)
        } catch (e: SharedContentTooLargeException) {
            error = e
        }

        assertTrue(error != null)
        assertEquals(0, output.size())
    }
}
