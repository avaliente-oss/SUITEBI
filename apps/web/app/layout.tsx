import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ServiceWorkerRegister } from "@/components/sw-register";

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
    icon: "/icon-512.png",
    shortcut: "/icon-512.png",
    apple: "/icon-512.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DAVALSY",
  },
  other: {
    // Next.js sólo emite el meta "mobile-web-app-capable" moderno; Safari
    // en iOS todavía requiere el prefijo "apple-" para abrir en standalone
    // (sin barra de navegador) al agregarlo a la pantalla de inicio.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F6F4" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1111" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${sora.variable} ${inter.variable}`}>
      <body>
        <ServiceWorkerRegister />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
