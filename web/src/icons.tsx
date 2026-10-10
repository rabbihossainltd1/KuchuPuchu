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
  | "micOff"
  | "screenShare"
  | "fullscreen"
  | "fullscreenExit"
  | "callIn"
  | "callOut"
  | "speaker";

const shapes: Record<IconName, ReactNode> = {
  chats: (
    <>
      <path d="M20.5 11.2a7.7 7.7 0 0 1-8.1 7.7 8 8 0 0 1-3.1-.6L4 20l1.7-4.4a7.4 7.4 0 0 1-1.1-3.9A7.8 7.8 0 0 1 12.5 4a7.8 7.8 0 0 1 8 7.2Z" />
      <path d="M8.5 11.5h7M8.5 14.5h4.5" />
    </>
  ),
  status: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8a8.2 8.2 0 0 1 8.2 8.2" />
      <path d="M12 7.2a4.8 4.8 0 0 1 4.8 4.8" />
    </>
  ),
  calls: (
    <path d="M7.2 4.8 9.4 8l-1.5 1.7a14.4 14.4 0 0 0 6.4 6.4l1.7-1.5 3.2 2.2-.7 3a1.7 1.7 0 0 1-1.8 1.3C9.4 20.3 3.7 14.6 3 7.3a1.7 1.7 0 0 1 1.3-1.8l2.9-.7Z" />
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="m16 16 4.2 4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  settings: (
    <>
      <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
      <path d="m19.4 13.5 1.1.9-1.7 3-1.4-.5a8 8 0 0 1-1.6.9l-.3 1.5h-3.4l-.3-1.5a8 8 0 0 1-1.6-.9l-1.4.5-1.7-3 1.1-.9a7.2 7.2 0 0 1 0-1.9l-1.1-.9 1.7-3 1.4.5a8 8 0 0 1 1.6-.9l.3-1.5h3.4l.3 1.5a8 8 0 0 1 1.6.9l1.4-.5 1.7 3-1.1.9a7.2 7.2 0 0 1 0 1.9Z" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.2 20a6.8 6.8 0 0 1 13.6 0" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  message: (
    <>
      <path d="M20 11.5a7.5 7.5 0 0 1-7.8 7.5 8 8 0 0 1-3-.6L4 20l1.6-4.3a7.4 7.4 0 0 1-1-3.8A7.6 7.6 0 0 1 12.2 4 7.6 7.6 0 0 1 20 11.5Z" />
      <path d="M8.5 11.5h7M8.5 14.5h4" />
    </>
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
  play: <path d="M8.5 5.5v13l10-6.5-10-6.5Z" />,
  pause: (
    <>
      <path d="M9.5 5.5v13" />
      <path d="M14.5 5.5v13" />
    </>
  ),
  mic: (
    <>
      <path d="M12 4.5a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0V7A2.5 2.5 0 0 1 12 4.5Z" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" />
    </>
  ),
  send: <path d="M4.5 12 20 5l-6.2 14.5-2-6.3-7.3-1.2Z" />,
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
    <>
      <path d="M3.5 7.5h11v9h-11z" />
      <path d="m14.5 11 5-3v8l-5-3z" />
    </>
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
  /* The call glyphs. `phone` is the handset the phone app uses for a voice
     call; `phoneOff` is the same handset on its side with the strike the end
     button carries, so the destructive action reads as destructive. */
  phone: (
    <path d="M7.2 4.8 9.4 8l-1.5 1.7a14.4 14.4 0 0 0 6.4 6.4l1.7-1.5 3.2 2.2-.7 3a1.7 1.7 0 0 1-1.8 1.3C9.4 20.3 3.7 14.6 3 7.3a1.7 1.7 0 0 1 1.3-1.8l2.9-.7Z" />
  ),
  phoneOff: (
    <>
      <path d="M3.5 9.5c3-2.4 6.4-3.4 8.5-3.4s5.5 1 8.5 3.4l-1.4 2.4a2 2 0 0 1-2.2.9l-1.9-.5a2 2 0 0 1-1.4-1.3l-.3-1h-2.6l-.3 1a2 2 0 0 1-1.4 1.3l-1.9.5a2 2 0 0 1-2.2-.9L3.5 9.5Z" />
      <path d="M4 4l16 16" />
    </>
  ),
  videoCall: (
    <>
      <path d="M3.5 7.5h11v9h-11z" />
      <path d="m14.5 11 5-3v8l-5-3z" />
    </>
  ),
  videoOff: (
    <>
      <path d="M3.5 7.5h8M14.5 16.5h-11v-9h1.5" />
      <path d="m14.5 11 5-3v8l-5-3v-2" />
      <path d="M4 4l16 16" />
    </>
  ),
  micOff: (
    <>
      <path d="M9.5 9.6V7a2.5 2.5 0 0 1 4.9-.7" />
      <path d="M14.5 11.3v.7a2.5 2.5 0 0 1-4.3 1.8" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 8.4 4.8M12 17v3M9 20h6" />
      <path d="M4 4l16 16" />
    </>
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
      <path d="M7.2 4.8 9.4 8l-1.5 1.7a14.4 14.4 0 0 0 6.4 6.4l1.7-1.5 3.2 2.2-.7 3a1.7 1.7 0 0 1-1.8 1.3C9.4 20.3 3.7 14.6 3 7.3a1.7 1.7 0 0 1 1.3-1.8l2.9-.7Z" />
      <path d="M20.5 3.5 15 9M15 4.6V9h4.4" />
    </>
  ),
  callOut: (
    <>
      <path d="M7.2 4.8 9.4 8l-1.5 1.7a14.4 14.4 0 0 0 6.4 6.4l1.7-1.5 3.2 2.2-.7 3a1.7 1.7 0 0 1-1.8 1.3C9.4 20.3 3.7 14.6 3 7.3a1.7 1.7 0 0 1 1.3-1.8l2.9-.7Z" />
      <path d="M15 9l5.5-5.5M20.5 7.9V3.5h-4.4" />
    </>
  ),
  speaker: (
    <>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.6 7.6 0 0 1 0 10.4" />
    </>
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
