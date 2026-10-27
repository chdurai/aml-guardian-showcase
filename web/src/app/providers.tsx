"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

const theme = createTheme({
  palette: { primary: { main: "#146b60" }, background: { default: "#f4f6f8" }, text: { primary: "#20333d", secondary: "#667880" } },
  typography: { fontFamily: "Arial, Helvetica, sans-serif", button: { textTransform: "none", fontWeight: 600 } },
  shape: { borderRadius: 10 },
  components: { MuiButton: { defaultProps: { disableElevation: true } } },
});
export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }));
  return <ThemeProvider theme={theme}><CssBaseline /><QueryClientProvider client={client}>{children}</QueryClientProvider></ThemeProvider>;
}
