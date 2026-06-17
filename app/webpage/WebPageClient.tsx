// page.tsx (updated)

"use client";

// export const dynamic = "force-dynamic";
// export const revalidate = false;
import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { clearUser } from "../../store/userSlice";
import { setEmployees } from "../../store/employeesSlice";
import EmployeeList, { Employee } from "./components/EmployeeList";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
// import AddLeadClient from "./leads/addleed/AddLeadClient";
// import LeadDetailsClient from "./leads/Leaddetails/LeadDetailsClient";
// import EditLeadPage from "./leads/Editlead/page";
import DashboardPage from "./dashboard/page";
import AddLeadClient from "./leads/addleed/AddLeadClient";
import LeadDetailsClient from "./leads/Leaddetails/LeadDetailsClient";
import EditLeadClient from "./leads/Editlead/EditLeadClient";
import ReportsClient from "./reports/ReportsClient";

import CRMChatBot from "../webpage/components/crmchatbot";

// Tabs
type TabKey =
    | "dashboard"
    | "leads"
    | "addLead"
    | "addProspect"
    | "addAccount"
    | "Prospect"
    | "leadDetails"
    | "Account"
    | "reports"
    | "editLead";

type SidebarIconProps = {
    children: React.ReactNode;
};

function SidebarIcon({ children }: SidebarIconProps): JSX.Element {
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

async function fetchEmployeeList(endpoint: string): Promise<Employee[]> {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return res.json();
}

function mergeEmployeeLists(...lists: Employee[][]): Employee[] {
    const merged = new Map<number | string, Employee>();

    lists.flat().forEach((employee) => {
        if (employee?.LeadId == null) return;
        merged.set(employee.LeadId, employee);
    });

    return Array.from(merged.values());
}

function getTabLabel(tab: TabKey): string {
    if (tab === "Account") return "Customer";
    return tab[0].toUpperCase() + tab.slice(1);
}

export default function WebPageClient(): JSX.Element {
    const dispatch = useDispatch();
    const router = useRouter();
    const searchParams = useSearchParams();

    // user (for welcome text)
    const user = useSelector(
        (s: RootState) => (s as any).user ?? (s as any).auth?.user ?? null
    );

    // employees from store (fallback)
    const employeesFromStore = useSelector(
        (s: RootState) => (s as any).employees ?? []
    );

    const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
    const [loading, setLoading] = useState(false);
    const [employeesLocal, setEmployeesLocal] = useState<Employee[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedLeadId, setSelectedLeadId] = useState<number | string | null>(
        null
    );
    const [selectedLeadOrigin, setSelectedLeadOrigin] = useState<
        "leads" | "Prospect" | "Account" | null
    >(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [loggedInUserName, setLoggedInUserName] = useState<string | null>(null);

    // Fetch logged-in user name from DB via Keycloak identity
    useEffect(() => {
        fetch("/api/auth/me")
            .then((res) => res.ok ? res.json() : null)
            .then((data) => { if (data?.name) setLoggedInUserName(data.name); })
            .catch(() => {});
    }, []);

    // Set activeTab based on URL tab param
    useEffect(() => {
        const tab = searchParams.get("tab");
        if (
            tab &&
            [
                "dashboard",
                "leads",
                "Prospect",
                "Account",
                "reports",
                "Reminder",
            ].includes(tab)
        ) {
            handleTab(tab === "Reminder" ? "reports" : (tab as TabKey));
        }
    }, [searchParams]);

    const tabIcons: Record<TabKey, React.ReactNode> = {
        dashboard: (
            <SidebarIcon>
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="5" rx="1.5" />
                <rect x="14" y="11" width="7" height="10" rx="1.5" />
                <rect x="3" y="13" width="7" height="8" rx="1.5" />
            </SidebarIcon>
        ),
        leads: (
            <SidebarIcon>
                <path d="M16 21v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 5 19.5V21" />
                <circle cx="10.5" cy="8" r="3.5" />
                <path d="M19 21v-1a3 3 0 0 0-2.2-2.9" />
                <path d="M16.5 4.8a3.5 3.5 0 0 1 0 6.4" />
            </SidebarIcon>
        ),
        Prospect: (
            <SidebarIcon>
                <circle cx="10" cy="8" r="3.5" />
                <path d="M4.5 18a5.5 5.5 0 0 1 11 0" />
                <circle cx="17.5" cy="17.5" r="3" />
                <path d="m19.7 19.7 1.8 1.8" />
            </SidebarIcon>
        ),
        Account: (
            <SidebarIcon>
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 10h.01" />
                <path d="M15 10h.01" />
                <path d="M9 14h.01" />
                <path d="M15 14h.01" />
                <path d="M10 21v-4h4v4" />
            </SidebarIcon>
        ),
        reports: (
            <SidebarIcon>
                <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                <path d="M9 8h6" />
                <path d="M9 12h6" />
                <path d="M9 16h4" />
            </SidebarIcon>
        ),
        addLead: "",
        leadDetails: "",
        addProspect: "",
        addAccount: "",
        editLead: "",
    };

    // ---- API CALLS ----

    const fetchLeadsList = async () => {
        try {
            setError(null);
            setLoading(true);

            const [leads, prospects, accounts] = await Promise.all([
                fetchEmployeeList("/api/employees/leads"),
                fetchEmployeeList("/api/employees/prospects"),
                fetchEmployeeList("/api/employees/account"),
            ]);
            const data = mergeEmployeeLists(leads, prospects, accounts);
            // dispatch(setEmployees(data));
            setEmployeesLocal(data);
        } catch (err: any) {
            console.error("Error fetching leads:", err);
            setError(err?.message ?? "Unknown error");
            setEmployeesLocal([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchProspectsList = async () => {
        try {
            setError(null);
            setLoading(true);

            const [prospects, accounts] = await Promise.all([
                fetchEmployeeList("/api/employees/prospects"),
                fetchEmployeeList("/api/employees/account"),
            ]);
            const data = mergeEmployeeLists(prospects, accounts);
            // dispatch(setEmployees(data));
            setEmployeesLocal(data);
        } catch (err: any) {
            console.error("Error fetching prospects:", err);
            setError(err?.message ?? "Unknown error");
            setEmployeesLocal([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchAccountList = async () => {
        try {
            setError(null);
            setLoading(true);

            const data = await fetchEmployeeList("/api/employees/account");
            // dispatch(setEmployees(data));
            setEmployeesLocal(data);
        } catch (err: any) {
            console.error("Error fetching prospects:", err);
            setError(err?.message ?? "Unknown error");
            setEmployeesLocal([]);
        } finally {
            setLoading(false);
        }
    };
    // TAB HANDLER 

    async function handleTab(tab: TabKey) {
        setActiveTab(tab);

        if (tab === "leads") {
            await fetchLeadsList();
        } else if (tab === "Prospect") {
            await fetchProspectsList();
        } else if (tab === "Account") {
            await fetchAccountList();
        }
    }

    function handleLogout() {
        dispatch(clearUser());
        window.location.href = "/api/auth/logout";
    }

    function toggleSidebar() {
        setSidebarCollapsed((prev) => !prev);
    }

    const sidebarActiveTab: TabKey =
        activeTab === "leadDetails" || activeTab === "editLead"
            ? selectedLeadOrigin ?? "leads"
            : activeTab === "addLead"
                ? "leads"
                : activeTab === "addProspect"
                    ? "Prospect"
                    : activeTab === "addAccount"
                        ? "Account"
                        : activeTab;

    const isListViewportTab =
        activeTab === "leads" ||
        activeTab === "Prospect" ||
        activeTab === "Account";

    const sidebarWidth = sidebarCollapsed ? 64 : 230;

    // ---- RENDER CONTENT ----

    const renderContent = () => {
        switch (activeTab) {

            case "dashboard":
                return <DashboardPage />;

            case "leads":
                return (
                    <EmployeeList
                        type="lead"
                        employees={employeesLocal ?? employeesFromStore}
                        loading={loading}
                        error={error}
                        onAddLead={() => setActiveTab("addLead")}
                        onOpenLeadDetails={(leadId, origin) => {
                            setSelectedLeadId(leadId);
                            setSelectedLeadOrigin(origin ?? "leads");
                            setActiveTab("leadDetails");
                        }}
                    />
                );

            case "Prospect":
                return (
                    <EmployeeList
                        type="prospect"
                        employees={employeesLocal ?? employeesFromStore}
                        loading={loading}
                        error={error}
                        onAddLead={() => setActiveTab("addProspect")}
                        onOpenLeadDetails={(leadId, origin) => {
                            setSelectedLeadId(leadId);
                            setSelectedLeadOrigin(origin ?? "Prospect");
                            setActiveTab("leadDetails");
                        }}
                    />
                );

            case "Account":
                return (
                    <EmployeeList
                        type="account"
                        employees={employeesLocal ?? employeesFromStore}
                        loading={loading}
                        error={error}
                        onAddLead={() => setActiveTab("addAccount")}
                        onAddLead2={() => setActiveTab("addLead")}
                        onOpenLeadDetails={(leadId, origin) => {
                            setSelectedLeadId(leadId);
                            setSelectedLeadOrigin(origin ?? "Account");
                            setActiveTab("leadDetails");
                        }}
                    />
                );

            case "addLead":
                return <AddLeadClient type="lead" onBack={() => handleTab("leads")} />;

            case "addProspect":
                return (
                    <AddLeadClient type="prospect" onBack={() => handleTab("Prospect")} />
                );

            case "addAccount":
                return (
                    <AddLeadClient type="account" onBack={() => handleTab("Account")} />
                );

            case "leadDetails":
                return (
                    <LeadDetailsClient
                        leadId={selectedLeadId}
                        origin={selectedLeadOrigin ?? "leads"}

                        onBack={() => setActiveTab(selectedLeadOrigin ?? "leads")}
                        onEdit={(id?: string | number | null) => {
                            if (id != null) setSelectedLeadId(id);
                            setActiveTab("editLead");
                        }}
                    />
                );

            case "reports":
                return <ReportsClient />;

            case "editLead":
                return (
                    <EditLeadClient
                        leadId={selectedLeadId}
                        origin={selectedLeadOrigin}
                        onBack={() => setActiveTab("leadDetails")}
                    />
                );

            default:
                return null;
        }
    };

    // ---- LAYOUT ----

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto",
                position: "relative",
                background: "#f6f8fc",
                overflow: "hidden",
            }}
        >
            {/* LEFT SIDEBAR */}
            <aside
                style={{
                    width: sidebarWidth,
                    minWidth: sidebarWidth,
                    height: "100vh",
                    borderRight: "1px solid #e7edf6",
                    paddingTop: sidebarCollapsed ? 16 : 18,
                    paddingBottom: 18,
                    paddingLeft: sidebarCollapsed ? 8 : 18,
                    paddingRight: sidebarCollapsed ? 8 : 18,
                    background: "#fff",
                    boxShadow: "6px 0 18px rgba(15, 23, 42, 0.04)",
                    overflowY: "auto",
                    overflowX: "hidden",
                    transition: "width 0.25s ease, padding 0.25s ease",
                    boxSizing: "border-box",
                    position: "fixed",
                    top: 0,
                    zIndex: 1,
                }}
            >
                {/* LOGO — visible ONLY when NOT collapsed */}
                {!sidebarCollapsed && (
                    <>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: 8,
                            }}
                        >
                            <div
                                style={{
                                    width: 220,
                                    background: "#fff",
                                    padding: 14,
                                    borderRadius: 10,
                                    border: "1px solid #eef2f7",
                                    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.05)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                }}
                            >
                                <Image
                                    src="/logo1.png"
                                    alt="Logo"
                                    width={260}
                                    height={120}
                                    style={{
                                        width: "90%",
                                        height: "75%",
                                        objectFit: "contain",
                                        display: "block",
                                    }}
                                />
                            </div>
                        </div>

                        <div
                            style={{
                                height: 0,
                                background: "#efefef",
                                margin: "10px 0 14px 0",
                            }}
                        />
                    </>
                )}

                {/* NAVIGATION MENU */}
                <nav>
                    <ul
                        style={{
                            listStyle: "none",
                            padding: 0,
                            margin: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            marginTop: sidebarCollapsed ? 70 : 20,
                        }}
                    >
                        {(
                            [
                                "dashboard",
                                "leads",
                                "Prospect",
                                "Account",
                                "reports",
                            ] as TabKey[]
                        ).map((tab) => {
                            const label = getTabLabel(tab);
                            const active = sidebarActiveTab === tab;
                            const icon = tabIcons[tab];

                            return (
                                <li key={tab} style={{ paddingRight: 8 }}>
                                    <button
                                        onClick={() => handleTab(tab)}
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: sidebarCollapsed ? 0 : 12,
                                            textAlign: "left",
                                            padding: sidebarCollapsed ? "10px 6px" : "10px 14px",
                                            borderRadius: 10,
                                            border: active
                                                ? "1px solid #2459d3"
                                                : "1px solid #e3e9f3",
                                            cursor: "pointer",
                                            background: active ? "#2459d3" : "#f6f9ff",
                                            color: active ? "#fff" : "#111",
                                            minHeight: 44,
                                            justifyContent: sidebarCollapsed
                                                ? "center"
                                                : "flex-start",
                                            boxShadow: active
                                                ? "0 8px 20px rgba(36, 89, 211, 0.2)"
                                                : "none",
                                            transition: "background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease",
                                        }}
                                    >
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                width: 22,
                                                height: 22,
                                                alignItems: "center",
                                                justifyContent: "center",
                                                flexShrink: 0,
                                            }}
                                        >
                                            {icon}
                                        </span>

                                        {!sidebarCollapsed && (
                                            <span
                                                style={{
                                                    flex: 1,
                                                    fontSize: 14,
                                                    fontWeight: 500,
                                                    color: active ? "#fff" : "#222",
                                                }}
                                            >
                                                {label}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {/* AI ASSISTANT BUTTON — add this after </ul> inside <nav> */}
          <div style={{ marginTop: 16, paddingRight: 8 }}>
            <button
              className="ai-sidebar-btn"
              onClick={() => setChatOpen(!chatOpen)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: sidebarCollapsed ? 0 : 12,
                padding: sidebarCollapsed ? "10px 6px" : "10px 14px",
                borderRadius: 8,
                border: chatOpen ? "1px solid #f56c00" : "1px solid #dbe4ff",
                cursor: "pointer",
                background: chatOpen ? "#f56c00" : "#eef2ff",
                color: chatOpen ? "#fff" : "#4338ca",
                minHeight: 44,
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                fontWeight: 600,
                fontSize: 14,
                transition: "background 0.15s ease",
              }}
            >
              <span style={{ fontSize: 18 }}>🤖</span>
              {!sidebarCollapsed && (
                <span>{chatOpen ? "Close AI" : "AI Assistant"}</span>
              )}
            </button>
          </div>
      
                </nav>

                {!sidebarCollapsed && (
                    <div style={{ marginTop: 20, fontSize: 13, color: "#666" }}></div>
                )}
            </aside>

            {/* RIGHT SIDE */}
            <main
                style={{
                    flex: 1,
                    marginLeft: sidebarWidth,
                    height: "100vh",
                    overflow: "hidden",
                    padding: 0,
                    background: "#f8fafc",
                    transition: "all 0.3s ease",
                }}
            >
                {/* BLUE TOP BAR */}
                <div
                    style={{
                        height: 60,
                        backgroundColor: "#3a77e3",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: "white",
                        boxShadow: "0 8px 18px rgba(37, 99, 235, 0.2)",
                        boxSizing: "border-box",
                        position: "fixed",
                        top: 0,
                        left: sidebarWidth,
                        width: `calc(100% - ${sidebarWidth}px)`,
                        zIndex: 2,
                    }}
                >
                    {/* Sidebar toggle */}
                    <button
                        type="button"
                        className="sidebar-toggle-btn"
                        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        onClick={toggleSidebar}
                        style={{
                            position: "absolute",
                            left: "-14px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: "clamp(34px, 2.6vw, 40px)",
                            height: "clamp(34px, 2.6vw, 40px)",
                            borderRadius: "999px",
                            background: "linear-gradient(180deg, #ff922b 0%, #f97316 100%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 8px 18px rgba(249, 115, 22, 0.28)",
                            border: "1px solid rgba(255,255,255,0.5)",
                            zIndex: 3,
                            padding: 0,
                            lineHeight: 1,
                            transition:
                                "transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease, background 0.2s ease",
                        }}
                    >
                        <span
                            style={{
                                fontSize: 18,
                                lineHeight: 1,
                                color: "white",
                                userSelect: "none",
                                fontWeight: 700,
                                transform: sidebarCollapsed ? "translateX(0.5px)" : "translateX(-0.5px)",
                                transition: "transform 0.2s ease",
                            }}
                        >
                            {sidebarCollapsed ? "»" : "«"}
                        </span>
                    </button>

                    <div
                        style={{
                            fontWeight: 600,
                            fontSize: 32,
                            flex: 1,
                            paddingLeft: 30,
                            letterSpacing: 0.8,
                        }}
                    >
                        ACARSH
                    </div>

                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            marginRight: 20,
                        }}
                    >
                        {loggedInUserName && (
                            <span
                                style={{
                                    fontSize: 14,
                                    fontWeight: 500,
                                    color: "white",
                                }}
                            >
                                {loggedInUserName}
                            </span>
                        )}
                        <button
                            onClick={handleLogout}
                            style={{
                                padding: "7px 12px",
                                borderRadius: 8,
                                border: "none",
                                backgroundColor: "#f56c00",
                                color: "white",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 13,
                                boxShadow: "0 6px 14px rgba(245,108,0,0.3)",
                            }}
                        >
                            Logout
                        </button>
                    </div>
                </div>

                {/* CONTENT BODY */}
                <div
                    style={{
                        height: "calc(100vh - 60px)",
                        marginTop: 60,
                        padding: "18px 26px 18px 30px",
                        boxSizing: "border-box",
                        overflowY: isListViewportTab ? "hidden" : "auto",
                        overflowX: "hidden",
                    }}
                >
                    <div
                        style={
                            isListViewportTab
                                ? {
                                    height: "100%",
                                    display: "flex",
                                    flexDirection: "column",
                                    minHeight: 0,
                                    overflow: "hidden",
                                  }
                                : undefined
                        }
                    >
                        {renderContent()}
                    </div>
                </div>
            </main>
            {/* AI ASSISTANT PANEL — fixed right side overlay */}
<div
  style={{
    position: "fixed",
    top: 0,
    right: 0,
    width: chatOpen ? 400 : 0,
    height: "100vh",
    transition: "width 0.3s ease",
    overflow: "hidden",
    zIndex: 10,
    boxShadow: chatOpen ? "-4px 0 20px rgba(0,0,0,0.15)" : "none",
  }}
>
  {chatOpen && (
  <CRMChatBot
    onClose={() => setChatOpen(false)}
    contextLeadId={selectedLeadId ?? null}
    onAction={(action) => {
      console.log("Agent action:", action);
      // Refresh the current list when agent modifies data
      if (
        action.type === "lead_created" ||
        action.type === "lead_updated" ||
        action.type === "lead_deleted"
      ) {
        if (activeTab === "leads") fetchLeadsList();
        else if (activeTab === "Prospect") fetchProspectsList();
        else if (activeTab === "Account") fetchAccountList();
      }
    }}
  />
)}
</div>
        </div>
    );
}
