package com.lakenotes.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpenFilePlugin.class);
        super.onCreate(savedInstanceState);
        // 本地资产 HTTP 服务：canonical URL http://127.0.0.1:19876/{noteId}/{file} 本机可达，
        // Lake 原生渲染图片/附件，替代移动端 blob 注入方案（与桌面端资源服务器语义一致）。
        AssetServer.start(this);
    }
}
