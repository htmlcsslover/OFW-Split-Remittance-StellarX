import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OFW Guardian Split Remittance — Stellar Testnet",
  description:
    "A Stellar testnet inheritance switch with multi-recipient split remittance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
