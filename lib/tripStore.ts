const STORAGE_KEY = "weekend-trip-plans";

export function saveTripPlan(plan: any) {
  if (typeof window === "undefined") return;

  const raw = localStorage.getItem(STORAGE_KEY);
  const plans = raw ? JSON.parse(raw) : [];

  const next = plans.filter((p: any) => p.id !== plan.id);
  next.push(plan);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getTripPlanById(id: string) {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(STORAGE_KEY);
  const plans = raw ? JSON.parse(raw) : [];

  return plans.find((p: any) => p.id === id) ?? null;
}

export function getAllTripPlans() {
  if (typeof window === "undefined") return [];

  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}