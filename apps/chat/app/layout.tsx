import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "天气助手",
  description: "中文天气助手聊天界面",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
