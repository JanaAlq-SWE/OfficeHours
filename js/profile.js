// PBI-17: View and update my profile and name
import { db } from "./firebase-config.js";
import {
  doc, updateDoc, collection, query, where, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { requireRole, showMessage, isUpcoming } from "./common.js";

const form = document.getElementById("profile-form");
const msg = document.getElementById("message");
let currentUser, currentProfile;

requireRole("any", (user, profile) => {
  currentUser = user; currentProfile = profile;
  // Older accounts may only have "name": split it for the form
  const [first, ...rest] = (profile.name || "").trim().split(/\s+/);
  form.elements.firstName.value = profile.firstName ?? first ?? "";
  form.elements.lastName.value = profile.lastName ?? rest.join(" ");
  form.elements.email.value = profile.email || user.email || "";
  form.elements.role.value = profile.role === "instructor" ? "Instructor" : "Student";
  // PBI-12: instructors can set their department (used by the student search)
  if (profile.role === "instructor") {
    document.getElementById("department-field").hidden = false;
    form.elements.department.value = profile.department || "";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const firstName = form.elements.firstName.value.trim();
  const lastName = form.elements.lastName.value.trim();
  if (!firstName || !lastName) return showMessage(msg, "First name and last name are required.");
  if (firstName.length > 45 || lastName.length > 45) return showMessage(msg, "Names must be 45 characters or fewer.");
  const name = `${firstName} ${lastName}`;
  const isInstructor = currentProfile.role === "instructor";
  const department = isInstructor ? form.elements.department.value.trim() : undefined;
  if (isInstructor && !department) return showMessage(msg, "Please enter your department.");
  const nameChanged = name !== currentProfile.name;
  const deptChanged = isInstructor && department !== (currentProfile.department || "");
  if (!nameChanged && !deptChanged) return showMessage(msg, "No changes to save.", "info");

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "users", currentUser.uid),
      isInstructor ? { firstName, lastName, name, department } : { firstName, lastName, name });
    // Instructors: show the new name on their upcoming slots too
    if (isInstructor && nameChanged) {
      const snap = await getDocs(query(collection(db, "slots"), where("instructorId", "==", currentUser.uid)));
      const batch = writeBatch(db);
      let n = 0;
      snap.docs.forEach(d => { const s = d.data(); if (!s.cancelled && isUpcoming(s)) { batch.update(d.ref, { instructorName: name }); n++; } });
      if (n) await batch.commit();
    }
    currentProfile = { ...currentProfile, firstName, lastName, name, ...(isInstructor ? { department } : {}) };
    document.getElementById("user-name").textContent = name;
    document.getElementById("header-initials").textContent =
      (firstName[0] + lastName[0]).toUpperCase();
    showMessage(msg, "Your profile was updated.", "success");
  } catch (err) {
    console.error(err);
    showMessage(msg, `Could not update your profile. (Error: ${err.code || err.message})`);
  } finally { btn.disabled = false; }
});
