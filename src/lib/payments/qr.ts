import "server-only";
import QRCode from "qrcode";

// QR code for a payment link, as an SVG string rendered on the server (no browser
// JavaScript needed). Error correction "M" survives ~15% damage or glare.
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
}
