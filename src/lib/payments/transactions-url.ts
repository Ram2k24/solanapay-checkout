// Links within the Transactions page (Phase 12): tabs keep the search, paging keeps
// both, and changing the filter or search starts again from the first page.
export function transactionsHref(params: { filter?: string; q?: string; cursor?: string }): string {
  const query = new URLSearchParams();
  if (params.filter) query.set("filter", params.filter);
  if (params.q) query.set("q", params.q);
  if (params.cursor) query.set("cursor", params.cursor);
  const text = query.toString();
  return text ? `/transactions?${text}` : "/transactions";
}

// The CSV export of the current view: same filter and search, every page (no cursor).
export function transactionsExportHref(params: { filter?: string; q?: string }): string {
  const query = new URLSearchParams();
  if (params.filter) query.set("filter", params.filter);
  if (params.q) query.set("q", params.q);
  const text = query.toString();
  return text ? `/api/payments/export?${text}` : "/api/payments/export";
}
