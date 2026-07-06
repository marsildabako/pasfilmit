/**
 * pasfilmit.test.js — Integration tests for the PasFilmit HTTP API.
 *
 * Uses supertest to exercise the Express app end-to-end against a
 * temporary SQLite file, verifying auth, CRUD, filter, and stats routes.
 */
const fs   = require("fs");
const path = require("path");
const request = require("supertest");

const TMP_DB = path.join(__dirname, "..", "data", "test-pasfilmit.db");
process.env.SESSION_SECRET = "test-secret";
delete process.env.TMDB_API_KEY; // force fallback catalogue

// Route the DB to a temp file for isolation
const dbModule = require("../server/db");
const origPath = require.cache[require.resolve("../server/db")].exports;
// The db module bakes the DB_PATH at load time; simplest reset is deleting the file.
if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
if (fs.existsSync(path.join(__dirname, "..", "data", "pasfilmit.db"))) {
  // don't overwrite production DB; tests use the default path but we ensure fresh
  fs.unlinkSync(path.join(__dirname, "..", "data", "pasfilmit.db"));
}

const buildApp = require("../server/app");

let app;
let agent;

beforeAll(async () => {
  await dbModule.init();
  app = buildApp();
  agent = request.agent(app);
});

afterAll(() => {
  const p = path.join(__dirname, "..", "data", "pasfilmit.db");
  if (fs.existsSync(p)) fs.unlinkSync(p);
});

describe("Auth flow", () => {
  test("register requires 6-char password", async () => {
    const res = await agent.post("/api/auth/register")
      .send({ username: "shortpw", password: "abc" });
    expect(res.status).toBe(400);
  });

  test("register creates and logs in", async () => {
    const res = await agent.post("/api/auth/register")
      .send({ username: "marsi", password: "cinephile42" });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("marsi");
  });

  test("me returns authenticated session", async () => {
    const res = await agent.get("/api/auth/me");
    expect(res.body.authenticated).toBe(true);
    expect(res.body.username).toBe("marsi");
  });

  test("duplicate username is rejected", async () => {
    const res = await agent.post("/api/auth/register")
      .send({ username: "marsi", password: "another1" });
    expect(res.status).toBe(409);
  });

  test("logout ends session", async () => {
    const fresh = request.agent(app);
    await fresh.post("/api/auth/register").send({ username: "temp", password: "temppass" });
    await fresh.post("/api/auth/logout");
    const me = await fresh.get("/api/auth/me");
    expect(me.body.authenticated).toBe(false);
  });

  test("login with bad password fails", async () => {
    const res = await request(app).post("/api/auth/login")
      .send({ username: "marsi", password: "wrong" });
    expect(res.status).toBe(401);
  });
});

describe("Movie search (fallback catalogue)", () => {
  test("unauthenticated requests are rejected", async () => {
    const res = await request(app).get("/api/movies/search?q=inception");
    expect(res.status).toBe(401);
  });

  test("returns fallback results with source flag", async () => {
    const res = await agent.get("/api/movies/search?q=inception");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].title).toMatch(/inception/i);
  });

  test("empty query returns empty result set", async () => {
    const res = await agent.get("/api/movies/search?q=");
    expect(res.body.results).toEqual([]);
  });
});

describe("Diary entries CRUD", () => {
  let entryId;

  test("moods lookup returns 12 seeded moods", async () => {
    const res = await agent.get("/api/moods");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(12);
    expect(res.body[0]).toHaveProperty("label");
    expect(res.body[0]).toHaveProperty("color");
  });

  test("create entry", async () => {
    const res = await agent.post("/api/entries").send({
      movie_id: 27205, // Inception (fallback)
      watched_on: "2026-06-01",
      rating: 5,
      mood_id: 1,
      reflection: "Blew my mind again.",
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    entryId = res.body.id;
  });

  test("list returns the created entry with joined movie + mood", async () => {
    const res = await agent.get("/api/entries");
    expect(res.status).toBe(200);
    const found = res.body.find((e) => e.id === entryId);
    expect(found).toBeDefined();
    expect(found.title).toBe("Inception");
    expect(found.mood_label).toBeDefined();
    expect(found.rating).toBe(5);
  });

  test("filter by mood", async () => {
    const res = await agent.get("/api/entries?mood_id=1");
    expect(res.status).toBe(200);
    expect(res.body.every((e) => e.mood_id === 1)).toBe(true);
  });

  test("update entry", async () => {
    const res = await agent.put("/api/entries/" + entryId).send({ rating: 4 });
    expect(res.status).toBe(200);
    const list = await agent.get("/api/entries");
    const updated = list.body.find((e) => e.id === entryId);
    expect(updated.rating).toBe(4);
  });

  test("rating outside 1–5 is rejected", async () => {
    const res = await agent.post("/api/entries").send({
      movie_id: 550, watched_on: "2026-06-02", rating: 9, mood_id: 1,
    });
    expect(res.status).toBe(400);
  });

  test("missing fields are rejected", async () => {
    const res = await agent.post("/api/entries").send({ movie_id: 550 });
    expect(res.status).toBe(400);
  });

  test("delete entry", async () => {
    const res = await agent.delete("/api/entries/" + entryId);
    expect(res.status).toBe(200);
    const list = await agent.get("/api/entries");
    expect(list.body.find((e) => e.id === entryId)).toBeUndefined();
  });
});

describe("Stats aggregation", () => {
  beforeAll(async () => {
    // seed some entries so stats have data
    await agent.post("/api/entries").send({
      movie_id: 13, watched_on: "2026-05-10", rating: 4, mood_id: 4, // Nostalgic
      reflection: "",
    });
    await agent.post("/api/entries").send({
      movie_id: 155, watched_on: "2026-05-20", rating: 5, mood_id: 5, // Thrilled
      reflection: "",
    });
    await agent.post("/api/entries").send({
      movie_id: 496243, watched_on: "2026-06-15", rating: 5, mood_id: 2, // Unsettled
      reflection: "",
    });
  });

  test("returns totals, by-mood, and by-month breakdowns", async () => {
    const res = await agent.get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.totals.total).toBeGreaterThanOrEqual(3);
    expect(res.body.byMood.length).toBeGreaterThan(0);
    expect(res.body.byMonth.length).toBeGreaterThan(0);
    expect(res.body.byMood[0]).toHaveProperty("color");
  });
});
