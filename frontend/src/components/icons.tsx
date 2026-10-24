/**
 * 内联图标集（不引第三方图标库）。
 *
 * 为什么手写：控制台只用到十来个线条图标，引一个 300KB 的图标包不值得；
 * 而且企业后台要求「线性、克制、统一线宽」，手写 1.5px stroke 更容易保持一致。
 * 所有图标统一 24 视窗、currentColor 描边，尺寸由 className 控制。
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Base>
);

export const IconGraph = (p: IconProps) => (
  <Base {...p}>
    <circle cx="5" cy="6" r="2.5" />
    <circle cx="19" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M7.5 6h9M6.4 8.2 10.6 16M17.6 8.2 13.4 16" />
  </Base>
);

export const IconAgent = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="7" width="16" height="12" rx="3" />
    <path d="M12 3v4M9 13h.01M15 13h.01M9.5 16.5h5" />
  </Base>
);

export const IconBrain = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 5 13v.5A3.5 3.5 0 0 0 8.5 20H12V4H9Z" />
    <path d="M15 4a3 3 0 0 1 3 3v.5A3 3 0 0 1 19 13v.5a3.5 3.5 0 0 1-3.5 3.5H12" />
  </Base>
);

export const IconBook = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
    <path d="M19 18v3H6.5" />
  </Base>
);

export const IconChat = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H9L4 22l1.2-4.2A7.5 7.5 0 1 1 20 12Z" />
    <path d="M9 11h.01M12.5 11h.01M16 11h.01" />
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5" />
  </Base>
);

export const IconSave = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 4h11l3 3v13H5V4Z" />
    <path d="M8 4v5h7V4M8 20v-6h8v6" />
  </Base>
);

export const IconPlay = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 5.5 18 12 7 18.5v-13Z" />
  </Base>
);

export const IconRefresh = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
    <path d="M4 4v4.5h4.5M20 20v-4.5h-4.5" />
  </Base>
);

export const IconChevron = (p: IconProps) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 13 4.5 4.5L19 7" />
  </Base>
);

export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const IconAlert = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4 3 19h18L12 4Z" />
    <path d="M12 10v4M12 17h.01" />
  </Base>
);

export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Base>
);

export const IconRocket = (p: IconProps) => (
  <Base {...p}>
    <path d="M13.5 4c3.5.5 6 3 6.5 6.5-1.8 3.6-5.3 6.5-9 8l-3-3c1.5-3.7 4.4-7.2 8-9Z" />
    <circle cx="14.5" cy="9.5" r="1.6" />
    <path d="M9 15l-4 4M7 12l-3 1 1-3M12 17l-1 3 3-1" />
  </Base>
);

export const IconHistory = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" />
    <path d="M12 8v4.5l3 1.8" />
  </Base>
);

export const IconArrowRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);

export const IconLayers = (p: IconProps) => (
  <Base {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Base>
);

export const IconSettings = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
  </Base>
);

export const IconSparkle = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9 12 3.5Z" />
    <path d="m18.4 16.4.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" />
  </Base>
);
