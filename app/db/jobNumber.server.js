/**
 * db/jobNumber.server.js
 *
 * A single per-shop job number shared across BOTH exports and imports — like
 * Matrixify's job "#", where every job in the combined activity list has a
 * unique, increasing number regardless of type.
 *
 * Postgres auto-increment is per-table, which would give two independent
 * sequences (and duplicate numbers across the two lists). So instead we compute
 * the next number as max(number) across both job tables for the shop, + 1, at
 * creation time — inside the caller's transaction so the read + insert are one
 * unit. (This is a single-merchant embedded app; concurrent creates are nil.)
 *
 * Numbers start at JOB_NUMBER_FLOOR + 1 rather than #1 — a fresh install's
 * first job is #10001, so the sequence reads like an established app's
 * (Matrixify's are nine digits) instead of announcing "you're the first".
 * A shop whose sequence is still below the floor simply jumps to it on its
 * next job; existing numbers are never rewritten.
 *
 * @param {import("@prisma/client").PrismaClient} client - db or a tx client
 * @param {string} shop
 * @returns {Promise<number>}
 */
export const JOB_NUMBER_FLOOR = 10_000;

export async function nextJobNumber(client, shop) {
  const [e, i] = await Promise.all([
    client.bulkExportJob.aggregate({ where: { shop }, _max: { number: true } }),
    client.bulkImportJob.aggregate({ where: { shop }, _max: { number: true } }),
  ]);
  return Math.max(e._max.number ?? 0, i._max.number ?? 0, JOB_NUMBER_FLOOR) + 1;
}
