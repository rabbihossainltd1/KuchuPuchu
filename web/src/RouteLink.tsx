import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { pathForRoute, type NavigableRoute } from "./router";
import type { Navigate } from "./useBrowserRouter";

type RouteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  route: NavigableRoute;
  navigate: Navigate;
};

export function RouteLink({
  route,
  navigate,
  onClick,
  target,
  download,
  children,
  ...props
}: RouteLinkProps) {
  const href = pathForRoute(route);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target !== undefined && target !== "_self") ||
      (download !== undefined && download !== false)
    ) {
      return;
    }

    event.preventDefault();
    navigate(route);
  }

  return (
    <a href={href} target={target} download={download} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
