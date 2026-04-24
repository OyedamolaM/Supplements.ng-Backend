const WHATSAPP_WEBHOOK_VERIFY_TOKEN = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "")
  .toString()
  .trim();

const verifyWhatsAppWebhook = (req, res) => {
  const mode = req.query?.["hub.mode"];
  const token = req.query?.["hub.verify_token"];
  const challenge = req.query?.["hub.challenge"];

  if (!WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(500).send("WhatsApp webhook verify token is not configured.");
  }

  if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    return res.status(200).send(challenge.toString());
  }

  return res.sendStatus(403);
};

const handleWhatsAppWebhook = (req, res) => {
  const payload = req.body || {};

  if (payload?.object !== "whatsapp_business_account") {
    return res.sendStatus(404);
  }

  const changes = payload.entry?.flatMap((entry) => entry.changes || []) || [];
  changes.forEach((change) => {
    const value = change?.value || {};
    const statuses = value.statuses || [];
    const messages = value.messages || [];

    statuses.forEach((status) => {
      console.log("WhatsApp message status", {
        phoneNumberId: value.metadata?.phone_number_id,
        recipientId: status.recipient_id,
        messageId: status.id,
        status: status.status,
        errors: status.errors || [],
      });
    });

    messages.forEach((message) => {
      console.log("WhatsApp inbound message", {
        phoneNumberId: value.metadata?.phone_number_id,
        from: message.from,
        messageId: message.id,
        type: message.type,
      });
    });
  });

  return res.sendStatus(200);
};

module.exports = {
  verifyWhatsAppWebhook,
  handleWhatsAppWebhook,
};

export {};
