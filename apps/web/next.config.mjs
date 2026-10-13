// Image CDN hosts allowed for next/image, comma-separated (e.g. "media.example.co.il").
const imageHosts = (process.env.IMAGE_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').origin;
// Where uploaded and AI images are served (the API in development, a CDN in production).
const media = new URL(process.env.NEXT_PUBLIC_MEDIA_URL ?? `${apiOrigin}/media`);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace package shipped as TypeScript source.
  transpilePackages: ['@b4/shared'],
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
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
              "script-src 'self' 'unsafe-inline' https://s3.tradingview.com" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
              "style-src 'self' 'unsafe-inline'",
              'frame-src https://www.tradingview-widget.com https://s.tradingview.com',
              `img-src 'self' data: blob: ${media.origin} ${imageHosts.map((h) => `https://${h}`).join(' ')}`.trim(),
              "font-src 'self'",
              `connect-src 'self' ${apiOrigin}`,
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
