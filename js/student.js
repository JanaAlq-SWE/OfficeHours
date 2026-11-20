// PBI-07: View Available Office-Hour Slots (Task 3.2)
// PBI-02: Book an Available Office-Hour Slot (Task 4.3)
// PBI-06: Prevent Double Booking (Tasks 5.1, 5.3)
import { db } from "./firebase-config.js";
import { sendBookingConfirmation } from "./email-notifications.js";
// Sprint 2: PBI-10 View my upcoming appointments, PBI-14 Cancel an upcoming appointment,
// PBI-12 Search instructors, PBI-13 Reschedule an appointment, PBI-15 Add a topic when booking
import {
  collection, query, where, getDocs, doc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { requireRole, showMessage, formatDate, formatTime, toDateTime, esc, placeHtml,
  isUpcoming, confirmAction } from "./common.js";

const list = document.getElementById("available-list");
const msg = document.getElementById("message");
const dialog = document.getElementById("confirm-dialog");
const dialogBody = document.getElementById("confirm-body");
const confirmBtn = document.getElementById("confirm-btn");
const cancelBtn = document.getElementById("cancel-btn");
let currentUser, currentProfile, slots = [], selected = null;
let allSlots = [];                 // every future available slot
let instructors = new Map();       // instructorId -> { name, department }  (PBI-12)
let searchTerm = "";
const topicInput = document.getElementById("booking-topic");

requireRole("student", async (user, profile) => {
  currentUser = user; currentProfile = profile;
  await loadInstructors();
  loadAvailableSlots();
  loadMyAppointments();
});
const myList = document.getElementById("my-appointments");
const myMsg = document.getElementById("my-message");
let myBookings = [];

// Calendar-based booking: show only real future available slots.
let shownMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let chosenDate = null;
const calendarEl = document.getElementById("calendar-grid");
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayLocal = isoLocal(new Date());
function renderCalendar() {
  document.getElementById("month-label").textContent = shownMonth.toLocaleDateString("en-GB", {month:"long",year:"numeric"});
  const first = new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1);
  const count = new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,0).getDate();
  const available = new Map();
  slots.forEach(s => available.set(s.date,(available.get(s.date)||0)+1));
  let html = Array.from({length:first.getDay()},()=>'<span class="calendar-blank"></span>').join('');
  for(let n=1;n<=count;n++) {
    const date=isoLocal(new Date(shownMonth.getFullYear(),shownMonth.getMonth(),n));
    const countForDay=available.get(date)||0;
    const disabled=date<todayLocal || !countForDay;
    html += `<button type="button" class="calendar-day ${countForDay?'has-slots':''} ${date===chosenDate?'is-selected':''}" data-date="${date}" ${disabled?'disabled':''} aria-pressed="${date===chosenDate}" aria-label="${formatDate(date)}${countForDay?', '+countForDay+' available sessions':', no available sessions'}"><b>${n}</b>${countForDay?`<small>${countForDay} ${countForDay===1?'slot':'slots'}</small>`:''}</button>`;
  }
  calendarEl.innerHTML = html;
  document.getElementById("prev-month").disabled = shownMonth.getFullYear()===new Date().getFullYear() && shownMonth.getMonth()===new Date().getMonth();
}
function renderSessions(){
  const daySlots = slots.filter(s => s.date === chosenDate);
  document.getElementById("selected-date-title").textContent = chosenDate ? `Available times · ${formatDate(chosenDate)}` : 'Available times';
  document.getElementById("selected-date-sub").textContent = chosenDate ? `${daySlots.length} session${daySlots.length===1?'':'s'} available on this date` : 'Select a highlighted date above to see available sessions.';
  if(!chosenDate){list.innerHTML = searchTerm && !slots.length
    ? '<p class="empty">No available sessions match your search. Try another name or department.</p>'
    : '<p class="empty">Select a highlighted date on the calendar to view available times.</p>';return;}
  if(!daySlots.length){list.innerHTML='<p class="empty">No available sessions for this day. Choose another highlighted date.</p>';return;}
  list.innerHTML=daySlots.map(s=>`<article class="card session-item"><div class="session-time"><span class="session-symbol">◷</span><div><strong>${formatTime(s.startTime)} – ${formatTime(s.endTime)}</strong><small>${formatDate(s.date)}</small></div></div><div class="session-details"><strong>${esc(s.instructorName)}</strong>${deptOf(s)?`<div class="slot-dept">${esc(deptOf(s))}</div>`:''}<div class="slot-place">${placeHtml(s)}</div></div><button class="btn" data-id="${s.id}">Book session ↗</button></article>`).join('');
}
async function loadAvailableSlots(){
  try {
    const q=query(collection(db,"slots"),where("booked","==",false));
    const snap=await getDocs(q);
    const now=new Date();
    allSlots=snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>!s.cancelled&&s.date&&s.startTime&&toDateTime(s.date,s.startTime)>now).sort((a,b)=>toDateTime(a.date,a.startTime)-toDateTime(b.date,b.startTime));
    applySearch();
  }catch(e){console.error(e);showMessage(msg,"Could not load available sessions. Check your connection and try again.");list.innerHTML='<p class="empty">Sessions could not be loaded.</p>';}
}
// ---------- PBI-12: Search for an instructor by name or department ----------
async function loadInstructors() {
  try {
    const snap = await getDocs(query(collection(db, "users"), where("role", "==", "instructor")));
    instructors = new Map(snap.docs.map(d => [d.id, { name: d.data().name || "", department: d.data().department || "" }]));
  } catch (e) { console.warn("Could not load instructor departments:", e); }
}
function deptOf(s) { return instructors.get(s.instructorId)?.department || ""; }
function matchesSearch(s) {
  if (!searchTerm) return true;
  const hay = `${s.instructorName || ""} ${instructors.get(s.instructorId)?.name || ""} ${deptOf(s)}`.toLowerCase();
  return searchTerm.split(/\s+/).every(word => hay.includes(word));
}
function applySearch() {
  slots = allSlots.filter(matchesSearch);
  document.getElementById("available-count").textContent = slots.length;
  const summary = document.getElementById("search-summary");
  document.getElementById("clear-search").hidden = !searchTerm;
  if (searchTerm) {
    const names = [...new Set(slots.map(s => s.instructorName))];
    summary.textContent = slots.length
      ? `${slots.length} available session${slots.length === 1 ? "" : "s"} with ${names.join(", ")}.`
      : "No available sessions match your search.";
  } else summary.textContent = "";
  if (chosenDate && !slots.some(s => s.date === chosenDate)) chosenDate = null;
  // Default to the earliest available day, so users immediately see useful sessions.
  if (!chosenDate && slots.length) { chosenDate = slots[0].date; shownMonth = new Date(Number(chosenDate.slice(0,4)), Number(chosenDate.slice(5,7))-1, 1); }
  renderCalendar(); renderSessions();
}
const searchInput = document.getElementById("instructor-search");
searchInput.addEventListener("input", () => { searchTerm = searchInput.value.trim().toLowerCase(); applySearch(); });
document.getElementById("clear-search").addEventListener("click", () => { searchInput.value = ""; searchTerm = ""; applySearch(); searchInput.focus(); });

calendarEl.addEventListener("click",e=>{const btn=e.target.closest('button[data-date]');if(!btn||btn.disabled)return;chosenDate=btn.dataset.date;renderCalendar();renderSessions();});
document.getElementById("prev-month").addEventListener("click",()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1);renderCalendar();});
document.getElementById("next-month").addEventListener("click",()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1);renderCalendar();});

// Open the confirmation box when the student clicks "Book"
list.addEventListener("click", (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  selected = slots.find(s => s.id === id);
  if (!selected) return;
  dialogBody.innerHTML = `
    <p><strong>${esc(selected.instructorName)}</strong></p>
    <p>${formatDate(selected.date)}, ${formatTime(selected.startTime)} – ${formatTime(selected.endTime)}</p>
    <p>${placeHtml(selected)}</p>`;
  topicInput.value = "";
  dialog.showModal();
});

cancelBtn.addEventListener("click", () => dialog.close());

confirmBtn.addEventListener("click", async () => {
  confirmBtn.disabled = true;
  try {
    const topic = topicInput.value.trim();
    if (topic.length > 300) throw userError("The topic must be 300 characters or fewer.");
    await bookSlot(selected, topic);
    let emailSent = false;
    try {
      await sendBookingConfirmation({
        ...selected,
        studentEmail: currentUser.email,
        studentName: currentProfile.name
      });
      emailSent = true;
    } catch (emailError) {
      console.warn('Booking saved, but confirmation email failed:', emailError);
    }
    dialog.close();
    showMessage(msg,
      `Booking confirmed: ${selected.instructorName} on ${formatDate(selected.date)}, ` +
      `${formatTime(selected.startTime)} – ${formatTime(selected.endTime)}` +
      (selected.location ? ` at ${selected.location}` : "") +
      (selected.meetingLink ? ` (meeting link: ${selected.meetingLink})` : "") + ".",
      "success");
    if (!emailSent) showMessage(myMsg, "Your booking was saved, but the confirmation email could not be sent. Please check EmailJS settings.");
  } catch (err) {
    dialog.close();
    showMessage(msg, err.userMessage || "Could not complete the booking. Please try again.");
    if (!err.userMessage) console.error(err);
  } finally {
    confirmBtn.disabled = false;
    await loadAvailableSlots();
    await loadMyAppointments();
  }
});

// Books a slot inside a Firestore transaction.
// The transaction reads the slot again on the server, so if two students try
// to book the same slot at the same time, only the first one succeeds.
async function bookSlot(slot, topic = "") {
  const slotRef = doc(db, "slots", slot.id);
  const bookingRef = doc(db, "bookings", slot.id); // one booking per slot (same id)

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(slotRef);
    if (!fresh.exists()) throw userError("This slot no longer exists.");
    const s = fresh.data();
    if (s.cancelled) throw userError("Sorry, this slot was cancelled by the instructor.");
    if (s.booked) throw userError("Sorry, this slot is no longer available. It was just booked by another student.");
    if (toDateTime(s.date, s.startTime) <= new Date()) throw userError("You cannot book a slot in the past.");

    tx.update(slotRef, { booked: true, bookedBy: currentUser.uid, bookedByName: currentProfile.name });
    tx.set(bookingRef, {
      slotId: slot.id,
      studentId: currentUser.uid,
      studentName: currentProfile.name,
      studentEmail: currentUser.email,
      instructorId: s.instructorId,
      instructorName: s.instructorName,
      date: s.date, startTime: s.startTime, endTime: s.endTime,
      location: s.location || "", meetingLink: s.meetingLink || "",
      topic,                       // PBI-15: what the student wants to discuss
      status: "booked",
      createdAt: serverTimestamp()
    });
  });
}

function userError(text) {
  const e = new Error(text);
  e.userMessage = text;
  return e;
}

document.getElementById("refresh-btn").addEventListener("click", () => loadAvailableSlots().catch(e => { console.error(e); showMessage(msg, "Unable to refresh slots."); }));


// ---------- PBI-10: View my upcoming appointments ----------
async function loadMyAppointments() {
  try {
    const q = query(collection(db, "bookings"), where("studentId", "==", currentUser.uid));
    const snap = await getDocs(q);
    myBookings = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(isUpcoming)
      .sort((a, b) => toDateTime(a.date, a.startTime) - toDateTime(b.date, b.startTime));
    const active = myBookings.filter(b => b.status !== "cancelled");
    document.getElementById("my-count").textContent = active.length;
    if (!myBookings.length) {
      myList.innerHTML = '<p class="empty">You have no upcoming appointments. Book a session above.</p>';
      return;
    }
    myList.innerHTML = myBookings.map(b => {
      const cancelled = b.status === "cancelled";
      const started = toDateTime(b.date, b.startTime) <= new Date();
      return `<article class="card session-item ${cancelled ? "is-cancelled" : ""}">
        <div class="session-time"><span class="session-symbol">◷</span><div><strong>${formatTime(b.startTime)} – ${formatTime(b.endTime)}</strong><small>${formatDate(b.date)}</small></div></div>
        <div class="session-details"><strong>${esc(b.instructorName)}</strong><div class="slot-place">${placeHtml(b)}</div>
          ${b.topic ? `<div class="booking-topic"><strong>Topic:</strong> ${esc(b.topic)}</div>` : ""}</div>
        ${cancelled
          ? '<span class="badge cancelled">Cancelled by instructor</span>'
          : started ? '<span class="badge booked">In progress</span>'
          : `<div class="appt-actions">
               <button class="btn ghost small" type="button" data-reschedule="${b.id}">Reschedule</button>
               <button class="btn ghost small danger" type="button" data-cancel-booking="${b.id}">Cancel appointment</button>
             </div>`}
      </article>`;
    }).join("");
  } catch (err) {
    console.error(err);
    myList.innerHTML = `<p class="empty">Could not load your appointments. (Error: ${esc(err.code || err.message)})</p>`;
  }
}

// ---------- PBI-14: Cancel an upcoming appointment ----------
myList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-cancel-booking]");
  if (!btn) return;
  const b = myBookings.find(x => x.id === btn.dataset.cancelBooking);
  if (!b) return;
  const ok = await confirmAction("Cancel this appointment?",
    `<p><strong>${esc(b.instructorName)}</strong></p><p>${formatDate(b.date)}, ${formatTime(b.startTime)} – ${formatTime(b.endTime)}</p>
     <p>The slot will become available to other students.</p>`, "Cancel appointment");
  if (!ok) return;
  try {
    const slotRef = doc(db, "slots", b.slotId);
    const bookingRef = doc(db, "bookings", b.id);
    await runTransaction(db, async (tx) => {
      const slot = await tx.get(slotRef);
      if (toDateTime(b.date, b.startTime) <= new Date()) throw userError("You cannot cancel an appointment that has already started.");
      // Free the slot again (only if it is still booked by me and not cancelled by the instructor)
      if (slot.exists() && slot.data().bookedBy === currentUser.uid && !slot.data().cancelled) {
        tx.update(slotRef, { booked: false, bookedBy: null, bookedByName: null });
      }
      tx.delete(bookingRef);
    });
    showMessage(myMsg, "Your appointment was cancelled. The slot is now available to other students.", "success");
  } catch (err) {
    console.error(err);
    showMessage(myMsg, err.userMessage || `Could not cancel the appointment. (Error: ${err.code || err.message})`);
  }
  await loadMyAppointments();
  await loadAvailableSlots();
});

// PBI-18: reminder emails (24 hours / 1 hour before) are sent only by the scheduled
// GitHub Actions job (scripts/send-reminders.mjs), so the browser never sends duplicates.

// ---------- PBI-13: Reschedule an upcoming appointment ----------
const rDialog = document.getElementById("reschedule-dialog");
const rOptions = document.getElementById("reschedule-options");
const rConfirm = document.getElementById("reschedule-confirm");
const rMsg = document.getElementById("reschedule-message");
let rBooking = null;

myList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-reschedule]");
  if (!btn) return;
  rBooking = myBookings.find(x => x.id === btn.dataset.reschedule);
  if (!rBooking) return;
  await loadAvailableSlots();            // make sure the list is fresh
  const options = allSlots.filter(s => s.instructorId === rBooking.instructorId && s.id !== rBooking.slotId);
  document.getElementById("reschedule-current").innerHTML =
    `<p><strong>${esc(rBooking.instructorName)}</strong></p>
     <p>Current time: ${formatDate(rBooking.date)}, ${formatTime(rBooking.startTime)} – ${formatTime(rBooking.endTime)}</p>`;
  rOptions.innerHTML = options.length
    ? options.map(s => `<label class="reschedule-option"><input type="radio" name="new-slot" value="${s.id}">
        <span><strong>${formatDate(s.date)}, ${formatTime(s.startTime)} – ${formatTime(s.endTime)}</strong><br><small>${placeHtml(s)}</small></span></label>`).join("")
    : '<p class="empty">This instructor has no other available times right now. You can keep or cancel your appointment.</p>';
  rMsg.hidden = true;
  rConfirm.disabled = true;
  rDialog.showModal();
});
rOptions.addEventListener("change", () => { rConfirm.disabled = !rOptions.querySelector("input:checked"); });
document.getElementById("reschedule-cancel").addEventListener("click", () => rDialog.close());

rConfirm.addEventListener("click", async () => {
  const newId = rOptions.querySelector("input:checked")?.value;
  const target = allSlots.find(s => s.id === newId);
  if (!rBooking || !target) return;
  rConfirm.disabled = true;
  try {
    await rescheduleBooking(rBooking, target);
    try {
      await sendBookingConfirmation({ ...target, topic: rBooking.topic, studentEmail: currentUser.email, studentName: currentProfile.name });
    } catch (emailError) { console.warn("Rescheduled, but confirmation email failed:", emailError); }
    rDialog.close();
    showMessage(myMsg, `Your appointment was moved to ${formatDate(target.date)}, ${formatTime(target.startTime)} – ${formatTime(target.endTime)}. The old time is now available to other students.`, "success");
  } catch (err) {
    if (!err.userMessage) console.error(err);
    showMessage(rMsg, err.userMessage || `Could not reschedule. (Error: ${err.code || err.message})`);
    rConfirm.disabled = false;
  }
  await loadAvailableSlots();
  await loadMyAppointments();
});

// One transaction: free the old slot, book the new one, and move the booking.
// If the new slot was just taken by someone else, nothing changes.
async function rescheduleBooking(b, target) {
  const oldSlotRef = doc(db, "slots", b.slotId);
  const newSlotRef = doc(db, "slots", target.id);
  const oldBookingRef = doc(db, "bookings", b.id);
  const newBookingRef = doc(db, "bookings", target.id);
  await runTransaction(db, async (tx) => {
    const oldBooking = await tx.get(oldBookingRef);
    const oldSlot = await tx.get(oldSlotRef);
    const fresh = await tx.get(newSlotRef);
    if (!oldBooking.exists() || oldBooking.data().status !== "booked") throw userError("This appointment can no longer be rescheduled.");
    if (toDateTime(b.date, b.startTime) <= new Date()) throw userError("You cannot reschedule an appointment that has already started.");
    if (!fresh.exists()) throw userError("The new time no longer exists.");
    const s = fresh.data();
    if (s.cancelled) throw userError("Sorry, the new time was cancelled by the instructor.");
    if (s.booked) throw userError("Sorry, the new time was just booked by another student. Please choose another time.");
    if (toDateTime(s.date, s.startTime) <= new Date()) throw userError("You cannot move to a time in the past.");

    if (oldSlot.exists() && oldSlot.data().bookedBy === currentUser.uid && !oldSlot.data().cancelled) {
      tx.update(oldSlotRef, { booked: false, bookedBy: null, bookedByName: null });
    }
    tx.update(newSlotRef, { booked: true, bookedBy: currentUser.uid, bookedByName: currentProfile.name });
    tx.delete(oldBookingRef);
    tx.set(newBookingRef, {
      slotId: target.id,
      studentId: currentUser.uid,
      studentName: currentProfile.name,
      studentEmail: currentUser.email,
      instructorId: s.instructorId,
      instructorName: s.instructorName,
      date: s.date, startTime: s.startTime, endTime: s.endTime,
      location: s.location || "", meetingLink: s.meetingLink || "",
      topic: oldBooking.data().topic || "",
      rescheduledFrom: b.slotId,
      status: "booked",
      createdAt: serverTimestamp()
    });
  });
}
