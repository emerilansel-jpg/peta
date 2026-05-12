import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTopupHistory, completePayPalTopup } from '../lib/api';

export function useTopups() {
  const queryClient = useQueryClient();

  const { data: topups, isLoading } = useQuery({
    queryKey: ['reddit', 'topups'],
    queryFn: () => getTopupHistory(),
  });

  const completeTopupMutation = useMutation({
    mutationFn: ({
      amountCents,
      paypalOrderId,
      paypalCaptureId,
    }: {
      amountCents: number;
      paypalOrderId: string;
      paypalCaptureId: string;
    }) => completePayPalTopup(amountCents, paypalOrderId, paypalCaptureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reddit', 'topups'] });
      queryClient.invalidateQueries({ queryKey: ['reddit', 'credits'] });
    },
  });

  return {
    topups: topups || [],
    isLoading,
    completeTopup: completeTopupMutation.mutateAsync,
    isCompleting: completeTopupMutation.isPending,
    error: completeTopupMutation.error,
  };
}
