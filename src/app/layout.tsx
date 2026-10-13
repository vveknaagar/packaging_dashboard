import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Mayave Item Transfer',
    template: '%s · Mayave Item Transfer',
  },
  description: 'Packaging material stock and transfers across the warehouse and stores.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#a51c30',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // No cookie means the user has not chosen, and the stylesheet follows the device setting.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // The toggle changes data-theme in the browser, so React must not treat that as a mismatch.
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
