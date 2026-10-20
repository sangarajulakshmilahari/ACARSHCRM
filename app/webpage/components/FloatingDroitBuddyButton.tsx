"use client";

import { forwardRef } from "react";
import DroitBuddyRobotIcon from "./DroitBuddyRobotIcon";
import styles from "./crmchatbot.module.css";

type Props = {
  unreadCount?: number;
  onClick: () => void;
  open?: boolean;
  collapsed?: boolean;
};

const FloatingDroitBuddyButton = forwardRef<HTMLButtonElement, Props>(
  function FloatingDroitBuddyButton(
    { unreadCount = 0, onClick, open = false, collapsed = false },
    ref,
  ): JSX.Element {
    const hasUnread = unreadCount > 0;
    const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);
    const label = open ? "Close Droit buddy" : "Droit buddy";

    return (
      <button
        ref={ref}
        type="button"
        className={`${styles.sidebarTab} ${open ? styles.sidebarTabOpen : ""} ${
          collapsed ? styles.sidebarTabCollapsed : ""
        }`}
        onClick={onClick}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
      >
        <span className={styles.sidebarTabIcon} aria-hidden="true">
          <DroitBuddyRobotIcon size={18} />
        </span>
        {!collapsed ? <span className={styles.sidebarTabLabel}>{label}</span> : null}
        {hasUnread && !open ? (
          <span
            className={styles.sidebarTabBadge}
            aria-label={`${unreadCount} unread notifications`}
          >
            {badgeLabel}
          </span>
        ) : null}
      </button>
    );
  },
);

export default FloatingDroitBuddyButton;
