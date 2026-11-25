import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PENS SPK — PID DC Motor Speed Controller",
  description:
    "Real-Time PID Controller Telemetry & Tuning Dashboard untuk Modul Praktikum Sistem Pengaturan Komputer (PENS)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="min-h-screen antialiased selection:bg-blue-100 selection:text-blue-950">
        {children}
      </body>
    </html>
  );
}
