import type { ReactNode } from "react";

/**
 * Temp mount for the new-visitor intro + hook (FLAG-58 step 1; the `/` router wires it
 * into new-vs-returning in the separate step). Loads Fraunces + Instrument Sans by name
 * so the ported start-screen CSS (which references them literally) renders faithfully.
 */
export default function StartLayout({ children }: { children: ReactNode }) {
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
