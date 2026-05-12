import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

/**
 * Subscribe to Postgres changes on a Supabase table and run `onChange` whenever a row
 * matching `filter` is INSERTed/UPDATEd/DELETEd. Uses a single WebSocket connection
 * managed by Supabase Realtime — significantly cheaper than periodic polling.
 *
 * @example
 * useRealtimeRefresh(
 *   { table: 'notifications', filter: `user_id=eq.${userId}` },
 *   () => refresh()
 * );
 */
export function useRealtimeRefresh(
  options: {
    table: string;
    schema?: string;
    event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
    filter?: string;
  },
  onChange: () => void,
  deps: any[] = []
) {
  useEffect(() => {
    const { table, schema = 'public', event = '*', filter } = options;
    const channelName = `realtime:${table}:${filter || 'all'}:${Math.random().toString(36).slice(2, 8)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as any,
        { event, schema, table, ...(filter ? { filter } : {}) },
        () => onChange()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
