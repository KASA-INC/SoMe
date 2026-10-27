"""Lager logoen i appen fra logofila design/logo/quiply-logodeck.pdf.

Kjør på nytt når logofila endres:
  pip install shapely && python3 scripts/logo.py
  npm install --no-save playwright && node scripts/app-icons.mjs && node scripts/email-assets.mjs

Krever pdftocairo (poppler-utils) og shapely. Skriver:
  public/brand.js          merket, den liggende logoen, den stående logoen og boblehalen
  public/index.html        load-skjermen mellom <!-- splash:start --> og <!-- splash:end -->
  public/om.html           den stående logoen øverst på siden
  public/style.css         --bubble-tail (halen på snakkeboblene, fra design/logo/quiply-shapes.pdf)
  public/hvem.html         bilderammen (den hele snakkeboblen fra quiply-shapes.pdf)
  public/brand/logo-*.svg  den stående logoen som egne filer

Logofila må ha samme oppsett som nå, øverste halvdel (den svarte), fra venstre:
  symbolet, hovedlogoen (merket med «quiply» under), hovedlogoen med slagord, appikonet,
  og den liggende logoen med slagordet «quick reply, then goodbye.» under.
Formene finnes ut fra hvor de ligger, ikke rekkefølgen i fila.

Load-skjermen går fra «quick reply, then goodbye.» til «quiply». Bokstavene c, k, r og e (og komma) finnes
ikke i ordbildet, så de hentes fra slagordet under den liggende logoen og skaleres opp. Er slagordet fetere
enn ordbildet, tynnes strekene til samme tykkelse. Står det «the goodbye» i fila, lages n av h-en.
"""
import json, re, subprocess, sys, tempfile
from pathlib import Path
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "design/logo/quiply-logodeck.pdf"
SHAPES = ROOT / "design/logo/quiply-shapes.pdf"  # snakkeboblene: avlang boble og hel boble


# ---------- Lese stiene fra PDF-en ----------
def svg_paths(pdf):
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "deck.svg"
        subprocess.run(["pdftocairo", "-svg", str(pdf), str(out)], check=True)
        return re.findall(r'<path[^>]*fill="([^"]*)"[^>]*d="([^"]*)"', out.read_text())


def parse(d):
    """pdftocairo skriver bare M, L, C og Z. Gir en liste med delstier: [(kommando, tall), ...]."""
    tok = re.findall(r"[MLCZ]|-?\d+\.?\d*", d)
    subs, cur, cmd, i = [], None, None, 0
    while i < len(tok):
        if tok[i] in "MLCZ":
            cmd = tok[i]; i += 1
        if cmd == "Z":
            if cur: subs.append(cur)
            cur = None
            continue
        if cmd == "M":
            if cur: subs.append(cur)
            cur = [("M", (float(tok[i]), float(tok[i + 1])))]; i += 2; cmd = "L"
        elif cmd == "L":
            cur.append(("L", (float(tok[i]), float(tok[i + 1])))); i += 2
        elif cmd == "C":
            cur.append(("C", tuple(float(v) for v in tok[i:i + 6]))); i += 6
    if cur: subs.append(cur)
    return [s for s in subs if len(s) > 1]


def flatten(sub, n=16):
    pts, p = [], None
    for c, v in sub:
        if c in "ML":
            p = v; pts.append(v)
        else:
            x0, y0 = p; x1, y1, x2, y2, x3, y3 = v
            for k in range(1, n + 1):
                t = k / n; a, b, cc, dd = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                pts.append((a * x0 + b * x1 + cc * x2 + dd * x3, a * y0 + b * y1 + cc * y2 + dd * y3))
            p = (x3, y3)
    return pts


def poly(subs):
    """Delstiene som én flate med hull (som fill-rule evenodd)."""
    g = None
    for s in subs:
        pg = Polygon(flatten(s)).buffer(0)
        g = pg if g is None else g.symmetric_difference(pg)
    return g


def transform(subs, sx, sy, ox, oy):
    """(x - ox) * sx, (y - oy) * sy for alle punkter, også kontrollpunktene."""
    return [[(c, tuple((v[j] - ox) * sx if j % 2 == 0 else (v[j] - oy) * sy for j in range(len(v)))) for c, v in s] for s in subs]


def num(x, dec):
    s = f"{x:.{dec}f}"
    return (s.rstrip("0").rstrip(".") if "." in s else s) or "0"


def curves(subs, dec=1):
    out = []
    for s in subs:
        for c, v in s:
            out.append(c + " ".join(num(x, dec) for x in v))
        out.append("Z")
    return "".join(out).replace(" -", "-")


def polygons(g, dec=0):
    parts = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = []
    for pg in parts:
        for ring in [pg.exterior, *pg.interiors]:
            c = list(ring.coords)[:-1]
            out.append("M" + "L".join(f"{num(x, dec)} {num(y, dec)}" for x, y in c) + "Z")
    return "".join(out).replace(" -", "-")


def tf(g, s, ox, oy):
    return affinity.affine_transform(g, [s, 0, 0, s, -ox * s, -oy * s])


# ---------- Finne formene ----------
paths = svg_paths(PDF)
shapes = []
for fill_color, d in paths:
    if "100%" not in fill_color: continue  # bare de hvite formene (på den svarte halvdelen)
    subs = parse(d)
    if not subs: continue
    g = poly(subs)
    x0, y0, x1, y1 = g.bounds
    if x1 - x0 > 1500: continue  # bakgrunnen
    shapes.append({"d": d, "subs": subs, "g": g, "b": g.bounds})
top = [s for s in shapes if s["b"][1] < 540]  # den svarte halvdelen: hvite former
by_x = lambda lst: sorted(lst, key=lambda s: s["b"][0])
width = lambda s: s["b"][2] - s["b"][0]

symbol = max((s for s in top if s["b"][2] < 400), key=width)
stack = [s for s in top if 400 < s["b"][0] and s["b"][2] < 600]
icon_x = [s for s in top if 860 < s["b"][0] < 1100]
logo_row = by_x([s for s in top if s["b"][0] > 1150 and s["b"][1] < 340])
tagline = by_x([s for s in top if s["b"][0] > 1150 and s["b"][1] > 340])
stack_mark = max(stack, key=lambda s: s["b"][3] - s["b"][1])
stack_word = by_x([s for s in stack if s is not stack_mark])

assert len(logo_row) == 6, f"Fant {len(logo_row)} former i den liggende logoen, ventet q u i p l y"
assert len(stack_word) == 6, f"Fant {len(stack_word)} bokstaver under den stående logoen, ventet quiply"
TAG = {22: "quickreply,thegoodbye.", 23: "quickreply,thengoodbye."}.get(len(tagline))
assert TAG, f"Slagordet har {len(tagline)} former. Ventet «quick reply, the(n) goodbye.»"

# ---------- Merket: symbolet til høyre, 1000 × 1000 ----------
MX, MY, _, _ = symbol["b"]
m_scale = 1000 / width(symbol)
mk = transform(symbol["subs"], m_scale, m_scale, MX, MY)
mk_parts = sorted(((poly([s]).area, poly([s]).bounds, s) for s in mk), key=lambda t: -t[0])
ring_outer, ring_inner = mk_parts[0][2], mk_parts[1][2]
small = sorted(mk_parts[2:5], key=lambda t: t[1][1])  # øynene ligger høyere enn munnen
eyes = sorted(small[:2], key=lambda t: t[1][0])
mouth = small[2][2]
RING = curves([ring_outer, ring_inner])
EYE_L, EYE_R, MOUTH = curves([eyes[0][2]]), curves([eyes[1][2]]), curves([mouth])
# Appikonet: merket fyller 75 % av bredden, midt i ruta (som i logofila).
icon_tile = max(icon_x, key=width)
hole = sorted((poly([sp]) for sp in icon_tile["subs"]), key=lambda p: -p.area)[1]  # merket er et hull i ruta
fill = (hole.bounds[2] - hole.bounds[0]) / width(icon_tile)
side = 1000 / fill
ICON_VIEWBOX = f"{num(500 - side / 2, 1)} {num(500 - side / 2, 1)} {num(side, 1)} {num(side, 1)}"

# ---------- Den liggende logoen: ansikts-q + uiply, q-en er merket i 1000-skala ----------
q = logo_row[0]
QX, QY = q["b"][0], q["b"][1]
s_logo = 1000 / width(q)
letters = dict(zip("uiply", logo_row[1:]))
LOGO_LETTERS = curves(transform([sp for s in logo_row[1:] for sp in s["subs"]], s_logo, s_logo, QX, QY), 0)
lb = [tf(s["g"], s_logo, QX, QY).bounds for s in logo_row]
LOGO_TOP = min(b[1] for b in lb); LOGO_BOTTOM = max(b[3] for b in lb); LOGO_RIGHT = lb[-1][2]
LOGO_VIEWBOX = f"0 {num(LOGO_TOP, 0)} {num(LOGO_RIGHT, 0)} {num(LOGO_BOTTOM - LOGO_TOP, 0)}"

# ---------- quick reply: c k r e og komma fra slagordet, tynnet til ordbildets strektykkelse ----------
tg = dict()
for ch, s in zip(TAG, tagline):
    tg.setdefault(ch, []).append(s)
tl, wl = tg["l"][0], letters["l"]
K = (wl["b"][3] - wl["b"][1]) / (tl["b"][3] - tl["b"][1])  # slagord -> ordbilde, målt på l
BT, BW = tl["b"][3], wl["b"][3]  # grunnlinjene
stem_t = width(tl) * K; stem_w = width(wl); H = wl["b"][3] - wl["b"][1]
# Tynn med D på hver side og skaler opp igjen så høyden blir lik: (stem_t - 2D) * H / (H - 2D) = stem_w
D = (stem_t - stem_w) * H / (2 * (H - stem_w))
# Tynnede bokstaver blir litt bredere enn ordbildets; mål på u, p og y og juster bredden.


def thin(s, x_at, xs=1.0):
    g = affinity.affine_transform(s["g"], [K, 0, 0, K, x_at - s["b"][0] * K, BW - BT * K])
    b = g.bounds
    e = affinity.translate(g.buffer(-D, join_style=1, quad_segs=8), 0, D)
    f = H / (H - 2 * D)
    e = affinity.scale(e, f * xs, f, origin=((b[0] + b[2]) / 2, BW))
    return affinity.translate(e, x_at - e.bounds[0], 0)


XS = sum(width(letters[c]) / (thin(tg[c][0], 0).bounds[2] - thin(tg[c][0], 0).bounds[0]) for c in "upy") / 3
tb = lambda c, i=0: tg[c][i]["b"]
# Avstandene i ordbildet er slagordets avstander (skalert) pluss det tynningen gir; mål på u-i, p-l og l-y.
PAD = sum((letters[b]["b"][0] - letters[a]["b"][2]) - (tb(b)[0] - tb(a)[2]) * K for a, b in ("ui", "pl", "ly")) / 3
gap = lambda a, b: (tb(b)[0] - tb(a)[2]) * K + PAD
new = {}
x = letters["i"]["b"][2] + gap("i", "c")
for a, ch in (("i", "c"), ("c", "k"), ("k", "r"), ("r", "e")):
    if ch != "c":
        x = new[a].bounds[2] + gap(a, ch)
    new[ch] = thin(tg[ch][0], x, XS)
PLY_SHIFT = new["e"].bounds[2] + gap("e", "p") - letters["p"]["b"][0]
comma_x = letters["y"]["b"][2] + PLY_SHIFT + (tb(",")[0] - tb("y")[2]) * K
new["comma"] = thin(tg[","][0], comma_x, XS)
NEW = {c: polygons(tf(g, s_logo, QX, QY).simplify(1.5)) for c, g in new.items()}
# r, e og komma flytter seg med -ply, så de står der -ply starter (se load-skjermen).
BACK = {c: polygons(affinity.translate(tf(g, s_logo, QX, QY), -PLY_SHIFT * s_logo, 0).simplify(1.5)) for c, g in new.items()}
QR_RIGHT = tf(new["comma"], s_logo, QX, QY).bounds[2]

# ---------- then goodbye.: slagordets vekt, grunnlinje på 0, venstre kant på 0 ----------
i0 = TAG.index("t")
line = [s["g"] for s in tagline[i0:]]
if "then" not in TAG:
    h, e = tagline[i0 + 1], tagline[i0 + 2]
    stem = width(tl)
    n = h["g"].difference(box(h["b"][0] - 1, h["b"][1] - 1, h["b"][0] + stem + 0.02, tg["u"][0]["b"][1]))
    n = affinity.translate(n, e["b"][2] + (tb("p", 0)[0] - tb("e", 0)[2]) - n.bounds[0], 0)
    move = n.bounds[2] - e["b"][2]
    line = line[:3] + [n] + [affinity.translate(g, move, 0) for g in line[3:]]
l2 = unary_union(line)
x2 = l2.bounds[0]
l2 = affinity.affine_transform(l2, [K * s_logo, 0, 0, K * s_logo, -x2 * K * s_logo, -BT * K * s_logo])
LINE2 = polygons(l2.simplify(2)); L2B = l2.bounds

# ---------- Den stående logoen: merket med «quiply» under ----------
SX, SY = stack_mark["b"][0], stack_mark["b"][1]
s_stack = 1000 / width(stack_mark)
WORD = curves(transform([sp for s in stack_word for sp in s["subs"]], s_stack, s_stack, SX, SY), 0)
STACK_BOTTOM = max(tf(s["g"], s_stack, SX, SY).bounds[3] for s in stack_word)
STACK_VIEWBOX = f"0 0 1000 {num(STACK_BOTTOM, 0)}"

# ---------- public/brand.js ----------
brand = f'''// Merkevaren: navn og logo. Formene lages av scripts/logo.py fra design/logo/quiply-logodeck.pdf.
// Ikke rediger formene her; endre logofila og kjør skriptet på nytt.
export const APP_NAME = "quiply";

// Merket: Q-formet snakkeboble med ansikt, 1000 × 1000. Tegnes med fill-rule="evenodd".
// Delene hver for seg, så ansiktet kan animeres (blunke, se seg rundt, smile).
export const MARK_RING = "{RING}";
export const MARK_EYE_LEFT = "{EYE_L}";
export const MARK_EYE_RIGHT = "{EYE_R}";
export const MARK_MOUTH = "{MOUTH}";
export const MARK_PATH = MARK_RING + MARK_EYE_LEFT + MARK_EYE_RIGHT + MARK_MOUTH;
export const MARK_TIGHT_VIEWBOX = "0 0 1000 1000";
// Kvadrat med luft rundt merket, for appikoner. Merket fyller {round(fill * 100)} % av bredden.
export const MARK_VIEWBOX = "{ICON_VIEWBOX}";

// Liggende logo: merket er q-en, og «uiply» står etter. Merket ligger på 0 0 1000 1000, som over.
export const LOGO_VIEWBOX = "{LOGO_VIEWBOX}";
export const LOGO_LETTERS = "{LOGO_LETTERS}";

// Stående logo: merket med «quiply» under, i en litt fetere vekt.
export const STACK_VIEWBOX = "{STACK_VIEWBOX}";
export const WORDMARK_PATH = "{WORD}";
'''
(ROOT / "public/brand.js").write_text(brand)

# ---------- Load-skjermen ----------
# «quiply» står midt på. qui- og -ply trekkes fra hverandre, ck og re kommer inn i mellomrommet
# (c og k følger qui-, r og e følger -ply, så de aldri står oppå naboene),
# og «then goodbye.» kommer et sekund etter. Lengdene brukes av style.css (se .splash).
S2 = 0.45  # linje 2 i forhold til linje 1
Y2 = LOGO_BOTTOM + 420 - L2B[1] * S2  # grunnlinjen til linje 2
BOTTOM = Y2 + L2B[3] * S2
START = (QR_RIGHT - LOGO_RIGHT) / 2  # «quiply» midt i bredden til «quick reply,»
DROP = (BOTTOM - LOGO_BOTTOM) / 2  # én linje midt i høyden til to
x2 = (QR_RIGHT - L2B[2] * S2) / 2
def g(d, cls="", extra=""):
    c = f' class="{cls}"' if cls else ""
    return f'<path{c}{extra} fill="currentColor" fill-rule="evenodd" d="{d}"/>'
letter_paths = {c: curves(transform(letters[c]["subs"], s_logo, s_logo, QX, QY), 0) for c in "uiply"}
splash = f'''<!-- splash:start (lages av scripts/logo.py) -->
  <div class="splash" id="splash" aria-hidden="true">
    <div class="splash-inner">
      <svg class="splash-logo" viewBox="0 {num(LOGO_TOP, 0)} {num(QR_RIGHT, 0)} {num(BOTTOM - LOGO_TOP, 0)}">
        <g class="sp-all">
          <g class="sp-a">
            {g(RING)}
            {g(EYE_L, "sp-eye")}
            {g(EYE_R, "sp-eye sp-eye-right")}
            {g(MOUTH, "sp-mouth")}
            {g(letter_paths["u"] + letter_paths["i"])}
            {g(NEW["c"], "sp-new sp-first")}
            {g(NEW["k"], "sp-new sp-second")}
          </g>
          <g class="sp-b">
            {g(letter_paths["p"] + letter_paths["l"] + letter_paths["y"])}
            {g(BACK["r"], "sp-new sp-second")}
            {g(BACK["e"], "sp-new sp-first")}
            {g(BACK["comma"], "sp-late")}
          </g>
          <g class="sp-late" transform="translate({num(x2, 0)} {num(Y2, 0)}) scale({S2})">{g(LINE2)}</g>
        </g>
      </svg>
    </div>
  </div>
  <!-- splash:end -->'''
# Hvor langt qui-, -ply og det hele flytter seg, i logoens enheter. Står i style.css mellom markørene,
# fordi Content-Security-Policy (default-src 'self') blokkerer style-attributter i HTML-en.
css_path = ROOT / "public/style.css"
lengths = (f"/* splash-mål:start (lages av scripts/logo.py) */\n"
           f".splash-logo {{ --start: {num(START, 0)}px; --ply: {num(PLY_SHIFT * s_logo, 0)}px; --drop: {num(DROP, 0)}px; }}\n"
           f"/* splash-mål:end */")
css_text, n = re.subn(r"/\* splash-mål:start.*?/\* splash-mål:end \*/", lengths, css_path.read_text(), flags=re.S)
assert n == 1, "Fant ikke /* splash-mål:start */ ... /* splash-mål:end */ i style.css"
css_path.write_text(css_text)
idx = ROOT / "public/index.html"
html = idx.read_text()
html, n = re.subn(r"<!-- splash:start.*?<!-- splash:end -->", splash.strip(), html, flags=re.S)
assert n == 1, "Fant ikke <!-- splash:start --> ... <!-- splash:end --> i index.html"
idx.write_text(html)

# ---------- Om-siden og logofilene: den stående logoen ----------
stack_svg = lambda attrs, fill: (f'<svg {attrs} viewBox="{STACK_VIEWBOX}" role="img" aria-label="quiply">'
                                 f'<path fill="{fill}" fill-rule="evenodd" d="{RING + EYE_L + EYE_R + MOUTH + WORD}"/></svg>')
om = ROOT / "public/om.html"
s, n = re.subn(r'<svg class="info-logo".*?</svg>',
               f'''<svg class="info-logo" viewBox="{STACK_VIEWBOX}" role="img" aria-label="quiply">
        <g class="mark alive" fill="currentColor">
          <path fill-rule="evenodd" d="{RING}"/>
          <g class="face">
            <path class="eye eye-left" d="{EYE_L}"/>
            <path class="eye eye-right" d="{EYE_R}"/>
            <path class="mouth" d="{MOUTH}"/>
          </g>
        </g>
        <path fill="currentColor" d="{WORD}"/>
      </svg>''', om.read_text(), flags=re.S)
assert n == 1
om.write_text(s)
for name, color in (("logo-ink.svg", "#161619"), ("logo-cream.svg", "#f8f8f4")):
    (ROOT / "public/brand" / name).write_text(stack_svg('xmlns="http://www.w3.org/2000/svg"', color) + "\n")

# ---------- Snakkeboblene og bilderammen, fra quiply-shapes.pdf ----------
# Øverst til venstre: avlang boble med halen nede til høyre. Nede i midten: hel boble uten deling.
bubbles = []
for fill_color, d in svg_paths(SHAPES):
    subs = parse(d)
    if "100%" not in fill_color or not subs: continue
    g = poly(subs)
    if g.bounds[2] - g.bounds[0] > 1500: continue
    bubbles.append({"subs": subs, "g": g, "b": g.bounds})
pill = min(bubbles, key=lambda s: (s["b"][1], s["b"][0]))  # øverst til venstre
whole = [s for s in bubbles if len(s["subs"]) == 1 and s["b"][1] > 540 and 600 < s["b"][0] < 1200]
assert len(whole) == 1, f"Fant {len(whole)} hele bobler nede i midten av shapes-fila"
whole = whole[0]
# Halen: nederste høyre hjørne av den avlange boblen, et kvadrat med sidene lik radien.
px0, py0, px1, py1 = pill["b"]
r = (py1 - py0) / 2
TAIL = curves(transform(pill["subs"], 1000 / r, 1000 / r, px1 - r, py1 - r), 0)
css = ROOT / "public/style.css"
tail = (f"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' preserveAspectRatio='none'%3E"
        f"%3Cpath d='{TAIL}'/%3E%3C/svg%3E\")")
s, n = re.subn(r'--bubble-tail: url\("data:image/svg\+xml,[^"]*"\);', f"--bubble-tail: {tail};", css.read_text())
assert n == 1
css.write_text(s)
# Bilderammen på «Hvem står bak»: den hele boblen, 1000 × 1000. Bildet er 4 : 5 og litt høyere enn rammen.
wb = whole["b"]
FRAME = curves(transform(whole["subs"], 1000 / (wb[2] - wb[0]), 1000 / (wb[3] - wb[1]), wb[0], wb[1]), 1)
hvem = ROOT / "public/hvem.html"
s, n = re.subn(r'<svg class="person-frame".*?</svg>', f'''<svg class="person-frame" viewBox="0 0 1000 1000" role="img" aria-label="Kristian Dalen, som står bak quiply">
        <clipPath id="person-q"><path d="{FRAME}"/></clipPath>
        <image href="img/kristian.jpg" x="0" y="-52" width="1000" height="1250" clip-path="url(#person-q)"/>
      </svg>''', hvem.read_text(), flags=re.S)
assert n == 1
hvem.write_text(s)

print(f"Logo: tynnet {D:.2f} px per side, bredde {XS:.3f}, avstand +{PAD:.2f} px. «quick reply,» er {QR_RIGHT / LOGO_RIGHT:.2f} × «quiply».")
