import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Klaro — Alternative Credit Scoring',
    template: '%s · Klaro',
  },
  description:
    'Klaro — alternative credit scoring for Tunisia. KYC, bank insights, and an AI advisor that knows you better than you know yourself.',
  applicationName: 'Klaro',
  keywords: ['credit score', 'Tunisia', 'fintech', 'KYC', 'AI advisor'],
  authors: [{ name: 'Klaro' }],
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    title: 'Klaro — Alternative Credit Scoring',
    description: 'Your real financial story. Scored fairly. Explained clearly.',
    type: 'website',
    locale: 'en_US',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
