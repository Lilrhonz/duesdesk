"use client";

import { useEffect } from "react";

// Lets a link like /dashboard/members?action=add open a pop-up as soon as the
// page loads. The parameter is removed from the address bar afterwards.
export function useQuickAction(handlers: Record<string, (params: URLSearchParams) => void>) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    if (!action) return;
    handlers[action]?.(params);
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
