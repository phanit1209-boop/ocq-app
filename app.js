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
const state = { profile: null, overview: [], session: null, tab: "mine", viewing: null, queues: new Map(), channels: new Map(), busy: false,
  machines: [], mqueues: new Map(), mfaults: new Map(), viewingMachine: null, board: null, adminMachines: [],
  instFilter: "all", people: [], editingPerson: null, schedule: null };
const scannersOn = () => !!C.features?.scanners;
const printersOn = () => !!C.features?.printers;
const isAdmin = () => !!state.profile && (state.profile.is_admin === true || state.profile.role === "admin");
const isStaff = () => isAdmin() || state.profile?.role === "technician";

const MESSAGES = {
  invalid_role: "Choose Resident or Instructor.",
  invalid_purpose: "'What for' must be 100 characters or fewer, without < or >.",
  invalid_email: "That email address doesn't look right.",
  email_required_for_summary: "Add an email address to receive the summary.",
  invalid_summary_frequency: "Choose Off, Weekly or Monthly.",
  invalid_summary_scope: "Choose what the summary should include.",
  invalid_status: "Choose a status.",
  invalid_holiday: "Choose a date and a name (up to 60 characters, no < or >).",
  invalid_days_off: "Check the dates: from today onwards, end on or after the start, at most 120 days.",
  too_many_days_off: "That's a lot of planned days off already. Remove some old ones first.",
  day_off_not_found: "That day off was already removed.",
  invalid_status_time: "Choose a time later than now.",
  no_session_left_today: "There are no more clinic sessions today.",
  invalid_instructor_kind: "Choose Internal or External.",
  instructor_queue_not_empty: "Your queue still has people in it. Finish or wait for it to empty first.",
  leave_queues_first: "Leave the instructor queues you are waiting in first.",
  last_admin: "You are the only admin. Make someone else admin first.",
  cannot_disable_self: "You can't disable your own account.",
  account_disabled: "This account has been disabled by an admin.",
  already_set_up: "This account is already set up. Reload the page.",
  invalid_schedule: "That clinic schedule isn't valid.",
  user_not_found: "That account no longer exists.",
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
  invalid_print_time: "Print time must be between 1 minute and 48 hours.",
  invalid_print_outcome: "Please say whether the print came out OK.",
  invalid_failure_reason: "Please choose what went wrong.",
  not_ready: "Tap “I'm ready” first, when you are at the machine.",
  not_your_turn: "Someone ahead of you is ready. Please wait for your turn.",
  machine_in_use: "The machine is in use. Wait for the current person to finish.",
  unsupported_resource_type: "This action is not available for this queue.",
  invalid_fault_category: "Please choose what is wrong.",
  invalid_fault_note: "The note can be up to 300 characters.",
  already_reported: "You already reported a problem on this machine. It is being looked at.",
  report_not_open: "This report is already closed.",
  own_report: "This is your own report.",
  note_required: "Please add a short note (up to 300 characters).",
  technician_role_required: "Only technicians and admins can do this.",
  admin_role_required: "Only admins can do this.",
  invalid_machine_code: "Machine codes use letters, numbers, - or _ (up to 20).",
  invalid_machine_name: "Machine names must be 1–40 characters, without < or >.",
  machine_code_taken: "That machine code is already used.",
  machine_has_active_entries: "People are still queued for this machine. Mark it 'Do not use' and wait until the queue is empty.",
  entry_not_waiting_machine: "This entry is no longer waiting.",
};
const FAULT_LABEL = { will_not_start: "Will not start", quality: "Scan or print quality", software_connection: "Software or connection",
  physical_damage: "Physical damage", other: "Other" };
const STATUS_LABEL = { available: "Available", issue_reported: "Problem reported", out_of_service: "Do not use" };

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
  for (const id of ["signInView", "setupView", "mainView"]) $(id).classList.toggle("hidden", id !== view);
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

async function loadMachines() {
  if (!machineTabsForMe()) { state.machines = []; return; }   // plain instructors: no machine data needed
  const [sc, pr] = await Promise.all([
    scannersOn() ? rpc("get_machine_overview", { p_resource_type: "scanner" }) : [],
    printersOn() ? rpc("get_machine_overview", { p_resource_type: "printer" }) : []]);
  state.machines = [...(sc || []).map((m) => ({ resource_type: "scanner", ...m })), ...(pr || []).map((m) => ({ resource_type: "printer", ...m }))];
  checkPrintReminders();
}
const isPrinter = (m) => m.resource_type === "printer";
const kindWord = (m) => (isPrinter(m) ? "printer" : "scanner");
async function loadMachineQueue(id) { state.mqueues.set(id, (await rpc("get_machine_queue", { p_resource_id: id })) || []); }
async function loadMachineFaults(id) { state.mfaults.set(id, (await rpc("get_machine_faults", { p_resource_id: id })) || []); }
async function loadBoard() { state.board = isStaff() ? await rpc("get_fault_board") : null; }
async function loadAdminMachines() { state.adminMachines = isAdmin() ? ((await rpc("admin_list_machines")) || []) : []; }
async function loadPeople() { state.people = isAdmin() ? ((await rpc("admin_list_users")) || []) : []; }
const isMachine = (id) => state.machines.some((m) => m.resource_id === id);

function relevantResources() {
  const ids = new Set();
  for (const r of state.overview) if (r.is_my_resource || r.my_queue_entry_id) ids.add(r.resource_id);
  if (state.viewing) ids.add(state.viewing);
  for (const m of state.machines) if (m.my_queue_entry_id) ids.add(m.resource_id);
  if (state.viewingMachine) ids.add(state.viewingMachine);
  return ids;
}
const machineIds = () => [...relevantResources()].filter(isMachine);
const instructorIds = () => [...relevantResources()].filter((id) => !isMachine(id));
let lastPresence = 0;
function touchPresence() {          // "I have the app open" — used to decide whether to send a LINE message
  if (document.visibilityState !== "visible" || Date.now() - lastPresence < 45000) return;
  lastPresence = Date.now();
  sb.rpc("touch_presence").then(({ error }) => { if (error) lastPresence = 0; });
}
async function refreshAll() {
  touchPresence();
  try {
    await Promise.all([loadOverview(), loadSession(), loadMachines()]);
    await Promise.all([...instructorIds().map(loadQueue), ...machineIds().map(loadMachineQueue),
      state.viewingMachine ? loadMachineFaults(state.viewingMachine) : null,
      state.tab === "faults" ? loadBoard() : null, state.tab === "machines" ? loadAdminMachines() : null,
      state.tab === "people" ? loadPeople() : null, state.tab === "calendar" ? loadClinicCalendar() : null]);
    syncChannels();
    render();
  } catch (e) { banner(friendly(e), "error"); }
}
const pendingRefresh = new Map();
function refreshQueueSoon(resourceId) {           // debounce bursts of live signals
  clearTimeout(pendingRefresh.get(resourceId));
  pendingRefresh.set(resourceId, setTimeout(async () => {
    try {
      if (isMachine(resourceId)) {
        await Promise.all([loadMachineQueue(resourceId), loadMachines(),
          state.viewingMachine === resourceId ? loadMachineFaults(resourceId) : null, state.tab === "faults" ? loadBoard() : null]);
      } else await Promise.all([loadQueue(resourceId), loadOverview()]);
      render();
    } catch (e) { banner(friendly(e), "error"); }
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
async function joinQueue(resourceId, unit, priority, reason, purpose = "") {
  const payload = { resourceId, unit, priority, reason: priority === "urgent" ? reason.trim() : null,
    purpose: purpose.replace(/\s+/g, " ").trim() || null };
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
    if (!error) {
      try { localStorage.removeItem(PENDING_KEY); } catch {}
      if (p.purpose && data?.queue_entry_id) {
        await sb.rpc("set_entry_purpose", { p_queue_entry_id: data.queue_entry_id, p_purpose: p.purpose }); // best effort
      }
      return data;
    }
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
    el("button", { class: "gear", type: "button", onclick: openSettings, "aria-label": "Settings", title: "Settings", id: "settingsBtn" }, "⚙"));
  // instructors: today's status right under their name, one tap to change it
  const myRes = p.role === "instructor" ? state.overview.find((r) => r.is_my_resource) : null;
  $("myStatusLine").classList.toggle("hidden", !myRes);
  if (myRes) $("myStatusLine").replaceChildren(
    el("button", { class: "status-chip " + (myRes.on_duty ? "active" : "inactive"), type: "button", id: "myStatusBtn", disabled: state.busy,
      onclick: () => setStatus(myRes, true) },
      el("span", { class: "dot" }), statusText(myRes),
      el("span", { class: "chev", text: "Change today ›" })));
  const roleLabel = ({ resident: "Resident", instructor: p.instructor_kind === "external" ? "External instructor" : "Instructor",
    admin: "Admin", technician: "Technician" }[p.role] || p.role) + (p.is_admin && p.role !== "admin" ? " · Admin" : "");
  $("sessionLine").textContent = `${roleLabel} · ` + (state.session
    ? `Registration open until ${String(state.session.end_time).slice(0, 5)}`
    : "Registration closed (08:45–12:00 · 12:45–16:00)");
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab && !state.viewing));
  const viewingAny = !!state.viewing || !!state.viewingMachine;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab && !viewingAny));
  const panes = { mine: "mineTab", all: "allTab", scanners: "scannersTab", printers: "printersTab", faults: "faultsTab", machines: "machinesTab",
    people: "peopleTab", settings: "settingsTab", calendar: "calendarTab" };
  for (const [tab, id] of Object.entries(panes)) $(id).classList.toggle("hidden", state.tab !== tab || viewingAny);
  $("queueTab").classList.toggle("hidden", !state.viewing);
  $("machineTab").classList.toggle("hidden", !state.viewingMachine);
  if (state.viewing) renderQueueView(state.viewing);
  else if (state.viewingMachine) renderMachineView(state.viewingMachine);
  else if (state.tab === "mine") renderMine();
  else if (state.tab === "scanners") renderMachineList("scanner");
  else if (state.tab === "printers") renderMachineList("printer");
  else if (state.tab === "faults") renderFaults();
  else if (state.tab === "machines") renderAdminMachines();
  else if (state.tab === "people") renderPeople();
  else if (state.tab === "settings") renderSettings();
  else if (state.tab === "calendar") renderCalendar();
  else renderAll();
}

function renderMine() {
  const box = $("mineTab"); box.replaceChildren();
  renderMineInner(box);
  const mm = state.machines.filter((m) => m.my_queue_entry_id);
  if (mm.length) {
    box.append(el("div", { class: "section-title", text: "Scanners and printers" }));
    for (const m of mm) box.append(machineStatusCard(m));
  }
}
function renderMineInner(box) {
  const p = state.profile;
  if (p.role === "instructor") {
    const mine = state.overview.find((r) => r.is_my_resource);
    if (!mine) { box.append(el("p", { class: "empty", text: "No queue is assigned to your account yet." })); return; }
    box.append(renderQueueBlock(mine));
    return;
  }
  if (p.role !== "resident") {
    if (!state.machines.some((m) => m.my_queue_entry_id)) box.append(el("p", { class: "empty", text: "Use the tabs above to view any queue." }));
    return;
  }
  const active = state.overview.filter((r) => r.my_queue_entry_id);
  if (!active.length && state.machines.some((m) => m.my_queue_entry_id)) return;
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
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Show instructors" });
  for (const [k, label] of [["all", "All"], ["internal", "Internal"], ["external", "External"]])
    seg.append(el("button", { type: "button", "aria-pressed": String(state.instFilter === k), onclick: () => { state.instFilter = k; render(); } }, label));
  box.append(seg);
  const shown = state.overview.filter((r) => state.instFilter === "all" || (r.instructor_kind || "internal") === state.instFilter);
  if (!shown.length) { box.append(el("p", { class: "empty", text: state.overview.length ? "No instructors in this group." : "No instructors are available." })); return; }
  const onDuty = shown.filter((r) => r.on_duty), others = shown.filter((r) => !r.on_duty);
  if (onDuty.length) { box.append(el("div", { class: "section-title", text: "Active now" })); box.append(instructorList(onDuty)); }
  if (others.length) { if (onDuty.length) box.append(el("div", { class: "section-title", text: "Not active now" })); box.append(instructorList(others)); }
}
function statusBadge(r) {
  const note = r.status_note && r.status_note !== "scheduled" ? ` · ${r.status_note}` : (r.status_note === "scheduled" ? " · scheduled" : "");
  return el("span", { class: "badge " + (r.on_duty ? "active" : "inactive"), text: (r.on_duty ? "Active" : "Inactive") + note });
}
const overridden = (r) => !!r.status_note && !["scheduled", "day off", "holiday"].includes(r.status_note);   // today's add-on is set
const statusText = (r) => (r.on_duty ? "Active" : "Inactive") + (overridden(r) ? ` · ${r.status_note}` : " · by schedule");
function askStatus(name, hasOverride = false) {
  return new Promise((resolve) => {
    const d = $("statusDialog"), t = $("statusTime"), u = $("statusUntilTime");
    $("statusTitle").textContent = `Change today only: ${name}`;
    $("statusReset").classList.toggle("hidden", !hasOverride);
    for (const sel of [t, u]) if (!sel.options.length) for (let h = 7; h <= 18; h++) for (const m of [0, 15, 30, 45]) {
      const v = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; sel.append(el("option", { value: v, text: v })); }
    t.value = "10:00"; u.value = "12:00"; $("statusActive").checked = true;
    const sync = () => {
      const between = $("statusBetween").checked;
      $("statusTimeBox").classList.toggle("hidden", !($("statusUntil").checked || $("statusFrom").checked || between));
      $("statusTimeLabel").textContent = between ? "From" : "Time";
      $("statusUntilBox").classList.toggle("hidden", !between);
    };
    for (const r of d.querySelectorAll("input[name=statusMode]")) r.onchange = sync; sync();
    d.onclose = () => {
      if (d.returnValue === "schedule") return resolve({ mode: "schedule", time: null, until: null });
      if (d.returnValue !== "ok") return resolve(null);
      const mode = d.querySelector("input[name=statusMode]:checked").value;
      if (mode === "between" && u.value <= t.value) { banner("The end time must be after the start time.", "error"); return resolve(null); }
      resolve({ mode, time: ["until", "from", "between"].includes(mode) ? t.value : null, until: mode === "between" ? u.value : null });
    };
    d.showModal();
  });
}
async function setStatus(r, isOwner) {
  const v = await askStatus(r.resource_name, overridden(r));
  if (!v) return;
  act(async () => {
    await rpc("set_instructor_status", { p_resource_id: isOwner ? null : r.resource_id, p_mode: v.mode, p_time: v.time, p_until: v.until });
    if (state.tab === "people") { await loadOverview(); $("peopleTab").replaceChildren(); }
  }, "Status updated.");
}
function instructorList(rows) {
  const list = el("ul", { class: "list" });
  for (const r of rows) {
    const load = r.waiting_count === 0 ? "free" : r.waiting_count <= 2 ? "low" : r.waiting_count <= 4 ? "mid" : "high";
    list.append(el("li", { class: "item" + (r.my_queue_entry_id ? " mine" : ""), onclick: () => openQueue(r.resource_id), role: "button", tabindex: "0" },
      el("div", { class: "avatar", style: `--h:${hueOf(r.resource_name)}`, text: initials(r.resource_name) }),
      el("div", { class: "main" },
        el("div", { class: "name" }, r.resource_name, r.instructor_kind === "external" ? el("span", { class: "badge", text: "external" }) : null,
          r.has_check_in_progress ? el("span", { class: "badge progress", text: "checking" }) : null,
          r.resource_status !== "available" ? el("span", { class: "badge urgent", text: "unavailable" }) : null, statusBadge(r)),
        el("div", { class: "meta", text: r.my_queue_entry_id
          ? (r.my_status === "in_progress" ? "You are being checked now" : `You are #${r.my_waiting_position} in line`)
          : (r.has_check_in_progress ? "Checking a resident now" : "Tap to see the queue") })),
      el("div", { class: "count", "data-load": load }, el("b", { text: String(r.waiting_count) }), "waiting")));
  }
  return list;
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

function unitBig(n) {   // large, high-contrast unit number (easy to read at a glance)
  return el("div", { class: "unit-big", "aria-label": `Unit ${n}` }, el("small", { text: "UNIT" }), el("b", { text: String(n) }));
}
function renderQueueBlock(r) {
  const rows = state.queues.get(r.resource_id) || [];
  const isOwner = r.is_my_resource && state.profile.role === "instructor";
  const canSet = !isOwner && isAdmin();
  const wrap = el("div", { class: "card" }, el("h2", { text: r.resource_name }),
    el("div", { class: "row status-line" }, statusBadge(r),
      canSet ? el("button", { class: "ghost small", type: "button", disabled: state.busy, onclick: () => setStatus(r, isOwner) }, "Set status") : null),
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
    list.append(el("li", { class: "item" + (q.is_mine ? " mine" : "") + (q.status === "in_progress" ? " progress" : "") },
      el("div", { class: "pos", text: q.status === "in_progress" ? "▶" : String(q.waiting_position) }),
      q.dental_unit ? unitBig(q.dental_unit) : null,
      el("div", { class: "main" },
        el("div", { class: "name" }, q.display_name, q.is_mine ? " (you)" : "",
          q.priority === "urgent" ? el("span", { class: "badge urgent", text: "Urgent" }) : null),
        el("div", { class: "meta", text: meta.join(" · ") }),
        q.purpose ? el("div", { class: "purpose", text: "For: " + q.purpose }) : null,
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
  const purpose = el("input", { type: "text", id: "purposeInput", maxlength: "100", placeholder: "e.g. wire bending check, bracket position" });
  const submit = el("button", { class: "primary", type: "submit", disabled: !open || state.busy }, "Join queue");
  const form = el("form", { class: "card" },
    el("h2", { text: `Join ${r.resource_name}'s queue` }),
    el("p", { class: "warn closedNote" + (open ? " hidden" : ""), text: open ? "" : (state.session ? "This queue is not available." : "Registration is closed now.") }),
    el("label", { for: "unitInput", text: "Dental unit (1–999)" }), unit,
    el("label", { for: "purposeInput", text: "What for? (optional)" }), purpose,
    el("div", { class: "warn", text: "No patient names or HN." }),
    el("label", { for: "prioInput", text: "Priority" }), prio, reasonBox, el("div", { class: "row end" }, submit));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const n = Number(unit.value);
    if (!Number.isInteger(n) || n < 1 || n > 999) { banner(MESSAGES.invalid_dental_unit, "error"); return; }
    if (prio.value === "urgent" && (!reason.value.trim() || reason.value.trim().length > 200)) { banner(MESSAGES.invalid_urgent_reason, "error"); return; }
    act(async () => {
      const res = await joinQueue(r.resource_id, n, prio.value, reason.value, purpose.value);
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

// ---------- accounts: setup, settings, schedule, people (admin) ----------
// Plain instructors get a simple app: My Queue + Instructors only. Instructors who are admins see everything.
const machineTabsForMe = () => state.profile?.role !== "instructor" || isAdmin();
function applyTabs() {
  const machinesOn = scannersOn() || printersOn();
  $("tabScanners").classList.toggle("hidden", !(scannersOn() && machineTabsForMe()));
  $("tabPrinters").classList.toggle("hidden", !(printersOn() && machineTabsForMe()));
  if (["scanners", "printers"].includes(state.tab) && !machineTabsForMe()) state.tab = "mine";
  $("tabFaults").classList.toggle("hidden", !(machinesOn && isStaff()));
  $("tabMachines").classList.toggle("hidden", !(machinesOn && isAdmin()));
  $("tabPeople").classList.toggle("hidden", !isAdmin());
  // the clinic calendar: a tab for residents and admins; plain instructors reach it from the LINE menu link
  $("tabCalendar").classList.toggle("hidden", !(machineTabsForMe() || isAdmin()) && state.tab !== "calendar");
  if (["faults", "machines", "people"].includes(state.tab) && !isAdmin() && !(state.tab === "faults" && isStaff())) state.tab = "mine";
}
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const WEEK_CHOICES = [["off", "—"], ["all", "Every week"], ["1,3", "1st & 3rd"], ["1,3,5", "1st, 3rd & 5th"], ["2,4", "2nd & 4th"]];
const ORD = ["1st", "2nd", "3rd", "4th", "5th"];
const weeksLabel = (v) => { const w = v.split(",").map((n) => ORD[Number(n) - 1]); return w.length > 1 ? w.slice(0, -1).join(", ") + " & " + w[w.length - 1] : w[0]; };
function askWeeks(current) {          // tick which weeks of the month (week 5 = days 29–31)
  return new Promise((resolve) => {
    const d = $("weeksDialog"), now = current && current !== "off" && current !== "all" ? current.split(",") : [];
    for (let i = 1; i <= 5; i++) $(`wk${i}`).checked = current === "all" || now.includes(String(i));
    d.onclose = () => {
      if (d.returnValue !== "ok") return resolve(null);
      const w = [1, 2, 3, 4, 5].filter((i) => $(`wk${i}`).checked);
      resolve(!w.length ? "off" : w.length === 5 ? "all" : w.join(","));
    };
    d.showModal();
  });
}
function radioGroup(name, options, value) {
  const box = el("div", { class: "row" });
  for (const [v, label] of options) {
    const r = el("input", { type: "radio", name, value: v, id: `${name}_${v}` }); r.checked = v === value;
    box.append(el("label", { class: "choice", for: `${name}_${v}` }, r, " " + label));
  }
  return box;
}
function scheduleGrid(schedule, prefix) {
  const grid = el("table", { class: "sched" });
  grid.append(el("tr", {}, el("th", { text: "" }), el("th", { text: "Morning" }), el("th", { text: "Afternoon" })));
  const sel = {};
  for (let d = 1; d <= 5; d++) {
    const tr = el("tr", {}, el("th", { text: DAYS[d - 1] }));
    for (const sess of ["AM", "PM"]) {
      const cur = schedule.find((x) => x.weekday === d && x.session_code === sess);
      const curVal = !cur ? "off" : !cur.weeks ? "all" : cur.weeks.join(",");
      const s = el("select", { "aria-label": `${DAYS[d - 1]} ${sess === "AM" ? "morning" : "afternoon"}`, id: `${prefix}_${d}_${sess}` });
      const opts = [...WEEK_CHOICES]; if (!opts.some(([v]) => v === curVal)) opts.push([curVal, weeksLabel(curVal)]);
      for (const [v, label] of opts) s.append(el("option", { value: v, text: label }));
      s.append(el("option", { value: "pick", text: "Pick weeks…" }));
      s.value = curVal; s.dataset.prev = curVal;
      s.addEventListener("change", async () => {
        if (s.value !== "pick") { s.dataset.prev = s.value; return; }
        const v = await askWeeks(s.dataset.prev);
        const val = v ?? s.dataset.prev;
        if (![...s.options].some((o) => o.value === val)) s.insertBefore(el("option", { value: val, text: weeksLabel(val) }), s.lastChild);
        s.value = val; s.dataset.prev = val;
      });
      sel[`${d}_${sess}`] = s; tr.append(el("td", {}, s));
    }
    grid.append(tr);
  }
  const slots = () => {
    const out = [];
    for (const [key, s] of Object.entries(sel)) {
      if (s.value === "off") continue;
      const [d, sess] = key.split("_");
      out.push({ weekday: Number(d), session: sess, weeks: s.value === "all" ? null : s.value.split(",").map(Number) });
    }
    return out;
  };
  return { grid, slots };
}
function accountForm({ setup = false, profile = null, schedule = [] }) {
  const f = el("form", { class: "account" });
  const name = el("input", { type: "text", maxlength: "40", id: "acctName", autocomplete: "nickname" });
  if (setup) f.append(el("label", { for: "acctName", text: "Your name or nickname" }), name,
    el("div", { class: "warn", text: "Your own name or nickname only. No patient names or HN." }));
  const role = profile && profile.role === "instructor" ? "instructor" : profile ? "resident" : "";
  f.append(el("label", { text: "I am a" }), radioGroup("acctRole", [["resident", "Resident"], ["instructor", "Instructor"]], role));
  const kindBox = el("div", { id: "acctKindBox" }, el("label", { text: "Instructor type" }),
    radioGroup("acctKind", [["internal", "Internal"], ["external", "External"]], profile?.instructor_kind || "internal"));
  f.append(kindBox);
  const admin = el("input", { type: "checkbox", id: "acctAdmin" }); admin.checked = !!profile?.is_admin;
  f.append(el("label", { class: "choice", for: "acctAdmin" }, admin, " I am an admin"),
    el("p", { class: "hint", text: "Admins can manage scanners, printers, problem reports and other people's accounts." }));
  const { grid, slots: readSlots } = scheduleGrid(schedule, "sch");
  const schedBox = el("div", { id: "acctSchedBox" }, el("label", { text: "When are you in clinic? (same every week)" }), grid,
    el("p", { class: "hint", text: "Weeks count from the 1st of the month: days 1–7 are the 1st week, 8–14 the 2nd, … 29–31 the 5th. You'll be listed first during these sessions; residents can still join you at other times." }));
  f.append(schedBox);
  const sync = () => {
    const r = f.querySelector("input[name=acctRole]:checked")?.value;
    const k = f.querySelector("input[name=acctKind]:checked")?.value;
    kindBox.classList.toggle("hidden", r !== "instructor");
    schedBox.classList.toggle("hidden", !(r === "instructor" && k === "internal"));
  };
  f.addEventListener("change", sync); sync();
  const read = () => {
    const r = f.querySelector("input[name=acctRole]:checked")?.value || null;
    const k = r === "instructor" ? (f.querySelector("input[name=acctKind]:checked")?.value || null) : null;
    const slots = readSlots();
    return { name: name.value.replace(/\s+/g, " ").trim(), role: r, kind: k, isAdmin: admin.checked, slots };
  };
  return { form: f, read };
}
function renderSetup() {
  const box = $("setupBox"); box.replaceChildren();
  const { form, read } = accountForm({ setup: true });
  const btn = el("button", { class: "primary", type: "submit", id: "setupSave" }, "Continue");
  form.append(el("div", { class: "row end" }, btn));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = read();
    if (!v.name || v.name.length > 40 || /[<>]/.test(v.name)) { banner(MESSAGES.invalid_display_name, "error"); return; }
    if (!v.role) { banner(MESSAGES.invalid_role, "error"); return; }
    btn.disabled = true;
    try {
      await rpc("complete_setup", { p_display_name: v.name, p_role: v.role, p_instructor_kind: v.kind, p_is_admin: v.isAdmin });
      if (v.role === "instructor" && v.kind === "internal" && v.slots.length) await rpc("set_my_schedule", { p_slots: v.slots });
      const prof = ((await rpc("get_my_profile")) || [])[0];
      if (!prof) throw new Error("setup_not_found");
      await enterApp(prof);
    } catch (e) { banner(friendly(e), "error"); btn.disabled = false; }
  });
  box.append(form);
}
async function openSettings() {
  state.tab = "settings"; state.viewing = null; state.viewingMachine = null; state.schedule = null; settingsCard = null;
  syncChannels(); render();
  try { state.schedule = state.profile.role === "instructor" ? ((await rpc("get_my_schedule")) || []) : []; render(); }
  catch (e) { banner(friendly(e), "error"); }
}
let settingsCard = null;   // built once per visit so a background refresh never wipes unsaved choices
function summaryFields(prefix, { email, freq, scope, admin }) {
  const e = el("input", { type: "text", inputmode: "email", autocapitalize: "off", id: `${prefix}Email`, maxlength: "254", autocomplete: "email", placeholder: "name@example.com" }); e.value = email || "";
  const f = el("select", { id: `${prefix}Freq`, "aria-label": "Summary" },
    ...[["none", "Off – no summary"], ["weekly", "Weekly"], ["monthly", "Monthly"]].map(([v, t]) => el("option", { value: v, text: t })));
  f.value = freq || "none";
  const sc = el("select", { id: `${prefix}Scope`, "aria-label": "Include" },
    el("option", { value: "own", text: "Only my own data" }), el("option", { value: "all", text: "Everyone (whole department)" }));
  sc.value = scope || "own";
  const scopeBox = el("div", { id: `${prefix}ScopeBox` }, el("label", { for: `${prefix}Scope`, text: "Include" }), sc);
  const sync = () => { scopeBox.classList.toggle("hidden", !admin() || f.value === "none"); };
  f.addEventListener("change", sync); sync();
  const node = el("div", { class: "summary-box" },
    el("label", { for: `${prefix}Freq`, text: "Email summary" }), f,
    el("label", { for: `${prefix}Email`, text: "Email address" }), e,
    el("p", { class: "hint", text: "Optional. Used only to send you your summary. Only you and admins can see it." }), scopeBox);
  return { node, sync, read: () => ({ email: e.value.trim(), freq: f.value, scope: admin() && f.value !== "none" ? sc.value : "own" }) };
}
// ---------- calendars: planned days off / limited days (instructor themself, or an admin for any instructor) ----------
const fmtDay = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const SESSION_LABEL = { all: "whole day", AM: "morning", PM: "afternoon" };
const bkkToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const isoOf = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);       // m 0-based; overflow rolls over
const dm = (iso) => `${+iso.slice(8, 10)}/${+iso.slice(5, 7)}`;                            // 2/12 = 2 December
const monthTitle = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const monthRange = (y, m) => [isoOf(y, m, 1), isoOf(y, m + 1, 0)];
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
function monthWeeks(y, m) {                       // rows of Mon–Fri dates (null = not in this month)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), rows = [];
  let row = null;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (!row || dow === 1) { row = [null, null, null, null, null]; rows.push(row); }
    row[dow - 1] = isoOf(y, m, d);
  }
  return rows;
}
function byDay(rows) {                            // iso -> { AM: {state, note}, PM: {…} }
  const m = new Map();
  for (const r of rows) { if (!m.has(r.day)) m.set(r.day, {}); m.get(r.day)[r.session] = { state: r.state, note: r.time_note }; }
  return m;
}
function monthNav(cal, reload) {
  const now = bkkToday(), y0 = +now.slice(0, 4), m0 = +now.slice(5, 7) - 1;
  const idx = (cal.y - y0) * 12 + (cal.m - m0);
  const go = (n) => { const d = new Date(Date.UTC(cal.y, cal.m + n, 1)); cal.y = d.getUTCFullYear(); cal.m = d.getUTCMonth(); reload(); };
  return el("div", { class: "cal-nav" },
    el("button", { class: "ghost small", type: "button", "aria-label": "Previous month", disabled: idx <= 0, onclick: () => go(-1) }, "‹"),
    el("h3", { text: monthTitle(cal.y, cal.m) }),
    el("button", { class: "ghost small", type: "button", "aria-label": "Next month", disabled: idx >= 12, onclick: () => go(1) }, "›"));
}
const shortName = (n) => { const w = String(n || "").replace(/^\s*(dr\.?|ทพ\.?|ทพญ\.?|อ\.|อาจารย์|aj\.?)\s*/i, "").trim().split(/\s+/)[0] || "?"; return w.length > 7 ? w.slice(0, 6) + "…" : w; };
const halfLabel = (h) => !h ? "" : h.state === "off" ? "✗" : h.state === "limited" ? "½" : "✓";
function calGrid(cal, cell) {
  const g = el("div", { class: "cal" }, ...DAYS.map((d) => el("div", { class: "dow", text: d })));
  for (const row of monthWeeks(cal.y, cal.m)) for (const iso of row) g.append(iso ? cell(iso) : el("div", { class: "cal-empty" }));
  return g;
}
const calLegend = () => el("div", { class: "legend" },
  el("span", {}, el("span", { class: "half in", text: "✓" }), "In clinic"), el("span", {}, el("span", { class: "half limited", text: "½" }), "Part of the session"),
  el("span", {}, el("span", { class: "half off", text: "✗" }), "Off"), calLegendHoliday());

async function loadHolidays(a, b) { return new Map(((await rpc("list_holidays", { p_from: a, p_to: b })) || []).map((h) => [h.day, h.name])); }
const calLegendHoliday = () => el("span", {}, el("span", { class: "half hol", text: "H" }), "Holiday");
// one instructor's month: green = usual clinic sessions; tap a date to mark it off or limit the hours
function instructorCalendar(userId, prefix, onChange) {
  const uid = userId || state.profile.user_id;
  const now = bkkToday();
  const cal = { y: +now.slice(0, 4), m: +now.slice(5, 7) - 1, days: new Map(), hol: new Map() };
  const wrap = el("div", { class: "inst-cal", id: `${prefix}Cal` });
  const draw = () => {
    wrap.replaceChildren(monthNav(cal, load), calLegend(), calGrid(cal, (iso) => {
      const d = cal.days.get(iso) || {}, past = iso < now;
      const lim = d.AM?.state === "limited" ? d.AM : d.PM?.state === "limited" ? d.PM : null;
      const say = (k, w) => (d[k] ? `${w} ${d[k].state === "in" ? "in clinic" : d[k].state === "off" ? "off" : d[k].note}` : `${w} not scheduled`);
      const hol = cal.hol.get(iso);
      return el("button", { class: "cal-day" + (iso === now ? " today" : "") + (hol ? " holiday" : ""), type: "button", disabled: past, "data-day": iso, title: hol || "",
        "aria-label": `${fmtDay(iso)}: ${say("AM", "morning")}, ${say("PM", "afternoon")}`, onclick: () => { if (!state.busy) editDay(iso, d); } },
        el("span", { class: "num", text: String(+iso.slice(8, 10)) }),
        el("span", { class: "halves" }, ...["AM", "PM"].map((k) => el("span", { class: "half " + (d[k]?.state || "none"), text: halfLabel(d[k]) }))),
        lim ? el("span", { class: "tnote", text: lim.note }) : hol ? el("span", { class: "hnote", text: "Holiday" }) : null);
    }), el("p", { class: "hint", text: "Tap a date to mark it off, or to be in clinic only before / after / between certain times. Left half = morning, right half = afternoon." }));
  };
  async function load() {
    try {
      const [a, b] = monthRange(cal.y, cal.m);
      const [rows, hol] = await Promise.all([rpc("get_clinic_calendar", { p_from: a, p_to: b, p_user_id: uid }), loadHolidays(a, b)]);
      cal.days = byDay(rows || []); cal.hol = hol;
    } catch (e) { banner(friendly(e), "error"); }
    draw();
  }
  async function editDay(iso, d) {
    const v = await askDay(iso, d);
    if (!v) return;
    act(async () => {
      await rpc("clear_day_off", { p_user_id: userId, p_day: iso, p_session: "all" });
      if (v.mode.startsWith("in_")) await rpc("add_clinic_day", { p_user_id: userId, p_day: iso, p_session: v.mode.slice(3) });
      else if (v.mode.startsWith("off_")) await rpc("add_day_off", { p_user_id: userId, p_from: iso, p_to: iso, p_session: v.mode.slice(4), p_note: v.note });
      else if (v.mode !== "schedule") await rpc("add_day_off", { p_user_id: userId, p_from: iso, p_to: iso, p_session: "all", p_note: v.note,
        p_from_time: v.mode === "until" ? null : v.time, p_until_time: v.mode === "until" ? v.time : v.mode === "between" ? v.until : null });
      await load(); if (onChange) await onChange();
    }, v.mode === "schedule" ? `${fmtDay(iso)}: back to the usual schedule.` : `${fmtDay(iso)} saved.`);
  }
  draw(); load();
  return { node: wrap, reload: load };
}
function askDay(iso, d) {
  return new Promise((resolve) => {
    const dlg = $("dayDialog"), t = $("dayTime"), u = $("dayUntilTime");
    $("dayTitle").textContent = fmtDay(iso);
    for (const sel of [t, u]) if (!sel.options.length) for (let h = 7; h <= 18; h++) for (const m of [0, 15, 30, 45]) {
      const v = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; sel.append(el("option", { value: v, text: v })); }
    t.value = "10:00"; u.value = "12:00"; $("dayNote").value = "";
    // preselect what the date currently shows
    const lim = d.AM?.state === "limited" ? d.AM : d.PM?.state === "limited" ? d.PM : null;
    let mode = "schedule";
    if (lim) {
      const n = lim.note || "", mm = n.match(/\d\d:\d\d/g) || [];
      mode = n.startsWith("until") ? "until" : n.startsWith("from") ? "from" : "between";
      if (mm[0]) t.value = mm[0]; if (mm[1]) u.value = mm[1];
    } else if (d.AM?.state === "off" && d.PM?.state === "off") mode = "off_all";
    else if (d.AM?.state === "off") mode = "off_AM";
    else if (d.PM?.state === "off") mode = "off_PM";
    dlg.querySelector(`input[name=dayMode][value="${mode}"]`).checked = true;
    const sync = () => {
      const m = dlg.querySelector("input[name=dayMode]:checked").value, between = m === "between";
      $("dayTimeBox").classList.toggle("hidden", !["until", "from", "between"].includes(m));
      $("dayTimeLabel").textContent = between ? "From" : m === "until" ? "Until" : "From";
      $("dayUntilBox").classList.toggle("hidden", !between);
      $("dayNoteBox").classList.toggle("hidden", m === "schedule" || m.startsWith("in_"));
    };
    for (const r of dlg.querySelectorAll("input[name=dayMode]")) r.onchange = sync; sync();
    dlg.onclose = () => {
      if (dlg.returnValue !== "ok") return resolve(null);
      const m = dlg.querySelector("input[name=dayMode]:checked").value;
      if (m === "between" && u.value <= t.value) { banner("The end time must be after the start time.", "error"); return resolve(null); }
      const note = $("dayNote").value.replace(/\s+/g, " ").trim();
      if (note.length > 60 || /[<>]/.test(note)) { banner(MESSAGES.invalid_days_off, "error"); return resolve(null); }
      resolve({ mode: m, time: t.value, until: u.value, note: note || null });
    };
    dlg.showModal();
  });
}
function daysOffSection(userId, prefix) {
  const wrap = el("div", { class: "days-off", id: `${prefix}DaysOff` });
  const today = bkkToday();
  const from = el("input", { type: "date", id: `${prefix}OffFrom`, min: today }); from.value = today;
  const to = el("input", { type: "date", id: `${prefix}OffTo`, min: today }); to.value = today;
  from.addEventListener("change", () => { if (to.value < from.value) to.value = from.value; to.min = from.value; });
  const sess = el("select", { id: `${prefix}OffSession`, "aria-label": "Which part of the day" },
    ...Object.entries(SESSION_LABEL).map(([v, t]) => el("option", { value: v, text: t[0].toUpperCase() + t.slice(1) })));
  const note = el("input", { type: "text", id: `${prefix}OffNote`, maxlength: "60", placeholder: "Reason (optional), e.g. conference" });
  const list = el("ul", { class: "list compact" });
  let calendar = null;
  const what = (d) => d.kind === "extra" ? "Extra clinic day · " + SESSION_LABEL[d.session] : d.kind === "limited"
    ? "In clinic only " + (d.from_time && d.until_time ? `${hhmm(d.from_time)}–${hhmm(d.until_time)}` : d.until_time ? `until ${hhmm(d.until_time)}` : `from ${hhmm(d.from_time)}`)
    : "Off · " + SESSION_LABEL[d.session];
  const loadList = async () => {
    try {
      const rows = (await rpc("list_days_off", { p_user_id: userId })) || [];
      list.replaceChildren(...(rows.length ? rows.map((d) => el("li", { class: "item" },
        el("div", { class: "main" }, el("div", { class: "name", text: d.day_from === d.day_to ? fmtDay(d.day_from) : `${fmtDay(d.day_from)} – ${fmtDay(d.day_to)}` }),
          el("div", { class: "meta", text: what(d) + (d.note ? ` · ${d.note}` : "") + (d.set_by ? ` · set by ${d.set_by}` : "") })),
        el("button", { class: "ghost small", type: "button", onclick: () => act(async () => {
          await rpc("remove_day_off", { p_day_off_id: d.day_off_id }); await loadList(); await calendar.reload(); }, "Removed.") }, "Remove")))
        : [el("li", { class: "empty", text: "No days off planned." })]));
    } catch (e) { banner(friendly(e), "error"); }
  };
  calendar = instructorCalendar(userId, prefix, loadList);
  wrap.append(el("label", { text: "Clinic calendar" }), calendar.node,
    el("div", { class: "section-title", text: "Planned changes" }), list,
    el("details", { class: "range-add" }, el("summary", { text: "Add several days off at once" }),
      el("div", { class: "row" }, el("label", { for: `${prefix}OffFrom`, text: "From" }), from, el("label", { for: `${prefix}OffTo`, text: "To" }), to),
      sess, note,
      el("div", { class: "row end" }, el("button", { class: "ghost", type: "button", id: `${prefix}OffAdd`, onclick: () => {
        if (!from.value || !to.value || to.value < from.value) { banner(MESSAGES.invalid_days_off, "error"); return; }
        act(async () => {
          await rpc("add_day_off", { p_user_id: userId, p_from: from.value, p_to: to.value, p_session: sess.value, p_note: note.value.trim() || null });
          note.value = ""; await loadList(); await calendar.reload();
        }, "Days off added.");
      } }, "Add days off"))));
  loadList();
  return wrap;
}

// ---------- clinic calendar for everyone (#calendar): who is in / off, no reasons ----------
// view: day / week / month; who: all instructors (filtered by Internal/External) or one instructor (resource id)
const clinicCal = { view: "week", anchor: null, who: "all", rows: [], hol: new Map(), loadedKey: "", summary: null };
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();          // 0 Sun … 6 Sat
const mondayOf = (iso) => { const d = weekdayOf(iso); return addDays(iso, d === 0 ? 1 : d === 6 ? 2 : 1 - d); };  // weekend -> next Monday
function clinicRange() {
  const t = clinicCal.anchor;
  if (clinicCal.view === "day") return [t, t];
  if (clinicCal.view === "week") { const m = mondayOf(t); return [m, addDays(m, 4)]; }
  if (clinicCal.view === "2week") { const m = mondayOf(t); return [m, addDays(m, 11)]; }
  if (clinicCal.view === "2month") return [monthRange(+t.slice(0, 4), +t.slice(5, 7) - 1)[0], monthRange(+t.slice(0, 4), +t.slice(5, 7))[1]];
  return monthRange(+t.slice(0, 4), +t.slice(5, 7) - 1);
}
async function loadClinicCalendar(force = false) {
  if (clinicCal.anchor === null) { let t = bkkToday(); if ([0, 6].includes(weekdayOf(t))) t = mondayOf(t); clinicCal.anchor = t; }
  const [a, b] = clinicRange(), key = a + b;
  if (!force && clinicCal.loadedKey === key && Date.now() - (clinicCal.at || 0) < 50000) return;
  const [rows, hol] = await Promise.all([rpc("get_clinic_calendar", { p_from: a, p_to: b }), loadHolidays(a, b)]);
  clinicCal.rows = rows || []; clinicCal.hol = hol;
  clinicCal.loadedKey = key; clinicCal.at = Date.now();
}
const calFilter = (r) => (clinicCal.who === "all" ? state.instFilter === "all" || (r.instructor_kind || "internal") === state.instFilter : r.resource_id === clinicCal.who);
function clinicGo(fn) { fn(); render(); loadClinicCalendar(true).then(render).catch((e) => banner(friendly(e), "error")); }
function clinicStep(n) {
  clinicGo(() => {
    const t = clinicCal.anchor;
    if (clinicCal.view === "month" || clinicCal.view === "2month") clinicCal.anchor = isoOf(+t.slice(0, 4), +t.slice(5, 7) - 1 + n * (clinicCal.view === "2month" ? 2 : 1), 1);
    else if (clinicCal.view === "week" || clinicCal.view === "2week") clinicCal.anchor = addDays(mondayOf(t), 7 * n * (clinicCal.view === "2week" ? 2 : 1));
    else { let d = addDays(t, n); while ([0, 6].includes(weekdayOf(d))) d = addDays(d, n); clinicCal.anchor = d; }
  });
}
function clinicTitle() {
  const [a, b] = clinicRange();
  if (clinicCal.view === "month") return monthTitle(+a.slice(0, 4), +a.slice(5, 7) - 1);
  if (clinicCal.view === "2month") {
    const mt = (iso, y) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", month: "short", ...(y ? { year: "numeric" } : {}) });
    return `${mt(a, a.slice(0, 4) !== b.slice(0, 4))} – ${mt(b, true)}`;
  }
  if (clinicCal.view === "day") return fmtDay(a);
  const f = (iso, o) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  return `${f(a, { day: "numeric", month: a.slice(5, 7) === b.slice(5, 7) ? undefined : "short" })} – ${f(b, { day: "numeric", month: "short", year: "numeric" })}`;
}
function peopleByDay(rows) {        // iso -> [{ name, kind, AM, PM }] sorted by name
  const per = new Map();
  for (const r of rows) {
    if (!per.has(r.day)) per.set(r.day, new Map());
    const m = per.get(r.day);
    if (!m.has(r.user_id)) m.set(r.user_id, { name: r.instructor_name, kind: r.instructor_kind });
    m.get(r.user_id)[r.session] = r;
  }
  const out = new Map();
  for (const [d, m] of per) out.set(d, [...m.values()].sort((x, y) => x.name.localeCompare(y.name)));
  return out;
}
const sessWord = (h) => !h ? "–" : h.state === "off" ? "Off" : h.state === "limited" ? h.time_note : "In";
function renderCalendar() {
  const box = $("calendarTab");
  const keepSummary = box.querySelector("#calSummaryText");
  box.replaceChildren();
  if (clinicCal.anchor === null) { box.append(el("p", { class: "empty", text: "Loading…" })); return; }
  const one = clinicCal.who !== "all";
  // controls: Day / Week / Month · instructor picker · Internal / External
  const views = el("div", { class: "seg", role: "group", "aria-label": "Calendar view", id: "calView" },
    ...[["day", "Day"], ["week", "Week"], ["2week", "2 wks"], ["month", "Month"], ["2month", "2 mo"]].map(([k, t]) => el("button", { "data-view": k, type: "button", "aria-pressed": String(clinicCal.view === k),
      onclick: () => clinicGo(() => { clinicCal.view = k; if (k === "day" && [0, 6].includes(weekdayOf(clinicCal.anchor))) clinicCal.anchor = mondayOf(clinicCal.anchor); }) }, t)));
  const insts = state.overview.filter((r) => state.instFilter === "all" || (r.instructor_kind || "internal") === state.instFilter)
    .slice().sort((x, y) => x.resource_name.localeCompare(y.resource_name));
  const pick = el("select", { id: "calWho", "aria-label": "Which instructor" }, el("option", { value: "all", text: "All instructors" }),
    ...insts.map((r) => el("option", { value: r.resource_id, text: r.resource_name })));
  pick.value = insts.some((r) => r.resource_id === clinicCal.who) ? clinicCal.who : "all";
  if (pick.value === "all" && one) clinicCal.who = "all";
  pick.addEventListener("change", () => { clinicCal.who = pick.value; clinicCal.summary = null; render(); });
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Show instructors" });
  for (const [k, label] of [["all", "All"], ["internal", "Internal"], ["external", "External"]])
    seg.append(el("button", { type: "button", "aria-pressed": String(state.instFilter === k), onclick: () => { state.instFilter = k; clinicCal.summary = null; render(); } }, label));
  const nav = el("div", { class: "cal-nav" },
    el("button", { class: "ghost small", type: "button", "aria-label": "Previous", onclick: () => clinicStep(-1) }, "‹"),
    el("h3", { id: "calTitle", text: clinicTitle() }),
    el("button", { class: "ghost small", type: "button", "aria-label": "Next", onclick: () => clinicStep(1) }, "›"));
  // all instructors: show only who is in (off sessions are left out so the calendar stays clear); one instructor: show their ✗ too
  const rows = clinicCal.rows.filter(calFilter).filter((r) => one || r.state !== "off"), per = peopleByDay(rows), now = bkkToday();
  let body;
  if (clinicCal.view === "month" || clinicCal.view === "2month") {
    const [a] = clinicRange(), y0 = +a.slice(0, 4), m0 = +a.slice(5, 7) - 1;
    const cellFor = (iso) => {
      const hol = clinicCal.hol.get(iso), people = per.get(iso) || [];
      const say = (p) => `${p.name}: morning ${sessWord(p.AM)}, afternoon ${sessWord(p.PM)}`;
      return el("button", { class: "cal-day wide" + (iso === now ? " today" : "") + (hol ? " holiday" : ""), type: "button", "data-day": iso,
        title: hol || "", "aria-label": `${fmtDay(iso)}${hol ? " (holiday)" : ""}: ${people.map(say).join("; ") || "no one scheduled"}`,
        onclick: () => clinicGo(() => { clinicCal.anchor = iso; clinicCal.view = "day"; }) },
        el("span", { class: "num", text: String(+iso.slice(8, 10)) }),
        hol ? el("span", { class: "hnote", text: "Holiday" }) : null,
        ...people.map((p) => el("span", { class: "who-row" }, one ? null : el("span", { class: "who", text: shortName(p.name) }),
          el("span", { class: "halves" + (one ? "" : " mini") }, ...["AM", "PM"].map((k) => el("span", { class: "half " + (p[k]?.state || "none"), text: halfLabel(p[k]) }))))),
        one && people[0] && (people[0].AM?.state === "limited" || people[0].PM?.state === "limited")
          ? el("span", { class: "tnote", text: (people[0].AM?.state === "limited" ? people[0].AM : people[0].PM).time_note }) : null);
    };
    const months = clinicCal.view === "2month" ? [0, 1] : [0];
    body = el("div", { class: "months" }, ...months.map((k) => {
      const d = new Date(Date.UTC(y0, m0 + k, 1)), cal = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
      return el("div", { class: "month-block" }, months.length > 1 ? el("div", { class: "section-title", text: monthTitle(cal.y, cal.m) }) : null, calGrid(cal, cellFor));
    }));
  } else {
    const [a, b] = clinicRange(), days = [];
    for (let d = a; d <= b; d = addDays(d, 1)) if (![0, 6].includes(weekdayOf(d))) days.push(d);
    body = el("div", { class: "day-list", id: "calDays" }, ...days.flatMap((iso, i) => [
      clinicCal.view === "2week" && i === 5 ? el("div", { class: "section-title", text: "Next week" }) : null,
      dayBlock(iso, per.get(iso) || [], clinicCal.view !== "day")].filter(Boolean)));
  }
  box.append(el("div", { class: "card" }, el("h2", { text: "Clinic calendar" }), views, pick, one ? null : seg, nav,
    calLegend(), body,
    el("p", { class: "hint", text: clinicCal.view === "month" || clinicCal.view === "2month"
      ? (one ? "Left box = morning, right box = afternoon. Tap a date for details." : "Only instructors who are in are listed. Each name: left box = morning, right box = afternoon. Tap a date to see that day.")
      : one ? "✓ in clinic · ½ part of the session (times shown) · ✗ off." : "Only instructors who are in are listed. ✓ in clinic · ½ part of the session (times shown)." })));
  if (isAdmin()) box.append(summaryCard(keepSummary), importCard(), holidaysCard());
}
function dayBlock(iso, people, tappable) {
  const hol = clinicCal.hol.get(iso);
  const pill = (h, word) => el("span", { class: "pill half " + (h?.state || "none") }, `${word} ${h ? halfLabel(h) : "–"}`);
  return el("div", { class: "day-block" + (iso === bkkToday() ? " today" : "") + (hol ? " holiday" : ""), "data-day": iso },
    el("div", { class: "day-head" }, tappable
      ? el("button", { class: "linkish", type: "button", onclick: () => clinicGo(() => { clinicCal.anchor = iso; clinicCal.view = "day"; }) }, fmtDay(iso))
      : el("b", { text: fmtDay(iso) }), hol ? el("span", { class: "holiday-line", text: " · Holiday: " + hol }) : null,
      hol && isAdmin() && !tappable ? el("button", { class: "ghost small", type: "button", id: "calRemoveHoliday", disabled: state.busy, onclick: async () => {
        if (!(await askConfirm(`Remove the holiday on ${fmtDay(iso)} (${hol})? Usual clinic days will show again.`))) return;
        act(async () => { await rpc("admin_remove_holiday", { p_day: iso }); holState.list = null; await loadClinicCalendar(true); }, "Holiday removed.");
      } }, "Remove holiday") : null),
    people.length ? el("ul", { class: "inst-lines" }, ...people.map((p) => {
      const lim = p.AM?.state === "limited" ? p.AM : p.PM?.state === "limited" ? p.PM : null;
      return el("li", { class: "inst-line" },
        el("span", { class: "iname" }, p.name, p.kind === "external" ? el("span", { class: "badge", text: "ext" }) : null),
        el("span", { class: "pills" }, pill(p.AM, "AM"), pill(p.PM, "PM")),
        lim ? el("span", { class: "tnote", text: "only " + lim.time_note }) : null);
    })) : el("p", { class: "empty small", text: hol ? "No clinic." : "No one scheduled." }));
}
// "Dr Bee: ✓ 2/12, 4/12 (until 10:00) ✗ 11/12" for this month (from today) and next month
function buildSummary(rows, fromIso, toIso, hol = new Map()) {
  const people = new Map();
  for (const r of rows.filter(calFilter)) {
    if (!people.has(r.user_id)) people.set(r.user_id, { name: r.instructor_name, kind: r.instructor_kind || "internal", days: new Map() });
    const d = people.get(r.user_id).days; if (!d.has(r.day)) d.set(r.day, {}); d.get(r.day)[r.session] = r;
  }
  const line = (p) => {
    const yes = [], no = [];
    for (const day of [...p.days.keys()].sort()) {
      const s = p.days.get(day), lim = s.AM?.state === "limited" ? s.AM : s.PM?.state === "limited" ? s.PM : null;
      if (lim) { yes.push(`${dm(day)} (${lim.time_note})`); continue; }
      const inn = ["AM", "PM"].filter((k) => s[k] && s[k].state !== "off"), off = ["AM", "PM"].filter((k) => s[k]?.state === "off");
      if (inn.length) yes.push(dm(day) + (inn.length === 1 ? ` ${inn[0]}` : ""));
      if (off.length) no.push(dm(day) + (off.length === 1 ? ` ${off[0]}` : ""));
    }
    return `${p.name}: ` + [yes.length ? "✓ " + yes.join(", ") : "", no.length ? "✗ " + no.join(", ") : ""].filter(Boolean).join(" ");
  };
  const list = [...people.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const out = [`Clinic calendar ${dm(fromIso)} – ${dm(toIso)}`, "✓ in clinic · ✗ off (AM/PM = that half only)"];
  for (const kind of ["internal", "external"]) {
    const ps = list.filter((p) => p.kind === kind);
    if (!ps.length) continue;
    if (state.instFilter === "all") out.push("", kind === "internal" ? "Internal" : "External");
    else out.push("");
    out.push(...ps.map(line));
  }
  if (hol.size) out.push("", "Holidays: " + [...hol.keys()].sort().map(dm).join(", "));
  if (!list.length) out.push("", "No instructors scheduled.");
  return out.join("\n");
}
// ---------- paste a message to update the calendar (admins): "Dr Bee: ✗ 12/12, 14/12 AM, 16/12 until 10:00" ----------
const normName = (n) => String(n || "").toLowerCase().replace(/^\s*(dr\.?|ทพ\.?|ทพญ\.?|อ\.|อาจารย์|aj\.?|ajarn)\s*/i, "").replace(/[^\p{L}\p{N}]+/gu, "");
function matchInstructor(name, people) {
  const k = normName(name);
  if (!k) return null;
  const exact = people.filter((p) => normName(p.display_name) === k);
  if (exact.length === 1) return exact[0];
  const part = people.filter((p) => { const n = normName(p.display_name); return n.startsWith(k) || k.startsWith(n); });
  return part.length === 1 ? part[0] : null;
}
function parseTime(t) {
  const m = String(t).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
}
function parseDate(d, today) {        // "12/12" or "12/12/2026" (day/month); without a year: the next such date from today
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const day = +m[1], mon = +m[2];
  let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
  if (y > 2500) y -= 543;                                 // Buddhist year
  const ok = (yy) => { const iso = isoOf(yy, mon - 1, day); return +iso.slice(5, 7) === mon && +iso.slice(8, 10) === day ? iso : null; };
  let iso = ok(y);
  if (iso && !m[3] && iso < today) iso = ok(y + 1);
  return iso;
}
// Reads lines into per-person intents. A line with any ✓ is an exact list for the month(s) it mentions:
// listed dates = in clinic, every other date of those months = not in. A line with only ✗ = off on those dates,
// the rest of those months back to the usual schedule.
function parseCalendarText(text, people, today) {
  const persons = new Map(), problems = [];
  for (const raw of String(text).split(/\n/)) {
    const line = raw.trim();
    const c = line.match(/^([^:：]{1,60})[:：](.*)$/);
    if (!c || !/\d{1,2}\/\d{1,2}/.test(c[2])) continue;      // headings and notes are skipped
    const who = matchInstructor(c[1], people);
    if (!who) { problems.push(`Name not found (or matches more than one): "${c[1].trim()}"`); continue; }
    const P = persons.get(who.user_id) || { user: who.user_id, name: who.display_name, exact: false, months: new Set(), days: new Map() };
    persons.set(who.user_id, P);
    let mode = "off";
    const body = c[2].replace(/[✓✔☑]|✅/g, ",✓,").replace(/[✗✘×❌]/g, ",✗,").replace(/[()]/g, " ")
      .replace(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(?=\d{1,2}\/\d{1,2})/g, "$1,");
    for (let tok of body.split(/[,;]+/)) {
      tok = tok.trim();
      if (!tok) continue;
      if (tok === "✓" || /^(in|ok|come)$/i.test(tok)) { mode = "in"; P.exact = true; continue; }
      if (tok === "✗" || /^(x|off|no)$/i.test(tok)) { mode = "off"; continue; }
      const m = tok.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\s*[-–]\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))?\s*(.*)$/);
      if (!m) { problems.push(`${who.display_name}: couldn't read "${tok}"`); continue; }
      const d1 = parseDate(m[1], today), d2 = m[2] ? parseDate(m[2], d1 || today) : d1;
      if (!d1 || !d2 || d2 < d1 || (Date.parse(d2) - Date.parse(d1)) / 864e5 > 120) { problems.push(`${who.display_name}: bad date "${tok}"`); continue; }
      const rest = m[3].toLowerCase().trim();
      let sess = ["AM", "PM"], from = null, until = null;
      if (/^(am|morning|เช้า)$/.test(rest)) sess = ["AM"];
      else if (/^(pm|afternoon|บ่าย)$/.test(rest)) sess = ["PM"];
      else if (rest) {
        const u = rest.match(/^(?:only\s+)?(?:until|before|till|ถึง|ก่อน)\s*([\d:.]+)$/), f = rest.match(/^(?:only\s+)?(?:from|after|หลัง|ตั้งแต่)\s*([\d:.]+)$/),
          b = rest.match(/^(?:only\s+)?(?:from\s+)?([\d:.]+)\s*(?:[-–]|to|ถึง)\s*([\d:.]+)$/);
        if (u) until = parseTime(u[1]); else if (f) from = parseTime(f[1]); else if (b) { from = parseTime(b[1]); until = parseTime(b[2]); }
        if ((u && !until) || (f && !from) || (b && (!from || !until || until <= from)) || (!u && !f && !b)) {
          problems.push(`${who.display_name}: couldn't read "${tok}"`); continue; }
      }
      for (let t = Date.parse(d1 + "T00:00:00Z"); t <= Date.parse(d2 + "T00:00:00Z"); t += 864e5) {
        const day = new Date(t).toISOString().slice(0, 10), dow = new Date(t).getUTCDay();
        if (dow === 0 || dow === 6) continue;
        P.months.add(day.slice(0, 7));
        if (day < today) { problems.push(`${who.display_name}: ${dm(day)} is in the past – skipped`); continue; }
        const D = P.days.get(day) || { inS: new Set(), offS: new Set(), lim: null };
        if (from || until) D.lim = { from, until };
        else for (const k of sess) (mode === "in" ? D.inS : D.offS).add(k);
        P.days.set(day, D);
      }
    }
  }
  return { persons: [...persons.values()], problems };
}
// usual(user, day) -> Set of scheduled sessions; hasRows(user, day) -> true if the date already has a planned change
function planCalendarChanges(persons, usual, hasRows, today) {
  const out = [];
  const both = (set) => (set.size === 2 ? "all" : set.size ? [...set][0] : null);
  for (const P of persons) {
    const days = new Set(P.days.keys());
    for (const ym of P.months) {                       // the rest of each mentioned month
      const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= last; d++) { const iso = isoOf(y, m, d), dow = new Date(Date.UTC(y, m, d)).getUTCDay();
        if (dow !== 0 && dow !== 6 && iso >= today) days.add(iso); }
    }
    for (const day of [...days].sort()) {
      const D = P.days.get(day), U = usual(P.user, day), had = hasRows(P.user, day);
      let ch = null;
      if (D?.lim) ch = { lim: D.lim, label: "in clinic only " + (D.lim.from && D.lim.until ? `${D.lim.from}–${D.lim.until}` : D.lim.until ? `until ${D.lim.until}` : `from ${D.lim.from}`) };
      else {
        const want = new Set(P.exact ? [...(D?.inS || [])].filter((k) => !D.offS.has(k)) : [...U].filter((k) => !(D?.offS || new Set()).has(k)));
        const extra = new Set([...want].filter((k) => !U.has(k))), off = new Set([...U].filter((k) => !want.has(k)));
        if (!extra.size && !off.size) { if (had) ch = { label: "usual schedule" }; }
        else ch = { extra: both(extra), off: both(off),
          label: want.size === 0 ? "off" : want.size === 2 ? "in clinic" : `in clinic ${[...want][0]} only` };
        if (ch && extra.size) ch.label += " (extra day)";
      }
      if (ch) out.push({ user: P.user, name: P.name, day, ...ch });
    }
  }
  return out;
}
function usualFromSchedule(rows) {        // weekly schedule rows -> (day) => Set of sessions
  return (day) => {
    const dt = new Date(day + "T00:00:00Z"), dow = dt.getUTCDay(), wk = Math.floor((dt.getUTCDate() - 1) / 7) + 1;
    return new Set(rows.filter((r) => r.weekday === dow && (!r.weeks || r.weeks.includes(wk))).map((r) => r.session_code));
  };
}
const importState = { text: "", preview: null, table: new Map() };   // table: user_id -> { mark: "✓" | "✗", dates }
function mergePersons(list) {
  const by = new Map();
  for (const P of list) {
    const Q = by.get(P.user);
    if (!Q) { by.set(P.user, P); continue; }
    Q.exact = Q.exact || P.exact;
    for (const m of P.months) Q.months.add(m);
    for (const [d, D] of P.days) Q.days.set(d, D);
  }
  return [...by.values()];
}
function importCard() {
  const card = el("div", { class: "card", id: "calImport" }, el("h2", { text: "Update instructors' days" }));
  if (!state.people.length) {
    card.append(el("p", { class: "empty", text: "Loading instructors…" }));
    loadPeople().then(render).catch((e) => banner(friendly(e), "error"));
    return card;
  }
  const inst = state.people.filter((p) => p.role === "instructor" && p.active)
    .sort((x, y) => ((x.instructor_kind || "internal") === "external") - ((y.instructor_kind || "internal") === "external") || x.display_name.localeCompare(y.display_name));
  const prev = el("div", { id: "calImportPreview" });
  const apply = el("button", { class: "primary hidden", type: "button", id: "calImportApply", disabled: state.busy });
  const stale = () => { importState.preview = null; prev.replaceChildren(); apply.classList.add("hidden"); };
  // three columns: instructor · ✓ / ✗ · dates
  const tbl = el("table", { class: "import-table", id: "calImportTable" },
    el("thead", {}, el("tr", {}, el("th", { text: "Instructor" }), el("th", { text: "✓ / ✗" }), el("th", { text: "Dates (day/month)" }))));
  const tb = el("tbody");
  let lastKind = null;
  for (const u of inst) {
    const kind = u.instructor_kind || "internal";
    if (kind !== lastKind) { tb.append(el("tr", { class: "group" }, el("td", { colspan: "3", text: kind === "external" ? "External" : "Internal" }))); lastKind = kind; }
    const st = importState.table.get(u.user_id) || { mark: "✗", dates: "" };
    const mark = el("select", { "aria-label": `${u.display_name}: coming or not`, "data-uid": u.user_id, class: "imp-mark" },
      el("option", { value: "✗", text: "✗ off" }), el("option", { value: "✓", text: "✓ in" }));
    mark.value = st.mark;
    const dates = el("input", { type: "text", "aria-label": `${u.display_name}: dates`, "data-uid": u.user_id, class: "imp-dates", maxlength: "300",
      placeholder: "12/12, 14/12 AM", autocomplete: "off" });
    dates.value = st.dates;
    const save = () => { importState.table.set(u.user_id, { mark: mark.value, dates: dates.value }); stale(); };
    mark.addEventListener("change", save); dates.addEventListener("input", save);
    tb.append(el("tr", {}, el("td", { class: "imp-name", text: u.display_name }), el("td", {}, mark), el("td", {}, dates)));
  }
  tbl.append(tb);
  // pasting a whole message still works (e.g. copied from LINE)
  const ta = el("textarea", { id: "calImportText", rows: "4", placeholder: "Dr Bee: ✗ 14/12, 15/12 AM\nDr Cat: ✓ 3/12, 10/12 until 10:00, 17/12" });
  ta.value = importState.text;
  ta.addEventListener("input", () => { importState.text = ta.value; stale(); });
  const paste = el("details", { class: "range-add", open: importState.text ? true : null }, el("summary", { text: "Or paste a message" }), ta);
  apply.onclick = () => {
    const ch = importState.preview?.changes || [];
    if (!ch.length) return;
    act(async () => {
      for (const c of ch) {
        await rpc("clear_day_off", { p_user_id: c.user, p_day: c.day, p_session: "all" });
        if (c.lim) await rpc("add_day_off", { p_user_id: c.user, p_from: c.day, p_to: c.day, p_session: "all", p_note: null, p_from_time: c.lim.from, p_until_time: c.lim.until });
        if (c.off) await rpc("add_day_off", { p_user_id: c.user, p_from: c.day, p_to: c.day, p_session: c.off, p_note: null });
        if (c.extra) await rpc("add_clinic_day", { p_user_id: c.user, p_day: c.day, p_session: c.extra });
      }
      importState.text = ""; importState.preview = null; importState.table = new Map(); clinicCal.summary = null;
      await loadClinicCalendar(true);
    }, `Calendar updated: ${ch.length} change${ch.length === 1 ? "" : "s"}.`);
  };
  const show = () => {
    const pv = importState.preview;
    if (!pv) return;
    prev.replaceChildren(
      pv.changes.length ? el("ul", { class: "list compact" }, ...pv.changes.map((c) => el("li", { class: "item" },
        el("div", { class: "main" }, el("div", { class: "name", text: `${c.name} · ${fmtDay(c.day)}` }), el("div", { class: "meta", text: c.label })))))
        : el("p", { class: "empty", text: "No changes." }),
      ...pv.problems.map((t) => el("p", { class: "warn", text: t })));
    apply.textContent = `Apply ${pv.changes.length} change${pv.changes.length === 1 ? "" : "s"}`;
    apply.classList.toggle("hidden", !pv.changes.length);
  };
  const check = el("button", { class: "ghost", type: "button", id: "calImportCheck", onclick: async () => {
    try {
      const today = bkkToday(), found = [], problems = [];
      for (const u of inst) {                                   // table rows: matched by account, not by name
        const st = importState.table.get(u.user_id);
        if (!st || !st.dates.trim()) continue;
        const r = parseCalendarText(`${u.display_name}: ${st.mark} ${st.dates}`, [u], today);
        found.push(...r.persons); problems.push(...r.problems);
      }
      const r = parseCalendarText(ta.value, inst, today);
      found.push(...r.persons); problems.push(...r.problems);
      const persons = mergePersons(found);
      const usual = new Map(), rows = new Map();
      await Promise.all(persons.map(async (P) => {
        const [sch, offs] = await Promise.all([rpc("admin_get_schedule", { p_user_id: P.user }), rpc("list_days_off", { p_user_id: P.user })]);
        usual.set(P.user, usualFromSchedule(sch || []));
        rows.set(P.user, offs || []);
      }));
      const hol = await loadHolidays(today, isoOf(+today.slice(0, 4), +today.slice(5, 7) + 13, 0));
      const changes = planCalendarChanges(persons, (u, d) => (hol.has(d) ? new Set() : usual.get(u)(d)),
        (u, d) => rows.get(u).some((x) => d >= x.day_from && d <= x.day_to), today);
      importState.preview = { changes, problems }; show();
    } catch (e) { banner(friendly(e), "error"); }
  } }, "Check");
  show();
  card.append(
    el("p", { class: "hint", text: "Fill in only the instructors whose days change. ✓ in = comes only on those dates that month (other usual days become off; extra days are added). " +
      "✗ off = off on those dates, the rest of the month as usual. Dates: 12/12, 14/12 AM, 15/12-18/12, 16/12 until 10:00, 17/12 from 13:00, 18/12 9:00-11:00. " +
      "Check shows every change before anything is saved." }),
    tbl, paste, el("div", { class: "row end" }, check, apply), prev);
  return card;
}
// ---------- holidays (admins) ----------
const holState = { list: null, status: null };
async function loadHolidayAdmin() {
  const t = bkkToday();
  const [list, st] = await Promise.all([rpc("list_holidays", { p_from: t, p_to: isoOf(+t.slice(0, 4) + 2, 0, 0) }), rpc("admin_holiday_sync_status")]);
  holState.list = list || []; holState.status = st || {};
}
function holidaysCard() {
  const card = el("div", { class: "card", id: "calHolidays" }, el("h2", { text: "Holidays" }),
    el("p", { class: "hint", text: "No usual clinic on these days (instructors can still add an extra day). Thai public holidays (including newly announced special days) are added automatically every week from the official holiday calendar; removing one keeps it removed." }));
  if (!holState.list) {
    card.append(el("p", { class: "empty", text: "Loading…" }));
    loadHolidayAdmin().then(render).catch((e) => banner(friendly(e), "error"));
    return card;
  }
  const st = holState.status || {};
  card.append(el("p", { class: "meta", id: "holSyncStatus", text: st.pending ? "Checking the online holiday calendar…" :
    st.last_run_at ? `Last automatic check: ${new Date(st.last_run_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" })}` +
      (st.last_error ? " (couldn't reach it, will retry next week)" : ` · ${st.last_added || 0} added`) : "Not checked yet." }));
  card.append(el("ul", { class: "list compact", id: "holList" }, ...(holState.list.length ? holState.list.map((h) => el("li", { class: "item" },
    el("div", { class: "main" }, el("div", { class: "name", text: fmtDay(h.day) + " " + h.day.slice(0, 4) }),
      el("div", { class: "meta", text: h.name + (h.source === "thai" ? " · Thai public holiday" : "") })),
    el("button", { class: "ghost small", type: "button", disabled: state.busy, onclick: () => act(async () => {
      await rpc("admin_remove_holiday", { p_day: h.day }); await loadHolidayAdmin(); await loadClinicCalendar(true); }, "Holiday removed.") }, "Remove")))
    : [el("li", { class: "empty", text: "No holidays added yet." })])));
  const d = el("input", { type: "date", id: "holDate", min: bkkToday() });
  const n = el("input", { type: "text", id: "holName", maxlength: "60", placeholder: "Name, e.g. Faculty anniversary" });
  card.append(el("div", { class: "section-title", text: "Add another holiday" }), d, n,
    el("div", { class: "row end" },
      el("button", { class: "ghost", type: "button", id: "holThai", disabled: state.busy, onclick: () => act(async () => {
        const r = await rpc("admin_add_thai_holidays"); await loadHolidayAdmin(); await loadClinicCalendar(true);
        banner(`${r?.added ?? 0} Thai public holidays added. Also checking the online calendar for any new ones.`, "ok"); }) }, "Add Thai public holidays now"),
      el("button", { class: "primary", type: "button", id: "holAdd", disabled: state.busy, onclick: () => {
        const nm = n.value.replace(/\s+/g, " ").trim();
        if (!d.value || !nm || nm.length > 60 || /[<>]/.test(nm)) { banner(MESSAGES.invalid_holiday, "error"); return; }
        act(async () => { await rpc("admin_add_holiday", { p_day: d.value, p_name: nm }); await loadHolidayAdmin(); await loadClinicCalendar(true); }, "Holiday added.");
      } }, "Add")));
  return card;
}
function summaryCard(keep) {
  const ta = el("textarea", { id: "calSummaryText", readonly: true, rows: "10" });
  const card = el("div", { class: "card", id: "calSummary" }, el("h2", { text: "Summary message" }),
    el("p", { class: "hint", text: "This month (from today) and next month, for all instructors shown above. Times show limited days." }));
  const make = el("button", { class: "primary", type: "button", id: "calSummaryMake", disabled: state.busy, onclick: async () => {
    try {
      const t = bkkToday(), y = +t.slice(0, 4), m = +t.slice(5, 7) - 1, end = isoOf(y, m + 2, 0);
      const [rows, hol] = await Promise.all([rpc("get_clinic_calendar", { p_from: t, p_to: end }), loadHolidays(t, end)]);
      clinicCal.summary = buildSummary(rows || [], t, end, hol); render();
    } catch (e) { banner(friendly(e), "error"); }
  } }, clinicCal.summary ? "Make again" : "Make summary");
  card.append(el("div", { class: "row" }, make));
  if (clinicCal.summary) {
    ta.value = clinicCal.summary;
    if (keep) ta.scrollTop = keep.scrollTop;
    card.append(ta, el("div", { class: "row end" },
      el("button", { class: "ghost", type: "button", id: "calSummaryCopy", onclick: async () => {
        try { await navigator.clipboard.writeText(clinicCal.summary); banner("Copied.", "ok"); }
        catch { ta.select(); document.execCommand?.("copy"); banner("Copied.", "ok"); }
      } }, "Copy"),
      el("a", { class: "button primary", id: "calSummaryLine", href: "https://line.me/R/share?text=" + encodeURIComponent(clinicCal.summary), target: "_blank", rel: "noopener" }, "Send in LINE")));
  }
  return card;
}
function renderSettings() {
  const box = $("settingsTab");
  if (state.schedule === null) { settingsCard = null; box.replaceChildren(el("p", { class: "empty", text: "Loading…" })); return; }
  if (settingsCard && box.contains(settingsCard)) return;
  box.replaceChildren();
  const { form, read } = accountForm({ profile: state.profile, schedule: state.schedule });
  const nameIn = el("input", { type: "text", id: "setName", maxlength: "40", autocomplete: "nickname" }); nameIn.value = state.profile.display_name;
  form.prepend(el("label", { for: "setName", text: "Your name or nickname" }), nameIn,
    el("div", { class: "warn", text: "Your own name or nickname only. No patient names or HN." }));
  const sum = summaryFields("set", { email: state.profile.email, freq: state.profile.summary_frequency, scope: state.profile.summary_scope,
    admin: () => $("acctAdmin")?.checked });
  form.addEventListener("change", sum.sync);
  const save = el("button", { class: "primary", type: "submit", id: "settingsSave", disabled: state.busy }, "Save");
  form.append(sum.node, el("div", { class: "row end" }, save));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = read(), c = sum.read();
    const nm = nameIn.value.replace(/\s+/g, " ").trim();
    if (!nm || nm.length > 40 || /[<>]/.test(nm)) { banner(MESSAGES.invalid_display_name, "error"); return; }
    if (!v.role) { banner(MESSAGES.invalid_role, "error"); return; }
    if (c.freq !== "none" && !c.email) { banner(MESSAGES.email_required_for_summary, "error"); return; }
    act(async () => {
      if (nm !== state.profile.display_name) await rpc("set_my_display_name", { p_display_name: nm });
      await rpc("update_my_account", { p_role: v.role, p_instructor_kind: v.kind, p_is_admin: v.isAdmin });
      await rpc("update_my_contact", { p_email: c.email || null, p_summary_frequency: c.freq, p_summary_scope: c.scope });
      if (v.role === "instructor" && v.kind === "internal") await rpc("set_my_schedule", { p_slots: v.slots });
      state.profile = ((await rpc("get_my_profile")) || [])[0] || state.profile;
      state.schedule = v.role === "instructor" ? ((await rpc("get_my_schedule")) || []) : [];
      settingsCard = null; applyTabs();
    }, "Settings saved.");
  });
  settingsCard = el("div", { class: "card" }, el("h2", { text: "Settings" }), form,
    state.profile.role === "instructor" ? daysOffSection(null, "set") : null);
  box.append(settingsCard);
}
function describeChange(c) {
  if (!c) return "";
  const lab = (x) => !x ? "" : (x.role === "instructor" ? (x.instructor_kind === "external" ? "external instructor" : "instructor") : (x.role || "")) + (x.is_admin ? " + admin" : "");
  if (c.from && c.to) return `${lab(c.from)} → ${lab(c.to)}`;
  if (c.active === false) return "disabled"; if (c.active === true) return "enabled";
  return "";
}
function renderPeople() {
  const box = $("peopleTab");
  const open = box.querySelector("li.editor");
  if (open && open.dataset.uid === state.editingPerson) return;   // don't wipe an edit in progress on background refresh
  box.replaceChildren();
  box.append(el("p", { class: "hint", text: "Newest changes first. Anyone can change their own role or admin setting; you can change it back here." }));
  const ul = el("ul", { class: "list" });
  for (const u of state.people) {
    const editing = state.editingPerson === u.user_id;
    const ov = u.instructor_resource_id ? state.overview.find((r) => r.resource_id === u.instructor_resource_id) : null;
    const meta = (u.last_change_at ? `${describeChange(u.last_change)} · ${u.last_change_by || "?"} · ${timeOf(u.last_change_at)}` : "No changes");
    const li = el("li", { class: "item person" + (u.active ? "" : " off") },
      el("div", { class: "main" },
        el("div", { class: "name" }, u.display_name,
          el("span", { class: "badge", text: u.role === "instructor" ? (u.instructor_kind === "external" ? "external instr." : "instructor") : u.role }),
          u.is_admin ? el("span", { class: "badge warn", text: "admin" }) : null,
          u.active ? null : el("span", { class: "badge oos", text: "disabled" })),
        el("div", { class: "meta", text: meta }),
        ov ? el("div", { class: "row status-line" }, statusBadge(ov),
          el("button", { class: "ghost small", type: "button", disabled: state.busy, onclick: () => setStatus(ov, false) }, "Set status")) : null),
      el("button", { class: "ghost small", type: "button", onclick: () => { state.editingPerson = editing ? null : u.user_id; $("peopleTab").replaceChildren(); render(); } }, editing ? "Close" : "Change"));
    ul.append(li);
    if (editing) ul.append(personEditor(u));
  }
  box.append(ul);
}
function personEditor(u) {
  const box = el("li", { class: "card editor", "data-uid": u.user_id });
  const name = el("input", { type: "text", maxlength: "40", id: "pName", value: u.display_name }); name.value = u.display_name;
  const role = el("select", { "aria-label": "Role", id: "pRole" }, ...[["resident", "Resident"], ["instructor:internal", "Instructor (internal)"], ["instructor:external", "Instructor (external)"]]
    .map(([v, t]) => el("option", { value: v, text: t })));
  role.value = u.role === "instructor" ? `instructor:${u.instructor_kind || "internal"}` : "resident";
  const adm = el("input", { type: "checkbox", id: "pAdmin" }); adm.checked = !!u.is_admin;
  const act_ = el("input", { type: "checkbox", id: "pActive" }); act_.checked = !!u.active;
  const schedWrap = el("div", { id: "pSchedBox" }, el("p", { class: "hint", text: "Loading schedule…" }));
  let readSlots = null;
  const syncSched = () => schedWrap.classList.toggle("hidden", role.value !== "instructor:internal");
  role.addEventListener("change", syncSched); syncSched();
  (u.role === "instructor" ? rpc("admin_get_schedule", { p_user_id: u.user_id }) : Promise.resolve([])).then((sch) => {
    const g = scheduleGrid(sch || [], "psch"); readSlots = g.slots;
    schedWrap.replaceChildren(el("label", { text: "Weekly clinic sessions" }), g.grid);
  }).catch((e) => banner(friendly(e), "error"));
  const sum = summaryFields("p", { email: u.email, freq: u.summary_frequency, scope: u.summary_scope, admin: () => adm.checked });
  adm.addEventListener("change", sum.sync);
  const offBox = u.role === "instructor" ? daysOffSection(u.user_id, "p") : null;
  box.append(el("label", { for: "pName", text: "Name" }), name, el("label", { for: "pRole", text: "Role" }), role,
    el("label", { class: "choice", for: "pAdmin" }, adm, " Admin"),
    el("label", { class: "choice", for: "pActive" }, act_, " Account enabled"), schedWrap, offBox, sum.node,
    el("div", { class: "row end" }, el("button", { class: "primary", type: "button", disabled: state.busy, onclick: () => {
      const [r, k] = role.value.split(":");
      const nm = name.value.replace(/\s+/g, " ").trim();
      if (!nm || nm.length > 40 || /[<>]/.test(nm)) { banner(MESSAGES.invalid_display_name, "error"); return; }
      const c = sum.read();
      if (c.freq !== "none" && !c.email) { banner(MESSAGES.email_required_for_summary, "error"); return; }
      act(async () => {
        if (nm !== u.display_name) await rpc("admin_set_display_name", { p_user_id: u.user_id, p_display_name: nm });
        await rpc("admin_update_user", { p_user_id: u.user_id, p_role: r, p_instructor_kind: k || null, p_is_admin: adm.checked, p_active: act_.checked });
        await rpc("admin_set_contact", { p_user_id: u.user_id, p_email: c.email || null, p_summary_frequency: c.freq, p_summary_scope: c.scope });
        if (r === "instructor" && k === "internal" && readSlots) await rpc("admin_set_schedule", { p_user_id: u.user_id, p_slots: readSlots() });
        state.editingPerson = null; $("peopleTab").replaceChildren(); await loadPeople();
      }, `Saved ${nm}.`);
    } }, "Save")));
  return box;
}

// ---------- privacy notice ----------
const PRIVACY_NOTICE_VERSION = 2;   // v2 (26 Nov 2026): open sign-up, self admin, email, "What for?", LINE messages
function setPrivacyLang(lang) {
  $("privacyTextEn").classList.toggle("hidden", lang !== "en");
  $("privacyTextTh").classList.toggle("hidden", lang !== "th");
  $("privacyEn").setAttribute("aria-pressed", String(lang === "en"));
  $("privacyTh").setAttribute("aria-pressed", String(lang === "th"));
}
function showPrivacy(required) {
  return new Promise((resolve) => {
    const d = $("privacyDialog");
    const onCancel = (ev) => { if (required) ev.preventDefault(); };   // Esc cannot skip the first-time notice
    d.addEventListener("cancel", onCancel);
    d.addEventListener("close", () => { d.removeEventListener("cancel", onCancel); resolve(); }, { once: true });
    d.showModal();
  });
}
async function ensurePrivacyAck() {
  let acked = true;
  try { acked = await rpc("get_my_privacy_ack", { p_notice_version: PRIVACY_NOTICE_VERSION }); }
  catch (e) { banner(friendly(e), "error"); return; }
  if (acked) return;
  await showPrivacy(true);
  try { await rpc("acknowledge_privacy_notice", { p_notice_version: PRIVACY_NOTICE_VERSION }); }
  catch (e) { banner(friendly(e), "error"); }
}

// ---------- Stage 2: scanners ----------
function askNote({ title, hint = "", label = "Note", required = true, category = false, okText = "Send" }) {
  return new Promise((resolve) => {
    const d = $("noteDialog");
    $("noteTitle").textContent = title; $("noteHint").textContent = hint; $("noteLabel").textContent = label;
    $("noteCategoryBox").classList.toggle("hidden", !category); $("noteOk").textContent = okText;
    $("noteText").value = ""; $("noteCategory").selectedIndex = 0;
    d.onclose = () => {
      if (d.returnValue !== "ok") return resolve(null);
      const note = $("noteText").value.replace(/\s+/g, " ").trim();
      if (required && !note) { banner(MESSAGES.note_required, "error"); return resolve(null); }
      if (note.length > 300) { banner(MESSAGES.invalid_fault_note, "error"); return resolve(null); }
      resolve({ note: note || null, category: $("noteCategory").value });
    };
    d.showModal(); $("noteText").focus();
  });
}
function machineBadge(m) {
  if (m.resource_status === "out_of_service") return el("span", { class: "badge oos", text: "Do not use" });
  if (m.resource_status === "issue_reported") return el("span", { class: "badge warn", text: "Problem reported" });
  if (m.in_use) return el("span", { class: "badge progress", text: isPrinter(m) ? (m.over_limit ? "Printing · not collected" : "Printing")
    : (m.over_limit ? "In use · over 30 min" : "In use") });
  return null;
}
function openMachine(id) {
  state.viewingMachine = id; state.viewing = null; syncChannels();
  Promise.all([loadMachineQueue(id), loadMachineFaults(id)]).then(render).catch((e) => banner(friendly(e), "error"));
  render();
}
function renderMachineList(type) {
  const box = $(type === "printer" ? "printersTab" : "scannersTab"); box.replaceChildren();
  const list = state.machines.filter((m) => m.resource_type === type);
  if (!list.length) { box.append(el("p", { class: "empty", text: `No ${type}s are set up yet.` })); return; }
  const ul = el("ul", { class: "list" });
  for (const m of list) {
    const busyText = isPrinter(m) ? `Printing for ${m.in_use_by} · free about ${timeOf(m.in_use_until)}` : `In use by ${m.in_use_by}` + (m.in_use_unit ? ` at unit ${m.in_use_unit}` : "") + ` since ${timeOf(m.in_use_since)}`;
    const meta = m.my_turn ? "Your turn — tap to start"
      : m.my_status === "in_progress" ? (isPrinter(m) ? `Your print · ready about ${timeOf(m.in_use_until)}` : "You are scanning now")
      : m.my_queue_entry_id ? `You are #${m.my_waiting_position} in line` + (m.my_ready ? " · ready" : "")
      : m.in_use ? busyText : "Tap to see the queue";
    ul.append(el("li", { class: "item" + (m.my_queue_entry_id ? " mine" : ""), onclick: () => openMachine(m.resource_id), role: "button", tabindex: "0" },
      el("div", { class: "avatar", style: `--h:${hueOf(m.resource_code)}`, text: (m.resource_name.match(/\d+/) || [initials(m.resource_name)])[0] }),
      el("div", { class: "main" }, el("div", { class: "name" }, m.resource_name, machineBadge(m)), el("div", { class: "meta", text: meta })),
      el("div", { class: "count", "data-load": m.waiting_count === 0 ? "free" : m.waiting_count <= 2 ? "low" : "high" },
        el("b", { text: String(m.waiting_count) }), "waiting")));
  }
  box.append(ul);
}
// ---------- scanners: unit number (scanners are carried to the chair) ----------
function lastUnit() { try { return localStorage.getItem("ocq_last_unit") || ""; } catch { return ""; } }
function askUnit(title = "Which dental unit are you at?", okText = "Join", current = null) {
  return new Promise((resolve) => {
    const d = $("unitDialog"), inp = $("machineUnit");
    $("unitTitle").textContent = title; $("unitOk").textContent = okText;
    inp.value = current ? String(current) : lastUnit();
    d.onclose = () => {
      if (d.returnValue !== "ok") return resolve(null);
      const n = Number(inp.value);
      if (!Number.isInteger(n) || n < 1 || n > 999) { banner(MESSAGES.invalid_dental_unit, "error"); return resolve(null); }
      try { localStorage.setItem("ocq_last_unit", String(n)); } catch { /* storage unavailable */ }
      resolve(n);
    };
    d.showModal(); inp.focus(); inp.select();
  });
}
function myMachineUnit(m) {
  const mine = (state.mqueues.get(m.resource_id) || []).find((q) => q.is_mine);
  return mine?.dental_unit ?? null;
}
function changeUnitButton(m, id) {
  return el("button", { class: "ghost", type: "button", disabled: state.busy, onclick: async () => {
    const n = await askUnit("Moved to another unit?", "Save", myMachineUnit(m));
    if (n) act(() => rpc("set_machine_unit", { p_queue_entry_id: id, p_dental_unit: n }), `Unit changed to ${n}.`);
  } }, "Change unit");
}
// ---------- printers: dialogs and reminders ----------
function askPrintTime(title = "How long is the print?", okText = "Start printing") {
  return new Promise((resolve) => {
    const d = $("printDialog"), h = $("printHours"), mi = $("printMinutes");
    if (!h.options.length) {
      for (let i = 0; i <= 47; i++) h.append(el("option", { value: String(i), text: `${i} h` }));
      for (let i = 0; i < 60; i += 5) mi.append(el("option", { value: String(i), text: `${i} min` }));
    }
    $("printTitle").textContent = title; $("printOk").textContent = okText;
    h.value = "1"; mi.value = "0";
    d.onclose = () => {
      if (d.returnValue !== "ok") return resolve(null);
      const total = Number(h.value) * 60 + Number(mi.value);
      if (total < 1) { banner(MESSAGES.invalid_print_time, "error"); return resolve(null); }
      resolve(total);
    };
    d.showModal();
  });
}
function askCollect() {
  return new Promise((resolve) => {
    const d = $("collectDialog");
    $("outcomeOk").checked = true; $("failBox").classList.add("hidden"); $("failReason").selectedIndex = 0; $("failNote").value = "";
    for (const r of d.querySelectorAll("input[name=outcome]")) r.onchange = () => $("failBox").classList.toggle("hidden", !$("outcomeFailed").checked);
    d.onclose = () => {
      if (d.returnValue !== "ok") return resolve(null);
      if ($("outcomeOk").checked) return resolve({ outcome: "success", reason: null, note: null });
      const note = $("failNote").value.replace(/\s+/g, " ").trim();
      if (note.length > 300) { banner(MESSAGES.invalid_fault_note, "error"); return resolve(null); }
      resolve({ outcome: "failed", reason: $("failReason").value, note: note || null });
    };
    d.showModal();
  });
}
async function collect(entryId, forSomeoneElse = false) {
  const c = await askCollect();
  if (!c) return;
  act(async () => {
    const r = await rpc("collect_print", { p_queue_entry_id: entryId, p_outcome: c.outcome, p_failure_reason: c.reason, p_note: c.note });
    banner(c.outcome === "success" ? "Collected. The printer is free for the next person."
      : (r?.report_id ? "Recorded as failed. The technicians have been told about the printer fault." : "Recorded as failed.") +
        (forSomeoneElse ? "" : " To reprint, join the queue again."), "ok");
  });
}
const remindersShown = new Set();
function checkPrintReminders() {   // in-app reminders while the app is open (no LINE messages)
  const now = Date.now();
  for (const m of state.machines) {
    if (!isPrinter(m) || m.my_status !== "in_progress" || !m.in_use_until) continue;
    const end = new Date(m.in_use_until).getTime();
    const key10 = m.my_queue_entry_id + "@" + m.in_use_until + ":10", keyEnd = m.my_queue_entry_id + "@" + m.in_use_until + ":end";
    if (now >= end && !remindersShown.has(keyEnd)) { remindersShown.add(keyEnd); remindersShown.add(key10);
      banner(`Your print on ${m.resource_name} should be done. Collect it within 15 minutes, then tap Collected.`, "ok"); navigator.vibrate?.(300); }
    else if (now >= end - 10 * 60000 && now < end && !remindersShown.has(key10)) { remindersShown.add(key10);
      banner(`Your print on ${m.resource_name} finishes in about 10 minutes.`, "ok"); navigator.vibrate?.(200); }
  }
}
setInterval(checkPrintReminders, 30000);

// The card shown for my own place in a machine queue (My queue tab and machine view).
function machineStatusCard(m, onMachinePage = false) {
  const id = m.my_queue_entry_id;
  if (m.my_status === "in_progress" && isPrinter(m)) {
    const late = m.in_use_until && Date.now() > new Date(m.in_use_until).getTime();
    return el("div", { class: "turn" }, el("div", { class: "big", text: `Printing on ${m.resource_name}` }),
      el("div", { class: "until", text: (late ? "Should be done since " : "Ready about ") + timeOf(m.in_use_until) +
        (m.over_limit ? " · please collect it now" : "") }),
      el("div", { class: "row", style: "margin-top:10px" },
        el("button", { type: "button", disabled: state.busy, onclick: () => collect(id) }, "Collected"),
        el("button", { type: "button", disabled: state.busy, onclick: async () => {
          const extra = await askPrintTime("Add more time", "Add time");
          if (extra) act(() => rpc("extend_print", { p_queue_entry_id: id, p_extra_minutes: extra }), "Time added.");
        } }, "Add time")));
  }
  if (m.my_status === "in_progress") {
    return el("div", { class: "turn" }, el("div", { class: "big", text: `Scanning on ${m.resource_name}` }),
      el("div", { text: (m.in_use_unit ? `Unit ${m.in_use_unit} · ` : "") + `Started ${timeOf(m.in_use_since)}` + (m.over_limit ? " · over the 30-minute limit" : "") }),
      el("div", { class: "row", style: "margin-top:10px" }, el("button", { type: "button", disabled: state.busy,
        onclick: () => act(() => rpc("finish_machine_turn", { p_queue_entry_id: id }), "Finished. The scanner is free for the next person.") }, "Finish"),
        changeUnitButton(m, id)));
  }
  if (m.my_turn) {
    return el("div", { class: "turn" }, el("div", { class: "big", text: "Your turn" }),
      el("div", { text: `${m.resource_name} is free and you are next.` }),
      el("div", { class: "row", style: "margin-top:10px" }, isPrinter(m)
        ? el("button", { type: "button", disabled: state.busy, onclick: async () => {
            const mins = await askPrintTime();
            if (mins) act(() => rpc("start_print_turn", { p_queue_entry_id: id, p_print_minutes: mins }), "Printing started. You'll see a reminder here near the end.");
          } }, "Start printing")
        : el("button", { type: "button", disabled: state.busy,
            onclick: () => act(() => rpc("start_machine_turn", { p_queue_entry_id: id }), "Started. Tap Finish when you are done.") }, "Start scanning")));
  }
  return el("div", { class: "card" },
    el("div", { class: "name", text: m.resource_name }),
    el("div", { class: "big-number", text: `#${m.my_waiting_position}` }),
    el("div", { class: "meta", text: m.my_ready ? "You are marked ready. Wait for “Your turn”." :
      `Tap “I'm ready” when you are at the ${kindWord(m)}. Until then you keep your place but others who are ready can go first.` }),
    el("div", { class: "row", style: "margin-top:8px" },
      el("button", { class: m.my_ready ? "ghost" : "primary", type: "button", disabled: state.busy,
        onclick: () => act(() => rpc("set_machine_ready", { p_queue_entry_id: id, p_ready: !m.my_ready }), m.my_ready ? "Marked not ready." : "Marked ready.") },
        m.my_ready ? "Not ready yet" : (isPrinter(m) ? "I'm ready to print" : "I'm ready to scan")),
      onMachinePage ? null : el("button", { class: "ghost", type: "button", onclick: () => openMachine(m.resource_id) }, "View queue"),
      !isPrinter(m) && onMachinePage ? changeUnitButton(m, id) : null,
      el("button", { class: "danger", type: "button", disabled: state.busy, onclick: async () => {
        if (await askConfirm(`Leave the ${m.resource_name} queue?`)) act(() => rpc("cancel_my_entry", { p_queue_entry_id: id }), "You have left the queue."); } }, "Leave")));
}
function renderMachineView(id) {
  const box = $("machineTab"); box.replaceChildren();
  box.append(el("div", { class: "row" }, el("button", { class: "ghost small", type: "button",
    onclick: () => { state.viewingMachine = null; syncChannels(); render(); } }, "‹ Back")));
  const m = state.machines.find((x) => x.resource_id === id);
  if (!m) { box.append(el("p", { class: "empty", text: "This machine is no longer available." })); return; }
  const rows = state.mqueues.get(id) || [];
  const faults = state.mfaults.get(id) || [];
  const reportBtn = el("button", { class: "danger small", type: "button", disabled: state.busy, onclick: async () => {
    const n = await askNote({ title: `Report a problem: ${m.resource_name}`, hint: "Technicians and admins are told straight away. The queue keeps running.",
      label: "Details (optional)", required: false, category: true });
    if (n) act(() => rpc("report_fault", { p_resource_id: id, p_category: n.category, p_note: n.note }), "Problem reported. Thank you.");
  } }, "Report a problem");
  const useBtns = !isAdmin() ? null : el("div", { class: "row" }, ...useButtons(id, m.resource_name, m.resource_status));
  const card = el("div", { class: "card" },
    el("div", { class: "row", style: "justify-content:space-between" }, el("h2", {}, m.resource_name, machineBadge(m)), reportBtn),
    useBtns,
    el("div", { class: "meta", text: `${m.resource_status === "available" && m.in_use ? "In use" : (STATUS_LABEL[m.resource_status] || m.resource_status)} · ${m.waiting_count} waiting · ${m.ready_count} ready` }),
    !isPrinter(m) && m.in_use && m.in_use_unit ? el("div", { class: "where", text: `Scanner is at unit ${m.in_use_unit}` }) : null);
  if (!rows.length) card.append(el("p", { class: "empty", text: "Nobody is waiting." }));
  else {
    const list = el("ul", { class: "list" });
    for (const q of rows) {
      const meta = (q.status === "in_progress" ? (isPrinter(m) ? `printing · ready about ${timeOf(q.expected_end_at)}` : `scanning since ${timeOf(q.started_at)}`)
        : `joined ${timeOf(q.joined_at)}`);
      list.append(el("li", { class: "item" + (q.is_mine ? " mine" : "") + (q.status === "in_progress" ? " progress" : "") },
        el("div", { class: "pos", text: q.status === "in_progress" ? "▶" : String(q.waiting_position) }),
        !isPrinter(m) && q.dental_unit ? unitBig(q.dental_unit) : null,
        el("div", { class: "main" },
          el("div", { class: "name" }, q.display_name, q.is_mine ? " (you)" : "",
            q.status === "waiting" && q.ready ? el("span", { class: "badge ready", text: "Ready" }) : null,
            q.is_next ? el("span", { class: "badge progress", text: "Next" }) : null,
            q.over_limit ? el("span", { class: "badge warn", text: isPrinter(m) ? "Not collected" : "Over 30 min" }) : null),
          el("div", { class: "meta", text: meta })),
        isStaff() && q.status === "in_progress" && !q.is_mine ? el("button", { class: "ghost small", type: "button", disabled: state.busy,
          onclick: async () => {
            if (isPrinter(m)) return collect(q.queue_entry_id, true);
            if (await askConfirm(`Finish ${q.display_name}'s turn for them? This is recorded.`))
              act(() => rpc("finish_machine_turn", { p_queue_entry_id: q.queue_entry_id }), "Turn finished."); } },
          isPrinter(m) ? "Collect for them" : "Finish for them") : null));
    }
    card.append(list);
  }
  card.append(el("div", { class: "live", text: state.channels.has(id) ? "Live updates on" : "" }));
  box.append(card);
  if (m.my_queue_entry_id) box.append(machineStatusCard(m, true));

  if (!m.my_queue_entry_id) {
    const canJoin = m.resource_status !== "out_of_service";     // machines are open all day
    box.append(el("div", { class: "card" },
      el("p", { class: "meta", text: canJoin ? `Join now and tap “I'm ready” when you are at the ${kindWord(m)}.` : `Do not use: this ${kindWord(m)} has been taken out of use by an admin.` }),
      el("button", { class: "primary", type: "button", disabled: !canJoin || state.busy, onclick: async () => {
        const unit = isPrinter(m) ? null : await askUnit();
        if (!isPrinter(m) && !unit) return;
        act(async () => {
          const r = await rpc("join_machine_queue", { p_request_id: uuid(), p_resource_id: id, p_dental_unit: unit });
          banner(`Joined: you are number ${r.queue_number}.`, "ok");
        });
      } }, "Join queue")));
  }

  if (!faults.length && !isStaff()) return;          // nothing to show; reporting is at the top
  const fcard = el("div", { class: "card" }, el("h2", { text: "Problems" }));
  if (!faults.length) fcard.append(el("p", { class: "meta", text: "No problems reported." }));
  for (const f of faults) {
    fcard.append(el("div", { class: "fault" },
      el("div", { class: "name", text: FAULT_LABEL[f.category] || f.category }),
      f.note ? el("div", { text: f.note }) : null,
      el("div", { class: "meta", text: `Reported ${timeOf(f.created_at)}` + (f.same_problem_count ? ` · ${f.same_problem_count} others same problem` : "") +
        (f.status === "confirmed" ? " · confirmed" : "") }),
      f.status === "open" && !f.is_mine ? el("button", { class: "ghost small", type: "button", disabled: state.busy || f.i_seconded,
        onclick: () => act(() => rpc("second_fault", { p_report_id: f.report_id }), "Thanks — added to the report.") },
        f.i_seconded ? "You reported the same" : "Same problem") : null,
      isStaff() && f.status === "open" ? el("button", { class: "ghost small", type: "button", disabled: state.busy, onclick: async () => {
        const n = await askNote({ title: "Dismiss report", hint: "Say what you checked.", okText: "Dismiss" });
        if (n) act(() => rpc("dismiss_fault", { p_report_id: f.report_id, p_note: n.note }), "Report dismissed."); } }, "Dismiss") : null));
  }
  box.append(fcard);
}
function renderFaults() {
  const box = $("faultsTab"); box.replaceChildren();
  const b = state.board;
  if (!b) { box.append(el("p", { class: "empty", text: "Loading…" })); return; }
  box.append(el("div", { class: "section-title", text: `Problem reports (${b.faults.length})` }));
  if (!b.faults.length) box.append(el("p", { class: "empty", text: "No open reports." }));
  for (const f of b.faults) {
    box.append(el("div", { class: "fault", onclick: () => openMachine(f.resource_id), role: "button", tabindex: "0" },
      el("div", { class: "name" }, f.resource_name, f.status === "confirmed" ? el("span", { class: "badge oos", text: "Out of service" }) : null),
      el("div", { text: (FAULT_LABEL[f.category] || f.category) + (f.note ? " — " + f.note : "") }),
      el("div", { class: "meta", text: `${f.reported_by} · ${timeOf(f.created_at)}` + (f.same_problem_count ? ` · +${f.same_problem_count} same` : "") })));
  }
  box.append(el("div", { class: "section-title", text: `Over the time limit (${b.over_limit.length})` }));
  if (!b.over_limit.length) box.append(el("p", { class: "empty", text: "Nobody is over the limit." }));
  for (const o of b.over_limit) {
    box.append(el("div", { class: "fault", onclick: () => openMachine(o.resource_id), role: "button", tabindex: "0" },
      el("div", { class: "name", text: o.resource_name }),
      el("div", { class: "meta", text: o.resource_type === "printer"
        ? `${o.display_name} · print not collected (due ${timeOf(o.expected_end_at)})` : `${o.display_name} · ${o.minutes} min (limit ${o.limit_minutes})` })));
  }
}
let addMachineForm = null;   // built once so typing survives redraws
function useButtons(id, name, status) {   // "Do not use" / "OK to use" — machine page and admin Machines tab
  return [
    status !== "out_of_service" ? el("button", { class: "danger small", type: "button", disabled: state.busy, onclick: async () => {
      const n = await askNote({ title: `Do not use: ${name}`, hint: "Everyone sees 'Do not use'. New joins and starts are blocked; people waiting keep their place.", label: "Reason", okText: "Do not use" });
      if (n) act(() => rpc("set_machine_out_of_service", { p_resource_id: id, p_note: n.note }), "Marked 'Do not use'."); } }, "Do not use") : null,
    status !== "available" ? el("button", { class: "primary small", type: "button", disabled: state.busy, onclick: async () => {
      const n = await askNote({ title: `OK to use: ${name}`, hint: "Short note on what was fixed or checked.", okText: "OK to use" });
      if (n) act(() => rpc("set_machine_back_in_service", { p_resource_id: id, p_note: n.note }), "Marked OK to use."); } }, "OK to use") : null];
}
function renderAdminMachines() {
  const box = $("machinesTab"); box.replaceChildren();
  const list = el("ul", { class: "list" });
  for (const m of state.adminMachines) {
    list.append(el("li", { class: "item" },
      el("div", { class: "main" },
        el("div", { class: "name" }, m.resource_name, m.active ? null : el("span", { class: "badge oos", text: "Retired" }),
          m.active && m.resource_status === "out_of_service" ? el("span", { class: "badge oos", text: "Do not use" }) : null),
        el("div", { class: "meta", text: `${m.resource_code} · ${m.resource_type} · ${STATUS_LABEL[m.resource_status] || m.resource_status}` +
          (m.active_entries ? ` · ${m.active_entries} in queue` : "") })),
      el("div", { class: "row" },
        ...(m.active ? useButtons(m.resource_id, m.resource_name, m.resource_status) : []),
        el("button", { class: "ghost small", type: "button", disabled: state.busy, onclick: async () => {
          const n = await askNote({ title: `Rename ${m.resource_name}`, label: "New name", okText: "Save" });
          if (n) act(() => rpc("admin_rename_machine", { p_resource_id: m.resource_id, p_name: n.note }), "Renamed."); } }, "Rename"),
        el("button", { class: m.active ? "danger small" : "primary small", type: "button", disabled: state.busy, onclick: async () => {
          if (await askConfirm(m.active ? `Retire ${m.resource_name}? It disappears from the app; its history is kept.` : `Bring ${m.resource_name} back?`))
            act(() => rpc("admin_set_machine_active", { p_resource_id: m.resource_id, p_active: !m.active }), m.active ? "Retired." : "Restored.");
        } }, m.active ? "Retire" : "Restore"))));
  }
  if (!addMachineForm) {
    const type = el("select", { id: "newMachineType" }, el("option", { value: "scanner", text: "Intraoral scanner" }), el("option", { value: "printer", text: "3D printer" }));
    const code = el("input", { id: "newMachineCode", maxlength: "20", placeholder: "Code, e.g. SC3" });
    const name = el("input", { id: "newMachineName", maxlength: "40", placeholder: "Name, e.g. Scanner 3 (iTero)" });
    addMachineForm = el("form", { class: "card" }, el("h2", { text: "Add a machine" }), type, code, name,
      el("div", { class: "row end" }, el("button", { class: "primary", type: "submit" }, "Add")));
    addMachineForm.addEventListener("submit", (ev) => { ev.preventDefault();
      act(async () => {
        await rpc("admin_add_machine", { p_resource_type: type.value, p_code: code.value, p_name: name.value });
        code.value = ""; name.value = "";              // clear only after success
        banner("Machine added.", "ok");
      }); });
  }
  addMachineForm.querySelector("button[type=submit]").disabled = state.busy;
  const form = addMachineForm;
  box.append(el("div", { class: "section-title", text: "Scanners and printers" }),
    state.adminMachines.length ? list : el("p", { class: "empty", text: "No machines yet." }), form);
}

// ---------- start-up ----------
const VIEWS = ["calendar", "mine", "all", "scanners", "printers"];
function wantedView() {
  const v = new URLSearchParams(location.search).get("view") || location.hash.replace(/^#/, "");
  if (VIEWS.includes(v)) { try { sessionStorage.setItem("ocq_view", v); } catch {} return v; }
  try { return sessionStorage.getItem("ocq_view"); } catch { return null; }
}
function applyWantedView() {
  const v = wantedView();
  try { sessionStorage.removeItem("ocq_view"); } catch {}
  if (!v) return;
  if (["scanners", "printers"].includes(v) && !machineTabsForMe()) return;
  state.tab = v; state.viewing = null; state.viewingMachine = null;
}
async function start() {
  wantedView();      // remember a menu link's view before any sign-in redirect
  window.addEventListener("hashchange", () => { if (state.profile) { applyWantedView(); applyTabs(); syncChannels(); render(); refreshAll(); } });
  $("envLabel").textContent = C.environmentLabel || "";
  $("tabScanners").classList.add("hidden"); $("tabPrinters").classList.add("hidden");   // shown by applyTabs once we know the role
  $("lineLoginBtn").onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: C.lineProvider, options: { redirectTo: location.origin + location.pathname } });
    if (error) banner(friendly(error), "error");
  };
  $("privacyEn").onclick = () => setPrivacyLang("en");
  $("privacyTh").onclick = () => setPrivacyLang("th");
  $("privacyLink").onclick = () => showPrivacy(false);
  $("signOutBtn").onclick = async () => { await sb.removeAllChannels(); await sb.auth.signOut(); location.reload(); };
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => {
    state.tab = b.dataset.tab; state.viewing = null; state.viewingMachine = null; $("queueTab").dataset.rid = ""; syncChannels(); render(); refreshAll(); };

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show("signInView"); return; }
  await sb.realtime.setAuth(session.access_token);
  sb.auth.onAuthStateChange((event, s) => { if (s && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) sb.realtime.setAuth(s.access_token); });

  let profile = [];
  try { profile = (await rpc("get_my_profile")) || []; } catch (e) { banner(friendly(e), "error"); }
  if (!profile.length) { renderSetup(); show("setupView"); return; }
  await enterApp(profile[0]);
}
let appStarted = false;
async function enterApp(profile) {
  state.profile = profile;
  await ensurePrivacyAck();
  if (state.profile.role === "admin") state.tab = "all";
  applyWantedView();
  applyTabs();
  show("mainView");
  await recoverPendingJoin();
  await refreshAll();

  if (appStarted) return;
  appStarted = true;
  // Safety net: slow refresh while visible; immediate refresh when the app comes back.
  setInterval(() => { if (document.visibilityState === "visible") refreshAll(); }, (C.safetyRefreshSeconds || 60) * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAll(); });
  window.addEventListener("online", () => { recoverPendingJoin().then(refreshAll); });
}
start().catch((e) => banner(friendly(e), "error"));
