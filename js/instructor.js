// Instructor dashboard: real Firestore office-hour slots + date-first calendar UI.
// PBI-01: Add Available Office-Hour Slots; PBI-08: Location / Meeting Link
import { db } from "./firebase-config.js";
import { sendInstructorCancellation } from "./email-notifications.js";
// Sprint 2: PBI-03 View booked appointments, PBI-09 Update a slot, PBI-11 Cancel a slot
import {
  collection, addDoc, query, where, getDocs, serverTimestamp, doc, updateDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { requireRole, showMessage, formatDate, formatTime, toDateTime, esc, placeHtml,
  isUpcoming, confirmAction, validateSlot } from "./common.js";

const form = document.getElementById("slot-form");
const msg = document.getElementById("message");
const list = document.getElementById("slot-list");
const bookedList = document.getElementById("booked-list");
const listMsg = document.getElementById("list-message");
const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editMsg = document.getElementById("edit-message");
let myBookings = [];
const calendarGrid = document.getElementById("instructor-calendar-grid");
const monthLabel = document.getElementById("instructor-month-label");
const prevMonth = document.getElementById("instructor-prev-month");
const nextMonth = document.getElementById("instructor-next-month");
const dayTitle = document.getElementById("instructor-selected-day");
const dayPreview = document.getElementById("instructor-day-preview");
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayLocal = () => isoLocal(new Date());

let currentUser, currentProfile;
let mySlots = [];
let selectedDate = todayLocal();
let shownMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
form.elements.date.min = todayLocal();
form.elements.date.value = selectedDate;

requireRole("instructor", (user, profile) => {
  currentUser = user;
  currentProfile = profile;
  renderCalendar();
  renderDayPreview();
  loadMySlots();
  loadBookedAppointments();
});

function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:"; }
  catch { return false; }
}

function renderCalendar() {
  monthLabel.textContent = shownMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const year = shownMonth.getFullYear(), month = shownMonth.getMonth();
  const leadingDays = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const countMap = new Map();
  mySlots.forEach(slot => {
    if (!slot.cancelled && !slot.booked && toDateTime(slot.date, slot.startTime) > new Date()) {
      countMap.set(slot.date, (countMap.get(slot.date) || 0) + 1);
    }
  });

  let html = Array.from({ length: leadingDays }, () => '<span class="calendar-blank"></span>').join("");
  for (let day = 1; day <= days; day++) {
    const date = isoLocal(new Date(year, month, day));
    const past = date < todayLocal();
    const selected = date === selectedDate;
    const open = countMap.get(date) || 0;
    const info = open ? `${open} available slots` : 'no available slots';
    html += `<button type="button" data-date="${date}" class="calendar-day instructor-day ${open ? 'has-slots has-open' : ''} ${selected ? 'is-selected' : ''}" ${past ? 'disabled' : ''} aria-pressed="${selected}" aria-label="${esc(formatDate(date))}, ${info}"><b>${day}</b><span class="instructor-date-markers">${open ? '<i class="date-dot open" aria-hidden="true"></i>' : ''}</span></button>`;
  }
  calendarGrid.innerHTML = html;
  const now = new Date();
  prevMonth.disabled = year === now.getFullYear() && month === now.getMonth();
}

function renderDayPreview() {
  dayTitle.textContent = selectedDate ? formatDate(selectedDate) : "Choose a day";
  const daySlots = mySlots.filter(s => s.date === selectedDate && !s.cancelled && !s.booked && toDateTime(s.date, s.startTime) > new Date())
    .sort((a,b) => a.startTime.localeCompare(b.startTime));
  if (!daySlots.length) {
    dayPreview.innerHTML = '<p class="empty day-empty">No available slots on this day. Add a new time slot below.</p>';
    return;
  }
  dayPreview.innerHTML = daySlots.map(s =>
    `<div class="day-session"><div><strong>${esc(formatTime(s.startTime))} – ${esc(formatTime(s.endTime))}</strong><small>${placeHtml(s)}</small></div><span class="badge free">Available</span></div>`
  ).join("");
}

function selectDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayLocal()) return;
  selectedDate = date;
  shownMonth = new Date(Number(date.slice(0,4)), Number(date.slice(5,7)) - 1, 1);
  form.elements.date.value = date;
  renderCalendar();
  renderDayPreview();
}
calendarGrid.addEventListener("click", e => {
  const target = e.target.closest("button[data-date]");
  if (!target || target.disabled) return;
  selectDay(target.dataset.date);
});
prevMonth.addEventListener("click", () => {
  if (prevMonth.disabled) return;
  shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1);
  renderCalendar();
});
nextMonth.addEventListener("click", () => {
  shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1);
  renderCalendar();
});
form.elements.date.addEventListener("change", e => {
  if (e.target.value && e.target.value >= todayLocal()) selectDay(e.target.value);
});
document.getElementById("instructor-add-on-day").addEventListener("click", () => {
  document.getElementById("instructor-add-form-section").scrollIntoView({behavior:"smooth",block:"start"});
  form.elements.startTime.focus({ preventScroll: true });
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  const date = form.elements.date.value;
  const startTime = form.elements.startTime.value;
  const endTime = form.elements.endTime.value;
  const location = form.elements.location.value.trim();
  const meetingLink = form.elements.meetingLink.value.trim();
  const error = validateSlot({ date, startTime, endTime, location, meetingLink }, mySlots);
  if (error) return showMessage(msg, error);

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await addDoc(collection(db,"slots"), {
      instructorId:currentUser.uid, instructorName:currentProfile.name,
      date,startTime,endTime,location,meetingLink,
      booked:false,bookedBy:null,bookedByName:null,createdAt:serverTimestamp()
    });
    showMessage(msg,"Your office-hour slot is now available for students to book.","success");
    form.elements.startTime.value = "";
    form.elements.endTime.value = "";
    form.elements.location.value = "";
    form.elements.meetingLink.value = "";
    selectDay(date);  // Keep the chosen date for creating more sessions.
    await loadMySlots();
  } catch (err) {
    console.error(err);
    showMessage(msg,"Could not save the slot. Please try again or check your database permissions.");
  } finally { btn.disabled = false; }
});

async function loadMySlots() {
  try {
    const q = query(collection(db,"slots"),where("instructorId","==",currentUser.uid));
    const snap = await getDocs(q);
    mySlots = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>toDateTime(a.date,a.startTime)-toDateTime(b.date,b.startTime));
    const active = mySlots.filter(s => !s.cancelled);
    document.getElementById("slot-count").textContent = active.length;
    document.getElementById("free-count").textContent = active.filter(s=>!s.booked && toDateTime(s.date,s.startTime)>new Date()).length;
    renderCalendar();
    renderDayPreview();
    renderSlotList();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="empty">Unable to load your schedule. Please refresh the page.</p>';
    dayPreview.innerHTML = '<p class="empty">Could not load sessions for this day.</p>';
  }
}

function renderSlotList() {
  // Upcoming available slots, with Edit (PBI-09) and Cancel (PBI-11) actions
  const shown = mySlots.filter(s => !s.cancelled && !s.booked && toDateTime(s.date, s.startTime) > new Date());
  if (!shown.length) {
    list.innerHTML = '<p class="empty">No available office hours yet. Choose a date and publish a slot above.</p>';
    return;
  }
  list.innerHTML = shown.map(s =>
    `<article class="card slot"><div><div class="slot-date">${esc(formatDate(s.date))}</div><div class="slot-time">${esc(formatTime(s.startTime))} – ${esc(formatTime(s.endTime))}</div><div class="slot-place">${placeHtml(s)}</div></div>
     <div class="slot-actions"><span class="badge free">Available</span>
       <button type="button" class="btn ghost small" data-edit="${s.id}">Edit</button>
       <button type="button" class="btn ghost small danger" data-cancel-slot="${s.id}">Cancel</button></div></article>`
  ).join("");
}

// ---------- PBI-03: View all booked appointments ----------
async function loadBookedAppointments() {
  try {
    const q = query(collection(db, "bookings"), where("instructorId", "==", currentUser.uid));
    const snap = await getDocs(q);
    myBookings = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(b => b.status !== "cancelled" && isUpcoming(b))
      .sort((a, b) => toDateTime(a.date, a.startTime) - toDateTime(b.date, b.startTime));
    document.getElementById("booked-count").textContent = myBookings.length;
    if (!myBookings.length) {
      bookedList.innerHTML = '<p class="empty">No booked appointments yet.</p>';
      return;
    }
    bookedList.innerHTML = myBookings.map(b => `
      <article class="card slot">
        <div>
          <div class="slot-instructor">👤 ${esc(b.studentName)}</div>
          <div class="slot-date">${esc(formatDate(b.date))}</div>
          <div class="slot-time">${esc(formatTime(b.startTime))} – ${esc(formatTime(b.endTime))}</div>
          <div class="slot-place">${placeHtml(b)}</div>
          ${b.topic ? `<div class="slot-topic"><strong>Topic:</strong> ${esc(b.topic)}</div>` : ""}
        </div>
        <div class="slot-actions"><span class="badge booked">Booked</span>
          <button type="button" class="btn ghost small danger" data-cancel-slot="${b.slotId}">Cancel</button></div>
      </article>`).join("");
  } catch (err) {
    console.error(err);
    bookedList.innerHTML = `<p class="empty">Could not load booked appointments. (Error: ${esc(err.code || err.message)})</p>`;
  }
}

async function refreshAll() {
  await loadMySlots();
  await loadBookedAppointments();
}

// ---------- PBI-11: Cancel an office-hour slot ----------
async function cancelSlot(slotId) {
  const slot = mySlots.find(s => s.id === slotId);
  if (!slot) return;
  const warning = slot.booked
    ? `<p>This slot is booked by <strong>${esc(slot.bookedByName || "a student")}</strong>. The student will see that the appointment was cancelled by the instructor.</p>`
    : `<p>Students will no longer be able to book this slot.</p>`;
  const ok = await confirmAction("Cancel this office-hour slot?",
    `<p><strong>${esc(formatDate(slot.date))}, ${esc(formatTime(slot.startTime))} – ${esc(formatTime(slot.endTime))}</strong></p>${warning}`,
    "Cancel slot");
  if (!ok) return;
  try {
    // Read booking details before cancellation; no email is sent for unbooked slots.
    const bookingToNotify = slot.booked ? myBookings.find(b => b.slotId === slot.id) : null;
    const slotRef = doc(db, "slots", slot.id);
    await runTransaction(db, async (tx) => {
      const fresh = await tx.get(slotRef);
      if (!fresh.exists() || fresh.data().cancelled) throw Object.assign(new Error(), { userMessage: "This slot was already cancelled." });
      tx.update(slotRef, { cancelled: true });
      // If a student booked it, mark the booking as cancelled so the student is notified in "My appointments"
      if (fresh.data().booked) tx.update(doc(db, "bookings", slot.id), { status: "cancelled", cancelledBy: "instructor" });
    });
    let emailStatus = '';
    if (slot.booked) {
      try {
        if (!bookingToNotify) throw new Error('Booking details not loaded');
        await sendInstructorCancellation(bookingToNotify);
        emailStatus = ' Cancellation email sent.';
      } catch (emailError) {
        console.warn('Slot cancelled, but cancellation email failed:', emailError);
        emailStatus = ' Cancellation email could not be sent. Check EmailJS settings or recreate older bookings.';
      }
    }
    showMessage(listMsg, 'The office-hour slot was cancelled.' + emailStatus, 'success');
  } catch (err) {
    console.error(err);
    showMessage(listMsg, err.userMessage || `Could not cancel the slot. (Error: ${err.code || err.message})`);
  }
  await refreshAll();
}

// ---------- PBI-09: Update an existing office-hour slot ----------
let editingId = null;
function openEdit(slotId) {
  const slot = mySlots.find(s => s.id === slotId);
  if (!slot || slot.booked || slot.cancelled) return;
  editingId = slotId;
  editForm.elements.date.min = todayLocal();
  editForm.elements.date.value = slot.date;
  editForm.elements.startTime.value = slot.startTime;
  editForm.elements.endTime.value = slot.endTime;
  editForm.elements.location.value = slot.location || "";
  editForm.elements.meetingLink.value = slot.meetingLink || "";
  showMessage(editMsg, "");
  editDialog.showModal();
}
document.getElementById("edit-cancel").addEventListener("click", () => editDialog.close());
editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    date: editForm.elements.date.value,
    startTime: editForm.elements.startTime.value,
    endTime: editForm.elements.endTime.value,
    location: editForm.elements.location.value.trim(),
    meetingLink: editForm.elements.meetingLink.value.trim()
  };
  // Check overlap against all my other slots (not the one being edited)
  const error = validateSlot(data, mySlots.filter(s => s.id !== editingId));
  if (error) return showMessage(editMsg, error);
  const btn = editForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const slotRef = doc(db, "slots", editingId);
    await runTransaction(db, async (tx) => {
      const fresh = await tx.get(slotRef);
      if (!fresh.exists() || fresh.data().cancelled) throw Object.assign(new Error(), { userMessage: "This slot no longer exists." });
      if (fresh.data().booked) throw Object.assign(new Error(), { userMessage: "This slot was just booked by a student, so it can no longer be edited." });
      tx.update(slotRef, data);
    });
    editDialog.close();
    showMessage(listMsg, "The office-hour slot was updated.", "success");
    await refreshAll();
  } catch (err) {
    console.error(err);
    showMessage(editMsg, err.userMessage || `Could not update the slot. (Error: ${err.code || err.message})`);
  } finally { btn.disabled = false; }
});

// Buttons inside the two lists
document.addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) return openEdit(edit.dataset.edit);
  const cancel = e.target.closest("[data-cancel-slot]");
  if (cancel) return cancelSlot(cancel.dataset.cancelSlot);
});
