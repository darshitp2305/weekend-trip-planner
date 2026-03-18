import type { Metadata } from "next";
import ThemeToggle from "../components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trippify | Weekend trip planning",
  description:
    "Trippify helps you find ranked weekend trips based on budget, drive time, and travel style.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
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
