/**
 * Upload cap (FLAG-27). Pure selection-completion enforcement of MAX_IMAGES,
 * shared by BOTH upload entry points — the file picker and drag-drop — so a
 * drop can never bypass the cap the picker enforces. Returns the kept files
 * plus a calm (non-error) over-selection note.
 */
export function capFiles<T>(
  items: T[],
  room: number,
  max: number,
): { kept: T[]; notice: string } {
  if (room <= 0) {
    return { kept: [], notice: `You're at the max of ${max} — remove one to swap in another.` };
  }
  const kept = items.slice(0, room);
  const notice =
    items.length > room
      ? `Kept ${room} of ${items.length} — that's the max of ${max}. Longer conversation? Paste the text instead.`
      : "";
  return { kept, notice };
}
