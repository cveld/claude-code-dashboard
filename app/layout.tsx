import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ScreenDimensions } from "./components/ScreenDimensions";
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
  title: "Claude Session Browser",
  description: "Browse Claude Code sessions and transcripts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        {children}
        {process.env.NODE_ENV === 'development' && <ScreenDimensions />}
      </body>
    </html>
  );
}
