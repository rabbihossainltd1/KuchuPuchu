import { FormEvent, useEffect, useState } from "react";
import { NavLink, Outlet, Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bell,
  Compass,
  Gift,
  HelpCircle,
  Home,
  Inbox,
  Menu,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  Search,
  Settings,
  Shield,
  Store,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Notice } from "./ui";
import { CallProvider } from "../lib/calls";

const bottom = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/profile", label: "Profile", icon: UserRound },
];

export function AppLayout() {
  const { user, offline, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(params.get("q")));
  const [unread, setUnread] = useState(0);
  const [requests, setRequests] = useState(0);
  const [messages, setMessages] = useState(0);
  const [query, setQuery] = useState(params.get("q") ?? "");

  const onHome = location.pathname === "/home";
  const onProfile = location.pathname === "/profile";
  const notifyCount = unread + requests;

  useEffect(() => {
    void Promise.all([
      api<{ unread: number }>("/api/notifications"),
      api<{ items: unknown[] }>("/api/friend-requests"),
      api<{ items: Array<{ unread: number }> }>("/api/conversations"),
    ])
      .then(([n, f, c]) => {
        setUnread(n.unread);
        setRequests(f.items.length);
        setMessages(c.items.reduce((sum, item) => sum + (item.unread || 0), 0));
      })
      .catch(() => undefined);
  }, [location.pathname]);

  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);

  function search(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    next.delete("compose");
    setParams(next);
    if (!onHome) navigate(`/home?${next.toString()}`);
  }

  const menuItems = [
    { to: "/profile", label: "My profile", icon: UserRound },
    { to: "/friends", label: "Friends", icon: Users },
    { to: "/requests", label: "Requests", icon: Inbox },
    { to: "/discover", label: "Find duo", icon: Compass },
    { to: "/store", label: "Store", icon: Store },
    { to: "/wallet", label: "Add funds", icon: Wallet },
    { to: "/inventory", label: "Inventory", icon: Package },
    { to: "/referrals", label: "Referrals", icon: Gift },
    { to: "/settings", label: "Settings", icon: Settings },
    { to: "/help", label: "Help & Safety", icon: HelpCircle },
    ...(user?.adminRole ? [{ to: "/admin", label: "Admin", icon: Shield }] : []),
  ];

  return (
    <CallProvider>
      <div className="social-shell">
        <header className="app-header">
          <button className="icon-plain" type="button" aria-label="Open menu" onClick={() => setMenu(true)}>
            <Menu size={22} />
          </button>
          {onHome ? (
            <>
              <img className="wordmark-img" src="/brand/logo-horizontal.png" alt="KuchuPuchu" />
              <button
                className="icon-plain"
                type="button"
                aria-label="Create post"
                onClick={() => navigate("/home?compose=1")}
              >
                <Plus size={24} />
              </button>
              <button
                className="icon-plain"
                type="button"
                aria-label="Search"
                onClick={() => setSearchOpen((open) => !open)}
              >
                <Search size={20} />
              </button>
              <Link className="icon-plain" to="/messages" aria-label="Messages">
                <span className="nav-ico">
                  <MessageCircle size={20} />
                  {messages ? <i>{messages > 9 ? "9+" : messages}</i> : null}
                </span>
              </Link>
            </>
          ) : (
            <>
              <strong className="header-title">
                {onProfile
                  ? "Profile"
                  : location.pathname.startsWith("/messages")
                    ? "Messages"
                    : location.pathname.startsWith("/notifications")
                      ? "Notifications"
                      : location.pathname.startsWith("/friends")
                        ? "Friends"
                        : location.pathname.startsWith("/requests")
                          ? "Requests"
                          : location.pathname.startsWith("/discover")
                            ? "Find duo"
                            : location.pathname.startsWith("/settings")
                              ? "Settings"
                              : location.pathname.startsWith("/store")
                                ? "Store"
                                : location.pathname.startsWith("/wallet")
                                  ? "Add funds"
                                  : "KuchuPuchu"}
              </strong>
              {onProfile ? (
                <Link className="icon-plain" to="/profile/edit" aria-label="Edit profile">
                  <Pencil size={20} />
                </Link>
              ) : (
                <Link className="icon-plain" to="/wallet" aria-label="Wallet">
                  {user?.wallet.balance ?? 0}
                </Link>
              )}
            </>
          )}
        </header>
        {onHome && searchOpen ? (
          <form className="home-search" onSubmit={search}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts and players"
              aria-label="Search posts and players"
              autoFocus
            />
          </form>
        ) : null}
        {offline ? (
          <Notice tone="danger">You are offline. Some actions will fail until you reconnect.</Notice>
        ) : null}
        <div className="social-main">
          <Outlet />
        </div>
        <nav className="bottom-nav always" aria-label="Primary">
          {bottom.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="nav-ico">
                <item.icon size={22} aria-hidden="true" />
                {item.to === "/notifications" && notifyCount ? <i>{notifyCount > 9 ? "9+" : notifyCount}</i> : null}
                {item.to === "/messages" && messages ? <i>{messages > 9 ? "9+" : messages}</i> : null}
              </span>
              <span className="sr-only">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        {menu ? (
          <div className="drawer-wrap">
            <button className="drawer-backdrop" type="button" aria-label="Close menu" onClick={() => setMenu(false)} />
            <aside className="drawer" aria-label="Menu">
              <div className="drawer-head">
                <div className="drawer-id">
                  <img className="drawer-logo" src="/brand/icon-app-gold.png" alt="" />
                  <div>
                    <strong>{user?.displayName}</strong>
                    <div className="meta">@{user?.username}</div>
                  </div>
                </div>
                <button className="icon-plain" type="button" aria-label="Close" onClick={() => setMenu(false)}>
                  <X size={18} />
                </button>
              </div>
              <nav className="nav-list">
                {menuItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                    onClick={() => setMenu(false)}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <button className="btn-ghost" type="button" onClick={() => void logout()}>
                Sign out
              </button>
            </aside>
          </div>
        ) : null}
      </div>
    </CallProvider>
  );
}
