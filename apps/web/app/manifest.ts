// The web manifest: the name and icon a phone uses when a reader adds the site to the home screen
// (icons from brand/scripts/render-web-icons.mjs). It stays a browser page: the app is the app.
import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    lang: 'he',
    dir: 'rtl',
    start_url: '/',
    display: 'browser',
    background_color: '#FFFFFF',
    theme_color: '#D9121F',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
