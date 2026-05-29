import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRedditOrders, createRedditOrder, createForumCommentOrder } from '../lib/api';
import type { ForumCommentOrderInput } from '../lib/api';

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

  const createForumCommentOrderMutation = useMutation({
    mutationFn: (input: ForumCommentOrderInput) => createForumCommentOrder(input),
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
    createForumCommentOrder: createForumCommentOrderMutation.mutate,
    isCreatingForumCommentOrder: createForumCommentOrderMutation.isPending,
    error: createOrderMutation.error,
  };
}
