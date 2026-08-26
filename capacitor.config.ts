import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.kuchupuchu.android",
  appName: "KuchuPuchu",
  webDir: "dist/web",
  backgroundColor: "#f7f6f4",
  server: {
    androidScheme: "https",
    hostname: "localhost",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#f7f6f4",
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#f7f6f4",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#ffffff",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
