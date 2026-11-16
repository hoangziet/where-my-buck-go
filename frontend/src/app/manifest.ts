import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Where My Buck Go",
    short_name: "WMBG",
    description: "AI personal finance manager — chat your expenses, snap receipts, ask questions.",
    start_url: "/",
    display: "standalone",
    background_color: "#FBFAF6",
    theme_color: "#1F6B44",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
