const { prisma, newId } = require("../utils/prismaLegacy");

const NEWSLETTER_FIRST_ORDER_DISCOUNT_PERCENT = 5;

const normalizeNewsletterEmail = (value: any) =>
  (value || "").toString().trim().toLowerCase();

const roundCurrency = (value: any) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
};

const isValidEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value);

const resolveSubscribedAt = (subscriber: any) => {
  const value = subscriber?.subscribedAt || subscriber?.createdAt || null;
  return value ? new Date(value) : null;
};

const getNewsletterDiscountStatus = async (
  tx: any,
  { email, userId }: { email: string; userId?: string | null }
) => {
  const normalizedEmail = normalizeNewsletterEmail(email);
  if (!normalizedEmail) {
    return {
      subscriber: null,
      discountPercent: 0,
      eligible: false,
      subscribedAt: null,
    };
  }

  const subscriber = await tx.newsletterSubscriber.findUnique({
    where: { email: normalizedEmail },
  });

  if (!subscriber || !subscriber.isActive || subscriber.firstOrderDiscountUsedAt) {
    return {
      subscriber,
      discountPercent: 0,
      eligible: false,
      subscribedAt: resolveSubscribedAt(subscriber),
    };
  }

  const discountPercent = Number(
    subscriber.firstOrderDiscountPercent || NEWSLETTER_FIRST_ORDER_DISCOUNT_PERCENT
  );
  if (!Number.isFinite(discountPercent) || discountPercent <= 0) {
    return {
      subscriber,
      discountPercent: 0,
      eligible: false,
      subscribedAt: resolveSubscribedAt(subscriber),
    };
  }

  const subscribedAt = resolveSubscribedAt(subscriber);
  if (userId && subscribedAt) {
    const orderCountSinceSubscription = await tx.order.count({
      where: {
        userId,
        createdAt: {
          gte: subscribedAt,
        },
      },
    });

    if (orderCountSinceSubscription > 0) {
      return {
        subscriber,
        discountPercent,
        eligible: false,
        subscribedAt,
      };
    }
  }

  return {
    subscriber,
    discountPercent,
    eligible: true,
    subscribedAt,
  };
};

const subscribeToNewsletter = async (email: string) => {
  const normalizedEmail = normalizeNewsletterEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    const error: any = new Error("Valid email is required");
    error.status = 400;
    throw error;
  }

  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    const subscriber = await prisma.newsletterSubscriber.update({
      where: { email: normalizedEmail },
      data: {
        isActive: true,
        subscribedAt: new Date(),
        firstOrderDiscountPercent:
          Number(existing.firstOrderDiscountPercent || 0) > 0
            ? existing.firstOrderDiscountPercent
            : NEWSLETTER_FIRST_ORDER_DISCOUNT_PERCENT,
      },
    });

    return { subscriber, created: false };
  }

  const subscriber = await prisma.newsletterSubscriber.create({
    data: {
      id: newId(),
      email: normalizedEmail,
      isActive: true,
      subscribedAt: new Date(),
      firstOrderDiscountPercent: NEWSLETTER_FIRST_ORDER_DISCOUNT_PERCENT,
    },
  });

  return { subscriber, created: true };
};

const claimFirstOrderNewsletterDiscount = async (
  tx: any,
  {
    email,
    userId,
    subtotal,
    orderId,
  }: { email: string; userId: string; subtotal: number; orderId: string }
) => {
  const normalizedEmail = normalizeNewsletterEmail(email);
  const normalizedSubtotal = roundCurrency(subtotal);

  if (!normalizedEmail || !userId || !orderId || normalizedSubtotal <= 0) {
    return { discountAmount: 0, discountPercent: 0, eligible: false };
  }

  const status = await getNewsletterDiscountStatus(tx, { email: normalizedEmail, userId });
  if (!status.eligible || !status.subscriber) {
    return { discountAmount: 0, discountPercent: 0, eligible: false };
  }

  const claim = await tx.newsletterSubscriber.updateMany({
    where: {
      email: normalizedEmail,
      isActive: true,
      firstOrderDiscountUsedAt: null,
    },
    data: {
      firstOrderDiscountUsedAt: new Date(),
      firstOrderDiscountUsedOrderId: orderId,
    },
  });

  if (!claim.count) {
    return { discountAmount: 0, discountPercent: 0, eligible: false };
  }

  return {
    discountAmount: roundCurrency((normalizedSubtotal * status.discountPercent) / 100),
    discountPercent: status.discountPercent,
    eligible: true,
  };
};

const previewFirstOrderNewsletterDiscount = async (
  tx: any,
  {
    email,
    userId,
    subtotal,
  }: { email: string; userId?: string | null; subtotal: number }
) => {
  const normalizedSubtotal = roundCurrency(subtotal);
  if (normalizedSubtotal <= 0) {
    return { discountAmount: 0, discountPercent: 0, eligible: false };
  }

  const status = await getNewsletterDiscountStatus(tx, { email, userId });
  if (!status.eligible) {
    return { discountAmount: 0, discountPercent: 0, eligible: false };
  }

  return {
    discountAmount: roundCurrency((normalizedSubtotal * status.discountPercent) / 100),
    discountPercent: status.discountPercent,
    eligible: true,
  };
};

const getNewsletterFirstOrderDiscountPercent = () =>
  NEWSLETTER_FIRST_ORDER_DISCOUNT_PERCENT;

module.exports = {
  normalizeNewsletterEmail,
  roundCurrency,
  subscribeToNewsletter,
  getNewsletterDiscountStatus,
  previewFirstOrderNewsletterDiscount,
  claimFirstOrderNewsletterDiscount,
  getNewsletterFirstOrderDiscountPercent,
};

export {};
