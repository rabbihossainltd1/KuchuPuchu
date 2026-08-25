import { createId } from "../domain/ids.js";
import { env } from "./env.js";
import { prisma } from "./db.js";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(message: MailMessage): Promise<void> {
  await prisma.devMailbox.create({
    data: {
      id: createId("mail"),
      toEmail: message.to.toLowerCase(),
      subject: message.subject,
      body: message.text,
    },
  });

  if (!env.SMTP_HOST) {
    if (env.NODE_ENV !== "test") {
      console.info(`[mail] ${message.subject} -> ${message.to}`);
    }
    return;
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}

export function appUrl(pathname: string): string {
  return `${env.PUBLIC_APP_URL.replace(/\/$/, "")}${pathname}`;
}
