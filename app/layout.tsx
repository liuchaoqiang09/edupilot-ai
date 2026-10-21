import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EduPilot AI",
  description: "面向小型培训机构的教学与日常管理平台",
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
