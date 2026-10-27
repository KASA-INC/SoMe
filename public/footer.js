// Felles bunntekst med lenker til all nyttig info. Brukes av appen (app.js) og av de statiske sidene,
// som har <footer class="site-footer" data-site-footer> og laster denne fila.
import { APP_NAME, MARK_PATH, MARK_TIGHT_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "./brand.js";

const LINKS = [
  ["Kom i gang", [["Logg inn", "/"], ["Lag konto", "/#registrer"], ["Legg på hjemskjermen", "/#registrer"]]],
  ["Trygghet", [["Slik gjør vi det trygt", "/om"], ["Teknisk sikkerhet", "/sikkerhet"], ["Personvern", "/personvern"]]],
  ["quiply", [["Om quiply", "/om"], ["Miljø", "/miljo"], ["Hvem står bak", "/hvem"], ["Kontakt", "mailto:hei@quiply.no"]]],
];

const SVG_NS = "http://www.w3.org/2000/svg";
function logo() {
  const svg = (viewBox, d, cls) => {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "currentColor");
    p.setAttribute("fill-rule", "evenodd");
    s.append(p);
    return s;
  };
  const a = document.createElement("a");
  a.href = "/";
  a.className = "lockup footer-lockup";
  a.setAttribute("aria-label", APP_NAME);
  a.append(svg(MARK_TIGHT_VIEWBOX, MARK_PATH, "mark"), svg(WORDMARK_VIEWBOX, WORDMARK_PATH, "wordmark"));
  return a;
}

// Enkelt strekikon (som ikonene i appen) i stedet for cookie-emoji.
function cookieIcon() {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "icon");
  s.setAttribute("aria-hidden", "true");
  for (const d of ["M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5", "M8.5 8.5v.01", "M16 15.5v.01", "M12 12v.01", "M11 17v.01", "M7 14v.01"]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}

export function fillFooter(el) {
  const make = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const cols = make("div", "site-footer-cols");
  for (const [title, links] of LINKS) {
    const col = make("nav", "site-footer-col");
    col.setAttribute("aria-label", title);
    col.append(make("h2", "", title));
    for (const [label, href] of links) {
      const a = make("a", "", label);
      a.href = href;
      col.append(a);
    }
    cols.append(col);
  }
  const cookie = make("p", "site-footer-cookie");
  const more = make("a", "", "Les mer");
  more.href = "/personvern#informasjonskapsler";
  cookie.append(cookieIcon(), `Vi liker ikke cookies. ${APP_NAME} bruker bare én, og den holder deg innlogget. Ingen sporing og ingen reklame, og derfor ingen cookie-banner. `, more);
  const brand = make("div", "site-footer-brand");
  brand.append(logo());
  // Rekkefølge: lenkene, cookie-linja, logoen og © helt nederst.
  const inner = make("div", "site-footer-inner");
  inner.append(cols, cookie, brand, make("p", "site-footer-copy", `© ${new Date().getFullYear()} ${APP_NAME}`));
  el.replaceChildren(inner);
}

// Statiske sider: fyll bunnteksten med en gang.
for (const el of document.querySelectorAll("[data-site-footer]")) fillFooter(el);
