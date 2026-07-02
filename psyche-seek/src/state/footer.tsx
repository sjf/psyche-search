import { ReactNode, createContext, useContext, useMemo, useState } from "react";

interface FooterContextValue {
  content: ReactNode | null;
  setContent: (content: ReactNode | null) => void;
}

const FooterContext = createContext<FooterContextValue | null>(null);

export function FooterProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);

  const value = useMemo(() => ({ content, setContent }), [content]);

  return <FooterContext.Provider value={value}>{children}</FooterContext.Provider>;
}

export function useFooter() {
  const context = useContext(FooterContext);
  if (!context) {
    throw new Error("useFooter must be used within FooterProvider");
  }
  return context;
}
