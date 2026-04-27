const { prisma } = require("../utils/prismaLegacy");
const { sendBrevoEmail } = require("../services/emailService");

const escapeHtml = (value = "") =>
  value
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripHtml = (value = "") =>
  value
    .toString()
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeEmail = (value = "") => value.toString().trim().toLowerCase();

const buildNewsletterContent = ({
  heading,
  body,
  ctaLabel,
  ctaUrl,
}: {
  heading?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) => {
  const normalizedHeading = (heading || "").toString().trim() || "supplements.ng updates";
  const normalizedBody = (body || "").toString().trim();
  const normalizedCtaLabel = (ctaLabel || "").toString().trim();
  const normalizedCtaUrl = (ctaUrl || "").toString().trim();

  const paragraphs = normalizedBody
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const text = [
    normalizedHeading,
    "",
    ...paragraphs,
    ...(normalizedCtaLabel && normalizedCtaUrl ? ["", `${normalizedCtaLabel}: ${normalizedCtaUrl}`] : []),
  ].join("\n");

  const htmlParagraphs = paragraphs
    .map((paragraph) => `<p style="margin:0 0 14px;">${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  const ctaHtml =
    normalizedCtaLabel && normalizedCtaUrl
      ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(
          normalizedCtaUrl
        )}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#6d28d9;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(
          normalizedCtaLabel
        )}</a></p>`
      : "";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;background:#f8f5ff;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid rgba(109,40,217,0.08);">
        <p style="margin:0 0 8px;color:#6d28d9;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;font-size:12px;">supplements.ng</p>
        <h1 style="margin:0 0 18px;font-size:28px;line-height:1.2;color:#111827;">${escapeHtml(normalizedHeading)}</h1>
        ${htmlParagraphs}
        ${ctaHtml}
      </div>
    </div>
  `;

  return { text, html };
};

const sendBulkEmails = async (
  recipients: string[],
  payload: { subject: string; text: string; html: string }
) => {
  const successes: string[] = [];
  const failures: Array<{ email: string; error: string }> = [];
  const batchSize = 5;

  for (let index = 0; index < recipients.length; index += batchSize) {
    const batch = recipients.slice(index, index + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((email) =>
        sendBrevoEmail({
          to: email,
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
          senderKey: "support",
        })
      )
    );

    batchResults.forEach((result, batchIndex) => {
      const email = batch[batchIndex];
      if (result.status === "fulfilled") {
        successes.push(email);
        return;
      }
      failures.push({
        email,
        error: result.reason?.message || "Email send failed",
      });
    });
  }

  return { successes, failures };
};

exports.listSubscribers = async (_req, res) => {
  try {
    const subscribers = await prisma.newsletterSubscriber.findMany({
      orderBy: [{ subscribedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        email: true,
        isActive: true,
        subscribedAt: true,
        createdAt: true,
        firstOrderDiscountPercent: true,
        firstOrderDiscountUsedAt: true,
        firstOrderDiscountUsedOrderId: true,
      },
    });

    const total = subscribers.length;
    const active = subscribers.filter((item) => item.isActive).length;
    const discountAvailable = subscribers.filter(
      (item) => item.isActive && !item.firstOrderDiscountUsedAt
    ).length;
    const discountUsed = subscribers.filter((item) => Boolean(item.firstOrderDiscountUsedAt)).length;

    res.json({
      summary: {
        total,
        active,
        inactive: Math.max(0, total - active),
        discountAvailable,
        discountUsed,
      },
      subscribers,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load subscribers" });
  }
};

exports.sendNewsletter = async (req, res) => {
  try {
    const subject = (req.body?.subject || "").toString().trim();
    const heading = (req.body?.heading || "").toString().trim();
    const body = (req.body?.body || "").toString().trim();
    const ctaLabel = (req.body?.ctaLabel || "").toString().trim();
    const ctaUrl = (req.body?.ctaUrl || "").toString().trim();
    const testEmail = normalizeEmail(req.body?.testEmail || "");

    if (!subject) return res.status(400).json({ message: "Subject is required" });
    if (!body) return res.status(400).json({ message: "Body is required" });
    if (ctaLabel && !ctaUrl) {
      return res.status(400).json({ message: "CTA URL is required when CTA label is set" });
    }

    const content = buildNewsletterContent({ heading, body, ctaLabel, ctaUrl });

    if (testEmail) {
      await sendBrevoEmail({
        to: testEmail,
        subject,
        text: content.text,
        html: content.html,
        senderKey: "support",
      });

      return res.json({
        message: "Test newsletter sent",
        test: true,
        recipients: 1,
      });
    }

    const subscribers = await prisma.newsletterSubscriber.findMany({
      where: { isActive: true },
      select: { email: true },
      orderBy: { subscribedAt: "desc" },
    });

    const recipients: string[] = Array.from(
      new Set<string>(
        subscribers
          .map((entry) => normalizeEmail(entry.email))
          .filter(Boolean) as string[]
      )
    );

    if (recipients.length === 0) {
      return res.status(400).json({ message: "There are no active newsletter subscribers yet." });
    }

    const { successes, failures } = await sendBulkEmails(recipients, {
      subject,
      text: content.text,
      html: content.html,
    });

    res.json({
      message:
        failures.length === 0
          ? "Newsletter sent successfully."
          : "Newsletter sent with some delivery failures.",
      test: false,
      recipients: recipients.length,
      delivered: successes.length,
      failed: failures.length,
      failures: failures.slice(0, 20),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message || "Unable to send newsletter",
      error: stripHtml(error?.stack || error?.message || ""),
    });
  }
};

export {};
