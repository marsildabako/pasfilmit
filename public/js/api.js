/**
 * api.js — Thin wrapper around the backend REST API.
 *
 * All calls include `credentials: "include"` so the session cookie flows
 * correctly, and JSON responses are unwrapped or the error message thrown.
 */
const api = (() => {
  async function req(method, url, body) {
    const opts = {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
    return data;
  }

  return {
    // auth
    me:       ()             => req("GET",    "/api/auth/me"),
    login:    (u, p)         => req("POST",   "/api/auth/login",    { username: u, password: p }),
    register: (u, p)         => req("POST",   "/api/auth/register", { username: u, password: p }),
    logout:   ()             => req("POST",   "/api/auth/logout"),

    // movies
    searchMovies: (q)        => req("GET",    "/api/movies/search?q=" + encodeURIComponent(q)),

    // moods
    listMoods: ()            => req("GET",    "/api/moods"),

    // entries
    listEntries: (moodId)    => req("GET",    "/api/entries" + (moodId ? "?mood_id=" + moodId : "")),
    createEntry: (data)      => req("POST",   "/api/entries",       data),
    updateEntry: (id, data)  => req("PUT",    "/api/entries/" + id, data),
    deleteEntry: (id)        => req("DELETE", "/api/entries/" + id),

    // stats
    stats:    ()             => req("GET",    "/api/stats"),
  };
})();
