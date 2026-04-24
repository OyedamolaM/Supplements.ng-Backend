const bcrypt = require("bcryptjs");
const { prisma, newId } = require("../utils/prismaLegacy");

const ACCOUNT_DELETION_GRACE_DAYS = 14;
const ACCOUNT_PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000;

const toDateOrNull = (value: any) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getAccountDeletionSchedule = (from: Date = new Date()) => {
  const requestedAt = new Date(from);
  const scheduledFor = new Date(
    requestedAt.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
  );

  return {
    requestedAt,
    deactivatedAt: requestedAt,
    scheduledFor,
  };
};

const isUserPurged = (user: any) => Boolean(toDateOrNull(user?.accountPurgedAt));

const isUserDeactivated = (user: any) =>
  Boolean(toDateOrNull(user?.deactivatedAt)) && !isUserPurged(user);

const isReactivationWindowOpen = (user: any) => {
  if (!isUserDeactivated(user)) return false;
  const scheduledFor = toDateOrNull(user?.accountDeletionScheduledFor);
  return Boolean(scheduledFor && scheduledFor.getTime() > Date.now());
};

const buildAccountDeactivationResponse = (user: any) => {
  const scheduledFor = toDateOrNull(user?.accountDeletionScheduledFor);
  const canReactivate = isReactivationWindowOpen(user);

  return {
    accountDeactivated: true,
    canReactivate,
    deactivatedAt: toDateOrNull(user?.deactivatedAt)?.toISOString() || null,
    accountDeletionScheduledFor: scheduledFor?.toISOString() || null,
    message: canReactivate
      ? `Account is deactivated. Sign in again before ${scheduledFor?.toISOString()} to reactivate it.`
      : "Account is deactivated and can no longer be reactivated.",
  };
};

const reactivateUserAccount = async (userId: string) =>
  prisma.user.update({
    where: { id: userId },
    data: {
      deactivatedAt: null,
      accountDeletionRequestedAt: null,
      accountDeletionScheduledFor: null,
    },
  });

const anonymizePurgedUser = async (tx: any, user: any) => {
  const deletedEmail = `deleted+${user.id}@deleted.local`;
  const deletedPassword = await bcrypt.hash(`${newId()}-deleted-account`, 10);
  const purgeTime = new Date();

  await Promise.all([
    tx.shippingAddress.deleteMany({ where: { userId: user.id } }),
    tx.userWishlistItem.deleteMany({ where: { userId: user.id } }),
    tx.userCartItem.deleteMany({ where: { userId: user.id } }),
    tx.notificationRead.deleteMany({ where: { userId: user.id } }),
    tx.customerReminder.deleteMany({ where: { userId: user.id } }),
    tx.prescription.deleteMany({ where: { userId: user.id } }),
    tx.activityLog.deleteMany({ where: { userId: user.id } }),
    tx.newsletterSubscriber.deleteMany({ where: { email: user.email } }),
    tx.order.updateMany({
      where: { userId: user.id },
      data: {
        shippingFullName: null,
        shippingAddressLine1: null,
        shippingAddressLine2: null,
        shippingCity: null,
        shippingState: null,
        shippingCountry: null,
        shippingPostalCode: null,
        shippingPhone: null,
      },
    }),
  ]);

  await tx.user.update({
    where: { id: user.id },
    data: {
      name: "Deleted User",
      phone: "",
      email: deletedEmail,
      password: deletedPassword,
      emailVerified: false,
      emailVerifiedAt: null,
      emailVerificationCode: "",
      emailVerificationExpiresAt: null,
      passwordResetCode: "",
      passwordResetExpiresAt: null,
      appleSubject: null,
      avatarUrl: "",
      passwordChangedAt: purgeTime,
      dateOfBirth: null,
      gender: "",
      bloodGroup: "",
      genotype: "",
      allergies: "",
      medications: "",
      conditions: "",
      assignedPharmacistName: "",
      branchId: null,
      region: "",
      deactivatedAt: user.deactivatedAt || purgeTime,
      accountDeletionRequestedAt: user.accountDeletionRequestedAt || purgeTime,
      accountDeletionScheduledFor: user.accountDeletionScheduledFor || purgeTime,
      accountPurgedAt: purgeTime,
    },
  });
};

const purgeExpiredDeactivatedAccounts = async () => {
  const dueUsers = await prisma.user.findMany({
    where: {
      deactivatedAt: { not: null },
      accountDeletionScheduledFor: { lte: new Date() },
      accountPurgedAt: null,
    },
    select: {
      id: true,
      email: true,
      deactivatedAt: true,
      accountDeletionRequestedAt: true,
      accountDeletionScheduledFor: true,
    },
  });

  for (const user of dueUsers) {
    await prisma.$transaction(async (tx) => {
      await anonymizePurgedUser(tx, user);
    });
  }

  return dueUsers.length;
};

const startAccountPurgeLoop = () => {
  purgeExpiredDeactivatedAccounts().catch((error) =>
    console.error("Initial account purge failed", error)
  );

  return setInterval(() => {
    purgeExpiredDeactivatedAccounts().catch((error) =>
      console.error("Scheduled account purge failed", error)
    );
  }, ACCOUNT_PURGE_INTERVAL_MS);
};

module.exports = {
  ACCOUNT_DELETION_GRACE_DAYS,
  getAccountDeletionSchedule,
  isUserPurged,
  isUserDeactivated,
  isReactivationWindowOpen,
  buildAccountDeactivationResponse,
  reactivateUserAccount,
  purgeExpiredDeactivatedAccounts,
  startAccountPurgeLoop,
};

export {};
