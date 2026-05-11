import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRedditOrders, createRedditOrder } from '../lib/api';

export function useRedditOrders() {
  const queryClient = useQueryClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['reddit', 'orders'],
    queryFn: getRedditOrders,
  });

  const createOrderMutation = useMutation({
    mutationFn: ({
      threadUrl,
      subreddit,
      requestedUpvotes,
      notes,
    }: {
      threadUrl: string;
      subreddit: string | null;
      requestedUpvotes: number;
      notes: string | null;
    }) => createRedditOrder(threadUrl, subreddit, requestedUpvotes, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reddit', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['reddit', 'credits'] });
    },
  });

  return {
    orders: orders || [],
    isLoading,
    createOrder: createOrderMutation.mutate,
    isCreating: createOrderMutation.isPending,
    error: createOrderMutation.error,
  };
}
