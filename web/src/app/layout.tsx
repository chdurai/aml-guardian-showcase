import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";

export const metadata: Metadata = {
  title: "AML Guardian · Investigation workbench",
  description: "An evidence-first AML investigation workspace. Local synthetic data only.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppRouterCacheProvider><Providers>{children}</Providers></AppRouterCacheProvider></body></html>;
}
