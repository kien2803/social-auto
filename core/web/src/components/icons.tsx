import type { ComponentType, SVGProps } from 'react';
import {
  IconLayoutDashboard,
  IconCloudUpload,
  IconCalendarTime,
  IconHistory as TbHistory,
  IconChartBar,
  IconUsersGroup,
  IconSettings as TbSettings,
  IconCircleCheck,
  IconX,
  IconInfoCircle,
  IconAlertTriangle,
  IconPlayerPlay,
  IconTrash as TbTrash,
  IconLink as TbLink,
  IconCalendar as TbCalendar,
  IconLogout as TbLogout,
  IconMoon as TbMoon,
  IconSun as TbSun,
  IconMenu2,
  IconBrandYoutube,
  IconBrandTiktok,
  IconBrandInstagram,
  IconBrandFacebook,
  type TablerIcon,
} from '@tabler/icons-react';

// The app previously shipped a hand-drawn set; Tabler was chosen for its
// broadcast-native glyphs (tower-broadcast, brand-*) and consistent line
// work. Export names stay the same so call sites don't change. Wrapped
// components take plain SVG props (className="h-4 w-4" etc.).
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const wrap = (C: TablerIcon): IconComponent => {
  const W = (p: SVGProps<SVGSVGElement>) => (
    <C stroke={1.7} {...(p as Parameters<TablerIcon>[0])} />
  );
  W.displayName = C.displayName;
  return W;
};

export const IconDashboard = wrap(IconLayoutDashboard);
export const IconUpload = wrap(IconCloudUpload);
export const IconSchedule = wrap(IconCalendarTime);
export const IconHistory = wrap(TbHistory);
export const IconAnalytics = wrap(IconChartBar);
export const IconAccounts = wrap(IconUsersGroup);
export const IconSettings = wrap(TbSettings);
export const IconCheck = wrap(IconCircleCheck);
export const IconCross = wrap(IconX);
export const IconInfo = wrap(IconInfoCircle);
export const IconWarning = wrap(IconAlertTriangle);
export const IconPlay = wrap(IconPlayerPlay);
export const IconTrash = wrap(TbTrash);
export const IconLink = wrap(TbLink);
export const IconCalendar = wrap(TbCalendar);
export const IconLogout = wrap(TbLogout);
export const IconMoon = wrap(TbMoon);
export const IconSun = wrap(TbSun);
export const IconMenu = wrap(IconMenu2);
export const IconYouTube = wrap(IconBrandYoutube);
export const IconTikTok = wrap(IconBrandTiktok);
export const IconInstagram = wrap(IconBrandInstagram);
export const IconFacebook = wrap(IconBrandFacebook);
