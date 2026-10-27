// Det levende ansiktet i logoen (alle .mark.alive på siden). Med noen sekunders mellomrom velger det én ting å
// gjøre, så det aldri går i fast takt. Det er rolig: én ting om gangen, og ingenting når fanen er skjult eller
// telefonen har «Reduser bevegelse». Bevegelsene ligger i style.css (.mark.alive.do-…).
//   blunk, dobbeltblunk, se til venstre/høyre, tenke (ser opp), glad (myser og smiler bredt), overrasket,
//   legge hodet på skakke, gjespe (oftere mot kvelden, når appen snart stenger), og se mot der man trykker.
// Trykk på logoen gir et blunk med ett øye.

const ACTIONS = {
  // navn: [varighet i ms, vekt om dagen, vekt om kvelden]
  blink: [200, 40, 30],
  "blink-twice": [500, 10, 8],
  "look-left": [1800, 9, 6],
  "look-right": [1800, 9, 6],
  think: [2200, 7, 5],
  happy: [1600, 8, 6],
  surprised: [1400, 5, 3],
  tilt: [1800, 7, 5],
  sleepy: [3200, 2, 16],
};
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
let started = false;

function play(mark, name, ms) {
  if (mark.dataset.busy) return;
  mark.dataset.busy = name;
  mark.classList.add(`do-${name}`);
  setTimeout(() => {
    mark.classList.remove(`do-${name}`);
    delete mark.dataset.busy;
  }, ms);
}

function pick() {
  const evening = new Date().getHours() >= 19;
  const list = Object.entries(ACTIONS);
  let r = Math.random() * list.reduce((n, [, a]) => n + a[evening ? 2 : 1], 0);
  for (const [name, a] of list) {
    r -= a[evening ? 2 : 1];
    if (r < 0) return [name, a[0]];
  }
  return ["blink", 200];
}

function tick() {
  if (!document.hidden && !reduced.matches) {
    for (const mark of document.querySelectorAll(".mark.alive")) play(mark, ...pick());
  }
  setTimeout(tick, 3500 + Math.random() * 4500);
}

// Ansiktet ser mot der man trykker på siden (ikke oftere enn hvert fjerde sekund).
let lastGlance = 0;
function glance(e) {
  if (reduced.matches || e.target.closest?.(".mark.alive") || Date.now() - lastGlance < 4000) return;
  lastGlance = Date.now();
  for (const mark of document.querySelectorAll(".mark.alive")) {
    const face = mark.querySelector(".face");
    if (!face || mark.dataset.busy) continue;
    const box = face.getBoundingClientRect();
    if (!box.width) continue;
    const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    face.style.setProperty("--gx", `${Math.round((dx / len) * 70)}px`);
    face.style.setProperty("--gy", `${Math.round((dy / len) * 45)}px`);
    play(mark, "glance", 1200);
  }
}

function wink(e) {
  const mark = e.target.closest?.(".mark.alive");
  if (!mark || reduced.matches) return;
  // Et blunk vinner over det ansiktet holder på med.
  for (const c of [...mark.classList]) if (c.startsWith("do-")) mark.classList.remove(c);
  delete mark.dataset.busy;
  void mark.getBoundingClientRect(); // start animasjonen på nytt ved gjentatte trykk
  play(mark, "wink", 600);
}

export function startFace() {
  if (started) return;
  started = true;
  setTimeout(tick, 2500);
  document.addEventListener("pointerdown", glance, { passive: true });
  document.addEventListener("click", wink);
}
