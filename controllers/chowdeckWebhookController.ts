const { prisma, newId } = require("../utils/prismaLegacy");
const { sendOrderStatusWhatsApp } = require("../services/whatsappService");
const {
  isDeliveryCompletionStatus,
  buildFulfillmentMeta,
  applyFulfillmentToOrderArtifacts,
} = require("../utils/orderFulfillment");

const CHOWDECK_RELAY_WEBHOOK_SECRET = (
  process.env.CHOWDECK_RELAY_WEBHOOK_SECRET || ""
)
  .toString()
  .trim();
const CHOWDECK_RELAY_WEBHOOK_SECRET_HEADER = (
  process.env.CHOWDECK_RELAY_WEBHOOK_SECRET_HEADER || "x-chowdeck-secret"
)
  .toString()
  .trim()
  .toLowerCase();

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const readHeader = (req, name) =>
  req.headers?.[name] || req.headers?.[name.toLowerCase()];

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const getWebhookSecret = (req) => {
  if (!CHOWDECK_RELAY_WEBHOOK_SECRET) return null;
  return readHeader(req, CHOWDECK_RELAY_WEBHOOK_SECRET_HEADER);
};

const getNodes = (payload) =>
  [payload, payload?.payload, payload?.data, payload?.delivery].filter(Boolean);

const extractReference = (payload) => {
  for (const node of getNodes(payload)) {
    const reference = pickFirst(
      node?.reference,
      node?.delivery_reference,
      node?.deliveryReference,
      node?.order_reference,
      node?.orderReference
    );
    if (reference) return reference.toString();
  }
  return null;
};

const extractStatus = (payload) => {
  for (const node of getNodes(payload)) {
    const status = pickFirst(
      node?.status,
      node?.delivery_status,
      node?.deliveryStatus,
      node?.current_status,
      node?.currentStatus,
      node?.state
    );
    if (status) return status.toString();
  }
  return null;
};

const extractTrackingUrl = (payload) => {
  for (const node of getNodes(payload)) {
    const trackingUrl = pickFirst(
      node?.tracking_url,
      node?.trackingUrl,
      node?.tracking_url_public,
      node?.trackingUrlPublic
    );
    if (trackingUrl) return trackingUrl.toString();
  }
  return null;
};

exports.handleChowdeckWebhook = async (req, res) => {
  try {
    if (CHOWDECK_RELAY_WEBHOOK_SECRET) {
      const headerSecret = getWebhookSecret(req);
      if (!headerSecret || headerSecret !== CHOWDECK_RELAY_WEBHOOK_SECRET) {
        return res.status(401).json({ message: "Invalid webhook secret" });
      }
    }

    const payload = req.body || {};
    const reference = extractReference(payload);
    const status = extractStatus(payload);
    const trackingUrl = extractTrackingUrl(payload);

    if (!reference) {
      return res.status(200).json({ received: true, matched: false });
    }

    let order = await prisma.order.findFirst({
      where: { deliveryOrderNo: reference },
      include: { user: { select: { phone: true } } },
    });

    if (!order) {
      order = await prisma.order.findUnique({
        where: { id: reference },
        include: { user: { select: { phone: true } } },
      });
    }

    if (!order) {
      return res.status(200).json({ received: true, matched: false });
    }

    const deliveryMeta = asObject(order.deliveryMeta);
    const completionStatus = isDeliveryCompletionStatus(status);
    const fulfilledAt = completionStatus ? new Date() : null;
    const nextDeliveryMeta = completionStatus
      ? buildFulfillmentMeta(
          {
            ...deliveryMeta,
            chowdeckWebhook: payload,
          },
          status,
          fulfilledAt || new Date()
        )
      : {
          ...deliveryMeta,
          chowdeckWebhook: payload,
        };
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        ...(completionStatus ? { orderStatus: "DELIVERED" } : {}),
        deliveryProvider: "CHOWDECK",
        deliveryOrderNo: reference || order.deliveryOrderNo || order.id,
        deliveryStatus: completionStatus ? "DELIVERED" : status || order.deliveryStatus,
        deliveryTrackingUrl: trackingUrl || order.deliveryTrackingUrl || null,
        deliveryMeta: nextDeliveryMeta,
      },
      include: { user: { select: { phone: true } } },
    });

    if (completionStatus && fulfilledAt) {
      await applyFulfillmentToOrderArtifacts(prisma, updated.id, fulfilledAt);
    }

    if (updated.userId && status) {
      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: updated.userId,
            action: "delivery_status_update",
            entityType: "order",
            entityId: updated.id,
            branchId: updated.branchId || null,
            message: `Delivery update (${status}) for order ${updated.id}`,
            meta: { deliveryStatus: status, provider: "CHOWDECK" },
          },
        })
        .catch(() => null);
    }

    if (updated.user?.phone && status) {
      sendOrderStatusWhatsApp({
        to: updated.user.phone,
        orderId: updated.id,
        status,
      }).catch((error) => console.error("Chowdeck WhatsApp update failed", error));
    }

    return res.status(200).json({ received: true, matched: true });
  } catch (error) {
    console.error("Chowdeck webhook error", error);
    return res.status(500).json({ message: "Server error" });
  }
};
