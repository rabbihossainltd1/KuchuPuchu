import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.kuchupuchu.android",
  appName: "KuchuPuchu",
  webDir: "dist/web",
  android: {
    allowMixedContent: true,
  },
};

export default config;
