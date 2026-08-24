import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

/*
 * The font pipeline, repaired (audit F1).
 *
 * The product previously downloaded two webfonts and then discarded them: a
 * trailing `body { font-family: Arial }` in `globals.css` won over the loaded
 * faces, so the shipped typeface was Arial.
 *
 * Both faces are Be Community's own voices, and both are SELF-HOSTED: Next
 * downloads them at build time and serves them from the application's origin,
 * so `font-src 'self'` is satisfied without relaxing the CSP and without a
 * runtime request to any third party.
 */
const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "sans-serif"],
});

const text = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: "Be Community",
    template: "%s · Be Community",
  },
  description:
    "Resultados de tu comunidad: qué pasó, qué significa y qué mirar después.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // The product is entirely in Spanish (audit F2). Screen readers were
      // applying English phonemes to every word on every screen.
      lang="es"
      className={`${display.variable} ${text.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#contenido"
          className="sr-only rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
