import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./auth.css";
import "./case-workspace.css";
import "./chat-screen.css";
import "./client-design.css";
import "./role-design.css";
import "./workspace-design.css";

export const metadata: Metadata = {
  title: "Современная защита | Рабочее пространство",
  description: "Клиентский кабинет и рабочие разделы юридической компании",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f6f8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="product-ui">{children}</body>
    </html>
  );
}
