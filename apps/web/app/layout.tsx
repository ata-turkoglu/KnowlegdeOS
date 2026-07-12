import type { Metadata } from "next";
import "primereact/resources/themes/saga-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import { AUiProvider } from "../components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "KnowledgeOS",
  description: "Local-first archive and knowledge management"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>
        <AUiProvider>{children}</AUiProvider>
      </body>
    </html>
  );
}
