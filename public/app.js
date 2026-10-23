// quipu — klient. All brukertekst settes med textContent, aldri som HTML.
import {
  APP_NAME, MARK_VIEWBOX, MARK_TIGHT_VIEWBOX, MARK_RING, MARK_EYE_LEFT, MARK_EYE_RIGHT, MARK_MOUTH,
  WORDMARK_VIEWBOX, WORDMARK_PATH,
} from "./brand.js";
import { fillFooter } from "./footer.js";

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
// Bunnteksten med lenker vises overalt unntatt i feeder og for barn.
const siteFooter = document.getElementById("site-footer");
fillFooter(siteFooter);
const show = (nodes, footer) => {
  document.body.classList.toggle("auth-page", !config);
  siteFooter.classList.toggle("hidden", !footer);
  view.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
};
const render = (...nodes) => show(nodes, config?.me.role !== "child");
render.feed = (...nodes) => show(nodes, false);

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
  try {
    config = await api("/me");
  } catch {
    config = null;
  }
  setHeader(config?.me.status);
  if (!config) return location.hash === "#registrer" ? showRegister() : showLogin();
  if (config.me.role === "child") return showChild();
  if (!config.me.emailVerified) return showVerifyEmail();
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

async function showRegister() {
  const { codeRequired } = await api("/signup-info").catch(() => ({ codeRequired: false }));
  const warning = warningBox();
  const form = h("form", { class: "card" },
    field("Navnet ditt", h("input", { name: "displayName", required: true, maxlength: 20, autocomplete: "given-name" })),
    field("E-post (du logger inn med denne)", h("input", { name: "email", type: "email", autocomplete: "username", autocapitalize: "none", inputmode: "email", required: true })),
    field("Passord (minst 8 tegn)", passwordInput({ name: "password", autocomplete: "new-password", required: true, minlength: 8 })),
    codeRequired && field("Registreringskode", h("input", { name: "code", required: true, autocomplete: "off", autocapitalize: "none" })),
    h("label", { class: "check" }, h("input", { type: "checkbox", required: true }),
      h("span", {}, "Jeg er over 18 år og er foresatt for barna jeg lager kontoer til.")),
    h("p", { class: "muted small" }, "Les hvordan vi behandler opplysninger i ", h("a", { class: "link", href: "/personvern" }, "personvernerklæringen"), "."),
    h("button", { class: "btn block" }, "Lag konto"),
    warning);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/register", { method: "POST", body: formData(form) });
      start();
    } catch (err) { showWarning(warning, err.message); }
  });
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
    h("p", {}, err.message)));
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
      "Bilder og videoer blir som regel sett av en voksen før de andre i gruppa får se dem.",
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
    text: ["Trykk «Si fra» på innlegget. Da blir det skjult, og en voksen ser på det.",
      "Snakk gjerne med en voksen du stoler på.",
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
        h("button", { type: "button", class: "link small", onclick: openAvatarSheet }, "Bytt profilbilde"))));
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

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    warning.classList.add("hidden");
    const isVideo = file.type.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(file.name);
    let blob = file;
    try {
      if (isVideo) {
        if (file.size > limits.videoMb * 1024 * 1024) {
          clearAttachment();
          return showWarning(warning, `Videoen er for stor (${Math.round(file.size / 1048576)} MB). Maks er ${limits.videoMb} MB.`);
        }
        const d = await videoDuration(file);
        if (d && d > limits.videoSeconds + 0.5) {
          clearAttachment();
          return showWarning(warning, `Videoen er ${Math.round(d)} sekunder. Maks er ${limits.videoSeconds} sekunder. Du kan klippe den i Bilder-appen.`);
        }
      } else {
        blob = await prepareImage(file);
      }
    } catch (err) {
      clearAttachment();
      return showWarning(warning, err.message);
    }

    const localUrl = URL.createObjectURL(blob);
    const bar = h("progress", { max: 1, value: 0 });
    const status = h("span", {}, "Laster opp …");
    const media = isVideo
      ? h("video", { src: localUrl, controls: true, playsinline: true, muted: true, preload: "metadata" })
      : h("img", { src: localUrl, alt: "Bildet du har valgt" });
    preview.replaceChildren(media, h("div", { class: "upload-row" }, status, bar,
      h("button", { type: "button", class: "link danger small", onclick: clearAttachment }, "Fjern")));
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
  return btn("Si fra", async () => {
    if (!confirm("Vil du skjule innlegget og si fra til en voksen?")) return;
    await api(`/posts/${p.id}/report`, { method: "POST" })
      .then(() => { toast("Takk for at du sa fra. En voksen ser på det."); showChild(); }, handleChildError);
  }, "ghost", "flag");
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
// gjør dem mindre og gjør HEIC fra iPhone om til JPEG.
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Klarte ikke å åpne bildet. Prøv et annet."));
      i.src = url;
    });
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
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
  const [{ children }, { groups }] = await Promise.all([api("/children"), api("/groups")]);
  const todo = groups.reduce((n, g) => n + (g.openReports || 0) + (g.pendingMedia || 0) + (g.pendingMembers?.length || 0) + (g.adultUnread || 0), 0);

  const tab = (key, label) => h("button", {
    type: "button", role: "tab", class: parentTab === key ? "selected" : "", "aria-selected": String(parentTab === key),
    onclick: () => { parentTab = key; showParent(); },
  }, label, key === "grupper" && todo ? h("span", { class: "count" }, todo) : null);

  const content = {
    barn: () => childrenTab(children),
    grupper: () => groupsTab(groups),
    konto: accountTab,
  }[parentTab]();

  const emailNotice = !config.me.email && parentTab !== "konto" && h("div", { class: "card notice" }, icon("mail"),
    h("div", {}, h("strong", {}, "Legg inn e-posten din"),
      h("p", { class: "muted small" }, "Da kan du få en lenke for å velge nytt passord hvis du glemmer det."),
      btn("Legg inn e-post", () => { parentTab = "konto"; showParent(); }, "soft small")));

  render(
    emailNotice,
    h("div", { class: "tabs", role: "tablist" }, tab("barn", "Barn"), tab("grupper", "Grupper"), tab("konto", "Konto")),
    content);
}

function childrenTab(children) {
  return [
    h("div", { class: "section-title" }, h("h2", {}, "Barna mine"), btn("Legg til", openAddChild, "soft small", "plus")),
    children.length ? null : h("div", { class: "card empty" },
      h("div", { class: "end-icon" }, icon("user")),
      h("p", {}, "Lag en konto til barnet ditt for å komme i gang.")),
    ...children.map(childCard),
  ];
}

function meter(label, used, max, unit) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return h("div", { class: "meter" },
    h("div", { class: "label" }, label),
    h("div", { class: "value" }, `${used}`, h("span", {}, ` av ${max} ${unit}`)),
    h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })));
}

function childCard(c) {
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
      h("div", { class: "full" }, field("Nytt passord (valgfritt)", passwordInput({ name: "password", autocomplete: "new-password", minlength: 8 })))),
    h("div", { class: "row between" },
      h("button", { class: "btn small" }, "Lagre"),
      h("button", {
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
      h("button", {
        type: "button", class: "chip add",
        onclick: (e) => { e.currentTarget.classList.add("hidden"); join.classList.remove("hidden"); join.querySelector("input").focus(); },
      }, icon("plus"), "Gruppe")),
    join,
    settings);
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
    g.isOwner && h("div", { class: "code-box" },
      h("div", {}, h("div", { class: "label" }, "Invitasjonskode"), h("code", {}, g.inviteCode)),
      btn("Kopier", () => copyText(g.inviteCode), "secondary small", "copy")),
    g.isOwner && reviewSwitch(g),
    h("div", { class: "card-actions" },
      btn("Se innlegg", () => showGroupPosts(g), "", "eye"),
      g.adultUnread !== undefined && h("button", { type: "button", class: "btn secondary", onclick: () => showAdultChat(g) },
        icon("users"), "Voksenkontakt", g.adultUnread ? h("span", { class: "count" }, g.adultUnread) : null),
      g.isOwner && btn("Slett", async () => {
        if (!confirm(`Slette gruppa ${g.name} og alle innleggene i den?`)) return;
        await api(`/groups/${g.id}`, { method: "DELETE" });
        showParent();
      }, "danger", "trash")));
}

// Barn som har bedt om å bli med. Eieren ser hvilken foresatt som spør, og godkjenner eller avslår.
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Kopiert");
  } catch {
    toast(`Koden er ${text}`);
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

function accountTab() {
  return [
    h("div", { class: "section-title" }, h("h2", {}, "Konto")),
    h("section", { class: "card" },
      h("div", { class: "entity-head" }, avatar(config.me.avatar, "lg"),
        h("div", { class: "who" }, h("h3", {}, config.me.displayName), h("div", { class: "sub" }, config.me.email || `@${config.me.username}`))),
      h("div", { class: "card-actions" }, btn("Logg ut", logout, "secondary", "logout"))),
    h("a", { class: "card notice info-link", href: "/om" }, icon("shield"),
      h("div", {}, h("strong", {}, `Slik gjør vi ${APP_NAME} trygt`),
        h("p", { class: "muted small" }, "Valgene vi har tatt, og historien bak navnet. Fin å dele med andre foresatte."))),
    installGuide(),
    emailCard(),
    passwordCard(),
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
  render.feed(
    newPostsBar,
    h("div", { class: "back-head" }, iconBtn("back", "Tilbake", showParent), h("h2", {}, g.name)),
    posts.length ? null : h("div", { class: "card empty" },
      h("div", { class: "end-icon" }, icon("sparkles")), h("p", {}, "Ingen innlegg ennå.")),
    ...posts.map((p) => {
      const card = postCard(p, { actions });
      const n = note(p);
      if (n) card.querySelector(".actions").before(n);
      return card;
    }));
}

// ---------- Voksenkontakt ----------
// Beskjeder og diskusjon mellom foresatte i gruppa. Barna ser det aldri. Samme oppsett som feeden:
// skrivefelt øverst, nyeste først, og en knapp når det kommer nye meldinger.
async function showAdultChat(g) {
  const { messages } = await api(`/groups/${g.id}/adult`);
  watchNewPosts(Math.max(0, ...messages.map((m) => m.id)), `/groups/${g.id}/adult/new`, () => showAdultChat(g), ["ny melding", "nye meldinger"]);

  const text = h("textarea", { maxlength: 1000, rows: 3, placeholder: "Skriv en beskjed til de andre foresatte …", "aria-label": "Melding" });
  const warning = warningBox();
  const send = h("button", { class: "btn", type: "button" }, "Send");
  send.addEventListener("click", async () => {
    if (!text.value.trim()) return text.focus();
    send.disabled = true;
    try {
      await api(`/groups/${g.id}/adult`, { method: "POST", body: { text: text.value } });
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
    h("div", { class: `body bubble${m.mine ? " mine" : ""}` }, m.text),
    m.canDelete && h("div", { class: "actions" }, btn("Slett", async () => {
      if (!confirm("Slette meldingen?")) return;
      await api(`/adult/${m.id}`, { method: "DELETE" }).then(() => showAdultChat(g), (err) => toast(err.message));
    }, "ghost", "trash")));

  render.feed(
    newPostsBar,
    h("div", { class: "back-head" }, iconBtn("back", "Tilbake", () => { parentTab = "grupper"; showParent(); }), h("h2", {}, `Voksenkontakt · ${g.name}`)),
    h("p", { class: "muted small adult-note" }, icon("lock"), h("span", {}, "Bare foresatte i gruppa ser dette. Barna ser det ikke.")),
    h("section", { class: "card adult-compose" }, h("div", { class: "editor" }, text), warning, h("div", { class: "composer-foot" }, h("span", { class: "to" }), send)),
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
window.addEventListener("hashchange", () => /^#(reset=|verify=|registrer$)/.test(location.hash) && start());

start();
