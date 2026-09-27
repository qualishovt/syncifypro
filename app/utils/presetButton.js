/**
 * utils/presetButton.js
 *
 * Which of the two preset buttons to show, and whether it carries the star.
 * Only ever one at a time, and only when there is something to save:
 *
 *   picked \ page   | matches the preset | drifted from it
 *   ----------------|--------------------|-----------------
 *   no preset       | —                  | Save as *
 *   latest export   | Save as            | Save as *
 *   a saved preset  | —                  | Update
 *
 * "Latest export" offers a plain Save as even unchanged, because it is the
 * one entry a merchant may want to keep under a name of their own.
 */
export function presetButton({ picked, dirty }) {
  if (picked === "saved") return dirty ? "update" : null;
  if (picked === "latest") return dirty ? "saveAsStar" : "saveAs";
  return dirty ? "saveAsStar" : null;
}
