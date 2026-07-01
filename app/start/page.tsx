import { StartScreen } from "./StartScreen";

/** Temporary route for the new-visitor intro + hook — the `/` router (separate ticket)
 *  will render <StartScreen /> for first-time visitors once the old landing is removed. */
export default function StartPage() {
  return <StartScreen />;
}
