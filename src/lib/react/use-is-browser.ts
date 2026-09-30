import { useSyncExternalStore } from "react";

// false during server rendering and hydration, true once running in the browser.
// Use it for anything that only exists in the browser (wallets, local time zone,
// "now"), so the server HTML matches the first browser render (no hydration error).
const noopSubscribe = () => () => {};

export function useIsBrowser(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
