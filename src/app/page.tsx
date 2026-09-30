import Link from "next/link";
import { NetworkBanner } from "@/components/network-banner";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

// Calls to action. Set `href` when the target page exists; until then the
// button renders as disabled so the landing page never links to a missing page.
const CTAS = {
  merchant: { label: "Open merchant dashboard", href: "/dashboard" as string | null },
  demo: { label: "Try a demo payment", href: null as string | null },
};

const STEPS = [
  { title: "Create an invoice", body: "Set the amount, order ID and expiry. A unique payment reference is generated for the invoice." },
  { title: "Share the QR code", body: "The customer scans a Solana Pay QR code or opens the checkout link on any device." },
  { title: "Customer pays in USDC", body: "The customer approves the transfer in their own wallet. Funds go directly to your wallet." },
  { title: "Verified on-chain", body: "The backend confirms the transfer independently. The invoice shows Confirming, then Paid once finalized." },
];

const CHECKS = [
  ["Recipient", "Funds arrived in the merchant's wallet"],
  ["Token", "Circle's official USDC mint, from a server-side allowlist"],
  ["Amount", "Exact match in integer base units: no floating point"],
  ["Reference", "The unique reference tied to this invoice"],
  ["Finality", "Paid only after finalized commitment"],
  ["Uniqueness", "One transaction can settle only one invoice"],
] as const;

const TECH = [
  ["Solana", "Fast, low-fee settlement"],
  ["USDC", "Circle's dollar stablecoin"],
  ["Solana Pay", "Open payment request standard"],
  ["Wallet Standard", "Phantom, Solflare and other wallets"],
  ["Next.js + TypeScript", "Strictly typed web app and API"],
  ["PostgreSQL", "Relational ledger of invoices and payments"],
] as const;

function Cta({ label, href, primary }: { label: string; href: string | null; primary?: boolean }) {
  const style = primary
    ? "bg-slate-900 text-white hover:bg-slate-800"
    : "border border-slate-300 text-slate-900 hover:bg-slate-50";
  const base = "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium";

  if (href) {
    return <Link href={href} className={`${base} ${style}`}>{label}</Link>;
  }
  return (
    <span aria-disabled className={`${base} ${style} cursor-not-allowed opacity-60`}>
      {label}
      <span className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${primary ? "bg-white/15" : "bg-slate-100"}`}>
        Soon
      </span>
    </span>
  );
}

function ExampleInvoice() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Example invoice</p>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
          Paid
        </span>
      </div>
      <p className="mt-4 font-mono text-sm text-slate-500">INV-2026-00001</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">
        10.00 <span className="text-lg font-medium text-slate-500">USDC</span>
      </p>
      <p className="mt-1 text-sm text-slate-600">Laptop accessory purchase</p>

      <dl className="mt-6 space-y-2 border-t border-slate-100 pt-4 text-sm">
        <div className="flex justify-between"><dt className="text-slate-500">Order</dt><dd className="font-mono">ORDER-10001</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">Recipient</dt><dd className="font-mono">7xKX…92Ab</dd></div>
      </dl>

      <ol className="mt-6 grid grid-cols-3 gap-2 text-xs">
        {["Pending", "Confirming", "Paid"].map((state) => (
          <li key={state} className="border-t-2 border-emerald-600 pt-2 text-slate-700">{state}</li>
        ))}
      </ol>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <NetworkBanner />
      <SiteHeader />

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-24">
          <div>
            <p className="text-sm font-medium text-teal-700">USDC payments for merchants</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Accept USDC with a QR code. Settle straight to your wallet.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Create an invoice, share a Solana Pay QR code, and let customers pay from their own wallet.
              Every payment is verified on-chain before it is marked paid.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Cta {...CTAS.merchant} primary />
              <Cta {...CTAS.demo} />
            </div>
          </div>
          <ExampleInvoice />
        </section>

        <section id="how-it-works" className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="rounded-xl border border-slate-200 bg-white p-5">
                  <span className="font-mono text-sm text-teal-700">0{i + 1}</span>
                  <h3 className="mt-2 font-medium">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="verification" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Paid means verified</h2>
              <p className="mt-3 text-slate-600">
                A wallet saying &ldquo;sent&rdquo; is not proof of payment. The server reads the transaction from the
                blockchain itself and checks every field before an invoice changes state.
              </p>
            </div>
            <dl className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
              {CHECKS.map(([name, detail]) => (
                <div key={name} className="bg-white p-5">
                  <dt className="font-medium">{name}</dt>
                  <dd className="mt-1 text-sm text-slate-600">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="technology" className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Built on open standards</h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TECH.map(([name, detail]) => (
                <li key={name} className="rounded-xl border border-slate-200 bg-white p-5">
                  <p className="font-medium">{name}</p>
                  <p className="mt-1 text-sm text-slate-600">{detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
