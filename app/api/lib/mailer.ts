import nodemailer from "nodemailer";

type ReminderEmailPayload = {
  to: string;
  reminderNotes: string;
  reminderDateTime: Date;
};

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const from = (process.env.SMTP_FROM || user).trim();

  if (!host || !port || !user || !pass || !from) {
    throw new Error("SMTP is not configured. Please check SMTP_HOST/PORT/USER/PASS/FROM.");
  }

  return { host, port, user, pass, from };
}

function formatReminderTime(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export async function sendReminderNotificationEmail(payload: ReminderEmailPayload) {
  const smtp = getSmtpConfig();

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: false,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  const reminderTime = formatReminderTime(payload.reminderDateTime);

  const text = [
    "Hello",
    "",
    "This is a reminder for your scheduled task.",
    "",
    `Reminder Time: ${reminderTime}`,
    "",
    "Reminder Notes:",
    payload.reminderNotes || "-",
    "Thanks & Regards",
    "Acarsh Support."
  ].join("\n");

  await transporter.sendMail({
    from: smtp.from,
    to: payload.to,
    subject: "Reminder Notification",
    text,
  });

  return { success: true };
}

