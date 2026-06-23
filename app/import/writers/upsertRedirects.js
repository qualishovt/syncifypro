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

export async function upsertRedirects(rows, admin) {
  let created = 0, updated = 0;
  const errors = [];

  for (const batch of chunk(rows, 10)) {
    await Promise.all(batch.map(async (row) => {
      const gid = row.redirect_id ? `gid://shopify/UrlRedirect/${row.redirect_id}` : null;
      try {
        if (row.command === "DELETE") {
          const ue = await run(admin, DELETE, { id: gid }, "urlRedirectDelete");
          if (ue.length) errors.push({ path: row.path || row.redirect_id, userErrors: ue }); else updated++;
        } else if (gid) {
          const ue = await run(admin, UPDATE, { id: gid, redirect: { path: row.path, target: row.target } }, "urlRedirectUpdate");
          if (ue.length) errors.push({ path: row.path, userErrors: ue }); else updated++;
        } else {
          const ue = await run(admin, CREATE, { redirect: { path: row.path, target: row.target } }, "urlRedirectCreate");
          if (ue.length) errors.push({ path: row.path, userErrors: ue }); else created++;
        }
      } catch (err) {
        errors.push({ path: row.path || row.redirect_id, message: err.message });
      }
    }));
    await sleep(50);
  }

  // `updated` folds in updates + deletes (the import result shape is created/updated).
  return { created, updated, errors };
}

// ─── helpers ────────────────────────────────────────────────────────────────

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
