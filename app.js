// SoMe Kids — en enkel og trygg "sosiale medier"-app for barn.
// Alt lagres lokalt i nettleseren (localStorage). Ingen server, ingen sporing.

const AVATARS = ["🐶", "🐱", "🦊", "🐼", "🐸", "🦄", "🐵", "🐯", "🐰", "🐧", "🐢", "🦖"];
const STICKERS = ["", "⚽", "🎨", "🎮", "📚", "🍕", "🌞", "🎵", "🏰", "🚲"];
const COLORS = ["#fff3b0", "#caffbf", "#9bf6ff", "#ffc6ff", "#ffd6a5", "#e0e0ff"];
// Kun positive reaksjoner — ingen "liker ikke".
const REACTIONS = ["❤️", "⭐", "😂", "👏"];

// Ord som ikke er lov. Utvid lista etter behov.
const BAD_WORDS = ["dum", "idiot", "stygg", "hater", "tjukk", "teit", "drit", "faen", "jævla", "helvete", "kjeft", "loser"];

const PARENT_PIN_KEY = "someKids.pin";
const PROFILE_KEY = "someKids.profile";
const POSTS_KEY = "someKids.posts";
const SCREEN_TIME_MINUTES = 20;

const SAMPLE_POSTS = [
  { id: "s1", author: "Solstråle", avatar: "🦄", text: "Jeg lærte å sykle uten støttehjul i dag!", sticker: "🚲", color: "#caffbf", reactions: { "👏": 5, "⭐": 2 }, time: Date.now() - 3600e3 },
  { id: "s2", author: "Byggmester", avatar: "🐼", text: "Laget et kjempestort slott i sandkassa", sticker: "🏰", color: "#fff3b0", reactions: { "❤️": 3 }, time: Date.now() - 7200e3 },
  { id: "s3", author: "Tegnefrø", avatar: "🐸", text: "Hvilken farge liker dere best? Jeg liker grønn!", sticker: "🎨", color: "#9bf6ff", reactions: { "😂": 1, "❤️": 4 }, time: Date.now() - 86400e3 },
];

// ---------- Lagring ----------
function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignorer */ }
}

let profile = load(PROFILE_KEY, null);
let posts = load(POSTS_KEY, SAMPLE_POSTS);
let myReactions = load("someKids.myReactions", {}); // { postId: [emoji, ...] }

const $ = (id) => document.getElementById(id);

// ---------- Trygghetsfilter ----------
function checkText(text) {
  const lower = text.toLowerCase();
  if (BAD_WORDS.some((w) => new RegExp(`(^|[^a-zæøå])${w}`, "i").test(lower))) {
    return "Oi! Det ser ut som et ord som ikke er så snilt. Prøv å si det på en snillere måte 💛";
  }
  if (/\d[\d\s-]{6,}\d/.test(text)) {
    return "Det ser ut som et telefonnummer. Telefonnummer skal ikke deles på nett 📵";
  }
  if (/\S+@\S+\.\S+/.test(text)) {
    return "Det ser ut som en e-postadresse. Den skal du holde hemmelig 🤫";
  }
  if (/(gate|vei|veien|gata)\s*\d+/i.test(text)) {
    return "Det ser ut som en adresse. Hvor du bor er hemmelig på nett 🏠";
  }
  if (/https?:\/\/|www\./i.test(text)) {
    return "Lenker er ikke lov her. Spør en voksen hvis du vil vise noe 🔗";
  }
  return null;
}

// ---------- Hjelpere ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function timeAgo(t) {
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "akkurat nå";
  if (min < 60) return `${min} min siden`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} t siden`;
  return `${Math.floor(h / 24)} d siden`;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 3000);
}

function picker(container, items, render, onPick, initial) {
  container.innerHTML = "";
  items.forEach((item) => {
    const b = document.createElement("button");
    b.type = "button";
    render(b, item);
    if (item === initial) b.classList.add("selected");
    b.onclick = () => {
      container.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      onPick(item);
    };
    container.appendChild(b);
  });
}

// ---------- Profil ----------
let chosenAvatar = AVATARS[0];

function showSetup() {
  $("setup").classList.remove("hidden");
  $("app").classList.add("hidden");
  picker($("avatarPicker"), AVATARS, (b, a) => (b.textContent = a), (a) => (chosenAvatar = a), chosenAvatar);
}

$("startBtn").onclick = () => {
  const name = $("nameInput").value.trim();
  if (!name) return toast("Skriv et kallenavn først 😊");
  const problem = checkText(name);
  if (problem) return toast(problem);
  profile = { name, avatar: chosenAvatar };
  save(PROFILE_KEY, profile);
  showApp();
};

// ---------- Feed ----------
let chosenColor = COLORS[0];
let chosenSticker = "";

function showApp() {
  $("setup").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("me").textContent = `${profile.avatar} ${profile.name}`;
  picker($("colorPicker"), COLORS, (b, c) => (b.style.background = c), (c) => (chosenColor = c), chosenColor);
  picker($("stickerPicker"), STICKERS, (b, s) => (b.textContent = s || "✖️"), (s) => (chosenSticker = s), chosenSticker);
  renderFeed();
}

function renderFeed() {
  const feed = $("feed");
  feed.innerHTML = "";
  const visible = posts.filter((p) => !p.hidden).sort((a, b) => b.time - a.time);
  if (!visible.length) {
    feed.innerHTML = `<div class="card muted">Ingen innlegg ennå. Bli den første! 🎉</div>`;
    return;
  }
  visible.forEach((p) => {
    const mine = myReactions[p.id] || [];
    const el = document.createElement("article");
    el.className = "card post";
    el.innerHTML = `
      <div class="head">
        <span class="avatar">${p.avatar}</span>
        <div><div class="name">${escapeHtml(p.author)}</div><div class="time">${timeAgo(p.time)}</div></div>
      </div>
      <div class="body" style="background:${p.color}">
        ${escapeHtml(p.text)}
        ${p.sticker ? `<span class="sticker">${p.sticker}</span>` : ""}
      </div>
      <div class="actions">
        ${REACTIONS.map((r) => `<button data-r="${r}" class="${mine.includes(r) ? "mine" : ""}">${r} ${p.reactions[r] || ""}</button>`).join("")}
        <span class="spacer"></span>
        <button class="report">🚩 Si fra</button>
      </div>`;
    el.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => react(p, b.dataset.r)));
    el.querySelector(".report").onclick = () => report(p);
    feed.appendChild(el);
  });
}

function react(post, emoji) {
  const mine = myReactions[post.id] || [];
  if (mine.includes(emoji)) {
    myReactions[post.id] = mine.filter((r) => r !== emoji);
    post.reactions[emoji] = Math.max(0, (post.reactions[emoji] || 1) - 1);
  } else {
    myReactions[post.id] = [...mine, emoji];
    post.reactions[emoji] = (post.reactions[emoji] || 0) + 1;
  }
  save("someKids.myReactions", myReactions);
  save(POSTS_KEY, posts);
  renderFeed();
}

function report(post) {
  if (!confirm("Vil du skjule dette innlegget og si fra til en voksen?")) return;
  post.hidden = true;
  post.reported = true;
  save(POSTS_KEY, posts);
  renderFeed();
  toast("Takk for at du sa fra! En voksen kan se på det i foreldremodus 💛");
}

$("postText").oninput = (e) => {
  $("charCount").textContent = `${e.target.value.length}/140`;
  $("warning").classList.add("hidden");
};

$("postBtn").onclick = () => {
  const text = $("postText").value.trim();
  if (!text && !chosenSticker) return toast("Skriv noe eller velg et klistremerke 😊");
  const problem = checkText(text);
  if (problem) {
    $("warning").textContent = problem;
    $("warning").classList.remove("hidden");
    return;
  }
  posts.push({
    id: Date.now().toString(36),
    author: profile.name,
    avatar: profile.avatar,
    text,
    sticker: chosenSticker,
    color: chosenColor,
    reactions: {},
    time: Date.now(),
  });
  save(POSTS_KEY, posts);
  $("postText").value = "";
  $("charCount").textContent = "0/140";
  renderFeed();
  toast("Delt! 🎉");
};

// ---------- Foreldremodus ----------
$("parentBtn").onclick = () => {
  let pin = load(PARENT_PIN_KEY, null);
  if (!pin) {
    pin = prompt("Lag en firesifret PIN-kode for foreldremodus:");
    if (!/^\d{4}$/.test(pin || "")) return toast("PIN må være 4 siffer");
    save(PARENT_PIN_KEY, pin);
  } else if (prompt("Skriv PIN-kode:") !== pin) {
    return toast("Feil PIN 🔒");
  }

  const reported = posts.filter((p) => p.reported);
  const choice = prompt(
    `Foreldremodus\n\nRapporterte innlegg: ${reported.length}\n` +
      reported.map((p, i) => `${i + 1}. ${p.author}: ${p.text}`).join("\n") +
      `\n\nSkriv:\n  v = vis rapporterte igjen\n  s = slett rapporterte\n  p = bytt profil\n  n = nullstill alt`
  );
  if (choice === "v") reported.forEach((p) => { p.hidden = false; p.reported = false; });
  else if (choice === "s") posts = posts.filter((p) => !p.reported);
  else if (choice === "p") { localStorage.removeItem(PROFILE_KEY); profile = null; }
  else if (choice === "n" && confirm("Slette alle innlegg og profil?")) {
    [PROFILE_KEY, POSTS_KEY, "someKids.myReactions"].forEach((k) => localStorage.removeItem(k));
    profile = null; posts = SAMPLE_POSTS; myReactions = {};
  } else return;
  save(POSTS_KEY, posts);
  profile ? showApp() : showSetup();
};

// ---------- Skjermtid ----------
setTimeout(() => {
  alert(`Du har vært her i ${SCREEN_TIME_MINUTES} minutter! Kanskje på tide med en pause? 🌳🏃`);
}, SCREEN_TIME_MINUTES * 60 * 1000);

// ---------- Start ----------
setInterval(() => profile && renderFeed(), 60000); // oppdater "x min siden"
profile ? showApp() : showSetup();
