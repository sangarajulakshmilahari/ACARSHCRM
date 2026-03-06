"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type Contact = {
  ContactName?: string;
  ContactEmail?: string;
  ContactTitle?: string;
  ContactRoleName?: string;
};
type Activity = {
  ActivityId: number;
  ActivityDate: string;
  Mode: string;
  Notes?: string;
  Status?: string;
};

type Reminder = {
  ReminderId: number;
  ReminderDate: string;
  Notes?: string;
  Status?: string;
  Notification?: string;
};

type Opportunity = {
  OpportunityId: number;

  // IDs (used for edit)
  ServiceId: number;
  StatusId: number;
  ProbabilityId: number;
  EngagementId: number;
  TechnologyIds?: number[];

  // Display values (used in table)
  CreatedDate: string;
  Service: string;
  Probability: string;
  Status: string;
  EngagementModel: string;
  Technology?: string;
  OpportunityContact?: string;
};

type Lead = {
  LeadId?: number | string;
  CompanyName?: string;
  CompanyLocation?: string;
  OwnerName?: string;
  StatusName?: string;
  LeadNotes?: string | null;
  LeadDate?: string | number | Date;
  LeadSource?: string;
  Contacts?: Contact[];
  Activities?: Activity[];
  Reminders?: Reminder[];
  Opportunities?: Opportunity[];
  AccountTypeId?: number;
  AccountTypeName?: string;
};

// NEW: origin type & prop
type OriginType = "leads" | "Prospect" | "Account" | "MasterAccount";

type LeadDetailsProps = {
  leadId?: number | string | null;
  onBack?: () => void;
  onEdit?: (leadId?: number | string | null) => void;
  origin?: OriginType;
};

type OppContact = {
  OpportunityContactId?: number;

  FullName?: string;
  FirstName?: string;
  LastName?: string;
  PreferredName?: string;
  JobTitle?: string;
  Department?: string;
  SeniorityLevel?: string;
  Gender?: string;
  DateOfBirth?: string;
  ProfilePictureUrl?: string;

  CompanyName?: string;
  Division?: string;
  OfficeLocation?: string;
  HeadquartersLocation?: string;
  EmployeeSize?: string | number;
  Industry?: string;
  CompanyWebsite?: string;
  CompanyLinkedInPage?: string;

  WorkEmail?: string;
  PersonalEmail?: string;
  DirectPhone?: string;
  MobilePhone?: string;
  OfficePhone?: string;
  LinkedInProfileUrl?: string;
};

export default function LeadDetailsPage({
  leadId,
  onBack,
  onEdit,
  origin = "leads",
}: LeadDetailsProps): JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const originFromQuery = searchParams.get("origin") as OriginType | null;
  const finalOrigin = originFromQuery ?? origin;
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [showAddOpportunity, setShowAddOpportunity] = useState(false);
  const [otherTechnologyMap, setOtherTechnologyMap] = useState<
    Record<number, string>
  >({});

  const [opportunityView, setOpportunityView] = useState<
    "OPPORTUNITY" | "CONTACT"
  >("OPPORTUNITY");
  const [categories, setCategories] = useState<any[]>([]);
  const [oppContacts, setOppContacts] = useState<OppContact[]>([]);
  const [selectedOppContactIndex, setSelectedOppContactIndex] = useState<
    number | null
  >(null);

  const [mode, setMode] = useState<"add" | "edit">("add");
  const [currentOpportunityId, setCurrentOpportunityId] = useState<
    number | null
  >(null);
  const [originalTechnologies, setOriginalTechnologies] = useState<number[]>(
    []
  );
  const [otherTechnologyText, setOtherTechnologyText] = useState("");
  const [isOtherSelected, setIsOtherSelected] = useState(false);


  const EMPTY_OPP_CONTACT_FORM: OppContact = {
    FullName: "",
    FirstName: "",
    LastName: "",
    PreferredName: "",
    JobTitle: "",
    Department: "",
    SeniorityLevel: "",
    Gender: "",
    DateOfBirth: "",
    ProfilePictureUrl: "",
    CompanyName: "",
    Division: "",
    OfficeLocation: "",
    HeadquartersLocation: "",
    EmployeeSize: "",
    Industry: "",
    CompanyWebsite: "",
    CompanyLinkedInPage: "",
    WorkEmail: "",
    PersonalEmail: "",
    DirectPhone: "",
    MobilePhone: "",
    OfficePhone: "",
    LinkedInProfileUrl: "",
  };

  const [oppContactForm, setOppContactForm] = useState(EMPTY_OPP_CONTACT_FORM);
  const [opportunityStatuses, setOpportunityStatuses] = useState<any[]>([]);
  const [engagementModels, setEngagementModels] = useState<any[]>([]);
  const [Services, setServices] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/masters/others")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.opportunityStatuses)) {
          setOpportunityStatuses(data.opportunityStatuses);
        }

        // ✅ FIXED
        if (Array.isArray(data?.engagementModels)) {
          setEngagementModels(data.engagementModels);
        }

        if (Array.isArray(data?.services)) {
          setServices(data.services);
        }
      });
  }, []);

  // FORM STATES
  const [editingValues, setEditingValues] = useState<Record<string, any>>({});
  const getCellValue = (key: string, fallback: any) => {
    return key in editingValues ? editingValues[key] : fallback;
  };

  const isValueChanged = (oldVal: any, newVal: any) => {
    return String(oldVal ?? "").trim() !== String(newVal ?? "").trim();
  };

  const [editingCell, setEditingCell] = useState<string | null>(null);

  const [activityForm, setActivityForm] = useState({
    ActivityDate: "",
    Mode: "",
    Notes: "",
    Status: "",
  });

  const [reminderForm, setReminderForm] = useState({
    ReminderDate: "",
    Notes: "",
    Status: "Pending",
    Notification: "",
  });

  const resetOpportunityForm = () => {
    setOpportunityForm({
      serviceId: "",
      probabilityId: "",
      statusId: "",
      engagementId: "",
      technologies: [],
    });
  };

  const [opportunityForm, setOpportunityForm] = useState({
    serviceId: "" as number | "",
    statusId: "" as number | "",
    probabilityId: "" as number | "",
    engagementId: "" as number | "",
    technologies: [] as number[],
  });

  const handleAddOpportunityClick = () => {
    setMode("add");
    setCurrentOpportunityId(null);
    resetOpportunityForm();

    setOtherTechnologyMap({});
    setOriginalTechnologies([]);

    setOppContacts([]);
    setOppContactForm(EMPTY_OPP_CONTACT_FORM);
    setSelectedOppContactIndex(null);

    setOpportunityView("OPPORTUNITY");
    setShowAddOpportunity(true);
  };

  const handleTechnologyChange = (
    subCategoryId: number,
    subCategoryName?: string
  ) => {
    setOpportunityForm((prev) => {
      const isSelected = prev.technologies.includes(subCategoryId);

      if (subCategoryName === "Other" && isSelected) {
        setOtherTechnologyMap((prev) => {
          const copy = { ...prev };
          delete copy[subCategoryId];
          return copy;
        });
      }

      return {
        ...prev,
        technologies: isSelected
          ? prev.technologies.filter((id) => id !== subCategoryId)
          : [...prev.technologies, subCategoryId],
      };
    });
  };

  // fetch lead details

  const fetchLeadDetails = async () => {
    if (!effectiveLeadId) return;

    try {
      const res = await fetch(`/api/employees/leads/${effectiveLeadId}`);
      if (!res.ok) {
        console.error("Failed to fetch lead details");
        return;
      }

      const data = await res.json();

      setLead({
        ...data,
        Contacts: data.Contacts || [],
        Activities: data.Activities || [],
        Reminders: data.Reminders || [],
        Opportunities: data.Opportunities || [],
      });
    } catch (error) {
      console.error("Error fetching lead details:", error);
    }
  };

  // save activity

  const handleSaveActivity = async () => {
    if (!activityForm.Mode || !activityForm.Status || !activityForm.Notes) {
      alert("Please fill all required fields");
      return;
    }

    const leadId =
      lead?.LeadId ??
      (effectiveLeadId && !isNaN(Number(effectiveLeadId))
        ? Number(effectiveLeadId)
        : null);

    if (!leadId) {
      alert("Invalid Lead selected");
      console.error("LeadId missing:", {
        leadIdFromState: lead?.LeadId,
        effectiveLeadId,
      });
      return;
    }

    try {
      const res = await fetch(`/api/employees/leads/${leadId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Mode: activityForm.Mode,
          Notes: activityForm.Notes,
          Status: activityForm.Status,
          ActivityDate: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error("Activity save failed:", err);
        alert(err.error || "Failed to save activity");
        return;
      }

      const savedActivity = await res.json();

      setLead((prev) =>
        prev
          ? {
            ...prev,
            Activities: [...(prev.Activities || []), savedActivity],
          }
          : prev
      );

      setActivityForm({
        ActivityDate: "",
        Mode: "",
        Status: "",
        Notes: "",
      });

      setShowAddActivity(false);
    } catch (err) {
      console.error("Frontend save error:", err);
      alert("Unexpected error while saving activity");
    }
  };

  const formatDateTime = (value?: string) => {
    if (!value) return "—";

    const d = new Date(value);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  // save reminder

  const handleSaveReminder = async () => {
    if (!reminderForm.ReminderDate || !reminderForm.Notes) {
      alert("Please fill all required fields");
      return;
    }

    const leadId = lead?.LeadId;
    if (!leadId) {
      alert("Invalid Lead");
      return;
    }

    try {
      const res = await fetch(`/api/employees/leads/${leadId}/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReminderDate: reminderForm.ReminderDate,
          Notes: reminderForm.Notes,
          Status: reminderForm.Status,
          Notification: reminderForm.Notification,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save reminder");
      }

      const savedReminder = await res.json();

      // Update UI immediately
      setLead((prev) =>
        prev
          ? {
            ...prev,
            Reminders: [...(prev.Reminders || []), savedReminder],
          }
          : prev
      );

      // Reset form
      setReminderForm({
        ReminderDate: "",
        Notes: "",
        Status: "Pending",
        Notification: "Email",
      });

      setShowAddReminder(false);
    } catch (err: any) {
      alert(err.message || "Reminder save failed");
    }
  };

  const autoSaveActivityField = async (
    index: number,
    field: keyof Activity,
    value: any
  ) => {
    const activity = lead?.Activities?.[index];
    if (!activity || !lead?.LeadId) return;

    try {
      await fetch(`/api/employees/leads/${lead.LeadId}/activities`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ActivityId: activity.ActivityId,
          Mode: field === "Mode" ? value : activity.Mode,
          Notes: field === "Notes" ? value : activity.Notes,
          Status: field === "Status" ? value : activity.Status,
          ActivityDate: activity.ActivityDate,
        }),
      });

      fetchLeadDetails();
    } catch (err) {
      console.error("Activity auto-save failed", err);
    }
  };
  const autoSaveReminderField = async (
    index: number,
    field: keyof Reminder,
    value: any
  ) => {
    const reminder = lead?.Reminders?.[index];
    if (!reminder || !lead?.LeadId) return;

    try {
      await fetch(`/api/employees/leads/${lead.LeadId}/reminders`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReminderId: reminder.ReminderId,
          ReminderDate:
            field === "ReminderDate" ? value : reminder.ReminderDate,
          Notes: field === "Notes" ? value : reminder.Notes,
          Status: field === "Status" ? value : reminder.Status,
          Notification:
            field === "Notification" ? value : reminder.Notification,
        }),
      });

      fetchLeadDetails();
    } catch (err) {
      console.error("Reminder auto-save failed", err);
    }
  };

  // edit opportunity

  const handleEditOpportunity = async (o: Opportunity) => {
    setMode("edit");
    setCurrentOpportunityId(o.OpportunityId);
    setShowAddOpportunity(true);

    /* 1️⃣ LOAD OPPORTUNITY DETAILS */
    const oppRes = await fetch(
      `/api/employees/leads/${effectiveLeadId}/opportunities?OpportunityId=${o.OpportunityId}`
    );

    if (!oppRes.ok) {
      alert("Failed to load opportunity");
      return;
    }

    const oppData = await oppRes.json();

    /* 2️⃣ SET OPPORTUNITY FORM */
    setOpportunityForm({
      serviceId: oppData.ServiceId,
      statusId: oppData.StatusId,
      probabilityId: oppData.ProbabilityId,
      engagementId: oppData.EngagementId,
      technologies: oppData.TechnologyIds || [],
    });

    setOriginalTechnologies(oppData.TechnologyIds || []);

    /* 3️⃣ 🔑 REBUILD otherTechnologyMap (EDIT MODE FIX) */
    const rebuiltOtherMap: Record<number, string> = {};

    // Safety: categories might not be loaded yet
    if (Array.isArray(categories) && categories.length > 0) {
      categories.forEach((cat: any) => {
        cat.SubCategories.forEach((sc: any) => {
          if (
            sc.SubCategoryName === "Other" &&
            oppData.TechnologyIds?.includes(sc.SubCategoryId)
          ) {
            // keep empty → user can add NEW value
            rebuiltOtherMap[sc.SubCategoryId] = "";
          }
        });
      });
    }

    setOtherTechnologyMap(rebuiltOtherMap);

    /* 4️⃣ LOAD SAVED OPPORTUNITY CONTACTS */
    const contactsRes = await fetch(
      `/api/employees/leads/${effectiveLeadId}/opportunities/${o.OpportunityId}/contacts`
    );

    if (contactsRes.ok) {
      const contacts = await contactsRes.json();
      setOppContacts(contacts);
    } else {
      setOppContacts([]);
    }

    /* 5️⃣ FINAL VIEW */
    setOpportunityView("OPPORTUNITY");
  };


  const buildOppContactSummary = () => {
    if (!oppContacts.length) return "-";
    if (oppContacts.length === 1) {
      const c = oppContacts[0];
      return `${c.FullName} (${c.MobilePhone})`;
    }
    return `${oppContacts[0].FullName} +${oppContacts.length - 1}`;
  };

  const buildFullOppContactSummary = (contacts: OppContact[]) => {
    if (!contacts.length) return "-";

    return contacts
      .map(
        (c) =>
          `Full Name: ${c.FullName || "-"}\n` +
          `Mobile: ${c.MobilePhone || "-"}\n` +
          `Email: ${c.WorkEmail || "-"}`
      )
      .join("\n\n");
  };

  const normalizeTechnology = (tech?: string) => {
    if (!tech) return "-";

    return Array.from(
      new Set(
        tech
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      )
    ).join(", ");
  };

  const handleSaveOpportunity = async () => {
    const isEdit = mode === "edit";

    const id = effectiveLeadId ?? leadId;

    if (
      !opportunityForm.serviceId ||
      !opportunityForm.statusId ||
      !opportunityForm.probabilityId ||
      !opportunityForm.engagementId
    ) {
      alert("Please fill all required opportunity fields");
      return;
    }

    if (!id) {
      alert("Invalid Lead selected");
      return;
    }

    if (isEdit && !currentOpportunityId) {
      alert("Opportunity ID missing");
      return;
    }

    if (opportunityForm.technologies.length === 0) {
      alert("Please select at least one Technology");
      return;
    }

    const otherSelected = categories
      .flatMap((c) => c.SubCategories)
      .some(
        (sc) =>
          sc.SubCategoryName === "Other" &&
          opportunityForm.technologies.includes(sc.SubCategoryId)
      );

    const otherIds = categories
      .flatMap((c) => c.SubCategories)
      .filter(
        (sc) =>
          sc.SubCategoryName === "Other" &&
          opportunityForm.technologies.includes(sc.SubCategoryId)
      )
      .map((sc) => sc.SubCategoryId);

    for (const id of otherIds) {
      if (!otherTechnologyMap[id]?.trim()) {
        alert("Please specify all selected Other technologies");
        return;
      }
    }

    // 1 SAVE OPPORTUNITY
    const res = await fetch(`/api/employees/leads/${id}/opportunities`, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isEdit && { OpportunityId: currentOpportunityId }),

        serviceId: opportunityForm.serviceId,
        statusId: opportunityForm.statusId,
        probabilityId: opportunityForm.probabilityId,
        engagementId: opportunityForm.engagementId,

        technologies: opportunityForm.technologies,   // keep
        otherTechnologies: otherTechnologyMap,         // keep

        // 🔑 ADD THIS FLAG
        hasOtherTechnology: Object.keys(otherTechnologyMap).length > 0,

        OpportunityContact: buildOppContactSummary(),
      }),

    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to save opportunity");
      return;
    }

    // 2 READ RESPONSE
    const savedOpportunity = await res.json();

    const OpportunityId = isEdit
      ? currentOpportunityId
      : savedOpportunity.OpportunityId;

    setCurrentOpportunityId(OpportunityId);

    // 3 SAVE CONTACTS
    if (!isEdit && oppContacts.length > 0) {
      await fetch(
        `/api/employees/leads/${id}/opportunities/${OpportunityId}/contacts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(oppContacts),
        }
      );
    }

    // 4 UPDATE UI
    setLead((prev) => {
      if (!prev) return prev;

      // EDIT MODE
      if (isEdit) {
        return {
          ...prev,
          Opportunities: (prev.Opportunities || []).map((o) =>
            o.OpportunityId === OpportunityId
              ? {
                ...o,
                Service: savedOpportunity.Service,
                Probability: savedOpportunity.Probability,
                Status: savedOpportunity.Status,
                EngagementModel: savedOpportunity.EngagementModel,
                Technology: normalizeTechnology(savedOpportunity.Technology),
                OpportunityContact: buildOppContactSummary(),
              }
              : o
          ),
        };
      }

      // ADD MODE
      return {
        ...prev,
        Opportunities: [
          ...(prev.Opportunities || []),
          {
            ...savedOpportunity,
            Technology: normalizeTechnology(savedOpportunity.Technology),
            OpportunityContact: buildFullOppContactSummary(oppContacts),
          },
        ],
      };
    });

    // 5 RESET & CLOSE
    setShowAddOpportunity(false);
    setMode("add");

    if (isEdit) {
      await fetchLeadDetails();
    }
  };

  const leadIdFromQuery = searchParams.get("leadId");

  const effectiveLeadId =
    lead?.LeadId ??
    leadId ??
    (leadIdFromQuery && !isNaN(Number(leadIdFromQuery))
      ? Number(leadIdFromQuery)
      : null);

  // NEW: helpers to pick label / back text
  const getConvertLabel = () => {
    if (finalOrigin === "leads") return "Convert to Prospect";
    if (finalOrigin === "Prospect") return "Convert to Account";
    if (finalOrigin === "Account") return "Convert to Master Account";

    return "Already a Master Account";
  };

  const getBackLabel = () => {
    if (origin === "leads") return "← Back to Leads";
    if (origin === "Prospect") return "← Back to Prospects";
    if (origin === "Account") return "← Back to Accounts";
    return "← Back";
  };

  // back button handler

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    } else {
      if (origin === "Prospect") {
        router.push("/webpage?tab=prospect");
      } else if (origin === "Account") {
        router.push("/webpage?tab=account");
      } else {
        router.push("/webpage?tab=leads");
      }
    }
  };

  // edit button handler

  const handleEdit = () => {
    if (onEdit) {
      onEdit(lead?.LeadId ?? effectiveLeadId ?? null);
      return;
    } else {
      const id = encodeURIComponent(String(effectiveLeadId));
      const typeParam = origin ? `&type=${encodeURIComponent(origin)}` : "";
      router.push(`/webpage/leads/Editlead?leadId=${id}${typeParam}`);
    }
  };

  // convert button handler

  const handleConvert = async () => {
    if (!lead?.LeadId) {
      alert("ID not found");
      return;
    }

    try {
      const res = await fetch(`/api/employees/leads/${lead.LeadId}/convert`, {
        method: "POST",
      });

      if (!res.ok) {
        let errorMessage = "Conversion failed";

        try {
          const err = await res.json();
          errorMessage = err.error || errorMessage;
        } catch { }

        throw new Error(errorMessage);
      }

      // SHOW SUCCESS POPUP
      if (finalOrigin === "leads") {
        alert("Converted successfully to Prospect");
        router.push("/webpage?tab=prospect");
      } else if (finalOrigin === "Prospect") {
        alert("Converted successfully to Account");
        router.push("/webpage?tab=account");
      } else if (finalOrigin === "Account") {
        alert("Converted successfully to Master Account");
        router.push("/webpage?tab=masteraccount");
      }
    } catch (err: any) {
      alert(err.message || "Failed to convert");
    }
  };

  useEffect(() => {
    if (!showAddOpportunity) return;

    fetch("/api/masters/categories-with-subcategories")
      .then((res) => res.json())
      .then((data) => {
        setCategories(data);
      })
      .catch((err) => {
        console.error("Failed to load technologies", err);
      });
  }, [showAddOpportunity]);

  useEffect(() => {
    fetchLeadDetails();
  }, [effectiveLeadId]);

  useEffect(() => {
    if (!effectiveLeadId) {
      setLead(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const trySingle = await fetch(
          `/api/employees/leads/${Number(effectiveLeadId)}`
        );
        if (trySingle.ok) {
          const data = await trySingle.json();
          if (!cancelled) setLead(data);
          return;
        }
        const res = await fetch("/api/employees/leads");
        if (!res.ok) {
          throw new Error(`Failed to fetch employees (${res.status})`);
        }

        const all = await res.json();

        const array = Array.isArray(all)
          ? all
          : all?.data && Array.isArray(all.data)
            ? all.data
            : [];

        const found = array.find(
          (x: any) => String(x.LeadId) === String(effectiveLeadId)
        );

        if (!cancelled) {
          if (found) {
            setLead(found);
          } else {
            setError("Lead not found");
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load lead");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveLeadId, origin]);

  //  EARLY STATES

  if (!effectiveLeadId) {
    return (
      <div style={{ padding: 20 }}>
        <button onClick={handleBack} style={backBtnStyle}>
          {getBackLabel()}
        </button>
        <p style={{ marginTop: 12 }}>No lead selected.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <button onClick={handleBack} style={backBtnStyle}>
          {getBackLabel()}
        </button>
        <p style={{ marginTop: 12, color: "red" }}>Error: {error}</p>
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={{ padding: 20 }}>
        <button onClick={handleBack} style={backBtnStyle}>
          {getBackLabel()}
        </button>
      </div>
    );
  }

  // STYLES

  const container: React.CSSProperties = {
    padding: 15,
    maxWidth: 1100,
    margin: "0 auto",
    fontFamily:
      "'Segoe UI', Roboto, system-ui, -apple-system, 'Helvetica Neue', Arial",
  };

  const headerRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  };

  const topActions: React.CSSProperties = {
    display: "flex",
    gap: 8,
    alignItems: "center",
  };

  const backBtn: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 6,
    border: "none",
    background: "#3a77e3",
    cursor: "pointer",
  };

  const primaryBtn: React.CSSProperties = {
    padding: "8px 14px",
    borderRadius: 6,
    border: "none",
    background: "#3a77e3",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  };

  const secondaryBtn: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid #3a77e3",
    background: "#fff",
    color: "#3a77e3",
    cursor: "pointer",
    fontWeight: 600,
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: 20,
    marginBottom: 16,
    alignItems: "stretch",
  };

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 8,
    padding: 18,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    flex: 1,
    border: "1px solid #e6e6e6",
  };

  const rightCardStyle: React.CSSProperties = {
    ...cardStyle,
    maxWidth: 380,
  };
  const contactCardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 8,
    padding: "12px 14px",
    border: "1px solid #eef1f4",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    marginBottom: 12,
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    borderLeft: "4px solid #1e90ff",
  };

  const contactAccentStyle: React.CSSProperties = {
    paddingLeft: 10,
  };

  const contactRowLabel: React.CSSProperties = {
    fontWeight: 700,
    minWidth: 60,
    fontSize: 13,
    color: "#111",
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 10,
    color: "#333",
  };

  const label: React.CSSProperties = {
    fontWeight: 700,
    color: "#444",
    width: 120,
    display: "inline-block",
    fontSize: 13,
  };

  const value: React.CSSProperties = {
    color: "#222",
  };

  const notesStyle: React.CSSProperties = {
    background: "#fff3cd",
    border: "1px solid #ffeeba",
    borderLeft: "6px solid #f1c040",
    padding: "10px 14px 10px 16px",
    borderRadius: 8,
    color: "#856404",
    marginBottom: 16,
  };

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 12px",
    border: "1px solid rgba(148,148,148,0.4)",
    backgroundColor: "#252b36",
    color: "#ffffff",
    top: 0,
    zIndex: 1,
    fontWeight: 600,
    fontSize: 12,
    textTransform: "uppercase",
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 14,
    borderBottom: "1px solid #e9ecef",
    verticalAlign: "middle",
  };

  const tableWrap: React.CSSProperties = {
    background: "#fff",
    borderRadius: 6,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: "1px solid #e6e6e6",
    marginBottom: 16,
    overflow: "hidden",
  };

  const addBtn = {
    backgroundColor: "#3a77e3",
    color: "white",
    width: 20,
    height: 20,
    borderRadius: 4,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    marginLeft: 6,
    cursor: "pointer",
    fontWeight: "semobold",
    border: "none",
    lineHeight: 0,
  };

  const modalOverlay: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  };
  const modalBox: React.CSSProperties = {
    background: "#fff",
    borderRadius: 6,
    overflow: "hidden",
    maxHeight: "80vh",
    display: "flex",
    width: 520,
    flexDirection: "column",
  };

  const modalHeader: React.CSSProperties = {
    background: "#3a77e3",
    color: "white",
    padding: "14px 20px",
    fontSize: 15,
    fontWeight: "bold",
    flexShrink: 0,
  };

  const modalBody: React.CSSProperties = {
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    fontSize: 13,
    overflowY: "auto",
    flex: 1,
    boxSizing: "border-box",
  };

  const modalFooter: React.CSSProperties = {
    padding: "12px 20px",
    display: "flex",
    justifyContent: "flex-start",
    gap: 10,
    flexShrink: 0,
    background: "#fff",
    borderTop: "1px solid #e5e7eb",
  };

  const inputBox: React.CSSProperties = {
    width: 260,
    maxWidth: "100%",
    height: 36,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 13,
    background: "#fff",
    boxSizing: "border-box",
  };

  const formRow3: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 16,
    marginBottom: 16,
    width: "100%",
    boxSizing: "border-box",
  };

  const cancelBtn: React.CSSProperties = {
    padding: "8px 15px",
    background: "#d1d1d1",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
  };

  const saveBtn: React.CSSProperties = {
    padding: "8px 15px",
    background: "#3a77e3",
    color: "#fff",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
  };

  const fieldGroup: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: 250,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
  };

  // MAIN RENDER

  return (
    <div style={container}>
      <button onClick={handleBack} style={backBtn}>
        Back
      </button>
      <div style={headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ color: "grey", fontWeight: 700, fontSize: 20 }}>
            Lead Details
          </p>
        </div>

        <div style={topActions}>
          <button
            onClick={handleConvert}
            style={secondaryBtn}
            disabled={finalOrigin === "MasterAccount"}
          >
            {finalOrigin === "MasterAccount"
              ? "Already a Master Account"
              : getConvertLabel()}
          </button>

          <button onClick={handleEdit} style={primaryBtn}>
            Edit
          </button>
        </div>
      </div>

      <div style={rowStyle}>
        <div style={cardStyle}>
          <div
            style={{
              ...sectionTitle,
              borderBottom: "1px solid #e6e6e6",
              paddingBottom: 8,
            }}
          >
            Company Information
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={contactRowLabel}>Company: </span>
            <span style={value}>{lead.CompanyName}</span>
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={contactRowLabel}>Location: </span>
            <span style={value}>{lead.CompanyLocation}</span>
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={contactRowLabel}>Owner: </span>
            <span style={value}>{lead.OwnerName}</span>
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={contactRowLabel}>Source: </span>
            <span style={value}>
              <span style={value}>{lead.LeadSource}</span>
            </span>
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={contactRowLabel}>Date: </span>
            <span style={value}>
              {lead.LeadDate
                ? new Date(String(lead.LeadDate)).toLocaleDateString()
                : "—"}
            </span>
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={contactRowLabel}>Status: </span>
            <span
              style={{
                padding: "2px 8px",
                background: "#e8f3ff",
                borderRadius: 12,
              }}
            >
              {lead.StatusName}
            </span>
          </div>
        </div>

        <div style={rightCardStyle}>
          <div
            style={{
              ...sectionTitle,
              borderBottom: "1px solid #e6e6e6",
              paddingBottom: 8,
            }}
          >
            Contacts
          </div>

          {(lead.Contacts || []).map((c, idx) => (
            <div key={idx} style={contactCardStyle}>
              <div style={contactAccentStyle}>
                <div style={{ display: "flex", marginBottom: 8 }}>
                  <div style={contactRowLabel}>Name:</div>
                  <div style={{ fontSize: 13 }}>{c.ContactName || "—"}</div>
                </div>

                {c.ContactTitle && (
                  <div style={{ display: "flex", marginBottom: 6 }}>
                    <div style={contactRowLabel}>Title:</div>
                    <div style={{ fontSize: 13 }}>{c.ContactTitle}</div>
                  </div>
                )}

                {c.ContactRoleName && (
                  <div style={{ display: "flex", marginBottom: 6 }}>
                    <div style={contactRowLabel}>Role:</div>
                    <div style={{ fontSize: 13 }}>{c.ContactRoleName}</div>
                  </div>
                )}

                {c.ContactEmail && (
                  <div style={{ display: "flex" }}>
                    <div style={contactRowLabel}>Email:</div>
                    <div style={{ fontSize: 13, color: "#3a77e3" }}>
                      <a
                        href={`mailto:${c.ContactEmail}`}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        {c.ContactEmail}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={notesStyle}>
        <strong>Notes:</strong>{" "}
        <span style={{ marginLeft: 8 }}>{lead.LeadNotes || "—"}</span>
      </div>

      {/* Activities */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center" }}>
        Activities
        <button style={addBtn} onClick={() => setShowAddActivity(true)}>
          +
        </button>
      </div>

      <div style={tableWrap}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 200 }}>Activity Date</th>
              <th style={{ ...thStyle, width: 120 }}>Mode</th>
              <th style={{ ...thStyle }}>Notes</th>
              <th style={{ ...thStyle, width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(lead.Activities || []).map((a, i) => (
              <tr key={a.ActivityId}>
                {/* Activity Date (read-only) */}
                <td style={tdStyle}>{formatDateTime(a.ActivityDate)}</td>

                {/* Mode */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`act-mode-${a.ActivityId}`)}
                >
                  {editingCell === `act-mode-${a.ActivityId}` ? (
                    <input
                      autoFocus
                      style={inputBox}
                      defaultValue={a.Mode || ""}
                      onBlur={(e) => {
                        if (isValueChanged(a.Mode, e.target.value)) {
                          autoSaveActivityField(i, "Mode", e.target.value);
                        }
                        setEditingCell(null);
                      }}
                    />
                  ) : (
                    a.Mode || "—"
                  )}
                </td>

                {/* Notes */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`act-notes-${a.ActivityId}`)}
                >
                  {editingCell === `act-notes-${a.ActivityId}` ? (
                    <input
                      autoFocus
                      style={inputBox}
                      defaultValue={a.Notes || ""}
                      onBlur={(e) => {
                        if (isValueChanged(a.Notes, e.target.value)) {
                          autoSaveActivityField(i, "Notes", e.target.value);
                        }
                        setEditingCell(null);
                      }}
                    />
                  ) : (
                    a.Notes || "—"
                  )}
                </td>

                {/* Status */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`act-status-${a.ActivityId}`)}
                >
                  {editingCell === `act-status-${a.ActivityId}` ? (
                    <input
                      autoFocus
                      style={inputBox}
                      defaultValue={a.Status || ""}
                      onBlur={(e) => {
                        if (isValueChanged(a.Status, e.target.value)) {
                          autoSaveActivityField(i, "Status", e.target.value);
                        }
                        setEditingCell(null);
                      }}
                    />
                  ) : (
                    a.Status || "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reminders */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center" }}>
        Reminders
        <button style={addBtn} onClick={() => setShowAddReminder(true)}>
          +
        </button>
      </div>
      <div style={tableWrap}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 180 }}>Reminder Date</th>
              <th style={{ ...thStyle }}>Notes</th>
              <th style={{ ...thStyle, width: 140 }}>Status</th>
              <th style={{ ...thStyle, width: 140 }}>Notification</th>
            </tr>
          </thead>
          <tbody>
            {(lead.Reminders || []).map((r, i) => (
              <tr key={r.ReminderId}>
                {/* Reminder Date */}
                <td style={tdStyle}>{formatDateTime(r.ReminderDate)}</td>

                {/* Notes */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`rem-notes-${r.ReminderId}`)}
                >
                  {editingCell === `rem-notes-${r.ReminderId}` ? (
                    <input
                      autoFocus
                      style={inputBox}
                      defaultValue={r.Notes || ""}
                      onBlur={(e) => {
                        if (isValueChanged(r.Notes, e.target.value)) {
                          autoSaveReminderField(i, "Notes", e.target.value);
                        }
                        setEditingCell(null);
                      }}
                    />
                  ) : (
                    r.Notes || "—"
                  )}
                </td>

                {/* Status */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`rem-status-${r.ReminderId}`)}
                >
                  {editingCell === `rem-status-${r.ReminderId}` ? (
                    <input
                      autoFocus
                      style={inputBox}
                      defaultValue={r.Status || ""}
                      onBlur={(e) => {
                        if (isValueChanged(r.Status, e.target.value)) {
                          autoSaveReminderField(i, "Status", e.target.value);
                        }
                        setEditingCell(null);
                      }}
                    />
                  ) : (
                    r.Status || "—"
                  )}
                </td>

                {/* Notification */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`rem-notify-${r.ReminderId}`)}
                >
                  {editingCell === `rem-notify-${r.ReminderId}` ? (
                    <input
                      autoFocus
                      style={inputBox}
                      defaultValue={r.Notification || ""}
                      onBlur={(e) => {
                        if (isValueChanged(r.Notification, e.target.value)) {
                          autoSaveReminderField(
                            i,
                            "Notification",
                            e.target.value
                          );
                        }
                        setEditingCell(null);
                      }}
                    />
                  ) : (
                    r.Notification || "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lead Opportunities */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center" }}>
        Opportunities
        <button style={addBtn} onClick={handleAddOpportunityClick}>
          +
        </button>
      </div>

      <div style={tableWrap}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 150 }}>Service</th>
              <th style={{ ...thStyle, width: 120 }}>Probability</th>
              <th style={{ ...thStyle, width: 200 }}>Status</th>
              <th style={{ ...thStyle, width: 200 }}>Engagement Model</th>
              <th style={{ ...thStyle, width: 250 }}>Technology</th>
              <th style={{ ...thStyle, width: 250 }}>Opportunity Contact</th>
            </tr>
          </thead>

          <tbody>
            {lead.Opportunities?.map((o, i) => (
              <tr
                key={o.OpportunityId ?? i}
                style={{ cursor: "pointer" }}
                onClick={() => handleEditOpportunity(o)}
              >
                <td style={tdStyle}>{o.Service}</td>
                <td style={tdStyle}>{o.Probability}</td>
                <td style={tdStyle}>{o.Status}</td>
                <td style={tdStyle}>{o.EngagementModel}</td>
                <td style={tdStyle}>{o.Technology ?? "-"}</td>
                <td
                  style={{
                    ...tdStyle,
                    whiteSpace: "pre-line",
                    lineHeight: "1.6",
                  }}
                >
                  {String(o.OpportunityContact)
                    .split(/(?=Full Name:)/g)
                    .map((block, index, arr) => (
                      <div
                        key={index}
                        style={{
                          paddingBottom: 6,
                          marginBottom: 6,
                          borderBottom:
                            index !== arr.length - 1
                              ? "1px solid #6a6c72ff"
                              : "none",
                        }}
                      >
                        {block.trim()}
                      </div>
                    ))}
                </td>
              </tr>
            ))}

            {(!lead.Opportunities || lead.Opportunities.length === 0) && (
              <tr>
                <td colSpan={5} style={tdStyle}>
                  No opportunities
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* ADD ACTIVITY MODAL */}
      {showAddActivity && (
        <div style={modalOverlay} onClick={() => setShowAddActivity(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div
              style={{
                ...modalHeader,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Add Activity</span>
              <span
                style={{ cursor: "pointer", fontSize: 22 }}
                onClick={() => {
                  setShowAddActivity(false);
                }}
              >
                ✕
              </span>
            </div>

            {/* Body */}
            <div style={modalBody}>
              <label style={{ fontWeight: 500 }}>Activity Type*</label>
              <select
                style={{ ...inputBox, width: 480 }}
                value={activityForm.Mode}
                onChange={(e) =>
                  setActivityForm({ ...activityForm, Mode: e.target.value })
                }
              >
                <option value="">-- Select Type --</option>
                <option value="Call">Call</option>
                <option value="Email">Email</option>
                <option value="Meeting">Meeting</option>
                <option value="Task">Task</option>
                <option value="Note">Note</option>
                <option value="Follow-up">Follow-up</option>
              </select>

              <label style={{ fontWeight: 500 }}>Status*</label>
              <select
                style={{ ...inputBox, width: 480 }}
                value={activityForm.Status}
                onChange={(e) =>
                  setActivityForm({ ...activityForm, Status: e.target.value })
                }
              >
                <option value="">-- Select Status --</option>
                <option value="New">New</option>
                <option value="Contacted">Contacted</option>
                <option value="Follow-up">Follow-up</option>
                <option value="Qualified">Qualified</option>
                <option value="Unqualified">Unqualified</option>
                <option value="Lost">Lost</option>
                <option value="Converted">Converted</option>
              </select>

              <label style={{ fontWeight: 500 }}>Notes*</label>
              <textarea
                style={{ ...inputBox, height: 60, width: 480, resize: "none" }}
                value={activityForm.Notes}
                onChange={(e) =>
                  setActivityForm({ ...activityForm, Notes: e.target.value })
                }
              />
            </div>

            {/* Footer */}
            <div style={{ ...modalFooter, paddingLeft: 300 }}>
              <button
                style={cancelBtn}
                onClick={() => {
                  setShowAddActivity(false);
                  setActivityForm({
                    ActivityDate: "",
                    Mode: "",
                    Status: "",
                    Notes: "",
                  });
                }}
              >
                Cancel
              </button>

              <button style={saveBtn} onClick={handleSaveActivity}>
                Save Activity
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD REMINDER MODAL */}
      {showAddReminder && (
        <div style={modalOverlay} onClick={() => setShowAddReminder(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div
              style={{
                ...modalHeader,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Add Reminder</span>
              <span
                style={{ cursor: "pointer", fontSize: 22 }}
                onClick={() => {
                  setShowAddReminder(false);
                }}
              >
                ✕
              </span>
            </div>

            {/* Body */}
            <div style={modalBody}>
              <label>Reminder Date*</label>
              <input
                type="date"
                style={{ ...inputBox, width: 480 }}
                value={reminderForm.ReminderDate}
                onChange={(e) =>
                  setReminderForm({
                    ...reminderForm,
                    ReminderDate: e.target.value,
                  })
                }
              />

              <label>Reminder Notes*</label>
              <textarea
                style={{ ...inputBox, height: 80, width: 480 }}
                value={reminderForm.Notes}
                onChange={(e) =>
                  setReminderForm({
                    ...reminderForm,
                    Notes: e.target.value,
                  })
                }
              />

              <label>Status*</label>
              <select
                style={{ ...inputBox, width: 480 }}
                value={reminderForm.Status}
                onChange={(e) =>
                  setReminderForm({
                    ...reminderForm,
                    Status: e.target.value,
                  })
                }
              >
                <option value="">-- Select Status --</option>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
              </select>

              <label>Notification Channels*</label>
              <select
                style={{ ...inputBox, width: 480 }}
                value={reminderForm.Notification}
                onChange={(e) =>
                  setReminderForm({
                    ...reminderForm,
                    Notification: e.target.value,
                  })
                }
              >
                <option value="">-- Select Notification Channel --</option>
                <option value="Email">Email</option>
                <option value="SMS">SMS</option>
                <option value="Email+SMS">Email + SMS</option>
                <option value="None">None</option>
              </select>
            </div>

            {/* Footer */}
            <div style={{ ...modalFooter, paddingLeft: 280 }}>
              <button
                style={cancelBtn}
                onClick={() => {
                  setShowAddReminder(false);
                  setReminderForm({
                    ReminderDate: "",
                    Notes: "",
                    Status: "",
                    Notification: "",
                  });
                }}
              >
                Cancel
              </button>

              <button style={saveBtn} onClick={handleSaveReminder}>
                Save Reminder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* - ADD OPPORTUNITY MODAL -*/}
      {showAddOpportunity && (
        <div style={modalOverlay} onClick={() => setShowAddOpportunity(false)}>
          <div
            style={{ ...modalBox, width: "60%", maxWidth: 1100 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                ...modalHeader,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Add Opportunity</span>
              <span
                style={{ cursor: "pointer", fontSize: 22 }}
                onClick={() => {
                  setShowAddOpportunity(false);
                  setOpportunityView("OPPORTUNITY");
                }}
              >
                ✕
              </span>
            </div>

            {/* Body */}
            <div style={modalBody}>
              {opportunityView === "OPPORTUNITY" && (
                <>
                  {/* FIRST ROW - 3 COLUMNS */}
                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label>Service *</label>
                      <select
                        style={{
                          ...inputBox,
                          width: "100%", // ✅ important
                          boxSizing: "border-box",
                          maxHeight: 200,
                          overflowY: "auto",
                        }}
                        value={opportunityForm.serviceId}
                        onChange={(e) =>
                          setOpportunityForm({
                            ...opportunityForm,
                            serviceId: Number(e.target.value),
                          })
                        }
                      >
                        <option value="">-- Select Service --</option>

                        {Array.isArray(Services) &&
                          Services.map((s) => (
                            <option
                              key={s.ServiceId}
                              value={s.ServiceId}
                              title={s.ServiceName}
                            >
                              {s.ServiceName}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div style={fieldGroup}>
                      <label>Status*</label>
                      <select
                        style={{
                          ...inputBox,
                          width: "100%",
                          boxSizing: "border-box",
                          maxHeight: 200,
                          overflowY: "auto",
                        }}
                        value={opportunityForm.statusId}
                        onChange={(e) =>
                          setOpportunityForm({
                            ...opportunityForm,
                            statusId: Number(e.target.value),
                          })
                        }
                      >
                        <option value="">-- Select Status --</option>

                        {Array.isArray(opportunityStatuses) &&
                          opportunityStatuses.map((s) => (
                            <option
                              key={s.Opportunity_StatusId}
                              value={s.Opportunity_StatusId}
                              title={s.Opportunities_StatusName}
                            >
                              {s.Opportunities_StatusName}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div style={fieldGroup}>
                      <label>Engagement Model *</label>
                      <select
                        style={inputBox}
                        value={opportunityForm.engagementId}
                        onChange={(e) =>
                          setOpportunityForm({
                            ...opportunityForm,
                            engagementId: Number(e.target.value),
                          })
                        }
                      >
                        <option value="">-- Select Engagement Model --</option>

                        {Array.isArray(engagementModels) &&
                          engagementModels.map((e) => (
                            <option key={e.EngagementId} value={e.EngagementId}>
                              {e.Engagement_ModelName}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* PROBABILITY */}
                  <div style={fieldGroup}>
                    <label>Probability *</label>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      {[
                        { id: 1, label: "<25%" },
                        { id: 2, label: "50%" },
                        { id: 3, label: "75%" },
                        { id: 4, label: "90%" },
                      ].map((p) => (
                        <label
                          key={p.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            name="probability"
                            checked={opportunityForm.probabilityId === p.id}
                            onChange={() =>
                              setOpportunityForm({
                                ...opportunityForm,
                                probabilityId: p.id,
                              })
                            }
                          />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* TECHNOLOGY */}
                  <label style={{ marginTop: 10 }}>Technology*</label>

                  <div
                    style={{
                      border: "1px solid #ccc",
                      padding: 20,
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gap: 10,
                        maxHeight: 200,
                        overflowY: "auto",
                        overflowX: "hidden",
                      }}
                    >
                      {categories.map((cat: any) => (
                        <div key={cat.CategoryId}>
                          <b>{cat.CategoryName}</b>

                          {[...cat.SubCategories]
                            .sort((a: any, b: any) => {
                              if (a.SubCategoryName === "Other") return 1;
                              if (b.SubCategoryName === "Other") return -1;
                              return 0;
                            })
                            .map((sc: any) => {

                              // CASE 1: SubCategory has children (AI → API / Open Source)
                              if (sc.Children && sc.Children.length > 0) {
                                return (
                                  <div
                                    key={sc.SubCategoryId}
                                    style={{ marginTop: 6 }}
                                  >
                                    <div
                                      style={{ fontWeight: 600, fontSize: 13 }}
                                    >
                                      {sc.SubCategoryName}
                                    </div>

                                    {sc.Children.map((child: any) => (
                                      <div
                                        key={child.SubCategoryId}
                                        style={{ marginLeft: 16, marginTop: 4 }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={opportunityForm.technologies.includes(
                                            child.SubCategoryId
                                          )}
                                          onChange={() =>
                                            handleTechnologyChange(
                                              child.SubCategoryId
                                            )
                                          }
                                        />
                                        &nbsp; {child.SubCategoryName}
                                      </div>
                                    ))}
                                  </div>
                                );
                              }

                              // CASE 2: Normal subcategory (all other categories)
                              return (
                                <div
                                  key={sc.SubCategoryId}
                                  style={{ marginTop: 6 }}
                                >
                                  {/* Checkbox row */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={opportunityForm.technologies.includes(
                                        sc.SubCategoryId
                                      )}
                                      onChange={() =>
                                        handleTechnologyChange(
                                          sc.SubCategoryId,
                                          sc.SubCategoryName
                                        )
                                      }
                                    />

                                    <span style={{ fontSize: 13 }}>
                                      {sc.SubCategoryName}
                                    </span>
                                  </div>

                                  {/* ✅ OTHER → INPUT BELOW */}
                                  {sc.SubCategoryName === "Other" &&
                                    opportunityForm.technologies.includes(
                                      sc.SubCategoryId
                                    ) && (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          paddingLeft: 18, // visual indent only
                                          boxSizing: "border-box",
                                          width: "100%", // stays inside column
                                        }}
                                      >
                                        <input
                                          type="text"
                                          placeholder="Enter technology name"
                                          value={
                                            otherTechnologyMap[
                                            sc.SubCategoryId
                                            ] || ""
                                          }
                                          onChange={(e) =>
                                            setOtherTechnologyMap((prev) => ({
                                              ...prev,
                                              [sc.SubCategoryId]: e.target.value,
                                            }))
                                          }
                                          style={{
                                            width: "100%",
                                            boxSizing: "border-box", // 🔑 THIS FIXES OVERFLOW
                                            padding: "6px 8px",
                                            borderRadius: 6,
                                            border: "1px solid #cbd5e1",
                                            fontSize: 13,
                                          }}
                                        />
                                      </div>
                                    )}
                                </div>
                              );
                            })}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* OPPORTUNITY CONTACTS */}
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <label style={{ fontWeight: 600 }}>
                        Opportunity Contacts
                      </label>
                      <button
                        style={addBtn}
                        onClick={() => {
                          setSelectedOppContactIndex(null);
                          setOppContactForm(EMPTY_OPP_CONTACT_FORM);
                          setOpportunityView("CONTACT");
                        }}
                      >
                        +
                      </button>
                    </div>

                    {/* OPPORTUNITY CONTACTS TABLE */}
                    {oppContacts.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: 13,
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <thead>
                            <tr style={{ background: "#f3f4f6" }}>
                              <th style={oppTh}>Full Name</th>
                              <th style={oppTh}>Email</th>
                              <th style={oppTh}>Job Title</th>
                              <th style={oppTh}>Phone Number</th>
                            </tr>
                          </thead>
                          <tbody>
                            {oppContacts.map((c, i) => (
                              <tr
                                key={i}
                                style={{ cursor: "pointer" }}
                                onClick={() => {
                                  setSelectedOppContactIndex(i);
                                  setOppContactForm(c);
                                  setOpportunityView("CONTACT");
                                }}
                              >
                                <td style={oppTd}>{c.FullName || "—"}</td>
                                <td style={{ ...oppTd, color: "#2563eb" }}>
                                  {c.WorkEmail || "—"}
                                </td>
                                <td style={oppTd}>{c.JobTitle || "—"}</td>
                                <td style={oppTd}>{c.MobilePhone || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
              {opportunityView === "CONTACT" && (
                <>
                  <div
                    style={{
                      background: "#3a77e3",
                      color: "#fff",
                      padding: "12px 16px",
                      fontWeight: 600,
                      fontSize: 15,
                      borderRadius: 6,
                      marginBottom: 16,
                    }}
                  >
                    Opportunity Contact Form
                  </div>

                  {/* BASIC INFO */}
                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Full Name *</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.FullName}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            FullName: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>First Name</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.FirstName}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            FirstName: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Last Name</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.LastName}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            LastName: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* JOB DETAILS */}
                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Preferred Name</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.PreferredName}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            PreferredName: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Job Title</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.JobTitle}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            JobTitle: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Department</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.Department}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            Department: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* PERSONAL DETAILS */}
                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Seniority Level</label>
                      <select
                        style={inputBox}
                        value={oppContactForm.SeniorityLevel}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            SeniorityLevel: e.target.value,
                          })
                        }
                      >
                        <option value="">Select</option>
                        <option value="C-Level">C-Level</option>
                        <option value="VP">VP</option>
                        <option value="Director">Director</option>
                        <option value="Manager">Manager</option>
                        <option value="Individual Contributor">
                          Individual Contributor
                        </option>
                      </select>
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Gender</label>
                      <select
                        style={inputBox}
                        value={oppContactForm.Gender}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            Gender: e.target.value,
                          })
                        }
                      >
                        <option value="">Select</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Date of Birth</label>
                      <input
                        type="date"
                        style={inputBox}
                        value={oppContactForm.DateOfBirth}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            DateOfBirth: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* ORGANIZATION INFO */}
                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Company Name</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.CompanyName}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            CompanyName: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Division</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.Division}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            Division: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Office Location</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.OfficeLocation}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            OfficeLocation: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Industry</label>
                      <select
                        style={inputBox}
                        value={oppContactForm.Industry}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            Industry: e.target.value,
                          })
                        }
                      >
                        <option value="">Select</option>
                        <option value="IT / Software">IT / Software</option>
                        <option value="Healthcare">Healthcare</option>
                        <option value="Banking & Finance">
                          Banking & Finance
                        </option>
                        <option value="Manufacturing">Manufacturing</option>
                        <option value="Retail">Retail</option>
                        <option value="Education">Education</option>
                        <option value="Pharma">Pharma</option>
                        <option value="Telecom">Telecom</option>
                      </select>
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Company Website</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.CompanyWebsite}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            CompanyWebsite: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Company LinkedIn Page</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.CompanyLinkedInPage}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            CompanyLinkedInPage: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* CONTACT DETAILS */}
                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Work Email *</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.WorkEmail}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            WorkEmail: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Personal Email</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.PersonalEmail}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            PersonalEmail: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Direct Phone</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.DirectPhone}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            DirectPhone: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Mobile Phone *</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.MobilePhone}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            MobilePhone: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Office Phone</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.OfficePhone}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            OfficePhone: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>LinkedIn Profile URL</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.LinkedInProfileUrl}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            LinkedInProfileUrl: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div style={formRow3}>
                    <div style={fieldGroup}>
                      <label style={labelStyle}>
                        Headquarters / Office Type
                      </label>
                      <select
                        style={inputBox}
                        value={oppContactForm.HeadquartersLocation}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            HeadquartersLocation: e.target.value,
                          })
                        }
                      >
                        <option value="">Select</option>
                        <option value="Headquarters">Headquarters</option>
                        <option value="Regional Office">Regional Office</option>
                        <option value="Branch Office">Branch Office</option>
                        <option value="Remote">Remote</option>
                      </select>
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Employee Size</label>
                      <input
                        type="number"
                        style={inputBox}
                        value={oppContactForm.EmployeeSize}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            EmployeeSize: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div style={fieldGroup}>
                      <label style={labelStyle}>Profile Picture URL</label>
                      <input
                        style={inputBox}
                        value={oppContactForm.ProfilePictureUrl}
                        onChange={(e) =>
                          setOppContactForm({
                            ...oppContactForm,
                            ProfilePictureUrl: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* ACTIONS */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 12,
                    }}
                  >
                    {selectedOppContactIndex !== null && (
                      <button
                        style={{
                          padding: "8px 14px",
                          background: "#ef4444",
                          color: "#fff",
                          borderRadius: 4,
                          border: "none",
                          cursor: "pointer",
                        }}
                        onClick={async () => {
                          if (selectedOppContactIndex === null) return;

                          const contact = oppContacts[selectedOppContactIndex];

                          try {
                            //  BACKEND DELETE
                            if (
                              contact.OpportunityContactId &&
                              currentOpportunityId
                            ) {
                              const res = await fetch(
                                `/api/employees/leads/${effectiveLeadId}/opportunities/${currentOpportunityId}/contacts`,
                                {
                                  method: "DELETE",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    OpportunityContactId:
                                      contact.OpportunityContactId,
                                  }),
                                }
                              );

                              if (!res.ok) {
                                alert("Failed to delete contact");
                                return;
                              }
                            }

                            //  UI DELETE
                            const updated = oppContacts.filter(
                              (_, i) => i !== selectedOppContactIndex
                            );

                            setOppContacts(updated);
                            setOppContactForm(EMPTY_OPP_CONTACT_FORM);
                            setSelectedOppContactIndex(null);
                            setOpportunityView("OPPORTUNITY");
                          } catch (err) {
                            console.error("Delete contact error:", err);
                            alert("Unexpected error while deleting contact");
                          }
                        }}
                      >
                        Delete Contact
                      </button>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        style={cancelBtn}
                        onClick={() => {
                          setOppContactForm(EMPTY_OPP_CONTACT_FORM);
                          setSelectedOppContactIndex(null);
                          setOpportunityView("OPPORTUNITY");
                        }}
                      >
                        Cancel
                      </button>

                      <button
                        style={saveBtn}
                        onClick={async () => {
                          // 1 REQUIRED FIELD VALIDATION
                          if (
                            !oppContactForm.FullName ||
                            !oppContactForm.MobilePhone ||
                            !oppContactForm.WorkEmail
                          ) {
                            alert("Please fill required fields");
                            return;
                          }

                          // 2 ADD MODE → NO OpportunityId YET
                          // Just store contact locally
                          if (!currentOpportunityId) {
                            setOppContacts((prev) => [...prev, oppContactForm]);
                            setOppContactForm(EMPTY_OPP_CONTACT_FORM);
                            setSelectedOppContactIndex(null);
                            setOpportunityView("OPPORTUNITY");
                            return;
                          }

                          // 3 EDIT MODE ONLY → OpportunityId EXISTS
                          const method = oppContactForm.OpportunityContactId
                            ? "PUT"
                            : "POST";

                          await fetch(
                            `/api/employees/leads/${effectiveLeadId}/opportunities/${currentOpportunityId}/contacts`,
                            {
                              method,
                              headers: { "Content-Type": "application/json" },
                              body:
                                method === "PUT"
                                  ? JSON.stringify(oppContactForm)
                                  : JSON.stringify([oppContactForm]),
                            }
                          );

                          // 4 UPDATE UI STATE
                          if (selectedOppContactIndex !== null) {
                            const updated = [...oppContacts];
                            updated[selectedOppContactIndex] = oppContactForm;
                            setOppContacts(updated);
                          } else {
                            setOppContacts((prev) => [...prev, oppContactForm]);
                          }

                          // RESET FORM & GO BACK
                          setOppContactForm(EMPTY_OPP_CONTACT_FORM);
                          setSelectedOppContactIndex(null);
                          setOpportunityView("OPPORTUNITY");
                        }}
                      >
                        Save Contact
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ ...modalFooter, paddingLeft: 580 }}>
              {opportunityView === "OPPORTUNITY" && (
                <button
                  style={cancelBtn}
                  onClick={() => {
                    setShowAddOpportunity(false);
                    setMode("add");
                    setCurrentOpportunityId(null);
                    resetOpportunityForm();
                  }}
                >
                  Cancel
                </button>
              )}
              {opportunityView === "OPPORTUNITY" && (
                <button style={saveBtn} onClick={handleSaveOpportunity}>
                  Save Opportunity
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// shared style used in early return above

const backBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "none",
  background: "#efefef",
  cursor: "pointer",
};

const oppTh: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
  fontWeight: 600,
};

const oppTd: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f1f5f9",
};
