import '@/styles/globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata = {
  title:       'UpperCrust Saarthi — PMS Terminal',
  description: 'Portfolio Management System'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: '#1a1610',
              color: '#f0d060',
              fontFamily: 'Inter, sans-serif',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '20px',
              padding: '9px 18px'
            }
          }}
        />
      </body>
    </html>
  );
}
