import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Galaxique - Your Unique Universe",
    short_name: "Galaxique",
    description:
      "Answer a short quiz and watch your unique universe unfold in 3D.",
    start_url: "/",
    display: "standalone",
    background_color: "#080b1c",
    theme_color: "#080b1c",
    icons: [
      {
        src: "/galaxique-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/galaxique-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}