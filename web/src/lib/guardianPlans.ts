export type FamilyMemberStatus = 'pending' | 'confirmed';
export type GuardianPlanStatus =
  | 'draft'
  | 'locked'
  | 'claimable'
  | 'claimed'
  | 'split_sent'
  | 'failed';

export type GuardianParent = {
  label: string;
  publicKey: string;
  status: FamilyMemberStatus;
};

export type GuardianChild = {
  id: string;
  label: string;
  publicKey: string;
  amount: string;
  status: FamilyMemberStatus;
};

export type GuardianPlan = {
  id: string;
  hostPublicKey: string;
  parent: GuardianParent;
  children: GuardianChild[];
  totalAmount: string;
  asset: 'XLM';
  unlockAt: string;
  claimableBalanceId?: string;
  createTxHash?: string;
  claimTxHash?: string;
  splitTxHash?: string;
  status: GuardianPlanStatus;
  createdAt: string;
};

const STORAGE_KEY = 'ofw-guardian-family-plans:v2';

export function loadGuardianPlans(): GuardianPlan[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getGuardianPlan(id: string): GuardianPlan | undefined {
  return loadGuardianPlans().find((plan) => plan.id === id);
}

export function saveGuardianPlans(plans: GuardianPlan[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

export function upsertGuardianPlan(plan: GuardianPlan): GuardianPlan[] {
  const plans = loadGuardianPlans();
  const nextPlans = [
    plan,
    ...plans.filter((existingPlan) => existingPlan.id !== plan.id),
  ];
  saveGuardianPlans(nextPlans);
  return nextPlans;
}

export function updateGuardianPlan(
  planId: string,
  updates: Partial<GuardianPlan>,
): GuardianPlan[] {
  const plans = loadGuardianPlans();
  const nextPlans = plans.map((plan) =>
    plan.id === planId ? { ...plan, ...updates } : plan,
  );
  saveGuardianPlans(nextPlans);
  return nextPlans;
}
