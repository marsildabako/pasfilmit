// Integration tests. Uses supertest so we don't need to actually
// open a port. Each `agent` keeps its own cookie jar so we can test
// authenticated flows properly.
//
// Runs against a real (temp) sqlite db. Should probably use an
// in-memory db and reset between tests but this is simpler and works.

const fs = require("fs");
const path = require("path");
const request = require("supertest");

process.env.SESSION_SECRET = "test-secret";
delete process.env.TMDB_API_KEY;  // force the fallback catalogue

// nuke any old db before we start
const dbFile = path.join(__dirname, "..", "data", "pasfilmit.db");
if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

const dbModule = require("../server/db");
const buildApp = require("../server/app");

let app;
let agent;

beforeAll(async () => {
  await dbModule.init();
  app = buildApp();
  agent = request.agent(app);
});

afterAll(() => {
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
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
    // use a fresh agent so we don't kill the main test session
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
      movie_id: 27205,  // Inception, from the fallback catalogue
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

  test("rating outside 1-5 is rejected", async () => {
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
    // seed a few entries so the aggregate queries have something to work with
    await agent.post("/api/entries").send({
      movie_id: 13, watched_on: "2026-05-10", rating: 4, mood_id: 4,
      reflection: "",
    });
    await agent.post("/api/entries").send({
      movie_id: 155, watched_on: "2026-05-20", rating: 5, mood_id: 5,
      reflection: "",
    });
    await agent.post("/api/entries").send({
      movie_id: 496243, watched_on: "2026-06-15", rating: 5, mood_id: 2,
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
