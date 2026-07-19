import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "爆款制造机 · AI 小红书起号台",
  description: "用 Gemini 热点搜索与内容拆解，快速生成小红书创作方向。",
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
