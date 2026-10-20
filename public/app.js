// SoMe Kids — klient. All brukertekst settes med textContent, aldri som HTML.

const view = document.getElementById("view");
let config = null; // { me, kinds, colors, stickers, avatars }
let heartbeatTimer = null;

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
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 3500);
}

function timeAgo(t) {
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "akkurat nå";
  if (min < 60) return `${min} min siden`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} t siden`;
  return `${Math.floor(hrs / 24)} d siden`;
}

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

const field = (label, input) => h("label", {}, label, input);
const formData = (form) => Object.fromEntries(new FormData(form));

// Knapperad der man velger ett alternativ. Returnerer elementet; valgt verdi ligger i el.value.
function choiceRow(items, render, initial, className = "choices") {
  const row = h("div", { class: className, role: "radiogroup" });
  row.value = initial;
  for (const item of items) {
    const b = h("button", { type: "button", "aria-pressed": String(item === initial) });
    render(b, item);
    if (item === initial) b.classList.add("selected");
    b.addEventListener("click", () => {
      row.querySelectorAll("button").forEach((x) => { x.classList.remove("selected"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("selected");
      b.setAttribute("aria-pressed", "true");
      row.value = item;
    });
    row.append(b);
  }
  return row;
}

function setHeader() {
  const me = config?.me;
  document.getElementById("meLabel").textContent = me ? `${me.avatar} ${me.displayName}` : "";
  document.getElementById("logoutBtn").classList.toggle("hidden", !me);
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("/logout", { method: "POST" }).catch(() => {});
  config = null;
  clearInterval(heartbeatTimer);
  start();
});

// ---------- Start ----------
async function start() {
  try {
    config = await api("/me");
  } catch {
    config = null;
  }
  setHeader();
  if (!config) return showLogin();
  if (config.me.role === "child") return showChild();
  return showParent();
}

// ---------- Innlogging ----------
function showLogin() {
  const form = h("form", { class: "card" },
    h("h2", {}, "Logg inn"),
    field("Brukernavn", h("input", { name: "username", autocomplete: "username", required: true })),
    field("Passord", h("input", { name: "password", type: "password", autocomplete: "current-password", required: true })),
    h("button", { class: "btn" }, "Logg inn"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/login", { method: "POST", body: formData(form) });
      start();
    } catch (err) { toast(err.message); }
  });
  view.replaceChildren(
    form,
    h("div", { class: "card muted center" },
      "Er du en voksen og vil lage konto til barnet ditt? ",
      h("button", { class: "link", onclick: showRegister }, "Lag foresatt-konto")),
  );
}

async function showRegister() {
  const { codeRequired } = await api("/signup-info").catch(() => ({ codeRequired: false }));
  const form = h("form", { class: "card" },
    h("h2", {}, "Ny foresatt-konto"),
    h("p", { class: "muted" }, "Kontoen er for en voksen. Etterpå lager du kontoer til barna og velger hvilke grupper de skal være med i."),
    field("Ditt navn (vises for andre foresatte)", h("input", { name: "displayName", required: true, maxlength: 20 })),
    field("Brukernavn", h("input", { name: "username", autocomplete: "username", required: true })),
    field("Passord (minst 8 tegn)", h("input", { name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 8 })),
    codeRequired && field("Registreringskode (fra den som inviterte deg)", h("input", { name: "code", required: true, autocomplete: "off" })),
    h("label", { class: "check" }, h("input", { type: "checkbox", required: true }),
      " Jeg er over 18 år og er foresatt for barna jeg lager kontoer til."),
    h("button", { class: "btn" }, "Lag konto"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/register", { method: "POST", body: formData(form) });
      start();
    } catch (err) { toast(err.message); }
  });
  view.replaceChildren(form, h("p", { class: "center" }, h("button", { class: "link", onclick: showLogin }, "Tilbake til innlogging")));
}

// ---------- Barn ----------
function showBlocked(message) {
  clearInterval(heartbeatTimer);
  view.replaceChildren(h("div", { class: "card blocked" },
    h("div", { class: "big" }, "🌳"),
    h("h2", {}, message),
    h("p", {}, "Kanskje du kan leke ute, lese en bok eller tegne noe fint?")));
}

function handleChildError(err) {
  if (err.code === "CLOSED" || err.code === "TIME_UP") showBlocked(err.message);
  else toast(err.message);
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const { status } = await api("/heartbeat", { method: "POST" });
      const el = document.getElementById("timeLeft");
      if (el) el.textContent = `${status.minutesLeft} min igjen i dag`;
    } catch (err) { handleChildError(err); }
  }, 60000);
}

async function showChild() {
  let data;
  try {
    data = await api("/feed");
  } catch (err) { return handleChildError(err); }
  startHeartbeat();
  const { status } = data;
  const groups = config.me.groups;

  const top = h("div", { class: "statusbar" },
    h("span", { id: "timeLeft" }, `${status.minutesLeft} min igjen i dag`),
    h("span", {}, status.postsLeft === 1 ? "Du kan dele 1 ting til i dag" : `Du kan dele ${status.postsLeft} ting til i dag`));

  view.replaceChildren(top, composer(groups, status), ...data.posts.map(postCard),
    h("div", { class: "card end" },
      h("div", { class: "big" }, "🌈"),
      h("p", {}, data.posts.length ? "Du har sett alt som er nytt!" : "Ingen har delt noe de siste dagene."),
      h("p", { class: "muted" }, "Nå kan du gjøre noe annet gøy. Vi ses senere! 👋"),
      h("button", { class: "link", onclick: showChild }, "Se etter nye innlegg")));
}

function composer(groups, status) {
  if (!groups.length) {
    return h("div", { class: "card muted" }, "Du er ikke med i noen gruppe ennå. Be en voksen om å legge deg til! 🙂");
  }
  if (status.postsLeft <= 0) {
    return h("div", { class: "card muted center" }, "Du har delt nok for i dag. Spar resten til i morgen! ✨");
  }

  const kinds = Object.keys(config.kinds);
  const kindRow = choiceRow(kinds, (b, k) => (b.textContent = config.kinds[k]), kinds[0], "choices kinds");
  const text = h("textarea", { maxlength: 200, placeholder: "Skriv her …", "aria-label": "Innlegg" });
  const count = h("span", { class: "muted" }, "0/200");
  const colorRow = choiceRow(config.colors, (b, c) => { b.className = `swatch c-${c}`; b.setAttribute("aria-label", c); }, config.colors[0], "colors");
  const stickerRow = choiceRow(config.stickers, (b, s) => (b.textContent = s || "✖️"), "", "choices stickers");
  const groupSelect = h("select", { "aria-label": "Gruppe" }, ...groups.map((g) => h("option", { value: g.id }, g.name)));
  const warning = h("p", { class: "warning hidden" });
  const showWarning = (msg) => { warning.textContent = msg; warning.classList.remove("hidden"); };

  // ---- Bilde eller video ----
  const limits = config.media;
  let attachment = null; // { id, type } når opplastingen er ferdig
  let uploading = false;
  const preview = h("div", { class: "preview hidden" });
  const fileInput = h("input", { type: "file", accept: "image/*,video/*", class: "visually-hidden", id: "fileInput" });
  const attachBtn = h("label", { class: "btn secondary", for: "fileInput" }, "📷 Bilde eller video");

  const clearAttachment = () => {
    attachment = null;
    preview.replaceChildren();
    preview.classList.add("hidden");
    attachBtn.classList.remove("hidden");
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
          return showWarning(`Videoen er for stor (${Math.round(file.size / 1048576)} MB). Maks er ${limits.videoMb} MB. Prøv en kortere video.`);
        }
        const d = await videoDuration(file);
        if (d && d > limits.videoSeconds + 0.5) {
          clearAttachment();
          return showWarning(`Videoen er ${Math.round(d)} sekunder. Maks er ${limits.videoSeconds} sekunder. Du kan klippe den i Bilder-appen ✂️`);
        }
      } else {
        blob = await prepareImage(file);
      }
    } catch (err) {
      clearAttachment();
      return showWarning(err.message);
    }

    const localUrl = URL.createObjectURL(blob);
    const bar = h("progress", { max: 1, value: 0 });
    const media = isVideo
      ? h("video", { src: localUrl, controls: true, playsinline: true, muted: true, preload: "metadata" })
      : h("img", { src: localUrl, alt: "Bildet du har valgt" });
    const remove = h("button", { type: "button", class: "link small", onclick: clearAttachment }, "Fjern");
    preview.replaceChildren(media, h("div", { class: "row" }, bar, remove));
    preview.classList.remove("hidden");
    attachBtn.classList.add("hidden");

    uploading = true;
    send.disabled = true;
    try {
      attachment = await uploadMedia(blob, (p) => (bar.value = p));
      bar.replaceWith(h("span", { class: "muted small" }, isVideo ? "🎬 Video klar" : "📷 Bilde klart"));
    } catch (err) {
      clearAttachment();
      if (err.code === "CLOSED" || err.code === "TIME_UP") return handleChildError(err);
      showWarning(err.message);
    } finally {
      uploading = false;
      send.disabled = false;
    }
  });

  text.addEventListener("input", () => {
    count.textContent = `${text.value.length}/200`;
    warning.classList.add("hidden");
  });

  const send = h("button", { class: "btn", type: "button" }, "Del 💬");
  send.addEventListener("click", async () => {
    if (uploading) return;
    send.disabled = true;
    try {
      const { pending } = await api("/posts", {
        method: "POST",
        body: {
          groupId: Number(groupSelect.value), kind: kindRow.value, text: text.value,
          sticker: stickerRow.value, color: colorRow.value, mediaId: attachment?.id,
        },
      });
      toast(pending ? "Delt! En voksen ser på det før de andre får se det 👀" : "Delt! Takk for at du gjør kanalen fin 💛");
      showChild();
    } catch (err) {
      send.disabled = false;
      if (err.code === "FILTER" || err.status === 400) showWarning(err.message);
      else handleChildError(err);
    }
  });

  return h("section", { class: "card composer" },
    h("h2", {}, "Del noe fint"),
    kindRow,
    text,
    h("div", { class: "row" }, colorRow, count),
    stickerRow,
    fileInput, attachBtn, preview,
    h("div", { class: "row" }, groups.length > 1 ? groupSelect : h("span", { class: "muted" }, `Deles med ${groups[0].name}`), send),
    warning);
}

function postCard(p, { actions } = {}) {
  return h("article", { class: `card post${p.status === "hidden" ? " flagged" : ""}` },
    h("div", { class: "head" },
      h("span", { class: "avatar" }, p.avatar),
      h("div", {},
        h("div", { class: "name" }, p.author),
        h("div", { class: "time" }, `${p.groupName} · ${timeAgo(p.createdAt)}`))),
    h("div", { class: `body c-${p.color}` },
      h("div", { class: "kind" }, config.kinds[p.kind] || ""),
      h("div", {}, p.text),
      p.sticker && h("span", { class: "sticker" }, p.sticker)),
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
    p.media.pending && p.mine && h("p", { class: "pending" },
      `⏳ ${p.media.type === "video" ? "Videoen" : "Bildet"} venter på at en voksen ser på det`));
}

function childActions(p) {
  if (p.mine) {
    return h("button", {
      class: "link small",
      onclick: async () => {
        if (!confirm("Vil du slette innlegget ditt?")) return;
        await api(`/posts/${p.id}`, { method: "DELETE" }).then(showChild, handleChildError);
      },
    }, "Slett");
  }
  return h("button", {
    class: "link small",
    onclick: async () => {
      if (!confirm("Vil du skjule dette innlegget og si fra til en voksen?")) return;
      await api(`/posts/${p.id}/report`, { method: "POST" })
        .then(() => { toast("Takk for at du sa fra! En voksen ser på det 💛"); showChild(); }, handleChildError);
    },
  }, "🚩 Si fra");
}

// ---------- Foresatte ----------
async function showParent() {
  const [{ children }, { groups }] = await Promise.all([api("/children"), api("/groups")]);

  view.replaceChildren(
    h("section", { class: "card" },
      h("h2", {}, "Barna mine"),
      children.length ? null : h("p", { class: "muted" }, "Du har ikke laget noen barnekontoer ennå."),
      ...children.map((c) => childPanel(c, groups)),
      addChildForm()),
    h("section", { class: "card" },
      h("h2", {}, "Grupper"),
      h("p", { class: "muted" }, "Barn ser bare innlegg fra gruppene de er med i. Lag en gruppe for f.eks. klassen og del invitasjonskoden med de andre foresatte."),
      ...groups.map(groupPanel),
      createGroupForm()),
    h("section", { class: "card" },
      h("h2", {}, "Konto"),
      h("button", {
        class: "link danger",
        onclick: async () => {
          if (!confirm("Slette kontoen din? Barnekontoene og alle innleggene deres slettes også. Dette kan ikke angres.")) return;
          await api("/me", { method: "DELETE" });
          start();
        },
      }, "Slett kontoen min og alle data")),
  );
}

function childPanel(c, groups) {
  const num = (name, value, min, max) => h("input", { name, type: "number", value, min, max, required: true });
  const time = (name, value) => h("input", { name, type: "time", value, required: true });

  const settings = h("form", { class: "grid" },
    field("Minutter per dag", num("dailyMinutes", c.dailyMinutes, 0, 120)),
    field("Innlegg per dag", num("postsPerDay", c.postsPerDay, 0, 10)),
    field("Åpen fra", time("openFrom", c.openFrom)),
    field("Åpen til", time("openTo", c.openTo)),
    field("Nytt passord (valgfritt)", h("input", { name: "password", type: "password", autocomplete: "new-password", minlength: 8 })),
    h("button", { class: "btn small" }, "Lagre"));
  settings.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(settings);
    const body = { dailyMinutes: Number(d.dailyMinutes), postsPerDay: Number(d.postsPerDay), openFrom: d.openFrom, openTo: d.openTo };
    if (d.password) body.password = d.password;
    try {
      await api(`/children/${c.id}`, { method: "PATCH", body });
      toast("Lagret ✔");
      showParent();
    } catch (err) { toast(err.message); }
  });

  const join = h("form", { class: "row" },
    h("input", { name: "code", placeholder: "Invitasjonskode", required: true, "aria-label": "Invitasjonskode" }),
    h("button", { class: "btn small" }, "Bli med i gruppe"));
  join.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/groups/join", { method: "POST", body: { code: formData(join).code, childId: c.id } });
      toast(`${c.displayName} er med i gruppa 🎉`);
      showParent();
    } catch (err) { toast(err.message); }
  });

  return h("div", { class: "panel" },
    h("h3", {}, `${c.avatar} ${c.displayName}`, h("span", { class: "muted small" }, ` brukernavn: ${c.username}`)),
    h("p", { class: "muted small" }, `I dag: ${c.dailyMinutes - c.status.minutesLeft} av ${c.dailyMinutes} min brukt · ${c.postsPerDay - c.status.postsLeft} av ${c.postsPerDay} innlegg`),
    h("div", { class: "tags" },
      c.groups.length ? c.groups.map((g) => h("span", { class: "tag" }, g.name,
        h("button", {
          class: "x", "aria-label": `Fjern fra ${g.name}`,
          onclick: async () => {
            if (!confirm(`Ta ${c.displayName} ut av ${g.name}?`)) return;
            await api(`/groups/${g.id}/leave`, { method: "POST", body: { childId: c.id } });
            showParent();
          },
        }, "×"))) : h("span", { class: "muted small" }, "Ikke med i noen gruppe")),
    join,
    h("details", {}, h("summary", {}, "Grenser og passord"), settings,
      h("button", {
        class: "link danger small",
        onclick: async () => {
          if (!confirm(`Slette kontoen til ${c.displayName}? Alle innleggene slettes også.`)) return;
          await api(`/children/${c.id}`, { method: "DELETE" });
          showParent();
        },
      }, "Slett barnekontoen")));
}

function addChildForm() {
  const avatars = choiceRow(config.avatars, (b, a) => (b.textContent = a), config.avatars[0], "choices avatars");
  const form = h("form", {},
    field("Kallenavn barnet vises med (ikke fullt navn)", h("input", { name: "displayName", required: true, maxlength: 20 })),
    field("Brukernavn barnet logger inn med", h("input", { name: "username", required: true, autocomplete: "off" })),
    field("Passord (minst 8 tegn)", h("input", { name: "password", type: "password", required: true, minlength: 8, autocomplete: "new-password" })),
    h("p", {}, "Velg et dyr:"), avatars,
    h("button", { class: "btn" }, "Lag barnekonto"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/children", { method: "POST", body: { ...formData(form), avatar: avatars.value } });
      toast("Barnekonto laget 🎉");
      showParent();
    } catch (err) { toast(err.message); }
  });
  return h("details", { class: "panel" }, h("summary", {}, "➕ Lag en barnekonto"), form);
}

function groupPanel(g) {
  return h("div", { class: "panel" },
    h("h3", {}, g.name,
      g.openReports ? h("span", { class: "badge" }, `${g.openReports} rapportert`) : null,
      g.pendingMedia ? h("span", { class: "badge info" }, `${g.pendingMedia} venter`) : null),
    g.isOwner && reviewToggle(g),
    g.isOwner ? h("p", {}, "Invitasjonskode: ", h("code", {}, g.inviteCode)) : h("p", { class: "muted small" }, "Du er ikke eier av denne gruppa."),
    h("p", { class: "muted small" }, g.members.length ? `Med: ${g.members.map((m) => `${m.avatar} ${m.displayName}`).join(", ")}` : "Ingen medlemmer ennå"),
    h("div", { class: "row" },
      h("button", { class: "btn small", onclick: () => showGroupPosts(g) }, "Se innlegg"),
      g.isOwner && h("button", {
        class: "link danger small",
        onclick: async () => {
          if (!confirm(`Slette gruppa ${g.name} og alle innleggene i den?`)) return;
          await api(`/groups/${g.id}`, { method: "DELETE" });
          showParent();
        },
      }, "Slett gruppa")));
}

function reviewToggle(g) {
  const box = h("input", { type: "checkbox", checked: g.mediaReview });
  box.addEventListener("change", async () => {
    try {
      await api(`/groups/${g.id}`, { method: "PATCH", body: { mediaReview: box.checked } });
      toast(box.checked ? "Bilder og video må nå godkjennes" : "Bilder og video vises med en gang");
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message);
    }
  });
  return h("label", { class: "check small" }, box, " Bilder og video må godkjennes av meg før barna ser dem");
}

function createGroupForm() {
  const form = h("form", { class: "row" },
    h("input", { name: "name", placeholder: "F.eks. Klasse 4B", required: true, maxlength: 40, "aria-label": "Gruppenavn" }),
    h("button", { class: "btn small" }, "Lag gruppe"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { inviteCode } = await api("/groups", { method: "POST", body: formData(form) });
      toast(`Gruppe laget! Kode: ${inviteCode}`);
      showParent();
    } catch (err) { toast(err.message); }
  });
  return form;
}

async function showGroupPosts(g) {
  const { posts, isOwner } = await api(`/groups/${g.id}/posts`);
  const moderate = (p, action) => api(`/posts/${p.id}/moderate`, { method: "POST", body: { action } })
    .then(() => showGroupPosts(g), (err) => toast(err.message));

  const actions = (p) => [
    p.status === "hidden" && h("span", { class: "badge" }, `Rapportert (${p.reports}) – skjult for barna`),
    p.media?.pending && h("span", { class: "badge info" }, "Venter på godkjenning"),
    isOwner && p.media?.pending && p.status === "visible" && h("button", { class: "btn small", onclick: () => moderate(p, "approve") }, "Godkjenn"),
    isOwner && p.status === "hidden" && h("button", { class: "btn small", onclick: () => moderate(p, "restore") }, "Vis igjen"),
    isOwner && h("button", { class: "link danger small", onclick: () => confirm("Fjerne innlegget?") && moderate(p, "remove") }, "Fjern"),
    !isOwner && p.byMyChild && h("button", {
      class: "link danger small",
      onclick: () => confirm("Slette innlegget?") && api(`/posts/${p.id}`, { method: "DELETE" }).then(() => showGroupPosts(g)),
    }, "Slett"),
  ];

  view.replaceChildren(
    h("p", {}, h("button", { class: "link", onclick: showParent }, "← Tilbake")),
    h("h2", {}, g.name),
    posts.length ? null : h("div", { class: "card muted" }, "Ingen innlegg ennå."),
    ...posts.map((p) => postCard(p, { actions })));
}

start();
