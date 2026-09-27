/**
 * import/autoPlan.js
 *
 * The file's own reading of itself: every sheet the analysis recognised is
 * included as the entity it detected, and anything it could not place waits
 * to be told what it is ("auto", not imported). This is the plan the Import
 * page starts from, the one "New Import" returns to, and the one a preset
 * replaces wholesale.
 */
export function autoPlan(preview) {
  return (preview?.sheets ?? []).map((s) => ({
    entity: s.ok ? s.entity : "auto",
    include: Boolean(s.ok),
  }));
}
