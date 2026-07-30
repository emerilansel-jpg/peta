import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCreditsBalance, getCreditsHistory } from '../lib/api';

export function useRedditCredits() {
  const queryClient = useQueryClient();

  const {
    data: balance,
    isLoading,
    error,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ['reddit', 'credits', 'balance'],
    queryFn: () => getCreditsBalance(),
    // Adaptive polling: every 5s when healthy, but back off (30s) after a
    // failure so a flapping network doesn't spam Supabase and inflate edge
    // request volume. Also stop entirely while the tab is hidden — a hidden
    // dashboard has no one to show fresh balance to.
    refetchInterval: (query) => (query.state.error ? 30_000 : 5_000),
    refetchIntervalInBackground: false,
  });

  const { data: history, error: historyError } = useQuery({
    queryKey: ['reddit', 'credits', 'history'],
    queryFn: () => getCreditsHistory(),
  });

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['reddit', 'credits'] });
  };

  return {
    balance: balance || 0,
    history: history || [],
    isLoading,
    // Surface both balance + history errors so callers can render a real
    // error banner instead of a silent $0.00 / empty list.
    error: error || historyError,
    refetch,
    refetchBalance,
  };
}

