import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="3.5" width="7.5" height="9" rx="1.5" />
    <rect x="13" y="3.5" width="7.5" height="5.5" rx="1.5" />
    <rect x="13" y="11" width="7.5" height="9.5" rx="1.5" />
    <rect x="3.5" y="14.5" width="7.5" height="6" rx="1.5" />
  </Base>
);

export const IconUpload = (p: P) => (
  <Base {...p}>
    <path d="M12 16V4.5" />
    <path d="M6.5 9.5 12 4l5.5 5.5" />
    <path d="M4 19.5h16" />
  </Base>
);

export const IconSchedule = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9v4l3 2" />
    <path d="M9.5 3h5" />
  </Base>
);

export const IconHistory = (p: P) => (
  <Base {...p}>
    <path d="M4.5 5.5v4h4" />
    <path d="M4.8 9.2a8 8 0 1 1-.9 6.3" />
    <path d="M12 8v4.5l3 1.8" />
  </Base>
);

export const IconAnalytics = (p: P) => (
  <Base {...p}>
    <path d="M4 20h16" />
    <path d="M7 16v-5" />
    <path d="M12 16V7" />
    <path d="M17 16v-3" />
  </Base>
);

export const IconAccounts = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="5" cy="6" r="2.2" />
    <circle cx="19" cy="6" r="2.2" />
    <circle cx="12" cy="19.5" r="2.2" />
    <path d="m6.7 7.4 3.2 2.8M17.3 7.4l-3.2 2.8M12 15.4v1.9" />
  </Base>
);

export const IconSettings = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v3M12 18.2v3M4.1 7.4l2.6 1.5M17.3 15.1l2.6 1.5M4.1 16.6l2.6-1.5M17.3 8.9l2.6-1.5" />
  </Base>
);

export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);

export const IconCross = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const IconInfo = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <path d="M12 7.5v.3" />
  </Base>
);

export const IconWarning = (p: P) => (
  <Base {...p}>
    <path d="M12 4 3.5 19h17L12 4Z" />
    <path d="M12 10v4" />
    <path d="M12 16.5v.3" />
  </Base>
);

export const IconPlay = (p: P) => (
  <Base {...p}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  </Base>
);

export const IconTrash = (p: P) => (
  <Base {...p}>
    <path d="M5 7h14" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M7 7l.8 13h8.4L17 7" />
  </Base>
);

export const IconLink = (p: P) => (
  <Base {...p}>
    <path d="M9.5 14.5 14.5 9.5" />
    <path d="M11 6.5 13 4.5a3.5 3.5 0 0 1 5 5L16 11.5" />
    <path d="M13 17.5 11 19.5a3.5 3.5 0 0 1-5-5L8 12.5" />
  </Base>
);

export const IconCalendar = (p: P) => (
  <Base {...p}>
    <rect x="4" y="5.5" width="16" height="15" rx="1.5" />
    <path d="M4 10h16" />
    <path d="M9 3.5v4M15 3.5v4" />
  </Base>
);

export const IconLogout = (p: P) => (
  <Base {...p}>
    <path d="M14 4.5H6v15h8" />
    <path d="M11 12h9.5" />
    <path d="m17 8.5 3.5 3.5-3.5 3.5" />
  </Base>
);

export const IconMoon = (p: P) => (
  <Base {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
  </Base>
);

export const IconSun = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" />
  </Base>
);

export const IconMenu = (p: P) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);
