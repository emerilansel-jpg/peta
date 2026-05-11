import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTopupRequests, createTopupRequest } from '../lib/api';

export function useTopups() {
  const queryClient = useQueryClient();

  const { data: topups, isLoading } = useQuery({
    queryKey: ['reddit', 'topups'],
    queryFn: getTopupRequests,
  });

  const createTopupMutation = useMutation({
    mutationFn: ({
      amountRequested,
      paymentMethod,
      proofUrl,
    }: {
      amountRequested: number;
      paymentMethod: string;
      proofUrl: string | null;
    }) => createTopupRequest(amountRequested, paymentMethod, proofUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reddit', 'topups'] });
    },
  });

  return {
    topups: topups || [],
    isLoading,
    createTopup: createTopupMutation.mutate,
    isCreating: createTopupMutation.isPending,
    error: createTopupMutation.error,
  };
}
