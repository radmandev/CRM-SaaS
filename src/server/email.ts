import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { getObject } from "./storage";

export type Attachment = { filename: string; storageKey: string; contentType: string };
export type Email = { to: string; subject: string; text: string; html: string; attachments?: Attachment[] };

/** Emails captured by the fake provider (tests only; INT-02 forbids it in production). */
export const fakeOutbox: Email[] = [];

let transport: Transporter | undefined;

export async function deliver(email: Email): Promise<void> {
  const e = env();
  if (e.EMAIL_PROVIDER === "fake") {
    fakeOutbox.push(email);
    return;
  }
  transport ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    // INT-05: bounded waits; a failed send is retried by the job queue.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  });
  const attachments = await Promise.all((email.attachments ?? []).map(async (a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(await getObject(a.storageKey)) })));
  await transport.sendMail({ from: e.EMAIL_FROM, to: email.to, subject: email.subject, text: email.text, html: email.html, attachments });
}
