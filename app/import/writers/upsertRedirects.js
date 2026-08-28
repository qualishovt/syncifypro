/**
 * import/writers/upsertRedirects.js
 *
 * Creates / updates / deletes URL redirects from validated rows.
 * Per row: command DELETE → urlRedirectDelete; a redirect_id (or UPDATE) →
 * urlRedirectUpdate; otherwise → urlRedirectCreate.
 * Requires write_online_store_navigation.
 */

const CREATE = `#graphql
  mutation CreateRedirect($redirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $redirect) {
      urlRedirect { id }
      userErrors { field message }
    }
  }
`;
const UPDATE = `#graphql
  mutation UpdateRedirect($id: ID!, $redirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $redirect) {
      urlRedirect { id }
      userErrors { field message }
    }
  }
`;
const DELETE = `#graphql
  mutation DeleteRedirect($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors { field message }
    }
  }
`;

export async function upsertRedirects(rows, admin, { onProgress } = {}) {
  const result = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [], results: new Array(rows.length) };

  let base = 0;
  for (const batch of chunk(rows, 16)) {
    const start = base;
    await Promise.all(batch.map((row, k) =>
      writeRow(row, admin, result).then((o) => { result.results[start + k] = o; onProgress?.(1); })
    ));
    base += batch.length;
    await sleep(20);
  }
  return result;
}

async function writeRow(row, admin, result) {
  const gid = row.redirect_id ? `gid://shopify/UrlRedirect/${row.redirect_id}` : null;
  const label = row.path || row.redirect_id || "(redirect)";
  try {
    if (row.command === "DELETE") {
      if (!gid) { result.skipped++; return { status: "skipped", comment: "No matching redirect to delete" }; }
      const ue = await run(admin, DELETE, { id: gid }, "urlRedirectDelete");
      if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
      result.deleted++;
      return { status: "deleted", comment: "" };
    }
    if (gid) {
      const ue = await run(admin, UPDATE, { id: gid, redirect: { path: row.path, target: row.target } }, "urlRedirectUpdate");
      if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
      result.updated++;
      return { status: "updated", comment: "" };
    }
    const ue = await run(admin, CREATE, { redirect: { path: row.path, target: row.target } }, "urlRedirectCreate");
    if (ue.length) {
      // MERGE/UPDATE semantics without an ID: the path already exists →
      // find that redirect and update its target (re-importing the same
      // file, or pointing an old URL somewhere new). NEW keeps the error.
      if (row.command !== "NEW" && isTaken(ue)) {
        const existing = await findByPath(admin, row.path);
        if (existing) {
          const ue2 = await run(admin, UPDATE, { id: existing, redirect: { path: row.path, target: row.target } }, "urlRedirectUpdate");
          if (ue2.length) { result.errors.push({ path: label, userErrors: ue2 }); return { status: "failed", comment: msgs(ue2) }; }
          result.updated++;
          return { status: "updated", comment: "" };
        }
      }
      result.errors.push({ path: label, userErrors: ue });
      return { status: "failed", comment: msgs(ue) };
    }
    result.created++;
    return { status: "created", comment: "" };
  } catch (err) {
    result.errors.push({ path: label, message: err.message });
    return { status: "failed", comment: err.message };
  }
}

/** Join userError messages into one comment string. */
function msgs(errs) {
  return errs.map((e) => e.message).filter(Boolean).join("; ");
}

// ─── helpers ────────────────────────────────────────────────────────────────

const FIND_BY_PATH = `#graphql
  query FindRedirect($query: String!) {
    urlRedirects(first: 1, query: $query) { nodes { id path } }
  }
`;

/** True when the create failed only because the path already exists. */
function isTaken(userErrors) {
  return userErrors.some((e) => /already been taken/i.test(e.message ?? ""));
}

/** The existing redirect's id for an exact path, or null. */
async function findByPath(admin, path) {
  const res = await admin.graphql(FIND_BY_PATH, { variables: { query: `path:${JSON.stringify(path)}` } });
  const { data } = await res.json();
  const hit = (data?.urlRedirects?.nodes ?? []).find((n) => n.path === path);
  return hit?.id ?? null;
}

async function run(admin, mutation, variables, field) {
  const res = await admin.graphql(mutation, { variables });
  const { data } = await res.json();
  return data?.[field]?.userErrors ?? [];
}

function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
