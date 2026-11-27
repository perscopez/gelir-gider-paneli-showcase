import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#18181b", color: "#fafafa", fontSize: 180 * 0.5, fontWeight: 700 }}>
        €
      </div>
    ),
    size,
  );
}
