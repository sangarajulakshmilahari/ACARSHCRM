"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import DroitBuddyPanel, { type DroitBuddyHandle } from "./DroitBuddyPanel";
import {
  type DroitCommand,
  type DroitCommandInput,
} from "./droitCommands";

export type { DroitCommand, DroitCommandInput } from "./droitCommands";
export { droitCommandMessage } from "./droitCommands";

export type DroitControl = {
  openDroit: () => void;
  runDroitCommand: (command: DroitCommandInput) => void;
};

type DroitLayoutProps = {
  buttonHost?: HTMLElement | null;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  contextLeadId?: number | string | null;
  onAction?: (action: { type?: string }) => void;
};

type DroitLayoutApi = {
  setDroitLayout: (layout: DroitLayoutProps | null) => void;
};

const DroitControlContext = createContext<DroitControl | null>(null);
const DroitLayoutContext = createContext<DroitLayoutApi | null>(null);

export function useDroitControl(): DroitControl {
  const value = useContext(DroitControlContext);
  if (!value) {
    throw new Error("useDroitControl must be used within WebpageDroitHost");
  }
  return value;
}

export function useDroitLayout(): DroitLayoutApi {
  const value = useContext(DroitLayoutContext);
  if (!value) {
    throw new Error("useDroitLayout must be used within WebpageDroitHost");
  }
  return value;
}

export default function WebpageDroitHost({ children }: { children: ReactNode }) {
  const droitRef = useRef<DroitBuddyHandle>(null);
  const [layout, setLayout] = useState<DroitLayoutProps>({});
  const [pendingCommand, setPendingCommand] = useState<DroitCommand | null>(null);

  const setDroitLayout = useCallback((next: DroitLayoutProps | null) => {
    setLayout(next ?? {});
  }, []);

  const openDroit = useCallback(() => {
    droitRef.current?.open();
  }, []);

  const runDroitCommand = useCallback(
    (command: DroitCommandInput) => {
      const next = {
        ...command,
        id: `${command.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      } as DroitCommand;
      setPendingCommand(next);
      droitRef.current?.open();
    },
    [],
  );

  const consumePendingCommand = useCallback((commandId: string) => {
    setPendingCommand((current) => (current?.id === commandId ? null : current));
  }, []);

  const control = useMemo(
    () => ({ openDroit, runDroitCommand }),
    [openDroit, runDroitCommand],
  );
  const layoutApi = useMemo(() => ({ setDroitLayout }), [setDroitLayout]);

  const commandLeadId =
    pendingCommand && "contextLeadId" in pendingCommand
      ? pendingCommand.contextLeadId
      : layout.contextLeadId;
  const commandContactId =
    pendingCommand && "contextContactId" in pendingCommand
      ? pendingCommand.contextContactId
      : undefined;

  return (
    <DroitControlContext.Provider value={control}>
      <DroitLayoutContext.Provider value={layoutApi}>
        {children}
        <DroitBuddyPanel
          ref={droitRef}
          buttonHost={layout.buttonHost ?? null}
          sidebarWidth={layout.sidebarWidth ?? 0}
          sidebarCollapsed={layout.sidebarCollapsed ?? false}
          contextLeadId={commandLeadId ?? null}
          contextContactId={commandContactId}
          pendingCommand={pendingCommand}
          onPendingCommandConsumed={consumePendingCommand}
          onAction={layout.onAction}
        />
      </DroitLayoutContext.Provider>
    </DroitControlContext.Provider>
  );
}
