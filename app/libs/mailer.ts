import nodemailer, { type Transporter } from "nodemailer";

import { logError } from "./log";

// Outgoing mail (password reset links) over SMTP: Amazon SES (SMTP credentials), Gmail with an app
// password, Resend, Mailgun… Configured by SMTP_HOST / SMTP_PORT (default 587) / SMTP_SECURE ("true":
// TLS from the start, as on 465; else STARTTLS) / SMTP_USER / SMTP_PASSWORD and SMTP_FROM
// ("Messenger <no-reply@example.com>"). Read at run time.

export const mailConfigured = () => !!process.env.SMTP_HOST?.trim() && !!process.env.SMTP_FROM?.trim();

let transport: Transporter | null = null;
const transporter = () => {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" }
        : undefined,
      // a slow mail server mustn't hold the request for long
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
};

// Sends one message; false when mail isn't configured or the server refused it (logged, without
// the address or the content).
export const sendMail = async (message: { to: string; subject: string; text: string; html: string }) => {
  if (!mailConfigured()) {
    return false;
  }
  try {
    await transporter().sendMail({ from: process.env.SMTP_FROM, ...message });
    return true;
  } catch (error) {
    logError("send_mail", error);
    return false;
  }
};
