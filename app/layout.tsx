import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Cow",
  description: "A cow. Poke it and find out.",
};

/**
 * Phone settings, all of them for the same reason: this is a game in a browser
 * tab, and a browser tab defaults to behaving like a document.
 *
 * `viewportFit: "cover"` is the important one — it lets the canvas run under
 * the notch and the home indicator, and turns on the `env(safe-area-inset-*)`
 * values the HUD uses to keep the controls out from under them. Pinch-zoom is
 * off because a two-finger pinch is the camera zoom, and `interactiveWidget`
 * stops an on-screen keyboard from resizing the world if one ever appears.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* `overscroll-none` kills pull-to-refresh, which on a phone otherwise
          fires every time you push the thumb stick forward. */}
      <body className="flex min-h-full flex-col overscroll-none">{children}</body>
    </html>
  );
}
