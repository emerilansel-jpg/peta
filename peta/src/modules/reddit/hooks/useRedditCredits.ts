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
    refetchInterval: 5000,
  });

  const { data: history } = useQuery({
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
    error,
    refetch,
    refetchBalance,
  };
}
