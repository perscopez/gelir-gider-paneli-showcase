import type { MetadataRoute } from "next";

// Telefonda "Ana ekrana ekle" ile uygulama gibi açılır.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gelir Gider", short_name: "Gelir Gider", description: "Kişisel gelir gider paneli",
    start_url: "/", display: "standalone", background_color: "#0a0a0a", theme_color: "#0a0a0a",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }, { src: "/apple-icon", sizes: "180x180", type: "image/png" }],
  };
}
