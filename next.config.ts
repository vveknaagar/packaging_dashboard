import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Hide the dev-mode "N" badge; it overlaps the sidebar. Errors still show.
  devIndicators: false,
  // Native and Node-only packages are loaded with require() instead of being bundled.
  serverExternalPackages: ['pg', 'sharp', 'exceljs', 'bcryptjs'],
  experimental: {
    serverActions: {
      // Item images may be up to 2 MB; leave room for the rest of the form.
      bodySizeLimit: '4mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // The transfer page downloads the delivery challan through a hidden frame of this page.
        source: '/transfers/:id/slip',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
    ];
  },
};

export default nextConfig;
