import { getSession, getSoftUserId } from "@/lib/auth";
import { listPersons } from "@/lib/db";
import { StartScreen } from "./start/StartScreen";
import { ReturningScreen } from "./entry/ReturningScreen";

// Cookie-resolved → per-request (dynamic), never statically cached.
export const dynamic = "force-dynamic";

/**
 * FLAG-58: the entry router. Decides new-vs-returning on the SERVER off the soft-identity
 * cookies (the same signals as /api/me + /api/persons) — so `/` paints the right screen
 * on first request, no client flicker, no hydration mismatch. localStorage is NOT
 * consulted here (it only holds the introSeen gate, read inside StartScreen).
 *
 *   returning = signed-in OR soft-identified OR non-empty roster → ReturningScreen
 *               (an empty roster on a recognized identity → its clean-slate state).
 *   otherwise (genuinely unknown) → StartScreen (intro + hook).
 */
export default async function Home() {
  const [session, softUserId] = await Promise.all([getSession(), getSoftUserId()]);
  // Roster is session-scoped (mirrors /api/persons); a pure soft-user has none yet.
  const persons = session ? await listPersons(session.userId).catch(() => []) : [];
  const returning = !!session || !!softUserId || persons.length > 0;

  return returning ? <ReturningScreen /> : <StartScreen />;
}
