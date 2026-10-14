import { useQuery } from '@tanstack/react-query';
import { getStraightPricing, getStraightRedditServiceEnabled, type StraightPricingRow } from '../lib/api';

// Reads the admin-configurable pricing matrix. Returns [] until loaded (or on
// error), so consumers fall back to legacy defaults via straightPrice/straightEnabled.
export function useStraightPricing(): StraightPricingRow[] {
  const { data } = useQuery({
    queryKey: ['straight-pricing'],
    queryFn: getStraightPricing,
    staleTime: 60_000,
  });
  return data ?? [];
}

export function useStraightRedditServiceEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['straight-reddit-service-enabled'],
    queryFn: getStraightRedditServiceEnabled,
    staleTime: 60_000,
  });
  return data ?? false;
}
