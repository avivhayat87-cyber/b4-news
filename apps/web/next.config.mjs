// Image CDN hosts allowed for next/image, comma-separated (e.g. "media.example.co.il").
const imageHosts = (process.env.IMAGE_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: imageHosts.map((hostname) => ({ protocol: 'https', hostname })),
  },
};

export default nextConfig;
