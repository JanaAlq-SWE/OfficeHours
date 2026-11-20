// PBI-18: Scheduled appointment reminders (GitHub Actions + EmailJS REST API).
// Runs every ~5 minutes from .github/workflows/reminders.yml, even when the website is closed.
// All keys come from GitHub Secrets (environment variables). Never commit them to the repository.
import admin from 'firebase-admin';

const required = ['FIREBASE_SERVICE_ACCOUNT', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', 'EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing GitHub secret(s): ${missing.join(', ')}`);

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const now = Date.now();
const MINUTE = 60000, HOUR = 60 * MINUTE;
const TZ = '+03:00'; // appointment dates/times are saved in Saudi Arabia local time
// "window" = how late a reminder may still be sent (GitHub schedules can be delayed)
const reminders = [
  { key: 'reminder24h', label: '24 hours', lead: 24 * HOUR, window: 2 * HOUR },
  { key: 'reminder1h',  label: '1 hour',   lead: HOUR,      window: 30 * MINUTE }
];

function appointmentTime(b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !/^\d{2}:\d{2}$/.test(b.startTime || '')) return NaN;
  return Date.parse(`${b.date}T${b.startTime}:00${TZ}`);
}

// Same template variables as js/email-notifications.js (EmailJS template template_s51zbrl)
function templateParams(b, label) {
  return {
    to_email: b.studentEmail,
    student_name: b.studentName || 'Student',
    instructor_name: b.instructorName || 'Instructor',
    appointment_date: b.date || '',
    appointment_time: [b.startTime, b.endTime].filter(Boolean).join(' - '),
    appointment_location: b.location || b.meetingLink || 'See your appointment details',
    reminder_time: label
  };
}

async function sendWithEmailJS(params) {
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY, // private key: required for server (non-browser) requests
      template_params: params
    })
  });
  if (!response.ok) throw new Error(`EmailJS ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

const snap = await db.collection('bookings').where('status', '==', 'booked').get();
let sent = 0, failed = 0, skipped = 0;

for (const doc of snap.docs) {
  const b = doc.data();
  const start = appointmentTime(b);
  if (!Number.isFinite(start) || start <= now) continue;
  if (!b.studentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.studentEmail)) { skipped++; continue; }

  for (const r of reminders) {
    const due = start - r.lead;
    if (now < due || now > due + r.window) continue;   // not due yet / too late
    // Only the closest reminder is sent (e.g. no "24 hours" email 1 hour before the meeting)
    if (r.key === 'reminder24h' && start - now <= HOUR + 30 * MINUTE) continue;

    // Record the reminder in Firestore FIRST (transaction), so a second run never sends it again.
    const marker = db.collection('reminderDelivery').doc(`${doc.id}_${r.key}`);
    const claimed = await db.runTransaction(async tx => {
      if ((await tx.get(marker)).exists) return false;
      tx.create(marker, { bookingId: doc.id, kind: r.key, studentEmail: b.studentEmail, state: 'claimed',
        claimedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) continue;

    try {
      // Re-check right before sending: the booking may have been cancelled meanwhile
      const current = await doc.ref.get();
      if (!current.exists || current.data().status !== 'booked') {
        await marker.update({ state: 'skipped', reason: 'cancelled' });
        continue;
      }
      await sendWithEmailJS(templateParams(current.data(), r.label));
      await marker.update({ state: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });
      sent++;
      console.log(`Sent ${r.label} reminder for booking ${doc.id}`);
    } catch (err) {
      // Not retried automatically, to avoid sending the same reminder twice
      await marker.update({ state: 'failed', error: String(err.message).slice(0, 250) });
      failed++;
      console.error('Reminder failed:', doc.id, r.key, err.message);
    }
  }
}
console.log(`Reminder run complete: ${snap.size} active bookings checked, ${sent} sent, ${failed} failed, ${skipped} without email.`);
if (failed) process.exitCode = 1;
