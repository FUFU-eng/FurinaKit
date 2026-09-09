import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          background: "linear-gradient(135deg, #1e40af, #38bdf8 55%, #bae6fd)",
        }}
      >
        {/* 2×2 module mark */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", gap: 2 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: "#fff" }} />
            <div style={{ width: 7, height: 7, borderRadius: 2, background: "rgba(255,255,255,0.6)" }} />
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: "rgba(255,255,255,0.6)" }} />
            <div style={{ width: 7, height: 7, borderRadius: 7, background: "#fff" }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
