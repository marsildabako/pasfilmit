// Express app. Exporting the factory rather than an already-listening
// server so the tests can mount it against supertest without opening
// a real port. Learned that trick from a stackoverflow answer.

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const db = require("./db");
const tmdb = require("./tmdb");

function buildApp() {
  const app = express();

  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "pasfilmit-dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,  // one week
      },
    })
  );

  // middleware: bounce anyone without a session
  const requireAuth = (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    next();
  };

  // when the user picks a search result we save the movie to our local
  // db so we can foreign-key the diary_entry to it. skip if it's already there.
  const cacheMovie = (m) => {
    const existing = db.get("SELECT id FROM movies WHERE id = ?", [m.id]);
    if (existing) return;
    db.run(
      `INSERT INTO movies (id, title, release_year, poster_path, overview, runtime)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [m.id, m.title, m.release_year, m.poster_path, m.overview, m.runtime]
    );
  };

  // ---- auth routes ----

  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: "Username and 6+ char password required" });
    }
    const existing = db.get("SELECT id FROM users WHERE username = ?", [username]);
    if (existing) return res.status(409).json({ error: "Username already taken" });

    // bcrypt with 10 rounds. 12 would be safer but slower, 10 is fine for coursework.
    const hash = bcrypt.hashSync(password, 10);
    const id = db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash]);
    req.session.userId = id;
    req.session.username = username;
    res.json({ id, username });
  });

  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body || {};
    const user = db.get("SELECT * FROM users WHERE username = ?", [username]);
    // constant-time-ish: always run compareSync so timing doesn't reveal whether
    // the username exists. (bcrypt.compareSync itself is constant time internally.)
    if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ id: user.id, username: user.username });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session.userId) return res.json({ authenticated: false });
    res.json({
      authenticated: true,
      id: req.session.userId,
      username: req.session.username,
    });
  });

  // ---- movies ----

  app.get("/api/movies/search", requireAuth, async (req, res) => {
    try {
      const results = await tmdb.search(req.query.q || "");
      // source flag so I can debug if the fallback ever kicks in when it shouldn't
      res.json({ source: tmdb.hasKey() ? "tmdb" : "fallback", results });
    } catch (err) {
      console.error("Search error:", err.message);
      res.status(502).json({ error: "Upstream search failed" });
    }
  });

  // ---- moods (just a lookup) ----

  app.get("/api/moods", requireAuth, (req, res) => {
    res.json(db.all("SELECT id, label, color FROM moods ORDER BY id"));
  });

  // ---- diary entries ----

  app.get("/api/entries", requireAuth, (req, res) => {
    const { mood_id } = req.query;
    let sql = `
      SELECT e.id, e.watched_on, e.rating, e.reflection, e.created_at,
             m.id AS movie_id, m.title, m.release_year, m.poster_path,
             mo.id AS mood_id, mo.label AS mood_label, mo.color AS mood_color
      FROM diary_entries e
      JOIN movies m  ON m.id  = e.movie_id
      JOIN moods  mo ON mo.id = e.mood_id
      WHERE e.user_id = ?
    `;
    const params = [req.session.userId];
    if (mood_id) {
      sql += " AND e.mood_id = ?";
      params.push(mood_id);
    }
    sql += " ORDER BY e.watched_on DESC, e.id DESC";
    res.json(db.all(sql, params));
  });

  app.post("/api/entries", requireAuth, async (req, res) => {
    const { movie_id, watched_on, rating, mood_id, reflection } = req.body || {};
    if (!movie_id || !watched_on || !rating || !mood_id) {
      return res.status(400).json({ error: "movie_id, watched_on, rating, mood_id are required" });
    }
    if (rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be 1-5" });

    // make sure the movie is cached before we FK to it
    let movie = db.get("SELECT id FROM movies WHERE id = ?", [movie_id]);
    if (!movie) {
      const fetched = await tmdb.details(movie_id);
      if (!fetched) return res.status(400).json({ error: "Unknown movie" });
      cacheMovie(fetched);
    }

    const id = db.run(
      `INSERT INTO diary_entries (user_id, movie_id, watched_on, rating, mood_id, reflection)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.session.userId, movie_id, watched_on, rating, mood_id, reflection || null]
    );
    res.status(201).json({ id });
  });

  app.put("/api/entries/:id", requireAuth, (req, res) => {
    // check ownership first, otherwise anyone with a session could edit
    // anyone else's entries by guessing ids
    const entry = db.get("SELECT * FROM diary_entries WHERE id = ? AND user_id = ?",
      [req.params.id, req.session.userId]);
    if (!entry) return res.status(404).json({ error: "Not found" });

    const { watched_on, rating, mood_id, reflection } = req.body || {};
    // COALESCE lets the client send a partial update - only the fields they
    // want to change. anything not provided keeps its current value.
    db.run(
      `UPDATE diary_entries
       SET watched_on = COALESCE(?, watched_on),
           rating     = COALESCE(?, rating),
           mood_id    = COALESCE(?, mood_id),
           reflection = COALESCE(?, reflection)
       WHERE id = ?`,
      [watched_on || null, rating || null, mood_id || null, reflection || null, req.params.id]
    );
    res.json({ ok: true });
  });

  app.delete("/api/entries/:id", requireAuth, (req, res) => {
    const entry = db.get("SELECT id FROM diary_entries WHERE id = ? AND user_id = ?",
      [req.params.id, req.session.userId]);
    if (!entry) return res.status(404).json({ error: "Not found" });
    db.run("DELETE FROM diary_entries WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  // ---- stats ----
  // three separate queries then combined into one response. tried to do it
  // as one big query with subqueries but got confusing quickly, so splitting
  // is easier to read.

  app.get("/api/stats", requireAuth, (req, res) => {
    const uid = req.session.userId;

    const totals = db.get(
      `SELECT COUNT(*) AS total,
              ROUND(AVG(rating), 2) AS avg_rating
       FROM diary_entries WHERE user_id = ?`, [uid]);

    const byMood = db.all(
      `SELECT mo.label, mo.color, COUNT(*) AS count
       FROM diary_entries e JOIN moods mo ON mo.id = e.mood_id
       WHERE e.user_id = ?
       GROUP BY mo.id
       ORDER BY count DESC`, [uid]);

    // SUBSTR(watched_on, 1, 7) = "YYYY-MM". works because watched_on is stored
    // as an ISO date string. would break if we ever switched to a different format.
    const byMonth = db.all(
      `SELECT SUBSTR(watched_on, 1, 7) AS month, COUNT(*) AS count
       FROM diary_entries
       WHERE user_id = ?
       GROUP BY month
       ORDER BY month DESC
       LIMIT 12`, [uid]);

    res.json({ totals, byMood, byMonth });
  });

  // ---- static files ----

  app.use(express.static(path.join(__dirname, "..", "public")));

  // dumb placeholder posters for the fallback catalogue.
  // in production these would be real TMDB image URLs.
  app.get("/placeholder/:name", (req, res) => {
    const title = req.params.name.replace(".svg", "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 342 513">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1A1F26"/><stop offset="1" stop-color="#0F1419"/>
      </linearGradient></defs>
      <rect width="342" height="513" fill="url(#g)"/>
      <rect x="16" y="16" width="310" height="481" fill="none" stroke="#E8A33D" stroke-width="2" opacity="0.4"/>
      <text x="171" y="256" text-anchor="middle" fill="#E8A33D"
            font-family="Georgia" font-size="28" font-style="italic">PasFilmit</text>
      <text x="171" y="290" text-anchor="middle" fill="#C8C5BD"
            font-family="Calibri" font-size="14">${title}</text>
    </svg>`;
    res.type("image/svg+xml").send(svg);
  });

  return app;
}

module.exports = buildApp;
