import { useId, type ReactNode, type SVGProps } from "react";

export type IconName =
  | "chats"
  | "status"
  | "calls"
  | "search"
  | "plus"
  | "more"
  | "settings"
  | "profile"
  | "arrow"
  | "message"
  | "lock"
  | "sparkle"
  | "download"
  | "link"
  | "file"
  | "play"
  | "pause"
  | "mic"
  | "micOff"
  | "send"
  | "check"
  | "close"
  | "trash"
  | "photo"
  | "video"
  | "pencil"
  | "eye"
  | "hide"
  | "flag"
  | "phone"
  | "phoneOff"
  | "videoCall"
  | "videoOff"
  | "screenShare"
  | "fullscreen"
  | "fullscreenExit"
  | "callIn"
  | "callOut"
  | "speaker"
  | "attach"
  | "mood";

/* The glyphs below are the APP's own, not web lookalikes. Nav + composer copy
   the phone's original artwork point for point:

   • `chats` / `message` is the exact stroke path of the phone's
     `res/drawable/ic_nav_chat.xml` vector (round caps, 1.6 stroke on 24).
   • `status` is the exact geometry of `StatusGlyphIcon` in Ui.kt — the inner
     ring (r = 0.22·s, stroke s/10) plus four 72.06° arcs on r = 0.44·s at the
     cardinal angles, round caps.
   • Everything Material on the phone (calls, search, settings, person, more,
     mic, videocam, attach, mood, send, call-end) is the same filled Material
     glyph the phone renders via Icons.Filled.*. */

const F = "currentColor"; // filled glyphs
const shapes: Record<IconName, ReactNode> = {
  chats: (
    <path
      d="M3 20l1.3-3.9c-2.324-3.437-1.426-7.872 2.1-10.374c3.526-2.501 8.59-2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235-7.615 4.215-11.574 2.293l-4.7 1"
      stroke="currentColor"
      strokeWidth="1.6"
    />
  ),
  status: (
    <>
      <circle cx="12" cy="12" r="5.28" stroke="currentColor" strokeWidth="2.4" />
      <path
        d="M5.79 3.46A10.56 10.56 0 0 1 18.21 3.46M18.21 20.54A10.56 10.56 0 0 1 5.79 20.54M3.46 18.21A10.56 10.56 0 0 1 3.46 5.79M20.54 5.79A10.56 10.56 0 0 1 20.54 18.21"
        stroke="currentColor"
        strokeWidth="2.4"
      />
    </>
  ),
  calls: (
    <path
      fill={F}
      stroke="none"
      d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
    />
  ),
  search: (
    <path
      fill={F}
      stroke="none"
      d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
    />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <path
      fill={F}
      stroke="none"
      d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
    />
  ),
  settings: (
    <path
      fill={F}
      stroke="none"
      d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
    />
  ),
  profile: (
    <path
      fill={F}
      stroke="none"
      d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
    />
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  message: (
    <path
      d="M3 20l1.3-3.9c-2.324-3.437-1.426-7.872 2.1-10.374c3.526-2.501 8.59-2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235-7.615 4.215-11.574 2.293l-4.7 1"
      stroke="currentColor"
      strokeWidth="1.6"
    />
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v2" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" />
      <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
  file: (
    <>
      <path d="M7 3.8h7L18.5 8v12.2H7z" />
      <path d="M13.8 4v4.2h4.5M9.6 12.5h6.8M9.6 15.8h4.6" />
    </>
  ),
  play: <path fill={F} stroke="none" d="M8 5v14l11-7z" />,
  pause: <path fill={F} stroke="none" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />,
  mic: (
    <path
      fill={F}
      stroke="none"
      d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"
    />
  ),
  micOff: (
    <>
      <path
        fill={F}
        stroke="none"
        d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"
      />
      <path d="M4 4l16 16" strokeWidth="2" />
    </>
  ),
  send: <path fill={F} stroke="none" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trash: (
    <>
      <path d="M5.5 7.5h13M10 7.5V5h4v2.5" />
      <path d="M7 7.5 8 20h8l1-12.5M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  photo: (
    <>
      <path d="M4 6.5h16v11H4z" />
      <path d="m5.5 15.5 4-4 3 3 2.5-2.5 3.5 3.5" />
      <circle cx="9" cy="9.8" r="1.2" />
    </>
  ),
  video: (
    <path
      fill={F}
      stroke="none"
      d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"
    />
  ),
  pencil: (
    <>
      <path d="M5 19h3.2L19 8.2a2 2 0 0 0-2.8-2.8L5.4 16.2 5 19Z" />
      <path d="m14.6 6.8 2.6 2.6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6 6.8 12 6.8 21.2 12 21.2 12 18 17.2 12 17.2 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  hide: (
    <>
      <path d="M4 4.5 20 19.5" />
      <path d="M9.6 9.9A2.6 2.6 0 0 0 12 14.6c.7 0 1.3-.3 1.8-.7" />
      <path d="M6.4 7.4C4.2 8.8 2.8 12 2.8 12S6 17.2 12 17.2c1.6 0 3-.4 4.2-1M18.6 15c1.6-1.3 2.6-3 2.6-3S18 6.8 12 6.8c-.7 0-1.4.1-2 .2" />
    </>
  ),
  flag: (
    <>
      <path d="M6 20V4.5" />
      <path d="M6 5.2h11l-2 3.4 2 3.4H6z" />
    </>
  ),
  /* The call glyphs match the phone: `phone` is the filled Material Call the
     app uses for a voice call; `phoneOff` is the filled CallEnd the end
     button carries, so the destructive action reads as destructive. */
  phone: (
    <path
      fill={F}
      stroke="none"
      d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
    />
  ),
  phoneOff: (
    <path
      fill={F}
      stroke="none"
      d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"
    />
  ),
  videoCall: (
    <path
      fill={F}
      stroke="none"
      d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"
    />
  ),
  videoOff: (
    <path
      fill={F}
      stroke="none"
      d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"
    />
  ),
  screenShare: (
    <>
      <path d="M3.5 5.5h17v10.5h-17z" />
      <path d="M8.5 19.5h7M12 16v3.5" />
      <path d="M12 8.5v5M9.8 10.7 12 8.5l2.2 2.2" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M4 9V4h5" />
      <path d="M15 4h5v5" />
      <path d="M20 15v5h-5" />
      <path d="M9 20H4v-5" />
    </>
  ),
  fullscreenExit: (
    <>
      <path d="M9 4v5H4" />
      <path d="M20 9h-5V4" />
      <path d="M15 20v-5h5" />
      <path d="M4 15h5v5" />
    </>
  ),
  callIn: (
    <>
      <path
        fill={F}
        stroke="none"
        d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
      />
      <path d="M20.5 3.5 15 9M15 4.6V9h4.4" />
    </>
  ),
  callOut: (
    <>
      <path
        fill={F}
        stroke="none"
        d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
      />
      <path d="M15 9l5.5-5.5M20.5 7.9V3.5h-4.4" />
    </>
  ),
  speaker: (
    <>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.6 7.6 0 0 1 0 10.4" />
    </>
  ),
  attach: (
    <path
      fill={F}
      stroke="none"
      d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"
    />
  ),
  mood: (
    <path
      fill={F}
      stroke="none"
      d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S7.83 8 7 8 5.5 8.67 5.5 9.5 6.17 11 7 11zm3.5 5.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"
    />
  ),
};

type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...props}
    >
      {shapes[name]}
    </svg>
  );
}

export function BrandMark({ size = 34 }: { size?: number }) {
  const gradientId = `kp-brand-${useId().replace(/:/g, "")}`;

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 40 40" fill="none">
      <defs>
        <linearGradient
          id={gradientId}
          x1="6"
          y1="5"
          x2="34"
          y2="36"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#68a8ff" />
          <stop offset="1" stopColor="#2f6fed" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="13" fill={`url(#${gradientId})`} />
      <path
        d="M29.2 18.8a9.3 9.3 0 0 1-9.6 9.1 9.8 9.8 0 0 1-3.6-.7l-5.3 1.8 1.9-5a8.8 8.8 0 0 1-1.3-4.6 9.2 9.2 0 0 1 9.5-9 9.2 9.2 0 0 1 8.4 5.2"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="19" r="1.1" fill="white" />
      <circle cx="21" cy="19" r="1.1" fill="white" />
      <circle cx="25" cy="19" r="1.1" fill="white" />
    </svg>
  );
}
