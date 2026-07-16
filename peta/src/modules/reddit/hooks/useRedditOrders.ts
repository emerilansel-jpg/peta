import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRedditOrders, createRedditOrder, createForumCommentOrder, createYouTubeUploadOrder } from '../lib/api';
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

  const createYouTubeUploadOrderMutation = useMutation({
    mutationFn: (input: {
      videoUrl: string;
      title: string;
      description: string;
      tags: string;
      privacy: 'public' | 'unlisted' | 'private';
      notes: string | null;
    }) => createYouTubeUploadOrder(input.videoUrl, input.title, input.description, input.tags, input.privacy, input.notes),
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
    createForumCommentOrderAsync: createForumCommentOrderMutation.mutateAsync,
    isCreatingForumCommentOrder: createForumCommentOrderMutation.isPending,
    createYouTubeUploadOrder: createYouTubeUploadOrderMutation.mutate,
    isCreatingYouTubeUploadOrder: createYouTubeUploadOrderMutation.isPending,
    error: createOrderMutation.error,
  };
}
