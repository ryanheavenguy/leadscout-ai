// Schema-aware writes. The server's field allowlists say what the app knows how to
// store; the table decides what it can actually store. Writing a column the table
// doesn't have makes PostgREST reject the entire statement (42703), so one column the
// app added but the DB never got turns every save into a failure. Read the real column
// set from PostgREST's OpenAPI document and write only into it.

// Re-read periodically so columns added in Supabase start being written without a
// redeploy — otherwise a long-lived instance keeps dropping a column that now exists.
const SCHEMA_TTL_MS = 5 * 60 * 1000;

let churchColumnsPromise = null;
let fetchedAt = 0;

export function getChurchColumns() {
  if (churchColumnsPromise && Date.now() - fetchedAt > SCHEMA_TTL_MS) {
    churchColumnsPromise = null;
  }
  if (!churchColumnsPromise) {
    fetchedAt = Date.now();
    const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    churchColumnsPromise = fetch(`${base}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`schema request returned ${response.status}`);
        const properties = (await response.json())?.definitions?.churches?.properties;
        if (!properties) throw new Error('no churches table in schema');
        return new Set(Object.keys(properties));
      })
      .catch((err) => {
        // Don't cache the failure — the next write retries. Falling back to "write
        // everything" is exactly the old behavior, so this can't make things worse.
        churchColumnsPromise = null;
        console.warn('[schema] could not read churches columns:', err.message);
        return null;
      });
  }
  return churchColumnsPromise;
}

/** Splits a row into what the table can store and the names of the fields it can't. */
export async function splitByColumn(row) {
  const columns = await getChurchColumns();
  if (!columns) return { writable: row, unsupported: [] };

  const writable = {};
  const unsupported = [];
  for (const [key, value] of Object.entries(row)) {
    if (columns.has(key)) writable[key] = value;
    else unsupported.push(key);
  }
  return { writable, unsupported };
}
