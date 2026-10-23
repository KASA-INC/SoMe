// quipu — klient. All brukertekst settes med textContent, aldri som HTML.
import {
  APP_NAME, MARK_VIEWBOX, MARK_TIGHT_VIEWBOX, MARK_RING, MARK_EYE_LEFT, MARK_EYE_RIGHT, MARK_MOUTH,
  WORDMARK_VIEWBOX, WORDMARK_PATH,
} from "./brand.js";
import { fillFooter } from "./footer.js";
import { shrinkVideo } from "./video.js";

const view = document.getElementById("view");
let config = null; // { me, kinds, colors, stickers, avatars, media }
let heartbeatTimer = null;
let newPostsTimer = null;
let parentTab = "barn";

// ---------- Hjelpere ----------
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Noe gikk galt"), { status: res.status, code: data.code });
  return data;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v; // via CSSOM, som CSP tillater
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Strekikoner (24×24, i stil med Lucide).
const ICONS = {
  clock: ["circle:12,12,10", "M12 6v6l4 2"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  image: ["rect:3,3,18,18,2", "circle:9,9,2", "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"],
  smile: ["circle:12,12,10", "M8 14s1.5 2 4 2 4-2 4-2", "M9 9h.01", "M15 9h.01"],
  droplet: ["M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
  flag: ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22v-7"],
  check: ["M22 11.1V12a10 10 0 1 1-5.9-9.1", "M22 4 12 14l-3-3"],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  sun: ["circle:12,12,4", "M12 2v2", "M12 20v2", "m4.9 4.9 1.4 1.4", "m17.7 17.7 1.4 1.4", "M2 12h2", "M20 12h2", "m6.3 17.7-1.4 1.4", "m19.1 4.9-1.4 1.4"],
  bulb: ["M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5", "M9 18h6", "M10 22h4"],
  sparkles: ["m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"],
  pencil: ["M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "circle:9,7,4", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
  user: ["circle:12,7,4", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"],
  plus: ["M5 12h14", "M12 5v14"],
  copy: ["rect:8,8,14,14,2", "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"],
  back: ["m15 18-6-6 6-6"],
  refresh: ["M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7L3 16", "M8 16H3v5"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10", "m9 12 2 2 4-4"],
  eye: ["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z", "circle:12,12,3"],
  help: ["circle:12,12,10", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  calendar: ["rect:3,4,18,18,2", "M16 2v4", "M8 2v4", "M3 10h18"],
  compass: ["circle:12,12,10", "m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"],
  eyeOff: ["M9.9 9.9a3 3 0 1 0 4.2 4.2", "M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7", "M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6", "M2 2l20 20"],
  mail: ["rect:2,4,20,16,2", "m22 7-10 6L2 7"],
  alert: ["circle:12,12,10", "M12 8v4", "M12 16h.01"],
  lock: ["rect:3,11,18,11,2", "M7 11V7a5 5 0 0 1 10 0v4"],
  share: ["M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "m16 6-4-4-4 4", "M12 2v13"],
  plusSquare: ["rect:3,3,18,18,2", "M12 8v8", "M8 12h8"],
  dots: ["circle:12,5,1", "circle:12,12,1", "circle:12,19,1"],
  phone: ["rect:5,2,14,20,2", "M12 18h.01"],
};
const SVG_NS = "http://www.w3.org/2000/svg";

function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  for (const part of ICONS[name]) {
    let el;
    if (part.startsWith("circle:")) {
      const [cx, cy, r] = part.slice(7).split(",");
      el = document.createElementNS(SVG_NS, "circle");
      el.setAttribute("cx", cx); el.setAttribute("cy", cy); el.setAttribute("r", r);
    } else if (part.startsWith("rect:")) {
      const [x, y, w, hh, rx] = part.slice(5).split(",");
      el = document.createElementNS(SVG_NS, "rect");
      el.setAttribute("x", x); el.setAttribute("y", y); el.setAttribute("width", w); el.setAttribute("height", hh); el.setAttribute("rx", rx);
    } else {
      el = document.createElementNS(SVG_NS, "path");
      el.setAttribute("d", part);
    }
    svg.append(el);
  }
  return svg;
}

// Logo: Q-boblen og ordbildet fra brand.js. Fargen styres av CSS (currentColor).
function brandSvg(viewBox, d, cls) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "currentColor");
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
  return svg;
}

// Q-boblen med et levende ansikt: øynene og munnen er egne deler som CSS animerer
// (blunk og et blikk til siden av og til). Trykk på logoen gir et blunk med ett øye.
function markSvg(cls = "mark", viewBox = MARK_TIGHT_VIEWBOX) {
  const svg = brandSvg(viewBox, MARK_RING, `${cls} alive`);
  const part = (d, c) => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "currentColor");
    p.setAttribute("class", c);
    return p;
  };
  const face = document.createElementNS(SVG_NS, "g");
  face.setAttribute("class", "face");
  face.append(part(MARK_EYE_LEFT, "eye eye-left"), part(MARK_EYE_RIGHT, "eye eye-right"), part(MARK_MOUTH, "mouth"));
  svg.append(face);
  svg.addEventListener("click", () => {
    svg.classList.remove("wink");
    void svg.getBoundingClientRect(); // start animasjonen på nytt ved gjentatte trykk
    svg.classList.add("wink");
  });
  // Smilet er den lengste delen av trykk-animasjonen, så den avgjør når den er ferdig.
  svg.addEventListener("animationend", (e) => e.animationName === "q-smile" && svg.classList.remove("wink"));
  return svg;
}
const wordmarkSvg = (cls = "wordmark") => brandSvg(WORDMARK_VIEWBOX, WORDMARK_PATH, cls);

// Appikonet: kremhvit Q på petrol.
function logo() {
  return h("span", { class: "app-icon", "aria-hidden": "true" }, markSvg("mark", MARK_VIEWBOX));
}

// Merke + ordbilde, med navnet som tekst for skjermlesere.
const lockup = (cls) => h("span", { class: `lockup ${cls}`, role: "img", "aria-label": APP_NAME }, markSvg(), wordmarkSvg());

const KIND_ICONS = {
  glad: "sun", laerte: "book", takk: "sparkles", laget: "pencil",
  sporsmal: "help", tips: "bulb", gleder: "calendar", opplevd: "compass",
};
const DEFAULT_PROMPT = "Skriv noe til klassen …";
const KIND_PROMPTS = {
  glad: "Hva er du glad for i dag?",
  laerte: "Hva lærte du?",
  takk: "Hvem vil du takke, og for hva?",
  laget: "Hva har du laget?",
  sporsmal: "Hva lurer du på?",
  tips: "Hvilket tips vil du dele?",
  gleder: "Hva gleder du deg til?",
  opplevd: "Hva har du opplevd?",
};

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 3500);
}

function timeAgo(t) {
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "nå";
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} t`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "i går" : `${days} d`;
}

// Fyller hovedvisningen. Lister flates ut og tomme verdier hoppes over.
// Bunnteksten med lenker vises alltid for voksne og innloggingssidene, aldri for barn.
const siteFooter = document.getElementById("site-footer");
fillFooter(siteFooter);
const show = (nodes, footer) => {
  document.body.classList.toggle("auth-page", !config);
  siteFooter.classList.toggle("hidden", !footer);
  view.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
};
const render = (...nodes) => show(nodes, config?.me.role !== "child");

// Barnas profilbilder er tegnede figurer (c01–c24 i /avatars). Foresatte har en emoji.
const isFigure = (value) => /^c\d{2}$/.test(value);
const figure = (id) => h("img", { src: `/avatars/${id}.svg`, alt: "", draggable: "false" });
const avatar = (value, size = "") => isFigure(value)
  ? h("span", { class: `avatar figure ${size}`, "aria-hidden": "true" }, figure(value))
  : h("span", { class: `avatar ${size}`, "aria-hidden": "true" }, value);

// Rutenett med alle profilbildene. Brukes når foresatte lager en barnekonto og når barnet bytter selv.
const avatarPicker = (selected) => {
  const row = choiceRow(config.avatars, (b, a) => {
    b.append(figure(a));
    b.setAttribute("aria-label", `Profilbilde ${config.avatars.indexOf(a) + 1}`);
  }, selected, "avatar-pick");
  return row;
};
const field = (label, input) => h("label", { class: "field" }, label, input);

// Passordfelt med knapp for å vise passordet (nyttig når mobilen har laget et langt passord).
function passwordInput(attrs) {
  const input = h("input", { ...attrs, type: "password", autocapitalize: "none", spellcheck: "false" });
  const toggle = h("button", { type: "button", class: "icon-btn", "aria-label": "Vis passord", title: "Vis passord" }, icon("eye"));
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.replaceChildren(icon(show ? "eyeOff" : "eye"));
    toggle.setAttribute("aria-label", show ? "Skjul passord" : "Vis passord");
    toggle.title = toggle.getAttribute("aria-label");
  });
  return h("div", { class: "pw" }, input, toggle);
}
const formData = (form) => Object.fromEntries(new FormData(form));
const iconBtn = (name, label, onclick, cls = "") => h("button", { type: "button", class: `icon-btn ${cls}`, "aria-label": label, title: label, onclick }, icon(name));
const btn = (label, onclick, cls = "", iconName) => h("button", { type: "button", class: `btn ${cls}`, onclick }, iconName && icon(iconName), label);
const warningBox = () => h("p", { class: "warning hidden", role: "alert" });
const showWarning = (el, msg) => { el.replaceChildren(icon("alert"), h("span", {}, msg)); el.classList.remove("hidden"); };

// Velg ett alternativ. Valgt verdi ligger i el.value.
function choiceRow(items, render, initial, className, onChange) {
  const row = h("div", { class: className, role: "radiogroup" });
  row.value = initial;
  for (const item of items) {
    const b = h("button", { type: "button", role: "radio", "aria-checked": String(item === initial) });
    render(b, item);
    if (item === initial) b.classList.add("selected");
    b.addEventListener("click", () => {
      row.querySelectorAll("button").forEach((x) => { x.classList.remove("selected"); x.setAttribute("aria-checked", "false"); });
      b.classList.add("selected");
      b.setAttribute("aria-checked", "true");
      row.value = item;
      onChange?.(item);
    });
    row.append(b);
  }
  return row;
}

// Ark som glir opp nedenfra (på PC: dialog midt på skjermen).
function openSheet(title, content) {
  const layer = h("div", { class: "sheet-layer" });
  const close = () => {
    layer.classList.remove("open");
    document.body.classList.remove("no-scroll");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => layer.remove(), 250);
  };
  const onKey = (e) => e.key === "Escape" && close();
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-head" }, h("h2", {}, title), iconBtn("x", "Lukk", close)),
    typeof content === "function" ? content(close) : content);
  layer.append(h("div", { class: "sheet-backdrop", onclick: close }), sheet);
  document.body.append(layer);
  document.body.classList.add("no-scroll");
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("open")));
  return close;
}

// ---------- Topp ----------
document.getElementById("brand").replaceChildren(lockup("header-lockup"));

function setHeader(status) {
  const me = config?.me;
  const right = document.getElementById("headerRight");
  right.replaceChildren();
  if (!me) return;
  if (me.role === "child" && status) {
    right.append(h("span", { class: `pill${status.minutesLeft <= 5 ? " low" : ""}`, id: "timeLeft", title: "Tid igjen i dag" },
      icon("clock"), h("span", {}, `${status.minutesLeft} min`)));
  }
  // Barnet trykker på profilbildet sitt for å bytte det.
  const mine = me.role === "child"
    ? h("button", { type: "button", class: "avatar-btn", "aria-label": "Bytt profilbilde", title: "Bytt profilbilde", onclick: openAvatarSheet }, avatar(me.avatar, "sm"))
    : avatar(me.avatar, "sm");
  right.append(mine, iconBtn("logout", "Logg ut", logout));
}

function openAvatarSheet() {
  openSheet("Velg profilbilde", (close) => {
    const picker = avatarPicker(config.me.avatar);
    const warning = warningBox();
    return h("div", {},
      h("p", { class: "muted small" }, "De andre i gruppa ser bildet ved innleggene dine."),
      picker,
      h("button", {
        class: "btn block", type: "button",
        onclick: async () => {
          try {
            await api("/me/avatar", { method: "POST", body: { avatar: picker.value } });
            config.me.avatar = picker.value;
            close();
            toast("Profilbildet er byttet");
            start();
          } catch (err) { showWarning(warning, err.message); }
        },
      }, "Bruk dette"),
      warning);
  });
}

function updateTimeLeft(minutesLeft) {
  const el = document.getElementById("timeLeft");
  if (!el) return;
  el.lastChild.textContent = `${minutesLeft} min`;
  el.classList.toggle("low", minutesLeft <= 5);
}

async function logout() {
  // Varsler skal ikke fortsette å komme til en enhet man har logget ut av.
  if (config?.me.role === "parent") await setPush(false).catch(() => {});
  await api("/logout", { method: "POST" }).catch(() => {});
  config = null;
  stopTimers();
  start();
}

// ---------- Start ----------
async function start() {
  try {
    await route();
  } finally {
    hideSplash();
  }
}

async function route() {
  const reset = location.hash.match(/^#reset=([0-9a-f]{64})$/);
  if (reset) {
    // Fjern koden fra adresselinja, så den ikke blir liggende i historikken.
    history.replaceState(null, "", location.pathname);
    config = null;
    setHeader();
    return showReset(reset[1]);
  }
  const verify = location.hash.match(/^#verify=([0-9a-f]{64})$/);
  if (verify) {
    history.replaceState(null, "", location.pathname);
    try {
      await api("/email/verify", { method: "POST", body: { token: verify[1] } });
      toast("E-postadressen er bekreftet");
    } catch (err) { toast(err.message); }
  }
  const invite = location.hash.match(/^#invitasjon=([0-9a-f]{64})$/);
  if (invite) {
    history.replaceState(null, "", location.pathname);
    pendingInvite = invite[1];
  }
  const share = location.hash.match(/^#barn=([0-9a-f]{64})$/);
  if (share) {
    history.replaceState(null, "", location.pathname);
    pendingShare = share[1];
  }
  try {
    config = await api("/me");
  } catch {
    config = null;
  }
  setHeader(config?.me.status);
  if (!config) return location.hash === "#registrer" || pendingInvite || pendingShare ? showRegister() : showLogin();
  if (pendingShare && config.me.role === "parent") {
    // Innlogget foresatt som åpner en delingslenke: blir foresatt for barnet.
    const token = pendingShare;
    pendingShare = null;
    try {
      const { child } = await api(`/shares/${token}/accept`, { method: "POST" });
      toast(`Du er nå foresatt for ${child}`);
      parentTab = "barn";
    } catch (err) { toast(err.message); }
  }
  if (pendingInvite) {
    // Allerede innlogget: en gruppeinvitasjon tas imot, en vanlig invitasjon trengs ikke.
    const token = pendingInvite;
    pendingInvite = null;
    if (config.me.role === "parent") {
      try {
        const { group } = await api(`/invites/${token}/accept`, { method: "POST" });
        toast(group ? `Du er invitert til ${group}` : "Du har allerede konto");
        parentTab = "barn";
      } catch (err) { toast(err.message); }
    }
  }
  if (config.me.role === "child") return showChild();
  if (!config.me.emailVerified) return showVerifyEmail();
  if (location.hash === "#admin" && config.me.isAdmin) {
    history.replaceState(null, "", location.pathname);
    parentTab = "admin";
  }
  const voksen = location.hash.match(/^#voksen=(\d+)$/);
  if (voksen) {
    history.replaceState(null, "", location.pathname);
    parentTab = "grupper";
    return showAdultChat({ id: Number(voksen[1]) }).catch((err) => { toast(err.message); return showParent(); });
  }
  return showParent();
}

// ---------- Innlogging ----------
function authHero(title, text) {
  // Uten tittel vises logoen med ordbildet (innloggingssiden), ellers appikonet og tittelen.
  return title
    ? h("div", { class: "auth-hero" }, logo(), h("h1", {}, title), h("p", {}, text))
    : h("div", { class: "auth-hero" }, h("h1", { class: "brand-title" }, lockup("hero-lockup")), text && h("p", {}, text));
}

function showLogin() {
  const warning = warningBox();
  const form = h("form", { class: "card" },
    field("E-post eller brukernavn", h("input", { name: "login", autocomplete: "username", autocapitalize: "none", autocorrect: "off", spellcheck: "false", required: true })),
    field("Passord", passwordInput({ name: "password", autocomplete: "current-password", required: true })),
    h("button", { class: "btn block" }, "Logg inn"),
    h("p", { class: "center", style: "margin:8px 0 0" },
      h("button", { class: "link small", type: "button", onclick: showForgot }, "Glemt passord?")),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/login", { method: "POST", body: formData(form) });
      start();
    } catch (err) { showWarning(warning, err.message); }
  });
  render(h("div", { class: "auth" },
    authHero(null),
    form,
    h("p", { class: "auth-switch" }, "Forelder eller foresatt? ",
      h("button", { class: "link", type: "button", onclick: showRegister }, "Lag konto")),
    h("p", { class: "auth-switch" }, h("a", { class: "link", href: "/om" }, `Slik gjør vi ${APP_NAME} trygt for barn`))));
}

// Invitasjon fra en annen foresatt (fra lenken #invitasjon=…). Gjelder til kontoen er laget.
let pendingInvite = null;
// Delingslenke for et barn (#barn=…). Tas imot når man lager konto eller logger inn.
let pendingShare = null;

async function showRegister() {
  const [{ codeRequired }, inv, shared] = await Promise.all([
    api("/signup-info").catch(() => ({ codeRequired: false })),
    pendingInvite ? api(`/invites/${pendingInvite}`).catch((err) => ({ error: err.message })) : null,
    pendingShare ? api(`/shares/${pendingShare}`).catch((err) => ({ error: err.message })) : null,
  ]);
  if (inv?.error) pendingInvite = null;
  if (shared?.error) pendingShare = null;
  // En delingslenke for et barn virker som en invitasjon.
  const invite = shared && !shared.error
    ? { inviter: shared.inviter, email: shared.email, share: shared.child }
    : inv || (shared?.error ? shared : null);
  const invited = invite && !invite.error;
  const warning = warningBox();
  const needCode = codeRequired && !invited;
  const form = h("form", { class: "card" },
    invited && h("div", { class: "notice invited" }, icon("mail"),
      h("div", {}, h("strong", {}, invite.share ? `${invite.inviter} vil dele ${invite.share} med deg` : `${invite.inviter} har invitert deg`),
        h("p", { class: "muted small" }, invite.share
          ? `Lag kontoen din her, så blir du foresatt for ${invite.share} med samme tilgang som ${invite.inviter}. Har du allerede konto, logger du inn i stedet.`
          : invite.group
            ? `Lag kontoen din her. Etterpå lager du en konto til barnet ditt og melder det inn i ${invite.group}, uten invitasjonskode.`
            : "Lag kontoen din her. Etterpå lager du kontoer til barna og ber om at de blir med i klassens gruppe."))),
    field("Navnet ditt", h("input", { name: "displayName", required: true, maxlength: 20, autocomplete: "given-name" })),
    field("E-post (du logger inn med denne)", h("input", { name: "email", type: "email", autocomplete: "username", autocapitalize: "none", inputmode: "email", required: true, value: invited ? invite.email || null : null })),
    field("Passord (minst 8 tegn)", passwordInput({ name: "password", autocomplete: "new-password", required: true, minlength: 8 })),
    needCode && h("div", { class: "code-help" },
      h("p", { class: "muted small" }, `${APP_NAME} er foreløpig bare for inviterte. Har du fått en invitasjon fra en annen foresatt, åpner du lenken i den. Ellers skriver du inn registreringskoden du har fått.`),
      field("Registreringskode", h("input", { name: "code", required: true, autocomplete: "off", autocapitalize: "none" }))),
    h("label", { class: "check" }, h("input", { type: "checkbox", required: true }),
      h("span", {}, "Jeg er over 18 år og er foresatt for barna jeg lager kontoer til.")),
    h("p", { class: "muted small" }, "Les hvordan vi behandler opplysninger i ", h("a", { class: "link", href: "/personvern" }, "personvernerklæringen"), "."),
    h("button", { class: "btn block" }, "Lag konto"),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/register", { method: "POST", body: { ...formData(form), invite: pendingInvite || undefined, share: pendingShare || undefined } });
      if (pendingShare) toast(`Du er nå foresatt for ${invite.share}`);
      pendingInvite = null;
      pendingShare = null;
      start();
    } catch (err) { showWarning(warning, err.message); }
  });
  if (invite?.error) showWarning(warning, invite.error);
  render(h("div", { class: "auth" },
    authHero("Ny foresatt-konto", "Du lager kontoer til barna dine og bestemmer hvilke grupper de er med i."),
    form,
    h("p", { class: "auth-switch" }, "Har du allerede konto? ",
      h("button", { class: "link", type: "button", onclick: showLogin }, "Logg inn")),
    installGuide()));
}

// Steg for steg: legg quipu på hjemskjermen. Vises ikke når appen allerede er åpnet fra hjemskjermen.
// Veiledningen for telefonen man bruker, er åpen fra start.
function installGuide() {
  if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) return null;
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const step = (...parts) => h("li", {}, ...parts);
  const ui = (name, text) => h("span", { class: "ui" }, icon(name), text);
  const guide = (title, open, steps, tip) => h("details", { class: "install-os", open: open || null },
    h("summary", {}, title),
    h("ol", { class: "steps" }, steps),
    tip && h("p", { class: "muted small" }, tip));
  return h("section", { class: "card install-guide" },
    h("div", { class: "notice" }, icon("phone"),
      h("div", {}, h("strong", {}, `Legg ${APP_NAME} på hjemskjermen`),
        h("p", { class: "muted small" }, "Da åpnes quipu som en vanlig app, uten adresselinje. Gjør det på telefonen til barnet også."))),
    guide("iPhone og iPad", isIos, [
      step("Åpne ", h("strong", {}, "www.quipu.no"), " i Safari."),
      step("Trykk på Del-knappen ", ui("share", ""), " nederst på skjermen (øverst til høyre på iPad). Ser du den ikke, trykk først på ", ui("dots", ""), "."),
      step("Bla ned og trykk ", ui("plusSquare", "Legg til på Hjem-skjerm"), "."),
      step("Trykk ", h("strong", {}, "Legg til"), " øverst til høyre. Nå ligger quipu på hjemskjermen."),
    ], "Bruker du Chrome eller en annen nettleser på iPhone, finner du det samme under Del-knappen."),
    guide("Android", isAndroid, [
      step("Åpne ", h("strong", {}, "www.quipu.no"), " i Chrome."),
      step("Trykk på menyen ", ui("dots", ""), " øverst til høyre."),
      step("Trykk ", h("strong", {}, "Legg til på startsiden"), " eller ", h("strong", {}, "Installer app"), "."),
      step("Trykk ", h("strong", {}, "Installer"), " eller ", h("strong", {}, "Legg til"), ". Nå ligger quipu på startskjermen."),
    ], "Bruker du Samsung Internet: trykk på menyen ☰ nederst, velg «Legg til side på» og så «Startskjerm»."));
}

function showForgot() {
  const warning = warningBox();
  const form = h("form", { class: "card" },
    field("E-postadressen på kontoen din", h("input", { name: "email", type: "email", autocomplete: "email", autocapitalize: "none", inputmode: "email", required: true })),
    h("button", { class: "btn block" }, "Send lenke"),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/password/forgot", { method: "POST", body: formData(form) });
      form.replaceChildren(h("div", { class: "notice" }, icon("mail"),
        h("div", {}, h("strong", {}, "Sjekk e-posten din"),
          h("p", { class: "muted small" }, "Hvis adressen hører til en konto, har vi sendt en lenke for å velge nytt passord. Den virker i én time. Se også i søppelpost.")))); 
    } catch (err) { showWarning(warning, err.message); }
  });
  render(h("div", { class: "auth" },
    authHero("Glemt passord", "Vi sender deg en lenke for å velge et nytt passord."),
    form,
    h("div", { class: "card notice" }, icon("user"),
      h("div", {}, h("strong", {}, "Er du barn?"),
        h("p", { class: "muted small" }, "Spør en voksen hjemme. De kan lage et nytt passord til deg."))),
    h("p", { class: "auth-switch" }, h("button", { class: "link", type: "button", onclick: showLogin }, "Tilbake til innlogging"))));
}

function showReset(token) {
  const warning = warningBox();
  const form = h("form", { class: "card" },
    field("Nytt passord (minst 8 tegn)", passwordInput({ name: "password", autocomplete: "new-password", required: true, minlength: 8 })),
    h("button", { class: "btn block" }, "Lagre nytt passord"),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/password/reset", { method: "POST", body: { token, password: formData(form).password } });
      toast("Passordet er endret. Du er logget inn.");
      start();
    } catch (err) {
      showWarning(warning, err.message);
      if (err.code === "RESET_INVALID") {
        form.append(h("p", { class: "center" }, h("button", { class: "link", type: "button", onclick: showForgot }, "Be om en ny lenke")));
      }
    }
  });
  render(h("div", { class: "auth" },
    authHero("Velg nytt passord", "Du blir logget ut på alle andre enheter."),
    form));
}

// Nye foresatte må åpne lenken i e-posten før de kan lage barn og grupper.
function showVerifyEmail() {
  const warning = warningBox();
  const change = h("form", { class: "hidden" },
    field("Riktig e-postadresse", h("input", { name: "email", type: "email", value: config.me.email, autocomplete: "email", autocapitalize: "none", inputmode: "email", required: true })),
    h("button", { class: "btn secondary block" }, "Send lenke hit"));
  change.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/me", { method: "PATCH", body: formData(change) });
      toast("Ny lenke er sendt");
      start();
    } catch (err) { showWarning(warning, err.message); }
  });
  render(h("div", { class: "auth" },
    authHero("Bekreft e-posten din", "Det sikrer at kontoen tilhører en ekte voksen, og at du får lenke hvis du glemmer passordet."),
    h("div", { class: "card" },
      h("div", { class: "notice" }, icon("mail"),
        h("div", {}, h("strong", {}, `Vi har sendt en lenke til ${config.me.email}`),
          h("p", { class: "muted small" }, "Åpne den for å ta i bruk kontoen. Se også i søppelpost."))),
      h("div", { class: "card-actions" },
        btn("Jeg har bekreftet", start),
        btn("Send på nytt", async () => {
          try {
            await api("/email/resend", { method: "POST" });
            toast("Ny lenke er sendt");
          } catch (err) { showWarning(warning, err.message); }
        }, "secondary")),
      change,
      warning),
    h("p", { class: "auth-switch" },
      h("button", { class: "link", type: "button", onclick: (e) => { e.currentTarget.remove(); change.classList.remove("hidden"); } }, "Feil adresse?"),
      " · ",
      h("button", { class: "link", type: "button", onclick: logout }, "Logg ut"))));
}

// ---------- Barn ----------
function showBlocked(err) {
  stopTimers();
  setHeader();
  const closed = err.code === "CLOSED";
  render(h("div", { class: "card blocked" },
    h("div", { class: "end-icon" }, icon(closed ? "moon" : "clock")),
    h("h2", {}, closed ? "Stengt for nå" : "Ferdig for i dag"),
    h("p", {}, err.message)),
  // Resten av appen er stengt, men barnet skal alltid kunne si fra og få hjelp.
  h("div", { class: "blocked-help" },
    danger(),
    call("116 111", "Alarmtelefonen, alltid åpen"),
    h("p", {}, h("button", { type: "button", class: "link small", onclick: openSafety }, icon("flag"), "Si fra om noe annet"))));
}

function handleChildError(err) {
  if (err.code === "CLOSED" || err.code === "TIME_UP") showBlocked(err);
  else toast(err.message);
}

function stopTimers() {
  clearInterval(heartbeatTimer);
  clearInterval(newPostsTimer);
  document.removeEventListener("visibilitychange", checkNewPosts);
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const { status } = await api("/heartbeat", { method: "POST" });
      updateTimeLeft(status.minutesLeft);
    } catch (err) { handleChildError(err); }
  }, 60000);
}

// Introduksjon første gang barnet logger inn. Kan åpnes igjen nederst i feeden.
const INTRO = [
  {
    icon: "sparkles",
    title: `Velkommen til ${APP_NAME}`,
    text: ["Her deler du ting med klassen din. Det finnes ingen likes, følgere eller tall, så det er ingenting å konkurrere om.",
      "Du ser bare innlegg fra gruppene du er med i."],
  },
  {
    icon: "eye",
    title: "Voksne kan se det du deler",
    text: ["Foreldrene dine, og foreldrene til de andre i gruppa, kan lese alt som blir delt i gruppa. Det gjelder også innleggene dine.",
      "Bilder og videoer blir som regel sett av en voksen før de andre i gruppa får se dem. Alt som deles, slettes av seg selv etter 60 dager.",
      "Det er for å passe på at alle har det bra her. Det du skriver, blir ikke sendt før du trykker «Del»."],
  },
  {
    icon: "pencil",
    title: "Del noe fint",
    text: ["Du kan skrive om hva du vil, stille spørsmål eller dele tips. Vil du, kan du sette en merkelapp på innlegget, for eksempel «Glad for», «Spørsmål» eller «Har laget».",
      "Et godt spørsmål før du deler: Ville jeg sagt dette ansikt til ansikt?",
      "Del aldri adresse, telefonnummer eller passord."],
  },
  {
    icon: "shield",
    title: "Hvis noe føles feil",
    text: ["Trykk «Si fra» på innlegget. Da blir det skjult, og en voksen ser på det. Den voksne som har ansvar for gruppa, og de som passer på quipu, kan lese innlegg som noen har sagt fra om.",
      "Er det noe annet, eller gjelder det en voksen, trykker du «Si fra om noe annet» nederst i feeden. Det leser bare de som passer på quipu.",
      "Snakk gjerne med en voksen du stoler på, eller ring Alarmtelefonen for barn og unge på 116 111. Den er gratis og alltid åpen.",
      `${APP_NAME} har en tidsgrense og stenger om kvelden. Det er meningen – det er mye annet gøy å gjøre også.`],
  },
];

function showIntro({ again = false } = {}) {
  let step = 0;
  const draw = () => {
    const s = INTRO[step];
    const last = step === INTRO.length - 1;
    render(h("div", { class: "card intro" },
      h("div", { class: "intro-dots", "aria-hidden": "true" }, INTRO.map((_, i) => h("i", { class: i === step ? "on" : "" }))),
      h("div", { class: "end-icon" }, icon(s.icon)),
      h("h2", {}, s.title),
      s.text.map((t) => h("p", {}, t)),
      h("div", { class: "intro-nav" },
        step > 0 ? btn("Tilbake", () => { step--; draw(); }, "ghost") : h("span", {}),
        btn(last ? (again ? "Ferdig" : "Jeg forstår") : "Neste", async () => {
          if (!last) { step++; return draw(); }
          if (!again) {
            await api("/onboarded", { method: "POST" }).catch(() => {});
            config.me.onboarded = true;
          }
          showChild();
        }))));
    window.scrollTo(0, 0);
  };
  draw();
}

async function showChild() {
  if (!config.me.onboarded) return showIntro();
  let data;
  try {
    data = await api("/feed");
  } catch (err) { return handleChildError(err); }
  startHeartbeat();
  watchNewPosts(Math.max(0, ...data.posts.map((p) => p.id)));
  const { status } = data;
  const groups = config.me.groups;
  setHeader(status);

  render(
    newPostsBar,
    composePrompt(groups, status),
    ...data.posts.map((p) => postCard(p)),
    h("div", { class: "feed-end" },
      h("div", { class: "end-icon" }, icon("check")),
      h("h3", {}, data.posts.length ? "Du er oppdatert" : "Ingenting nytt ennå"),
      h("p", {}, data.posts.length ? "Det var alt fra de siste tre dagene." : "Ingen har delt noe de siste tre dagene."),
      btn("Se etter nytt", showChild, "secondary small", "refresh"),
      h("p", {},
        h("button", { type: "button", class: "link small", onclick: () => showIntro({ again: true }) }, `Slik fungerer ${APP_NAME}`),
        " · ",
        h("button", { type: "button", class: "link small", onclick: openAvatarSheet }, "Bytt profilbilde")),
      h("p", {}, h("button", { type: "button", class: "link small", onclick: openSafety }, icon("flag"), "Si fra om noe annet"))));
}

// Nye innlegg mens feeden er åpen: en rolig knapp øverst, ingen lyd og ingen varsler utenfor appen.
// Innleggene settes ikke inn av seg selv, så teksten barnet leser, ikke hopper. Sjekker bare når appen vises.
const NEW_POSTS_EVERY = 20000;
let newPostsSince = 0;
let newPostsUrl = "/feed/new";
let newPostsReload = () => showChild();
let newPostsWords = ["nytt innlegg", "nye innlegg"];
const newPostsBar = h("button", { type: "button", class: "new-posts hidden", onclick: () => { window.scrollTo({ top: 0 }); newPostsReload(); } });

// Brukes av barnas feed og av foresattes visning av en gruppe.
function watchNewPosts(since, url = "/feed/new", reload = () => showChild(), words = ["nytt innlegg", "nye innlegg"]) {
  newPostsSince = since;
  newPostsWords = words;
  newPostsUrl = url;
  newPostsReload = reload;
  newPostsBar.classList.add("hidden");
  clearInterval(newPostsTimer);
  newPostsTimer = setInterval(checkNewPosts, NEW_POSTS_EVERY);
  document.addEventListener("visibilitychange", checkNewPosts);
}

async function checkNewPosts() {
  if (document.visibilityState !== "visible") return;
  try {
    const { count } = await api(`${newPostsUrl}?since=${newPostsSince}`);
    newPostsBar.replaceChildren(icon("refresh"), `${count} ${newPostsWords[count === 1 ? 0 : 1]}`);
    newPostsBar.classList.toggle("hidden", !count);
  } catch (err) {
    if (err.code === "CLOSED" || err.code === "TIME_UP") handleChildError(err);
  }
}

function composePrompt(groups, status) {
  if (!groups.length) {
    return h("div", { class: "card notice" }, icon("users"),
      h("div", {}, h("strong", {}, "Du er ikke med i noen gruppe ennå"),
        h("p", { class: "muted small" }, "Be en voksen om å legge deg til i gruppa til klassen din.")));
  }
  if (status.postsLeft <= 0) {
    return h("div", { class: "card notice" }, icon("check"),
      h("div", {}, h("strong", {}, "Du har delt det du kan i dag"),
        h("p", { class: "muted small" }, "Du kan dele mer i morgen.")));
  }
  // Skrivefeltet ligger rett i feeden. Det er smalt til barnet trykker i det, og da kommer resten fram.
  const groupName = groups.length === 1 ? groups[0].name : "gruppene dine";
  const card = h("section", { class: "card composer-inline collapsed" });
  card.append(composer(groups, () => showChild()));
  card.addEventListener("focusin", () => card.classList.remove("collapsed"));
  return [
    card,
    h("div", { class: "compose-meta" },
      h("span", { class: "audience" }, icon("eye"), h("span", {}, `${groupName} og foreldrene i gruppa ser det du deler`)),
      h("span", {}, (status.postsLeft === 1 ? "1 innlegg igjen i dag" : `${status.postsLeft} innlegg igjen i dag`)
        + (status.postsCarried > 0 ? ` (${status.postsCarried} spart fra i går)` : ""))),
  ];
}

// Skrivefeltet øverst i feeden. «close» legger det sammen igjen (tegner feeden på nytt).
function composer(groups, close) {
  const text = h("textarea", { maxlength: 200, placeholder: "Del noe …", "aria-label": "Innlegg", rows: 4 });
  text.addEventListener("focus", () => { if (text.placeholder === "Del noe …") text.placeholder = DEFAULT_PROMPT; }, { once: true });
  // Merkelapp er valgfri: trykk for å velge, trykk igjen for å fjerne.
  const kindRow = h("div", { class: "kinds", role: "group", "aria-label": "Merkelapp (valgfritt)" });
  kindRow.value = "";
  for (const k of Object.keys(config.kinds)) {
    const b = h("button", { type: "button", "aria-pressed": "false" }, icon(KIND_ICONS[k] || "sparkles"), h("span", {}, config.kinds[k]));
    b.addEventListener("click", () => {
      const selecting = kindRow.value !== k;
      kindRow.querySelectorAll("button").forEach((x) => { x.classList.remove("selected"); x.setAttribute("aria-pressed", "false"); });
      if (selecting) { b.classList.add("selected"); b.setAttribute("aria-pressed", "true"); }
      kindRow.value = selecting ? k : "";
      text.placeholder = selecting ? KIND_PROMPTS[k] || DEFAULT_PROMPT : DEFAULT_PROMPT;
    });
    kindRow.append(b);
  }
  const count = h("span", { class: "count" }, "0/200");
  const editor = h("div", { class: "editor" }, text);
  const warning = warningBox();

  // Emoji velges i et lite panel under skrivefeltet.
  const emojiBtn = iconBtn("smile", "Emoji");
  const stickerRow = choiceRow(config.stickers, (b, s) => (s ? (b.textContent = s) : b.append(icon("x"))), "", "stickers", (s) => {
    emojiBtn.replaceChildren(s ? h("span", { class: "chosen" }, s) : icon("smile"));
  });
  stickerRow.setAttribute("aria-label", "Emoji");
  const emojiPanel = h("div", { class: "picker hidden" }, stickerRow);
  emojiBtn.addEventListener("click", () => {
    emojiBtn.classList.toggle("active", emojiPanel.classList.toggle("hidden") === false);
  });

  // ---- Bilde eller video ----
  const limits = config.media;
  let attachment = null; // { id, type } når opplastingen er ferdig
  let uploading = false;
  const preview = h("div", { class: "preview hidden" });
  const fileInput = h("input", { type: "file", accept: "image/*,video/*", class: "visually-hidden", id: "fileInput" });
  const attachBtn = h("label", { class: "icon-btn", for: "fileInput", "aria-label": "Bilde eller video", title: "Bilde eller video" }, icon("image"));

  const clearAttachment = () => {
    attachment = null;
    preview.replaceChildren();
    preview.classList.add("hidden");
    fileInput.value = "";
  };

  let picks = 0; // teller filvalg, så en video som blir ferdig sent, ikke tar over for en nyere
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    warning.classList.add("hidden");
    const isVideo = file.type.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(file.name);
    const pick = ++picks;
    const bar = h("progress", { max: 1, value: 0 });
    const status = h("span", {}, "Laster opp …");
    let blob = file;
    try {
      if (isVideo) {
        const d = await videoDuration(file);
        if (d && d > limits.videoSeconds + 0.5) {
          clearAttachment();
          return showWarning(warning, `Videoen er ${Math.round(d)} sekunder. Maks er ${limits.videoSeconds} sekunder. Du kan klippe den i Bilder-appen.`);
        }
        // Videoen gjøres mindre på telefonen før opplasting (video.js). Går ikke det, lastes originalen opp.
        status.textContent = "Gjør videoen mindre …";
        preview.replaceChildren(h("div", { class: "upload-row" }, status, bar));
        preview.classList.remove("hidden");
        uploading = true;
        send.disabled = true;
        try {
          blob = (await shrinkVideo(file, { onProgress: (p) => (bar.value = p) })) || file;
        } finally {
          uploading = false;
          send.disabled = false;
        }
        if (pick !== picks) return; // barnet har valgt en annen fil i mellomtiden
        if (blob.size > limits.videoMb * 1024 * 1024) {
          clearAttachment();
          return showWarning(warning, `Videoen er for stor (${Math.round(blob.size / 1048576)} MB). Maks er ${limits.videoMb} MB.`);
        }
        bar.value = 0;
        status.textContent = "Laster opp …";
      } else {
        blob = await prepareImage(file);
      }
    } catch (err) {
      clearAttachment();
      return showWarning(warning, err.message);
    }

    const localUrl = URL.createObjectURL(blob);
    const media = isVideo
      ? h("video", { src: localUrl, controls: true, playsinline: true, muted: true, preload: "metadata" })
      : h("img", { src: localUrl, alt: "Bildet du har valgt" });
    preview.replaceChildren(media, h("div", { class: "upload-row" }, status, bar,
      h("button", { type: "button", class: "link danger small", onclick: clearAttachment }, "Fjern")),
      // Ingen automatisk sjekk av bildet, så barnet minnes på det selv.
      h("p", { class: "media-tip muted small" }, icon("eye"),
        h("span", {}, `Sjekk før du deler: Viser ${isVideo ? "videoen" : "bildet"} adresse, skolen din eller andre barn? Spør dem først, og del aldri noe som viser hvor du bor.`)));
    preview.classList.remove("hidden");

    uploading = true;
    send.disabled = true;
    try {
      attachment = await uploadMedia(blob, (p) => (bar.value = p));
      status.textContent = isVideo ? "Video lagt til" : "Bilde lagt til";
      bar.remove();
    } catch (err) {
      clearAttachment();
      if (err.code === "CLOSED" || err.code === "TIME_UP") { close(); return handleChildError(err); }
      showWarning(warning, err.message);
    } finally {
      uploading = false;
      send.disabled = false;
    }
  });

  text.addEventListener("input", () => {
    count.textContent = `${text.value.length}/200`;
    warning.classList.add("hidden");
  });

  const groupSelect = h("select", { "aria-label": "Gruppe" }, ...groups.map((g) => h("option", { value: g.id }, g.name)));
  const send = h("button", { class: "btn", type: "button" }, "Del");
  send.addEventListener("click", async () => {
    if (uploading) return;
    send.disabled = true;
    try {
      const { pending } = await api("/posts", {
        method: "POST",
        body: {
          groupId: Number(groupSelect.value), kind: kindRow.value, text: text.value,
          sticker: stickerRow.value, mediaId: attachment?.id,
        },
      });
      toast(pending ? "Delt. En voksen ser på bildet eller videoen først." : "Delt!");
      showChild();
    } catch (err) {
      send.disabled = false;
      if (err.code === "CLOSED" || err.code === "TIME_UP") { close(); handleChildError(err); }
      else showWarning(warning, err.message);
    }
  });

  editor.append(h("div", { class: "toolbar" }, attachBtn, emojiBtn, count));

  // Skriv først, merkelapp etterpå. «Avbryt» legger feltet sammen igjen.
  const cancel = h("button", { type: "button", class: "btn ghost" }, "Avbryt");
  cancel.addEventListener("click", () => close());
  return h("div", { class: "composer" },
    editor,
    fileInput,
    emojiPanel,
    preview,
    h("div", { class: "kinds-label" }, "Merkelapp ", h("span", { class: "faint" }, "(valgfritt)")),
    kindRow,
    warning,
    h("div", { class: "composer-foot" },
      groups.length > 1 ? groupSelect : h("span", { class: "to" }, `Til ${groups[0].name}`),
      cancel,
      send));
}

function postCard(p, { actions } = {}) {
  return h("article", { class: `post${p.status === "hidden" ? " flagged" : ""}` },
    h("div", { class: "head" },
      avatar(p.avatar),
      h("div", { class: "who" },
        h("div", { class: "name" }, p.author),
        h("div", { class: "meta" }, `${p.groupName} · ${timeAgo(p.createdAt)}`)),
      config.kinds[p.kind] && h("span", { class: "kind-tag" }, icon(KIND_ICONS[p.kind] || "sparkles"), config.kinds[p.kind])),
    // Snakkeboble med logoens form: halen til venstre for andre, til høyre for egne innlegg.
    h("div", { class: `body bubble${p.mine ? " mine" : ""}` }, p.text, p.sticker && h("span", { class: "sticker" }, p.sticker)),
    p.media && mediaView(p),
    h("div", { class: "actions" }, actions ? actions(p) : childActions(p)));
}

function mediaView(p) {
  const src = `/api/media/${p.media.id}`;
  const el = p.media.type === "video"
    // playsinline: ellers åpner iPhone videoen i fullskjerm. Ingen autoavspilling.
    ? h("video", { src, controls: true, playsinline: true, preload: "metadata" })
    : h("img", { src, alt: `Bilde fra ${p.author}`, loading: "lazy" });
  return h("div", { class: "media" }, el,
    p.media.pending && p.mine && h("p", { class: "status-note" }, icon("clock"),
      `Bare du ser ${p.media.type === "video" ? "videoen" : "bildet"} til en voksen har godkjent det`));
}

function childActions(p) {
  if (p.mine) {
    return btn("Slett", async () => {
      if (!confirm("Vil du slette innlegget ditt?")) return;
      await api(`/posts/${p.id}`, { method: "DELETE" }).then(showChild, handleChildError);
    }, "ghost", "trash");
  }
  return btn("Si fra", () => openReport(p), "ghost", "flag");
}

// ---------- Si fra ----------
// Velg hva det gjelder, så alvorlige saker kommer først hos de voksne.
function categoryPicker() {
  const cats = config.reportCategories || { annet: { label: "Noe annet" } };
  const group = h("div", { class: "report-cats", role: "radiogroup", "aria-label": "Hva gjelder det?" });
  for (const [key, c] of Object.entries(cats)) {
    group.append(h("label", { class: "report-cat" }, h("input", { type: "radio", name: "category", value: key, required: true }), h("span", {}, c.label)));
  }
  return group;
}

// Beskjed etterpå: hva som skjer nå, og hvor barnet kan få hjelp.
// Telefonnumre barnet kan trykke på for å ringe. Telefonen spør alltid før den ringer.
const call = (number, label) => h("a", { class: "help-line", href: `tel:${number.replaceAll(" ", "")}` },
  icon("phone"), h("span", {}, h("strong", {}, number), ` · ${label}`));
const danger = () => h("p", { class: "danger-now" }, h("strong", {}, "Er du i fare akkurat nå? ", h("a", { href: "tel:112" }, "Ring 112"), "."));

function reportThanks(close, text) {
  return h("div", { class: "report-thanks" },
    h("div", { class: "end-icon" }, icon("check")),
    h("p", {}, text),
    danger(),
    h("p", { class: "muted small" }, "Er du redd eller lei deg, snakk med en voksen du stoler på. Du kan også ringe Alarmtelefonen for barn og unge. Den er gratis og alltid åpen, og du trenger ikke si hvem du er. Vil du heller prate om hvordan du har det, kan du ringe eller chatte med Kors på halsen."),
    call("116 111", "Alarmtelefonen for barn og unge"),
    call("800 33 321", "Kors på halsen"),
    btn("Ferdig", close, "block"));
}

function openReport(p) {
  openSheet("Si fra om innlegget", (close) => {
    const warning = warningBox();
    const form = h("form", {},
      h("p", { class: "muted small" }, "Innlegget blir skjult for de andre med en gang. Den voksne som har ansvar for gruppa, og de som passer på quipu, ser på det. Den som skrev det, får ikke vite at det var du."),
      h("p", { class: "field-label" }, "Hva gjelder det?"),
      categoryPicker(),
      h("button", { class: "btn block" }, icon("flag"), "Si fra"),
      warning);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api(`/posts/${p.id}/report`, { method: "POST", body: { category: formData(form).category } });
        form.replaceWith(reportThanks(() => { close(); showChild(); }, "Takk for at du sa fra. Innlegget er skjult, og en voksen ser på det."));
      } catch (err) {
        if (err.code === "CLOSED" || err.code === "TIME_UP") { close(); return handleChildError(err); }
        showWarning(warning, err.message);
      }
    });
    return form;
  });
}

// Si fra om noe som ikke står i et innlegg, eller som gjelder en voksen. Bare de som passer på quipu, leser det.
function openSafety() {
  openSheet("Si fra om noe annet", (close) => {
    const warning = warningBox();
    const text = h("textarea", { name: "text", required: true, minlength: 3, maxlength: 1000, rows: 4, placeholder: "Skriv hva som har skjedd, og hvem det gjelder" });
    const form = h("form", {},
      h("p", { class: "muted small" }, "Dette leser bare de som passer på quipu, ikke de andre i gruppa, og ikke foreldrene dine. Bruk det hvis noe er ekkelt eller skummelt, også hvis det gjelder en voksen."),
      h("p", { class: "field-label" }, "Hva gjelder det?"),
      categoryPicker(),
      field("Hva har skjedd?", text),
      h("button", { class: "btn block" }, icon("flag"), "Send"),
      warning);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/safety", { method: "POST", body: formData(form) });
        form.replaceWith(reportThanks(close, "Takk for at du sa fra. En voksen som passer på quipu, leser det du skrev."));
      } catch (err) { showWarning(warning, err.message); }
    });
    return form;
  });
}

// ---------- Opplasting ----------
// Opplasting med fremdrift (fetch kan ikke vise fremdrift for opplasting).
function uploadMedia(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.setRequestHeader("X-Upload", "1");
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ikke JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data.error || "Opplastingen feilet"), { status: xhr.status, code: data.code }));
    };
    xhr.onerror = () => reject(new Error("Fikk ikke kontakt. Sjekk nettet og prøv igjen."));
    xhr.send(blob);
  });
}

// Bilder tegnes på nytt i et canvas: det fjerner EXIF/GPS, retter opp rotasjon,
// gjør dem mindre og gjør HEIC fra iPhone om til WebP eller JPEG.
// 1440 punkter på den lengste siden er skarpt nok for feeden på mobil og PC, også på skjermer med høy oppløsning.
// WebP blir 25–35 % mindre enn JPEG med samme kvalitet. Nettlesere som ikke kan lage WebP, lager JPEG i stedet.
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Klarte ikke å åpne bildet. Prøv et annet."));
      i.src = url;
    });
    const MAX = 1440;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    const webp = await encode("image/webp", 0.8);
    return webp?.type === "image/webp" ? webp : await encode("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Sjekker lengden før opplasting, så barnet slipper å vente på en video som blir avvist.
// Serveren sjekker uansett selv.
function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

// ---------- Foresatte ----------
async function showParent() {
  stopTimers(); // slutt å se etter nye innlegg når man går ut av en gruppe
  const [{ children }, { groups, invitations = [] }] = await Promise.all([api("/children"), api("/groups")]);
  const todo = groups.reduce((n, g) => n + (g.openReports || 0) + (g.pendingMedia || 0) + (g.pendingMembers?.length || 0) + (g.adultUnread || 0), 0);

  const tab = (key, label) => h("button", {
    type: "button", role: "tab", class: parentTab === key ? "selected" : "", "aria-selected": String(parentTab === key),
    onclick: () => { parentTab = key; showParent(); },
  }, label, key === "grupper" && todo ? h("span", { class: "count" }, todo) : null);

  const content = {
    barn: () => childrenTab(children, invitations),
    grupper: () => groupsTab(groups),
    konto: accountTab,
    admin: adminTab,
  }[parentTab]();

  const emailNotice = !config.me.email && parentTab !== "konto" && h("div", { class: "card notice" }, icon("mail"),
    h("div", {}, h("strong", {}, "Legg inn e-posten din"),
      h("p", { class: "muted small" }, "Da kan du få en lenke for å velge nytt passord hvis du glemmer det."),
      btn("Legg inn e-post", () => { parentTab = "konto"; showParent(); }, "soft small")));

  render(
    emailNotice,
    h("div", { class: `tabs${config.me.isAdmin ? " four" : ""}`, role: "tablist" }, tab("barn", "Barn"), tab("grupper", "Grupper"), tab("konto", "Konto"),
      config.me.isAdmin && tab("admin", "Admin")),
    content);
}

function childrenTab(children, invitations) {
  return [
    ...invitations.map((inv) => invitationCard(inv, children)),
    h("div", { class: "section-title" }, h("h2", {}, "Barna mine"), btn("Legg til", openAddChild, "soft small", "plus")),
    children.length ? null : h("div", { class: "card empty" },
      h("div", { class: "end-icon" }, icon("user")),
      h("p", {}, "Lag en konto til barnet ditt for å komme i gang.")),
    ...children.map((c) => childCard(c, invitations)),
  ];
}

// Meld et barn inn i en gruppe man er invitert til. Trenger ingen invitasjonskode.
async function joinInvited(inv, c) {
  try {
    const { pending } = await api("/groups/join", { method: "POST", body: { groupId: inv.id, childId: c.id } });
    toast(pending ? "Forespørselen er sendt. Den som eier gruppa, må godkjenne den." : `${c.displayName} er med i ${inv.name}`);
    showParent();
  } catch (err) { toast(err.message); }
}

// Øverst under Barn: «Du er invitert til 6B», med knapp for hvert barn som ikke er med ennå.
function invitationCard(inv, children) {
  const missing = children.filter((c) => !c.groups.some((g) => g.id === inv.id));
  if (children.length && !missing.length) return null;
  return h("section", { class: "card notice invitation" }, icon("mail"),
    h("div", {},
      h("strong", {}, `Du er invitert til ${inv.name}`),
      h("p", { class: "muted small" }, children.length
        ? `${inv.inviter ? `${inv.inviter} har invitert deg. ` : ""}Meld inn barnet ditt, så trenger du ingen invitasjonskode.`
        : `${inv.inviter ? `${inv.inviter} har invitert deg. ` : ""}Lag en barnekonto først, så kan du melde barnet inn i ${inv.name}.`),
      h("div", { class: "row" },
        ...missing.map((c) => btn(`Meld inn ${c.displayName}`, () => joinInvited(inv, c), "small", "plus")),
        btn("Skjul", async () => { await api(`/invitations/${inv.id}`, { method: "DELETE" }).catch(() => {}); showParent(); }, "ghost small"))));
}

function meter(label, used, max, unit) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return h("div", { class: "meter" },
    h("div", { class: "label" }, label),
    h("div", { class: "value" }, `${used}`, h("span", {}, ` av ${max} ${unit}`)),
    h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })));
}

function childCard(c, invitations = []) {
  const num = (name, value, min, max) => h("input", { name, type: "number", inputmode: "numeric", value, min, max, required: true });
  const time = (name, value) => h("input", { name, type: "time", value, required: true });

  const warning = warningBox();
  const settings = h("form", { class: "settings hidden" },
    h("div", { class: "grid" },
      field("Minutter per dag", num("dailyMinutes", c.dailyMinutes, 0, 120)),
      field("Innlegg per dag", num("postsPerDay", c.postsPerDay, 0, 10)),
      h("p", { class: "muted small" }, "Ubrukte innlegg fra i går kan brukes i dag, men aldri mer enn dobbelt så mange som dagsgrensen."),
      field("Åpen fra", time("openFrom", c.openFrom)),
      field("Åpen til", time("openTo", c.openTo)),
      h("p", { class: "muted small" }, `${APP_NAME} er stengt minst 10 timer hver natt, og alltid mellom kl. 23 og 06, så barnet får en ordentlig pause og sover godt.`),
      h("div", { class: "full" }, field("Nytt passord (valgfritt)", passwordInput({ name: "password", autocomplete: "new-password", minlength: 8 })))),
    h("div", { class: "row between" },
      h("button", { class: "btn small" }, "Lagre"),
      // Med flere foresatte kan man bare fjerne seg selv. Barnekontoen slettes av den siste.
      c.guardians.length > 1
        ? h("button", {
          type: "button", class: "link danger small",
          onclick: async () => {
            if (!confirm(`Fjerne deg som foresatt for ${c.displayName}? Du ser ikke barnet lenger, men de andre foresatte beholder tilgangen.`)) return;
            try {
              await api(`/children/${c.id}/leave`, { method: "POST" });
              showParent();
            } catch (err) { toast(err.message); }
          },
        }, "Fjern meg som foresatt")
        : h("button", {
          type: "button", class: "link danger small",
          onclick: async () => {
            if (!confirm(`Slette kontoen til ${c.displayName}? Alle innleggene slettes også.`)) return;
            await api(`/children/${c.id}`, { method: "DELETE" });
            showParent();
          },
        }, "Slett barnekontoen")),
    warning);
  settings.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(settings);
    const body = { dailyMinutes: Number(d.dailyMinutes), postsPerDay: Number(d.postsPerDay), openFrom: d.openFrom, openTo: d.openTo };
    if (d.password) body.password = d.password;
    try {
      await api(`/children/${c.id}`, { method: "PATCH", body });
      toast("Lagret");
      showParent();
    } catch (err) { showWarning(warning, err.message); }
  });

  const join = h("form", { class: "row join hidden" },
    h("input", { name: "code", placeholder: "Invitasjonskode", required: true, autocapitalize: "characters", autocomplete: "off", "aria-label": "Invitasjonskode" }),
    h("button", { class: "btn secondary" }, "Legg til"));
  join.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { pending } = await api("/groups/join", { method: "POST", body: { code: formData(join).code, childId: c.id } });
      toast(pending ? "Forespørselen er sendt. Den som eier gruppa, må godkjenne den." : `${c.displayName} er lagt til i gruppa`);
      showParent();
    } catch (err) { toast(err.message); }
  });

  const used = c.dailyMinutes - c.status.minutesLeft;
  const settingsBtn = iconBtn("sliders", "Grenser og passord", () => {
    settings.classList.toggle("hidden");
    settingsBtn.classList.toggle("active");
  });

  return h("section", { class: "card" },
    h("div", { class: "entity-head" },
      avatar(c.avatar, "lg"),
      h("div", { class: "who" }, h("h3", {}, c.displayName), h("div", { class: "sub" }, `@${c.username} · åpen ${c.openFrom}–${c.openTo}`)),
      settingsBtn),
    h("div", { class: "meters" },
      meter("Skjermtid i dag", used, c.dailyMinutes, "min"),
      meter("Innlegg i dag", c.status.postsToday, c.status.postAllowance, "")),
    h("div", { class: "subhead" }, "Grupper"),
    h("div", { class: "chips" },
      c.groups.length ? c.groups.map((g) => h("span", { class: `chip${g.pending ? " pending" : ""}` }, g.name,
        g.pending && h("small", {}, "venter"),
        iconBtn("x", g.pending ? `Trekk forespørselen til ${g.name}` : `Ta ut av ${g.name}`, async () => {
          if (!g.pending && !confirm(`Ta ${c.displayName} ut av ${g.name}?`)) return;
          await api(`/groups/${g.id}/leave`, { method: "POST", body: { childId: c.id } });
          showParent();
        }))) : null,
      ...invitations.filter((inv) => !c.groups.some((g) => g.id === inv.id)).map((inv) =>
        h("button", { type: "button", class: "chip add invited", title: `Invitert til ${inv.name}`, onclick: () => joinInvited(inv, c) }, icon("plus"), inv.name)),
      h("button", {
        type: "button", class: "chip add",
        onclick: (e) => { e.currentTarget.classList.add("hidden"); join.classList.remove("hidden"); join.querySelector("input").focus(); },
      }, icon("plus"), "Gruppe")),
    join,
    h("div", { class: "subhead" }, "Foresatte"),
    h("div", { class: "guardians" },
      h("span", {}, c.guardians.map((g) => (g.me ? `${g.displayName} (deg)` : g.displayName)).join(" og ")),
      btn("Del med en annen foresatt", () => openShareChild(c), "secondary small", "users")),
    settings);
}

// Gi en annen foresatt samme tilgang til barnet: en engangslenke på e-post eller til å dele selv.
function openShareChild(c) {
  openSheet(`Del ${c.displayName}`, () => {
    const warning = warningBox();
    const box = h("div", {});
    const form = h("form", {},
      h("p", { class: "muted small" }, `Den andre foresatte får samme tilgang som deg: ser innleggene og gruppene til ${c.displayName}, og kan endre grenser og passord. Ingen av dere kan fjerne den andre, og barnekontoen kan bare slettes når det er én foresatt igjen.`),
      field("E-post til den andre foresatte (valgfritt)", h("input", { name: "email", type: "email", autocomplete: "off", autocapitalize: "none", inputmode: "email" })),
      h("p", { class: "muted small" }, "Uten e-post får du en lenke du kan sende selv. Lenken virker i 7 dager og kan brukes én gang. Del den bare med den du mener."),
      h("button", { class: "btn block" }, icon("users"), "Lag lenke"),
      warning);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { email } = formData(form);
      try {
        const { url, status } = await api(`/children/${c.id}/share`, { method: "POST", body: { email: email || undefined } });
        const share = navigator.share && btn("Del", () => navigator.share({ title: `${c.displayName} i ${APP_NAME}`, text: `Bli foresatt for ${c.displayName} i ${APP_NAME}:`, url }).catch(() => {}), "secondary small", "share");
        box.replaceChildren(...[
          status === "sent" && h("div", { class: "notice" }, icon("check"),
            h("div", {}, h("strong", {}, "Lenken er sendt"), h("p", { class: "muted small" }, `Vi sendte den til ${email}. Du får en e-post når den er tatt i bruk.`))),
          status === "not_sent" && h("p", { class: "warning" }, icon("alert"), h("span", {}, "E-posten ble ikke sendt. Kopier lenken og send den selv.")),
          h("div", { class: "code-box invite-link" },
            h("div", {}, h("div", { class: "label" }, "Delingslenke"), h("code", {}, url)),
            h("div", { class: "row" }, btn("Kopier", () => copyText(url, "Lenken"), "secondary small", "copy"), share)),
        ].filter(Boolean));
        form.replaceWith(box);
      } catch (err) { showWarning(warning, err.message); }
    });
    return form;
  });
}

function openAddChild() {
  openSheet("Ny barnekonto", (close) => {
    const avatars = avatarPicker(config.avatars[0]);
    const warning = warningBox();
    const form = h("form", {},
      field("Kallenavn (ikke fullt navn)", h("input", { name: "displayName", required: true, maxlength: 20 })),
      field("Brukernavn til innlogging", h("input", { name: "username", required: true, autocomplete: "off", autocapitalize: "none" })),
      field("Passord (minst 8 tegn)", passwordInput({ name: "password", required: true, minlength: 8, autocomplete: "new-password" })),
      h("div", { class: "subhead" }, "Profilbilde"), avatars,
      h("button", { class: "btn block" }, "Lag konto"),
      warning);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/children", { method: "POST", body: { ...formData(form), avatar: avatars.value } });
        close();
        toast("Barnekonto laget");
        parentTab = "barn";
        showParent();
      } catch (err) { showWarning(warning, err.message); }
    });
    return form;
  });
}

function groupsTab(groups) {
  return [
    h("div", { class: "section-title" }, h("h2", {}, "Grupper"), btn("Ny gruppe", openNewGroup, "soft small", "plus")),
    h("p", { class: "muted small", style: "margin:-6px 2px 14px" },
      "Barn ser bare innlegg fra gruppene de er med i. Del invitasjonskoden med de andre foresatte i klassen."),
    groups.length ? null : h("div", { class: "card empty" },
      h("div", { class: "end-icon" }, icon("users")),
      h("p", {}, "Lag en gruppe for klassen, eller bruk en invitasjonskode fra en annen forelder under «Barn».")),
    ...groups.map(groupCard),
  ];
}

function groupCard(g) {
  return h("section", { class: "card" },
    h("div", { class: "entity-head" },
      h("span", { class: "avatar lg" }, icon("users")),
      h("div", { class: "who" },
        h("h3", {}, g.name),
        h("div", { class: "sub" }, `${g.members.length} ${g.members.length === 1 ? "medlem" : "medlemmer"}${g.isOwner ? " · du er eier" : ""}`),
        (g.openReports || g.pendingMedia) ? h("div", { class: "badges" },
          g.openReports ? h("span", { class: "badge" }, `${g.openReports} rapportert`) : null,
          g.pendingMedia ? h("span", { class: "badge warn" }, `${g.pendingMedia} venter på godkjenning`) : null) : null),
      g.members.length ? h("div", { class: "avatars-stack", "aria-hidden": "true" }, g.members.slice(0, 4).map((m) => avatar(m.avatar, "sm"))) : null),
    g.pendingMembers?.length ? pendingMembers(g) : null,
    g.isOwner && g.members.length ? membersList(g) : null,
    g.isOwner && h("div", { class: "code-box" },
      h("div", {}, h("div", { class: "label" }, "Invitasjonskode"), h("code", {}, g.inviteCode)),
      h("div", { class: "row" },
        btn("Kopier", () => copyText(g.inviteCode), "secondary small", "copy"),
        btn("Ny kode", async () => {
          if (!confirm(`Lage en ny invitasjonskode for ${g.name}? Den gamle slutter å virke med en gang. Barn som er med, blir værende.`)) return;
          try {
            await api(`/groups/${g.id}/code`, { method: "POST" });
            toast("Ny kode er laget");
            showParent();
          } catch (err) { toast(err.message); }
        }, "ghost small", "refresh"))),
    g.isOwner && reviewSwitch(g),
    h("div", { class: "card-actions" },
      btn("Se innlegg", () => showGroupPosts(g), "", "eye"),
      btn("Inviter foresatte", () => openInvite(g), "secondary", "mail"),
      g.adultUnread !== undefined && h("button", { type: "button", class: "btn secondary", onclick: () => showAdultChat(g) },
        icon("users"), "Voksenkontakt", g.adultUnread ? h("span", { class: "count" }, g.adultUnread) : null),
      g.isOwner && btn("Slett", async () => {
        if (!confirm(`Slette gruppa ${g.name} og alle innleggene i den?`)) return;
        await api(`/groups/${g.id}`, { method: "DELETE" });
        showParent();
      }, "danger", "trash")));
}

// Barn som har bedt om å bli med. Eieren ser hvilken foresatt som spør, og godkjenner eller avslår.
// Eieren ser hvem som er med og kan ta et barn ut. Foresatte får e-post om det.
function membersList(g) {
  return h("details", { class: "members-list" },
    h("summary", {}, `Medlemmer (${g.members.length})`),
    g.members.map((m) => h("div", { class: "list-row" },
      avatar(m.avatar),
      h("div", { class: "grow" }, h("strong", {}, m.displayName)),
      btn("Ta ut", async () => {
        if (!confirm(`Ta ${m.displayName} ut av ${g.name}? ${m.displayName} ser ikke gruppa lenger, og foresatte får e-post om det.`)) return;
        try {
          await api(`/groups/${g.id}/members/${m.id}`, { method: "POST", body: { action: "remove" } });
          toast(`${m.displayName} er tatt ut av ${g.name}`);
          showParent();
        } catch (err) { toast(err.message); }
      }, "ghost small"))));
}

function pendingMembers(g) {
  const answer = (m, action) => async () => {
    try {
      await api(`/groups/${g.id}/members/${m.id}`, { method: "POST", body: { action } });
      toast(action === "approve" ? `${m.displayName} er med i ${g.name}` : "Forespørselen er avslått");
      showParent();
    } catch (err) { toast(err.message); }
  };
  return h("div", { class: "pending-members" },
    h("div", { class: "subhead" }, "Vil bli med"),
    g.pendingMembers.map((m) => h("div", { class: "list-row" },
      avatar(m.avatar),
      h("div", { class: "grow" },
        h("strong", {}, m.displayName),
        h("div", { class: "muted small" }, `Foresatt: ${m.parentName} · ${m.parentEmail}`)),
      h("div", { class: "row-actions" },
        btn("Avslå", answer(m, "reject"), "ghost small"),
        btn("Godta", answer(m, "approve"), "small")))));
}

async function copyText(text, what = "Koden") {
  try {
    await navigator.clipboard.writeText(text);
    toast("Kopiert");
  } catch {
    toast(`${what} er ${text}`);
  }
}

function reviewSwitch(g) {
  const box = h("input", { type: "checkbox", role: "switch", checked: g.mediaReview, "aria-label": "Godkjenn bilder og video" });
  box.addEventListener("change", async () => {
    try {
      await api(`/groups/${g.id}`, { method: "PATCH", body: { mediaReview: box.checked } });
      toast(box.checked ? "Bilder og video må godkjennes" : "Bilder og video vises med en gang");
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message);
    }
  });
  return h("label", { class: "switch-row" },
    h("span", { class: "text" }, "Godkjenn bilder og video", h("small", {}, "Barna ser dem først når du har godkjent")),
    h("span", { class: "switch" }, box, h("i", {})));
}

function openNewGroup() {
  openSheet("Ny gruppe", (close) => {
    const warning = warningBox();
    const form = h("form", {},
      field("Navn på gruppa", h("input", { name: "name", placeholder: "F.eks. 6B", required: true, maxlength: 40 })),
      h("button", { class: "btn block" }, "Lag gruppe"),
      warning);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/groups", { method: "POST", body: formData(form) });
        close();
        toast("Gruppa er laget");
        parentTab = "grupper";
        showParent();
      } catch (err) { showWarning(warning, err.message); }
    });
    return form;
  });
}

// Felt der hver e-postadresse blir en tagg når man trykker mellomrom, komma eller Enter (eller limer inn flere).
// Gyldige adresser ligger i el.values. En ugyldig adresse blir stående som tekst, så den kan rettes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function emailTags(id) {
  const input = h("input", { id, type: "email", inputmode: "email", autocomplete: "off", autocapitalize: "none", spellcheck: "false", placeholder: "navn@eksempel.no" });
  const list = h("span", { class: "tags" });
  const el = h("div", { class: "tag-input", onclick: (e) => e.target === el && input.focus() }, list, input);
  el.values = [];
  const draw = () => list.replaceChildren(...el.values.map((email) => h("span", { class: "tag" }, email,
    h("button", { type: "button", "aria-label": `Fjern ${email}`, onclick: () => { el.values = el.values.filter((v) => v !== email); draw(); input.focus(); } }, icon("x")))));
  // Gjør teksten i feltet om til tagger. Returnerer det som ikke var gyldige adresser.
  el.commit = () => {
    const rest = [];
    for (const part of input.value.split(/[\s,;]+/).filter(Boolean)) {
      const email = part.toLowerCase();
      if (!EMAIL_RE.test(email)) rest.push(part);
      else if (!el.values.includes(email)) el.values.push(email);
    }
    input.value = rest.join(" ");
    el.classList.toggle("invalid", rest.length > 0);
    draw();
    return rest;
  };
  input.addEventListener("keydown", (e) => {
    if ([" ", ",", ";", "Enter"].includes(e.key)) {
      if (e.key === "Enter" && !input.value.trim()) return; // tomt felt: Enter sender skjemaet
      e.preventDefault();
      el.commit();
    } else if (e.key === "Backspace" && !input.value && el.values.length) {
      input.value = el.values.pop();
      draw();
      e.preventDefault();
    }
  });
  input.addEventListener("paste", () => setTimeout(el.commit));
  input.addEventListener("blur", () => el.commit());
  input.addEventListener("input", () => el.classList.remove("invalid"));
  return el;
}

const INVITE_RESULT = {
  sent: "Invitasjon sendt",
  not_sent: "E-posten ble ikke sendt",
  invited: "Har konto, fikk beskjed om gruppa",
  invited_not_sent: "Har konto og er invitert, men e-posten ble ikke sendt",
  exists: "Har allerede konto",
  blocked: "Kan ikke inviteres",
};

// En foresatt inviterer andre foresatte, til quipu eller til en bestemt gruppe.
// Med e-postadresser får hver sin invitasjon. Uten adresser lages en lenke man deler selv.
function openInvite(group) {
  openSheet(group ? `Inviter til ${group.name}` : "Inviter foresatt", (close) => {
    const warning = warningBox();
    const tags = emailTags("invite-emails");
    const submit = h("button", { class: "btn block" }, icon("mail"), "Lag lenke");
    const label = () => { submit.lastChild.textContent = tags.values.length || tags.querySelector("input").value.trim() ? "Send invitasjoner" : "Lag lenke"; };
    tags.addEventListener("keyup", label);
    tags.addEventListener("click", label);
    const box = h("div", {});
    const form = h("form", { novalidate: true },
      h("p", { class: "muted small" }, group
        ? `Invitasjonen gjelder ${group.name}. Nye foresatte lager konto uten registreringskode, og de som allerede har konto, får beskjed. Barna meldes inn uten invitasjonskode${group.isOwner ? " og slipper rett inn, siden du eier gruppa" : ", og den som eier gruppa, godkjenner dem som vanlig"}.`
        : `Den du inviterer, kan lage en foresatt-konto i ${APP_NAME} uten registreringskode. Inviter bare noen du kjenner.`),
      field("E-postadresser (valgfritt)", tags),
      h("p", { class: "muted small" }, "Trykk mellomrom etter hver adresse. Uten adresser får du en lenke du kan sende selv, for eksempel på SMS. Invitasjonene virker i 14 dager og kan brukes én gang."),
      submit,
      warning);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rest = tags.commit();
      label();
      if (rest.length) return showWarning(warning, `Sjekk ${rest.length === 1 ? "adressen" : "adressene"}: ${rest.join(", ")}`);
      try {
        const { url, results } = await api("/invites", { method: "POST", body: { emails: tags.values, groupId: group?.id } });
        const share = url && navigator.share && btn("Del", () => navigator.share({ title: `Invitasjon til ${APP_NAME}`, text: group ? `Bli med i ${group.name} i ${APP_NAME}:` : `Bli med i ${APP_NAME}, appen for klassen:`, url }).catch(() => {}), "secondary small", "share");
        box.replaceChildren(...[
          results.length && h("ul", { class: "invite-results" }, results.map((r) => h("li", { class: r.status === "sent" || r.status === "invited" ? "ok" : "warn" },
            icon(r.status === "sent" || r.status === "invited" ? "check" : "alert"), h("span", {}, h("strong", {}, r.email), h("small", {}, INVITE_RESULT[r.status] || r.status)),
            r.url && btn("Kopier lenke", () => copyText(r.url, "Lenken"), "secondary small", "copy")))),
          results.some((r) => r.url) && h("p", { class: "muted small" }, "E-posten kom ikke fram. Kopier lenken og send den selv, for eksempel på SMS. Hver lenke virker bare for den ene personen."),
          url && h("div", { class: "code-box invite-link" },
            h("div", {}, h("div", { class: "label" }, "Invitasjonslenke"), h("code", {}, url)),
            h("div", { class: "row" }, btn("Kopier", () => copyText(url, "Lenken"), "secondary small", "copy"), share)),
          btn("Inviter flere", () => { close(); setTimeout(() => openInvite(group), 260); }, "ghost small"),
        ].filter(Boolean));
        form.replaceWith(box);
      } catch (err) { showWarning(warning, err.message); }
    });
    return form;
  });
}

function accountTab() {
  return [
    h("div", { class: "section-title" }, h("h2", {}, "Konto")),
    h("section", { class: "card" },
      h("div", { class: "entity-head" }, avatar(config.me.avatar, "lg"),
        h("div", { class: "who" }, h("h3", {}, config.me.displayName), h("div", { class: "sub" }, config.me.email || `@${config.me.username}`))),
      h("div", { class: "card-actions" }, btn("Inviter foresatt", () => openInvite(), "", "mail"), btn("Logg ut", logout, "secondary", "logout"))),
    h("a", { class: "card notice info-link", href: "/om" }, icon("shield"),
      h("div", {}, h("strong", {}, `Slik gjør vi ${APP_NAME} trygt`),
        h("p", { class: "muted small" }, "Valgene vi har tatt, og historien bak navnet. Fin å dele med andre foresatte."))),
    installGuide(),
    notifyCard(),
    emailCard(),
    passwordCard(),
    sessionsCard(),
    linksCard(),
    exportCard(),
    h("section", { class: "card" },
      h("h3", {}, "Slett konto"),
      h("p", { class: "muted small" }, "Sletter kontoen din, barnekontoene og alt de har delt. Dette kan ikke angres."),
      btn("Slett kontoen min", async () => {
        if (!confirm("Slette kontoen din? Barnekontoene og alle innleggene deres slettes også. Dette kan ikke angres.")) return;
        await api("/me", { method: "DELETE" });
        start();
      }, "danger", "trash")),
  ];
}

// ---------- Administrasjon (bare for den som drifter quipu) ----------
// Statistikk som tall, meldte innlegg fra alle grupper, og utestenging. Alt som gjøres, logges på serveren.
function adminTab() {
  // Først sjekkes to-trinns innloggingen. Serveren sier fra om den mangler eller koden må skrives inn.
  const body = h("div", {}, h("p", { class: "muted" }, "Henter …"));
  api("/admin/stats").then((data) => body.replaceChildren(...adminSections(data)), (err) => {
    if (err.code === "MFA_SETUP") body.replaceChildren(mfaSetupCard());
    else if (err.code === "MFA_REQUIRED") body.replaceChildren(mfaCodeCard());
    else body.replaceChildren(h("p", { class: "warning" }, icon("alert"), h("span", {}, err.message)));
  });
  return [
    h("div", { class: "section-title" }, h("h2", {}, "Admin")),
    h("p", { class: "muted small admin-note" }, `Bare for drift av ${APP_NAME}. Statistikken er tall uten navn. Du ser bare innlegg som noen har meldt, og det barn sender med «Si fra om noe annet». Alt du gjør her, logges.`),
    body,
  ];
}

function adminSections(statsData) {
  const stats = h("div", {});
  const safety = h("div", {});
  const reports = h("div", {});
  const users = h("div", {});
  const log = h("div", {});
  loadAdminStats(stats, statsData);
  loadAdminSafety(safety);
  loadAdminReports(reports);
  loadAdminLog(log);
  const search = h("input", { id: "admin-search", type: "search", placeholder: "Navn, brukernavn eller e-post", autocomplete: "off", autocapitalize: "none" });
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => loadAdminUsers(users, search.value), 300); });
  const incidents = h("div", {});
  loadIncidents(incidents);
  return [
    incidents,
    h("section", { class: "card" }, h("h3", {}, "Bruk"), stats),
    h("section", { class: "card" }, h("h3", {}, "Meldinger fra barn"), safety),
    h("section", { class: "card" }, h("h3", {}, "Meldte innlegg"), reports),
    h("section", { class: "card" }, h("h3", {}, "Kontoer"), field("Søk etter en konto", search), users),
    h("section", { class: "card" }, h("h3", {}, "Logg"), log),
  ];
}

const codeInput = () => h("input", { name: "code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9 ]{6,7}", maxlength: 7, required: true, placeholder: "123456" });

// Første gang: koble en autentiseringsapp til kontoen.
function mfaSetupCard() {
  let start;
  const box = h("section", { class: "card" }, h("h3", {}, "Slå på to-trinns innlogging"),
    h("p", { class: "muted small" }, "Administrasjonen viser meldte innlegg og kan stenge kontoer. Derfor kreves en engangskode fra en app i tillegg til passordet. Bruk for eksempel Google Authenticator, Microsoft Authenticator, 1Password eller Passord-appen på iPhone."),
    start = btn("Lag nøkkel", async () => {
      try {
        const { secret, uri } = await api("/admin/mfa/setup", { method: "POST" });
        const warning = warningBox();
        const code = codeInput();
        const form = h("form", {},
          h("ol", { class: "steps" },
            h("li", {}, "Åpne autentiseringsappen og legg til en ny konto. På telefonen kan du trykke ", h("a", { class: "link", href: uri }, "Åpne i appen"), "."),
            h("li", {}, "Eller skriv inn nøkkelen for hånd:", h("div", { class: "code-box" }, h("code", {}, secret.match(/.{1,4}/g).join(" ")), btn("Kopier", () => copyText(secret, "Nøkkelen"), "secondary small", "copy"))),
            h("li", {}, "Skriv inn koden appen viser nå.")),
          field("Kode fra appen", code),
          h("button", { class: "btn block" }, icon("lock"), "Slå på"),
          warning);
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            await api("/admin/mfa/confirm", { method: "POST", body: { code: code.value } });
            toast("To-trinns innlogging er slått på");
            showParent();
          } catch (err) { showWarning(warning, err.message); }
        });
        start.replaceWith(form);
      } catch (err) { toast(err.message); }
    }, "", "lock"),
    h("p", { class: "muted small" }, "Mister du telefonen, slår du det av på serveren med «npm run admin -- <e-post> nullstill»."));
  return box;
}

// Hver enhet må skrive inn en kode, og på nytt etter 12 timer.
function mfaCodeCard() {
  const warning = warningBox();
  const code = codeInput();
  const form = h("form", { class: "card" }, h("h3", {}, "Skriv inn koden"),
    h("p", { class: "muted small" }, "Koden fra autentiseringsappen trengs på hver enhet, og igjen etter 12 timer."),
    field("Kode fra appen", code),
    h("button", { class: "btn block" }, icon("lock"), "Fortsett"),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/admin/mfa", { method: "POST", body: { code: code.value } });
      showParent();
    } catch (err) { showWarning(warning, err.message); }
  });
  return form;
}

// Alvorlige saker øverst: de som ingen har tatt ansvar for ennå, med knappen for å kvittere,
// og varslene som er sendt (sendt er ikke det samme som lest). Under: vaktlisten.
async function loadIncidents(box) {
  try {
    const data = await api("/admin/incidents");
    const open = data.incidents.filter((i) => !i.ackedAt);
    const recent = data.incidents.filter((i) => i.ackedAt).slice(0, 5);
    const alertLine = (i) => {
      const names = [...new Set(i.alerts.filter((a) => a.ok).map((a) => a.name || a.recipient))];
      const failed = i.alerts.filter((a) => !a.ok);
      return h("p", { class: "muted small" }, names.length ? `Varslet: ${names.join(", ")}.` : "Ingen varsler kom fram.",
        failed.length ? ` ${failed.length} varsel feilet (${failed.at(-1).error}).` : "",
        ` Neste varsel ${fmtTime(i.nextAt)} hvis ingen tar ansvar.`);
    };
    const openCard = open.length && h("section", { class: "card incident-alarm" },
      h("h3", {}, icon("alert"), `${open.length} alvorlig${open.length === 1 ? " sak venter" : "e saker venter"} på at noen tar ansvar`),
      open.map((i) => h("div", { class: "incident" },
        h("div", { class: "meta" }, h("strong", {}, i.label), ` · ${i.kind === "safety" ? "Si fra om noe annet" : "meldt innlegg"} · kom inn ${fmtTime(i.createdAt)}`),
        alertLine(i),
        btn("Jeg tar ansvar", async () => {
          try {
            await api(`/admin/incidents/${i.id}/ack`, { method: "POST" });
            toast("Du har tatt ansvar for saken. Varslingen er stoppet.");
            loadIncidents(box);
            loadAdminLog(document.querySelector(".admin-log-box") || h("div"));
          } catch (err) { toast(err.message); }
        }, "danger", "check"))),
      h("p", { class: "muted small" }, "Saken står under «Meldinger fra barn» eller «Meldte innlegg». Er et barn i fare nå, ring 112 først."));

    // Vaktlisten: rekkefølgen administratorene varsles i.
    let order = data.oncall.map((o) => o.id);
    const list = h("ol", { class: "oncall" });
    const draw = () => {
      list.replaceChildren(...order.map((id, idx) => {
        const a = data.admins.find((x) => x.id === id);
        return h("li", {}, h("span", { class: "grow" }, h("strong", {}, a.displayName), " ", h("span", { class: "muted small" }, idx === 0 ? "vakthavende" : idx === 1 ? "reserve" : `nr. ${idx + 1}`)),
          idx > 0 && iconBtn("back", `Flytt ${a.displayName} opp`, () => { order.splice(idx - 1, 0, order.splice(idx, 1)[0]); draw(); }),
          iconBtn("x", `Ta ${a.displayName} av vaktlisten`, () => { order = order.filter((x) => x !== id); draw(); }));
      }));
      add.replaceChildren(...data.admins.filter((a) => !order.includes(a.id)).map((a) => btn(`+ ${a.displayName}`, () => { order.push(a.id); draw(); }, "ghost small")));
    };
    const add = h("div", { class: "row" });
    draw();
    const rota = h("section", { class: "card" }, h("h3", {}, "Vaktliste"),
      h("p", { class: "muted small" }, `Alvorlige meldinger varsler vakthavende med en gang, på e-post og push. Har ingen trykket «Jeg tar ansvar» innen ${data.ackMinutes} minutter, varsles reserven, så resten av lista, og til slutt alle administratorer og beredskapsadressen, på nytt hvert ${data.ackMinutes}. minutt til noen tar ansvar.`),
      !data.alarmEmails && h("p", { class: "warning" }, icon("alert"), h("span", {}, "Ingen beredskapsadresse er satt. Sett BEREDSKAP_EPOST hos Render, så går varselet også utenom administratorene.")),
      list, add,
      h("div", { class: "card-actions" }, btn("Lagre vaktlisten", async () => {
        try {
          await api("/admin/oncall", { method: "PUT", body: { order } });
          toast("Vaktlisten er lagret");
        } catch (err) { toast(err.message); }
      }, "secondary", "check")),
      recent.length ? h("div", {}, h("div", { class: "subhead" }, "Siste kvitterte saker"),
        recent.map((i) => h("p", { class: "muted small" }, `${i.label}: kom inn ${fmtTime(i.createdAt)}, ${i.ackedBy} tok ansvar etter ${Math.max(1, Math.round((i.ackedAt - i.createdAt) / 60e3))} min.`))) : null);
    box.replaceChildren(...[openCard, rota].filter(Boolean));
  } catch (err) { box.replaceChildren(h("p", { class: "warning" }, icon("alert"), h("span", {}, err.message))); }
}

async function loadAdminSafety(box) {
  try {
    const { reports, categories } = await api("/admin/safety");
    if (!reports.length) return box.replaceChildren(h("p", { class: "muted small" }, "Ingen meldinger."));
    box.replaceChildren(...reports.map((r) => {
      const note = h("input", { placeholder: "Hva ble gjort (lagres i loggen)", maxlength: 500, "aria-label": "Notat" });
      return h("div", { class: `admin-report${r.resolved ? " done" : ""}` },
        h("div", { class: "meta" }, h("strong", {}, r.child.displayName), ` @${r.child.username} · foresatte: ${r.child.guardians.join(", ") || "ingen"} · ${fmtTime(r.createdAt)}`,
          h("span", { class: `badge${r.serious ? "" : " warn"}` }, categories[r.category]?.label || r.category),
          r.resolved && h("span", { class: "badge done" }, `behandlet${r.resolvedBy ? ` av ${r.resolvedBy}` : ""}`)),
        h("p", { class: "text" }, r.text),
        r.resolved
          ? r.note && h("p", { class: "muted small" }, `Notat: ${r.note}`)
          : h("div", { class: "row" }, note, btn("Ferdig", async () => {
            try {
              await api(`/admin/safety/${r.id}`, { method: "POST", body: { note: note.value } });
              loadAdminSafety(box);
              loadAdminLog(document.querySelector(".admin-log-box") || h("div"));
            } catch (err) { toast(err.message); }
          }, "secondary small", "check")));
    }));
  } catch (err) { box.replaceChildren(h("p", { class: "warning" }, icon("alert"), h("span", {}, err.message))); }
}

const fmtDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (t) => new Date(t).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function loadAdminStats(box, preloaded) {
  try {
    const { totals: t, today, days } = preloaded || await api("/admin/stats");
    const tile = (label, value, sub) => h("div", { class: "stat" }, h("div", { class: "value" }, String(value)), h("div", { class: "label" }, label), sub && h("div", { class: "sub" }, sub));
    const avg = (d) => (d.activeChildren ? Math.round(d.minutes / d.activeChildren) : 0);
    box.replaceChildren(
      h("div", { class: "stats" },
        tile("Foresatte", t.parents, `${t.parentsVerified} bekreftet · ${t.invitedParents} invitert`),
        tile("Barn", t.children, `${t.sharedChildren} med flere foresatte`),
        tile("Grupper", t.groups),
        tile("Aktive barn i dag", today.activeChildren, `${today.minutes} min · ${today.posts} innlegg`),
        tile("Åpne meldinger", t.openReports + (t.openSafety || 0), `${t.openReports} innlegg · ${t.openSafety || 0} fra barn`),
        tile("Stengte kontoer", t.suspended),
        tile("Enheter med push", t.pushDevices)),
      days.length
        ? h("div", { class: "info-table-wrap" }, h("table", { class: "info-table admin-days" },
          h("thead", {}, h("tr", {}, ["Dag", "Aktive barn", "Min. per barn", "Innlegg", "Med bilde", "Meldt", "Nye foresatte", "Nye barn"].map((x) => h("th", { scope: "col" }, x)))),
          h("tbody", {}, days.map((d) => h("tr", {},
            h("th", { scope: "row" }, fmtDay(d.day)),
            ...[["Aktive barn", d.activeChildren], ["Min. per barn", avg(d)], ["Innlegg", d.posts], ["Med bilde", d.postsMedia], ["Meldt", d.reports], ["Nye foresatte", d.newParents], ["Nye barn", d.newChildren]]
              .map(([label, v]) => h("td", { "data-label": label }, String(v))))))))
        : h("p", { class: "muted small" }, "Dagssummene kommer når den første dagen er over."));
  } catch (err) { box.replaceChildren(h("p", { class: "warning" }, icon("alert"), h("span", {}, err.message))); }
}

async function loadAdminReports(box) {
  try {
    const { posts, categories } = await api("/admin/reports");
    if (!posts.length) return box.replaceChildren(h("p", { class: "muted small" }, "Ingen meldte innlegg akkurat nå."));
    const act = (p, action) => async () => {
      try {
        await api(`/admin/posts/${p.id}`, { method: "POST", body: { action } });
        toast({ remove: "Innlegget er fjernet", restore: "Innlegget vises igjen", hold: "Innlegget er bevart og skjult", release: "Innlegget bevares ikke lenger" }[action]);
        loadAdminReports(box);
        loadAdminLog(document.querySelector(".admin-log-box") || h("div"));
      } catch (err) { toast(err.message); }
    };
    box.replaceChildren(...posts.map((p) => h("div", { class: "admin-report" },
      h("div", { class: "meta" }, h("strong", {}, p.author), ` @${p.username} · ${p.groupName} · ${timeAgo(p.createdAt)}`,
        ...p.categories.map((c) => h("span", { class: `badge${categories[c]?.serious ? "" : " warn"}` }, categories[c]?.label || c)),
        p.reports > 1 && h("span", { class: "badge warn" }, `${p.reports} meldinger`),
        p.hold && h("span", { class: "badge done" }, "bevart"),
        p.authorSuspended && h("span", { class: "badge warn" }, "stengt")),
      h("p", { class: "text" }, p.text),
      p.media && mediaView(p),
      h("div", { class: "row" },
        btn("Fjern innlegget", act(p, "remove"), "danger small", "trash"),
        !p.hold && btn("Vis igjen", act(p, "restore"), "secondary small", "eye"),
        // Bevar som dokumentasjon i alvorlige saker: skjult for barna, men slettes ikke av oppryddingen.
        btn(p.hold ? "Slutt å bevare" : "Bevar som dokumentasjon", act(p, p.hold ? "release" : "hold"), "ghost small", "lock"),
        !p.authorSuspended && btn(`Steng @${p.username}`, () => suspendForm(box, { id: p.authorId, displayName: p.author, role: "child" }, () => loadAdminReports(box)), "ghost small", "lock")))));
  } catch (err) { box.replaceChildren(h("p", { class: "warning" }, icon("alert"), h("span", {}, err.message))); }
}

// Liten form for å stenge en konto. Grunnen lagres og vises i loggen.
function suspendForm(anchor, u, done) {
  openSheet(`Steng ${u.displayName}`, (close) => {
    const warning = warningBox();
    const reason = h("input", { name: "reason", required: true, minlength: 3, maxlength: 300, placeholder: "F.eks. truende meldinger" });
    const form = h("form", {},
      h("p", { class: "muted small" }, u.role === "child"
        ? "Barnet logges ut og kommer ikke inn igjen før du åpner kontoen. Foresatte kan fortsatt se barnet."
        : "Den foresatte logges ut, kommer ikke inn igjen og kan ikke registrere seg på nytt med samme e-post. Barn som ikke har en annen foresatt, stenges også."),
      field("Grunn (lagres i loggen)", reason),
      h("button", { class: "btn block danger" }, icon("lock"), "Steng kontoen"),
      warning);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const { alsoSuspended } = await api(`/admin/users/${u.id}/suspend`, { method: "POST", body: { reason: reason.value } });
        close();
        toast(alsoSuspended.length ? `Stengt. Også stengt: ${alsoSuspended.join(", ")}` : "Kontoen er stengt");
        done();
        loadAdminLog(document.querySelector(".admin-log-box") || h("div"));
      } catch (err) { showWarning(warning, err.message); }
    });
    return form;
  });
}

async function loadAdminUsers(box, term) {
  if (term.trim().length < 2) return box.replaceChildren();
  try {
    const { users } = await api(`/admin/users?q=${encodeURIComponent(term.trim())}`);
    if (!users.length) return box.replaceChildren(h("p", { class: "muted small" }, "Fant ingen."));
    const reload = () => loadAdminUsers(box, term);
    box.replaceChildren(h("ul", { class: "admin-users" }, users.map((u) => h("li", {},
      h("div", { class: "who" },
        h("strong", {}, u.displayName), " ", h("span", { class: "muted small" }, u.role === "child" ? `barn · @${u.username}` : `foresatt · ${u.email}`),
        u.suspended && h("span", { class: "badge" }, "stengt"),
        h("div", { class: "muted small" }, u.role === "child" ? `Foresatte: ${u.related.join(", ") || "ingen"}` : `Barn: ${u.related.join(", ") || "ingen"}`,
          ` · laget ${fmtTime(u.createdAt)}`),
        u.suspended && h("div", { class: "muted small" }, `Grunn: ${u.suspendedReason}${u.suspendedCause === "parent" ? " (foresatt stengt)" : ""}`)),
      u.id === config.me.id ? h("span", { class: "muted small" }, "deg")
        : u.suspended
          ? btn("Åpne", async () => {
            try {
              const { alsoOpened } = await api(`/admin/users/${u.id}/unsuspend`, { method: "POST" });
              toast(alsoOpened.length ? `Åpnet. Også åpnet: ${alsoOpened.join(", ")}` : "Kontoen er åpnet");
              reload();
              loadAdminLog(document.querySelector(".admin-log-box") || h("div"));
            } catch (err) { toast(err.message); }
          }, "secondary small", "check")
          : btn("Steng", () => suspendForm(box, u, reload), "danger small", "lock")))));
  } catch (err) { box.replaceChildren(h("p", { class: "warning" }, icon("alert"), h("span", {}, err.message))); }
}

async function loadAdminLog(box) {
  box.classList.add("admin-log-box");
  try {
    const { log } = await api("/admin/log");
    box.replaceChildren(log.length
      ? h("ul", { class: "admin-log" }, log.map((l) => h("li", {},
        h("span", { class: "muted small" }, fmtTime(l.createdAt)), " ", h("strong", {}, l.action), ` ${l.target}`, l.detail && h("span", { class: "muted" }, ` · ${l.detail}`))))
      : h("p", { class: "muted small" }, "Ingenting ennå."));
  } catch (err) { box.replaceChildren(h("p", { class: "warning" }, icon("alert"), h("span", {}, err.message))); }
}

// Invitasjoner og delingslenker man har sendt som ikke er brukt. Kan trekkes tilbake.
function linksCard() {
  const list = h("ul", { class: "sessions" });
  const card = h("section", { class: "card hidden" }, h("h3", {}, "Lenker du har sendt"),
    h("p", { class: "muted small" }, "Invitasjoner og delingslenker som ikke er brukt ennå. Trekker du en tilbake, slutter den å virke med en gang."), list);
  const load = async () => {
    try {
      const { links } = await api("/invites");
      card.classList.toggle("hidden", !links.length);
      list.replaceChildren(...links.map((l) => h("li", {}, icon(l.kind === "share" ? "users" : "mail"),
        h("div", { class: "who" },
          h("strong", {}, l.kind === "share" ? `Dele ${l.child}` : l.group ? `Invitasjon til ${l.group}` : "Invitasjon"),
          h("div", { class: "muted small" }, `${l.email || "Lenke uten e-post"} · virker til ${fmtTime(l.expiresAt)}`)),
        btn("Trekk tilbake", async () => {
          await api(`/invites/${l.id}`, { method: "DELETE" }).catch((err) => toast(err.message));
          toast("Lenken virker ikke lenger");
          load();
        }, "secondary small"))));
    } catch { card.classList.add("hidden"); }
  };
  load();
  return card;
}

// Innsyn: alt quipu har om deg og barna, som en fil.
function exportCard() {
  return h("section", { class: "card" }, h("h3", {}, "Dataene dine"),
    h("p", { class: "muted small" }, `Last ned alt ${APP_NAME} har om deg og barna dine: kontoene, grensene, gruppene, innleggene og beskjedene dine i voksenkontakten. Fila er i JSON-format, som kan åpnes i de fleste programmer.`),
    h("div", { class: "card-actions" }, btn("Last ned dataene mine", async () => {
      try {
        const res = await fetch("/api/me/export");
        if (!res.ok) throw new Error("Klarte ikke å lage fila. Prøv igjen.");
        const url = URL.createObjectURL(await res.blob());
        const a = h("a", { href: url, download: `quipu-data-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) { toast(err.message); }
    }, "secondary", "share")));
}

// Hvor man er logget inn. Kjenner man ikke igjen en enhet, logger man den ut og bytter passord.
function sessionsCard() {
  const list = h("ul", { class: "sessions" });
  const card = h("section", { class: "card" }, h("h3", {}, "Innlogginger"),
    h("p", { class: "muted small" }, "Her er du logget inn nå. Du får e-post når noen logger inn fra en ny type enhet. Kjenner du ikke igjen en innlogging, logg den ut og bytt passord."),
    list);
  const load = async () => {
    try {
      const { sessions } = await api("/sessions");
      const others = sessions.filter((x) => !x.current).length;
      list.replaceChildren(...sessions.map((x) => h("li", {},
        icon(/iPhone|Android/.test(x.device) ? "phone" : "user"),
        h("div", { class: "who" }, h("strong", {}, x.device), x.current && h("span", { class: "badge done" }, "denne enheten"),
          h("div", { class: "muted small" }, `Sist brukt ${fmtTime(x.lastSeen || x.createdAt)} · logget inn ${fmtTime(x.createdAt)}`)),
        !x.current && btn("Logg ut", async () => {
          await api(`/sessions/${x.id}`, { method: "DELETE" }).catch((err) => toast(err.message));
          load();
        }, "secondary small"))));
      card.querySelector(".others")?.remove();
      if (others) {
        card.append(h("div", { class: "card-actions others" }, btn("Logg ut alle andre enheter", async () => {
          const { loggedOut } = await api("/sessions/others", { method: "POST" });
          toast(`${loggedOut} ${loggedOut === 1 ? "enhet" : "enheter"} er logget ut`);
          load();
        }, "secondary", "logout")));
      }
    } catch (err) { list.replaceChildren(h("li", { class: "warning" }, err.message)); }
  };
  load();
  return card;
}

// ---------- Varsler fra voksenkontakten ----------
// E-post (av, kort tid etter nye beskjeder, eller én gang om dagen) og push-varsel på denne enheten.
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let pushKey = null;

async function currentPush() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function setPush(on) {
  if (!on) {
    const sub = await currentPush();
    if (sub) {
      await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    return;
  }
  if (await Notification.requestPermission() !== "granted") {
    throw new Error("Varsler er blokkert. Slå dem på for quipu i innstillingene på telefonen.");
  }
  let sub;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(pushKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (err) {
    console.warn("Push:", err);
    throw new Error("Klarte ikke å slå på push-varsler på denne enheten. Prøv igjen, eller velg e-post.");
  }
  await api("/push/subscribe", { method: "POST", body: sub.toJSON() });
}

function notifyCard() {
  const card = h("section", { class: "card" },
    h("h3", {}, "Varsler fra voksenkontakten"),
    h("p", { class: "muted small" }, "Få beskjed når andre foresatte skriver i voksenkontakten. Barna får aldri varsler."));
  (async () => {
    const settings = await api("/notify");
    pushKey = settings.pushKey;
    const email = h("select", { "aria-label": "E-post" },
      [["off", "Av"], ["soon", "Kort tid etter nye beskjeder"], ["daily", "Én gang om dagen (kl. 18)"]]
        .map(([v, label]) => h("option", { value: v, selected: settings.email === v }, label)));
    email.addEventListener("change", async () => {
      try {
        await api("/notify", { method: "PATCH", body: { email: email.value } });
        toast(email.value === "off" ? "E-post om beskjeder er slått av" : "Lagret");
      } catch (err) { toast(err.message); }
    });

    let pushRow;
    if (pushSupported()) {
      const box = h("input", { type: "checkbox", role: "switch", checked: !!(await currentPush()) && Notification.permission === "granted", "aria-label": "Push-varsel på denne enheten" });
      box.addEventListener("change", async () => {
        box.disabled = true;
        try {
          await setPush(box.checked);
          toast(box.checked ? "Push-varsler er slått på for denne enheten" : "Push-varsler er slått av for denne enheten");
        } catch (err) {
          box.checked = !box.checked;
          toast(err.message);
        } finally { box.disabled = false; }
      });
      pushRow = h("label", { class: "switch-row" },
        h("span", { class: "text" }, "Push-varsel på denne enheten", h("small", {}, "Et varsel på låseskjermen når det kommer en ny beskjed")),
        h("span", { class: "switch" }, box, h("i", {})));
    } else {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      pushRow = h("p", { class: "status-note" }, icon("phone"), ios
        ? "På iPhone og iPad må quipu ligge på hjemskjermen for å få push-varsler. Se «Legg quipu på hjemskjermen» over, og åpne quipu derfra."
        : "Denne nettleseren støtter ikke push-varsler. Du kan få e-post i stedet.");
    }
    card.append(field("E-post", email), pushRow);
  })().catch((err) => card.append(h("p", { class: "muted small" }, err.message)));
  return card;
}

function emailCard() {
  const warning = warningBox();
  const form = h("form", { class: "card" },
    h("h3", {}, "E-post"),
    h("p", { class: "muted small" }, config.me.email
      ? "Du logger inn med denne, og får lenke hit hvis du glemmer passordet."
      : "Legg inn e-post, så kan du få en lenke hvis du glemmer passordet."),
    config.me.pendingEmail && h("p", { class: "status-note" }, icon("mail"),
      `Venter på bekreftelse: ${config.me.pendingEmail}. Åpne lenken vi sendte dit.`),
    field("E-postadresse", h("input", { name: "email", type: "email", value: config.me.email, autocomplete: "email", autocapitalize: "none", inputmode: "email", required: true })),
    h("button", { class: "btn secondary" }, "Lagre e-post"),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { pendingEmail } = await api("/me", { method: "PATCH", body: formData(form) });
      warning.classList.add("hidden");
      if (pendingEmail) {
        config.me.pendingEmail = pendingEmail;
        toast("Vi har sendt en lenke til den nye adressen");
        showParent();
      } else toast("E-post lagret");
    } catch (err) { showWarning(warning, err.message); }
  });
  return form;
}

function passwordCard() {
  const warning = warningBox();
  const form = h("form", { class: "card" },
    h("h3", {}, "Bytt passord"),
    h("p", { class: "muted small" }, "Du blir logget ut på andre enheter."),
    field("Nåværende passord", passwordInput({ name: "current", autocomplete: "current-password", required: true })),
    field("Nytt passord (minst 8 tegn)", passwordInput({ name: "password", autocomplete: "new-password", required: true, minlength: 8 })),
    h("button", { class: "btn secondary" }, "Bytt passord"),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/me/password", { method: "POST", body: formData(form) });
      form.reset();
      warning.classList.add("hidden");
      toast("Passordet er byttet");
    } catch (err) { showWarning(warning, err.message); }
  });
  return form;
}

async function showGroupPosts(g) {
  const { posts, isOwner } = await api(`/groups/${g.id}/posts`);
  const moderate = (p, action) => api(`/posts/${p.id}/moderate`, { method: "POST", body: { action } })
    .then(() => showGroupPosts(g), (err) => toast(err.message));

  const actions = (p) => [
    isOwner && p.media?.pending && p.status === "visible" && btn("Godkjenn", () => moderate(p, "approve"), "small", "shield"),
    isOwner && p.status === "hidden" && btn("Vis igjen", () => moderate(p, "restore"), "small", "eye"),
    isOwner && btn("Fjern", () => confirm("Fjerne innlegget?") && moderate(p, "remove"), "ghost", "trash"),
    !isOwner && p.byMyChild && btn("Slett", () => confirm("Slette innlegget?") &&
      api(`/posts/${p.id}`, { method: "DELETE" }).then(() => showGroupPosts(g)), "ghost", "trash"),
  ];

  const note = (p) => p.status === "hidden"
    ? h("p", { class: "status-note danger" }, icon("flag"), `Rapportert ${p.reports} ${p.reports === 1 ? "gang" : "ganger"} – skjult for barna`)
    : p.media?.pending ? h("p", { class: "status-note" }, icon("clock"), "Venter på godkjenning – bare forfatteren ser det") : null;

  watchNewPosts(Math.max(0, ...posts.map((p) => p.id)), `/groups/${g.id}/posts/new`, () => showGroupPosts(g));
  render(
    newPostsBar,
    h("div", { class: "back-head" }, iconBtn("back", "Tilbake", showParent), h("h2", {}, g.name)),
    posts.length ? null : h("div", { class: "card empty" },
      h("div", { class: "end-icon" }, icon("sparkles")), h("p", {}, "Ingen innlegg ennå.")),
    ...posts.map((p) => {
      const card = postCard(p, { actions });
      const n = note(p);
      if (n) card.querySelector(".actions").before(n);
      return card;
    }),
    h("p", { class: "muted small center" }, "Innlegg, bilder og videoer slettes av seg selv etter 60 dager."));
}

// ---------- Voksenkontakt ----------
// Beskjeder og diskusjon mellom foresatte i gruppa. Barna ser det aldri. Samme oppsett som feeden:
// skrivefelt øverst, nyeste først, og en knapp når det kommer nye meldinger.
async function showAdultChat(g) {
  const { messages, group } = await api(`/groups/${g.id}/adult`);
  g = { ...g, name: group.name };
  watchNewPosts(Math.max(0, ...messages.map((m) => m.id)), `/groups/${g.id}/adult/new`, () => showAdultChat(g), ["ny melding", "nye meldinger"]);

  const text = h("textarea", { maxlength: 1000, rows: 3, placeholder: "Skriv en beskjed til de andre foresatte …", "aria-label": "Melding" });
  const warning = warningBox();
  const send = h("button", { class: "btn", type: "button" }, "Send");

  // Bilde: tegnes på nytt på telefonen (fjerner GPS o.l.) og lastes opp før beskjeden sendes.
  let image = null;
  let uploading = false;
  const preview = h("div", { class: "preview hidden" });
  const fileInput = h("input", { type: "file", accept: "image/*", class: "visually-hidden", id: "adultFile" });
  const attachBtn = h("label", { class: "icon-btn", for: "adultFile", "aria-label": "Legg ved bilde", title: "Legg ved bilde" }, icon("image"));
  const clearImage = () => { image = null; preview.replaceChildren(); preview.classList.add("hidden"); fileInput.value = ""; };
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    warning.classList.add("hidden");
    let blob;
    try { blob = await prepareImage(file); } catch (err) { clearImage(); return showWarning(warning, err.message); }
    const bar = h("progress", { max: 1, value: 0 });
    const status = h("span", {}, "Laster opp …");
    preview.replaceChildren(h("img", { src: URL.createObjectURL(blob), alt: "Bildet du har valgt" }),
      h("div", { class: "upload-row" }, status, bar, h("button", { type: "button", class: "link danger small", onclick: clearImage }, "Fjern")));
    preview.classList.remove("hidden");
    uploading = true;
    send.disabled = true;
    try {
      image = await uploadMedia(blob, (p) => (bar.value = p));
      status.textContent = "Bilde lagt til";
      bar.remove();
    } catch (err) {
      clearImage();
      showWarning(warning, err.message);
    } finally {
      uploading = false;
      send.disabled = false;
    }
  });

  send.addEventListener("click", async () => {
    if (uploading) return;
    if (!text.value.trim() && !image) return text.focus();
    send.disabled = true;
    try {
      await api(`/groups/${g.id}/adult`, { method: "POST", body: { text: text.value, mediaId: image?.id } });
      showAdultChat(g);
    } catch (err) {
      send.disabled = false;
      showWarning(warning, err.message);
    }
  });

  const message = (m) => h("article", { class: "post" },
    h("div", { class: "head" },
      avatar(m.avatar),
      h("div", { class: "who" }, h("div", { class: "name" }, m.author), h("div", { class: "meta" }, timeAgo(m.createdAt)))),
    m.text && h("div", { class: `body bubble${m.mine ? " mine" : ""}` }, m.text),
    m.imageId && h("div", { class: "media" }, h("img", { src: `/api/media/${m.imageId}`, alt: `Bilde fra ${m.author}`, loading: "lazy" })),
    m.canDelete && h("div", { class: "actions" }, btn("Slett", async () => {
      if (!confirm("Slette meldingen?")) return;
      await api(`/adult/${m.id}`, { method: "DELETE" }).then(() => showAdultChat(g), (err) => toast(err.message));
    }, "ghost", "trash")));

  render(
    newPostsBar,
    h("div", { class: "back-head" }, iconBtn("back", "Tilbake", () => { parentTab = "grupper"; showParent(); }), h("h2", {}, `Voksenkontakt · ${g.name}`)),
    h("p", { class: "muted small adult-note" }, icon("lock"), h("span", {}, "Bare foresatte i gruppa ser dette. Barna ser det ikke.")),
    h("section", { class: "card adult-compose" },
      h("div", { class: "editor" }, text, h("div", { class: "toolbar" }, attachBtn)),
      fileInput, preview, warning,
      h("div", { class: "composer-foot" }, h("span", { class: "to" }), send)),
    messages.length ? messages.map(message) : h("div", { class: "card empty" },
      h("div", { class: "end-icon" }, icon("users")),
      h("p", {}, "Ingen meldinger ennå. Her kan dere gi beskjeder og avtale ting sammen.")));
}

// ---------- Load-skjerm ----------
// Skjermen ligger i index.html. Den vises minst så lenge inn-animasjonen og smilet varer,
// og forsvinner med en ut-animasjon når første visning er tegnet.
const splash = document.getElementById("splash");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPLASH_MIN_MS = reducedMotion ? 300 : 1600;

function hideSplash() {
  if (!splash || splash.dataset.hiding) return;
  splash.dataset.hiding = "1";
  setTimeout(() => {
    splash.classList.add("out");
    const remove = () => splash.remove();
    splash.addEventListener("animationend", (e) => e.target === splash && remove());
    setTimeout(remove, 1000); // i tilfelle animationend ikke kommer
  }, Math.max(0, SPLASH_MIN_MS - performance.now())); // performance.now() måles fra sidelasting
}

// En lenke for nytt passord kan åpnes i en fane der appen allerede er åpen.
window.addEventListener("hashchange", () => /^#(reset=|verify=|voksen=|registrer$)/.test(location.hash) && start());

start();
