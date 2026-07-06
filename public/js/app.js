/**
 * app.js — Front-end controller for PasFilmit.
 *
 * Responsibilities:
 *   - View routing (auth ↔ app; diary ↔ stats)
 *   - Auth form submission (login + register)
 *   - Diary list rendering + mood filter
 *   - Modal for creating and editing entries (search → form)
 *   - Stats page (totals + horizontal bar charts, no chart lib needed)
 *
 * State is kept minimal and lives on the `state` object below.
 */
(() => {
  const state = {
    user: null,
    moods: [],
    selectedMovie: null,
    selectedMood: null,
    selectedRating: null,
    editingEntryId: null,
  };

  // ============================================================
  // UTILITIES
  // ============================================================

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const escapeHtml = (str) =>
    String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const showError = (elId, msg) => { const el = $("#" + elId); if (el) el.textContent = msg || ""; };

  // ============================================================
  // BOOT
  // ============================================================

  window.addEventListener("DOMContentLoaded", async () => {
    bindAuthUI();
    bindAppUI();
    bindModalUI();

    try {
      const me = await api.me();
      if (me.authenticated) {
        state.user = me;
        await enterApp();
      }
    } catch (e) {
      // no session — stay on auth view
    }
  });

  // ============================================================
  // AUTH
  // ============================================================

  function bindAuthUI() {
    $$(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const which = btn.dataset.tab;
        $("#form-login").classList.toggle("hidden", which !== "login");
        $("#form-register").classList.toggle("hidden", which !== "register");
        showError("login-error", "");
        showError("register-error", "");
      });
    });

    $("#form-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("login-error", "");
      const fd = new FormData(e.target);
      try {
        state.user = await api.login(fd.get("username"), fd.get("password"));
        await enterApp();
      } catch (err) {
        showError("login-error", err.message);
      }
    });

    $("#form-register").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("register-error", "");
      const fd = new FormData(e.target);
      try {
        state.user = await api.register(fd.get("username"), fd.get("password"));
        await enterApp();
      } catch (err) {
        showError("register-error", err.message);
      }
    });
  }

  // ============================================================
  // APP
  // ============================================================

  async function enterApp() {
    $("#view-auth").classList.add("hidden");
    $("#view-app").classList.remove("hidden");
    $("#user-label").textContent = "@" + state.user.username;

    // Load reference data
    state.moods = await api.listMoods();
    populateMoodFilter();

    // Default page = diary
    showPage("diary");
    await loadEntries();
  }

  function bindAppUI() {
    $$(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => showPage(btn.dataset.page));
    });

    $("#btn-logout").addEventListener("click", async () => {
      await api.logout();
      state.user = null;
      $("#view-app").classList.add("hidden");
      $("#view-auth").classList.remove("hidden");
      $("#form-login").reset();
      $("#form-register").reset();
    });

    $("#btn-new-entry").addEventListener("click", () => openModal("create"));

    $("#filter-mood").addEventListener("change", (e) => loadEntries(e.target.value));
  }

  function showPage(name) {
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
    $("#page-diary").classList.toggle("hidden", name !== "diary");
    $("#page-stats").classList.toggle("hidden", name !== "stats");
    if (name === "stats") loadStats();
  }

  function populateMoodFilter() {
    const sel = $("#filter-mood");
    sel.innerHTML = '<option value="">All moods</option>';
    state.moods.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
    });
  }

  // ============================================================
  // DIARY LIST
  // ============================================================

  async function loadEntries(moodId) {
    const list = $("#entries-list");
    list.innerHTML = '<p class="empty-state">Loading…</p>';
    try {
      const entries = await api.listEntries(moodId);
      renderEntries(entries);
    } catch (err) {
      list.innerHTML = `<p class="empty-state">Error loading entries: ${escapeHtml(err.message)}</p>`;
    }
  }

  function renderEntries(entries) {
    const list = $("#entries-list");
    if (!entries.length) {
      list.innerHTML = `<p class="empty-state">No entries yet. Log your first film above.</p>`;
      return;
    }
    list.innerHTML = "";
    entries.forEach((e) => list.appendChild(entryCard(e)));
  }

  function entryCard(e) {
    const card = document.createElement("article");
    card.className = "entry-card";

    const posterSrc = e.poster_path || "/placeholder/movie.svg";
    const stars = "★★★★★☆☆☆☆☆".slice(5 - e.rating, 10 - e.rating);
    const filled = "★".repeat(e.rating);
    const empty  = "☆".repeat(5 - e.rating);
    const dateStr = new Date(e.watched_on).toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });

    card.innerHTML = `
      <img class="entry-poster" src="${escapeHtml(posterSrc)}" alt="">
      <div class="entry-body">
        <h3>${escapeHtml(e.title)} <span style="color:#5C6470;font-weight:400;font-size:0.9rem;">
          ${e.release_year ? "(" + e.release_year + ")" : ""}</span></h3>
        <div class="entry-meta">Watched ${escapeHtml(dateStr)}</div>
        <div class="entry-stars">
          <span>${filled}</span><span class="empty">${empty}</span>
          &nbsp;·&nbsp;
          <span class="entry-mood-tag" style="background:${escapeHtml(e.mood_color)}">
            ${escapeHtml(e.mood_label)}
          </span>
        </div>
        ${e.reflection ? `<p class="entry-reflection">"${escapeHtml(e.reflection)}"</p>` : ""}
      </div>
      <div class="entry-actions">
        <button class="icon-btn" data-action="edit">Edit</button>
        <button class="icon-btn danger" data-action="delete">Delete</button>
      </div>
    `;

    card.querySelector('[data-action="edit"]').addEventListener("click", () => openModal("edit", e));
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`Delete your entry for "${e.title}"?`)) return;
      await api.deleteEntry(e.id);
      loadEntries($("#filter-mood").value);
    });

    return card;
  }

  // ============================================================
  // ENTRY MODAL (dynamic front-end interaction #1: search;
  // dynamic front-end interaction #2: create/edit via modal + JSON)
  // ============================================================

  function bindModalUI() {
    $$("[data-close]", $("#modal-entry")).forEach((el) =>
      el.addEventListener("click", closeModal)
    );

    $("#movie-search-input").addEventListener(
      "input",
      debounce(async (e) => {
        const q = e.target.value.trim();
        if (q.length < 2) {
          $("#search-results").innerHTML = "";
          return;
        }
        try {
          const data = await api.searchMovies(q);
          renderSearchResults(data.results);
        } catch (err) {
          $("#search-results").innerHTML =
            `<p class="empty-state">Search failed: ${escapeHtml(err.message)}</p>`;
        }
      }, 250)
    );

    $("#btn-change-movie").addEventListener("click", () => {
      state.selectedMovie = null;
      $("#step-search").classList.remove("hidden");
      $("#entry-form").classList.add("hidden");
      $("#movie-search-input").focus();
    });

    $("#entry-form").addEventListener("submit", handleEntrySubmit);
  }

  function openModal(mode, entry) {
    state.editingEntryId = null;
    state.selectedMovie = null;
    state.selectedMood = null;
    state.selectedRating = null;

    $("#modal-title").textContent = mode === "edit" ? "Edit entry" : "Log a film";
    $("#entry-form").reset();
    $("#movie-search-input").value = "";
    $("#search-results").innerHTML = "";
    showError("entry-error", "");

    renderStarInput();
    renderMoodPicker();

    if (mode === "edit" && entry) {
      state.editingEntryId = entry.id;
      state.selectedMovie = {
        id: entry.movie_id,
        title: entry.title,
        release_year: entry.release_year,
        poster_path: entry.poster_path,
      };
      state.selectedRating = entry.rating;
      state.selectedMood = entry.mood_id;
      $("#entry-form querySelector"); // no-op guard
      $("#entry-form").querySelector('[name="watched_on"]').value = entry.watched_on;
      $("#entry-form").querySelector('[name="reflection"]').value = entry.reflection || "";
      showSelectedMovie();
      renderStarInput(entry.rating);
      renderMoodPicker(entry.mood_id);
      $("#step-search").classList.add("hidden");
      $("#entry-form").classList.remove("hidden");
    } else {
      // default watched-on to today
      $("#entry-form").querySelector('[name="watched_on"]').value =
        new Date().toISOString().slice(0, 10);
      $("#step-search").classList.remove("hidden");
      $("#entry-form").classList.add("hidden");
    }

    $("#modal-entry").classList.remove("hidden");
    if (!state.selectedMovie) setTimeout(() => $("#movie-search-input").focus(), 50);
  }

  function closeModal() {
    $("#modal-entry").classList.add("hidden");
  }

  function renderSearchResults(results) {
    const wrap = $("#search-results");
    if (!results.length) {
      wrap.innerHTML = `<p class="empty-state">No matches. Try another title.</p>`;
      return;
    }
    wrap.innerHTML = "";
    results.forEach((m) => {
      const el = document.createElement("div");
      el.className = "search-result";
      el.innerHTML = `
        <img src="${escapeHtml(m.poster_path || "/placeholder/movie.svg")}" alt="">
        <div class="info">
          <h4>${escapeHtml(m.title)}</h4>
          <div class="year">${m.release_year || ""}</div>
          <div class="snippet">${escapeHtml(m.overview || "")}</div>
        </div>
      `;
      el.addEventListener("click", () => {
        state.selectedMovie = m;
        showSelectedMovie();
        $("#step-search").classList.add("hidden");
        $("#entry-form").classList.remove("hidden");
      });
      wrap.appendChild(el);
    });
  }

  function showSelectedMovie() {
    const m = state.selectedMovie;
    $("#sel-poster").src = m.poster_path || "/placeholder/movie.svg";
    $("#sel-title").textContent = m.title;
    $("#sel-meta").textContent = m.release_year || "";
  }

  function renderStarInput(current) {
    const wrap = $(".star-input");
    // Render right-to-left so hover cascades work with CSS ~ selector
    wrap.innerHTML = "";
    [5, 4, 3, 2, 1].forEach((n) => {
      const id = "star-" + n;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "rating";
      input.value = n;
      input.id = id;
      if (current === n) input.checked = true;
      input.addEventListener("change", () => (state.selectedRating = n));
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = "★";
      label.title = n + " star" + (n === 1 ? "" : "s");
      wrap.appendChild(input);
      wrap.appendChild(label);
    });
    if (current) state.selectedRating = current;
  }

  function renderMoodPicker(currentId) {
    const wrap = $("#mood-picker");
    wrap.innerHTML = "";
    state.moods.forEach((m) => {
      const chip = document.createElement("div");
      chip.className = "mood-chip";
      chip.textContent = m.label;
      chip.dataset.id = m.id;
      if (currentId === m.id) {
        chip.classList.add("selected");
        chip.style.background = m.color;
      }
      chip.addEventListener("click", () => {
        $$(".mood-chip", wrap).forEach((c) => {
          c.classList.remove("selected");
          c.style.background = "";
        });
        chip.classList.add("selected");
        chip.style.background = m.color;
        state.selectedMood = m.id;
      });
      wrap.appendChild(chip);
    });
    if (currentId) state.selectedMood = currentId;
  }

  async function handleEntrySubmit(e) {
    e.preventDefault();
    showError("entry-error", "");

    if (!state.selectedMovie) return showError("entry-error", "Please select a film.");
    if (!state.selectedRating) return showError("entry-error", "Please give it a rating.");
    if (!state.selectedMood) return showError("entry-error", "Please pick a mood.");

    const fd = new FormData(e.target);
    const payload = {
      movie_id: state.selectedMovie.id,
      watched_on: fd.get("watched_on"),
      rating: Number(state.selectedRating),
      mood_id: Number(state.selectedMood),
      reflection: (fd.get("reflection") || "").trim(),
    };

    try {
      if (state.editingEntryId) {
        await api.updateEntry(state.editingEntryId, payload);
      } else {
        await api.createEntry(payload);
      }
      closeModal();
      loadEntries($("#filter-mood").value);
    } catch (err) {
      showError("entry-error", err.message);
    }
  }

  // ============================================================
  // STATS
  // ============================================================

  async function loadStats() {
    const stats = await api.stats();
    $("#stat-total").textContent = stats.totals.total || 0;
    $("#stat-avg").textContent = stats.totals.avg_rating || "–";

    const maxMood = Math.max(1, ...stats.byMood.map((m) => m.count));
    $("#mood-chart").innerHTML = stats.byMood.length
      ? stats.byMood
          .map(
            (m) => `
        <div class="chart-row">
          <span class="label">${escapeHtml(m.label)}</span>
          <div class="bar-wrap"><div class="bar" style="width:${(m.count / maxMood) * 100}%; background:${escapeHtml(m.color)}"></div></div>
          <span class="count">${m.count}</span>
        </div>`
          )
          .join("")
      : '<p class="empty-state" style="padding:1rem 0">No mood data yet.</p>';

    const maxMonth = Math.max(1, ...stats.byMonth.map((m) => m.count));
    $("#month-chart").innerHTML = stats.byMonth.length
      ? stats.byMonth
          .slice()
          .reverse()
          .map(
            (m) => `
        <div class="chart-row">
          <span class="label">${escapeHtml(monthLabel(m.month))}</span>
          <div class="bar-wrap"><div class="bar" style="width:${(m.count / maxMonth) * 100}%; background:#E8A33D"></div></div>
          <span class="count">${m.count}</span>
        </div>`
          )
          .join("")
      : '<p class="empty-state" style="padding:1rem 0">No monthly data yet.</p>';
  }

  function monthLabel(ym) {
    const [y, m] = ym.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
})();
