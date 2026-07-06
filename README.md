# PasFilmit — A Personal Cinema Diary

> Log every film you watch — and how it made you feel.

A private, single-user web application for keeping a film diary in which each entry pairs a 1–5 rating with a *mood tag* (Hopeful, Unsettled, Cathartic, Nostalgic, and so on). Unlike IMDb or Letterboxd, the design intent is reflection rather than social interaction: over time the diary becomes a longitudinal record of how cinema has affected you.

Built for the **DLBCSPJWD01 — Project Java and Web Development** portfolio at IU International University of Applied Sciences.

---

## Tech stack

| Layer      | Choice                                    |
|------------|-------------------------------------------|
| Front-end  | Vanilla HTML5, CSS3 (Grid + Flexbox), JavaScript (ES6+), Fetch API |
| Back-end   | Node.js, Express.js, RESTful JSON API     |
| Database   | SQLite (via `sql.js`, no native build step) |
| Auth       | `bcryptjs` for password hashing, `express-session` for cookie sessions |
| External   | The Movie Database (TMDB) — consumed server-side only |
| Tests      | Jest + Supertest (integration tests over the HTTP API) |

The application deliberately uses **no front-end framework** — the brief accepts Vanilla HTML/CSS/JS and this project takes that route to keep the surface area small and the code inspectable.

---

## Prerequisites

- Node.js 18 or newer (the app uses the built-in `fetch`).
- npm.

You do **not** need a TMDB API key to run the app. Without one, the search endpoint transparently falls back to a small built-in catalogue of 20 titles so the reviewer can test every code path end-to-end. To enable live TMDB search, register a free key at <https://www.themoviedb.org/settings/api> and drop it into `.env` (see below).

---

## Install and run

```bash
# 1. Clone
git clone https://github.com/<your-username>/pasfilmit.git
cd pasfilmit

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
#    Open .env and (optionally) paste your TMDB_API_KEY.
#    SESSION_SECRET should be any long random string.

# 4. Run
npm start
```

The server prints `PasFilmit running on http://localhost:3000`. Open that URL in a browser.

On first launch the SQLite database is created at `data/pasfilmit.db` and the 12 preset moods are seeded.

---

## Using the app

1. **Create an account** on the landing page. Password must be at least 6 characters.
2. **Log a film**: click `＋ Log a film`, search by title, pick a result, set date + rating + mood, and optionally add a short reflection.
3. **Filter your diary** by mood using the dropdown at the top of the diary page.
4. **Edit or delete** any entry from its card.
5. **See your patterns** on the Stats tab — total films logged, average rating, mood distribution, and films per month.

The layout is responsive: on mobile the top-bar collapses, entry cards restack, and stats become single-column.

---

## Project structure

```
pasfilmit/
├── server/
│   ├── server.js              Entry point — initialises DB and starts Express
│   ├── app.js                 Express app factory + all routes
│   ├── db.js                  SQLite (sql.js) wrapper — schema, seeding, queries
│   ├── tmdb.js                TMDB proxy with graceful fallback
│   └── fallback-catalogue.js  20-film catalogue used when no TMDB key is set
├── public/
│   ├── index.html             Single-page app shell
│   ├── css/styles.css         Cinema-noir styling, mobile responsive
│   └── js/
│       ├── api.js             Thin wrapper around backend REST calls
│       └── app.js             Front-end controller — views, forms, rendering
├── tests/
│   └── pasfilmit.test.js        Integration tests (Jest + Supertest)
├── data/                      SQLite file lives here (gitignored)
├── .env.example
├── .gitignore
└── package.json
```

---

## API reference

All endpoints return JSON. Endpoints marked 🔒 require an authenticated session cookie.

### Auth

| Method | Path                | Body / query                        | Description |
|--------|---------------------|-------------------------------------|-------------|
| POST   | `/api/auth/register`| `{username, password}` (pw ≥ 6)     | Create account and log in |
| POST   | `/api/auth/login`   | `{username, password}`              | Log in |
| POST   | `/api/auth/logout`  | —                                    | End session |
| GET    | `/api/auth/me`      | —                                    | Return `{authenticated, id?, username?}` |

### Movies 🔒

| Method | Path                     | Body / query   | Description |
|--------|--------------------------|----------------|-------------|
| GET    | `/api/movies/search?q=…` | —              | Search by title (proxied to TMDB) |

### Moods 🔒

| Method | Path         | Description |
|--------|--------------|-------------|
| GET    | `/api/moods` | Return the 12 preset moods |

### Diary entries 🔒

| Method | Path                    | Body                                              | Description |
|--------|-------------------------|---------------------------------------------------|-------------|
| GET    | `/api/entries?mood_id=` | —                                                 | List entries (optionally filtered by mood) |
| POST   | `/api/entries`          | `{movie_id, watched_on, rating, mood_id, reflection?}` | Create an entry |
| PUT    | `/api/entries/:id`      | Any subset of the above                           | Update an entry |
| DELETE | `/api/entries/:id`      | —                                                 | Delete an entry |

### Stats 🔒

| Method | Path         | Description |
|--------|--------------|-------------|
| GET    | `/api/stats` | Return totals, by-mood breakdown, films-per-month histogram |

---

## Testing

```bash
npm test
```

The Jest suite covers the auth flow, movie search (fallback path), diary CRUD, filter, validation, and stats aggregation. Sessions are exercised end-to-end via a supertest agent.

---

## Design decisions

- **No front-end framework.** The scope is small and having no build step keeps the code inspectable and the deployment trivial. Every dynamic interaction is a few lines of `fetch()` plus DOM manipulation.
- **`sql.js` over `better-sqlite3`.** Pure JavaScript SQLite avoids the native `node-gyp` build chain on the reviewer's machine. The database file on disk is a standard SQLite file and can be opened with any SQLite tool.
- **TMDB proxied server-side.** The API key never reaches the browser. The proxy also normalises the response shape, so the front-end doesn't depend on TMDB field names.
- **Fallback catalogue.** The reviewer can test every feature without registering for TMDB — a small file of 20 titles substitutes for the live search.
- **Session cookies over JWT.** Simpler for a single-user app; no need for token refresh logic.

---

## License

Coursework submission for DLBCSPJWD01 · IU International University of Applied Sciences.
