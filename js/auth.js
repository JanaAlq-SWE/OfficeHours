// PBI-05: Register and Log In
// Tasks 1.5 (registration) and 1.6 (login)
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showMessage, getProfile, pageForRole } from "./common.js";

const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const msg = document.getElementById("message");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Firebase error codes -> clear messages for the user
function friendlyError(code) {
  switch (code) {
    case "auth/email-already-in-use": return "This email is already registered. Please log in instead.";
    case "auth/invalid-email": return "Please enter a valid email address.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Incorrect email or password.";
    case "auth/too-many-requests": return "Too many attempts. Please try again later.";
    case "auth/network-request-failed": return "Network error. Check your internet connection.";
    default: return "Something went wrong. Please try again.";
  }
}

// ---------- Registration ----------
if (registerForm) {
  // PBI-12: show the department field only for instructors
  const deptField = document.getElementById("department-field");
  registerForm.querySelectorAll('input[name="role"]').forEach(r =>
    r.addEventListener("change", () => { deptField.hidden = registerForm.role.value !== "instructor"; }));
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const firstName = registerForm.elements.firstName.value.trim();
    const lastName = registerForm.elements.lastName.value.trim();
    const name = `${firstName} ${lastName}`;
    const email = registerForm.email.value.trim().toLowerCase();
    const password = registerForm.password.value;
    const confirm = registerForm.confirm.value;
    const role = registerForm.role.value;
    const department = registerForm.elements.department.value.trim();

    // Input validation
    if (!firstName || !lastName || !email || !password || !confirm || !role) return showMessage(msg, "All fields are required.");
    if (firstName.length > 45 || lastName.length > 45) return showMessage(msg, "Names must be 45 characters or fewer.");
    if (!EMAIL_RE.test(email)) return showMessage(msg, "Please enter a valid email address.");
    if (password.length < 6) return showMessage(msg, "Password must be at least 6 characters.");
    if (password !== confirm) return showMessage(msg, "Passwords do not match.");
    if (role === "instructor" && !department) return showMessage(msg, "Please enter your department.");

    const btn = registerForm.querySelector("button");
    btn.disabled = true;
    try {
      // Firebase Auth stores the password securely (hashed) — never in plain text
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), { firstName, lastName, name, email, role,
        ...(role === "instructor" ? { department } : {}), createdAt: serverTimestamp() });
      showMessage(msg, "Account created successfully! Redirecting…", "success");
      setTimeout(() => (window.location.href = pageForRole(role)), 800);
    } catch (err) {
      showMessage(msg, friendlyError(err.code));
      btn.disabled = false;
    }
  });
}

// ---------- Login ----------
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim().toLowerCase();
    const password = loginForm.password.value;
    if (!email || !password) return showMessage(msg, "Please enter your email and password.");

    const btn = loginForm.querySelector("button");
    btn.disabled = true;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const profile = await getProfile(cred.user.uid);
      window.location.href = pageForRole(profile?.role);
    } catch (err) {
      showMessage(msg, friendlyError(err.code));
      btn.disabled = false;
    }
  });
}

// Keep the login page accessible even when Firebase remembers a session.
// Navigation to the student/instructor page happens only after submitting
// the login form (or after a successful new registration above).

// ---------- PBI-19: Reset password ----------
const resetForm = document.getElementById("reset-form");
const showReset = document.getElementById("show-reset");
const showLogin = document.getElementById("show-login");
if (resetForm && showReset && loginForm) {
  const resetMsg = document.getElementById("reset-message");
  const toggle = (reset) => {
    loginForm.hidden = reset; resetForm.hidden = !reset;
    document.getElementById("login-title").textContent = reset ? "Reset your password" : "Welcome back";
    document.getElementById("login-sub").textContent = reset
      ? "Enter your account email and we will send you a link to choose a new password."
      : "Log in to book or manage office-hour appointments.";
    showReset.hidden = reset;
    showMessage(msg, ""); showMessage(resetMsg, "");
  };
  showReset.addEventListener("click", (e) => { e.preventDefault(); toggle(true); });
  showLogin.addEventListener("click", (e) => { e.preventDefault(); toggle(false); });

  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = resetForm.email.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return showMessage(resetMsg, "Please enter a valid email address.");
    const btn = resetForm.querySelector("button");
    btn.disabled = true;
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      // For privacy we show the same message whether or not the email is registered,
      // except for real input or network problems.
      if (err.code === "auth/invalid-email" || err.code === "auth/network-request-failed" || err.code === "auth/too-many-requests") {
        btn.disabled = false;
        return showMessage(resetMsg, friendlyError(err.code));
      }
    }
    showMessage(resetMsg, "If an account exists for this email, a password reset link has been sent. Check your inbox (and spam folder).", "success");
    btn.disabled = false;
  });
}
