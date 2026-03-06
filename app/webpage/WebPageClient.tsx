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
    | "Reminder"
    | "editLead";

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
                "Reminder",
            ].includes(tab)
        ) {
            handleTab(tab as TabKey);
        }
    }, [searchParams]);

    const tabIcons: Record<TabKey, React.ReactNode> = {
        dashboard: (
            <Image src="/dashboard1.png" alt="Dashboard" width={20} height={20} />
        ),
        leads: <Image src="/group.png" alt="Leads" width={20} height={20} />,
        Prospect: (
            <Image src="/prospect.png" alt="Prospect" width={20} height={20} />
        ),
        Account: <Image src="/account.png" alt="Account" width={20} height={20} />,
        Reminder: <Image src="/bell.png" alt="Reminder" width={20} height={20} />,
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

            const res = await fetch("/api/employees/leads");
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

            const data: Employee[] = await res.json();
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

            const res = await fetch("/api/employees/prospects");
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

            const data: Employee[] = await res.json();
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

            const res = await fetch("/api/employees/account");
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

            const data: Employee[] = await res.json();
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
    const handleDeleteLead = async (leadId: number | string) => {
        if (!confirm("Are you sure you want to delete this lead?")) return;

        try {
            const res = await fetch(`/api/employees/leads?leadId=${leadId}`, {
                method: "DELETE",
            });

            if (!res.ok) {
                alert("Failed to delete lead");
                return;
            }

            // Update UI only
            setEmployeesLocal((prev) =>
                prev ? prev.filter((l) => l.LeadId !== leadId) : prev
            );
        } catch (err) {
            console.error("Delete failed:", err);
            alert("Something went wrong while deleting");
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
                        onDelete={handleDeleteLead}
                        onOpenLeadDetails={(leadId) => {
                            setSelectedLeadId(leadId);
                            setSelectedLeadOrigin("leads");
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
                        onDelete={handleDeleteLead}
                        onOpenLeadDetails={(leadId) => {
                            setSelectedLeadId(leadId);
                            setSelectedLeadOrigin("Prospect");
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
                        onDelete={handleDeleteLead}
                        onOpenLeadDetails={(leadId) => {
                            setSelectedLeadId(leadId);
                            setSelectedLeadOrigin("Account");
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
                background: "#f3f4f6",
                overflow: "hidden",
            }}
        >
            {/* LEFT SIDEBAR */}
            <aside
                style={{
                    width: sidebarCollapsed ? 64 : 230,
                    minWidth: sidebarCollapsed ? 64 : 230,
                    height: "100vh",
                    borderRight: "1px solid #e6e6e6",
                    paddingTop: sidebarCollapsed ? 16 : 18,
                    paddingBottom: 18,
                    paddingLeft: sidebarCollapsed ? 8 : 18,
                    paddingRight: sidebarCollapsed ? 8 : 18,
                    background: "#fff",
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
                                    borderRadius: 6,
                                    boxShadow: "0 1px 0 rgba(0,0,0,0.05)",
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
                                "Reminder",
                            ] as TabKey[]
                        ).map((tab) => {
                            const label = tab[0].toUpperCase() + tab.slice(1);
                            const active = activeTab === tab;
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
                                            borderRadius: 8,
                                            border: "none",
                                            cursor: "pointer",
                                            background: active ? "#1e53d7" : "#f7f7f7",
                                            color: active ? "#fff" : "#111",
                                            minHeight: 44,
                                            justifyContent: sidebarCollapsed
                                                ? "center"
                                                : "flex-start",
                                            transition: "background 0.15s ease, color 0.15s ease",
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
                </nav>

                {!sidebarCollapsed && (
                    <div style={{ marginTop: 20, fontSize: 13, color: "#666" }}></div>
                )}
            </aside>

            {/* RIGHT SIDE */}
            <main
                style={{
                    flex: 1,
                    marginLeft: sidebarCollapsed ? 64 : 230,
                    height: "100vh",
                    overflowY: "auto",
                    padding: 0,
                    background: "#fff",
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
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        boxSizing: "border-box",
                        position: "fixed",
                        top: 0,
                        left: sidebarCollapsed ? 64 : 230,
                        width: `calc(100% - ${sidebarCollapsed ? 64 : 230}px)`,
                        zIndex: 2,
                    }}
                >
                    {/* Sidebar toggle */}
                    <div
                        onClick={toggleSidebar}
                        style={{
                            position: "absolute",
                            left: "-31px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 50,
                            height: 60,
                            borderRadius: "999px 0 0 990px",
                            background: "#f56c00",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            boxShadow: "0 0 4px rgba(0,0,0,0.25)",
                        }}
                    >
                        <span
                            style={{
                                fontSize: 15,
                                lineHeight: 1,
                                color: "white",
                                userSelect: "none",
                            }}
                        >
                            {sidebarCollapsed ? ">>" : "<<"}
                        </span>
                    </div>

                    <div
                        style={{
                            fontWeight: 600,
                            fontSize: 30,
                            flex: 1,
                            paddingLeft: 30,
                            letterSpacing: 1,
                        }}
                    >
                        ACARsh
                    </div>

                    <button
                        onClick={handleLogout}
                        style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            border: "none",
                            backgroundColor: "#f56c00",
                            color: "white",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: 13,
                            marginRight: 20,
                        }}
                    >
                        Logout
                    </button>
                </div>

                {/* CONTENT BODY */}
                <div style={{ padding: 60, paddingRight: 25, paddingLeft: 30 }}>
                    {renderContent()}
                </div>
            </main>
        </div>
    );
}
