/* ============ 0. SPEED: REMEMBER TMDB ANSWERS DURING YOUR VISIT ============ */
// Asking TMDB for the same thing twice is slow, so answers are saved until you close the tab.
var realFetch = window.fetch.bind(window);
window.fetch = async function (url, options) {
  if (typeof url === "string" && url.indexOf("https://api.themoviedb.org") === 0) {
    var cacheKey = "tmdb:" + url.replace(/api_key=[^&]*/, "");
    try {
      var saved = sessionStorage.getItem(cacheKey);
      if (saved) { return new Response(saved, { status: 200, headers: { "Content-Type": "application/json" } }); }
    } catch (e) {}
    var response = await realFetch(url, options);
    if (response.ok) { try { sessionStorage.setItem(cacheKey, await response.clone().text()); } catch (e) {} }
    return response;
  }
  return realFetch(url, options);
};

/* ============ 1. SHOW ONE PAGE AT A TIME ============ */
// Each page is a <div class="page" id="...">. The link (#movies, #tv ...) decides which one shows.
function showPage() {
  var name = location.hash.replace("#", "") || "home";
  if (!document.getElementById(name)) { name = "home"; }
  if (name === "profile" && authReady && !currentUser()) { location.hash = "#login"; return; }   // must log in first

  document.querySelectorAll(".page").forEach(function (page) {
    page.classList.toggle("active", page.id === name);
  });

  // Highlight the menu link (the login page highlights "Profile")
  var menuName = (name === "login") ? "profile" : name;
  document.querySelectorAll("nav a").forEach(function (link) {
    link.classList.toggle("active", link.getAttribute("href") === "#" + menuName);
  });
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", showPage);
showPage();

/* ============ 2. SMALL POP-UP MESSAGE ============ */
function showMessage(text) {
  var box = document.getElementById("message");
  box.textContent = text;
  box.style.display = "block";
  setTimeout(function () { box.style.display = "none"; }, 2500);
}

/* ============ 3. "ADD TO LIST" BUTTONS ============ */
document.querySelectorAll(".add").forEach(function (button) {
  button.onclick = function () { showMessage("Done! (Connect a database to save this.)"); };
});

/* ============ 4. SEARCH ============ */
// The search drop-down list is in section 10 at the bottom of this file.

/* ============ 5. THEATER: SEATS AND TOTAL ============ */
var TICKET_PRICE = 340;                    // price of one seat (change me)
var TAKEN = [];   // no seat is taken by default; seats only become taken when someone books them
var chosen = [];                           // no seat is selected at the start
var seatBox = document.getElementById("seats");

// make rows A-H with 15 seats each
"ABCDEFGH".split("").forEach(function (row) {
  var rowDiv = document.createElement("div"); rowDiv.className = "seat-row";
  var letter = document.createElement("span"); letter.className = "row-label"; letter.textContent = row;
  rowDiv.appendChild(letter);                       // the row letter (A to H) on the left
  for (var n = 1; n <= 15; n++) {
    var id = row + n;
    var seat = document.createElement("button");
    seat.className = "seat";
    seat.title = id;
    if (row === "A" && n >= 6 && n <= 10) { seat.classList.add("wheelchair"); seat.textContent = "♿"; }
    if (TAKEN.includes(id)) { seat.classList.add("taken"); }
    if (chosen.includes(id)) { seat.classList.add("selected"); }
    seat.onclick = function () {
      var seatId = this.title;
      if (this.classList.contains("taken")) { return; }
      this.classList.toggle("selected");
      if (chosen.includes(seatId)) { chosen.splice(chosen.indexOf(seatId), 1); }
      else { chosen.push(seatId); }
      updateSummary();
    };
    rowDiv.appendChild(seat);
  }
  seatBox.appendChild(rowDiv);
});
// seat numbers (1 to 15) under the last row
var numberRow = document.createElement("div"); numberRow.className = "seat-row";
numberRow.appendChild(document.createElement("span"));
for (var num = 1; num <= 15; num++) {
  var label = document.createElement("span"); label.className = "row-label"; label.textContent = num;
  numberRow.appendChild(label);
}
seatBox.appendChild(numberRow);

// time buttons
document.querySelectorAll("#times button").forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll("#times button").forEach(function (x) { x.classList.remove("chosen"); });
    b.classList.add("chosen");
    updateSummary();
  };
});

var lastSeatKey = "";
function bookingKey() {
  return [document.getElementById("bookTitle").textContent, document.getElementById("cinema").value,
          document.getElementById("date").value, document.querySelector("#times .chosen").textContent].join("|");
}
var bookedSeats = [];        // seats other people already booked for this showtime (from the server)
function paintSeats() {
  var booked = bookedSeats;
  document.querySelectorAll("#seats .seat").forEach(function (b) {
    b.classList.toggle("taken", TAKEN.includes(b.title) || booked.includes(b.title));
    b.classList.toggle("selected", chosen.includes(b.title));
  });
}
function updateSummary() {
  if (bookingKey() !== lastSeatKey) { lastSeatKey = bookingKey(); chosen.length = 0; bookedSeats = []; paintSeats(); loadBookedSeats(); }
  document.getElementById("sumMovie").textContent = document.getElementById("bookTitle").textContent;
  document.getElementById("sumCinema").textContent = document.getElementById("cinema").value;
  document.getElementById("sumTime").textContent =
    (function (v) { var p = v.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", weekday: "short" }); })(document.getElementById("date").value) +
    " • " + document.querySelector("#times .chosen").textContent;
  document.getElementById("sumSeats").textContent = chosen.join(", ") || "None";
  document.getElementById("sumTotal").textContent = "₱ " + (chosen.length * TICKET_PRICE).toFixed(2);
}
document.getElementById("cinema").onchange = updateSummary;
// ---- Real date and time: today's date by default, and showtimes that already passed are disabled ----
function pad2(n) { return String(n).padStart(2, "0"); }
function isoOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function todayISO() { return isoOf(new Date()); }
function minutesOf(label) {
  var p = label.match(/(\d+):(\d+) (AM|PM)/), h = (+p[1]) % 12 + (p[3] === "PM" ? 12 : 0);
  return h * 60 + (+p[2]);
}
function refreshTimes() {
  var dateBox = document.getElementById("date");
  var now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  var buttons = Array.from(document.querySelectorAll("#times button"));
  buttons.forEach(function (b) {
    b.disabled = dateBox.value === todayISO() && minutesOf(b.textContent) <= nowMin;
  });
  var open = buttons.filter(function (b) { return !b.disabled; });
  if (open.length === 0) {                       // no more shows today: go to tomorrow
    var next = new Date(); next.setDate(next.getDate() + 1);
    dateBox.value = isoOf(next);
    return refreshTimes();
  }
  var chosenBtn = document.querySelector("#times .chosen");
  if (!chosenBtn || chosenBtn.disabled) {
    buttons.forEach(function (x) { x.classList.remove("chosen"); });
    open[0].classList.add("chosen");
  }
}
(function () {
  var dateBox = document.getElementById("date");
  var last = new Date(); last.setDate(last.getDate() + 30);
  dateBox.min = todayISO(); dateBox.max = isoOf(last); dateBox.value = todayISO();
  refreshTimes(); updateSummary();
})();
document.getElementById("date").onchange = function () {
  if (this.value < todayISO()) { this.value = todayISO(); showMessage("You can only book today or a later date."); }
  refreshTimes(); updateSummary();
};

updateSummary();

/* ============ 6. LOGIN FORM ============ */
var signUpMode = false;

// show / hide password
document.getElementById("showPass").onchange = function () {
  document.getElementById("pass").type = this.checked ? "text" : "password";
};

// switch between Sign In and Sign Up
document.getElementById("switchLink").onclick = function (e) {
  e.preventDefault();
  signUpMode = !signUpMode;
  document.getElementById("formTitle").textContent = signUpMode ? "Create your account" : "Welcome to Filmlify";
  document.getElementById("submitBtn").textContent = signUpMode ? "Sign Up" : "Sign In";
  document.getElementById("emailBox").style.display = signUpMode ? "block" : "none";
  document.getElementById("nameBox").style.display = signUpMode ? "block" : "none";
  document.getElementById("userLabel").textContent = signUpMode ? "Username" : "Email or Username";
  document.getElementById("user").placeholder = signUpMode ? "Choose a username" : "Enter your email or username";
  document.getElementById("switchText").textContent = signUpMode ? "Already have an account?" : "Don't have an account?";
  this.textContent = signUpMode ? "Sign In" : "Sign Up";
};

// ---- Accounts live on the server (server.js + SQLite). The page only keeps the name of who is logged in. ----
var sessionUser = null;      // username, filled by /api/me
var sessionName = null;      // full name
var sessionAvatar = null;    // profile picture (a small image saved as text)
var authReady = false;       // true once the server has told us who is logged in
function currentUser() { return sessionUser; }
async function callApi(method, url, data) {
  try {
    var response = await fetch(url, {
      method: method, credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined
    });
    var json = await response.json().catch(function () { return {}; });
    if (!response.ok) { return { error: json.error || "Request failed (" + response.status + ")." }; }
    return json;
  } catch (e) {
    return { error: "Cannot reach the Filmlify server. Start it with: node server.js" };
  }
}
function paintLoginLink() {
  var link = document.querySelector(".login-link");
  var user = currentUser();
  link.textContent = user ? user + " (Log out)" : "Login / Sign up";
  link.onclick = async function (e) {
    if (!currentUser()) { return; }
    e.preventDefault();
    await callApi("POST", "/api/logout");
    sessionUser = null; sessionName = null; sessionAvatar = null; myBookingsList = [];
    paintProfileInfo(); renderProfile();
    paintLoginLink(); renderBookings();
    showMessage("Logged out.");
    location.hash = "#login";
  };
}
paintLoginLink();

document.getElementById("loginForm").onsubmit = async function (e) {
  e.preventDefault();
  var user = document.getElementById("user").value.trim();
  var pass = document.getElementById("pass").value;
  var email = document.getElementById("email").value.trim();
  document.getElementById("userError").textContent = user ? "" : "Please enter your email or username.";
  document.getElementById("passError").textContent = pass ? "" : "Please enter your password.";
  if (!user || !pass) { return; }
  var fullName = document.getElementById("fullName").value.trim();
  if (signUpMode && fullName.length < 2) { showMessage("Please enter your full name."); return; }
  if (signUpMode && !email) { showMessage("Please enter your email."); return; }

  var result = signUpMode
    ? await callApi("POST", "/api/signup", { username: user, name: fullName, email: email, password: pass, remember: document.getElementById("remember").checked })
    : await callApi("POST", "/api/login", { username: user, password: pass, remember: document.getElementById("remember").checked });
  if (result.error) { document.getElementById("passError").textContent = result.error; return; }

  sessionUser = result.user; sessionName = result.name; sessionAvatar = result.avatar || null;
  paintProfileInfo(); renderProfile();
  document.getElementById("loginForm").reset();
  paintLoginLink();
  await loadMyBookings();
  showMessage("Welcome, " + sessionUser + "!");
  location.hash = "#profile";
};

// Continue with Google: Google's pop-up gives the page a token, the server checks it and signs you in
var googleClientId = null, googleClient = null;
callApi("GET", "/api/config").then(function (c) { googleClientId = c.googleClientId || null; });
document.getElementById("googleBtn").onclick = function () {
  if (!googleClientId) { showMessage("Google sign-in is not set up on this server yet."); return; }
  if (!window.google || !google.accounts || !google.accounts.oauth2) { showMessage("Could not load Google. Check your internet connection or ad blocker."); return; }
  if (!googleClient) {
    googleClient = google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: "openid email profile",
      callback: async function (response) {
        if (response.error || !response.access_token) { showMessage("Google sign-in was cancelled."); return; }
        var result = await callApi("POST", "/api/google", { accessToken: response.access_token });
        if (result.error) { showMessage(result.error); return; }
        sessionUser = result.user; sessionName = result.name; sessionAvatar = result.avatar || null;
        paintProfileInfo(); renderProfile(); paintLoginLink();
        await loadMyBookings();
        showMessage("Welcome, " + sessionUser + "!");
        location.hash = "#profile";
      },
      error_callback: function () { showMessage("Google sign-in was cancelled or the pop-up was blocked."); }
    });
  }
  googleClient.requestAccessToken();
};


/* ============ 7. TMDB API: REAL POSTERS AND BACKGROUNDS ============ */
// NOTE: anyone can see this key in the page source. Fine for a personal project;
// for a public website, move the API calls to a server.
var TMDB_KEY = "9bac28ec4c4699d299b9cc8039e654f7";
var TMDB_URL = "https://api.themoviedb.org/3";
var POSTER_URL = "https://image.tmdb.org/t/p/w342";      // poster size
var PROFILE_URL = "https://image.tmdb.org/t/p/w185";    // people photos
var BACKDROP_URL = "https://image.tmdb.org/t/p/w1280";   // big background size
var searchCache = {};                                    // remembers titles we already looked up

// Look up a title (movie or TV show) and return the best match, or null if none
async function searchTMDB(title) {
  if (title in searchCache) { return searchCache[title]; }
  try {
    var response = await fetch(TMDB_URL + "/search/multi?query=" + encodeURIComponent(title) + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    var match = (data.results || []).find(function (item) {
      return (item.media_type === "movie" || item.media_type === "tv") && item.poster_path;
    });
    searchCache[title] = match || null;
    return searchCache[title];
  } catch (error) {
    console.error("TMDB lookup failed for '" + title + "':", error);
    return null;      // the card simply keeps its colored placeholder
  }
}

// Put a real poster on every card (6 at a time, to stay under TMDB's request limit)
async function loadPosters() {
  // only cards that do not have a poster yet
  var cards = Array.from(document.querySelectorAll(".card")).filter(function (card) {
    return !card.querySelector(".has-image");
  });
  for (var i = 0; i < cards.length; i += 6) {
    await Promise.all(cards.slice(i, i + 6).map(async function (card) {
      var item = await searchTMDB(card.querySelector("b").textContent);
      if (item) {
        var poster = card.querySelector(".poster");
        poster.style.backgroundImage = "url(" + POSTER_URL + item.poster_path + ")";
        poster.classList.add("has-image");
      }
    }));
  }
}

// Put a real background on every banner that has data-title="..."
async function loadBackdrops() {
  var banners = document.querySelectorAll(".hero[data-title]");
  for (var i = 0; i < banners.length; i++) {
    var item = await searchTMDB(banners[i].dataset.title);
    if (item && item.backdrop_path) {
      banners[i].style.backgroundImage =
        "linear-gradient(90deg, #0b1124dd, #0b112455), url(" + BACKDROP_URL + item.backdrop_path + ")";
      banners[i].style.backgroundSize = "cover";
      banners[i].style.backgroundPosition = "center";
    }
  }
}

// Make one poster card from a movie/show that TMDB sent us
function makeCard(m) {
  var card = document.createElement("div");
  card.className = "card";
  card.dataset.key = remember(m);   // so a click can open this movie's pop-up

  var poster = document.createElement("div");
  poster.className = "poster has-image";
  poster.style.backgroundImage = "url(" + POSTER_URL + m.poster_path + ")";

  var title = document.createElement("b");
  title.textContent = m.title || m.name;

  var info = document.createElement("small");
  var date = m.release_date || m.first_air_date || "";
  info.textContent = date.slice(0, 4);
  paintImdb(m, info, "", " • " + date.slice(0, 4));

  var quick = document.createElement("div");            // buttons that appear when you hover a poster
  quick.className = "quick";
  [["♥", "like", "Like"], ["✓", "watched", "Mark as watched"], ["+", "watchlist", "Add to watchlist"]].forEach(function (b) {
    var button = document.createElement("button");
    button.textContent = b[0];
    button.dataset.action = b[1];
    button.title = b[2];
    quick.appendChild(button);
  });
  poster.appendChild(quick);

  card.appendChild(poster);
  card.appendChild(title);
  card.appendChild(info);
  return card;
}

// Every row that has data-source="..." in index.html gets filled with up to 20 titles.
// To change what a row shows, change its data-source (for example /movie/popular).
async function fillRows() {
  var rows = Array.from(document.querySelectorAll(".row[data-source]"));
  await Promise.all(rows.map(async function (row) {
    try {
      var source = row.dataset.source;
      var joiner = source.includes("?") ? "&" : "?";
      var response = await fetch(TMDB_URL + source + joiner + "api_key=" + TMDB_KEY);
      if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
      var data = await response.json();
      var items = (data.results || []).filter(function (m) { return m.poster_path; });
      if (items.length === 0) { return; }       // keep the cards typed in index.html
      row.replaceChildren();
      items.forEach(function (m) {
        var card = makeCard(m);
        // In Theater > Now Showing: "Book Now" picks the movie for the booking panel
        if (row.dataset.source === "/movie/now_playing" && row.closest("#theater")) {
          var book = document.createElement("button");
          book.className = "btn wide";
          book.textContent = "Book Now";
          book.onclick = function (e) {
            e.stopPropagation();
            showBookingMovie(m);
          };
          card.appendChild(book);
        }
        row.appendChild(card);
      });
      row.scrollLeft = 0;
    } catch (error) {
      console.error("Could not fill row " + row.dataset.source + ":", error);
    }
  }));
}

async function loadEverything() {
  fillEpisodes();          // 0. New Episodes This Week (loads by itself)
  await Promise.all([fillRows(), fillPeople()]);   // 1. long rows + trending people from TMDB
  loadPosters();            // 2. posters for any cards typed by hand (like your Profile)
  loadBackdrops();          // 3. banner backgrounds
  loadIcons();              // 3b. small pictures (news, spotlight, directors)
  updateAllArrows();        // 4. refresh the slider arrows (from section 8)
}
loadEverything();


/* ============ 7b. IMDb RATINGS (via OMDb, because TMDB does not have IMDb ratings) ============ */
// Get a free key at https://www.omdbapi.com/apikey.aspx and paste it between the quotes.
// The OMDb key now lives on the server (environment variable OMDB_KEY), so visitors never see or type it.
var imdbOff = false;     // becomes true if the server has no OMDb key
function typeOf(m) { return m.media_type || (m.first_air_date || m.name ? "tv" : "movie"); }
async function getImdbRating(m) {
  if (imdbOff) { return null; }
  var cacheKey = "imdb:" + typeOf(m) + m.id;
  var saved = localStorage.getItem(cacheKey);
  if (saved !== null) { return saved === "" ? null : saved; }
  try {
    var ids = await (await fetch(TMDB_URL + "/" + typeOf(m) + "/" + m.id + "/external_ids?api_key=" + TMDB_KEY)).json();
    if (!ids.imdb_id) { return null; }
    var out = await (await fetch("/api/omdb?i=" + ids.imdb_id)).json();
    if (out.off) { imdbOff = true; return null; }
    if (!out.rating) { return null; }                       // not rated (or a hiccup): do not remember it
    var rating = out.rating;
    localStorage.setItem(cacheKey, rating);
    return rating || null;
  } catch (err) { console.error("IMDb lookup failed:", err); return null; }
}
// Show the IMDb rating in an element; keep the TMDB rating only if IMDb is unavailable
async function paintImdb(m, el, before, after) {
  var r = await getImdbRating(m);
  var shown = r || (m.vote_average ? m.vote_average.toFixed(1) : "");
  el.textContent = before + (shown ? "★ " + shown + after : "").replace(/ • $/, "");
}

/* ============ 8. SLIDER ARROWS ON EVERY POSTER ROW ============ */
// For each row of posters, this adds a "<" and a ">" button that slide the row.
var allRows = document.querySelectorAll(".row");

allRows.forEach(function (row) {
  // wrap the row in a box so the arrows can sit on top of it
  var slider = document.createElement("div");
  slider.className = "slider";
  row.parentNode.insertBefore(slider, row);

  var leftArrow = document.createElement("button");
  leftArrow.className = "arrow left";
  leftArrow.textContent = "‹";
  leftArrow.setAttribute("aria-label", "Scroll left");

  var rightArrow = document.createElement("button");
  rightArrow.className = "arrow right";
  rightArrow.textContent = "›";
  rightArrow.setAttribute("aria-label", "Scroll right");

  slider.appendChild(leftArrow);
  slider.appendChild(row);
  slider.appendChild(rightArrow);

  // slide by about 80% of the visible width each click
  leftArrow.onclick = function () {
    row.scrollBy({ left: -row.clientWidth * 0.8, behavior: "smooth" });
  };
  rightArrow.onclick = function () {
    row.scrollBy({ left: row.clientWidth * 0.8, behavior: "smooth" });
  };

  // show or hide the arrows depending on whether there is more to scroll to
  row.updateArrows = function () {
    var canScroll = row.scrollWidth > row.clientWidth + 1;
    leftArrow.classList.toggle("hidden", !canScroll || row.scrollLeft <= 0);
    rightArrow.classList.toggle("hidden", !canScroll || row.scrollLeft + row.clientWidth >= row.scrollWidth - 1);
  };
  row.addEventListener("scroll", row.updateArrows);
});

function updateAllArrows() {
  allRows.forEach(function (row) { row.updateArrows(); });
}
window.addEventListener("resize", updateAllArrows);
window.addEventListener("hashchange", updateAllArrows);                // a different page was opened
document.getElementById("search").addEventListener("input", updateAllArrows);  // search hid some posters
updateAllArrows();


/* ============ 9. MOVIE POP-UP, REVIEWS AND WATCHLIST ============ */
var known = {};         // every movie/show we have seen, saved under a key like "movie-550"
var current = null;     // the movie/show that is open in the pop-up
var chosenStars = 0;    // the rating picked in the pop-up (1 to 5)

function remember(m) {
  m.media_type = m.media_type || (m.first_air_date !== undefined ? "tv" : "movie");
  var key = m.media_type + "-" + m.id;
  known[key] = m;
  return key;
}
function nameOf(m) { return m.title || m.name; }
function yearOf(m) { return (m.release_date || m.first_air_date || "").slice(0, 4); }
function starText(n) { return "★".repeat(n) + "☆".repeat(5 - n); }

// Reviews and watchlist are saved in the browser (localStorage), so they stay after refreshing.
// To keep them on a server later, replace these two functions.
function scopedKey(name) { return name + ":" + (sessionUser || "guest"); }   // every account has its own lists
function getList(name) {
  try { return JSON.parse(localStorage.getItem(scopedKey(name))) || []; } catch (e) { return []; }
}
function saveList(name, list) {
  try { localStorage.setItem(scopedKey(name), JSON.stringify(list)); }
  catch (e) { showMessage("Could not save: your browser blocked storage."); }
}

// Build one review row for the page
function reviewElement(r, showTitle) {
  var row = document.createElement("div");
  row.className = "item";
  var inner = document.createElement("span");

  if (showTitle) {
    var title = document.createElement("b");
    title.textContent = r.title + " ";
    inner.appendChild(title);
  }
  var starsEl = document.createElement("span");
  starsEl.className = "star";
  starsEl.textContent = starText(r.stars);
  inner.appendChild(starsEl);

  if (r.text) {
    inner.appendChild(document.createElement("br"));
    inner.appendChild(document.createTextNode(r.text));
  }
  var date = document.createElement("small");
  date.textContent = "Reviewed " + r.date;
  inner.appendChild(document.createElement("br"));
  inner.appendChild(date);

  if (showTitle) {                                   // Profile reviews get a small poster icon
    var thumb = document.createElement("div");
    thumb.className = "pic tall";
    if (r.poster) {
      thumb.classList.add("has-image");
      thumb.style.backgroundImage = "url(" + POSTER_URL + r.poster + ")";
    }
    row.classList.add("with-pic");
    row.appendChild(thumb);
  }
  var del = document.createElement("button");        // delete this review
  del.className = "btn small";
  del.textContent = "✕";
  del.title = "Delete review";
  del.onclick = function () {
    if (!confirm("Delete this review?")) { return; }
    saveList("filmlify_reviews", getList("filmlify_reviews").filter(function (x) { return x.id !== r.id; }));
    renderProfile();
    if (current) { paintReviews(); }
  };
  var edit = document.createElement("button");       // edit this review
  edit.className = "btn small";
  edit.textContent = "Edit";
  edit.title = "Edit review";
  edit.onclick = function () { openEditReview(r); };
  row.appendChild(inner);
  row.appendChild(edit);
  row.appendChild(del);
  return row;
}

// Fill the Profile page (reviews + watchlist)
function renderProfile() {
  renderFavorites("favFilms", 5, "films");
  renderFavorites("favShows", 5, "shows");
  renderRecentWatched();
  updateStats();       // the numbers at the top of the Profile
  renderGenres();      // the Favorite Genre bars
  ensureReviewIds();   // older reviews get an id so they can be deleted
  renderCustomLists();
  var reviewBox = document.getElementById("reviewList");
  reviewBox.replaceChildren();
  var reviews = getList("filmlify_reviews").slice().reverse();      // newest first
  if (reviews.length === 0) { reviewBox.textContent = "No reviews yet. Click any poster to write one."; }
  reviews.forEach(function (r) { reviewBox.appendChild(reviewElement(r, true)); });

  var listBox = document.getElementById("myWatchlist");
  listBox.replaceChildren();
  if (getList("filmlify_watchlist").length === 0) { listBox.textContent = "Your watchlist is empty. Use + Add title below."; }
  getList("filmlify_watchlist").forEach(function (w) {
    var row = document.createElement("div");
    row.className = "item";
    var label = document.createElement("span");
    label.textContent = w.title + (w.year ? " (" + w.year + ")" : "");
    var remove = document.createElement("button");
    remove.className = "btn";
    remove.textContent = "Remove";
    remove.onclick = function () {
      saveList("filmlify_watchlist", getList("filmlify_watchlist").filter(function (x) { return x.key !== w.key; }));
      renderProfile();
      paintWatchlistButton();
    };
    var editW = document.createElement("button");         // edit: change this entry to another title
    editW.className = "btn";
    editW.textContent = "Edit";
    editW.title = "Change title";
    editW.onclick = async function () {
      var found = await askTitle("Change this to which title?", w.title);
      if (!found) { return; }
      remember(found);
      var newKey = found.media_type + "-" + found.id;
      var all = getList("filmlify_watchlist");
      if (newKey !== w.key && all.some(function (x) { return x.key === newKey; })) { showMessage("That title is already in your watchlist."); return; }
      saveList("filmlify_watchlist", all.map(function (x) { return x.key === w.key ? { key: newKey, title: nameOf(found), year: yearOf(found) } : x; }));
      renderProfile(); paintWatchlistButton();
    };
    row.appendChild(label);
    row.appendChild(editW);
    row.appendChild(remove);
    listBox.appendChild(row);
  });
  loadPosters();
}

function paintStars() {
  document.querySelectorAll(".star-btn").forEach(function (b) {
    b.classList.toggle("on", Number(b.dataset.value) <= chosenStars);
  });
}

function paintReviews() {
  var box = document.getElementById("mReviews");
  box.replaceChildren();
  var key = current.media_type + "-" + current.id;
  var mine = getList("filmlify_reviews").filter(function (r) { return r.key === key; }).reverse();
  if (mine.length === 0) { box.textContent = "No reviews yet. Be the first!"; }
  mine.forEach(function (r) { box.appendChild(reviewElement(r, false)); });
}

function paintWatchlistButton() {
  if (!current) { return; }
  var key = current.media_type + "-" + current.id;
  var inList = getList("filmlify_watchlist").some(function (w) { return w.key === key; });
  document.getElementById("mWatchlist").textContent = inList ? "✓ In Watchlist (click to remove)" : "+ Add to Watchlist";
}

function toggleWatchlist(m) {
  var key = m.media_type + "-" + m.id;
  var list = getList("filmlify_watchlist");
  var exists = list.some(function (w) { return w.key === key; });
  if (exists) {
    list = list.filter(function (w) { return w.key !== key; });
    showMessage("Removed from your watchlist.");
  } else {
    list.push({ key: key, title: nameOf(m), year: yearOf(m) });
    showMessage("Added to your watchlist!");
  }
  saveList("filmlify_watchlist", list);
  renderProfile();
  paintWatchlistButton();
}

// Open the pop-up for a movie/show
function openMovie(m) {
  remember(m);
  current = m;
  chosenStars = 0;
  document.getElementById("mTitle").textContent = nameOf(m);
  document.getElementById("mMeta").textContent =
    (m.media_type === "tv" ? "TV Show" : "Movie") + (yearOf(m) ? " • " + yearOf(m) : "") +
    (m.vote_average ? " • ★ " + m.vote_average.toFixed(1) : "");
  getImdbRating(m).then(function (r) {
    var meta = document.getElementById("mMeta");
    if (r && current === m) { meta.textContent = meta.textContent.replace(/ • ★ [\d.]+$/, "") + " • ★ " + r; }
  });
  document.getElementById("mOverview").textContent = m.overview || "No description available.";
  document.getElementById("mPoster").style.backgroundImage = m.poster_path ? "url(" + POSTER_URL + m.poster_path + ")" : "none";
  document.getElementById("reviewText").value = "";
  document.getElementById("reviewError").textContent = "";
  paintStars();
  paintReviews();
  paintWatchlistButton();
  paintWatchedButton();
  paintListSelect();
  loadDetails(m);
  document.getElementById("modal").classList.add("open");
}
function closeMovie() { document.getElementById("modal").classList.remove("open"); }

// Click a poster -> open its pop-up
document.addEventListener("click", async function (e) {
  var card = e.target.closest(".card");
  if (!card || e.target.closest(".quick")) { return; }
  if (!card.dataset.key) {                       // a card typed by hand: look it up first
    var found = await searchTMDB(card.querySelector("b").textContent);
    if (!found) { showMessage("Sorry, no details found for this title."); return; }
    card.dataset.key = remember(found);
  }
  openMovie(known[card.dataset.key]);
});

// Banner buttons: "More Info" opens the pop-up, "Add to List" adds to the watchlist
document.querySelectorAll(".hero[data-title], .spotlight[data-title]").forEach(function (hero) {
  hero.querySelectorAll(".btn").forEach(function (button) {
    button.onclick = async function () {
      var found = await searchTMDB(hero.dataset.title);
      if (!found) { showMessage("Sorry, no details found for this title."); return; }
      remember(found);
      if (button.classList.contains("add")) { toggleWatchlist(found); } else { openMovie(found); }
    };
  });
});

// Pop-up buttons
document.querySelectorAll(".star-btn").forEach(function (b) {
  b.onclick = function () { chosenStars = Number(b.dataset.value); paintStars(); };
});
document.getElementById("mWatchlist").onclick = function () { toggleWatchlist(current); };
document.getElementById("closeModal").onclick = closeMovie;
document.getElementById("modal").onclick = function (e) { if (e.target === this) { closeMovie(); } };

// The single "Done" button: saves the review (if you gave one) and closes the pop-up
document.getElementById("postReview").onclick = function () {
  var text = document.getElementById("reviewText").value.trim();

  if (chosenStars === 0 && text === "") { closeMovie(); return; }     // nothing to save, just close
  if (chosenStars === 0) {
    document.getElementById("reviewError").textContent = "Please pick a star rating first.";
    return;
  }

  var reviews = getList("filmlify_reviews");
  reviews.push({
    id: Date.now(),
    key: current.media_type + "-" + current.id,
    title: nameOf(current),
    poster: current.poster_path || "",
    genres: genreNames(current),
    stars: chosenStars,
    text: text,
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  });
  saveList("filmlify_reviews", reviews);
  addWatched(current);      // reviewing a movie counts it as watched
  renderProfile();
  closeMovie();
  showMessage("Review saved! You can see it on your Profile.");
};
renderProfile();

/* ============ 10. SEARCH DROP-DOWN LIST ============ */
// Type in the search box and a list of matching movies/shows appears underneath.
var searchBox = document.getElementById("search");
var suggestionBox = document.getElementById("suggestions");
var searchTimer = null;
var suggestions = [];        // the movies/shows shown in the list
var activeRow = -1;          // which row is highlighted with the arrow keys

function hideSuggestions() {
  suggestionBox.classList.remove("open");
  suggestions = [];
  activeRow = -1;
}

function showSuggestions() {
  suggestionBox.replaceChildren();
  if (suggestions.length === 0) {
    var none = document.createElement("div");
    none.className = "no-result";
    none.textContent = "No movies or shows found.";
    suggestionBox.appendChild(none);
  }
  suggestions.forEach(function (m, index) {
    var row = document.createElement("div");
    row.className = "suggestion" + (index === activeRow ? " active" : "");

    var thumb = document.createElement("div");
    thumb.className = "thumb";
    if (m.poster_path) { thumb.style.backgroundImage = "url(https://image.tmdb.org/t/p/w92" + m.poster_path + ")"; }

    var text = document.createElement("div");
    var name = document.createElement("b");
    name.textContent = nameOf(m);
    var info = document.createElement("small");
    info.textContent = (m.media_type === "tv" ? "TV Show" : "Movie") + (yearOf(m) ? " • " + yearOf(m) : "");
    text.appendChild(name);
    text.appendChild(document.createElement("br"));
    text.appendChild(info);

    row.appendChild(thumb);
    row.appendChild(text);
    row.onclick = function () { chooseSuggestion(m); };
    suggestionBox.appendChild(row);
  });
  suggestionBox.classList.add("open");
}

function chooseSuggestion(m) {
  hideSuggestions();
  searchBox.value = "";
  openMovie(m);
}

async function runSearch(text) {
  try {
    var response = await fetch(TMDB_URL + "/search/multi?query=" + encodeURIComponent(text) + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    if (searchBox.value.trim() !== text) { return; }      // the person kept typing: ignore this old answer
    suggestions = (data.results || []).filter(function (m) {
      return m.media_type === "movie" || m.media_type === "tv";
    }).slice(0, 6);
    activeRow = -1;
    showSuggestions();
  } catch (error) {
    console.error("Search failed:", error);
  }
}

searchBox.addEventListener("input", function () {
  clearTimeout(searchTimer);
  var text = searchBox.value.trim();
  if (text.length < 2) { hideSuggestions(); return; }
  searchTimer = setTimeout(function () { runSearch(text); }, 300);   // wait until typing pauses
});

searchBox.addEventListener("keydown", function (e) {
  if (e.key === "ArrowDown" && suggestions.length) { activeRow = (activeRow + 1) % suggestions.length; showSuggestions(); e.preventDefault(); }
  else if (e.key === "ArrowUp" && suggestions.length) { activeRow = (activeRow - 1 + suggestions.length) % suggestions.length; showSuggestions(); e.preventDefault(); }
  else if (e.key === "Enter" && suggestions.length) { chooseSuggestion(suggestions[activeRow >= 0 ? activeRow : 0]); }
});

document.addEventListener("click", function (e) {            // click anywhere else closes the list
  if (!e.target.closest(".search-wrap")) { hideSuggestions(); }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { hideSuggestions(); closeMovie(); }
});


/* ============ 11. IMAGE ICONS: PEOPLE, NEWS, SPOTLIGHT, DIRECTORS ============ */
var personCache = {};

// Look up a person (actor, director...) and return the best match that has a photo
async function searchPerson(name) {
  if (name in personCache) { return personCache[name]; }
  try {
    var response = await fetch(TMDB_URL + "/search/person?query=" + encodeURIComponent(name) + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    personCache[name] = (data.results || []).find(function (p) { return p.profile_path; }) || null;
    return personCache[name];
  } catch (error) {
    console.error("Person lookup failed for '" + name + "':", error);
    return null;
  }
}

// Every <div class="pic" data-title="..."> gets a poster, every data-person="..." gets a photo
async function loadIcons() {
  var icons = Array.from(document.querySelectorAll(".pic[data-title], .pic[data-person]"));
  await Promise.all(icons.map(async function (icon) {
    var url = "";
    if (icon.dataset.person) {
      var person = await searchPerson(icon.dataset.person);
      if (person) { url = PROFILE_URL + person.profile_path; }
    } else {
      var item = await searchTMDB(icon.dataset.title);
      if (item) { url = POSTER_URL + item.poster_path; }
    }
    if (url) {
      icon.style.backgroundImage = "url(" + url + ")";
      icon.classList.add("has-image");
    }
  }));
}

// Trending People: replace the typed names with this week's trending people from TMDB
async function fillPeople() {
  var row = document.getElementById("peopleRow");
  try {
    var response = await fetch(TMDB_URL + "/trending/person/week?api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    var people = (data.results || []).filter(function (p) { return p.profile_path; }).slice(0, 12);
    if (people.length === 0) { return; }
    row.replaceChildren();
    people.forEach(function (p) {
      var box = document.createElement("div");
      box.className = "person";
      var pic = document.createElement("div");
      pic.className = "pic round has-image";
      pic.style.backgroundImage = "url(" + PROFILE_URL + p.profile_path + ")";
      var name = document.createElement("div");
      name.textContent = p.name;
      var follow = document.createElement("button");
      follow.className = "btn small follow-btn";
      follow.dataset.name = p.name;
      box.appendChild(pic);
      box.appendChild(name);
      box.appendChild(follow);
      row.appendChild(box);
    });
    row.scrollLeft = 0;
    paintFollowButtons();
  } catch (error) {
    console.error("Could not load trending people:", error);
  }
}


/* ============ 12. PROFILE NUMBERS, WATCHED, FOLLOW AND FAVORITE GENRES ============ */
// TMDB sends genres as numbers. This list turns them into names.
var GENRE_NAMES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi", 10766: "Soap", 10767: "Talk", 10768: "War"
};
function genreNames(m) {
  return (m.genre_ids || []).map(function (id) { return GENRE_NAMES[id]; }).filter(Boolean);
}

// The five numbers at the top of the Profile. They start at 0 and grow as you use the site.
function updateStats() {
  document.getElementById("statFollowers").textContent = 0;    // real followers need other users
  document.getElementById("statFollowing").textContent = getList("filmlify_following").length;
  document.getElementById("statWatched").textContent = getList("filmlify_watched").length;
  document.getElementById("statReviews").textContent = getList("filmlify_reviews").length;
  document.getElementById("statWatchlist").textContent = getList("filmlify_watchlist").length;
}

// Favorite Genre: the percentages come from the genres of the movies/shows you reviewed
function renderGenres() {
  var box = document.getElementById("genreBars");
  box.replaceChildren();
  var counts = {}, total = 0;
  getList("filmlify_reviews").forEach(function (r) {
    (r.genres || []).forEach(function (g) { counts[g] = (counts[g] || 0) + 1; total++; });
  });
  var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 4);
  var rows = top.map(function (g) { return [g, Math.round(counts[g] / total * 100)]; });
  if (rows.length === 0) { box.textContent = "Review a movie or show and its genres will appear here."; return; }

  rows.forEach(function (row) {
    var g = row[0], percent = row[1];
    var label = document.createElement("div");
    label.style.display = "flex";
    label.style.justifyContent = "space-between";
    label.innerHTML = "<span></span><b></b>";
    label.firstChild.textContent = g;
    label.lastChild.textContent = percent + "%";
    var bar = document.createElement("div");
    bar.className = "bar";
    var fill = document.createElement("i");
    fill.style.width = percent + "%";
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
  });
}

// Watched list
function addWatched(m) {
  var key = m.media_type + "-" + m.id;
  var list = getList("filmlify_watched");
  if (!list.some(function (w) { return w.key === key; })) {
    list.push({ key: key, title: nameOf(m) });
    saveList("filmlify_watched", list);
  }
}
function toggleWatched(m) {
  var key = m.media_type + "-" + m.id;
  var list = getList("filmlify_watched");
  if (list.some(function (w) { return w.key === key; })) {
    saveList("filmlify_watched", list.filter(function (w) { return w.key !== key; }));
    showMessage("Removed from your watched list.");
  } else {
    addWatched(m);
    showMessage("Marked as watched!");
  }
  paintWatchedButton();
  renderProfile();
}
function paintWatchedButton() {
  if (!current) { return; }
  var key = current.media_type + "-" + current.id;
  var done = getList("filmlify_watched").some(function (w) { return w.key === key; });
  document.getElementById("mWatched").textContent = done ? "✓ Watched (click to undo)" : "Mark as Watched";
}
document.getElementById("mWatched").onclick = function () { toggleWatched(current); };

// Follow buttons (next to Trending People and Popular Directors)
function paintFollowButtons() {
  var following = getList("filmlify_following");
  document.querySelectorAll(".follow-btn").forEach(function (b) {
    b.textContent = following.indexOf(b.dataset.name) >= 0 ? "Following ✓" : "Follow";
  });
}
document.addEventListener("click", function (e) {
  var button = e.target.closest(".follow-btn");
  if (!button) { return; }
  var name = button.dataset.name;
  var following = getList("filmlify_following");
  if (following.indexOf(name) >= 0) {
    following = following.filter(function (n) { return n !== name; });
    showMessage("You unfollowed " + name + ".");
  } else {
    following.push(name);
    showMessage("You are now following " + name + "!");
  }
  saveList("filmlify_following", following);
  paintFollowButtons();
  renderProfile();
});
paintFollowButtons();
renderProfile();


/* ============ 13. FIX OLD REVIEWS: ADD THEIR POSTER AND GENRES ============ */
// Reviews saved before posters/genres were stored have neither. This asks TMDB for them
// once, saves them, and the Profile then shows the movie image in Recent Reviews.
async function fillMissingReviewData() {
  var reviews = getList("filmlify_reviews");
  var changed = false;

  for (var i = 0; i < reviews.length; i++) {
    var r = reviews[i];
    if (!r.key || (r.poster !== undefined && r.genres !== undefined)) { continue; }   // already complete

    var parts = r.key.split("-");                        // "movie-550" -> ["movie", "550"]
    try {
      var response = await fetch(TMDB_URL + "/" + parts[0] + "/" + parts[1] + "?api_key=" + TMDB_KEY);
      if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
      var data = await response.json();
      r.poster = data.poster_path || "";
      r.genres = (data.genres || []).map(function (g) { return GENRE_NAMES[g.id] || g.name; });
      changed = true;
    } catch (error) {
      console.error("Could not fetch details for review '" + r.title + "':", error);
    }
  }

  if (changed) {
    saveList("filmlify_reviews", reviews);
    renderProfile();
  }
}
fillMissingReviewData();


/* ============ 14. NEW EPISODES THIS WEEK (follows what is trending) ============ */
// Returns the show's newest episode if it airs within a week of today, otherwise null
function episodeThisWeek(details) {
  var DAY = 24 * 60 * 60 * 1000, now = Date.now();
  var next = details.next_episode_to_air, last = details.last_episode_to_air;
  if (next && next.air_date) {
    var t = new Date(next.air_date + "T00:00").getTime();
    if (t >= now - DAY && t <= now + 7 * DAY) { return next; }       // coming up this week
  }
  if (last && last.air_date) {
    var t2 = new Date(last.air_date + "T00:00").getTime();
    if (t2 >= now - 7 * DAY && t2 <= now + DAY) { return last; }     // aired in the last 7 days
  }
  return null;
}

function dayLabel(dateText) {
  var date = new Date(dateText + "T00:00");
  if (date.toDateString() === new Date().toDateString()) { return "Today"; }
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

async function fillEpisodes() {
  var list = document.getElementById("episodeList");
  try {
    var response = await fetch(TMDB_URL + "/trending/tv/week?api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    var shows = (data.results || []).slice(0, 12);          // look at the 12 most trending shows

    // ask TMDB for each show's newest episode
    var found = await Promise.all(shows.map(async function (show) {
      var r = await fetch(TMDB_URL + "/tv/" + show.id + "?api_key=" + TMDB_KEY);
      if (!r.ok) { return null; }
      var episode = episodeThisWeek(await r.json());
      return episode ? { show: show, episode: episode } : null;
    }));
    found = found.filter(Boolean).slice(0, 5);
    if (found.length === 0) { return; }                     // keep the typed rows

    list.replaceChildren();
    found.forEach(function (f) {
      var row = document.createElement("div");
      row.className = "item with-pic";
      row.dataset.key = remember(f.show);                    // clicking the row opens the show's pop-up

      var pic = document.createElement("div");
      pic.className = "pic tall";
      if (f.show.poster_path) {
        pic.classList.add("has-image");
        pic.style.backgroundImage = "url(" + POSTER_URL + f.show.poster_path + ")";
      }

      var text = document.createElement("span");
      var title = document.createElement("b");
      title.textContent = f.show.name;
      var info = document.createElement("small");
      info.textContent = "S" + f.episode.season_number + " E" + f.episode.episode_number + " • " + f.episode.name;
      text.appendChild(title);
      text.appendChild(document.createElement("br"));
      text.appendChild(info);

      var day = document.createElement("small");
      day.className = "day";
      day.textContent = "📅 " + dayLabel(f.episode.air_date);

      row.appendChild(pic);
      row.appendChild(text);
      row.appendChild(day);
      list.appendChild(row);
    });
  } catch (error) {
    console.error("Could not load new episodes:", error);
  }
}

// Click an episode row -> open that show's pop-up
document.addEventListener("click", function (e) {
  var row = e.target.closest(".item[data-key]");
  if (row && known[row.dataset.key]) { openMovie(known[row.dataset.key]); }
});


/* ============ 15. CLICKABLE GENRE CARDS ============ */
// TMDB's number for each TV genre. (TMDB has no "Thriller" TV genre, so it shows Crime + Mystery shows.)
var TV_GENRE_IDS = {
  "Drama": "18", "Sci-Fi": "10765", "Crime": "80", "Animation": "16",
  "Thriller": "80,9648", "Comedy": "35", "Mystery": "9648", "Documentary": "99"
};
var genreClicks = 0;     // lets us ignore old answers if you click several genres quickly

async function showGenre(card) {
  var name = card.textContent.trim();
  var myClick = ++genreClicks;

  document.querySelectorAll(".genres div").forEach(function (c) { c.classList.toggle("active", c === card); });
  var section = document.getElementById("genreResults");
  var row = document.getElementById("genreRow");
  document.getElementById("genreTitle").textContent = name + " TV Shows";
  section.hidden = false;
  row.textContent = "Loading...";

  try {
    var url = TMDB_URL + "/discover/tv?with_genres=" + encodeURIComponent(TV_GENRE_IDS[name]) +
              "&sort_by=popularity.desc&api_key=" + TMDB_KEY;
    var response = await fetch(url);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    if (myClick !== genreClicks) { return; }                 // another genre was clicked meanwhile

    var items = (data.results || []).filter(function (m) { return m.poster_path; });
    row.replaceChildren();
    if (items.length === 0) { row.textContent = "No shows found for this genre."; }
    items.forEach(function (m) { row.appendChild(makeCard(m)); });   // clicking a poster opens its pop-up
    row.scrollLeft = 0;
  } catch (error) {
    row.textContent = "Could not load shows. Check your internet connection.";
    console.error("Genre lookup failed:", error);
  }
  updateAllArrows();
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll(".genres div").forEach(function (card) {
  card.onclick = function () { showGenre(card); };
  card.onkeydown = function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showGenre(card); }
  };
});


/* ============ 16. RICHER POP-UP: CAST, TRAILER, WHERE TO WATCH, SIMILAR ============ */
function addFact(box, label, text) {
  if (!text) { return; }
  var p = document.createElement("p");
  var b = document.createElement("b");
  b.textContent = label + ": ";
  p.appendChild(b);
  p.appendChild(document.createTextNode(text));
  box.appendChild(p);
}

async function loadDetails(m) {
  var extra = document.getElementById("mExtra");
  var similar = document.getElementById("mSimilar");
  extra.textContent = "Loading details...";
  similar.replaceChildren();
  try {
    var url = TMDB_URL + "/" + m.media_type + "/" + m.id +
              "?append_to_response=credits,videos,watch/providers,similar&api_key=" + TMDB_KEY;
    var response = await fetch(url);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var d = await response.json();
    if (!current || current.id !== m.id) { return; }          // a different pop-up is open now
    extra.replaceChildren();

    var minutes = d.runtime ? d.runtime + " min" : (d.episode_run_time && d.episode_run_time[0] ? d.episode_run_time[0] + " min per episode" : "");
    var genres = (d.genres || []).map(function (g) { return g.name; }).join(", ");
    addFact(extra, "Details", [minutes, genres].filter(Boolean).join(" • "));
    addFact(extra, "Cast", ((d.credits || {}).cast || []).slice(0, 6).map(function (c) { return c.name; }).join(", "));

    var regions = (d["watch/providers"] || {}).results || {};
    var region = regions.PH || regions.US;                    // Philippines first, then USA
    var where = region && region.flatrate ? region.flatrate.map(function (p) { return p.provider_name; }).join(", ") : "";
    addFact(extra, "Where to watch", where || "not listed for your region");

    var trailer = ((d.videos || {}).results || []).find(function (v) { return v.site === "YouTube" && v.type === "Trailer"; });
    if (trailer) {
      var link = document.createElement("a");
      link.className = "btn";
      link.textContent = "▶ Watch Trailer";
      link.href = "https://www.youtube.com/watch?v=" + trailer.key;
      link.target = "_blank";
      link.rel = "noopener";
      extra.appendChild(link);
    }

    ((d.similar || {}).results || []).filter(function (x) { return x.poster_path; }).slice(0, 10).forEach(function (x) {
      x.media_type = m.media_type;
      similar.appendChild(makeCard(x));                       // click one to open it
    });
    updateAllArrows();
  } catch (error) {
    extra.textContent = "";
    console.error("Could not load details:", error);
  }
}

/* ============ 17. HOVER QUICK ACTIONS (♥ ✓ +) ============ */
document.addEventListener("click", function (e) {
  var button = e.target.closest(".quick button");
  if (!button) { return; }
  var m = known[button.closest(".card").dataset.key];
  if (!m) { return; }
  if (button.dataset.action === "watchlist") { toggleWatchlist(m); }
  else if (button.dataset.action === "watched") { toggleWatched(m); }
  else {
    var key = m.media_type + "-" + m.id;
    var liked = getList("filmlify_liked");
    if (liked.indexOf(key) >= 0) { liked = liked.filter(function (k) { return k !== key; }); showMessage("Removed your like."); }
    else { liked.push(key); showMessage("You liked " + nameOf(m) + "!"); }
    saveList("filmlify_liked", liked);
    button.classList.toggle("liked", liked.indexOf(key) >= 0);
  }
});

/* ============ 18. DELETE REVIEWS, CUSTOM LISTS, EDIT PROFILE ============ */
function ensureReviewIds() {
  var reviews = getList("filmlify_reviews"), fixed = false;
  reviews.forEach(function (r, i) { if (!r.id) { r.id = Date.now() + i; fixed = true; } });
  if (fixed) { saveList("filmlify_reviews", reviews); }
}

function renderCustomLists() {
  var box = document.getElementById("customLists");
  box.replaceChildren();
  var lists = getList("filmlify_customlists");
  if (lists.length === 0) { box.textContent = "No lists yet. Create one below."; }
  lists.forEach(function (l) {
    var row = document.createElement("div");
    row.className = "item";
    var info = document.createElement("span");
    var name = document.createElement("b");
    name.textContent = l.name + " (" + l.items.length + ")";
    info.appendChild(name);
    if (l.items.length) {
      var titles = document.createElement("small");
      titles.textContent = l.items.map(function (i) { return i.title; }).join(", ");
      info.appendChild(document.createElement("br"));
      info.appendChild(titles);
    }
    var del = document.createElement("button");
    del.className = "btn small";
    del.textContent = "✕";
    del.title = "Delete list";
    del.onclick = function () {
      saveList("filmlify_customlists", getList("filmlify_customlists").filter(function (x) { return x.id !== l.id; }));
      renderCustomLists();
      paintListSelect();
    };
    var rename = document.createElement("button");        // edit: rename the list
    rename.className = "btn small";
    rename.textContent = "Edit";
    rename.title = "Rename list";
    rename.onclick = function () {
      var fresh = (prompt("New name for this list:", l.name) || "").trim();
      if (!fresh) { return; }
      var all = getList("filmlify_customlists");
      all.forEach(function (x) { if (x.id === l.id) { x.name = fresh; } });
      saveList("filmlify_customlists", all);
      renderCustomLists(); paintListSelect();
    };
    info.style.cursor = "pointer";
    info.title = "Open this list";
    info.onclick = function () { openCustomList(l.id); };
    var add = document.createElement("button");           // add a movie or TV show to this list
    add.className = "btn small";
    add.textContent = "+ Add";
    add.title = "Add a movie or TV show";
    add.onclick = function () { addToCustomList(l.id); };
    row.appendChild(info);
    row.appendChild(add);
    row.appendChild(rename);
    row.appendChild(del);
    box.appendChild(row);
  });
}

function paintListSelect() {
  var select = document.getElementById("mListSelect");
  select.replaceChildren();
  var lists = getList("filmlify_customlists");
  if (lists.length === 0) { select.appendChild(new Option("Create a list on your Profile first", "")); }
  lists.forEach(function (l) { select.appendChild(new Option(l.name, l.id)); });
}

document.getElementById("createList").onclick = function () {
  var input = document.getElementById("newListName");
  var name = input.value.trim();
  if (!name) { showMessage("Type a name for your list first."); return; }
  var lists = getList("filmlify_customlists");
  lists.push({ id: Date.now(), name: name, items: [] });
  saveList("filmlify_customlists", lists);
  input.value = "";
  renderCustomLists();
  showMessage("List created!");
};

document.getElementById("mListAdd").onclick = function () {
  var id = document.getElementById("mListSelect").value;
  if (!id || !current) { showMessage("Create a list on your Profile page first."); return; }
  var lists = getList("filmlify_customlists");
  var list = lists.find(function (l) { return String(l.id) === id; });
  var key = current.media_type + "-" + current.id;
  if (list.items.some(function (i) { return i.key === key; })) { showMessage("Already in " + list.name + "."); return; }
  list.items.push({ key: key, title: nameOf(current) });
  saveList("filmlify_customlists", lists);
  renderCustomLists();
  showMessage("Added to " + list.name + "!");
};


/* ============ 18b. PROFILE: favorites, recent watched, watchlist (create / edit / delete) ============ */
function posterCard(title) {
  var card = document.createElement("div"); card.className = "card";
  var poster = document.createElement("div"); poster.className = "poster";
  var name = document.createElement("b"); name.textContent = title;
  card.appendChild(poster); card.appendChild(name);
  card.title = title;                       // the name shows when you hover (the text under the poster is hidden)
  return card;
}
// small ✎ / ✕ buttons shown on top of a poster
function toolButton(symbol, tip, action) {
  var b = document.createElement("button"); b.className = "tool"; b.textContent = symbol; b.title = tip;
  b.onclick = function (e) { e.stopPropagation(); action(); };
  return b;
}
// Pop-up with a search box: type, see matching posters, click one to choose it (resolves to the TMDB item, or null)
function askTitle(question, current, kind) {      // kind: "movie", "tv", or nothing for both
  return new Promise(function (resolve) {
    var modal = document.getElementById("pickModal"), input = document.getElementById("pickInput");
    var box = document.getElementById("pickResults"), timer = null;
    document.getElementById("pickTitle").textContent = question;
    input.placeholder = kind === "movie" ? "Search movies..." : kind === "tv" ? "Search TV shows..." : "Search movies or TV shows...";
    input.value = current || ""; box.replaceChildren(); modal.classList.add("open"); input.focus(); input.select();

    function close(result) {
      clearTimeout(timer);
      modal.classList.remove("open");
      input.oninput = null; input.onkeydown = null; modal.onclick = null;
      document.getElementById("pickCancel").onclick = null;
      resolve(result);
    }
    async function search() {
      var q = input.value.trim();
      if (q.length < 2) { box.textContent = "Type at least 2 letters."; return; }
      box.textContent = "Searching...";
      try {
        var response = await fetch(TMDB_URL + "/search/" + (kind || "multi") + "?query=" + encodeURIComponent(q) + "&api_key=" + TMDB_KEY);
        var data = await response.json();
        if (input.value.trim() !== q) { return; }            // the person kept typing: ignore this answer
        var items = (data.results || []).filter(function (m) {
          if (kind) { m.media_type = kind; return true; }    // movie-only or TV-only search
          return m.media_type === "movie" || m.media_type === "tv";
        }).slice(0, 8);
        box.replaceChildren();
        if (items.length === 0) { box.textContent = "No results for \"" + q + "\"."; return; }
        items.forEach(function (m) {
          var row = document.createElement("div"); row.className = "pick-item";
          var pic = document.createElement("div"); pic.className = "mini-poster";
          if (m.poster_path) { pic.style.backgroundImage = "url(" + POSTER_URL + m.poster_path + ")"; }
          var info = document.createElement("span");
          var name = document.createElement("b"); name.textContent = nameOf(m);
          var meta = document.createElement("small"); meta.textContent = (m.media_type === "tv" ? "TV Show" : "Movie") + (yearOf(m) ? " • " + yearOf(m) : "");
          info.appendChild(name); info.appendChild(document.createElement("br")); info.appendChild(meta);
          row.appendChild(pic); row.appendChild(info);
          row.onclick = function () { remember(m); close(m); };
          box.appendChild(row);
        });
      } catch (e) { box.textContent = "Could not reach TMDB. Check your internet connection."; }
    }
    input.oninput = function () { clearTimeout(timer); timer = setTimeout(search, 350); };
    input.onkeydown = function (e) {
      if (e.key === "Escape") { close(null); }
      if (e.key === "Enter") { clearTimeout(timer); search(); }
    };
    document.getElementById("pickCancel").onclick = function () { close(null); };
    modal.onclick = function (e) { if (e.target === modal) { close(null); } };
    if (current) { search(); }
  });
}
function getFavs(type) { try { return JSON.parse(localStorage.getItem("filmlify_fav_" + type + ":" + (sessionUser || "guest"))) || []; } catch (e) { return []; } }
function setFavs(type, list) { try { localStorage.setItem("filmlify_fav_" + type + ":" + (sessionUser || "guest"), JSON.stringify(list)); } catch (e) {} }

function renderFavorites(rowId, max, type) {
  var row = document.getElementById(rowId);
  row.replaceChildren();
  var list = getFavs(type);
  list.forEach(function (title, index) {
    var card = posterCard(title);
    var tools = document.createElement("div"); tools.className = "tools";
    tools.appendChild(toolButton("✏️", "Change this title", async function () {          // UPDATE
      var found = await askTitle("Change this favorite " + (type === "films" ? "film" : "TV show"), title, type === "films" ? "movie" : "tv");
      if (!found) { return; }
      var all = getFavs(type);
      if (all.indexOf(nameOf(found)) !== -1 && nameOf(found) !== title) { showMessage("That title is already in your favorites."); return; }
      all[index] = nameOf(found); setFavs(type, all); renderFavorites(rowId, max, type); loadPosters();
    }));
    tools.appendChild(toolButton("✕", "Remove from favorites", function () {            // DELETE
      if (!confirm("Remove " + title + " from your favorites?")) { return; }
      var all = getFavs(type); all.splice(index, 1); setFavs(type, all); renderFavorites(rowId, max, type);
    }));
    card.appendChild(tools);
    row.appendChild(card);
  });
  for (var i = list.length; i < max; i++) {                                              // CREATE: empty "+" slots
    var slot = document.createElement("div"); slot.className = "card-slot"; slot.textContent = "+"; slot.title = "Add a favorite";
    slot.onclick = async function () {
      if (!currentUser()) { showMessage("Please log in first."); return; }
      var found = await askTitle("Add a favorite " + (type === "films" ? "film" : "TV show"), "", type === "films" ? "movie" : "tv");
      if (!found) { return; }
      var all = getFavs(type);
      if (all.indexOf(nameOf(found)) !== -1) { showMessage("That title is already in your favorites."); return; }
      all.push(nameOf(found)); setFavs(type, all); renderFavorites(rowId, max, type); loadPosters();
    };
    row.appendChild(slot);
  }
}
function renderRecentWatched() {
  var row = document.getElementById("recentWatched");
  row.replaceChildren();
  var all = getList("filmlify_watched");
  if (all.length === 0) {
    var note = document.createElement("p"); note.className = "empty-note";
    note.textContent = "Nothing watched yet. Open a movie or show and mark it as watched.";
    row.appendChild(note); return;
  }
  all.slice(-5).reverse().forEach(function (w) {
    var card = posterCard(w.title);
    var tools = document.createElement("div"); tools.className = "tools";
    tools.appendChild(toolButton("✕", "Remove from watched", function () {
      saveList("filmlify_watched", getList("filmlify_watched").filter(function (x) { return x.key !== w.key; }));
      renderProfile();
    }));
    card.appendChild(tools);
    row.appendChild(card);
  });
}
document.getElementById("addWatchTitle").onclick = async function () {     // CREATE a watchlist entry by title
  if (!currentUser()) { showMessage("Please log in first."); return; }
  var found = await askTitle("Which movie or show do you want to add to your watchlist?");
  if (!found) { return; }
  remember(found);
  var key = found.media_type + "-" + found.id;
  var list = getList("filmlify_watchlist");
  if (list.some(function (w) { return w.key === key; })) { showMessage("That title is already in your watchlist."); return; }
  list.push({ key: key, title: nameOf(found), year: yearOf(found) });
  saveList("filmlify_watchlist", list);
  renderProfile(); paintWatchlistButton();
  showMessage("Added to your watchlist!");
};
document.getElementById("shareProfile").onclick = async function () {
  var text = "Check out my Filmlify profile: @" + (currentUser() || "guest");
  try {
    if (navigator.share) { await navigator.share({ title: "Filmlify", text: text, url: location.origin }); }
    else { await navigator.clipboard.writeText(text + " " + location.origin); showMessage("Profile text copied!"); }
  } catch (e) { /* the person closed the share sheet */ }
};

// Edit Profile: full name, username and picture are saved on the server (so they follow your account).
// The short bio is kept in this browser.
function getBio() { return localStorage.getItem("filmlify_bio:" + currentUser()) || "Film Enthusiast"; }
function paintAvatar(box, name, picture) {
  box.style.backgroundImage = picture ? "url(" + picture + ")" : "none";
  box.textContent = picture ? "" : (name || "?").charAt(0).toUpperCase();
}
function paintProfileInfo() {
  var user = currentUser();
  var name = user ? (sessionName || user) : "Guest";
  document.getElementById("pName").textContent = name;
  document.getElementById("pBio").textContent = user ? "@" + user + " • " + getBio() : "Log in to see your profile";
  paintAvatar(document.getElementById("pAvatar"), name, user ? sessionAvatar : null);
}
// when the username changes, move this account's saved lists and favorites to the new name
function migrateLocalData(oldName, newName) {
  var suffix = ":" + oldName;
  Object.keys(localStorage).forEach(function (k) {
    if (k.indexOf("filmlify_") === 0 && k.slice(-suffix.length) === suffix) {
      localStorage.setItem(k.slice(0, -suffix.length) + ":" + newName, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
  });
}
// shrink the chosen photo to a 256 x 256 square JPEG
function readPhoto(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = reject;
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error("bad image")); };
      img.onload = function () {
        var canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
        var side = Math.min(img.width, img.height);
        canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
var newAvatar;     // undefined = keep the current picture, "" = remove it, or the new picture
function paintEditAvatar() {
  var shown = newAvatar === undefined ? sessionAvatar : (newAvatar || null);
  paintAvatar(document.getElementById("epAvatar"), document.getElementById("epName").value || sessionName || currentUser(), shown);
}
document.getElementById("editProfile").onclick = function () {
  if (!currentUser()) { showMessage("Please log in first."); return; }
  newAvatar = undefined;
  document.getElementById("epName").value = sessionName || currentUser();
  document.getElementById("epUser").value = currentUser();
  document.getElementById("epBio").value = getBio() === "Film Enthusiast" ? "" : getBio();
  document.getElementById("epError").textContent = "";
  paintEditAvatar();
  document.getElementById("editProfileModal").classList.add("open");
};
document.getElementById("epPick").onclick = function () { document.getElementById("epFile").click(); };
document.getElementById("epFile").onchange = async function () {
  var file = this.files[0]; this.value = "";
  if (!file) { return; }
  if (!/^image\//.test(file.type)) { document.getElementById("epError").textContent = "Please choose an image file."; return; }
  try { newAvatar = await readPhoto(file); document.getElementById("epError").textContent = ""; paintEditAvatar(); }
  catch (e) { document.getElementById("epError").textContent = "That picture could not be read. Try another one."; }
};
document.getElementById("epRemove").onclick = function () { newAvatar = ""; paintEditAvatar(); };
document.getElementById("epName").oninput = paintEditAvatar;       // the letter follows the name when there is no picture
function closeEditProfile() { document.getElementById("editProfileModal").classList.remove("open"); }
document.getElementById("epCancel").onclick = closeEditProfile;
document.getElementById("editProfileModal").onclick = function (e) { if (e.target === this) { closeEditProfile(); } };
document.getElementById("epSave").onclick = async function () {
  var btn = this, error = document.getElementById("epError");
  var name = document.getElementById("epName").value.trim().replace(/\s+/g, " ");
  var username = document.getElementById("epUser").value.trim();
  if (name.length < 2) { error.textContent = "Please enter your full name."; return; }
  if (!/^[\w.\- ]{3,30}$/.test(username)) { error.textContent = "Username must be 3-30 letters, numbers or . _ -"; return; }
  var body = { name: name, username: username };
  if (newAvatar !== undefined) { body.avatar = newAvatar; }
  btn.disabled = true; btn.textContent = "Saving...";
  var result = await callApi("PUT", "/api/profile", body);
  btn.disabled = false; btn.textContent = "Save changes";
  if (result.error) { error.textContent = result.error; return; }
  var oldUser = currentUser();
  if (result.user !== oldUser) { migrateLocalData(oldUser, result.user); }
  sessionUser = result.user; sessionName = result.name; sessionAvatar = result.avatar || null;
  var bio = document.getElementById("epBio").value.trim();
  if (bio) { localStorage.setItem("filmlify_bio:" + result.user, bio); } else { localStorage.removeItem("filmlify_bio:" + result.user); }
  paintLoginLink(); paintProfileInfo(); renderProfile();
  closeEditProfile();
  showMessage("Profile updated!");
};
paintProfileInfo();
renderProfile();

/* ============ 19. BROWSE PAGE WITH FILTERS ============ */
var MOVIE_GENRES = [[28, "Action"], [12, "Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"], [99, "Documentary"], [18, "Drama"], [14, "Fantasy"], [27, "Horror"], [9648, "Mystery"], [10749, "Romance"], [878, "Sci-Fi"], [53, "Thriller"]];
var TV_GENRES_LIST = [[10759, "Action & Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"], [99, "Documentary"], [18, "Drama"], [9648, "Mystery"], [10765, "Sci-Fi & Fantasy"]];
var browsePage = 1;
var fType = document.getElementById("fType"), fGenre = document.getElementById("fGenre"), fYear = document.getElementById("fYear");
var fRating = document.getElementById("fRating"), fSort = document.getElementById("fSort");
var browseGrid = document.getElementById("browseGrid"), loadMore = document.getElementById("loadMore");

function fillGenreFilter() {
  fGenre.replaceChildren(new Option("Any genre", ""));
  (fType.value === "movie" ? MOVIE_GENRES : TV_GENRES_LIST).forEach(function (g) { fGenre.appendChild(new Option(g[1], g[0])); });
}
fYear.appendChild(new Option("Any year", ""));
for (var year = 2026; year >= 1970; year--) { fYear.appendChild(new Option(year, year)); }

async function runBrowse(more) {
  if (more) { browsePage++; } else { browsePage = 1; browseGrid.textContent = "Loading..."; }
  var type = fType.value;
  var sort = fSort.value;
  if (type === "tv" && sort === "primary_release_date.desc") { sort = "first_air_date.desc"; }
  // "Highest rated" only counts well-known titles (many votes), like IMDb's Top 250 does.
  // Without this, obscure titles with a handful of 10-star votes jump to the top.
  var minVotes = 100;
  if (sort === "vote_average.desc") {
    var narrowed = fGenre.value || fYear.value;
    minVotes = type === "movie" ? (narrowed ? 1500 : 7500) : (narrowed ? 500 : 2500);
  }
  var params = ["sort_by=" + sort, "page=" + browsePage, "vote_count.gte=" + minVotes];
  if (fGenre.value) { params.push("with_genres=" + fGenre.value); }
  if (fYear.value) { params.push((type === "movie" ? "primary_release_year=" : "first_air_date_year=") + fYear.value); }
  if (fRating.value) { params.push("vote_average.gte=" + fRating.value); }
  try {
    var response = await fetch(TMDB_URL + "/discover/" + type + "?" + params.join("&") + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    if (!more) { browseGrid.replaceChildren(); }
    var items = (data.results || []).filter(function (m) { return m.poster_path; });
    if (!more && items.length === 0) { browseGrid.textContent = "No results. Try different filters."; }
    items.forEach(function (m) { m.media_type = type; browseGrid.appendChild(makeCard(m)); });
    loadMore.hidden = browsePage >= data.total_pages;
  } catch (error) {
    browseGrid.textContent = "Could not load results. Check your internet connection.";
    console.error("Browse failed:", error);
  }
}
fType.onchange = function () { fillGenreFilter(); runBrowse(false); };
[fGenre, fYear, fRating, fSort].forEach(function (f) { f.onchange = function () { runBrowse(false); }; });
loadMore.onclick = function () { runBrowse(true); };
fillGenreFilter();
runBrowse(false);

/* ============ 19b. PAYMENT, TICKETS AND MY BOOKINGS ============ */
var myBookingsList = [];
async function loadBookedSeats() {
  if (!document.getElementById("bookTitle").textContent) { return; }      // no movie chosen yet
  var key = bookingKey();
  var data = await callApi("GET", "/api/taken?key=" + encodeURIComponent(key));
  if (key === bookingKey() && data.seats) { bookedSeats = data.seats; paintSeats(); }
}
async function loadMyBookings() {
  var data = currentUser() ? await callApi("GET", "/api/bookings") : {};
  myBookingsList = data.bookings || [];
  renderBookings();
}
var payModal = document.getElementById("payModal");
var payLabel = "Pay now";          // the Pay button shows the total, like "Pay ₱ 340.00"

// one line of the receipt in the payment pop-up
function addPayRow(box, label, value, extraClass) {
  var row = document.createElement("div");
  row.className = "pay-row" + (extraClass ? " " + extraClass : "");
  var name = document.createElement("span");
  name.textContent = label;
  var text = document.createElement("b");
  text.textContent = value;
  row.appendChild(name);
  row.appendChild(text);
  box.appendChild(row);
}
function el(id) { return document.getElementById(id); }

document.getElementById("payBtn").onclick = function () {
  if (!currentUser()) { showMessage("Please log in first."); location.hash = "#login"; return; }
  if (chosen.length === 0) { showMessage("Please select at least one seat."); return; }
  refreshTimes(); updateSummary();
  if (el("date").value < todayISO()) { showMessage("That date has passed. Please pick today or a later date."); return; }
  var receipt = el("paySummary");
  receipt.replaceChildren();
  addPayRow(receipt, "Movie", el("bookTitle").textContent);
  addPayRow(receipt, "Cinema", el("cinema").value);
  addPayRow(receipt, "Date & time", el("date").value + " • " + document.querySelector("#times .chosen").textContent);
  addPayRow(receipt, "Seats", chosen.join(", ") + " (" + chosen.length + ")");
  addPayRow(receipt, "Total", el("sumTotal").textContent, "pay-total");
  payLabel = "Pay " + el("sumTotal").textContent;
  el("confirmPay").textContent = payLabel;
  el("payError").textContent = ""; el("payStep1").style.display = "block"; el("payStep2").style.display = "none";
  payModal.classList.add("open");
};
el("cancelPay").onclick = function () { payModal.classList.remove("open"); };
el("payMethod").onchange = function () {
  var card = this.value === "Card";
  // highlight the matching tile
  document.querySelectorAll("#payMethods .pay-method").forEach(function (tile) {
    var picked = tile.dataset.method === el("payMethod").value;
    tile.classList.toggle("on", picked);
    tile.setAttribute("aria-checked", picked ? "true" : "false");
  });
  if (!card) { el("walletLabel").textContent = this.value + " mobile number"; }
  el("cardBox").style.display = card ? "block" : "none";
  el("walletBox").style.display = card ? "none" : "block";
};
// clicking a tile picks that payment method
document.getElementById("payMethods").addEventListener("click", function (e) {
  var tile = e.target.closest(".pay-method");
  if (!tile) { return; }
  el("payMethod").value = tile.dataset.method;
  el("payMethod").dispatchEvent(new Event("change"));
  el("payError").textContent = "";
});
el("cardNum").oninput = function () { this.value = this.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim(); };
el("cardExp").oninput = function () { var d = this.value.replace(/\D/g, "").slice(0, 4); this.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d; };

function luhn(num) {
  var sum = 0, flip = false;
  for (var i = num.length - 1; i >= 0; i--) {
    var d = parseInt(num[i], 10); if (flip) { d *= 2; if (d > 9) { d -= 9; } } sum += d; flip = !flip;
  }
  return num.length >= 13 && sum % 10 === 0;
}
function payProblem() {
  var method = el("payMethod").value;
  if (method !== "Card") { return /^09\d{9}$/.test(el("payMobile").value) ? "" : "Enter a valid mobile number (09XXXXXXXXX)."; }
  var num = el("cardNum").value.replace(/\s/g, ""), exp = el("cardExp").value.match(/^(\d\d)\/(\d\d)$/);
  if (!el("cardName").value.trim()) { return "Enter the name on the card."; }
  if (!luhn(num)) { return "That card number is not valid."; }
  if (!exp || +exp[1] < 1 || +exp[1] > 12) { return "Enter the expiry as MM/YY."; }
  var now = new Date();
  if (2000 + +exp[2] < now.getFullYear() || (2000 + +exp[2] === now.getFullYear() && +exp[1] < now.getMonth() + 1)) { return "That card has expired."; }
  if (!/^\d{3,4}$/.test(el("cardCvv").value)) { return "Enter the 3 or 4 digit CVV."; }
  return "";
}
el("confirmPay").onclick = async function () {
  var problem = payProblem();
  el("payError").textContent = problem;
  if (problem) { return; }
  var btn = this; btn.disabled = true; btn.textContent = "Processing...";
  await new Promise(function (r) { setTimeout(r, 1200); });          // pretend the payment provider is working
  // Only the booking is sent to the server. Card and phone details never leave this page.
  var result = await callApi("POST", "/api/bookings", {
    key: bookingKey(), movie: el("bookTitle").textContent, cinema: el("cinema").value, date: el("date").value,
    time: document.querySelector("#times .chosen").textContent, seats: chosen.slice(), method: el("payMethod").value
  });
  btn.disabled = false; btn.textContent = payLabel;
  if (result.error) { el("payError").textContent = result.error; loadBookedSeats(); return; }
  var booking = result.booking;
  chosen.length = 0; updateSummary(); await loadBookedSeats(); await loadMyBookings();
  ["payMobile", "cardName", "cardNum", "cardExp", "cardCvv"].forEach(function (id) { el(id).value = ""; });
  el("ticketBox").innerHTML = "";
  [["Reference", booking.ref], ["Movie", booking.movie], ["Cinema", booking.cinema], ["Date & Time", booking.date + " • " + booking.time],
   ["Seats", booking.seats.join(", ")], ["Paid with", booking.method], ["Total", "₱ " + booking.total.toFixed(2)]].forEach(function (r) {
    var p = document.createElement("p"); var x = document.createElement("span"); var y = document.createElement("span");
    x.textContent = r[0]; y.textContent = r[1]; p.appendChild(x); p.appendChild(y); el("ticketBox").appendChild(p);
  });
  el("payStep1").style.display = "none"; el("payStep2").style.display = "block";
};
el("closeTicket").onclick = function () { payModal.classList.remove("open"); };

// My Bookings list on the Profile page
var bookingsSection = document.createElement("section");
bookingsSection.className = "block";
document.getElementById("profile").appendChild(bookingsSection);
function renderBookings() {
  bookingsSection.replaceChildren();
  var title = document.createElement("h2"); title.textContent = "My Bookings"; bookingsSection.appendChild(title);
  var mine = myBookingsList;
  if (mine.length === 0) { var none = document.createElement("small"); none.textContent = "No bookings yet. Book a movie in In Theater."; bookingsSection.appendChild(none); return; }
  mine.forEach(function (b) {
    var box = document.createElement("div"); box.className = "box";
    var text = document.createElement("p");
    text.textContent = b.ref + " • " + b.movie + " • " + b.cinema + " • " + b.date + " " + b.time + " • Seats " + b.seats.join(", ") + " • ₱ " + b.total.toFixed(2);
    var cancel = document.createElement("button"); cancel.className = "btn small"; cancel.textContent = "Cancel booking";
    cancel.onclick = async function () {
      if (!confirm("Cancel booking " + b.ref + "?")) { return; }
      var r = await callApi("DELETE", "/api/bookings/" + b.ref);
      if (r.error) { showMessage(r.error); return; }
      await loadMyBookings(); loadBookedSeats(); showMessage("Booking cancelled.");
    };
    box.appendChild(text); box.appendChild(cancel); bookingsSection.appendChild(box);
  });
}
renderBookings();

// Forgot password: the server checks that username + email match, then saves the new password
el("forgotLink").onclick = async function (e) {
  e.preventDefault();
  var name = (window.prompt("Enter your username:") || "").trim();
  if (!name) { return; }
  var mail = (window.prompt("Enter the email you signed up with:") || "").trim();
  var fresh = window.prompt("Enter a new password (at least 6 characters):") || "";
  var r = await callApi("POST", "/api/forgot", { username: name, email: mail, password: fresh });
  showMessage(r.error ? r.error : "Password changed. You can sign in now.");
};

// On page load: ask the server who is logged in, then redraw what depends on it
(async function () {
  var me = await callApi("GET", "/api/me");
  sessionUser = me.user || null; sessionName = me.name || null; sessionAvatar = me.avatar || null;
  authReady = true;
  paintProfileInfo(); renderProfile();
  paintLoginLink();
  await loadMyBookings();
  showPage();            // now the Profile gate can decide correctly
  loadBookedSeats();
})();

/* ============ 20. PHONE MENU BUTTON ============ */
document.getElementById("menuBtn").onclick = function () { document.getElementById("mainNav").classList.toggle("open"); };
window.addEventListener("hashchange", function () { document.getElementById("mainNav").classList.remove("open"); });

/* ============ 18c. HOME: LISTS FOR YOU (click a list to see its movies) ============ */
// Each list is a TMDB search: movies of these genres with many votes, best rated first.
var HOME_LISTS = {
  crime:    { title: "Masterpiece Crime Drama",                 genres: "80,18" },
  thriller: { title: "Psychological Thrillers with Plot Twists", genres: "53,9648" },
  scifi:    { title: "Essential Sci-fi Cinema",                 genres: "878" }
};
var homeListCache = {};
async function loadHomeList(key) {
  if (homeListCache[key]) { return homeListCache[key]; }
  var url = TMDB_URL + "/discover/movie?with_genres=" + HOME_LISTS[key].genres +
            "&sort_by=vote_average.desc&vote_count.gte=5000&api_key=" + TMDB_KEY;
  try {
    var data = await (await fetch(url)).json();
    var items = (data.results || []).map(function (m) { m.media_type = "movie"; return m; });
    if (items.length) { homeListCache[key] = items; }
    return items;
  } catch (e) { return []; }
}
document.querySelectorAll(".list-link").forEach(function (item) {
  var key = item.dataset.list;
  item.style.cursor = "pointer";
  loadHomeList(key).then(function (items) {                       // show the real number of films
    if (items.length) { item.querySelector("small").textContent = items.length + " Films"; }
  });
  item.onclick = async function () {
    document.getElementById("listTitle").textContent = HOME_LISTS[key].title;
    var grid = document.getElementById("listGrid");
    grid.replaceChildren();
    grid.textContent = "Loading...";
    document.getElementById("listModal").classList.add("open");
    var items = await loadHomeList(key);
    grid.replaceChildren();
    if (items.length === 0) { grid.textContent = "Could not load this list. Check your internet connection."; return; }
    items.forEach(function (m) { grid.appendChild(makeCard(m)); });
  };
});
function closeListModal() { document.getElementById("listModal").classList.remove("open"); }
document.getElementById("listClose").onclick = closeListModal;
document.getElementById("listModal").onclick = function (e) { if (e.target === this) { closeListModal(); } };
document.getElementById("listGrid").addEventListener("click", function (e) {
  if (e.target.closest(".card")) { closeListModal(); }            // the movie pop-up opens after this
});


/* ============ 18d. TV PAGE: TOP 10 TV SHOWS SLIDESHOW ============ */
// TMDB ids of the ten shows, in order. "year" is the first-air year, used to double-check the id.
var TOP10_TV = [
  { id: 1396,  name: "Breaking Bad",       year: 2008 },
  { id: 1398,  name: "The Sopranos",       year: 1999 },
  { id: 1438,  name: "The Wire",           year: 2002 },
  { id: 4613,  name: "Band of Brothers",   year: 2001 },
  { id: 1399,  name: "Game of Thrones",    year: 2011 },
  { id: 87108, name: "Chernobyl",          year: 2019 },
  { id: 60059, name: "Better Call Saul",   year: 2015 },
  { id: 1104,  name: "Mad Men",            year: 2007 },
  { id: 1919,  name: "The Twilight Zone",  year: 1959 },
  { id: 2316,  name: "The Office",         year: 2005 }     // the U.S. version
];
var top10Shows = [], top10Index = 0, top10Timer = null;

async function fetchTop10Show(entry) {
  var extra = "?append_to_response=content_ratings&api_key=" + TMDB_KEY;
  function matches(d) {
    return d && d.name && d.name.toLowerCase().indexOf(entry.name.toLowerCase()) !== -1 &&
           (d.first_air_date || "").slice(0, 4) === String(entry.year);
  }
  try {
    var d = await (await fetch(TMDB_URL + "/tv/" + entry.id + extra)).json();
    if (!matches(d)) {          // wrong id? search by name and year instead
      var found = await (await fetch(TMDB_URL + "/search/tv?query=" + encodeURIComponent(entry.name) +
                  "&first_air_date_year=" + entry.year + "&api_key=" + TMDB_KEY)).json();
      var list = found.results || [];
      var hit = list.find(function (r) { return r.name.toLowerCase() === entry.name.toLowerCase(); }) || list[0];
      if (!hit) { return null; }
      d = await (await fetch(TMDB_URL + "/tv/" + hit.id + extra)).json();
    }
    d.media_type = "tv";
    d.genre_ids = (d.genres || []).map(function (g) { return g.id; });   // the movie pop-up expects this
    return d;
  } catch (e) { return null; }
}

function showTop10(index) {
  if (top10Shows.length === 0) { return; }
  top10Index = (index + top10Shows.length) % top10Shows.length;
  var item = top10Shows[top10Index];            // { rank, show }
  var d = item.show;
  var hero = document.getElementById("top10");
  hero.style.backgroundImage = d.backdrop_path
    ? "linear-gradient(90deg, #0b1124ee, #0b112455), url(" + BACKDROP_URL + d.backdrop_path + ")"
    : "linear-gradient(90deg, #0b1124ee, #0b112455), linear-gradient(135deg, #3a4488, #0f1530)";

  var us = ((d.content_ratings || {}).results || []).find(function (r) { return r.iso_3166_1 === "US"; });
  var first = (d.first_air_date || "").slice(0, 4), last = (d.last_air_date || "").slice(0, 4);
  var years = d.in_production ? first + "-Present" : (last && last !== first ? first + "-" + last : first);
  var seasons = d.number_of_seasons ? d.number_of_seasons + (d.number_of_seasons === 1 ? " Season" : " Seasons") : "";
  var meta = [us && us.rating, (d.genres || []).slice(0, 2).map(function (g) { return g.name; }).join(", "), seasons, years]
    .filter(function (x) { return x; }).join(" • ");
  var story = d.overview || "";
  if (story.length > 230) { story = story.slice(0, 227).replace(/\s+\S*$/, "") + "..."; }
  var creators = (d.created_by || []).map(function (c) { return c.name; }).join(", ");

  var box = document.getElementById("t10Text");
  box.style.animation = "none"; void box.offsetWidth; box.style.animation = "";     // replay the fade-in
  document.getElementById("t10Title").textContent = "#" + item.rank + " " + d.name;
  document.getElementById("t10By").textContent = creators ? "Created by " + creators : "";
  document.getElementById("t10Meta").textContent = meta;
  document.getElementById("t10Story").textContent = story;
  document.querySelectorAll("#t10Dots button").forEach(function (dot, i) { dot.classList.toggle("on", i === top10Index); });
}
function restartTop10Timer() {
  clearInterval(top10Timer);
  top10Timer = setInterval(function () {
    if (document.getElementById("top10").offsetParent !== null) { showTop10(top10Index + 1); }   // only while visible
  }, 7000);
}
(async function () {
  var all = await Promise.all(TOP10_TV.map(fetchTop10Show));
  top10Shows = all.map(function (show, i) { return show ? { rank: i + 1, show: show } : null; })
                  .filter(function (x) { return x; });
  if (top10Shows.length === 0) { document.getElementById("t10Title").textContent = "Could not load the Top 10. Check your internet connection."; return; }
  var dots = document.getElementById("t10Dots");
  top10Shows.forEach(function (item, i) {
    var dot = document.createElement("button");
    dot.title = "#" + item.rank + " " + item.show.name;
    dot.onclick = function () { showTop10(i); restartTop10Timer(); };
    dots.appendChild(dot);
  });
  document.getElementById("t10Prev").onclick = function () { showTop10(top10Index - 1); restartTop10Timer(); };
  document.getElementById("t10Next").onclick = function () { showTop10(top10Index + 1); restartTop10Timer(); };
  document.getElementById("t10Add").onclick = function () {
    if (!currentUser()) { showMessage("Please log in first."); location.hash = "#login"; return; }
    toggleWatchlist(top10Shows[top10Index].show);
  };
  document.getElementById("t10More").onclick = function () { openMovie(top10Shows[top10Index].show); };
  var hero = document.getElementById("top10");
  hero.addEventListener("mouseenter", function () { clearInterval(top10Timer); });   // pause while the mouse is over it
  hero.addEventListener("mouseleave", restartTop10Timer);
  showTop10(0);
  restartTop10Timer();
})();


/* ============ 18e. CUSTOM LISTS: add and remove movies / TV shows inside a list ============ */
var openListId = null;
async function addToCustomList(listId) {
  var lists = getList("filmlify_customlists");
  var list = lists.find(function (x) { return x.id === listId; });
  if (!list) { return; }
  var found = await askTitle("Add to \"" + list.name + "\"");          // search movies and TV shows
  if (!found) { return; }
  var key = found.media_type + "-" + found.id;
  if (list.items.some(function (i) { return i.key === key; })) { showMessage("That title is already in this list."); return; }
  remember(found);
  list.items.push({ key: key, title: nameOf(found) });
  saveList("filmlify_customlists", lists);
  renderCustomLists();
  if (openListId === listId) { renderListModal(); }
  showMessage("Added to " + list.name + "!");
}
function openCustomList(listId) {
  openListId = listId;
  renderListModal();
  document.getElementById("clModal").classList.add("open");
}
function renderListModal() {
  var list = getList("filmlify_customlists").find(function (x) { return x.id === openListId; });
  if (!list) { document.getElementById("clModal").classList.remove("open"); return; }
  document.getElementById("clTitle").textContent = list.name + " (" + list.items.length + ")";
  var grid = document.getElementById("clGrid");
  grid.replaceChildren();
  if (list.items.length === 0) {
    var note = document.createElement("p"); note.className = "empty-note";
    note.textContent = "This list is empty. Add a movie or TV show below.";
    grid.appendChild(note);
  }
  list.items.forEach(function (item) {
    var card = posterCard(item.title);
    var tools = document.createElement("div"); tools.className = "tools";
    tools.appendChild(toolButton("✕", "Remove from this list", function () {
      var lists = getList("filmlify_customlists");
      lists.forEach(function (x) { if (x.id === list.id) { x.items = x.items.filter(function (i) { return i.key !== item.key; }); } });
      saveList("filmlify_customlists", lists);
      renderListModal(); renderCustomLists();
    }));
    card.appendChild(tools);
    grid.appendChild(card);
  });
  loadPosters();
}
document.getElementById("clAdd").onclick = function () { addToCustomList(openListId); };
function closeCustomList() { openListId = null; document.getElementById("clModal").classList.remove("open"); }
document.getElementById("clClose").onclick = closeCustomList;
document.getElementById("clModal").onclick = function (e) { if (e.target === this) { closeCustomList(); } };
document.getElementById("clGrid").addEventListener("click", function (e) {
  if (e.target.closest(".card") && !e.target.closest(".tools")) { closeCustomList(); }   // the movie pop-up opens after this
});


/* ============ 18f. BOOKING PANEL: show the chosen movie (poster, genres, rating, story) ============ */
// With no movie chosen, the panel only shows a short message.
function showBookingMovie(m) {
  document.getElementById("bookTitle").textContent = nameOf(m);
  document.getElementById("bookPoster").style.backgroundImage = m.poster_path ? "url(" + POSTER_URL + m.poster_path + ")" : "";
  var genres = (m.genre_ids || []).map(function (id) {
    var g = MOVIE_GENRES.find(function (x) { return x[0] === id; });
    return g ? g[1] : null;
  }).filter(function (x) { return x; }).slice(0, 3).join(" • ");
  document.getElementById("bookGenres").textContent = genres;
  var rating = document.getElementById("bookRating");
  rating.textContent = m.vote_average ? "★ " + m.vote_average.toFixed(1) : "";
  paintImdb(m, rating, "", "");                       // swaps in the IMDb rating when it is available
  var story = m.overview || "";
  if (story.length > 260) { story = story.slice(0, 257).replace(/\s+\S*$/, "") + "..."; }
  document.getElementById("bookOverview").textContent = story;
  document.getElementById("bookEmpty").hidden = true;
  document.getElementById("bookBody").hidden = false;
  updateSummary();                                    // new movie: seats start empty and the summary updates
}


/* ============ 18g. POPULAR DIRECTORS AND FEATURED MOVIE LISTS (click to see the films) ============ */
// A director or a featured list opens the same pop-up (#featModal): a title, a short text and a grid of posters.
// The featured lists are typed here by hand as [title, year]. The year helps TMDB find the right movie.
var FEATURED_LISTS = {
  mcu: { name: "Complete MCU Infinity Saga", about: "All 23 films of the Infinity Saga, in release order.", films: [
    ["Iron Man", 2008], ["The Incredible Hulk", 2008], ["Iron Man 2", 2010], ["Thor", 2011], ["Captain America: The First Avenger", 2011],
    ["The Avengers", 2012], ["Iron Man 3", 2013], ["Thor: The Dark World", 2013], ["Captain America: The Winter Soldier", 2014],
    ["Guardians of the Galaxy", 2014], ["Avengers: Age of Ultron", 2015], ["Ant-Man", 2015], ["Captain America: Civil War", 2016],
    ["Doctor Strange", 2016], ["Guardians of the Galaxy Vol. 2", 2017], ["Spider-Man: Homecoming", 2017], ["Thor: Ragnarok", 2017],
    ["Black Panther", 2018], ["Avengers: Infinity War", 2018], ["Ant-Man and the Wasp", 2018], ["Captain Marvel", 2019],
    ["Avengers: Endgame", 2019], ["Spider-Man: Far From Home", 2019]
  ] },
  thrillers: { name: "Dark Thrillers & Mystery Masterpiece", about: "Twisty, unsettling thrillers and mysteries.", films: [
    ["Se7en", 1995], ["Zodiac", 2007], ["Prisoners", 2013], ["Gone Girl", 2014], ["Shutter Island", 2010], ["Memento", 2000],
    ["The Silence of the Lambs", 1991], ["Mystic River", 2003], ["Memories of Murder", 2003], ["Oldboy", 2003], ["The Prestige", 2006],
    ["Mulholland Drive", 2001], ["The Usual Suspects", 1995], ["Fight Club", 1999], ["Black Swan", 2010], ["Nightcrawler", 2014],
    ["Sicario", 2015], ["Searching", 2018], ["Knives Out", 2019], ["Parasite", 2019], ["Wind River", 2017], ["Gone Baby Gone", 2007],
    ["The Girl with the Dragon Tattoo", 2011], ["Side Effects", 2013], ["Enemy", 2013], ["No Country for Old Men", 2007], ["Primal Fear", 1996]
  ] },
  noir: { name: "Neo-Noir Cinema Essential", about: "Shadows, moral gray areas and rain-slicked streets.", films: [
    ["Blade Runner", 1982], ["Chinatown", 1974], ["L.A. Confidential", 1997], ["Drive", 2011], ["Blade Runner 2049", 2017], ["Sin City", 2005],
    ["Brick", 2005], ["Blood Simple", 1984], ["Body Heat", 1981], ["The Big Lebowski", 1998], ["Fargo", 1996], ["Collateral", 2004],
    ["Heat", 1995], ["Taxi Driver", 1976], ["Hell or High Water", 2016], ["Inherent Vice", 2014], ["The Long Goodbye", 1973],
    ["Night Moves", 1975], ["Angel Heart", 1987], ["Lost Highway", 1997], ["The Man Who Wasn't There", 2001], ["Miller's Crossing", 1990],
    ["The Last Seduction", 1994], ["Red Rock West", 1993], ["Bound", 1996], ["Insomnia", 2002], ["Kiss Kiss Bang Bang", 2005],
    ["Thief", 1981], ["To Live and Die in L.A.", 1985], ["Under the Silver Lake", 2018]
  ] }
};

var movieYearCache = {};
var featToken = 0;       // goes up each time the pop-up opens, so an old slow load can stop
var featError = "";      // the last problem, shown when nothing could be loaded

// Ask TMDB for a movie by its title (and year, when we have it)
async function searchByTitle(title, year) {
  var url = TMDB_URL + "/search/movie?query=" + encodeURIComponent(title) + (year ? "&year=" + year : "") + "&api_key=" + TMDB_KEY;
  var response = await fetch(url);
  if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
  var data = await response.json();
  var withPoster = (data.results || []).filter(function (m) { return m.poster_path; });
  var lower = title.toLowerCase();
  return withPoster.find(function (m) { return (m.title || "").toLowerCase() === lower; }) || withPoster[0] || null;
}

// Find one movie: title + year first, then the title alone, then the same search the search box uses
async function findFilm(title, year) {
  var cacheId = title + "|" + year;
  if (cacheId in movieYearCache) { return movieYearCache[cacheId]; }
  var movie = null;
  try { movie = await searchByTitle(title, year); }
  catch (error) { featError = error.message; console.error("Could not find " + title + ":", error); }
  if (!movie) { try { movie = await searchByTitle(title, 0); } catch (error) { featError = error.message; } }
  if (!movie) { try { movie = await searchTMDB(title); } catch (error) { featError = error.message; } }
  if (movie) {
    movie.media_type = movie.media_type || "movie";
    movieYearCache[cacheId] = movie;      // only remember the ones we found, so a failed one can try again
  }
  return movie;
}

function openFeat(title, sub, photoUrl) {
  document.getElementById("featTitle").textContent = title;
  document.getElementById("featSub").textContent = sub || "";
  var photo = document.getElementById("featPhoto");
  photo.hidden = !photoUrl;
  photo.style.backgroundImage = photoUrl ? "url(" + photoUrl + ")" : "";
  document.getElementById("featGrid").replaceChildren();
  document.getElementById("featModal").classList.add("open");
}
function closeFeat() {
  featToken++;
  document.getElementById("featModal").classList.remove("open");
}
function featNote(text) {
  var note = document.createElement("p");
  note.className = "empty-note";
  note.textContent = text;
  document.getElementById("featGrid").replaceChildren(note);
}

async function openFeaturedList(id) {
  var list = FEATURED_LISTS[id];
  if (!list) { return; }
  var token = ++featToken;
  featError = "";
  openFeat(list.name + " (" + list.films.length + " films)", list.about);
  featNote("Loading films...");

  var grid = document.getElementById("featGrid");
  var added = 0;
  for (var i = 0; i < list.films.length; i += 6) {       // 6 at a time, so TMDB is not asked too much at once
    var batch = list.films.slice(i, i + 6);
    var found = await Promise.all(batch.map(function (f) { return findFilm(f[0], f[1]); }));
    if (token !== featToken) { return; }                 // the pop-up was closed or opened again
    if (added === 0) { grid.replaceChildren(); }
    found.forEach(function (m) {
      if (!m) { return; }
      try { grid.appendChild(makeCard(m)); added++; }
      catch (error) { featError = error.message; console.error("Could not draw card:", error); }
    });
  }
  if (added === 0) {
    featNote("Sorry, the films could not be loaded." + (featError ? " (" + featError + ")" : " Check your internet connection."));
  }
}

async function openDirector(name) {
  var token = ++featToken;
  openFeat(name, "Loading...");
  var person = await searchPerson(name);
  if (token !== featToken) { return; }
  if (!person) {
    document.getElementById("featSub").textContent = "";
    featNote("Sorry, no details found for " + name + ".");
    return;
  }
  if (person.profile_path) {
    var photo = document.getElementById("featPhoto");
    photo.hidden = false;
    photo.style.backgroundImage = "url(" + PROFILE_URL + person.profile_path + ")";
  }
  try {
    var response = await fetch(TMDB_URL + "/person/" + person.id + "?append_to_response=movie_credits&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var d = await response.json();
    if (token !== featToken) { return; }

    // short bio: keep the first 320 letters, cut at a space
    var bio = (d.biography || "").trim();
    if (bio.length > 320) { bio = bio.slice(0, 317).replace(/\s+\S*$/, "") + "..."; }
    var born = d.birthday ? "Born " + d.birthday.slice(0, 4) + (d.place_of_birth ? " in " + d.place_of_birth : "") : "";
    document.getElementById("featSub").textContent = [born, bio].filter(function (x) { return x; }).join(" • ");

    // only the films this person directed, the most voted first
    var seen = {};
    var films = ((d.movie_credits || {}).crew || []).filter(function (c) {
      if (c.job !== "Director" || !c.poster_path || seen[c.id]) { return false; }
      seen[c.id] = true;
      return true;
    }).sort(function (a, b) { return (b.vote_count || 0) - (a.vote_count || 0); }).slice(0, 24);

    var grid = document.getElementById("featGrid");
    grid.replaceChildren();
    if (films.length === 0) { featNote("No directed films found."); return; }
    var heading = document.createElement("h3");
    heading.style.width = "100%";
    heading.textContent = "Directed by " + name;
    grid.appendChild(heading);
    films.forEach(function (m) { m.media_type = "movie"; grid.appendChild(makeCard(m)); });
  } catch (error) {
    console.error("Could not load director:", error);
    if (token === featToken) {
      document.getElementById("featSub").textContent = "";
      featNote("Sorry, the films could not be loaded. Check your internet connection.");
    }
  }
}

// Click (or Enter) on a director row or a list row. The Follow button still works as before.
function openFeatItem(item) {
  if (item.dataset.director) { openDirector(item.dataset.director); }
  else if (item.dataset.flist) { openFeaturedList(item.dataset.flist); }
}
document.addEventListener("click", function (e) {
  if (e.target.closest(".follow-btn")) { return; }
  var item = e.target.closest("[data-director], [data-flist]");
  if (item) { openFeatItem(item); }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { closeFeat(); return; }
  var onItem = e.target.matches && e.target.matches("[data-director], [data-flist]");
  if ((e.key === "Enter" || e.key === " ") && onItem) {
    e.preventDefault();
    openFeatItem(e.target);
  }
});
document.getElementById("featClose").onclick = closeFeat;
document.getElementById("featModal").onclick = function (e) { if (e.target === this) { closeFeat(); } };
document.getElementById("featGrid").addEventListener("click", function (e) {
  if (e.target.closest(".card")) { closeFeat(); }       // the movie pop-up opens right after this
});


/* ============ 18h. PROFILE: CLICK A NUMBER TO SEE ALL OF THEM (Followers, Following, Watched, Reviews, Watchlist) ============ */
// The pop-up is made here in JavaScript, so index.html does not need a new block.
var STAT_INFO = {
  statFollowers: { kind: "followers", label: "Followers" },
  statFollowing: { kind: "following", label: "Following" },
  statWatched:   { kind: "watched",   label: "Watched" },
  statReviews:   { kind: "reviews",   label: "Reviews" },
  statWatchlist: { kind: "watchlist", label: "Watchlist" }
};
var openStatKind = null;     // which list is showing (null = pop-up closed)
var statToken = 0;           // goes up on every redraw, so a slow poster load cannot draw into a newer list

var statsModal = document.createElement("div");
statsModal.className = "modal";
statsModal.id = "statsModal";
statsModal.innerHTML = '<div class="modal-box"><h2 id="statsTitle"></h2><div id="statsBody"></div>' +
  '<button class="btn outline wide" id="statsClose" type="button">Close</button></div>';
document.body.appendChild(statsModal);

function statNote(text) {
  var note = document.createElement("p");
  note.className = "empty-note";
  note.textContent = text;
  document.getElementById("statsBody").replaceChildren(note);
}

// A poster card for a saved movie. The real poster is added afterwards by fillStatCards.
function statCard(item, extraTitle) {
  var card = posterCard(item.title + (extraTitle || ""));
  card.statKey = item.key;
  return card;
}

// Saved items only keep a key like "movie-550", so ask TMDB for the poster (6 at a time)
async function fillStatCards(cards, token) {
  for (var i = 0; i < cards.length; i += 6) {
    await Promise.all(cards.slice(i, i + 6).map(async function (card) {
      var m = known[card.statKey];
      if (!m) {
        var parts = /^(movie|tv)-(\d+)$/.exec(card.statKey || "");
        if (parts) {
          try {
            var response = await fetch(TMDB_URL + "/" + parts[1] + "/" + parts[2] + "?api_key=" + TMDB_KEY);
            if (response.ok) {
              m = await response.json();
              m.media_type = parts[1];
              if (!m.genre_ids) { m.genre_ids = (m.genres || []).map(function (g) { return g.id; }); }
              remember(m);
            }
          } catch (error) { console.error("Could not load " + card.statKey + ":", error); }
        }
      }
      if (token !== statToken || !m) { return; }
      card.dataset.key = remember(m);       // from now on a click opens exactly this movie
      if (m.poster_path) {
        var poster = card.querySelector(".poster");
        poster.style.backgroundImage = "url(" + POSTER_URL + m.poster_path + ")";
        poster.classList.add("has-image");
      }
    }));
  }
}

// Grid of poster cards, each with a small button to remove it
function statPosterGrid(items, removeTip, onRemove, showYear) {
  var grid = document.createElement("div");
  grid.className = "row wrap";
  var cards = items.map(function (item) {
    var card = statCard(item, showYear && item.year ? " (" + item.year + ")" : "");
    var tools = document.createElement("div");
    tools.className = "tools";
    tools.appendChild(toolButton("✕", removeTip, function () { onRemove(item); }));
    card.appendChild(tools);
    grid.appendChild(card);
    return card;
  });
  document.getElementById("statsBody").replaceChildren(grid);
  fillStatCards(cards, statToken);
}

function renderStatModal() {
  var kind = openStatKind;
  if (!kind) { return; }
  var body = document.getElementById("statsBody");
  var title = document.getElementById("statsTitle");
  statToken++;
  var label = "";
  Object.keys(STAT_INFO).forEach(function (id) { if (STAT_INFO[id].kind === kind) { label = STAT_INFO[id].label; } });

  if (kind === "followers") {
    title.textContent = label + " (0)";
    statNote("No followers yet. People who follow you will show up here.");
  }

  if (kind === "following") {
    var names = getList("filmlify_following").slice().reverse();
    title.textContent = label + " (" + names.length + ")";
    if (names.length === 0) { statNote("You are not following anyone yet. Use the Follow buttons on the Home and Movies pages."); return; }
    var box = document.createElement("div");
    names.forEach(function (name) {
      var row = document.createElement("div");
      row.className = "item stat-person";
      var pic = document.createElement("div");
      pic.className = "stat-photo";
      pic.textContent = name.charAt(0).toUpperCase();
      var text = document.createElement("span");
      text.textContent = name;
      var button = document.createElement("button");
      button.className = "btn small";
      button.textContent = "Unfollow";
      button.onclick = function () {
        saveList("filmlify_following", getList("filmlify_following").filter(function (n) { return n !== name; }));
        paintFollowButtons();
        renderProfile();      // this changes the number, which redraws this list
        showMessage("You unfollowed " + name + ".");
      };
      row.appendChild(pic);
      row.appendChild(text);
      row.appendChild(button);
      box.appendChild(row);
      var token = statToken;
      searchPerson(name).then(function (p) {      // put the real photo in when TMDB has one
        if (p && token === statToken) {
          pic.style.backgroundImage = "url(" + PROFILE_URL + p.profile_path + ")";
          pic.textContent = "";
        }
      });
    });
    body.replaceChildren(box);
  }

  if (kind === "watched") {
    var watched = getList("filmlify_watched").slice().reverse();
    title.textContent = label + " (" + watched.length + ")";
    if (watched.length === 0) { statNote("Nothing watched yet. Open a movie or show and mark it as watched."); return; }
    statPosterGrid(watched, "Remove from watched", function (item) {
      saveList("filmlify_watched", getList("filmlify_watched").filter(function (x) { return x.key !== item.key; }));
      renderProfile();
    });
  }

  if (kind === "reviews") {
    ensureReviewIds();
    var reviews = getList("filmlify_reviews").slice().reverse();      // newest first
    title.textContent = label + " (" + reviews.length + ")";
    if (reviews.length === 0) { statNote("No reviews yet. Click any poster to write one."); return; }
    var wrap = document.createElement("div");
    reviews.forEach(function (r) { wrap.appendChild(reviewElement(r, true)); });
    body.replaceChildren(wrap);
  }

  if (kind === "watchlist") {
    var watchlist = getList("filmlify_watchlist").slice().reverse();
    title.textContent = label + " (" + watchlist.length + ")";
    if (watchlist.length === 0) { statNote("Your watchlist is empty. Use the + button on a poster, or + Add title on this page."); return; }
    statPosterGrid(watchlist, "Remove from watchlist", function (item) {
      saveList("filmlify_watchlist", getList("filmlify_watchlist").filter(function (x) { return x.key !== item.key; }));
      renderProfile();
      paintWatchlistButton();
    }, true);
  }
}
function openStat(kind) {
  openStatKind = kind;
  renderStatModal();
  statsModal.classList.add("open");
}
function closeStat() {
  openStatKind = null;
  statToken++;
  statsModal.classList.remove("open");
}

// When something changes (a review is edited, an item is removed...) redraw the open list too
var updateStatsBase = updateStats;
updateStats = function () {
  updateStatsBase();
  if (openStatKind) { renderStatModal(); }
};

// make the five numbers clickable
Object.keys(STAT_INFO).forEach(function (id) {
  var cell = document.getElementById(id).parentElement;
  cell.classList.add("stat-link");
  cell.setAttribute("role", "button");
  cell.tabIndex = 0;
  cell.title = "See all " + STAT_INFO[id].label.toLowerCase();
  cell.onclick = function () { openStat(STAT_INFO[id].kind); };
  cell.onkeydown = function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openStat(STAT_INFO[id].kind); }
  };
});
document.getElementById("statsClose").onclick = closeStat;
statsModal.onclick = function (e) { if (e.target === this) { closeStat(); } };
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && openStatKind) { closeStat(); } });
document.getElementById("statsBody").addEventListener("click", function (e) {
  if (e.target.closest(".card") && !e.target.closest(".tools")) { closeStat(); }    // the movie pop-up opens right after this
});


/* ============ 18i. TV PAGE: FILMLIFY COMMUNITY TOP LISTS (click a list to see its shows) ============ */
// Each list is a TMDB search for TV shows, best rated first.
// It shows as many shows as the card says (12 Shows, 15 Shows ...).
var TV_LISTS = {
  finales:    { title: "Shows with Perfect Series Finales",   count: 12, query: "with_genres=18&vote_count.gte=3000" },
  mystery:    { title: "Mind-Bending Mystery & Thrillers",    count: 15, query: "with_genres=9648&vote_count.gte=1000" },
  scifi:      { title: "Best Sci-Fi Worldbuilding",           count: 19, query: "with_genres=10765&vote_count.gte=1500" },
  crime:      { title: "Dark & Gritty Crime Sagas",           count: 20, query: "with_genres=80,18&vote_count.gte=1500" },
  animated:   { title: "Top-Tier Animated Sagas",             count: 18, query: "with_genres=16&vote_count.gte=1000" },
  miniseries: { title: "Peak TV Miniseries Masterpieces",     count: 10, query: "with_type=2&vote_count.gte=500" }
};
var tvListCache = {};

async function loadTvList(key) {
  if (tvListCache[key]) { return tvListCache[key]; }
  var url = TMDB_URL + "/discover/tv?" + TV_LISTS[key].query + "&sort_by=vote_average.desc&api_key=" + TMDB_KEY;
  try {
    var response = await fetch(url);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    var items = (data.results || []).filter(function (m) { return m.poster_path; }).slice(0, TV_LISTS[key].count);
    items.forEach(function (m) { m.media_type = "tv"; });
    if (items.length) { tvListCache[key] = items; }
    return items;
  } catch (error) {
    console.error("Could not load TV list " + key + ":", error);
    return [];
  }
}

// uses the same pop-up as the Home lists (#listModal)
async function openTvList(key) {
  var modal = document.getElementById("listModal");
  var title = document.getElementById("listTitle");
  var grid = document.getElementById("listGrid");
  title.textContent = TV_LISTS[key].title;
  grid.replaceChildren();
  grid.textContent = "Loading...";
  modal.classList.add("open");
  var items = await loadTvList(key);
  if (!modal.classList.contains("open")) { return; }              // closed while loading
  if (title.textContent !== TV_LISTS[key].title) { return; }      // another list was opened meanwhile
  grid.replaceChildren();
  if (items.length === 0) { grid.textContent = "Could not load this list. Check your internet connection."; return; }
  items.forEach(function (m) { grid.appendChild(makeCard(m)); });
}
document.querySelectorAll("[data-tvlist]").forEach(function (box) {
  var key = box.dataset.tvlist;
  box.onclick = function () { openTvList(key); };
  box.onkeydown = function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTvList(key); }
  };
});


/* ============ 18j. EDIT A REVIEW (a pop-up on the page, instead of the browser's prompt boxes) ============ */
var editingReviewId = null;
var editStars = 0;
var ratingWords = ["", "Poor", "Fair", "Good", "Great", "Masterpiece"];

var editReviewModal = document.createElement("div");
editReviewModal.className = "modal";
editReviewModal.id = "editReviewModal";
editReviewModal.innerHTML =
  '<div class="modal-box">' +
    '<h2>Edit review</h2><p id="erTitle"></p>' +
    '<label class="er-label">Your rating</label>' +
    '<div id="erStars" role="radiogroup" aria-label="Rating"></div><small id="erStarsText"></small>' +
    '<label class="er-label" for="erText">Your review <span>(optional)</span></label>' +
    '<textarea id="erText" maxlength="1000" placeholder="What did you think?"></textarea>' +
    '<div class="error" id="erError"></div>' +
    '<button class="btn wide" id="erSave" type="button">Save changes</button>' +
    '<button class="btn outline wide" id="erCancel" type="button">Cancel</button>' +
  '</div>';
document.body.appendChild(editReviewModal);

// the five star buttons
for (var s = 1; s <= 5; s++) {
  var starButton = document.createElement("button");
  starButton.type = "button";
  starButton.className = "er-star";
  starButton.dataset.value = s;
  starButton.textContent = "★";
  starButton.setAttribute("role", "radio");
  starButton.setAttribute("aria-label", s + (s === 1 ? " star" : " stars"));
  starButton.onclick = function () {
    editStars = Number(this.dataset.value);
    paintEditStars();
    document.getElementById("erError").textContent = "";
  };
  document.getElementById("erStars").appendChild(starButton);
}

function paintEditStars() {
  document.querySelectorAll("#erStars .er-star").forEach(function (b) {
    var value = Number(b.dataset.value);
    b.classList.toggle("on", value <= editStars);
    b.setAttribute("aria-checked", value === editStars ? "true" : "false");
  });
  document.getElementById("erStarsText").textContent = editStars ? editStars + " of 5 • " + ratingWords[editStars] : "Pick a rating";
}

function openEditReview(r) {
  editingReviewId = r.id;
  editStars = r.stars;
  document.getElementById("erTitle").textContent = r.title || "";
  document.getElementById("erText").value = r.text || "";
  document.getElementById("erError").textContent = "";
  paintEditStars();
  editReviewModal.classList.add("open");
  document.getElementById("erText").focus();
}
function closeEditReview() {
  editingReviewId = null;
  editReviewModal.classList.remove("open");
}

document.getElementById("erSave").onclick = function () {
  if (editStars < 1 || editStars > 5) {
    document.getElementById("erError").textContent = "Please pick a star rating from 1 to 5.";
    return;
  }
  var text = document.getElementById("erText").value.trim();
  var all = getList("filmlify_reviews");
  all.forEach(function (x) { if (x.id === editingReviewId) { x.stars = editStars; x.text = text; } });
  saveList("filmlify_reviews", all);
  closeEditReview();
  renderProfile();
  if (current) { paintReviews(); }
  showMessage("Review updated.");
};
document.getElementById("erCancel").onclick = closeEditReview;
editReviewModal.onclick = function (e) { if (e.target === this) { closeEditReview(); } };

// Escape should close only this pop-up and not the one under it (the "true" runs this first)
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && editReviewModal.classList.contains("open")) {
    e.stopImmediatePropagation();
    closeEditReview();
  }
}, true);
