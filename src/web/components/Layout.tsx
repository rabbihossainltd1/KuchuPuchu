import { NavLink, Outlet, Link } from "react-router-dom";
import {
  Bell,
  Compass,
  HelpCircle,
  Home,
  Inbox,
  MessageCircle,
  Settings,
  Store,
  UserRound,
  Wallet,
  Gift,
  Shield,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Notice } from "./ui";

const primary = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/requests", label: "Requests", icon: Inbox },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/profile", label: "Profile", icon: UserRound },
];

export function AppLayout() {
  const { user, offline } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    void api<{ unread: number }>("/api/notifications")
      .then((data) => setUnread(data.unread))
      .catch(() => undefined);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/home">
          <div className="brand-mark">K</div>
          <div>
            <strong>KuchuPuchu</strong>
            <span>Find your next squad</span>
          </div>
        </Link>
        <nav className="nav-list" aria-label="Primary">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <nav className="side-extra" aria-label="More">
          <NavLink to="/store" className="nav-link">
            <Store size={18} /> Store
          </NavLink>
          <NavLink to="/inventory" className="nav-link">
            <Gift size={18} /> Inventory
          </NavLink>
          <NavLink to="/wallet" className="nav-link">
            <Wallet size={18} /> Wallet
          </NavLink>
          <NavLink to="/referrals" className="nav-link">
            <Gift size={18} /> Referrals
          </NavLink>
          <NavLink to="/notifications" className="nav-link">
            <Bell size={18} /> Notifications{unread ? ` (${unread})` : ""}
          </NavLink>
          <NavLink to="/settings" className="nav-link">
            <Settings size={18} /> Settings
          </NavLink>
          <NavLink to="/help" className="nav-link">
            <HelpCircle size={18} /> Help & Safety
          </NavLink>
          {user?.adminRole ? (
            <NavLink to="/admin" className="nav-link">
              <Shield size={18} /> Admin
            </NavLink>
          ) : null}
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <div />
          <Link className="coins" to="/wallet">
            <Wallet size={16} />
            {user?.wallet.balance ?? 0} coins
          </Link>
        </div>
        {offline ? (
          <Notice tone="danger">
            You are offline. Some actions will fail until you reconnect.
          </Notice>
        ) : null}
        {!user?.emailVerified && user?.email ? (
          <Notice>
            Verify your email to unlock referral rewards and some account recovery options.
          </Notice>
        ) : null}
        <Outlet />
      </div>
      <nav className="bottom-nav" aria-label="Mobile">
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
