const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toStartOfDayUTC = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const diffInDays = (future: Date, baseline: Date) => {
  const startFuture = toStartOfDayUTC(future).getTime();
  const startBase = toStartOfDayUTC(baseline).getTime();
  return Math.floor((startFuture - startBase) / MS_PER_DAY);
};

const numberOrNull = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeUsageMode = (value: unknown) => {
  const raw = (value || "").toString().trim().toUpperCase();
  return raw === "AS_NEEDED" || raw === "AS-NEEDED" || raw === "AS NEEDED"
    ? "AS_NEEDED"
    : "FIXED";
};

const formatFrequencyLabel = (frequency: number) => {
  if (frequency <= 1) return "once daily";
  if (frequency === 2) return "twice daily";
  return `${frequency}x daily`;
};

const buildUsageText = (
  dosageAmount: number | null,
  dosageUnit: string | null,
  frequencyPerDay: number | null,
  fallbackText = ""
) => {
  if (fallbackText) return fallbackText;
  if (!dosageAmount || !frequencyPerDay) return "";
  const unit = (dosageUnit || "").trim();
  const frequencyLabel = formatFrequencyLabel(frequencyPerDay);
  const amountText = unit ? `${dosageAmount} ${unit}` : `${dosageAmount}`;
  return `Take ${amountText} ${frequencyLabel}`.trim();
};

export const calculateRefill = (orderItem: any, order: any) => {
  const refillable = orderItem.refillableSnapshot !== false;
  const reorderable = orderItem.reorderableSnapshot !== false;
  const usageMode = normalizeUsageMode(orderItem.usageModeSnapshot || "FIXED");
  const purchaseDate = orderItem.purchaseDate || order?.createdAt || new Date();
  const quantityBought = Number(orderItem.quantity || 1);
  const storedPausedDays = Number(orderItem.pausedDays || 0);
  const pausedAt = orderItem.pausedAt ? new Date(orderItem.pausedAt) : null;
  const pauseDelta =
    orderItem.isPaused && pausedAt ? Math.max(0, diffInDays(new Date(), pausedAt)) : 0;
  const totalPausedDays = storedPausedDays + pauseDelta;

  const manualDaysSupply = numberOrNull(orderItem.manualDaysSupply);
  const manualDosageAmount = numberOrNull(orderItem.manualDosageAmount);
  const manualFrequencyPerDay = numberOrNull(orderItem.manualFrequencyPerDay);
  const manualUsageText = (orderItem.manualUsageText || "").toString().trim();

  const snapshotDosageAmount = numberOrNull(orderItem.recommendedDosageAmountSnapshot);
  const snapshotFrequencyPerDay = numberOrNull(orderItem.recommendedFrequencyPerDaySnapshot);
  const snapshotDosageUnit = (orderItem.recommendedDosageUnitSnapshot || "").toString();
  const snapshotUsageText = (orderItem.recommendedUsageTextSnapshot || "").toString().trim();
  const packQuantity = numberOrNull(orderItem.packQuantitySnapshot);
  const unitType = (orderItem.unitTypeSnapshot || "").toString();

  if (!refillable && reorderable) {
    return {
      status: "buy_again_available",
      daysLeft: null,
      refillDueDate: null,
      daysSupply: null,
      manualSetupRequired: false,
      usageText: buildUsageText(snapshotDosageAmount, snapshotDosageUnit, snapshotFrequencyPerDay, snapshotUsageText),
      usageMode,
      refillable,
      reorderable,
      unitType,
      quantityBought,
    };
  }

  if (!refillable && !reorderable) {
    return {
      status: "not_refillable",
      daysLeft: null,
      refillDueDate: null,
      daysSupply: null,
      manualSetupRequired: false,
      usageText: buildUsageText(snapshotDosageAmount, snapshotDosageUnit, snapshotFrequencyPerDay, snapshotUsageText),
      usageMode,
      refillable,
      reorderable,
      unitType,
      quantityBought,
    };
  }

  if (usageMode === "AS_NEEDED" && !manualDaysSupply && !manualDosageAmount && !manualFrequencyPerDay) {
    return {
      status: "manual_setup_required",
      daysLeft: null,
      refillDueDate: null,
      daysSupply: null,
      manualSetupRequired: true,
      usageText: manualUsageText || snapshotUsageText || "Set your usage to get refill reminders",
      usageMode,
      refillable,
      reorderable,
      unitType,
      quantityBought,
    };
  }

  let dosageAmount = snapshotDosageAmount;
  let frequencyPerDay = snapshotFrequencyPerDay;
  let usageText = buildUsageText(snapshotDosageAmount, snapshotDosageUnit, snapshotFrequencyPerDay, snapshotUsageText);

  if (manualDosageAmount || manualFrequencyPerDay) {
    dosageAmount = manualDosageAmount ?? dosageAmount;
    frequencyPerDay = manualFrequencyPerDay ?? frequencyPerDay;
    usageText = buildUsageText(manualDosageAmount, snapshotDosageUnit, manualFrequencyPerDay, manualUsageText || usageText);
  } else if (manualUsageText) {
    usageText = manualUsageText;
  }

  if (manualDaysSupply) {
    let effectiveDaysSupply = manualDaysSupply;
    if (dosageAmount && frequencyPerDay) {
      const manualUnits = manualDaysSupply;
      const dailyConsumption = dosageAmount * frequencyPerDay;
      if (Number.isFinite(dailyConsumption) && dailyConsumption > 0) {
        effectiveDaysSupply = Math.max(1, Math.floor(manualUnits / dailyConsumption));
      }
    }
    const dueDate = new Date(
      new Date(purchaseDate).getTime() + (effectiveDaysSupply + totalPausedDays) * MS_PER_DAY
    );
    const daysLeft = diffInDays(dueDate, new Date());
    const status =
      daysLeft < 0
        ? "refill_overdue"
        : daysLeft === 0
          ? "refill_due_today"
          : daysLeft <= 7
            ? "refill_due_soon"
            : "enough_supply";
    return {
      status: orderItem.isPaused ? "paused" : status,
      daysLeft,
      refillDueDate: dueDate,
      daysSupply: effectiveDaysSupply,
      manualSetupRequired: false,
      usageText,
      usageMode,
      refillable,
      reorderable,
      unitType,
      quantityBought,
    };
  }

  if (!dosageAmount || !frequencyPerDay || !packQuantity) {
    return {
      status: "manual_setup_required",
      daysLeft: null,
      refillDueDate: null,
      daysSupply: null,
      manualSetupRequired: true,
      usageText: usageText || "Set your usage to get refill reminders",
      usageMode,
      refillable,
      reorderable,
      unitType,
      quantityBought,
    };
  }

  const totalUnits = quantityBought * packQuantity;
  const dailyConsumption = dosageAmount * frequencyPerDay;

  if (!Number.isFinite(totalUnits) || !Number.isFinite(dailyConsumption) || dailyConsumption <= 0) {
    return {
      status: "manual_setup_required",
      daysLeft: null,
      refillDueDate: null,
      daysSupply: null,
      manualSetupRequired: true,
      usageText: usageText || "Set your usage to get refill reminders",
      usageMode,
      refillable,
      reorderable,
      unitType,
      quantityBought,
    };
  }

  const rawDaysSupply = totalUnits / dailyConsumption;
  const daysSupply = Math.max(1, Math.floor(rawDaysSupply));
  const dueDate = new Date(
    new Date(purchaseDate).getTime() + (daysSupply + totalPausedDays) * MS_PER_DAY
  );
  const daysLeft = diffInDays(dueDate, new Date());
  const status =
    daysLeft < 0
      ? "refill_overdue"
      : daysLeft === 0
        ? "refill_due_today"
        : daysLeft <= 7
          ? "refill_due_soon"
          : "enough_supply";

  return {
    status: orderItem.isPaused ? "paused" : status,
    daysLeft,
    refillDueDate: dueDate,
    daysSupply,
    manualSetupRequired: false,
    usageText,
    usageMode,
    refillable,
    reorderable,
    unitType,
    quantityBought,
  };
};
