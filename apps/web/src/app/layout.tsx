import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: [
    { path: "./fonts/manrope-latin-400.woff2", weight: "400" },
    { path: "./fonts/manrope-latin-500.woff2", weight: "500" },
    { path: "./fonts/manrope-latin-600.woff2", weight: "600" },
    { path: "./fonts/manrope-latin-700.woff2", weight: "700" },
    { path: "./fonts/manrope-latin-800.woff2", weight: "800" },
  ],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Tevah", template: "%s · Tevah" },
  description: "The GST-native ERP for growing Indian businesses",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = { themeColor: "#A3142B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
