import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AI News Trace — Read less. Verify everything.", description: "AI-powered news summaries with transparent source evidence and claim verification." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
