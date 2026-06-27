/**
 * The single source of truth for the screenshot upload limit. Imported by the
 * client (PasteShots — the Continue gate + count) AND the server (the
 * /api/extract route backstop) so the cap can never diverge. Change it here only.
 *
 * Over-selection is NOT auto-sliced: the user can add more than MAX_IMAGES, the
 * count is shown, and Continue stays disabled (with a calm "remove N" note) until
 * they trim back to <= MAX_IMAGES via the per-thumbnail delete. Nothing is
 * silently dropped — the user chooses which screenshots to keep.
 */
export const MAX_IMAGES = 8;
