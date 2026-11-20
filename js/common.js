// Shared helpers used by all pages
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Show a message inside an element (type: "error" | "success" | "info")
export function showMessage(el, text, type = "error") {
  el.textContent = text;
  el.className = `message ${type}`;
  el.hidden = !text;
}

// Read the user's profile (name, role) from Firestore
export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Protect a page: only logged-in users with the given role can stay on it.
// Calls onReady(user, profile) when the user is allowed.
// role can be "student", "instructor", or "any" (any logged-in user)
export function requireRole(role, onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }
    const profile = await getProfile(user.uid);
    if (!profile) { await signOut(auth); window.location.href = "index.html"; return; }
    if (role !== "any" && profile.role !== role) { window.location.href = pageForRole(profile.role); return; }
    // PBI-16: Log out
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn && !logoutBtn.dataset.ready) {
      logoutBtn.dataset.ready = "1";
      logoutBtn.addEventListener("click", async () => {
        await signOut(auth);
        window.location.href = "index.html";
      });
    }
    // Profile / dashboard links point to the right page for the role
    document.querySelectorAll("[data-dashboard-link]").forEach(a => a.href = pageForRole(profile.role));
    document.getElementById("user-name").textContent = profile.name;
    const initials = profile.name.trim().split(/\s+/).slice(0,2).map(part => part[0]?.toUpperCase() || '').join('');
    const headerInitials = document.getElementById("header-initials");
    if (headerInitials) headerInitials.textContent = initials || "OH";
    document.body.hidden = false;
    onReady(user, profile);
  });
}

export function pageForRole(role) {
  return role === "instructor" ? "instructor.html" : "student.html";
}

// "2026-10-30" -> "Thu, 30 Oct 2026"
export function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// "14:30" -> "2:30 PM"
export function formatTime(t) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

// Converts a slot's date + time into a JS Date
export function toDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`);
}

// Escape text before putting it into HTML
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Builds the "where" part of a slot (location and/or meeting link)
export function placeHtml(slot) {
  const parts = [];
  if (slot.location) parts.push(`<span>📍 ${esc(slot.location)}</span>`);
  if (slot.meetingLink) {
    try {
      const link = new URL(String(slot.meetingLink));
      if (link.protocol === "https:" || link.protocol === "http:")
        parts.push(`<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">🔗 Meeting link</a>`);
    } catch { /* Ignore invalid stored links. */ }
  }
  return parts.join(" ");
}

// Is a slot/booking still upcoming (its end time has not passed)?
export function isUpcoming(item) {
  return toDateTime(item.date, item.endTime) > new Date();
}

// Small reusable confirmation dialog. Returns a Promise<boolean>.
export function confirmAction(title, html, confirmText = "Confirm") {
  let dlg = document.getElementById("action-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "action-dialog";
    dlg.innerHTML = `<h3 id="action-title"></h3><div id="action-body"></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" id="action-cancel">Back</button>
      <button type="button" class="btn" id="action-ok"></button></div>`;
    document.body.appendChild(dlg);
  }
  dlg.querySelector("#action-title").textContent = title;
  dlg.querySelector("#action-body").innerHTML = html;
  dlg.querySelector("#action-ok").textContent = confirmText;
  return new Promise(resolve => {
    const ok = dlg.querySelector("#action-ok"), cancel = dlg.querySelector("#action-cancel");
    const done = (v) => { ok.onclick = cancel.onclick = null; dlg.close(); resolve(v); };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

// Shared validation for creating / editing a slot (PBI-01, PBI-08, PBI-09)
export function validateSlot({ date, startTime, endTime, location, meetingLink }, otherSlots) {
  if (!date || !startTime || !endTime) return "Please enter a date, start time, and end time.";
  const start = toDateTime(date, startTime), end = toDateTime(date, endTime);
  if (end <= start) return "End time must be after start time.";
  if (start <= new Date()) return "You cannot add a slot in the past.";
  if (!location && !meetingLink) return "Add an office location, a meeting link, or both.";
  if (meetingLink) {
    try { const u = new URL(meetingLink); if (u.protocol !== "https:" && u.protocol !== "http:") throw 0; }
    catch { return "Enter a valid meeting link beginning with https:// or http://."; }
  }
  const overlap = otherSlots.find(s => !s.cancelled && s.date === date &&
    start < toDateTime(s.date, s.endTime) && end > toDateTime(s.date, s.startTime));
  if (overlap) return `This time overlaps with your ${formatTime(overlap.startTime)} – ${formatTime(overlap.endTime)} session.`;
  return "";
}
