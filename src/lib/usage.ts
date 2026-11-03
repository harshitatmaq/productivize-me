import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Free-tier budget tracking. Each external API has a monthly (or daily) cap;
 * `paceAllows` spreads usage evenly across the period so an hourly job never
 * burns the whole month's quota in the first few days.
 */

export function monthPeriod(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

export function dayPeriod(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export async function getUsage(provider: string, period: string): Promise<number> {
  const { data } = await supabaseAdmin()
    .from("api_usage")
    .select("count")
    .eq("provider", provider)
    .eq("period", period)
    .maybeSingle();
  return data?.count ?? 0;
}

export async function addUsage(provider: string, period: string, amount = 1): Promise<void> {
  const { error } = await supabaseAdmin().rpc("increment_api_usage", {
    p_provider: provider,
    p_period: period,
    p_amount: amount,
  });
  if (error) console.warn(`[usage] failed to record ${provider}: ${error.message}`);
}

/** Fraction (0-1) of the current UTC month or day that has elapsed. */
export function elapsedFraction(kind: "month" | "day", now = new Date()): number {
  if (kind === "day") {
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return (now.getTime() - start) / 86_400_000;
  }
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return (now.getTime() - start) / (end - start);
}

/**
 * True when spending `cost` more units keeps usage at or below the even pace
 * line for the period (plus a small burst allowance).
 */
export function withinPace(used: number, limit: number, fraction: number, cost = 1, burst = 0.05): boolean {
  if (limit <= 0) return false;
  if (used + cost > limit) return false;
  const allowed = limit * Math.min(1, fraction + burst);
  return used + cost <= Math.max(allowed, cost);
}

export async function paceAllows(
  provider: string,
  limit: number,
  kind: "month" | "day" = "month",
  cost = 1,
): Promise<boolean> {
  const period = kind === "month" ? monthPeriod() : dayPeriod();
  const used = await getUsage(provider, period);
  return withinPace(used, limit, elapsedFraction(kind), cost);
}

export async function recordCall(provider: string, kind: "month" | "day" = "month", amount = 1) {
  await addUsage(provider, kind === "month" ? monthPeriod() : dayPeriod(), amount);
}
