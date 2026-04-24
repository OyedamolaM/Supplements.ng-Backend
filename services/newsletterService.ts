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

  const existingOrderCount = await tx.order.count({
    where: { userId },
  });
  if (existingOrderCount > 0) {
    return { discountAmount: 0, discountPercent: 0, eligible: false };
  }

  const subscriber = await tx.newsletterSubscriber.findUnique({
    where: { email: normalizedEmail },
  });

  if (!subscriber || !subscriber.isActive || subscriber.firstOrderDiscountUsedAt) {
    return { discountAmount: 0, discountPercent: 0, eligible: false };
  }

  const discountPercent = Number(
    subscriber.firstOrderDiscountPercent || NEWSLETTER_FIRST_ORDER_DISCOUNT_PERCENT
  );
  if (!Number.isFinite(discountPercent) || discountPercent <= 0) {
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
    discountAmount: roundCurrency((normalizedSubtotal * discountPercent) / 100),
    discountPercent,
    eligible: true,
  };
};

const getNewsletterFirstOrderDiscountPercent = () =>
  NEWSLETTER_FIRST_ORDER_DISCOUNT_PERCENT;

module.exports = {
  normalizeNewsletterEmail,
  roundCurrency,
  subscribeToNewsletter,
  claimFirstOrderNewsletterDiscount,
  getNewsletterFirstOrderDiscountPercent,
};

export {};
