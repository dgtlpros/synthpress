import { ImageResponse } from "next/og";

// iOS Home Screen icon. Next.js detects this filename automatically and emits
// the right `<link rel="apple-touch-icon">` tag.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Brand colors mirror the gradients in
// `apps/web/public/synthpress-logo-icon.svg`. Rebuilt as div-with-gradients
// because Satori (the renderer behind ImageResponse) doesn't support the
// complex SVG filters/glow effects in the source logo.
const BODY_GRADIENT =
  "linear-gradient(135deg, #4C19DB 0%, #2467FF 50%, #16D8EF 100%)";
const VISOR_GRADIENT =
  "radial-gradient(circle at 50% 35%, #171C5F 0%, #090E3B 55%, #03051E 100%)";
const ANTENNA_GRADIENT = "linear-gradient(to bottom, #ED42F4 0%, #1842DE 100%)";
const ORB_GRADIENT =
  "radial-gradient(circle at 40% 40%, #FF7BFF 0%, #D72DFF 50%, #414BFF 100%)";
const LEFT_EYE_GRADIENT =
  "radial-gradient(circle at 50% 40%, #D8FFFF 0%, #58DDFF 45%, #1078FF 100%)";
const RIGHT_EYE_GRADIENT =
  "radial-gradient(circle at 50% 40%, #FFD6FF 0%, #C755FF 45%, #6721FF 100%)";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: BODY_GRADIENT,
      }}
    >
      {/* Orb */}
      <div
        style={{
          position: "absolute",
          top: 6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 22,
          height: 22,
          borderRadius: 11,
          background: ORB_GRADIENT,
        }}
      />
      {/* Antenna */}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: "50%",
          transform: "translateX(-50%)",
          width: 8,
          height: 18,
          borderRadius: 4,
          background: ANTENNA_GRADIENT,
        }}
      />
      {/* Visor band */}
      <div
        style={{
          position: "absolute",
          top: 70,
          left: 26,
          right: 26,
          height: 52,
          borderRadius: 26,
          background: VISOR_GRADIENT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            background: LEFT_EYE_GRADIENT,
          }}
        />
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            background: RIGHT_EYE_GRADIENT,
          }}
        />
      </div>
    </div>,
    { ...size },
  );
}
