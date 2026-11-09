// Filmlify backend: Node.js 22.5+ with built-in SQLite. No npm install needed.
// Run:  node server.js     then open  http://localhost:3000
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const TICKET_PRICE = 340;
const TAKEN_BASE = [];       // no seats are taken by default; only real bookings take seats
const DATA_DIR = process.env.DATA_DIR || __dirname;       // on a host, point this at its persistent disk
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "filmlify.db"));
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";   // from Google Cloud Console (see README)
const SECURE = process.env.NODE_ENV === "production";      // set NODE_ENV=production on the host (it serves HTTPS)
const omdbCache = new Map();

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    ref TEXT PRIMARY KEY, user_id INTEGER NOT NULL, show_key TEXT NOT NULL, movie TEXT, cinema TEXT,
    date TEXT, time TEXT, total INTEGER, method TEXT, paid_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS booked_seats (
    show_key TEXT NOT NULL, seat TEXT NOT NULL, ref TEXT NOT NULL, PRIMARY KEY (show_key, seat)
  );
`);

// older databases (made before full names existed) get the new column
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes("name")) db.exec("ALTER TABLE users ADD COLUMN name TEXT");
if (!userColumns.includes("google_sub")) db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
if (!userColumns.includes("avatar")) db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");     // profile picture (small JPEG as text)

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub)");

// ---------- helpers ----------
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString("hex");
const send = (res, code, data, headers = {}) => {
  res.writeHead(code, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 300000) { reject(new Error("too big")); req.destroy(); } });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
});
const cookieOf = (req, name) => {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? m[1] : null;
};
function userOf(req) {
  const token = cookieOf(req, "filmlify_session");
  if (!token) return null;
  const row = db.prepare("SELECT u.id, u.username, u.name, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?")
    .get(token, Date.now());
  return row || null;
}
function startSession(res, userId, remember) {
  const token = crypto.randomBytes(32).toString("hex");
  const days = remember ? 30 : 1;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, Date.now() + days * 864e5);
  return { "Set-Cookie": `filmlify_session=${token}; HttpOnly; SameSite=Lax; Path=/;` + (SECURE ? " Secure;" : "") + (remember ? ` Max-Age=${days * 86400}` : "") };
}
// simple brake against password guessing: 8 tries per 10 minutes per IP
const tries = new Map();
const TRUST_PROXY = process.env.TRUST_PROXY === "1";       // set this on a host that sits behind a proxy
function clientIp(req) {
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress;
}
function recentTries(ip) {
  const now = Date.now();
  return (tries.get(ip) || []).filter((t) => now - t < 600000);
}
const tooMany = (req) => recentTries(clientIp(req)).length >= 8;
function wrongTry(req) {                                   // only wrong passwords count, so normal use is never blocked
  const ip = clientIp(req);
  const list = recentTries(ip);
  list.push(Date.now());
  tries.set(ip, list);
}
// every 10 minutes: forget old tries and delete expired sessions
function cleanUp() {
  for (const ip of tries.keys()) { if (recentTries(ip).length === 0) tries.delete(ip); }
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}
cleanUp();
setInterval(cleanUp, 600000).unref();
function manilaNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })); }
const pad = (n) => String(n).padStart(2, "0");
function showHasStarted(date, time) {
  const p = time.match(/^(\d+):(\d+) (AM|PM)$/); if (!p) return true;
  const now = manilaNow();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (date < today) return true;
  if (date > today) return false;
  const mins = ((+p[1]) % 12 + (p[3] === "PM" ? 12 : 0)) * 60 + (+p[2]);
  return mins <= now.getHours() * 60 + now.getMinutes();
}
const myBookings = (userId) => db.prepare("SELECT * FROM bookings WHERE user_id = ? ORDER BY paid_at DESC").all(userId).map((b) => ({
  ref: b.ref, key: b.show_key, movie: b.movie, cinema: b.cinema, date: b.date, time: b.time, method: b.method, total: b.total,
  seats: db.prepare("SELECT seat FROM booked_seats WHERE ref = ?").all(b.ref).map((s) => s.seat)
}));

// ---------- API ----------
async function api(req, res, url) {
  const route = req.method + " " + url.pathname;
  let body = {};
  if (req.method !== "GET") {
    try { body = await readBody(req); }
    catch (e) { return send(res, 400, { error: "That request could not be read." }); }
  }

  if (route === "GET /api/me") { const u = userOf(req); return send(res, 200, { user: u ? u.username : null, name: u ? (u.name || u.username) : null, avatar: u ? (u.avatar || null) : null }); }

  if (route === "POST /api/signup") {
    const fullName = String(body.name || "").trim().replace(/\s+/g, " ");
    const username = String(body.username || "").trim(), email = String(body.email || "").trim(), password = String(body.password || "");
    if (!/^[\w.\- ]{3,30}$/.test(username)) return send(res, 400, { error: "Username must be 3-30 letters, numbers, spaces or . _ -" });
    if (fullName.length < 2 || fullName.length > 60) return send(res, 400, { error: "Please enter your full name." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: "Please enter a valid email." });
    if (password.length < 6) return send(res, 400, { error: "Password must be at least 6 characters." });
    if (db.prepare("SELECT 1 FROM users WHERE username = ? OR email = ?").get(username, email)) {
      return send(res, 409, { error: "That username or email is already registered." });
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const id = db.prepare("INSERT INTO users (username, name, email, salt, hash) VALUES (?, ?, ?, ?, ?)")
      .run(username, fullName, email, salt, hashPassword(password, salt)).lastInsertRowid;
    return send(res, 200, { user: username, name: fullName }, startSession(res, id, !!body.remember));
  }

  if (route === "POST /api/login") {
    if (tooMany(req)) return send(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    const who = String(body.username || "").trim(), password = String(body.password || "");
    const row = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(who, who);
    const ok = row && crypto.timingSafeEqual(Buffer.from(hashPassword(password, row.salt), "hex"), Buffer.from(row.hash, "hex"));
    if (!ok) { wrongTry(req); return send(res, 401, { error: "Wrong username or password." }); }
    tries.delete(clientIp(req));
    return send(res, 200, { user: row.username, name: row.name || row.username, avatar: row.avatar || null }, startSession(res, row.id, !!body.remember));
  }

  // The page asks which Google client id to use (empty = Google sign-in is switched off)
  if (route === "GET /api/config") return send(res, 200, { googleClientId: GOOGLE_CLIENT_ID || null });

  // Continue with Google: the page sends the access token Google gave it; we check it really belongs to OUR app
  if (route === "POST /api/google") {
    if (!GOOGLE_CLIENT_ID) return send(res, 503, { error: "Google sign-in is not set up on this server yet." });
    if (tooMany(req)) return send(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    const accessToken = String(body.accessToken || "");
    if (accessToken.length < 20 || accessToken.length > 4096) { wrongTry(req); return send(res, 400, { error: "Google sign-in failed." }); }
    let profile;
    try {
      const check = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(accessToken), { signal: AbortSignal.timeout(6000) });
      const info = await check.json();
      if (!check.ok || info.aud !== GOOGLE_CLIENT_ID) { wrongTry(req); return send(res, 401, { error: "Google sign-in failed." }); }   // token made for another app
      const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + accessToken }, signal: AbortSignal.timeout(6000) });
      profile = await me.json();
      if (!me.ok || !profile.sub || !profile.email) return send(res, 401, { error: "Google sign-in failed." });
    } catch (e) { return send(res, 502, { error: "Could not reach Google. Try again." }); }
    if (profile.email_verified !== true && profile.email_verified !== "true") return send(res, 403, { error: "Your Google email is not verified." });

    let row = db.prepare("SELECT * FROM users WHERE google_sub = ?").get(profile.sub);
    if (!row) {
      const email = String(profile.email).trim();
      if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
        // Never merge silently: anyone could have signed up with this email address without proving they own it.
        return send(res, 409, { error: "An account with this email already exists. Please sign in with your username and password." });
      }
      let base = email.split("@")[0].replace(/[^\w.\-]/g, "").slice(0, 22);
      if (base.length < 3) base = "user" + base;
      let username = base;
      while (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) username = base + Math.floor(1000 + Math.random() * 9000);
      const name = String(profile.name || base).replace(/\s+/g, " ").trim().slice(0, 60) || base;
      let avatar = null;                                    // use their Google photo when it is a small JPEG from Google
      try {
        const pic = new URL(String(profile.picture || ""));
        if (pic.protocol === "https:" && pic.hostname.endsWith(".googleusercontent.com")) {
          pic.pathname = pic.pathname.replace(/=s\d+(-c)?$/, "");
          const r = await fetch(pic.toString() + "=s160-c", { signal: AbortSignal.timeout(4000) });
          const bytes = Buffer.from(await r.arrayBuffer());
          if (r.ok && (r.headers.get("content-type") || "").startsWith("image/jpeg") && bytes.length < 150000) avatar = "data:image/jpeg;base64," + bytes.toString("base64");
        }
      } catch (e) { /* no photo is fine */ }
      const salt = crypto.randomBytes(16).toString("hex");                       // nobody knows this password: Google is the only way in
      const id = db.prepare("INSERT INTO users (username, name, email, salt, hash, google_sub, avatar) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(username, name, email, salt, hashPassword(crypto.randomBytes(32).toString("hex"), salt), profile.sub, avatar).lastInsertRowid;
      row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }
    tries.delete(clientIp(req));
    return send(res, 200, { user: row.username, name: row.name || row.username, avatar: row.avatar || null }, startSession(res, row.id, true));
  }

  if (route === "POST /api/logout") {
    const token = cookieOf(req, "filmlify_session");
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return send(res, 200, { ok: true }, { "Set-Cookie": "filmlify_session=; HttpOnly; Path=/; Max-Age=0" + (SECURE ? "; Secure" : "") });
  }

  // Forgot password: needs the username and the email to match (no email sending in this version)
  if (route === "POST /api/forgot") {
    // Anyone can find out a username and its email, so this is switched off.
    // For local testing only, start the server with ALLOW_INSECURE_RESET=1. A real fix is an emailed reset link.
    if (process.env.ALLOW_INSECURE_RESET !== "1") return send(res, 503, { error: "Password reset is unavailable right now. Please contact support." });
    if (tooMany(req)) return send(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    const row = db.prepare("SELECT * FROM users WHERE username = ? AND email = ?").get(String(body.username || "").trim(), String(body.email || "").trim());
    if (!row) { wrongTry(req); return send(res, 400, { error: "Username and email do not match." }); }
    if (String(body.password || "").length < 6) return send(res, 400, { error: "Password must be at least 6 characters." });
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").run(salt, hashPassword(body.password, salt), row.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
    return send(res, 200, { ok: true });
  }

  // IMDb rating through the server, so the OMDb key stays secret
  if (route === "GET /api/omdb") {
    const id = url.searchParams.get("i") || "";
    if (!process.env.OMDB_KEY) return send(res, 200, { rating: null, off: true });
    if (!/^tt\d{5,10}$/.test(id)) return send(res, 200, { rating: null });
    if (omdbCache.has(id)) return send(res, 200, { rating: omdbCache.get(id) });
    try {
      const j = await (await fetch("https://www.omdbapi.com/?i=" + id + "&apikey=" + process.env.OMDB_KEY)).json();
      if (j.Response !== "True") return send(res, 200, { rating: null });
      const rating = j.imdbRating && j.imdbRating !== "N/A" ? j.imdbRating : null;
      omdbCache.set(id, rating);
      return send(res, 200, { rating });
    } catch (e) { return send(res, 200, { rating: null }); }
  }

  if (route === "GET /api/taken") {          // seats already booked for one showtime (public)
    const rows = db.prepare("SELECT seat FROM booked_seats WHERE show_key = ?").all(url.searchParams.get("key") || "");
    return send(res, 200, { seats: rows.map((r) => r.seat) });
  }

  const user = userOf(req);
  if (url.pathname.startsWith("/api/bookings") && !user) return send(res, 401, { error: "Please log in first." });

  // Edit profile: full name, username and profile picture
  if (route === "PUT /api/profile") {
    if (!user) return send(res, 401, { error: "Please log in first." });
    const name = String(body.name || "").trim().replace(/\s+/g, " "), username = String(body.username || "").trim();
    if (name.length < 2 || name.length > 60) return send(res, 400, { error: "Please enter your full name." });
    if (!/^[\w.\- ]{3,30}$/.test(username)) return send(res, 400, { error: "Username must be 3-30 letters, numbers, spaces or . _ -" });
    if (db.prepare("SELECT 1 FROM users WHERE username = ? AND id != ?").get(username, user.id)) {
      return send(res, 409, { error: "That username is already taken." });
    }
    let avatar;
    if (body.avatar !== undefined) {
      if (body.avatar === "") avatar = null;
      else if (typeof body.avatar === "string" && body.avatar.length <= 250000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.avatar)) avatar = body.avatar;
      else return send(res, 400, { error: "That picture is not valid." });
    }
    db.prepare("UPDATE users SET name = ?, username = ? WHERE id = ?").run(name, username, user.id);
    if (body.avatar !== undefined) db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar, user.id);
    const row = db.prepare("SELECT username, name, avatar FROM users WHERE id = ?").get(user.id);
    return send(res, 200, { user: row.username, name: row.name, avatar: row.avatar || null });
  }

  if (route === "GET /api/bookings") return send(res, 200, { bookings: myBookings(user.id) });

  if (route === "POST /api/bookings") {
    const seats = Array.isArray(body.seats) ? [...new Set(body.seats.map(String))] : [];
    const valid = seats.length > 0 && seats.length <= 10 && seats.every((s) => /^[A-H]([1-9]|1[0-5])$/.test(s));
    if (!valid) return send(res, 400, { error: "Please choose between 1 and 10 valid seats." });
    if (!["GCash", "Maya", "Card"].includes(body.method)) return send(res, 400, { error: "Unknown payment method." });
    const key = [body.movie, body.cinema, body.date, body.time].join("|");
    // the movie, cinema and time must look right
    const cinemaOk = /^Filmlify - [\w .'-]{1,40}$/.test(String(body.cinema));
    const timeOk = /^\d{1,2}:\d\d (AM|PM)$/.test(String(body.time));
    const movieOk = typeof body.movie === "string" && body.movie.length > 0 && body.movie.length <= 120;
    if (!movieOk || !cinemaOk || !timeOk) return send(res, 400, { error: "Invalid showtime." });
    if (body.key !== key || !/^\d{4}-\d\d-\d\d$/.test(body.date)) return send(res, 400, { error: "Invalid showtime." });
    if (showHasStarted(body.date, body.time)) return send(res, 400, { error: "That showtime has already started." });
    if (seats.some((s) => TAKEN_BASE.includes(s))) return send(res, 409, { error: "One of those seats is not available." });
    const ref = "FLM-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const total = seats.length * TICKET_PRICE;
    try {
      db.exec("BEGIN");                      // all-or-nothing, so two people can never get the same seat
      db.prepare("INSERT INTO bookings (ref, user_id, show_key, movie, cinema, date, time, total, method) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(ref, user.id, key, body.movie, body.cinema, body.date, body.time, total, body.method);
      const add = db.prepare("INSERT INTO booked_seats (show_key, seat, ref) VALUES (?, ?, ?)");
      seats.forEach((s) => add.run(key, s, ref));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return send(res, 409, { error: "Sorry, one of those seats was just taken." });
    }
    return send(res, 200, { booking: myBookings(user.id).find((b) => b.ref === ref) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/bookings/")) {
    const ref = url.pathname.split("/").pop();
    const own = db.prepare("SELECT date, time FROM bookings WHERE ref = ? AND user_id = ?").get(ref, user.id);
    if (!own) return send(res, 404, { error: "Booking not found." });
    if (showHasStarted(own.date, own.time)) return send(res, 400, { error: "That showtime has already started, so it can no longer be cancelled." });
    db.prepare("DELETE FROM booked_seats WHERE ref = ?").run(ref);
    db.prepare("DELETE FROM bookings WHERE ref = ?").run(ref);
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: "Not found." });
}

// ---------- static files (index.html, script.js, style.css) ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const PUBLIC = new Set(["index.html", "script.js", "style.css"]);

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    // Only the three site files, or files really inside the "posters" folder (checked AFTER resolving "..").
    const file = path.resolve(__dirname, name);
    const insidePosters = file.startsWith(path.join(__dirname, "posters") + path.sep);
    if (!(PUBLIC.has(name) || insidePosters) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Something went wrong on the server." });
  }
}).listen(PORT, () => console.log("Filmlify is running at http://localhost:" + PORT));
