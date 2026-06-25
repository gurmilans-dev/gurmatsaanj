// ── Recent searches — per-device history of executed search queries. ──
//
// Saved in localStorage; one shared list for both Kirtan and Katha modes
// (a query that worked in one is just as useful in the other). Capped at
// MAX_ITEMS so the dropdown stays scannable and storage stays small.

const STORAGE_KEY = 'saanj-kirtan.recentSearches.v1';
const MAX_ITEMS = 8;
const MAX_LEN = 80; // never store overlong queries

function read() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.query === 'string' && entry.query.trim())
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function write(entries) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ITEMS)));
  } catch {
    // localStorage may be full or unavailable — never let this break the search.
  }
}

export function loadRecentSearches() {
  return read();
}

export function addRecentSearch(query, meta = {}) {
  const trimmed = String(query || '').trim().slice(0, MAX_LEN);
  if (!trimmed) return read();
  const existing = read();
  // Dedupe case-insensitively so "Japji" and "japji" don't both appear.
  const norm = trimmed.toLowerCase();
  const filtered = existing.filter((entry) => String(entry.query).toLowerCase() !== norm);
  const next = [{
    query: trimmed,
    mode: meta.mode || 'auto',
    addedAt: Date.now(),
  }, ...filtered].slice(0, MAX_ITEMS);
  write(next);
  return next;
}

export function removeRecentSearch(query) {
  const norm = String(query || '').trim().toLowerCase();
  if (!norm) return read();
  const next = read().filter((entry) => String(entry.query).toLowerCase() !== norm);
  write(next);
  return next;
}

export function clearRecentSearches() {
  write([]);
  return [];
}
