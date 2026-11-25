package com.quizrunner3d

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class AppUpdaterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AppUpdater"

  private fun emitProgress(percent: Int) {
    val params = Arguments.createMap().apply {
      putInt("percent", percent)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("AppUpdaterProgress", params)
  }

  @ReactMethod
  fun downloadAndInstall(apkUrl: String, promise: Promise) {
    Thread {
      try {
        val url = URL(apkUrl)
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        conn.connect()

        if (conn.responseCode !in 200..299) {
          promise.reject("HTTP_ERROR", "HTTP ${conn.responseCode}")
          return@Thread
        }

        val totalBytes = conn.contentLength
        val outFile = File(reactContext.cacheDir, "update.apk")
        if (outFile.exists()) outFile.delete()

        conn.inputStream.use { input ->
          FileOutputStream(outFile).use { output ->
            val buffer = ByteArray(16 * 1024)
            var downloaded = 0L
            var lastPercent = -1
            while (true) {
              val read = input.read(buffer)
              if (read == -1) break
              output.write(buffer, 0, read)
              downloaded += read
              if (totalBytes > 0) {
                val pct = ((downloaded * 100) / totalBytes).toInt().coerceIn(0, 100)
                if (pct != lastPercent) {
                  lastPercent = pct
                  emitProgress(pct)
                }
              }
            }
            output.flush()
          }
        }

        emitProgress(100)

        val uri = FileProvider.getUriForFile(
          reactContext,
          "${reactContext.packageName}.fileprovider",
          outFile,
        )

        val installIntent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, "application/vnd.android.package-archive")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        reactContext.startActivity(installIntent)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("UPDATE_FAILED", e.message ?: "Güncelleme hatası", e)
      }
    }.start()
  }
}
