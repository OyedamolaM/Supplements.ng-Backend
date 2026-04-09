const { prisma, newId, toLegacyProduct } = require("../utils/prismaLegacy");

const CANCELLED_ORDER_STATUSES = ["CANCELLED", "RETURNED"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const normalizeText = (value: unknown) => (value || "").toString().trim();
const normalizeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    const orderId = normalizeText(req.body?.orderId) || null;

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
