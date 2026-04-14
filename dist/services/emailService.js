"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const escapeHtml = (value = "") => value
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const getSender = () => ({
    email: process.env.BREVO_SENDER_EMAIL || "support@supplements.ng",
    name: process.env.BREVO_SENDER_NAME || "supplements.ng",
});
const getSenderByKey = (key = "") => {
    const normalized = key.toString().trim().toLowerCase();
    if (!normalized)
        return getSender();
    const lookupKey = normalized.toUpperCase();
    const email = process.env[`BREVO_SENDER_${lookupKey}_EMAIL`];
    const name = process.env[`BREVO_SENDER_${lookupKey}_NAME`];
    if (email || name) {
        const fallback = getSender();
        return {
            email: email || fallback.email,
            name: name || fallback.name,
        };
    }
    return getSender();
};
const formatMoney = (value = 0) => Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const sendBrevoEmail = async ({ to, subject, html, text, attachments = [], senderKey, sender, }) => {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        console.warn("BREVO_API_KEY is not set. Skipping email send.");
        return { skipped: true };
    }
    const resolvedSender = sender?.email || sender?.name ? { ...getSender(), ...sender } : getSenderByKey(senderKey);
    const response = await fetch(BREVO_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
        },
        body: JSON.stringify({
            sender: resolvedSender,
            to: [{ email: to }],
            subject,
            htmlContent: html,
            textContent: text,
            ...(attachments.length ? { attachment: attachments } : {}),
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Brevo email failed: ${response.status} ${body}`);
    }
    return response.json().catch(() => ({}));
};
const buildVerificationEmail = ({ name, code, expiresInMinutes, }) => {
    const safeName = escapeHtml(name || "there");
    const safeCode = escapeHtml(code);
    const subject = "Verify your email for supplements.ng";
    const text = `Hi ${safeName},\n\nUse this code to verify your email: ${safeCode}\nThis code expires in ${expiresInMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`;
    const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>Hi ${safeName},</p>
      <p>Use this code to verify your email:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${safeCode}</p>
      <p>This code expires in ${expiresInMinutes} minutes.</p>
      <p style="color:#6b7280;">If you did not request this, you can ignore this email.</p>
    </div>
  `;
    return { subject, text, html };
};
const buildPasswordResetEmail = ({ name, code, expiresInMinutes, }) => {
    const safeName = escapeHtml(name || "there");
    const safeCode = escapeHtml(code);
    const subject = "Reset your supplements.ng password";
    const text = `Hi ${safeName},\n\nUse this code to reset your password: ${safeCode}\nThis code expires in ${expiresInMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`;
    const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>Hi ${safeName},</p>
      <p>Use this code to reset your password:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${safeCode}</p>
      <p>This code expires in ${expiresInMinutes} minutes.</p>
      <p style="color:#6b7280;">If you did not request this, you can ignore this email.</p>
    </div>
  `;
    return { subject, text, html };
};
const buildOrderConfirmationEmail = ({ name, orderId, items, total, paymentMethod, createdAt, shippingAddress, viewUrl, }) => {
    const safeName = escapeHtml(name || "there");
    const formattedDate = new Date(createdAt || Date.now()).toLocaleString();
    const lines = (items || []).map((item) => {
        const title = escapeHtml(item.title || "Item");
        const qty = Number(item.quantity || 0) || 1;
        const price = Number(item.price || 0);
        return `- ${title} x${qty} (₦${formatMoney(price)})`;
    });
    const addressLine = shippingAddress
        ? [
            shippingAddress.fullName,
            shippingAddress.addressLine1,
            shippingAddress.addressLine2,
            shippingAddress.city,
            shippingAddress.state,
            shippingAddress.country,
            shippingAddress.postalCode,
            shippingAddress.phone,
        ]
            .filter(Boolean)
            .join(", ")
        : "";
    const subject = `Order ${orderId} confirmed`;
    const text = `Hi ${safeName},\n\nYour order ${orderId} has been placed on ${formattedDate}.\n\nItems:\n${lines.join("\n")}\n\nTotal: ₦${formatMoney(total)}\nPayment method: ${paymentMethod}\n${addressLine ? `Shipping: ${addressLine}\n` : ""}\n${viewUrl ? `View your order: ${viewUrl}\n` : ""}\nThank you for shopping with supplements.ng.`;
    const itemRows = (items || [])
        .map((item) => {
        const title = escapeHtml(item.title || "Item");
        const qty = Number(item.quantity || 0) || 1;
        const price = Number(item.price || 0);
        return `
        <tr>
          <td style="padding:6px 0;">${title}</td>
          <td style="padding:6px 0; text-align:right;">${qty}</td>
          <td style="padding:6px 0; text-align:right;">₦${formatMoney(price)}</td>
        </tr>
      `;
    })
        .join("");
    const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>Hi ${safeName},</p>
      <p>Your order <strong>${escapeHtml(orderId)}</strong> has been placed on ${escapeHtml(formattedDate)}.</p>
      <table style="width:100%; border-collapse: collapse; margin: 12px 0;">
        <thead>
          <tr>
            <th style="text-align:left; padding-bottom:6px;">Item</th>
            <th style="text-align:right; padding-bottom:6px;">Qty</th>
            <th style="text-align:right; padding-bottom:6px;">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin:8px 0;"><strong>Total:</strong> ₦${formatMoney(total)}</p>
      <p style="margin:8px 0;"><strong>Payment:</strong> ${escapeHtml(paymentMethod || "Paystack")}</p>
      ${addressLine
        ? `<p style="margin:8px 0;"><strong>Shipping:</strong> ${escapeHtml(addressLine)}</p>`
        : ""}
      ${viewUrl
        ? `<p style="margin:8px 0;"><a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">View your order</a></p>`
        : ""}
      <p style="color:#6b7280;">Thank you for shopping with supplements.ng.</p>
    </div>
  `;
    return { subject, text, html };
};
const buildReceiptEmail = ({ name, orderId, total, createdAt, viewUrl, }) => {
    const safeName = escapeHtml(name || "there");
    const formattedDate = new Date(createdAt || Date.now()).toLocaleString();
    const subject = `Receipt for order ${orderId}`;
    const text = `Hi ${safeName},\n\nYour payment was successful. Attached is your receipt for order ${orderId}.\nTotal paid: ₦${formatMoney(total)}\nDate: ${formattedDate}\n${viewUrl ? `View order: ${viewUrl}\n` : ""}\nThank you for shopping with supplements.ng.`;
    const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>Hi ${safeName},</p>
      <p>Your payment was successful. Attached is your receipt for order <strong>${escapeHtml(orderId)}</strong>.</p>
      <p><strong>Total paid:</strong> ₦${formatMoney(total)}</p>
      <p><strong>Date:</strong> ${escapeHtml(formattedDate)}</p>
      ${viewUrl
        ? `<p><a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">View order</a></p>`
        : ""}
      <p style="color:#6b7280;">Thank you for shopping with supplements.ng.</p>
    </div>
  `;
    return { subject, text, html };
};
const buildWelcomeEmail = ({ name }) => {
    const safeName = escapeHtml(name || "there");
    const subject = "Welcome to supplements.ng";
    const text = `Hi ${safeName},\n\nWelcome to supplements.ng! Your account is ready. Explore supplements, track orders, and get pharmacist support anytime.\n\nThank you for joining us.`;
    const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>Hi ${safeName},</p>
      <p>Welcome to <strong>supplements.ng</strong>! Your account is ready. Explore supplements, track orders, and get pharmacist support anytime.</p>
      <p style="color:#6b7280;">Thank you for joining us.</p>
    </div>
  `;
    return { subject, text, html };
};
const buildOrderStatusEmail = ({ name, orderId, status, viewUrl, }) => {
    const safeName = escapeHtml(name || "there");
    const safeOrderId = escapeHtml(orderId);
    const safeStatus = escapeHtml(status);
    const subject = `Order ${safeOrderId} update: ${safeStatus}`;
    const text = `Hi ${safeName},\n\nYour order ${safeOrderId} status is now ${safeStatus}.\n${viewUrl ? `View order: ${viewUrl}\n` : ""}\nThank you for shopping with supplements.ng.`;
    const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>Hi ${safeName},</p>
      <p>Your order <strong>${safeOrderId}</strong> status is now <strong>${safeStatus}</strong>.</p>
      ${viewUrl
        ? `<p><a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">View order</a></p>`
        : ""}
      <p style="color:#6b7280;">Thank you for shopping with supplements.ng.</p>
    </div>
  `;
    return { subject, text, html };
};
module.exports = {
    sendBrevoEmail,
    buildVerificationEmail,
    buildPasswordResetEmail,
    buildOrderConfirmationEmail,
    buildReceiptEmail,
    buildWelcomeEmail,
    buildOrderStatusEmail,
};
