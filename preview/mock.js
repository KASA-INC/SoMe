// Forhåndsvisning uten server: svarer på appens kall til /api med eksempeldata fra preview/fixtures.json
// (laget av den ekte serveren med preview/capture.mjs). Endringer lever bare i minnet til siden lastes på nytt.
// Lastes før app.js i forhåndsvisningen, aldri i den ekte appen.
(() => {
  const FIX = window.__QUIPU_FIXTURES__;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // Flytt alle tider så eksemplene ser ferske ut.
  const shift = Date.now() - FIX.capturedAt - 5 * 60000;
  const rebase = (x) => {
    if (Array.isArray(x)) x.forEach(rebase);
    else if (x && typeof x === "object") for (const k of Object.keys(x)) k === "createdAt" && typeof x[k] === "number" ? (x[k] += shift) : rebase(x[k]);
    return x;
  };
  const child = rebase(clone(FIX.child));
  const parent = rebase(clone(FIX.parent));
  const media = new Map(); // id -> { url, type }
  let nextId = 1000;
  let session = null;
  try { session = sessionStorage.getItem("quipu-preview-session"); } catch { /* ingen lagring */ }
  const setSession = (s) => {
    session = s;
    try { s ? sessionStorage.setItem("quipu-preview-session", s) : sessionStorage.removeItem("quipu-preview-session"); } catch { /* ingen lagring */ }
  };

  class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
  const fail = (status, message, code) => { throw new HttpError(status, message, code); };
  const ok = { ok: true };

  const childPost = (body) => {
    const me = child["/me"].me;
    const status = me.status;
    if (status.postsLeft <= 0) fail(429, "Du har delt det du kan i dag. Du kan dele mer i morgen.", "POST_LIMIT");
    const text = String(body.text || "").trim();
    if (text.length < 2 || text.length > 200) fail(400, "Innlegget må ha 2–200 tegn");
    const group = me.groups.find((g) => g.id === Number(body.groupId)) || me.groups[0];
    const m = body.mediaId ? media.get(String(body.mediaId)) : null;
    const post = {
      id: nextId++, kind: body.kind || "", text, sticker: body.sticker || "", color: "lilla", createdAt: Date.now(),
      author: me.displayName, avatar: me.avatar, groupId: group.id, groupName: group.name, mine: true,
      media: m ? { id: String(body.mediaId), type: m.type, pending: false } : null,
    };
    child["/feed"].posts.unshift(post);
    const gp = parent[`/groups/${group.id}/posts`];
    if (gp) gp.posts.unshift({ ...post, mine: undefined, status: "visible", reports: 0, byMyChild: true });
    status.postsLeft--; status.postsToday++;
    return { ok: true, pending: false };
  };

  function route(method, path, body) {
    const [p] = path.split("?");
    if (p === "/signup-info") return FIX.signupInfo;
    if (p === "/login" && method === "POST") {
      setSession(String(body.login || body.username || "").includes("@") ? "parent" : "child");
      return ok;
    }
    if (p === "/register" && method === "POST") { setSession("parent"); return ok; }
    if (p === "/logout") { setSession(null); return ok; }
    if (p.startsWith("/password/") || p === "/email/verify") return ok;
    if (/^\/invites\/[0-9a-f]{64}$/.test(p)) return { inviter: "Kristin", email: "", group: null };
    if (!session) fail(401, "Du må logge inn");

    if (session === "child") {
      const me = child["/me"].me;
      if (method === "GET" && p === "/me") return child["/me"];
      if (method === "GET" && p === "/feed") return { ...child["/feed"], status: me.status };
      if (p === "/feed/new") return { count: 0 };
      if (p === "/heartbeat") return { status: me.status };
      if (p === "/onboarded") { me.onboarded = true; return ok; }
      if (p === "/me/avatar") {
        me.avatar = body.avatar;
        for (const post of child["/feed"].posts) if (post.mine) post.avatar = body.avatar;
        return ok;
      }
      if (p === "/posts" && method === "POST") return childPost(body);
      const del = p.match(/^\/posts\/(\d+)(\/report)?$/);
      if (del) { child["/feed"].posts = child["/feed"].posts.filter((x) => x.id !== Number(del[1])); return ok; }
      fail(404, "Finnes ikke i forhåndsvisningen");
    }

    // Foresatt
    let m;
    if (method === "GET" && p === "/admin/users") {
      const term = (new URLSearchParams(path.split("?")[1]).get("q") || "").toLowerCase();
      return { users: parent["/admin/users"].users.filter((u) => `${u.displayName} ${u.username} ${u.email}`.toLowerCase().includes(term)) };
    }
    if ((m = p.match(/^\/admin\/users\/(\d+)\/(suspend|unsuspend)$/))) {
      const u = parent["/admin/users"].users.find((x) => x.id === Number(m[1]));
      if (u) Object.assign(u, { suspended: m[2] === "suspend", suspendedReason: body.reason || "" });
      parent["/admin/log"].log.unshift({ action: m[2] === "suspend" ? "stengte" : "åpnet", target: u?.displayName || "", detail: body.reason || "", createdAt: Date.now(), admin: "Kristin" });
      return m[2] === "suspend" ? { ok: true, alsoSuspended: [] } : { ok: true, alsoOpened: [] };
    }
    if ((m = p.match(/^\/admin\/posts\/(\d+)$/))) {
      parent["/admin/reports"].posts = parent["/admin/reports"].posts.filter((x) => x.id !== Number(m[1]));
      return ok;
    }
    if (method === "GET" && parent[p]) return parent[p];
    if (/^\/groups\/\d+\/(posts|adult)\/new$/.test(p)) return { count: 0 };
    if ((m = p.match(/^\/groups\/(\d+)\/adult$/)) && method === "POST") {
      const me = parent["/me"].me;
      const img = body.mediaId ? String(body.mediaId) : null;
      parent[p].messages.unshift({ id: nextId++, text: String(body.text || "").trim(), createdAt: Date.now(), author: me.displayName, avatar: me.avatar, mine: true, imageId: img, canDelete: true });
      return ok;
    }
    if ((m = p.match(/^\/adult\/(\d+)$/)) && method === "DELETE") {
      for (const k of Object.keys(parent)) if (k.endsWith("/adult")) parent[k].messages = parent[k].messages.filter((x) => x.id !== Number(m[1]));
      return ok;
    }
    if ((m = p.match(/^\/groups\/(\d+)\/members\/(\d+)$/))) {
      const g = parent["/groups"].groups.find((x) => x.id === Number(m[1]));
      const who = g?.pendingMembers?.find((x) => x.id === Number(m[2]));
      if (g && who) {
        g.pendingMembers = g.pendingMembers.filter((x) => x !== who);
        if (body.action === "approve") g.members = [...g.members, { displayName: who.displayName, avatar: who.avatar }].sort((a, b) => a.displayName.localeCompare(b.displayName));
      }
      return ok;
    }
    if ((m = p.match(/^\/groups\/(\d+)$/)) && method === "PATCH") {
      const g = parent["/groups"].groups.find((x) => x.id === Number(m[1]));
      if (g && "mediaReview" in body) g.mediaReview = body.mediaReview;
      return ok;
    }
    if ((m = p.match(/^\/posts\/(\d+)(\/moderate)?$/))) {
      for (const k of Object.keys(parent)) if (/^\/groups\/\d+\/posts$/.test(k)) {
        parent[k].posts = m[2] && body.action !== "remove"
          ? parent[k].posts.map((x) => (x.id === Number(m[1]) ? { ...x, status: "visible", reports: 0 } : x))
          : parent[k].posts.filter((x) => x.id !== Number(m[1]));
      }
      return ok;
    }
    if ((m = p.match(/^\/children\/(\d+)$/)) && method === "PATCH") {
      const c = parent["/children"].children.find((x) => x.id === Number(m[1]));
      if (c) Object.assign(c, body);
      return ok;
    }
    if (p === "/notify" && method === "PATCH") { Object.assign(parent["/notify"], body); return ok; }
    if (p === "/me" && method === "PATCH") {
      if (body.displayName) parent["/me"].me.displayName = body.displayName;
      return ok;
    }
    if ((m = p.match(/^\/children\/(\d+)\/share$/))) {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      return { url: `https://www.quipu.no/#barn=${token}`, status: body.email ? "sent" : null };
    }
    if (p === "/invites" && method === "POST") {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      const url = `https://www.quipu.no/#invitasjon=${token}`;
      const emails = body.emails || [];
      // Ingen e-post sendes fra forhåndsvisningen.
      return emails.length ? { results: emails.map((email) => ({ email, status: "sent" })) } : { url, results: [] };
    }
    if (p.startsWith("/push/")) fail(400, "Push-varsler virker ikke i forhåndsvisningen");
    return ok;
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/api/")) return realFetch(input, init);
    const method = (init.method || "GET").toUpperCase();
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* ikke JSON */ }
    await new Promise((r) => setTimeout(r, 120)); // som et raskt nett
    try {
      const data = route(method, url.slice(4), body);
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      return new Response(JSON.stringify({ error: err.message, code: err.code }), { status: err.status || 500, headers: { "Content-Type": "application/json" } });
    }
  };

  // Opplasting av bilder og video: lagres som blob-URL i minnet.
  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends RealXHR {
    open(method, url, ...rest) { this._mock = url === "/api/media"; if (!this._mock) super.open(method, url, ...rest); }
    setRequestHeader(...a) { if (!this._mock) super.setRequestHeader(...a); }
    get upload() { return this._mock ? (this._up ||= {}) : super.upload; }
    get status() { return this._mock ? this._status : super.status; }
    get responseText() { return this._mock ? this._text : super.responseText; }
    send(blob) {
      if (!this._mock) return super.send(blob);
      const id = String(nextId++);
      const type = (blob?.type || "").startsWith("video/") ? "video" : "image";
      media.set(id, { url: URL.createObjectURL(blob), type });
      let n = 0;
      const tick = () => {
        n += 0.25;
        this._up?.onprogress?.({ lengthComputable: true, loaded: n, total: 1 });
        if (n < 1) return setTimeout(tick, 80);
        this._status = 201; this._text = JSON.stringify({ id, type });
        this.onload?.();
      };
      setTimeout(tick, 80);
    }
  };

  // Bilder fra /api/media/<id> peker på blob-URL-ene over.
  const fixSrc = (el) => {
    const m = (el.getAttribute("src") || "").match(/^\/api\/media\/(\w+)$/);
    if (m && media.has(m[1])) el.src = media.get(m[1]).url;
  };
  new MutationObserver((list) => {
    for (const r of list) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches("img, video")) fixSrc(n);
      n.querySelectorAll?.("img, video").forEach(fixSrc);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Visningen i Claude viser ikke confirm()-dialoger. Her sier vi ja, så knappene virker.
  window.confirm = () => true;

  // Liten linje nederst for å bytte mellom barn og foresatt. Finnes bare i forhåndsvisningen.
  window.__quipuPreview = {
    as(who) { setSession(who); location.hash = ""; window.__quipuRestart?.(); },
  };
})();
