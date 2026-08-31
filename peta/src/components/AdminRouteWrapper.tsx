import React from 'react';
import { Navigate } from 'react-router-dom';

export function AdminRouteWrapper({ children }: { children: React.ReactNode }) {
  // Hostname is static for the lifetime of the page; compute it once at render.
  const isStraight = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    return /(^|\.)straight\.ltd$/i.test(window.location.hostname);
  }, []);

  // On the Straight Ltd domain, /admin means the Straight admin console —
  // send stray PeTa admin paths there.
  if (isStraight) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
