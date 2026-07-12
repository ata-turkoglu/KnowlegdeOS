"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type PlatformLanguage = "tr" | "en";

type LanguageContextValue = {
  language: PlatformLanguage;
  setLanguage: (language: PlatformLanguage) => void;
};

const storageKey = "knowledgeos-platform-language";
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<PlatformLanguage>("tr");
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem(storageKey);

    if (savedLanguage === "tr" || savedLanguage === "en") {
      setLanguageState(savedLanguage);
    }

    setHasLoadedPreference(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;

    if (hasLoadedPreference) {
      window.localStorage.setItem(storageKey, language);
    }
  }, [hasLoadedPreference, language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage: setLanguageState }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider.");
  }

  return context;
}
