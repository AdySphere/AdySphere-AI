import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Sales Sphere", description: "AdySphere lead generation and outreach" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>Sales Sphere</strong>
          <Link href="/">Dashboard</Link>
          <Link href="/campaigns">Campaigns</Link>
          <Link href="/review">Review queue</Link>
          <Link href="/settings">Settings</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
