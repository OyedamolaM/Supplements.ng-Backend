const MS_PER_DAY = 24 * 60 * 60 * 1000;

const asObject = (value: unknown): any =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeStatus = (value: unknown) => (value || "").toString().trim().toLowerCase();

const parseDateOrNull = (value: unknown) => {
  if (!value) return null;
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isDeliveryCompletionStatus = (value: unknown) => {
  const normalized = normalizeStatus(value);
  return (
    normalized.includes("delivered") ||
    normalized.includes("collected") ||
    normalized.includes("picked up") ||
    normalized.includes("picked-up")
  );
};

const resolveFulfillmentAnchor = (order: any) => {
  if (!order) return null;

  const deliveryMeta = asObject(order.deliveryMeta);
  const metaAnchor =
    parseDateOrNull(deliveryMeta.fulfilledAt) ||
    parseDateOrNull(deliveryMeta.customerReceivedAt) ||
    parseDateOrNull(deliveryMeta.completedAt) ||
    parseDateOrNull(deliveryMeta.deliveredAt);

  if (metaAnchor) return metaAnchor;

  if (
    isDeliveryCompletionStatus(order.orderStatus) ||
    isDeliveryCompletionStatus(order.deliveryStatus)
  ) {
    return parseDateOrNull(order.updatedAt) || parseDateOrNull(order.createdAt);
  }

  return null;
};

const buildFulfillmentMeta = (deliveryMeta: unknown, status: unknown, when = new Date()) => {
  const base = asObject(deliveryMeta);
  if (!isDeliveryCompletionStatus(status)) return base;

  const existingAnchor = resolveFulfillmentAnchor({ deliveryMeta: base });
  const fulfilledAt = existingAnchor || when;

  return {
    ...base,
    fulfilledAt: fulfilledAt.toISOString(),
    customerReceivedAt: fulfilledAt.toISOString(),
    fulfilledStatus: (status || "Delivered").toString(),
  };
};

const applyFulfillmentToOrderArtifacts = async (
  prisma: any,
  orderId: string,
  fulfilledAt: Date
) => {
  if (!prisma || !orderId) return;
  const anchor = parseDateOrNull(fulfilledAt);
  if (!anchor) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      items: {
        select: {
          productId: true,
          title: true,
          quantity: true,
        },
      },
    },
  });

  if (!order?.userId) return;

  await prisma.orderItem.updateMany({
    where: { orderId },
    data: { purchaseDate: anchor },
  });

  const itemByProductId = new Map<string, { title: string; quantity: number }>();
  for (const item of order.items || []) {
    if (!item.productId || itemByProductId.has(item.productId)) continue;
    itemByProductId.set(item.productId, {
      title: item.title || "Supplement item",
      quantity: Math.max(1, Number(item.quantity) || 1),
    });
  }

  const productIds = Array.from(itemByProductId.keys());
  if (!productIds.length) return;

  const reminders = await prisma.customerReminder.findMany({
    where: {
      userId: order.userId,
      productId: { in: productIds },
    },
    select: {
      id: true,
      productId: true,
      intervalDays: true,
      lastOrderedAt: true,
    },
  });

  if (!reminders.length) return;

  const reminderUpdates = reminders
    .map((reminder: any) => {
      const productItem = itemByProductId.get(reminder.productId);
      if (!productItem) return null;

      const previousAnchor = parseDateOrNull(reminder.lastOrderedAt);
      if (previousAnchor && previousAnchor.getTime() > anchor.getTime()) return null;

      const intervalDays =
        Number.isFinite(Number(reminder.intervalDays)) && Number(reminder.intervalDays) > 0
          ? Number(reminder.intervalDays)
          : Math.max(30, 30 * productItem.quantity);

      return prisma.customerReminder.update({
        where: { id: reminder.id },
        data: {
          orderId: order.id,
          label: productItem.title,
          lastOrderedAt: anchor,
          nextDueDate: new Date(anchor.getTime() + intervalDays * MS_PER_DAY),
        },
      });
    })
    .filter(Boolean);

  if (reminderUpdates.length) {
    await prisma.$transaction(reminderUpdates);
  }
};

module.exports = {
  asObject,
  isDeliveryCompletionStatus,
  resolveFulfillmentAnchor,
  buildFulfillmentMeta,
  applyFulfillmentToOrderArtifacts,
};
