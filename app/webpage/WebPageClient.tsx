// page.tsx (updated)

"use client";

// export const dynamic = "force-dynamic";
// export const revalidate = false;
import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { clearUser } from "../../store/userSlice";
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

import { useDroitLayout } from "./components/WebpageDroitHost";

// Tabs
type TabKey =
    | "dashboard"
    | "leads"
    | "addLead"
    | "addProspect"
    | "addAccount"
    | "addAccountLead"
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

function getTabLabel(tab: TabKey): string {
    if (tab === "Account") return "Customer";
    return tab[0].toUpperCase() + tab.slice(1);
}

function normalizeCustomerRecordType(value: string | null | undefined): "CUSTOMER" | "CUSTOMER_LEAD" {
    return String(value ?? "CUSTOMER").trim().toUpperCase() === "CUSTOMER_LEAD"
        ? "CUSTOMER_LEAD"
        : "CUSTOMER";
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
    const [droitBuddyHost, setDroitBuddyHost] = useState<HTMLDivElement | null>(null);
    const [loggedInUserName, setLoggedInUserName] = useState<string | null>(null);
    const [activeCompanyId, setActiveCompanyId] = useState<number | null>(null);
    const [companyAccessError, setCompanyAccessError] = useState<string | null>(null);
    const { setDroitLayout } = useDroitLayout();

    // Normalize local dev host to localhost (avoid 0.0.0.0 browser URL issues)
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.location.hostname !== "0.0.0.0") return;

        const nextUrl = `${window.location.protocol}//localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.replace(nextUrl);
    }, []);

    // Fetch logged-in user name and authorized company memberships from the server.
    useEffect(() => {
        fetch("/api/auth/me")
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
                if (!data) return;
                if (data.name) setLoggedInUserName(data.name);
                setActiveCompanyId(Number(data.companyId) > 0 ? Number(data.companyId) : null);
                setCompanyAccessError(data.accessError || null);
            })
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
        addAccountLead: "",
        editLead: "",
    };

    // ---- API CALLS ----

    const fetchLeadsList = async () => {
        try {
            setError(null);
            setLoading(true);

            const data = await fetchEmployeeList("/api/employees/leads");
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

            const data = await fetchEmployeeList("/api/employees/prospects");
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

    const refreshListByType = async (type: "lead" | "prospect" | "account") => {
        if (type === "lead") {
            await fetchLeadsList();
            return;
        }
        if (type === "prospect") {
            await fetchProspectsList();
            return;
        }
        await fetchAccountList();
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
                    : activeTab === "addAccount" || activeTab === "addAccountLead"
                        ? "Account"
                        : activeTab;

    const isListViewportTab =
        activeTab === "leads" ||
        activeTab === "Prospect" ||
        activeTab === "Account";

    const sidebarWidth = sidebarCollapsed ? 64 : 230;

    useEffect(() => {
        setDroitLayout({
            buttonHost: droitBuddyHost,
            sidebarWidth,
            sidebarCollapsed,
            contextLeadId: selectedLeadId ?? null,
            onAction: (action: { type?: string }) => {
                if (
                    action.type === "lead_created" ||
                    action.type === "lead_updated" ||
                    action.type === "lead_deleted"
                ) {
                    if (activeTab === "leads") fetchLeadsList();
                    else if (activeTab === "Prospect") fetchProspectsList();
                    else if (activeTab === "Account") fetchAccountList();
                }
            },
        });
    }, [
        activeTab,
        droitBuddyHost,
        selectedLeadId,
        setDroitLayout,
        sidebarCollapsed,
        sidebarWidth,
    ]);

    useEffect(() => {
        return () => setDroitLayout(null);
    }, [setDroitLayout]);

    const primaryTabs: TabKey[] = [
        "dashboard",
        "leads",
        "Prospect",
        "Account",
        "reports",
    ];

    // ---- RENDER CONTENT ----

    const renderContent = () => {
        switch (activeTab) {

            case "dashboard":
                return <DashboardPage key={activeCompanyId ?? "none"} />;

            case "leads":
                return (
                    <EmployeeList
                        key={`lead-${activeCompanyId ?? "none"}`}
                        type="lead"
                        employees={employeesLocal ?? employeesFromStore}
                        loading={loading}
                        error={error}
                        onAddLead={() => setActiveTab("addLead")}
                        onDeleteLead={async () => {
                            await refreshListByType("lead");
                        }}
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
                        key={`prospect-${activeCompanyId ?? "none"}`}
                        type="prospect"
                        employees={employeesLocal ?? employeesFromStore}
                        loading={loading}
                        error={error}
                        onAddLead={() => setActiveTab("addProspect")}
                        onDeleteLead={async () => {
                            await refreshListByType("prospect");
                        }}
                        onOpenLeadDetails={(leadId, origin) => {
                            setSelectedLeadId(leadId);
                            setSelectedLeadOrigin(origin ?? "Prospect");
                            setActiveTab("leadDetails");
                        }}
                    />
                );

            case "Account": {
                const accountRowsSource = employeesLocal ?? employeesFromStore;
                const accountRows: Employee[] = Array.isArray(accountRowsSource)
                    ? accountRowsSource
                    : accountRowsSource &&
                        Array.isArray((accountRowsSource as any).data)
                        ? ((accountRowsSource as any).data as Employee[])
                        : [];
                const customerRows = accountRows.filter(
                    (emp) => normalizeCustomerRecordType(emp.RecordType) === "CUSTOMER"
                );

                return (
                    <div
                        style={{
                            height: "100%",
                            minHeight: 0,
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <EmployeeList
                            key={`account-${activeCompanyId ?? "none"}`}
                            type="account"
                            employees={customerRows}
                            loading={loading}
                            error={error}
                            onDeleteLead={async () => {
                                await refreshListByType("account");
                            }}
                            onAddLead={() => setActiveTab("addAccount")}
                            onAddLead2={() => setActiveTab("addAccountLead")}
                            addButtonLabelOverride="Add Customer"
                            secondaryAddButtonLabelOverride="Add Customer Lead"
                            showAnalyticsCards
                            showToolbar
                            fillHeight
                            onOpenLeadDetails={(leadId, origin) => {
                                setSelectedLeadId(leadId);
                                setSelectedLeadOrigin(origin ?? "Account");
                                setActiveTab("leadDetails");
                            }}
                        />
                    </div>
                );
            }

            case "addLead":
                return <AddLeadClient type="lead" onBack={() => handleTab("leads")} />;

            case "addProspect":
                return (
                    <AddLeadClient type="prospect" onBack={() => handleTab("Prospect")} />
                );

            case "addAccount":
                return (
                    <AddLeadClient
                        type="account"
                        accountRecordType="CUSTOMER"
                        entityLabelOverride="Customer"
                        onBack={() => handleTab("Account")}
                    />
                );

            case "addAccountLead":
                return (
                    <AddLeadClient
                        type="account"
                        accountRecordType="CUSTOMER_LEAD"
                        entityLabelOverride="Customer Lead"
                        onBack={() => handleTab("Account")}
                    />
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
                        onOpenLeadDetails={(nextLeadId, origin) => {
                            setSelectedLeadId(nextLeadId);
                            const normalizedOrigin =
                              origin === "Prospect"
                                ? "Prospect"
                                : origin === "Account" || origin === "MasterAccount"
                                  ? "Account"
                                  : "leads";
                            setSelectedLeadOrigin(normalizedOrigin);
                            setActiveTab("leadDetails");
                        }}
                    />
                );

            case "reports":
                return <ReportsClient key={activeCompanyId ?? "none"} />;

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
            className="app-shell"
            style={{
                minHeight: "100vh",
                display: "flex",
                fontFamily: "var(--font-body)",
                position: "relative",
                background: "var(--warm-off-white)",
                overflow: "hidden",
            }}
        >
            {/* LEFT SIDEBAR */}
            <aside
                style={{
                    width: sidebarWidth,
                    minWidth: sidebarWidth,
                    height: "100vh",
                    borderRight: "1px solid rgba(248, 244, 239, 0.12)",
                    paddingTop: sidebarCollapsed ? 16 : 18,
                    paddingBottom: sidebarCollapsed ? 12 : 16,
                    paddingLeft: sidebarCollapsed ? 8 : 18,
                    paddingRight: sidebarCollapsed ? 8 : 18,
                    background: "linear-gradient(180deg, #0F1F3D 0%, #1F3A68 100%)",
                    boxShadow: "8px 0 24px rgba(15, 31, 61, 0.18)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    transition: "width 0.25s ease, padding 0.25s ease",
                    boxSizing: "border-box",
                    position: "fixed",
                    top: 0,
                    zIndex: 2,
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
                                    background: "transparent",
                                    padding: 0,
                                    borderRadius: 0,
                                    border: "none",
                                    boxShadow: "none",
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
                                        width: "86%",
                                        height: "auto",
                                        objectFit: "contain",
                                        display: "block",
                                    }}
                                />
                            </div>
                        </div>

                        <div
                            style={{
                                height: 0,
                                background: "rgba(248, 244, 239, 0.16)",
                                margin: "10px 0 14px 0",
                            }}
                        />
                    </>
                )}

                {/* NAVIGATION MENU */}
                <nav
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        overflowX: "hidden",
                    }}
                >
                    <ul
                        style={{
                            listStyle: "none",
                            padding: 0,
                            margin: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            marginTop: sidebarCollapsed ? 70 : 14,
                        }}
                    >
                        {primaryTabs.map((tab) => {
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
                                                ? "1px solid #F26522"
                                                : "1px solid transparent",
                                            cursor: "pointer",
                                            background: active
                                                ? "linear-gradient(135deg, #F26522 0%, #d95317 100%)"
                                                : "transparent",
                                            color: "#fff",
                                            minHeight: 44,
                                            justifyContent: sidebarCollapsed
                                                ? "center"
                                                : "flex-start",
                                            boxShadow: active
                                                ? "0 10px 22px rgba(242, 101, 34, 0.26)"
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
                                                    fontWeight: 600,
                                                    color: active ? "#fff" : "rgba(248, 244, 239, 0.88)",
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
                </nav>
                <div
                    ref={setDroitBuddyHost}
                    style={{
                        flexShrink: 0,
                        width: "100%",
                        marginTop: "auto",
                        paddingTop: sidebarCollapsed ? 10 : 16,
                        paddingRight: sidebarCollapsed ? 0 : 8,
                    }}
                />
            </aside>

            {/* RIGHT SIDE */}
            <main
                style={{
                    flex: 1,
                    marginLeft: sidebarWidth,
                    height: "100vh",
                    overflow: "hidden",
                    padding: 0,
                    background: "rgba(248, 244, 239, 0.78)",
                    transition: "all 0.3s ease",
                    position: "relative",
                    zIndex: 4,
                }}
            >
                {/* BLUE TOP BAR */}
                <div
                    style={{
                        height: 60,
                        backgroundColor: "#1F3A68",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: "white",
                        boxShadow: "0 8px 22px rgba(15, 31, 61, 0.24)",
                        boxSizing: "border-box",
                        position: "fixed",
                        top: 0,
                        left: sidebarWidth,
                        width: `calc(100% - ${sidebarWidth}px)`,
                        zIndex: 5,
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
                            left: "-24px",
                            top: "10px",
                            transform: "translateY(0)",
                            width: 40,
                            height: 40,
                            borderRadius: "999px",
                            background: "linear-gradient(180deg, #F26522 0%, #d95317 100%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 8px 18px rgba(242, 101, 34, 0.32)",
                            border: "1px solid rgba(255,255,255,0.62)",
                            zIndex: 6,
                            padding: 0,
                            lineHeight: 1,
                            transition:
                                "transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease, background 0.2s ease",
                        }}
                    >
                        <span
                            style={{
                                fontSize: 16,
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
                            display: "flex",
                            alignItems: "baseline",
                            gap: 10,
                            flex: 1,
                            minWidth: 0,
                            paddingLeft: 30,
                        }}
                    >
                        <span
                            style={{
                                fontWeight: 600,
                                fontSize: 32,
                                letterSpacing: "-0.02em",
                                fontFamily: "var(--font-display)",
                                lineHeight: 1,
                                flexShrink: 0,
                            }}
                        >
                            ACARSH
                        </span>
                        <span
                            style={{
                                fontSize: 12,
                                fontWeight: 500,
                                lineHeight: 1.3,
                                color: "rgba(255,255,255,0.78)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                            title="Sales CRM - Adroitent Customer Acquisition and Relationship Management system"
                        >
                            Sales CRM - Adroitent Customer Acquisition and Relationship Management system
                        </span>
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
                                backgroundColor: "#F26522",
                                color: "white",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 13,
                                boxShadow: "0 6px 14px rgba(242,101,34,0.3)",
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
                        position: "relative",
                        zIndex: 1,
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
                        {companyAccessError ? (
                            <div
                                role="alert"
                                style={{
                                    marginBottom: 16,
                                    padding: "12px 14px",
                                    borderRadius: 10,
                                    background: "#FEF2F2",
                                    color: "#991B1B",
                                    fontWeight: 600,
                                }}
                            >
                                {companyAccessError}
                            </div>
                        ) : null}
                        {renderContent()}
                    </div>
                </div>
            </main>
        </div>
    );
}
