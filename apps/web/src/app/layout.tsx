import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/atoms/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const APP_DESCRIPTION =
  "AI-powered content generation and publishing platform for WordPress sites.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "SynthPress",
    template: "%s · SynthPress",
  },
  description: APP_DESCRIPTION,
  applicationName: "SynthPress",
  openGraph: {
    title: "SynthPress",
    description: APP_DESCRIPTION,
    url: APP_URL,
    siteName: "SynthPress",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "SynthPress",
    description: APP_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
