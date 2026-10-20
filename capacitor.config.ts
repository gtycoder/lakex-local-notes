import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lakenotes.mobile',
  appName: 'LocalLakeNotes',
  webDir: 'dist-mobile',
  // 页面 scheme 用 http（与桌面一致，加载 http://127.0.0.1 资源无混合内容）。
  // Capacitor 默认 https://localhost 会让 <audio>/<video> 加载本地资源被 WebView
  // 混合内容策略拒绝（网络 206 成功但媒体管线不解码）；http 页面无此问题。
  // cleartext 已由 network_security_config 放行（base-config cleartextTrafficPermitted=true）。
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
