import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          background: "linear-gradient(135deg, #1e40af, #38bdf8 55%, #bae6fd)",
        }}
      >
        {/* 2×2 module mark */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff" }} />
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.6)" }} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.6)" }} />
            <div style={{ width: 38, height: 38, borderRadius: 38, background: "#fff" }} />
          </div>
        </div>
        <span
          style={{
            color: "#fff",
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: "0.2em",
            opacity: 0.92,
          }}
        >
          FURINAKIT
        </span>
      </div>
    ),
    { ...size },
  );
}
