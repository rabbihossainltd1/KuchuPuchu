// §54 bugs 4, 5, 6 — the in-call surface.
//
// Bug 4: "in a voice call, turning the camera on (or starting a screen share)
// does not convert the call into a video call; the opponent never sees my video
// and there is no path at all to show theirs."
//
// The media path was never the problem. `createPeer` always adds a sendrecv
// video transceiver, so the video m-line exists from the first SDP and a real
// track swapped into that sender with RtpSender.setTrack() delivers frames
// without renegotiation. What was missing is that BOTH "we have video now"
// transitions mutated `active.kind` and returned without publishChange() — the
// one function that feeds the Compose state (`onChange`) and §31's Telecom
// record. stopShare() published while startShare() did not; the camera-off
// branch published while the camera-on branch did not. So the phone that
// started the change kept drawing the voice screen, and the far side only
// learned about the video by accident (an audio-route change, an ICE event, or
// its own first-frame gate).
//
// Bug 5: with the camera off the self view stayed on screen as a black box. The
// PiP tile IS the self feed, so there is nothing to draw in it — it is not
// composed at all now, and `cameraOff` is mutableStateOf, so it returns by
// itself when the camera comes back on.
//
// Bug 6: the tile could not be dragged where the user wanted. The reachable
// area was a fixed band (54dp from the top, 150dp from the bottom) no matter
// what was on screen; the reservation is now tied to the strip that would
// actually bury the tile, so hiding the controls with one tap opens the whole
// frame, and both the re-clamp and the gesture detector restart when that
// changes.

import { readFileSync } from "node:fs";

const DIR = "native-android/app/src/main/java/app/kuchupuchu/android";
const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);
const read = (f) => readFileSync(`${DIR}/${f}`, "utf8");
const COMMENTS = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const strip = (src) => src.replace(COMMENTS, (m) => "\n".repeat(m.split("\n").length - 1) || " ");
const flat = (t) => t.replace(/\s+/g, " ");
// The body of a function, braces balanced, so a needle cannot be satisfied by
// an unrelated call somewhere else in the file.
function bodyOf(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error(`no ${header}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${header}`);
}

const eng = strip(read("CallEngine.kt"));
const ui = strip(read("CallScreens.kt"));
const cam = bodyOf(eng, "fun toggleCamera()");
const share = bodyOf(eng, "private suspend fun startShare");
const stop = bodyOf(eng, "private fun stopShare");
const screen = bodyOf(ui, "fun InCallVideoScreen");
const screenFlat = flat(screen);

// ------------------------------------------------------ 1. the conversion is announced
{
  check(
    "camera-on publishes after the call is re-labelled VIDEO",
    /markVideoRoute\(\) publishChange\(\)/.test(flat(cam)),
  );
  check(
    "startShare publishes too (the pair with stopShare is now symmetric)",
    /markVideoRoute\(\) publishChange\(\)/.test(flat(share)),
  );
  check("stopShare still publishes", /publishChange\(\)/.test(stop));
  check(
    "a camera that failed to start is reported instead of faked as a video call",
    /if \(videoTrack == null\) \{ cameraOff = true notify\(/.test(flat(cam)) &&
      /return@launch/.test(cam),
  );
  check(
    "publishChange is the one place onChange + Telecom sync are driven from",
    /private fun publishChange\(\) \{ onChange\?\.invoke\(active\) runCatching \{ KpTelecom\.syncNow\(app\) \} \}/.test(
      flat(eng),
    ),
  );
  const shareToggle = bodyOf(eng, "fun toggleShare()");
  check(
    "sharing on a VOICE call is allowed (the guard is 'a call exists', not 'a video call exists')",
    /if \(active == null \|\| pc == null\) \{ notify\("Start a call first/.test(flat(shareToggle)),
  );
  check(
    "and the voice screen still exposes both conversion buttons",
    /"Video",\s*active = call\.kind == "VIDEO" && !engine\.cameraOff,[\s\S]{0,600}?\{ engine\.toggleCamera\(\) \}/.test(
      flat(ui),
    ) && /if \(engine\.sharing\) "Stop share" else "Share screen"/.test(ui),
  );
  check(
    "cameraOff / sharing stay Compose state, so the screen can follow them",
    /var cameraOff by mutableStateOf\(false\)/.test(eng) &&
      /var sharing by mutableStateOf\(false\)/.test(eng),
  );
}

// ------------------------------------------------------- 2. no self feed, no self tile
{
  check(
    "the screen derives 'is there a self feed' from cameraOff",
    /val localFeedUp = !engine\.cameraOff/.test(screen),
  );
  check(
    "the PiP tile is not composed at all while the camera is off",
    /if \(localFeedUp\) \{\s*BoxWithConstraints/.test(screen) &&
      // ...and declared BEFORE every use. The first cut kept both next to the
      // tile, 55 lines under the big renderer, and CI said
      // `CallScreens.kt:516:41 Unresolved reference: effSwap`. There is no
      // Kotlin compiler in this suite, so source order is the local proxy for
      // that error, checked against both consumers.
      screen.indexOf("val effSwap = swapped && localFeedUp") <
        screen.indexOf("VideoRenderer(engine, remote = !effSwap)") &&
      screen.indexOf("val localFeedUp = !engine.cameraOff") <
        screen.indexOf("VideoRenderer(engine, remote = effSwap, fit = true, pip = true)") &&
      screen.indexOf("val localFeedUp = !engine.cameraOff") < screen.indexOf("if (localFeedUp) {"),
  );
  check(
    "it is really removed, not replaced by a placeholder box",
    !/if \(!localFeedUp\)/.test(screen) && !/"Camera off"/.test(screen),
  );
  check(
    "an off camera can never be promoted full-screen (swap goes through effSwap)",
    /val effSwap = swapped && localFeedUp/.test(screen) &&
      /VideoRenderer\(engine, remote = !effSwap\)/.test(screen) &&
      /VideoRenderer\(engine, remote = effSwap, fit = true, pip = true\)/.test(screen),
  );
  check("no renderer reads the raw swapped flag any more", !/remote = swapped[,)]/.test(screen));
  check(
    "the tile is the only self view (one BoxWithConstraints in the screen)",
    (screen.match(/BoxWithConstraints/g) || []).length === 1,
  );
}

// ------------------------------------------------------- 3. the tile reaches the frame
{
  check(
    "the strip / head reservations collapse to the plain edge once the controls are hidden",
    /val stripGap = with\(dm\) \{ if \(controlsVisible\) 150\.dp\.toPx\(\) else edge/.test(
      screenFlat,
    ) &&
      /val headGap = with\(dm\) \{ if \(controlsVisible\) 54\.dp\.toPx\(\) else edge/.test(
        screenFlat,
      ),
  );
  check(
    "bounds come from the frame minus the tile and stay sane when the frame is short",
    /val maxX = \(parentW - selfW - edge\)\.coerceAtLeast\(minX\)/.test(screenFlat) &&
      /val maxY = \(parentH - selfH - stripGap\)\.coerceAtLeast\(minY\)/.test(screenFlat),
  );
  check(
    "the drag handler clamps with those same values (before, it re-derived them)",
    /pipX = \(pipX \+ d\.x\)\.coerceIn\(minX, maxX\)/.test(screenFlat) &&
      /pipY = \(pipY \+ d\.y\)\.coerceIn\(minY, maxY\)/.test(screenFlat),
  );
  check(
    "the fixed 54dp band and the un-margined x clamp are gone",
    !/coerceIn\(topLimit/.test(screen) && !/\(parentW - selfW\)\.coerceAtLeast\(0f\)/.test(screen),
  );
  check(
    "re-clamp and gesture detector both restart when the controls change, so the tile is never trapped under them",
    /LaunchedEffect\(parentW, parentH, controlsVisible\)/.test(screen) &&
      /\.pointerInput\(parentW, parentH, controlsVisible\)/.test(screen),
  );
  check(
    "tap-to-swap still works (a tap that moved no pixel is a tap)",
    /if \(!moved\) swapped = !swapped/.test(screen),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
