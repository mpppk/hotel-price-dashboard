import type { Metadata } from "next";
import "./globals.css";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "一休 Price Observatory | ザ・リッツ・カールトン日光",
  description: "一休のホテル宿泊料金の現在値と観測履歴を可視化するダッシュボード",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
