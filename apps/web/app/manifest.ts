import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DAVALSY Suite",
    short_name: "DAVALSY",
    description: "Centro de control DAVALSY: soluciones, KPIs y accesos de tu organización.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#F5F6F4",
    theme_color: "#006D77",
    lang: "es-MX",
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
