import type { MetadataRoute } from "next";

// PWA (bonus): installable on phones and desktops; served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HCM Lite",
    short_name: "HCM Lite",
    description: "AI-assisted HR: check in, leave, payslips and dashboards for Admin, HR and Employees",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f766e",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Check in", url: "/attendance", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Apply for leave", url: "/leave", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
