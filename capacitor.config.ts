import type { CapacitorConfig } from '@capacitor/cli';

/**
 * appId 只服务 Android（applicationId = com.lakexlocalnotes.android）。
 * 未来 iOS 工程建立后，bundle identifier 用 **com.lakexlocalnotes.ios**（平台包名必须区分，
 * 不要复用 Android 的 id：跨平台同 id 会让签名、App Store 记录与数据容器语义混淆）。
 */
const config: CapacitorConfig = {
  appId: 'com.lakexlocalnotes.android',
  appName: 'LakexLocalNotes',
  webDir: 'dist-mobile',
  // 与原生 splash 同色的纯色底（261022）：页面首帧前不闪白；不是遮罩、不延迟任何东西。
  backgroundColor: '#ededf1',
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
