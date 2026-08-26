import { Capacitor } from "@capacitor/core";

export function isNativeShell() {
  return Capacitor.isNativePlatform();
}

export async function bootNative() {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add("native-app");
  document.body.classList.add("native-app");

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: "#ffffff" });
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    /* plugin missing in web preview */
  }

  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    /* optional */
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* optional */
  }
}

export function onNativeBack(handler: () => boolean) {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  let remove: (() => void) | undefined;
  void import("@capacitor/app").then(({ App }) => {
    const sub = App.addListener("backButton", ({ canGoBack }) => {
      if (handler()) return;
      if (canGoBack) window.history.back();
      else void App.exitApp();
    });
    void sub.then((handle) => {
      remove = () => {
        void handle.remove();
      };
    });
  });
  return () => remove?.();
}
