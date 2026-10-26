import type { Metadata } from "next";
import "./globals.css";
import "./auth.css";
import "./case-workspace.css";
import "./chat-screen.css";
import "./client-design.css";
import "./role-design.css";

export const metadata: Metadata = {
  title: "Современная защита | Рабочее пространство",
  description: "Клиентский кабинет и рабочие разделы юридической компании",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="product-ui">{children}</body>
    </html>
  );
}
