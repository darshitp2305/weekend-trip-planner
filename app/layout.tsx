/**
 * Root app layout used by every route.
 * It establishes the shared HTML shell, metadata, and top-level wrappers that the rest of the application renders inside.
 */

import type { Metadata } from "next";
import ThemeToggle from "../components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trippify | Trip planning",
  description:
    "Trippify helps you find ranked trips based on budget, drive time, dates, and travel style.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/branding/trippify-icon-white.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var stored=localStorage.getItem("trippify-theme");var theme=stored==="dark"?"dark":"light";document.documentElement.classList.toggle("dark",theme==="dark");document.documentElement.style.colorScheme=theme;}catch(e){}})();`,
          }}
        />
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
