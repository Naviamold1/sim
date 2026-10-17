import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Politics Battle — Election Desk",
  description: "Two candidates. Four years. One election. A live political simulation where every decision moves the electorate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
