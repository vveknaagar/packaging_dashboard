import type { MetadataRoute } from 'next';

/** Lets phones add the app to the home screen and open it full screen, like an installed app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mayave Item Transfer',
    short_name: 'Mayave',
    description: 'Packaging material stock and transfers across the warehouse and stores.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#a51c30',
    theme_color: '#a51c30',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
