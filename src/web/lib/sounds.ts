let current: HTMLAudioElement | null = null;

export function stopTone() {
  if (!current) return;
  current.pause();
  current.currentTime = 0;
  current = null;
}

export function playTone(src: string, loop = true) {
  stopTone();
  const el = new Audio(src);
  el.loop = loop;
  el.preload = "auto";
  el.volume = 0.72;
  void el.play().catch(() => undefined);
  current = el;
  return el;
}

export function unlockAudio() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.03);
  } catch {
    /* webview */
  }
}
