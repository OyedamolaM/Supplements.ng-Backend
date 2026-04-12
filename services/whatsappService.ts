const API_HOST = process.env.WHATSAPP_CLOUD_API_HOST || "https://graph.facebook.com";
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || "v20.0";
const PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
const ACCESS_TOKEN = (process.env.WHATSAPP_CLOUD_API_TOKEN || "").trim();
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CALLING_CODE || "234").trim();
const OTP_TEMPLATE = (process.env.WHATSAPP_TEMPLATE_OTP || "supplements_otp").trim();
const ORDER_STATUS_TEMPLATE = (process.env.WHATSAPP_TEMPLATE_ORDER_STATUS || "order_status_update").trim();

const ensureWhatsAppConfig = () => {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    const error: any = new Error(
      "WhatsApp Cloud API is not configured. Set WHATSAPP_CLOUD_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID."
    );
    error.status = 500;
    throw error;
  }
};

const normalizeWhatsAppRecipient = (value: string) => {
  if (!value) return "";
  const cleaned = value.toString().trim().replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned;

  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("234")) return `+${digits}`;
  if (digits.startsWith("0")) {
    return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  }
  return `+${digits}`;
};

const isE164 = (value: string) => /^\+?[1-9]\d{6,14}$/.test(value.replace(/\s+/g, ""));

const sendWhatsAppTemplate = async ({
  to,
  templateName,
  components,
  language = "en_US",
}: {
  to: string;
  templateName: string;
  components?: Array<Record<string, any>>;
  language?: string;
}) => {
  ensureWhatsAppConfig();

  const endpoint = `${API_HOST}/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components?.length ? { components } : {}),
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: any = new Error("WhatsApp Cloud API error.");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

const sendWhatsAppOtp = async ({
  to,
  code,
  minutes,
}: {
  to: string;
  code: string;
  minutes: number;
}) => {
  const normalized = normalizeWhatsAppRecipient(to);
  if (!normalized || !isE164(normalized)) {
    const error: any = new Error("Recipient phone must be in E.164 format.");
    error.status = 400;
    throw error;
  }

  return sendWhatsAppTemplate({
    to: normalized,
    templateName: OTP_TEMPLATE,
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: code },
          { type: "text", text: minutes.toString() },
        ],
      },
    ],
    language: "en_US",
  });
};

const sendOrderStatusWhatsApp = async ({
  to,
  orderId,
  status,
}: {
  to: string;
  orderId: string;
  status: string;
}) => {
  const normalized = normalizeWhatsAppRecipient(to);
  if (!normalized || !isE164(normalized)) {
    const error: any = new Error("Recipient phone must be in E.164 format.");
    error.status = 400;
    throw error;
  }

  return sendWhatsAppTemplate({
    to: normalized,
    templateName: ORDER_STATUS_TEMPLATE,
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: orderId },
          { type: "text", text: status },
        ],
      },
    ],
    language: "en_US",
  });
};

module.exports = {
  ensureWhatsAppConfig,
  normalizeWhatsAppRecipient,
  sendWhatsAppOtp,
  sendOrderStatusWhatsApp,
};

export {};
