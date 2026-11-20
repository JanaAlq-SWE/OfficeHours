// OfficeHours classroom demo: EmailJS browser integration.
// Public identifiers are not secrets. Restrict allowed origins and monitor usage in EmailJS.
const SERVICE_ID = 'service_q5a1ka8';
const PUBLIC_KEY = 'xwH85Xx7X21flMUJW';
const BOOKING_TEMPLATE = 'template_thrnhbh';
const CANCELLATION_TEMPLATE = 'template_7e0jmii';
const REMINDER_TEMPLATE = 'template_s51zbrl';

function details(booking) {
  return {
    to_email: booking.studentEmail,
    student_name: booking.studentName || 'Student',
    instructor_name: booking.instructorName || 'Instructor',
    appointment_date: booking.date || '',
    appointment_time: [booking.startTime, booking.endTime].filter(Boolean).join(' - '),
    appointment_location: booking.location || booking.meetingLink || 'See your appointment details'
  };
}

async function send(templateId, booking) {
  if (!booking?.studentEmail) throw new Error('Student email is missing. Existing bookings may need to be recreated.');
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: SERVICE_ID, template_id: templateId, user_id: PUBLIC_KEY, template_params: details(booking) })
  });
  if (!response.ok) throw new Error(`EmailJS request failed (${response.status}): ${await response.text()}`);
}

export const sendBookingConfirmation = booking => send(BOOKING_TEMPLATE, booking);
export const sendInstructorCancellation = booking => send(CANCELLATION_TEMPLATE, booking);

// Same EmailJS service as booking/cancellation. reminder_time: '24 hours' or '1 hour'.
export const sendAppointmentReminder = (booking, reminderTime) => {
  if (!['24 hours', '1 hour'].includes(reminderTime)) throw new Error('Invalid reminder interval');
  return sendReminder(booking, reminderTime);
};

async function sendReminder(booking, reminderTime) {
  if (!booking?.studentEmail) throw new Error('Student email is missing');
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: SERVICE_ID, template_id: REMINDER_TEMPLATE, user_id: PUBLIC_KEY,
      template_params: { ...details(booking), reminder_time: reminderTime }
    })
  });
  if (!response.ok) throw new Error(`EmailJS reminder failed (${response.status}): ${await response.text()}`);
}
