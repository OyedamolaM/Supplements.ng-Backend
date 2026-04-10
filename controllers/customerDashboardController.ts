const { prisma, newId, toLegacyProduct } = require("../utils/prismaLegacy");
const { calculateRefill } = require("../services/refillCalculator");

const CANCELLED_ORDER_STATUSES = ["CANCELLED", "RETURNED"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const normalizeText = (value: unknown) => (value || "").toString().trim();
const normalizeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseDateOrNull = (value: unknown) => {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};
const toStartOfDayUTC = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const diffInDays = (future: Date, baseline: Date) => {
  const startFuture = toStartOfDayUTC(future).getTime();
  const startBase = toStartOfDayUTC(baseline).getTime();
  return Math.floor((startFuture - startBase) / MS_PER_DAY);
};

const NOTIFICATION_TITLES: Record<string, string> = {
  customer_order_created: "Order placed",
  customer_order_cancelled: "Order cancelled",
  order_status_update: "Order update",
  customer_prescription_created: "Prescription submitted",
  customer_prescription_uploaded: "Prescription uploaded",
  prescription_status_update: "Prescription update",
  pharmacist_assigned: "Pharmacist assigned",
  reminder_due: "Refill reminder",
  feature_update: "Feature update",
};

const getNotificationTitle = (log: any) =>
  NOTIFICATION_TITLES[log.action] || log.message || "New update";

const getNotificationLink = (log: any) => {
  const entity = (log.entityType || "").toString().toLowerCase();
  if (entity === "order") return "/dashboard/orders";
  if (entity === "prescription") return "/dashboard/prescriptions";
  if (entity === "reminder") return "/dashboard/reminders";
  if (log.action === "pharmacist_assigned") return "/dashboard/pharmacist";
  return "/dashboard/overview";
};

const buildRefillNotificationMessage = (calculated: any) => {
  if (calculated.status === "manual_setup_required") return "Set dosage to get refill reminders";
  if (calculated.status === "refill_due_today") return "Refill due today";
  if (calculated.status === "refill_due_soon") {
    return calculated.daysLeft !== null && calculated.daysLeft !== undefined
      ? `Refill due in ${calculated.daysLeft} days`
      : "Refill due soon";
  }
  if (calculated.status === "refill_overdue") {
    const overdueBy =
      calculated.daysLeft !== null && calculated.daysLeft !== undefined
        ? Math.abs(calculated.daysLeft)
        : null;
    return overdueBy !== null ? `Refill overdue by ${overdueBy} days` : "Refill overdue";
  }
  return "Refill update";
};

const toDashboardPrescription = (record: any) => ({
  _id: record.id,
  id: record.id,
  title: record.title,
  notes: record.notes || "",
  attachmentUrl: record.attachmentUrl || "",
  attachmentName: record.attachmentName || "",
  status: (record.status || "PENDING").toString().toLowerCase(),
  pharmacistNotes: record.pharmacistNotes || "",
  validUntil: record.validUntil ? record.validUntil.toISOString() : null,
  dosageText: record.dosageText || "",
  pharmacistName: record.pharmacistName || "",
  order: record.order
    ? {
        _id: record.order.id,
        id: record.order.id,
        orderStatus: (record.order.orderStatus || "PROCESSING").toString(),
        createdAt: record.order.createdAt,
      }
    : null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const toDashboardReminder = (record: any) => ({
  _id: record.id,
  id: record.id,
  productId: record.productId,
  label: record.label,
  intervalDays: record.intervalDays,
  nextDueDate: record.nextDueDate,
  lastOrderedAt: record.lastOrderedAt,
  note: record.note || "",
  isPaused: Boolean(record.isPaused),
  product: record.product ? toLegacyProduct(record.product) : null,
  order: record.order
    ? {
        _id: record.order.id,
        id: record.order.id,
        orderStatus: (record.order.orderStatus || "PROCESSING").toString(),
        createdAt: record.order.createdAt,
      }
    : null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const fetchDashboardReminders = async (userId: string) => {
  const reminders = await prisma.customerReminder.findMany({
    where: { userId },
    include: {
      product: true,
      order: {
        select: {
          id: true,
          orderStatus: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ isPaused: "asc" }, { nextDueDate: "asc" }, { createdAt: "desc" }],
  });

  return reminders.map(toDashboardReminder);
};

exports.getPrescriptions = async (req, res) => {
  try {
    const prescriptions = await prisma.prescription.findMany({
      where: { userId: req.user.id },
      include: {
        order: {
          select: {
            id: true,
            orderStatus: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(prescriptions.map(toDashboardPrescription));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createPrescription = async (req, res) => {
  try {
    const title = normalizeText(req.body?.title);
    const notes = normalizeText(req.body?.notes);
    const attachmentUrl = normalizeText(req.body?.attachmentUrl);
    const attachmentName = normalizeText(req.body?.attachmentName);
    const dosageText = normalizeText(req.body?.dosageText);
    const pharmacistName = normalizeText(req.body?.pharmacistName);
    const validUntil = parseDateOrNull(req.body?.validUntil);
    const orderId = normalizeText(req.body?.orderId) || null;

    if (req.body?.validUntil && !validUntil) {
      return res.status(400).json({ message: "Valid-until date is invalid" });
    }

    if (!title) {
      return res.status(400).json({ message: "Prescription title is required" });
    }

    let order = null;
    if (orderId) {
      order = await prisma.order.findFirst({
        where: { id: orderId, userId: req.user.id },
        select: { id: true, orderStatus: true, createdAt: true, branchId: true },
      });
      if (!order) {
        return res.status(404).json({ message: "Order not found for this customer" });
      }
    }

    const prescription = await prisma.prescription.create({
      data: {
        id: newId(),
        userId: req.user.id,
        orderId,
        title,
        notes,
        attachmentUrl,
        attachmentName,
        validUntil,
        dosageText,
        pharmacistName,
      },
      include: {
        order: {
          select: {
            id: true,
            orderStatus: true,
            createdAt: true,
          },
        },
      },
    });

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "customer_prescription_created",
          entityType: "prescription",
          entityId: prescription.id,
          branchId: order?.branchId || req.user.branch || null,
          message: "Customer submitted prescription details",
        },
      })
      .catch(() => null);

    res.status(201).json(toDashboardPrescription(prescription));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createPrescriptionUpload = async (req, res) => {
  try {
    const title = normalizeText(req.body?.title);
    const notes = normalizeText(req.body?.notes);
    const orderId = normalizeText(req.body?.orderId) || null;
    const file = req.file;
    const dosageText = normalizeText(req.body?.dosageText);
    const pharmacistName = normalizeText(req.body?.pharmacistName);
    const validUntil = parseDateOrNull(req.body?.validUntil);

    if (!file) {
      return res.status(400).json({ message: "Prescription file is required" });
    }

    if (req.body?.validUntil && !validUntil) {
      return res.status(400).json({ message: "Valid-until date is invalid" });
    }

    const attachmentUrl = normalizeText(file.path || "");
    const attachmentName = normalizeText(file.originalname || "");
    const resolvedTitle =
      title ||
      attachmentName.replace(/\.[^/.]+$/, "").trim() ||
      "Prescription Upload";

    let order = null;
    if (orderId) {
      order = await prisma.order.findFirst({
        where: { id: orderId, userId: req.user.id },
        select: { id: true, orderStatus: true, createdAt: true, branchId: true },
      });
      if (!order) {
        return res.status(404).json({ message: "Order not found for this customer" });
      }
    }

    const prescription = await prisma.prescription.create({
      data: {
        id: newId(),
        userId: req.user.id,
        orderId,
        title: resolvedTitle,
        notes,
        attachmentUrl,
        attachmentName,
        validUntil,
        dosageText,
        pharmacistName,
      },
      include: {
        order: {
          select: {
            id: true,
            orderStatus: true,
            createdAt: true,
          },
        },
      },
    });

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "customer_prescription_uploaded",
          entityType: "prescription",
          entityId: prescription.id,
          branchId: order?.branchId || req.user.branch || null,
          message: "Customer uploaded prescription",
        },
      })
      .catch(() => null);

    res.status(201).json(toDashboardPrescription(prescription));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getReminders = async (req, res) => {
  try {
    res.json(await fetchDashboardReminders(req.user.id));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.syncReminders = async (req, res) => {
  try {
    const existingReminders = await prisma.customerReminder.findMany({
      where: { userId: req.user.id },
    });
    const reminderByProductId = new Map<string, any>(
      existingReminders.map((item) => [item.productId, item])
    );

    const orders = await prisma.order.findMany({
      where: {
        userId: req.user.id,
        orderStatus: { notIn: CANCELLED_ORDER_STATUSES },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const processed = new Set<string>();

    for (const order of orders) {
      for (const item of order.items || []) {
        if (!item.productId || processed.has(item.productId)) continue;
        processed.add(item.productId);

        const existing = reminderByProductId.get(item.productId);
        const intervalDays = existing?.intervalDays || Math.max(30, 30 * (Number(item.quantity) || 1));
        const lastOrderedAt = order.createdAt;
        const nextDueDate = new Date(lastOrderedAt.getTime() + intervalDays * MS_PER_DAY);

        if (existing) {
          await prisma.customerReminder.update({
            where: { id: existing.id },
            data: {
              orderId: order.id,
              label: item.product?.title || item.title || existing.label,
              intervalDays,
              lastOrderedAt,
              nextDueDate,
            },
          });
        } else {
          await prisma.customerReminder.create({
            data: {
              id: newId(),
              userId: req.user.id,
              orderId: order.id,
              productId: item.productId,
              label: item.product?.title || item.title || "Supplement item",
              intervalDays,
              lastOrderedAt,
              nextDueDate,
              note: "",
              isPaused: false,
            },
          });
        }
      }
    }

    res.json(await fetchDashboardReminders(req.user.id));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.upsertReminder = async (req, res) => {
  try {
    const productId = normalizeText(req.body?.productId);
    const label = normalizeText(req.body?.label);
    const note = normalizeText(req.body?.note);
    const orderId = normalizeText(req.body?.orderId) || null;
    const intervalDays = normalizeNumber(req.body?.intervalDays, 30);
    const isPaused = Boolean(req.body?.isPaused);

    if (!productId) {
      return res.status(400).json({ message: "Product is required for a reminder" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    let order = null;
    if (orderId) {
      order = await prisma.order.findFirst({
        where: { id: orderId, userId: req.user.id },
        select: { id: true, createdAt: true },
      });
      if (!order) {
        return res.status(404).json({ message: "Order not found for this customer" });
      }
    }

    const explicitNextDueDate = normalizeText(req.body?.nextDueDate);
    const anchorDate = order?.createdAt || new Date();
    const nextDueDate = explicitNextDueDate
      ? new Date(explicitNextDueDate)
      : new Date(anchorDate.getTime() + intervalDays * MS_PER_DAY);

    if (Number.isNaN(nextDueDate.getTime())) {
      return res.status(400).json({ message: "Next due date is invalid" });
    }

    const existing = await prisma.customerReminder.findFirst({
      where: { userId: req.user.id, productId },
      select: { id: true },
    });

    const reminder = existing
      ? await prisma.customerReminder.update({
          where: { id: existing.id },
          data: {
            orderId,
            label: label || product.title,
            intervalDays,
            nextDueDate,
            lastOrderedAt: order?.createdAt || null,
            note,
            isPaused,
          },
          include: {
            product: true,
            order: {
              select: {
                id: true,
                orderStatus: true,
                createdAt: true,
              },
            },
          },
        })
      : await prisma.customerReminder.create({
          data: {
            id: newId(),
            userId: req.user.id,
            orderId,
            productId,
            label: label || product.title,
            intervalDays,
            nextDueDate,
            lastOrderedAt: order?.createdAt || null,
            note,
            isPaused,
          },
          include: {
            product: true,
            order: {
              select: {
                id: true,
                orderStatus: true,
                createdAt: true,
              },
            },
          },
        });

    res.status(existing ? 200 : 201).json(toDashboardReminder(reminder));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateReminder = async (req, res) => {
  try {
    const existing = await prisma.customerReminder.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        order: {
          select: {
            id: true,
            createdAt: true,
          },
        },
      },
    });
    if (!existing) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    const intervalDays = req.body?.intervalDays !== undefined
      ? normalizeNumber(req.body.intervalDays, existing.intervalDays)
      : existing.intervalDays;
    const note = req.body?.note !== undefined ? normalizeText(req.body.note) : existing.note;
    const isPaused = req.body?.isPaused !== undefined ? Boolean(req.body.isPaused) : existing.isPaused;
    const label = req.body?.label !== undefined ? normalizeText(req.body.label) : existing.label;
    const explicitNextDueDate = normalizeText(req.body?.nextDueDate);

    const reminder = await prisma.customerReminder.update({
      where: { id: existing.id },
      data: {
        label: label || existing.label,
        note,
        isPaused,
        intervalDays,
        nextDueDate: explicitNextDueDate
          ? new Date(explicitNextDueDate)
          : existing.lastOrderedAt
            ? new Date(new Date(existing.lastOrderedAt).getTime() + intervalDays * MS_PER_DAY)
            : existing.nextDueDate,
      },
      include: {
        product: true,
        order: {
          select: {
            id: true,
            orderStatus: true,
            createdAt: true,
          },
        },
      },
    });

    res.json(toDashboardReminder(reminder));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteReminder = async (req, res) => {
  try {
    const reminder = await prisma.customerReminder.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: { id: true },
    });
    if (!reminder) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    await prisma.customerReminder.delete({
      where: { id: reminder.id },
    });

    res.json(await fetchDashboardReminders(req.user.id));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const fetchCustomerOrderItems = async (userId: string) =>
  prisma.orderItem.findMany({
    where: {
      order: { userId },
    },
    include: {
      order: {
        select: {
          id: true,
          createdAt: true,
          orderStatus: true,
        },
      },
      product: true,
    },
    orderBy: {
      order: {
        createdAt: "desc",
      },
    },
  });

const toRefillPayload = (item: any) => {
  const calculated = calculateRefill(item, item.order);
  return {
    id: item.id,
    orderId: item.orderId,
    productId: item.productId,
    productName: item.title,
    product: item.product ? toLegacyProduct(item.product) : null,
    purchaseDate: (item.purchaseDate || item.order?.createdAt || null)?.toISOString?.() || null,
    quantityBought: item.quantity,
    orderStatus: item.order?.orderStatus || null,
    usageText: calculated.usageText,
    usageMode: calculated.usageMode ? calculated.usageMode.toString().toLowerCase() : "fixed",
    refillable: calculated.refillable,
    reorderable: calculated.reorderable,
    status: calculated.status,
    daysLeft: calculated.daysLeft,
    daysSupply: calculated.daysSupply,
    refillDueDate: calculated.refillDueDate ? calculated.refillDueDate.toISOString() : null,
    manualSetupRequired: calculated.manualSetupRequired,
    unitType: calculated.unitType || "",
    isPaused: Boolean(item.isPaused),
    pausedAt: item.pausedAt ? item.pausedAt.toISOString() : null,
    pausedDays: item.pausedDays || 0,
    dosageRecommendedByName: item.dosageRecommendedByName || null,
    dosageRecommendedByRole: item.dosageRecommendedByRole || null,
    dosageRecommendedAt: item.dosageRecommendedAt ? item.dosageRecommendedAt.toISOString() : null,
    manualOverrideEnabled: Boolean(item.manualOverrideEnabled),
    manualDosageAmount: item.manualDosageAmount,
    manualFrequencyPerDay: item.manualFrequencyPerDay,
    manualDaysSupply: item.manualDaysSupply,
    manualUsageText: item.manualUsageText,
  };
};

exports.getRefillReminders = async (req, res) => {
  try {
    const items = await fetchCustomerOrderItems(req.user.id);
    res.json(items.map((item) => toRefillPayload(item)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getPurchasedItems = async (req, res) => {
  try {
    const items = await fetchCustomerOrderItems(req.user.id);
    res.json(items.map((item) => toRefillPayload(item)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updatePurchasedItemUsage = async (req, res) => {
  try {
    const orderItem = await prisma.orderItem.findFirst({
      where: { id: req.params.id, order: { userId: req.user.id } },
      include: {
        order: {
          select: { id: true, createdAt: true, orderStatus: true },
        },
        product: true,
      },
    });

    if (!orderItem) {
      return res.status(404).json({ message: "Purchased item not found" });
    }

    const toNumberOrNull = (value: unknown) => {
      if (value === undefined || value === null || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const manualDaysSupply = toNumberOrNull(req.body?.manualDaysSupply);
    const manualDosageAmount = toNumberOrNull(req.body?.manualDosageAmount);
    const manualFrequencyPerDay = toNumberOrNull(req.body?.manualFrequencyPerDay);
    const manualUsageText = normalizeText(req.body?.manualUsageText);
    const manualOverrideEnabled =
      req.body?.manualOverrideEnabled === false
        ? false
        : Boolean(manualDaysSupply || manualDosageAmount || manualFrequencyPerDay || manualUsageText);

    const updateData: any = manualOverrideEnabled
      ? {
          manualOverrideEnabled,
          manualDaysSupply,
          manualDosageAmount,
          manualFrequencyPerDay,
          manualUsageText: manualUsageText || null,
        }
      : {
          manualOverrideEnabled: false,
          manualDaysSupply: null,
          manualDosageAmount: null,
          manualFrequencyPerDay: null,
          manualUsageText: null,
        };

    const updated = await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: updateData,
      include: {
        order: {
          select: { id: true, createdAt: true, orderStatus: true },
        },
        product: true,
      },
    });

    res.json(toRefillPayload(updated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updatePurchasedItemPause = async (req, res) => {
  try {
    const orderItem = await prisma.orderItem.findFirst({
      where: { id: req.params.id, order: { userId: req.user.id } },
      include: {
        order: {
          select: { id: true, createdAt: true, orderStatus: true },
        },
        product: true,
      },
    });

    if (!orderItem) {
      return res.status(404).json({ message: "Purchased item not found" });
    }

    const shouldPause = req.body?.isPaused === true;
    const now = new Date();
    let updateData: any = {};

    if (shouldPause) {
      updateData = {
        isPaused: true,
        pausedAt: orderItem.pausedAt || now,
      };
    } else {
      const previousPausedDays = Number(orderItem.pausedDays || 0);
      const addedDays = orderItem.pausedAt ? Math.max(0, diffInDays(now, orderItem.pausedAt)) : 0;
      updateData = {
        isPaused: false,
        pausedAt: null,
        pausedDays: previousPausedDays + addedDays,
      };
    }

    const updated = await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: updateData,
      include: {
        order: {
          select: { id: true, createdAt: true, orderStatus: true },
        },
        product: true,
      },
    });

    res.json(toRefillPayload(updated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const buildRefillNotifications = async (userId: string) => {
  const items = await fetchCustomerOrderItems(userId);
  return items
    .map((item) => {
      const calculated = calculateRefill(item, item.order);
      const status = calculated.status;
      if (!["refill_due_today", "refill_due_soon", "refill_overdue", "manual_setup_required"].includes(status)) {
        return null;
      }
      const dueKey = calculated.refillDueDate
        ? new Date(calculated.refillDueDate).toISOString().split("T")[0]
        : "na";
      const computedKey = `refill:${item.id}:${status}:${dueKey}`;
      const createdAt =
        calculated.refillDueDate ||
        item.purchaseDate ||
        item.order?.createdAt ||
        new Date();
      return {
        computedKey,
        productName: item.title || item.product?.title || "Supplement item",
        createdAt,
        status,
        message: buildRefillNotificationMessage(calculated),
      };
    })
    .filter(Boolean) as Array<{
    computedKey: string;
    productName: string;
    createdAt: Date;
    status: string;
    message: string;
  }>;
};

exports.getNotifications = async (req, res) => {
  try {
    const activityLogs = await prisma.activityLog.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const refillNotifications = await buildRefillNotifications(req.user.id);

    const activityIds = activityLogs.map((log) => log.id);
    const computedKeys = refillNotifications.map((item) => item.computedKey);

    const readRows =
      activityIds.length || computedKeys.length
        ? await prisma.notificationRead.findMany({
            where: {
              userId: req.user.id,
              OR: [
                activityIds.length ? { activityLogId: { in: activityIds } } : undefined,
                computedKeys.length ? { computedKey: { in: computedKeys } } : undefined,
              ].filter(Boolean),
            },
          })
        : [];

    const readActivity = new Set(
      readRows.map((row) => row.activityLogId).filter(Boolean)
    );
    const readComputed = new Set(
      readRows.map((row) => row.computedKey).filter(Boolean)
    );

    const activityNotifications = activityLogs.map((log) => ({
      id: log.id,
      source: "activity",
      title: getNotificationTitle(log),
      message: log.message || "",
      createdAt: log.createdAt,
      isRead: readActivity.has(log.id),
      actionUrl: getNotificationLink(log),
    }));

    const computedNotifications = refillNotifications.map((item) => ({
      id: item.computedKey,
      computedKey: item.computedKey,
      source: "computed",
      title: item.productName,
      message: item.message,
      createdAt: item.createdAt,
      isRead: readComputed.has(item.computedKey),
      actionUrl: "/dashboard/reminders",
    }));

    const combined = [...computedNotifications, ...activityNotifications]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);

    const unreadCount = combined.filter((item) => !item.isRead).length;

    res.json({ unreadCount, notifications: combined });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    const activityIds = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id: string) => id?.toString?.().trim?.()).filter(Boolean)
      : [];
    const computedKeys = Array.isArray(req.body?.computedKeys)
      ? req.body.computedKeys
          .map((key: string) => key?.toString?.().trim?.())
          .filter(Boolean)
      : [];

    if (activityIds.length === 0 && computedKeys.length === 0) {
      return res.json({ message: "No notifications selected" });
    }

    const now = new Date();
    const rows = [
      ...activityIds.map((id: string) => ({
        id: newId(),
        userId: req.user.id,
        activityLogId: id,
        readAt: now,
      })),
      ...computedKeys.map((key: string) => ({
        id: newId(),
        userId: req.user.id,
        computedKey: key,
        readAt: now,
      })),
    ];

    await prisma.notificationRead.createMany({
      data: rows,
      skipDuplicates: true,
    });

    res.json({ message: "Notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
