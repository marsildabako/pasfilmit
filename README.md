# PasFilmit

A personal film diary. You log a film you watched, give it a rating and a mood tag (Hopeful, Unsettled, Nostalgic and so on), and optionally write a short reflection. Over time you can see your viewing patterns on the stats page.

Built as the portfolio project for **DLBCSPJWD01 - Project Java and Web Development** at IU International University of Applied Sciences.

## Stack

- **Frontend:** vanilla HTML/CSS/JavaScript. No framework, no build step.
- **Backend:** Node.js + Express.
- **DB:** SQLite (via `sql.js`, which is a pure-JS build - no native compilation needed).
- **External API:** TMDB (The Movie Database), called from the server so the API key doesn't leak to the browser.
- **Tests:** Jest + Supertest.

## Running it

Needs Node 18 or newer (I'm using the built-in `fetch` on the server).

```bash
git clone https://github.com/YOUR-USERNAME/pasfilmit.git
cd pasfilmit
npm install
cp .env.example .env
# open .env and set SESSION_SECRET to anything long-ish.
# TMDB_API_KEY is optional - see note below.
npm start
```

Open http://localhost:3000.

### About the TMDB key

You don't have to register at TMDB to try the app. If you leave `TMDB_API_KEY` empty, the search endpoint falls back to a built-in list of 20 well-known films. This was mostly for my own testing, but it also means whoever grades this can see everything working without having to sign up for a third-party service. If a key IS set, the real TMDB API is used.

## What you can do in the app

1. Register (needs a username and 6+ char password).
2. Click **+ Log a film**, search by title, pick one from the results.
3. Set the date you watched it, give it 1-5 stars, pick a mood, optionally write a reflection. Save.
4. Filter your diary by mood from the dropdown at the top.
5. Edit or delete entries from their card.
6. Switch to the **Stats** tab to see totals, mood distribution, and films-per-month.

The layout is responsive - it also works on a phone.

## Folder layout

```
pasfilmit/
├── server/
│   ├── server.js              starts the app
│   ├── app.js                 express routes
│   ├── db.js                  sqlite wrapper (sql.js)
│   ├── tmdb.js                calls TMDB (or the fallback)
│   └── fallback-catalogue.js  20 movies used when no API key
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js             fetch wrapper
│       └── app.js             frontend controller
├── tests/
│   └── pasfilmit.test.js
├── data/                      sqlite file goes here (gitignored)
├── .env.example
└── package.json
```

## Endpoints

Everything returns JSON. Endpoints marked (auth) need a session cookie.

**Auth**
- `POST /api/auth/register` - `{username, password}` (password >= 6 chars)
- `POST /api/auth/login` - `{username, password}`
- `POST /api/auth/logout`
- `GET  /api/auth/me`

**Movies** (auth)
- `GET  /api/movies/search?q=...`

**Moods** (auth)
- `GET  /api/moods` - the 12 preset moods with their colors

**Diary entries** (auth)
- `GET    /api/entries` (optional `?mood_id=` to filter)
- `POST   /api/entries` - `{movie_id, watched_on, rating, mood_id, reflection?}`
- `PUT    /api/entries/:id` - any subset of the above
- `DELETE /api/entries/:id`

**Stats** (auth)
- `GET  /api/stats` - totals, by-mood, by-month

## Tests

```bash
npm test
```

18 tests. Cover auth, movie search (fallback path), CRUD, validation edge cases, filter, and stats.

## A few notes on design decisions

- **No frontend framework.** The app is small enough that I didn't need one, and skipping the whole build step keeps things simple. Every dynamic bit is just `fetch()` + some DOM manipulation.
- **`sql.js` instead of `better-sqlite3`.** `better-sqlite3` needs a C++ toolchain to install. That wouldn't have been portable across whoever runs this. `sql.js` is slower but slow doesn't matter here.
- **TMDB proxied.** The API key is only ever read on the server. I also normalise TMDB's response shape into what my frontend needs, so if I ever swap APIs the frontend doesn't care.
- **Session cookies instead of JWT.** Simpler, and a single-user app doesn't need token refresh logic.

## Known limitations / TODOs

- No password reset flow (single user, single machine - didn't bother).
- No pagination on the diary list. If you log 1000+ films it'll get slow.
- The stats page only shows the last 12 months. Fine for now.
- Movie posters in the fallback catalogue are placeholders. Real TMDB posters only show up if you set the key.

---

Coursework project, DLBCSPJWD01, IU International University of Applied Sciences.
