"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CRMChatBot from "./crmchatbot";
import FloatingDroitBuddyButton from "./FloatingDroitBuddyButton";
import styles from "./crmchatbot.module.css";
import type { DroitCommand } from "./droitCommands";

const SEEN_STORAGE_KEY = "droit-buddy-seen";

export type DroitBuddyHandle = {
  open: () => void;
};

type Props = {
  contextLeadId?: number | string | null;
  contextContactId?: number | string | null;
  pendingCommand?: DroitCommand | null;
  onPendingCommandConsumed?: (commandId: string) => void;
  onAction?: (action: any) => void;
  buttonHost?: HTMLElement | null;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
};

const DroitBuddyPanel = forwardRef<DroitBuddyHandle, Props>(function DroitBuddyPanel(
  {
    contextLeadId,
    contextContactId,
    pendingCommand,
    onPendingCommandConsumed,
    onAction,
    buttonHost = null,
    sidebarWidth = 0,
    sidebarCollapsed = false,
  },
  ref,
): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const drawerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      setUnreadCount(window.localStorage.getItem(SEEN_STORAGE_KEY) ? 0 : 1);
    } catch {
      setUnreadCount(1);
    }
  }, []);

  const openAssistant = useCallback(() => {
    setMounted(true);
    setOpen(true);
    setUnreadCount(0);
    try {
      window.localStorage.setItem(SEEN_STORAGE_KEY, "1");
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const closeAssistant = useCallback(() => {
    setOpen(false);
  }, []);

  const toggleAssistant = useCallback(() => {
    if (open) {
      closeAssistant();
      return;
    }
    openAssistant();
  }, [open, closeAssistant, openAssistant]);

  useImperativeHandle(
    ref,
    () => ({
      open: openAssistant,
    }),
    [openAssistant],
  );

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (drawerRef.current?.querySelector('[aria-expanded="true"]')) return;
      event.preventDefault();
      closeAssistant();
    }

    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => {
      drawerRef.current?.focus();
    }, 40);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, closeAssistant]);

  useEffect(() => {
    if (open || !mounted) return;
    const focusTimer = window.setTimeout(() => {
      buttonRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(focusTimer);
  }, [open, mounted]);

  return (
    <>
      {buttonHost
        ? createPortal(
            <FloatingDroitBuddyButton
              ref={buttonRef}
              open={open}
              collapsed={sidebarCollapsed}
              unreadCount={unreadCount}
              onClick={toggleAssistant}
            />,
            buttonHost,
          )
        : null}

      <div
        className={`${styles.assistantOverlay} ${
          open ? styles.assistantOverlayVisible : ""
        }`}
        style={sidebarWidth ? { left: sidebarWidth } : undefined}
        onClick={closeAssistant}
        aria-hidden="true"
      />

      <aside
        ref={drawerRef}
        className={`${styles.assistantDrawer} ${
          open ? styles.assistantDrawerOpen : ""
        }`}
        role="dialog"
        aria-modal={open}
        aria-label="Droit Buddy"
        aria-hidden={!open}
        tabIndex={-1}
      >
        {mounted ? (
          <CRMChatBot
            onClose={closeAssistant}
            contextLeadId={contextLeadId ?? null}
            contextContactId={contextContactId ?? null}
            pendingCommand={pendingCommand}
            onPendingCommandConsumed={onPendingCommandConsumed}
            onAction={onAction}
          />
        ) : null}
      </aside>
    </>
  );
});

export default DroitBuddyPanel;
