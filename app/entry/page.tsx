import { ReturningScreen } from "./ReturningScreen";

/** Temporary route for the returning screen — the `/` router (separate ticket) will
 *  render <ReturningScreen /> for returning visitors once the old landing is removed. */
export default function EntryPage() {
  return <ReturningScreen />;
}
