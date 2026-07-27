// SQLite stuff. Using sql.js because better-sqlite3 wouldn't compile
// on my laptop (needed some C++ toolchain I couldn't get working).
// The upside: it's all pure JS, no build step for whoever runs this.
// The downside: I have to manually save() to disk after each write,
// which is a bit annoying but fine at this scale.

const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const DB_PATH = path.join(__dirname, "..", "data", "pasfilmit.db");
const DATA_DIR = path.dirname(DB_PATH);

let db = null;
let SQL = null;

// dump the in-memory db to disk
function save() {
  if (!db) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const buf = Buffer.from(db.export());
  fs.writeFileSync(DB_PATH, buf);
}

async function init() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    // load existing db from disk
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    // first run - build tables and seed the moods
    db = new SQL.Database();
    createSchema();
    seedMoods();
    save();
  }
  return db;
}

function createSchema() {
  // Note: created_at defaults to CURRENT_TIMESTAMP but this is UTC.
  // Not a problem for me but worth remembering.
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS movies (
      id           INTEGER PRIMARY KEY,
      title        TEXT NOT NULL,
      release_year INTEGER,
      poster_path  TEXT,
      overview     TEXT,
      runtime      INTEGER
    );

    CREATE TABLE IF NOT EXISTS moods (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diary_entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      movie_id     INTEGER NOT NULL,
      watched_on   TEXT    NOT NULL,
      rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      mood_id      INTEGER NOT NULL,
      reflection   TEXT,
      created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)  REFERENCES users(id),
      FOREIGN KEY (movie_id) REFERENCES movies(id),
      FOREIGN KEY (mood_id)  REFERENCES moods(id)
    );

    CREATE INDEX IF NOT EXISTS idx_entries_user_date
      ON diary_entries(user_id, watched_on DESC);
  `);
}

// preset moods. picked colors to roughly match the vibe of each mood
// (red for unsettled, warm yellow for hopeful, etc). could be expanded later.
function seedMoods() {
  const moods = [
    ["Hopeful",    "#E8A33D"],
    ["Unsettled",  "#C73E3A"],
    ["Cathartic",  "#8B3A62"],
    ["Nostalgic",  "#5C6470"],
    ["Thrilled",   "#D96A2E"],
    ["Melancholy", "#3E5C76"],
    ["Amused",     "#F2B84B"],
    ["Inspired",   "#7A9E7E"],
    ["Confused",   "#A08B5C"],
    ["Comforted",  "#C79A6F"],
    ["Disturbed",  "#4A2C2A"],
    ["Reflective", "#6B7A8F"],
  ];
  const stmt = db.prepare("INSERT INTO moods (label, color) VALUES (?, ?)");
  moods.forEach(([label, color]) => stmt.run([label, color]));
  stmt.free();
}

// run a select, return all rows as plain objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// one row or null
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

// insert/update/delete. returns the last inserted id.
// NOTE: last_insert_rowid() is per-connection so this only works
// because we have a single connection.
function run(sql, params = []) {
  db.run(sql, params);
  const row = get("SELECT last_insert_rowid() AS id");
  save();
  return row ? row.id : null;
}

module.exports = { init, all, get, run, save };
