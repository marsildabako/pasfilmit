/**
 * server.js — Server entry point.
 *
 * Initialises the database, then starts the Express app on the configured port.
 */
require("dotenv").config();
const db = require("./db");
const buildApp = require("./app");

const PORT = process.env.PORT || 3000;

(async () => {
  await db.init();
  const app = buildApp();
  app.listen(PORT, () => {
    console.log(`\n  PasFilmit running on http://localhost:${PORT}`);
    console.log(`  TMDB integration: ${process.env.TMDB_API_KEY ? "enabled" : "disabled (using fallback catalogue)"}\n`);
  });
})();
