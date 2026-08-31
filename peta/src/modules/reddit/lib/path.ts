// Hostname-aware route paths for the Straight Ltd surface.
//
// The Straight app historically lived under /reddit/* on both domains.
// With the "human task network" repositioning, straight.ltd now uses clean
// paths (/signup, /dashboard, /admin, ...). The /reddit/* tree stays mounted
// as the legacy surface so old links (emails, notifications stored in the
// DB, bookmarks) keep resolving — and it remains the only surface on the
// PeTa domain, where /login, /admin, etc. belong to PeTa.

export function isStraightHost(): boolean {
  if (typeof window === 'undefined') return false;
  return /(^|\.)straight\.ltd$/i.test(window.location.hostname);
}

// Map a clean Straight path to the right route for the current host:
//   straight.ltd  → clean path (/login, /admin/orders, ...)
//   other hosts   → legacy /reddit-prefixed path (/reddit/login, ...)
export function spath(clean: string): string {
  if (isStraightHost()) return clean;
  return clean === '/' ? '/reddit' : `/reddit${clean}`;
}
