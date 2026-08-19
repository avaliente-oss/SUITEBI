import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "DAVALSY Suite | Centro de control",
  description:
    "Lobby de soluciones empresariales DAVALSY con acceso gobernado por Supabase.",
  openGraph: {
    title: "DAVALSY Business Suite",
    description: "Tu negocio, en un solo lugar.",
    type: "website",
    locale: "es_MX",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "DAVALSY Business Suite" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DAVALSY Business Suite",
    description: "Tu negocio, en un solo lugar.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/davalsy-icon.png",
    shortcut: "/davalsy-icon.png",
    apple: "/davalsy-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${sora.variable} ${inter.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
