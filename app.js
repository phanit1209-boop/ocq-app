// Ortho Clinic Queue V5 – Stage 1 web app (residents, instructors, admin view).
// Security model: the browser only calls checked database functions; identity comes from the
// LINE-authenticated Supabase session. All text from the server is rendered with textContent.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";

const C = window.OCQ_CONFIG;
const sb = createClient(C.supabaseUrl, C.publishableKey, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: "ocq-v5-auth" },
});

const $ = (id) => document.getElementById(id);
const PENDING_KEY = "ocq-v5-pending-join";
const state = { profile: null, overview: [], session: null, tab: "mine", viewing: null, queues: new Map(), channels: new Map(), busy: false };

const MESSAGES = {
  clinic_closed: "Registration is closed now (outside clinic session hours).",
  already_in_queue: "You are already waiting in this instructor's queue.",
  invalid_dental_unit: "Dental unit must be a number from 1 to 999.",
  invalid_urgent_reason: "An urgent request needs a short reason (up to 200 characters).",
  normal_request_has_urgent_reason: "A normal request should not have an urgent reason.",
  resource_unavailable: "This instructor's queue is not available.",
  instructor_unavailable: "This instructor is not available.",
  resource_not_found: "This queue no longer exists.",
  request_conflict: "This request was already sent with different details. Please try again.",
  not_first_in_queue: "Start the first waiting resident, or use “Take urgent first” for an urgent case.",
  check_already_in_progress: "Finish the current check first.",
  entry_not_waiting: "This entry is no longer waiting.",
  entry_not_in_progress: "This entry is not being checked.",
  entry_not_urgent: "Only urgent entries can be taken first.",
  session_ended: "This clinic session has ended.",
  confirmation_required: "Please confirm first.",
  unauthorized: "Your account is not on the clinic roster.",
  resident_role_required: "Only residents can join a queue.",
  instructor_role_required: "Only instructors can do this.",
  not_assigned_instructor: "Only the assigned instructor can do this.",
  queue_entry_not_found: "This entry was not found.",
  invalid_display_name: "Names must be 1–40 characters, without < or > symbols.",
};

// ---------- small helpers ----------
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const initials = (name) => String(name || "?").replace(/^(dr\.?|ทพ\.?|ทพญ\.?|อ\.)\s*/i, "").trim().slice(0, 1).toUpperCase() || "?";
const hueOf = (name) => [...String(name || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "");
function friendly(error) {
  const m = String(error?.message || error || "");
  return MESSAGES[m] || (isNetworkError(error) ? "Connection problem. Please check your internet and try again." : "Something went wrong: " + m);
}
function isNetworkError(error) {
  const m = String(error?.message || "");
  return !error?.code || /fetch|network|timeout|Load failed/i.test(m);
}
let bannerTimer;
function banner(text, kind = "") {
  const b = $("banner");
  b.textContent = text; b.className = "banner " + kind; b.classList.toggle("hidden", !text);
  clearTimeout(bannerTimer);
  if (text && kind !== "error") bannerTimer = setTimeout(() => b.classList.add("hidden"), 5000);
}
function askConfirm(text) {
  return new Promise((resolve) => {
    const d = $("confirmDialog");
    $("confirmText").textContent = text;
    d.onclose = () => resolve(d.returnValue === "ok");
    d.showModal();
  });
}
function show(view) {
  for (const id of ["signInView", "notRosteredView", "mainView"]) $(id).classList.toggle("hidden", id !== view);
  $("signOutBtn").classList.toggle("hidden", view === "signInView");
}

// ---------- data ----------
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
async function loadOverview() { state.overview = (await rpc("get_instructor_overview")) || []; }
async function loadSession() { const rows = (await rpc("get_current_clinic_session")) || []; state.session = rows[0] || null; }
async function loadQueue(resourceId) { state.queues.set(resourceId, (await rpc("get_queue", { p_resource_id: resourceId })) || []); }

function relevantResources() {
  const ids = new Set();
  for (const r of state.overview) if (r.is_my_resource || r.my_queue_entry_id) ids.add(r.resource_id);
  if (state.viewing) ids.add(state.viewing);
  return ids;
}
async function refreshAll() {
  try {
    await Promise.all([loadOverview(), loadSession()]);
    await Promise.all([...relevantResources()].map(loadQueue));
    syncChannels();
    render();
  } catch (e) { banner(friendly(e), "error"); }
}
const pendingRefresh = new Map();
function refreshQueueSoon(resourceId) {           // debounce bursts of live signals
  clearTimeout(pendingRefresh.get(resourceId));
  pendingRefresh.set(resourceId, setTimeout(async () => {
    try { await Promise.all([loadQueue(resourceId), loadOverview()]); render(); } catch (e) { banner(friendly(e), "error"); }
  }, 250));
}

// ---------- live updates (private, signal-only channels) ----------
function syncChannels() {
  const wanted = relevantResources();
  for (const [id, ch] of state.channels) if (!wanted.has(id)) { sb.removeChannel(ch); state.channels.delete(id); }
  for (const id of wanted) {
    if (state.channels.has(id)) continue;
    const ch = sb.channel(`queue:${id}`, { config: { private: true } })
      .on("broadcast", { event: "queue_changed" }, () => refreshQueueSoon(id))
      .subscribe((status) => { if (status === "SUBSCRIBED") refreshQueueSoon(id); });
    state.channels.set(id, ch);
  }
}

// ---------- actions ----------
async function joinQueue(resourceId, unit, priority, reason) {
  const payload = { resourceId, unit, priority, reason: priority === "urgent" ? reason.trim() : null };
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch { pending = null; }
  if (!pending || JSON.stringify(pending.payload) !== JSON.stringify(payload)) pending = { requestId: uuid(), payload };
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* private mode: retry still works in memory */ }
  return sendPendingJoin(pending);
}
async function sendPendingJoin(pending) {
  const p = pending.payload;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await sb.rpc("join_queue", {
      p_request_id: pending.requestId, p_resource_id: p.resourceId, p_dental_unit: p.unit,
      p_priority: p.priority, p_urgent_reason: p.reason,
    });
    if (!error) { try { localStorage.removeItem(PENDING_KEY); } catch {} return data; }
    if (!isNetworkError(error)) { try { localStorage.removeItem(PENDING_KEY); } catch {} throw error; }
    if (attempt < 3) await sleep(700 * attempt);
    else throw error;                                // keep the pending request for the next visit
  }
}
async function recoverPendingJoin() {
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch {}
  if (!pending) return;
  banner("Confirming your earlier queue request…");
  try {
    const r = await sendPendingJoin(pending);
    banner(`Confirmed: you are number ${r.queue_number} in that queue.`, "ok");
  } catch (e) { banner(friendly(e), "error"); }
}
async function act(fn, okText) {
  if (state.busy) return;
  state.busy = true; render();
  try { await fn(); if (okText) banner(okText, "ok"); }
  catch (e) { banner(friendly(e), "error"); }
  finally { state.busy = false; await refreshAll(); }
}

// ---------- rendering ----------
function render() {
  const p = state.profile;
  if (!p) return;
  $("whoLine").replaceChildren(el("span", { text: p.display_name }),
    el("button", { class: "edit", type: "button", onclick: editName }, "Edit name"));
  const roleLabel = { resident: "Resident", instructor: "Instructor", admin: "Admin", technician: "Technician" }[p.role] || p.role;
  $("sessionLine").textContent = `${roleLabel} · ` + (state.session
    ? `Registration open until ${String(state.session.end_time).slice(0, 5)}`
    : "Registration closed (08:45–12:00 · 12:45–16:00)");
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab && !state.viewing));
  $("mineTab").classList.toggle("hidden", state.tab !== "mine" || !!state.viewing);
  $("allTab").classList.toggle("hidden", state.tab !== "all" || !!state.viewing);
  $("queueTab").classList.toggle("hidden", !state.viewing);
  if (state.viewing) renderQueueView(state.viewing);
  else if (state.tab === "mine") renderMine();
  else renderAll();
}

function renderMine() {
  const box = $("mineTab"); box.replaceChildren();
  const p = state.profile;
  if (p.role === "instructor") {
    const mine = state.overview.find((r) => r.is_my_resource);
    if (!mine) { box.append(el("p", { class: "empty", text: "No queue is assigned to your account yet." })); return; }
    box.append(renderQueueBlock(mine));
    return;
  }
  if (p.role !== "resident") {
    box.append(el("p", { class: "empty", text: "Use the Instructors tab to view any queue." }));
    return;
  }
  const active = state.overview.filter((r) => r.my_queue_entry_id);
  if (!active.length) {
    box.append(el("div", { class: "card" }, el("p", { text: "You are not waiting in any queue." }),
      el("button", { class: "primary", type: "button", onclick: () => { state.tab = "all"; render(); } }, "Choose an instructor")));
    return;
  }
  for (const r of active) {
    const status = r.my_status === "in_progress" ? "Being checked now" : `You are number ${r.my_waiting_position} in line`;
    box.append(el("div", { class: "card" },
      el("div", { class: "name", text: r.resource_name }),
      el("div", { class: "big-number", text: r.my_status === "in_progress" ? "Now" : `#${r.my_waiting_position}` }),
      el("div", { class: "meta", text: status }),
      el("div", { class: "row" },
        el("button", { class: "ghost", type: "button", onclick: () => openQueue(r.resource_id) }, "View queue"),
        r.my_status === "waiting" ? el("button", { class: "danger", type: "button", disabled: state.busy,
          onclick: async () => { if (await askConfirm(`Leave ${r.resource_name}'s queue?`)) act(() => rpc("cancel_my_entry", { p_queue_entry_id: r.my_queue_entry_id }), "You have left the queue."); } }, "Leave queue") : null)));
  }
}

function renderAll() {
  const box = $("allTab"); box.replaceChildren();
  if (!state.overview.length) { box.append(el("p", { class: "empty", text: "No instructors are available." })); return; }
  const list = el("ul", { class: "list" });
  for (const r of state.overview) {
    const load = r.waiting_count === 0 ? "free" : r.waiting_count <= 2 ? "low" : r.waiting_count <= 4 ? "mid" : "high";
    list.append(el("li", { class: "item" + (r.my_queue_entry_id ? " mine" : ""), onclick: () => openQueue(r.resource_id), role: "button", tabindex: "0" },
      el("div", { class: "avatar", style: `--h:${hueOf(r.resource_name)}`, text: initials(r.resource_name) }),
      el("div", { class: "main" },
        el("div", { class: "name" }, r.resource_name, r.has_check_in_progress ? el("span", { class: "badge progress", text: "checking" }) : null,
          r.resource_status !== "available" ? el("span", { class: "badge urgent", text: "unavailable" }) : null),
        el("div", { class: "meta", text: r.my_queue_entry_id
          ? (r.my_status === "in_progress" ? "You are being checked now" : `You are #${r.my_waiting_position} in line`)
          : (r.has_check_in_progress ? "Checking a resident now" : "Tap to see the queue") })),
      el("div", { class: "count", "data-load": load }, el("b", { text: String(r.waiting_count) }), "waiting")));
  }
  box.append(list);
}

function openQueue(resourceId) { state.viewing = resourceId; syncChannels(); loadQueue(resourceId).then(render).catch((e) => banner(friendly(e), "error")); render(); }

// The queue view is split into a list (redrawn on every live update) and a join form that is
// built once per visit and only has its enabled/disabled state updated, so typing is never lost.
let joinForm = null;
function renderQueueView(resourceId) {
  const box = $("queueTab");
  if (box.dataset.rid !== resourceId) {
    box.dataset.rid = resourceId; joinForm = null;
    box.replaceChildren(
      el("div", { class: "row" }, el("button", { class: "ghost small", type: "button",
        onclick: () => { state.viewing = null; box.dataset.rid = ""; joinForm = null; syncChannels(); render(); } }, "‹ Back")),
      el("div", { id: "queueBlock" }), el("div", { id: "joinBox" }));
  }
  const r = state.overview.find((x) => x.resource_id === resourceId);
  if (!r) { $("queueBlock").replaceChildren(el("p", { class: "empty", text: "Queue not found." })); return; }
  $("queueBlock").replaceChildren(renderQueueBlock(r));
  const wantsForm = state.profile.role === "resident" && !r.my_queue_entry_id;
  if (!wantsForm) { if (joinForm) { $("joinBox").replaceChildren(); joinForm = null; } return; }
  if (!joinForm) { joinForm = renderJoinForm(r); $("joinBox").replaceChildren(joinForm); }
  updateJoinForm(r);
}
function joinOpen(r) { return !!state.session && r.resource_status !== "out_of_service"; }
function updateJoinForm(r) {
  if (!joinForm) return;
  const open = joinOpen(r);
  joinForm.querySelector("button[type=submit]").disabled = !open || state.busy;
  const w = joinForm.querySelector(".closedNote");
  w.textContent = open ? "" : (state.session ? "This queue is not available." : "Registration is closed now.");
  w.classList.toggle("hidden", open);
}

function renderQueueBlock(r) {
  const rows = state.queues.get(r.resource_id) || [];
  const isOwner = r.is_my_resource && state.profile.role === "instructor";
  const wrap = el("div", { class: "card" }, el("h2", { text: r.resource_name }),
    el("div", { class: "meta", text: `${r.waiting_count} waiting` + (r.has_check_in_progress ? " · 1 being checked" : "") }));
  if (!rows.length) { wrap.append(el("p", { class: "empty", text: "Nobody is waiting." })); return wrap; }
  const inProgress = rows.find((q) => q.status === "in_progress");
  const firstWaiting = rows.find((q) => q.status === "waiting");
  const list = el("ul", { class: "list" });
  for (const q of rows) {
    const actions = [];
    if (isOwner && q.status === "in_progress") {
      actions.push(el("button", { class: "primary small", type: "button", disabled: state.busy,
        onclick: () => act(() => rpc("complete_check", { p_queue_entry_id: q.queue_entry_id }), "Check completed.") }, "Complete"));
    }
    if (isOwner && !inProgress && q.status === "waiting" && q === firstWaiting) {
      actions.push(el("button", { class: "primary small", type: "button", disabled: state.busy,
        onclick: () => act(() => rpc("start_check", { p_queue_entry_id: q.queue_entry_id }), "Check started.") }, "Start"));
    }
    if (isOwner && !inProgress && q.status === "waiting" && q !== firstWaiting && q.priority === "urgent") {
      actions.push(el("button", { class: "danger small", type: "button", disabled: state.busy,
        onclick: async () => {
          if (await askConfirm(`Take ${q.display_name} (urgent) before the ${q.waiting_position - 1} resident(s) ahead? This is recorded.`)) {
            act(() => rpc("start_urgent_override", { p_queue_entry_id: q.queue_entry_id, p_confirmed: true }), "Urgent case started.");
          }
        } }, "Take urgent first"));
    }
    const meta = [q.status === "in_progress" ? `being checked since ${timeOf(q.started_at)}` : `joined ${timeOf(q.joined_at)}`];
    if (q.dental_unit) meta.push(`unit ${q.dental_unit}`);
    list.append(el("li", { class: "item" + (q.is_mine ? " mine" : "") + (q.status === "in_progress" ? " progress" : "") },
      el("div", { class: "pos", text: q.status === "in_progress" ? "▶" : String(q.waiting_position) }),
      el("div", { class: "main" },
        el("div", { class: "name" }, q.display_name, q.is_mine ? " (you)" : "",
          q.priority === "urgent" ? el("span", { class: "badge urgent", text: "Urgent" }) : null),
        el("div", { class: "meta", text: meta.join(" · ") }),
        q.urgent_reason ? el("div", { class: "reason", text: "Reason: " + q.urgent_reason }) : null),
      actions.length ? el("div", { class: "row" }, actions) : null));
  }
  wrap.append(list, el("div", { class: "live", text: state.channels.has(r.resource_id) ? "Live updates on" : "" }));
  return wrap;
}

function renderJoinForm(r) {
  const open = joinOpen(r);
  const unit = el("input", { type: "number", min: "1", max: "999", inputmode: "numeric", id: "unitInput", required: true });
  const prio = el("select", { id: "prioInput" }, el("option", { value: "normal", text: "Normal" }), el("option", { value: "urgent", text: "Urgent" }));
  const reason = el("textarea", { id: "reasonInput", maxlength: "200", placeholder: "Short reason (no patient names or hospital numbers)" });
  const reasonBox = el("div", { class: "hidden" }, el("label", { for: "reasonInput", text: "Urgent reason" }), reason,
    el("div", { class: "warn", text: "Do not enter patient names, HN or other identifying details." }));
  prio.addEventListener("change", () => reasonBox.classList.toggle("hidden", prio.value !== "urgent"));
  const submit = el("button", { class: "primary", type: "submit", disabled: !open || state.busy }, "Join queue");
  const form = el("form", { class: "card" },
    el("h2", { text: `Join ${r.resource_name}'s queue` }),
    el("p", { class: "warn closedNote" + (open ? " hidden" : ""), text: open ? "" : (state.session ? "This queue is not available." : "Registration is closed now.") }),
    el("label", { for: "unitInput", text: "Dental unit (1–999)" }), unit,
    el("label", { for: "prioInput", text: "Priority" }), prio, reasonBox, el("div", { class: "row end" }, submit));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const n = Number(unit.value);
    if (!Number.isInteger(n) || n < 1 || n > 999) { banner(MESSAGES.invalid_dental_unit, "error"); return; }
    if (prio.value === "urgent" && (!reason.value.trim() || reason.value.trim().length > 200)) { banner(MESSAGES.invalid_urgent_reason, "error"); return; }
    act(async () => {
      const res = await joinQueue(r.resource_id, n, prio.value, reason.value);
      banner(res.recovered ? `Already registered: you are number ${res.queue_number}.` : `Joined: you are number ${res.queue_number}.`, "ok");
    });
  });
  return form;
}

async function editName() {
  const d = $("nameDialog"), input = $("nameInput");
  input.value = state.profile.display_name;
  d.showModal(); input.focus();
  const result = await new Promise((resolve) => { d.onclose = () => resolve(d.returnValue); });
  if (result !== "ok") return;
  const name = input.value.replace(/\s+/g, " ").trim();
  if (!name || name.length > 40 || /[<>]/.test(name)) { banner(MESSAGES.invalid_display_name, "error"); return; }
  await act(async () => {
    const r = await rpc("set_my_display_name", { p_display_name: name });
    state.profile.display_name = r.display_name;
  }, "Name updated.");
}

// ---------- start-up ----------
async function start() {
  $("envLabel").textContent = C.environmentLabel || "";
  $("tabScanners").classList.toggle("hidden", !C.features?.scanners);
  $("tabPrinters").classList.toggle("hidden", !C.features?.printers);
  $("lineLoginBtn").onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: C.lineProvider, options: { redirectTo: location.origin + location.pathname } });
    if (error) banner(friendly(error), "error");
  };
  $("signOutBtn").onclick = async () => { await sb.removeAllChannels(); await sb.auth.signOut(); location.reload(); };
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => { state.tab = b.dataset.tab; state.viewing = null; syncChannels(); render(); refreshAll(); };

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show("signInView"); return; }
  await sb.realtime.setAuth(session.access_token);
  sb.auth.onAuthStateChange((event, s) => { if (s && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) sb.realtime.setAuth(s.access_token); });

  let profile = [];
  try { profile = (await rpc("get_my_profile")) || []; } catch (e) { banner(friendly(e), "error"); }
  if (!profile.length) { show("notRosteredView"); return; }
  state.profile = profile[0];
  if (state.profile.role === "admin") state.tab = "all";
  show("mainView");
  await recoverPendingJoin();
  await refreshAll();

  // Safety net: slow refresh while visible; immediate refresh when the app comes back.
  setInterval(() => { if (document.visibilityState === "visible") refreshAll(); }, (C.safetyRefreshSeconds || 60) * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAll(); });
  window.addEventListener("online", () => { recoverPendingJoin().then(refreshAll); });
}
start().catch((e) => banner(friendly(e), "error"));
