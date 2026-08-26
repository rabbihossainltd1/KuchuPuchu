import { Capacitor } from "@capacitor/core";

type BackFn = () => boolean;
const backStack: BackFn[] = [];

export function isNativeShell() {
  return Capacitor.isNativePlatform();
}

export function pushBackHandler(handler: BackFn) {
  backStack.push(handler);
  return () => {
    const index = backStack.lastIndexOf(handler);
    if (index >= 0) backStack.splice(index, 1);
  };
}

export function onNativeBack(handler: BackFn) {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  return pushBackHandler(handler);
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

  try {
    const { askNotifyPermission, listenNotifyActions } = await import("./notify");
    await askNotifyPermission();
    await listenNotifyActions();
  } catch {
    /* optional */
  }

  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("backButton", ({ canGoBack }) => {
      for (let i = backStack.length - 1; i >= 0; i -= 1) {
        if (backStack[i]?.()) return;
      }
      if (canGoBack) window.history.back();
      else void App.exitApp();
    });
  } catch {
    /* optional */
  }
}
