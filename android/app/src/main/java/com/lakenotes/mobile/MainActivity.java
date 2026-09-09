package com.lakenotes.mobile;

import android.os.Bundle;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpenFilePlugin.class);
        super.onCreate(savedInstanceState);
        // 本地资产 HTTP 服务：canonical URL http://127.0.0.1:19876/{noteId}/{file} 本机可达，
        // Lake 原生渲染图片/附件，替代移动端 blob 注入方案（与桌面端资源服务器语义一致）。
        String assetToken = AssetServer.start(this);
        if (assetToken != null && getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new AssetTokenInterface(assetToken), "lakeAssetToken");
        }
    }

    /** 仅暴露给本应用 WebView；其他 App 无法读取该接口或伪造带 token 的请求。 */
    private static final class AssetTokenInterface {
        private final String token;

        AssetTokenInterface(String token) {
            this.token = token;
        }

        @JavascriptInterface
        public String getToken() {
            return token;
        }
    }
}
