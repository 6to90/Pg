import type { ReactNode } from 'react';

export const metadata = { title: 'Payment Gateway (TESTNET)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ background: '#fde68a', padding: '6px 16px', fontWeight: 600 }}>
          TESTNET – test tokens have no value
        </div>
        <main style={{ padding: 16 }}>{children}</main>
      </body>
    </html>
  );
}
