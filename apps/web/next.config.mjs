// Image CDN hosts allowed for next/image, comma-separated (e.g. "media.example.co.il").
const imageHosts = (process.env.IMAGE_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').origin;
// Google AdSense (components/google-ad.tsx): its script, the frames its ads draw in, and the
// requests and pixels they make. Loaded only while Google ads are on in the CMS and the reader agreed
// to advertising cookies; allowing the hosts loads nothing by itself. Google changes these hosts
// now and then: when ads go quiet, the browser console names the blocked one.
const google = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://*.adtrafficquality.google',
  'https://www.google.com',
  'https://*.google.com',
  'https://*.google.co.il',
  'https://*.gstatic.com',
].join(' ');
// Cloudflare Web Analytics (app/layout.tsx): its beacon script and where it reports. Loaded only once
// its token is set in the CMS.
const cloudflareInsights = { script: 'https://static.cloudflareinsights.com', report: 'https://cloudflareinsights.com' };
// Where uploaded and AI images are served (the API in development, a CDN in production).
const media = new URL(process.env.NEXT_PUBLIC_MEDIA_URL ?? `${apiOrigin}/media`);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace package shipped as TypeScript source.
  transpilePackages: ['@b4/shared'],
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md here on every run (the docs it points at stay in node_modules/next/dist/docs).
  agentRules: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    // Next 16 won't fetch images from a local address unless told to. On this computer (the
    // workshop and the PC's live site) the media come from the API on localhost; in the cloud
    // they come from the bucket's domain and this stays off.
    dangerouslyAllowLocalIP: ['localhost', '127.0.0.1', '[::1]'].includes(media.hostname),
    remotePatterns: [
      ...imageHosts.map((hostname) => ({ protocol: 'https', hostname })),
      { protocol: media.protocol.replace(':', ''), hostname: media.hostname, port: media.port, pathname: `${media.pathname.replace(/\/$/, '')}/**` },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js inlines its bootstrap scripts and styles. TradingView: the market widgets'
              // loader script, and the iframes it creates (with s.tradingview.com as its fallback).
              `script-src 'self' 'unsafe-inline' https://s3.tradingview.com ${cloudflareInsights.script} ${google}` + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
              "style-src 'self' 'unsafe-inline'",
              `frame-src https://www.tradingview-widget.com https://s.tradingview.com ${google}`,
              `img-src 'self' data: blob: ${media.origin} ${imageHosts.map((h) => `https://${h}`).join(' ')} ${google}`.trim(),
              "font-src 'self'",
              `connect-src 'self' ${apiOrigin} ${cloudflareInsights.report} ${google}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
