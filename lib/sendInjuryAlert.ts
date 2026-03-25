import nodemailer from "nodemailer";
import { formatDateTime } from "@/lib/datetime";

type InjuryAlertParams = {
  workerName: string;
  jobName: string;
  injured: boolean;
  actionType: "sign-in" | "sign-out";
  timestamp: string;
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP2GO_HOST || "mail.smtp2go.com";
  const port = Number(process.env.SMTP2GO_PORT || 2525);
  const user = process.env.SMTP2GO_USER;
  const pass = process.env.SMTP2GO_PASS;

  if (!user) {
    throw new Error("Missing SMTP2GO_USER");
  }

  if (!pass) {
    throw new Error("Missing SMTP2GO_PASS");
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: false, // STARTTLS on 2525 / 587
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

export async function sendInjuryAlert({
  workerName,
  jobName,
  injured,
  actionType,
  timestamp,
}: InjuryAlertParams) {
  if (!injured) return;

  const to = process.env.INJURY_ALERT_TO;
  const from = process.env.INJURY_ALERT_FROM;

  if (!to) {
    throw new Error("Missing INJURY_ALERT_TO");
  }

  if (!from) {
    throw new Error("Missing INJURY_ALERT_FROM");
  }

  const localTime = formatDateTime(timestamp);

  const subject = `ICBI Connect Injury Alert - ${workerName}`;

  const text = [
    "Injury Alert",
    "",
    `A worker reported an injury during ${actionType}.`,
    "",
    `Worker: ${workerName}`,
    `Job: ${jobName || "-"}`,
    `Action: ${actionType}`,
    `Time: ${localTime}`,
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Injury Alert</h2>
      <p>A worker reported an injury during ${escapeHtml(actionType)}.</p>
      <table style="border-collapse: collapse;">
        <tr>
          <td style="padding: 4px 12px 4px 0;"><strong>Worker</strong></td>
          <td style="padding: 4px 0;">${escapeHtml(workerName)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 12px 4px 0;"><strong>Job</strong></td>
          <td style="padding: 4px 0;">${escapeHtml(jobName || "-")}</td>
        </tr>
        <tr>
          <td style="padding: 4px 12px 4px 0;"><strong>Action</strong></td>
          <td style="padding: 4px 0;">${escapeHtml(actionType)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 12px 4px 0;"><strong>Time</strong></td>
          <td style="padding: 4px 0;">${escapeHtml(localTime)}</td>
        </tr>
      </table>
    </div>
  `;

  const tx = getTransporter();

  const info = await tx.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  console.log("SMTP2GO injury alert sent", info.messageId);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}