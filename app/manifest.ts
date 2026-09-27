import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BillTrack",
    short_name: "BillTrack",
    description:
      "Stay ahead of cards, insurance, rent, utilities and recurring bills.",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f2",
    theme_color: "#14231d",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}