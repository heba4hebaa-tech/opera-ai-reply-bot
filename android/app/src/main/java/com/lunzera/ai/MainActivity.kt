package com.lunzera.ai

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val w = findViewById<WebView>(R.id.webview)
        val settings = w.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.setSupportMultipleWindows(false)
        w.webViewClient = WebViewClient()
        w.loadUrl("https://opera-ai-reply-bot.onrender.com/")
        webView = w
    }

    override fun onBackPressed(): Boolean {
        val w = webView ?: return super.onBackPressed()
        if (w.canGoBack) {
            w.goBack()
            return true
        }
        return super.onBackPressed()
    }
}
