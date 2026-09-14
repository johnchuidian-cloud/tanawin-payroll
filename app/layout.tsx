import type { Metadata } from 'next';
import UpdateBanner from '@/components/UpdateBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tanawin Payroll',
  description: 'Payroll for ASP Bed and Breakfast, Inc — computation, payslips, payouts',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <UpdateBanner />
        {children}
      </body>
    </html>
  );
}
