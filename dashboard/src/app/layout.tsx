import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PENS SPK — PID DC Motor Speed Controller",
  description:
    "Real-Time PID Controller Telemetry & Tuning Dashboard untuk Modul Praktikum Sistem Pengaturan Komputer (PENS)",
};

// Blocking FOUC-prevention script: syncs stored override to <meta name="color-scheme"> before first paint
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("color-scheme");if(s==="light"||s==="dark"){var m=document.querySelector('meta[name="color-scheme"]');if(m)m.content=s;}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-screen antialiased selection:bg-[var(--selection-bg)] selection:text-[var(--selection-ink)]"
      >
        {children}
      </body>
    </html>
  );
}
