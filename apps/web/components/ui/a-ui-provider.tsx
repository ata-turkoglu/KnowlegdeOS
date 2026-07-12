"use client";

import { PrimeReactProvider } from "primereact/api";
import type { ReactNode } from "react";

type AUiProviderProps = {
  children: ReactNode;
};

export function AUiProvider({ children }: AUiProviderProps) {
  return <PrimeReactProvider>{children}</PrimeReactProvider>;
}
