import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bitMini6 = localFont({
  src: "../public/fonts/bitMini6.ttf",
  variable: "--font-bitmini6-face",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "Dofus1 registry",
  description: "Dofus 1.29.X reusable components for any React UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bitMini6.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
