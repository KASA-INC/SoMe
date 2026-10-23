// Felles bunntekst med lenker til all nyttig info. Brukes av appen (app.js) og av de statiske sidene,
// som har <footer class="site-footer" data-site-footer> og laster denne fila.
import { APP_NAME, MARK_PATH, MARK_TIGHT_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "./brand.js";

const LINKS = [
  ["quipu", [["Om quipu", "/om"], ["Hvem står bak", "/hvem"], ["Kontakt", "mailto:hei@quipu.no"]]],
  ["Trygghet", [["Slik gjør vi det trygt", "/om"], ["Teknisk sikkerhet", "/sikkerhet"], ["Personvern", "/personvern"]]],
  ["Kom i gang", [["Logg inn", "/"], ["Lag konto", "/#registrer"], ["Legg på hjemskjermen", "/#registrer"]]],
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
  cookie.append(`🍪 Vi liker ikke cookies. ${APP_NAME} bruker bare én, og den holder deg innlogget. Ingen sporing og ingen reklame, og derfor ingen cookie-banner. `, more);
  const brand = make("div", "site-footer-brand");
  brand.append(logo());
  const bottom = make("div", "site-footer-bottom");
  bottom.append(cookie, make("p", "site-footer-copy", `© ${new Date().getFullYear()} ${APP_NAME}`));
  const inner = make("div", "site-footer-inner");
  inner.append(brand, cols, bottom);
  el.replaceChildren(inner);
}

// Statiske sider: fyll bunnteksten med en gang.
for (const el of document.querySelectorAll("[data-site-footer]")) fillFooter(el);
