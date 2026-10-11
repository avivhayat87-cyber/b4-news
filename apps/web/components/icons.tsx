import type { ReactNode, SVGProps } from 'react';
import type { SocialKey } from '@/lib/site';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, strokeWidth = 2, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  };
}

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
);

export const PhotoIcon = (p: IconProps) => (
  <svg {...base({ strokeWidth: 1.4, ...p })}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5.5-5.5L7 19" /></svg>
);

export const ChevronRight = (p: IconProps) => (
  <svg {...base({ strokeWidth: 2.2, ...p })}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></svg>
);

export const ChevronLeft = (p: IconProps) => (
  <svg {...base({ strokeWidth: 2.2, ...p })}><path d="m14.5 5.5-6.5 6.5 6.5 6.5" /></svg>
);

export const PlayIcon = (p: IconProps) => (
  <svg {...base({ stroke: 'none', ...p })}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
);

export const PersonIcon = (p: IconProps) => (
  <svg {...base({ strokeWidth: 1.6, ...p })}><circle cx="12" cy="9" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></svg>
);

export const LinkIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
);

const socialPaths: Record<SocialKey, ReactNode> = {
  facebook: <path d="M15 3.5h-2.2A3.3 3.3 0 0 0 9.5 6.8V21M6.5 10.5h7.5" />,
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  telegram: (
    <>
      <path d="M20.5 4.5 3.5 11.2l5.8 2.1 2.2 6.2 3.2-3.9 4.6 3.4z" />
      <path d="m9.3 13.3 11.2-8.8" />
    </>
  ),
  whatsapp: <path d="M4.5 19.5l1.2-3.7a7.8 7.8 0 1 1 2.6 2.5z" />,
  x: <path d="M5 4.5l14 15M19 4.5l-14 15" />,
  tiktok: (
    <>
      <path d="M13.5 4v10.6a3.4 3.4 0 1 1-3.4-3.4" />
      <path d="M13.5 4c.4 2.4 2.3 4.3 4.9 4.6" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.8" y="6" width="18.4" height="12" rx="3.5" />
      <path d="M10.3 9.6v4.8l4.1-2.4z" fill="currentColor" stroke="none" />
    </>
  ),
};

export const SocialIcon = ({ name, ...p }: IconProps & { name: SocialKey }) => (
  <svg {...base(p)}>{socialPaths[name]}</svg>
);
