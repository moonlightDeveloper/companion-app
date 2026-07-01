import type { ReactNode } from "react";

/**
 * Temp mount for the returning screen (this whole entry line lands under `/` via the
 * separate router ticket). Loads Fraunces + Instrument Sans by name so the ported
 * entry-screen CSS (which references them literally) renders faithfully.
 */
export default function EntryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Instrument+Sans:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
