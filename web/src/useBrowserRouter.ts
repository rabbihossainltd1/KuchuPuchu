import { useCallback, useEffect, useState } from "react";
import {
  canonicalPath,
  parseRoute,
  pathForRoute,
  type AppRoute,
  type NavigableRoute,
} from "./router";

type NavigateOptions = { replace?: boolean };

export type Navigate = (route: NavigableRoute, options?: NavigateOptions) => void;

export function useBrowserRouter() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const syncFromLocation = () => {
      const pathname = window.location.pathname;
      const nextRoute = parseRoute(pathname);
      const canonical = canonicalPath(pathname);

      if (canonical && canonical !== pathname) {
        window.history.replaceState(window.history.state, "", canonical);
      }
      setRoute(nextRoute);
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const navigate = useCallback<Navigate>((nextRoute, options = {}) => {
    const nextPath = pathForRoute(nextRoute);
    const currentPath = window.location.pathname;

    if (options.replace) {
      window.history.replaceState(window.history.state, "", nextPath);
    } else if (nextPath !== currentPath) {
      window.history.pushState(window.history.state, "", nextPath);
    }
    setRoute(nextRoute);
  }, []);

  return { route, navigate };
}
