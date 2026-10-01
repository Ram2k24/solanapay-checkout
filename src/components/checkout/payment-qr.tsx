import { qrSvg } from "@/lib/payments/qr";

// Server component: the QR code is rendered on the server as SVG from a payment
// link we built ourselves (no user-supplied markup).
export async function PaymentQr({ url, size = 240 }: { url: string; size?: number }) {
  const svg = await qrSvg(url);
  return (
    <div
      role="img"
      aria-label="Solana Pay QR code"
      style={{ width: size, height: size }}
      className="rounded-xl border border-slate-200 bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
