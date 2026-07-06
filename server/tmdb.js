/**
 * tmdb.js — Server-side proxy to The Movie Database (TMDB) REST API.
 *
 * The API key is read from process.env.TMDB_API_KEY and never leaves the server.
 * If no key is configured (e.g. reviewer running the app without registering
 * for TMDB), the module transparently falls back to a small built-in catalogue
 * so the application remains fully demonstrable end-to-end.
 */
const FALLBACK_CATALOGUE = require("./fallback-catalogue");

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w342";

function hasKey() {
  return Boolean(process.env.TMDB_API_KEY && process.env.TMDB_API_KEY.trim());
}

/** Normalise a TMDB movie result into the shape used across the app. */
function normaliseTMDB(m) {
  return {
    id: m.id,
    title: m.title,
    release_year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    poster_path: m.poster_path ? POSTER_BASE + m.poster_path : null,
    overview: m.overview || "",
    runtime: m.runtime || null,
  };
}

/**
 * Search movies by title.
 * Returns an array of normalised movie objects.
 */
async function search(query) {
  if (!query || !query.trim()) return [];

  if (!hasKey()) {
    // Fallback: case-insensitive substring match on the built-in catalogue.
    const q = query.toLowerCase();
    return FALLBACK_CATALOGUE
      .filter(m => m.title.toLowerCase().includes(q))
      .slice(0, 10);
  }

  const url = `${TMDB_BASE}/search/movie?api_key=${encodeURIComponent(
    process.env.TMDB_API_KEY
  )}&query=${encodeURIComponent(query)}&include_adult=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, 10).map(normaliseTMDB);
}

/** Fetch full details for a movie (used when logging an entry). */
async function details(id) {
  if (!hasKey()) {
    return FALLBACK_CATALOGUE.find(m => m.id === Number(id)) || null;
  }
  const url = `${TMDB_BASE}/movie/${id}?api_key=${encodeURIComponent(
    process.env.TMDB_API_KEY
  )}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return normaliseTMDB(await res.json());
}

module.exports = { search, details, hasKey };
