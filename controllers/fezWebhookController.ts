const { prisma, newId } = require("../utils/prismaLegacy");
const { sendOrderStatusWhatsApp } = require("../services/whatsappService");

const FEZ_WEBHOOK_SECRET = (process.env.FEZ_WEBHOOK_SECRET || "").toString().trim();
const FEZ_WEBHOOK_SECRET_HEADER = (process.env.FEZ_WEBHOOK_SECRET_HEADER || "x-fez-secret")
  .toString()
  .trim()
  .toLowerCase();

const readHeader = (req, name) =>
  req.headers?.[name] || req.headers?.[name.toLowerCase()];

const getWebhookSecret = (req) => {
  if (!FEZ_WEBHOOK_SECRET) return null;
  return readHeader(req, FEZ_WEBHOOK_SECRET_HEADER);
};

const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const extractOrderIdentifiers = (payload) => {
  const uniqueId = pickFirst(
    payload?.uniqueID,
    payload?.uniqueId,
    payload?.orderId,
    payload?.order_id,
    payload?.data?.uniqueID,
    payload?.data?.uniqueId,
    payload?.data?.orderId,
    payload?.data?.order_id
  );

  const orderNo = pickFirst(
    payload?.orderNo,
    payload?.orderNumber,
    payload?.order_number,
    payload?.data?.orderNo,
    payload?.data?.orderNumber,
    payload?.data?.order_number
  );

  return { uniqueId, orderNo };
};

const extractTrackingUrl = (payload) =>
  pickFirst(payload?.trackingUrl, payload?.trackingURL, payload?.tracking_url, payload?.data?.trackingUrl);

const extractStatus = (payload) =>
  pickFirst(
    payload?.status,
    payload?.deliveryStatus,
    payload?.orderStatus,
    payload?.currentStatus,
    payload?.state,
    payload?.data?.status,
    payload?.data?.deliveryStatus,
    payload?.data?.orderStatus
  );

exports.handleFezWebhook = async (req, res) => {
  try {
    if (FEZ_WEBHOOK_SECRET) {
      const headerSecret = getWebhookSecret(req);
      if (!headerSecret || headerSecret !== FEZ_WEBHOOK_SECRET) {
        return res.status(401).json({ message: "Invalid webhook secret" });
      }
    }

    const payload = req.body || {};
    const { uniqueId, orderNo } = extractOrderIdentifiers(payload);
    const status = extractStatus(payload);
    const trackingUrl = extractTrackingUrl(payload);

    let order = null;
    if (uniqueId) {
      order = await prisma.order.findUnique({
        where: { id: uniqueId },
        include: { user: { select: { phone: true } } },
      });
    }
    if (!order && orderNo) {
      order = await prisma.order.findFirst({
        where: { deliveryOrderNo: orderNo },
        include: { user: { select: { phone: true } } },
      });
    }

    if (!order) {
      return res.status(200).json({ received: true, matched: false });
    }

    const updateData = {
      deliveryProvider: "FEZ",
      deliveryOrderNo: orderNo || order.deliveryOrderNo || null,
      deliveryStatus: status ? status.toString() : order.deliveryStatus,
      deliveryTrackingUrl: trackingUrl || order.deliveryTrackingUrl || null,
      deliveryMeta: payload,
    };

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: updateData,
      include: { user: { select: { phone: true } } },
    });

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
            meta: { deliveryStatus: status },
          },
        })
        .catch(() => null);
    }

    if (updated.user?.phone && status) {
      sendOrderStatusWhatsApp({
        to: updated.user.phone,
        orderId: updated.id,
        status,
      }).catch((err) => console.error("Fez WhatsApp update failed", err));
    }

    return res.status(200).json({ received: true, matched: true });
  } catch (error) {
    console.error("Fez webhook error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

