"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useRouter } from "next/navigation";
import { formatLocaleDate, formatLocaleDateTime } from "@/app/utils/dateTime";
import {
  convertLeadDirectToAccountWithExistingFlow,
  convertLeadWithExistingFlow,
} from "../convert-actions";
import { Search, Wrench, Star, Package, AlertTriangle } from "lucide-react";
type Contact = {
  LeadContactID?: number;
  ContactName?: string;
  ContactEmail?: string;
  ContactPhone?: string;
  ContactTitle?: string;
  ContactRoleName?: string;
  LinkedInProfile?: string;
  LinkedInRequestSent?: number | boolean;
  LinkedInRequestAccepted?: number | boolean;
  EmailSent?: number | boolean;
};
type Activity = {
  ActivityId: number;
  ActivityDate: string;
  Mode: string;
  Notes?: string;
  Status?: string;
  ContactId?: number | null;
  ContactName?: string;
};

type Reminder = {
  ReminderId: number;
  ReminderDate: string;
  Notes?: string;
  Status?: string;
  Notification?: string;
};

type MeetingForm = {
  subject: string;
  attendees: Array<{ email: string; name: string }>;
  startDateTime: string;
  endDateTime: string;
  agenda: string;
  location: string;
  sendEmail: boolean;
};

type Opportunity = {
  OpportunityId: number;
  ProjectId?: number | null;
  ProjectName?: string | null;

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

type Project = {
  ProjectId: number;
  ProjectCode?: string | null;
  ProjectName: string;
  ProjectDesc?: string | null;
  TechStack?: string | null;
  KeyWork?: string | null;
  ValueAdded?: string | null;
  Deliverables?: string | null;
  Challenges?: string | null;
  CompanyName: string;
  LeadId: number;
  StartDate?: string;
  EndDate?: string;
  Status?: string;
  TeamMembers?: Array<{
    EmployeeId?: number | string;
    EmployeeName?: string | null;
    Title?: string | null;
    StartDate?: string | null;
    EndDate?: string | null;
    ReportingManager?: string | null;
    ReportingManagerTitle?: string | null;
  }>;
  ProjectContacts?: Array<{
    ContactId?: number;
    ProjectId?: number;
    ContactName?: string | null;
    ContactTypeId?: number;
    Title?: string | null;
    Email?: string | null;
    Phone?: string | null;
  }>;
};

type ProjectSowSummary = {
  SOWId: number;
  ProjectId: number | null;
  SOWName: string;
  Client: string;
  FileName: string;
  EffectiveDate?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  NumberOfPositions: number;
  NumberOfResources: number;
  UploadedOn?: string | null;
  ParseStatus?: string | null;
  ParseMessage?: string | null;
  VersionNo?: number;
  Status?: string | null;
};

type ProjectSowDetails = ProjectSowSummary & {
  LinkedProjectLabel?: string;
  EffectiveDate?: string | null;
  ParseStatus?: string | null;
  ParseMessage?: string | null;
  IsCurrent?: boolean;
  ReplacesSOWId?: number | null;
  ReplacedBySOWId?: number | null;
  Positions: Array<{
    SOWPositionId: number;
    SOWId?: number;
    PositionNumber: number;
    Role: string;
    StartDate?: string | null;
    EndDate?: string | null;
    Resources: Array<{
      SOWPositionResourceId: number;
      SOWPositionId?: number;
      Resource: string;
      ResourceId?: number | null;
      EmployeeCode?: string | null;
      Location?: string | null;
      BusinessHours?: string | null;
      BillingStartDate?: string | null;
      BillingEndDate?: string | null;
      BillingRate?: number | null;
      BudgetedHours?: number | null;
      BudgetedFees?: number | null;
      Currency?: string | null;
      RateType?: string | null;
      SOWRate?: number | null;
      EndReason?: string | null;
      StartDate?: string | null;
      EndDate?: string | null;
      [key: string]: any;
    }>;
  }>;
  [key: string]: any;
};

type CustomerSowSummary = ProjectSowSummary & {
  ProjectName?: string | null;
  LinkedProjectLabel?: string;
  IsCurrent?: boolean;
  ReplacesSOWId?: number | null;
  ReplacedBySOWId?: number | null;
};

type SOWResourceDraft = {
  SOWPositionResourceId?: number;
  Resource: string;
  ResourceId: string;
  EmployeeCode: string;
  Location: string;
  Role: string;
  StartDate: string;
  EndDate: string;
  BusinessHours: string;
  BillingStartDate: string;
  BillingEndDate: string;
  BillingRate: string;
  BudgetedHours: string;
  BudgetedFees: string;
  Currency: string;
  RateType: string;
  SOWRate: string;
  EndReason: string;
};

type SOWPositionDraft = {
  SOWPositionId?: number;
  PositionNumber: number;
  Role: string;
  StartDate: string;
  EndDate: string;
  expanded: boolean;
  Resources: SOWResourceDraft[];
};

type CustomerSowEditDraft = {
  SOWId: number;
  SOWName: string;
  Client: string;
  Status: string;
  EffectiveDate: string;
  StartDate: string;
  EndDate: string;
  ParseStatus: string;
  ParseMessage: string;
  Positions: SOWPositionDraft[];
};

type EmployeeSuggestion = {
  EmployeeId: string;
  EmployeeName: string;
};

type ProjectResourceDraft = {
  resourceName: string;
  employeeId: string | null;
  title: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  reportingManager: string;
  reportingManagerTitle: string;
  suggestions: EmployeeSuggestion[];
  showSuggestions: boolean;
  isSearching: boolean;
};

type ProjectContactDraft = {
  contactName: string;
  title: string;
  email: string;
  phone: string;
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
  Projects?: Project[];
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

export default function LeadDetailsClient({
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
  const [showAddMeeting, setShowAddMeeting] = useState(false);
  const [showConvertMenu, setShowConvertMenu] = useState(false);
  const [showAddOpportunity, setShowAddOpportunity] = useState(false);
  const [otherTechnologyMap, setOtherTechnologyMap] = useState<
    Record<number, string>
  >({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactIdx, setSelectedContactIdx] = useState<number | null>(null);
  const [activityContactIdx, setActivityContactIdx] = useState<number | null>(null);
  const [isActivityContactLocked, setIsActivityContactLocked] = useState(false);
  const [activityContactSearch, setActivityContactSearch] = useState("");
  const [showActivityContactDropdown, setShowActivityContactDropdown] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSortBy, setProjectSortBy] = useState<"name" | "company">("name");
  const [projectStatusFilter, setProjectStatusFilter] = useState<"all" | "active" | "hidden">("active");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectFormMode, setProjectFormMode] = useState<"add" | "edit">("add");
  const [projectActionLoading, setProjectActionLoading] = useState<number | null>(null);
  const [isProjectOngoing, setIsProjectOngoing] = useState(false);
  const [projectForm, setProjectForm] = useState({
    ProjectId: null as number | null,
    ProjectCode: "",
    ProjectName: "",
    ProjectDesc: "",
    TechStack: "",
    KeyWork: "",
    ValueAdded: "",
    Deliverables: "",
    Challenges: "",
    StartDate: "",
    EndDate: "",
  });
  const [projectContactsInput, setProjectContactsInput] = useState<ProjectContactDraft[]>([]);
  const [projectResourcesInput, setProjectResourcesInput] = useState<ProjectResourceDraft[]>([]);
  const [opportunityProjectSearch, setOpportunityProjectSearch] = useState("");
  const [autoPrefilledOppContacts, setAutoPrefilledOppContacts] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showProjectSummary, setShowProjectSummary] = useState(false);
  const [projectSummaryLoading, setProjectSummaryLoading] = useState(false);
  const [projectSowLoading, setProjectSowLoading] = useState(false);
  const [projectSowUploadLoading, setProjectSowUploadLoading] = useState(false);
  const [projectSow, setProjectSow] = useState<ProjectSowSummary | null>(null);
  const [projectSowMessage, setProjectSowMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showProjectSowDetails, setShowProjectSowDetails] = useState(false);
  const [projectSowDetailsLoading, setProjectSowDetailsLoading] = useState(false);
  const [projectSowDetails, setProjectSowDetails] = useState<ProjectSowDetails | null>(null);
  const [projectSowDetailsTab, setProjectSowDetailsTab] = useState<"overview" | "positions">("overview");
  const [projectSowDetailsSearch, setProjectSowDetailsSearch] = useState("");
  const [projectSowSelectedResourceKey, setProjectSowSelectedResourceKey] = useState<string | null>(null);
  const sowFileInputRef = useRef<HTMLInputElement | null>(null);
  const customerSowFileInputRef = useRef<HTMLInputElement | null>(null);
  const [customerSowsLoading, setCustomerSowsLoading] = useState(false);
  const [customerSowUploadLoading, setCustomerSowUploadLoading] = useState(false);
  const [customerSows, setCustomerSows] = useState<CustomerSowSummary[]>([]);
  const [customerSowMessage, setCustomerSowMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showCustomerSowEditModal, setShowCustomerSowEditModal] = useState(false);
  const [customerSowEditLoading, setCustomerSowEditLoading] = useState(false);
  const [customerSowEditSaving, setCustomerSowEditSaving] = useState(false);
  const [customerSowEditDraft, setCustomerSowEditDraft] = useState<CustomerSowEditDraft | null>(null);
  const [projectSummaryAccordions, setProjectSummaryAccordions] = useState({
    techStack: true,
    keyWork: true,
    valueAdded: true,
    deliverables: true,
    challenges: true,
  });




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
  const [leadStatuses, setLeadStatuses] = useState<any[]>([]);
  const [engagementModels, setEngagementModels] = useState<any[]>([]);
  const [Services, setServices] = useState<any[]>([]);
  const [probabilities, setProbabilities] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/masters/others")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.opportunityStatuses)) {
          setOpportunityStatuses(data.opportunityStatuses);
        }
        if (Array.isArray(data?.leadStatuses)) {
          setLeadStatuses(data.leadStatuses);
        }

        // ✅ FIXED
        if (Array.isArray(data?.engagementModels)) {
          setEngagementModels(data.engagementModels);
        }

        if (Array.isArray(data?.services)) {
          setServices(data.services);
        }
        if (Array.isArray(data?.probabilities)) {
          setProbabilities(data.probabilities);
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
    ActivityDate: new Date().toISOString().split("T")[0],
    Mode: "",
    Notes: "",
    Status: "",
  });
  const leadContacts = lead?.Contacts ?? [];
  const selectedActivityContact =
    activityContactIdx !== null
      ? leadContacts[activityContactIdx] ?? null
      : null;
  const filteredActivityContacts = leadContacts
    .map((contact, originalIndex) => ({ contact, originalIndex }))
    .filter(({ contact }) =>
      (contact.ContactName || "")
        .toLowerCase()
        .includes(activityContactSearch.trim().toLowerCase())
    );

  const resetActivityModal = () => {
    setActivityForm({
      ActivityDate: new Date().toISOString().split("T")[0],
      Mode: "",
      Status: "",
      Notes: "",
    });
    setActivityContactIdx(null);
    setIsActivityContactLocked(false);
    setActivityContactSearch("");
    setShowActivityContactDropdown(false);
  };

  const closeActivityModal = () => {
    setShowAddActivity(false);
    resetActivityModal();
  };

  const openActivityFromContact = (contactIndex: number) => {
    setActivityContactIdx(contactIndex);
    setIsActivityContactLocked(true);
    setActivityContactSearch("");
    setShowActivityContactDropdown(false);
    setShowAddActivity(true);
  };

  const openActivityFromGlobal = () => {
    const contacts = lead?.Contacts ?? [];
    setActivityContactIdx(contacts.length === 1 ? 0 : null);
    setIsActivityContactLocked(false);
    setActivityContactSearch("");
    setShowActivityContactDropdown(false);
    setShowAddActivity(true);
  };

  const [reminderForm, setReminderForm] = useState({
    ReminderDate: "",
    Notes: "",
    Status: "Pending",
    Notification: "",
  });

  const [meetingForm, setMeetingForm] = useState<MeetingForm>({
    subject: "",
    attendees: [{ email: "", name: "" }],
    startDateTime: "",
    endDateTime: "",
    agenda: "",
    location: "Online",
    sendEmail: true,
  });

  const resetMeetingForm = () => {
    setMeetingForm({
      subject: "",
      attendees: [{ email: "", name: "" }],
      startDateTime: "",
      endDateTime: "",
      agenda: "",
      location: "Online",
      sendEmail: true,
    });
  };

  const toSqlDateTime = (input: string): string => {
    if (!input) return "";
    const normalized = input.includes("T") ? input.replace("T", " ") : input;
    return normalized.length === 16 ? `${normalized}:00` : normalized;
  };

  const resetOpportunityForm = () => {
    setOpportunityForm({
      projectId: "",
      serviceId: "",
      probabilityId: "",
      statusId: "",
      engagementId: "",
      technologies: [],
    });
    setOpportunityProjectSearch("");
    setAutoPrefilledOppContacts(false);
  };

  const [opportunityForm, setOpportunityForm] = useState({
    projectId: "" as number | "",
    serviceId: "" as number | "",
    statusId: "" as number | "",
    probabilityId: "" as number | "",
    engagementId: "" as number | "",
    technologies: [] as number[],
  });

  const closedWonStatusIds = opportunityStatuses
    .filter((s) =>
      typeof s.Opportunities_StatusName === "string" &&
      ["closed won", "won", "done", "completed"].some((value) =>
        s.Opportunities_StatusName.trim().toLowerCase().includes(value)
      )
    )
    .map((s) => s.Opportunity_StatusId);
  const closedWonStatusId = closedWonStatusIds.length ? closedWonStatusIds[0] : null;
  const isClosedWonStatusSelected =
    opportunityForm.statusId !== "" &&
    closedWonStatusIds.includes(opportunityForm.statusId as number);
  const isHundredPercentProbabilitySelected = (() => {
    const selectedProbabilityId = Number(opportunityForm.probabilityId);
    if (!selectedProbabilityId || Number.isNaN(selectedProbabilityId)) return false;

    const source =
      Array.isArray(probabilities) && probabilities.length > 0
        ? probabilities.map((p) => ({
          id: Number(p.ProbabilityId),
          label: String(p.ProbabilityRange || "").trim(),
        }))
        : [
          { id: 1, label: "<25%" },
          { id: 2, label: "50%" },
          { id: 3, label: "75%" },
          { id: 4, label: "90%" },
          { id: 5, label: "100%" },
        ];

    const selected = source.find((p) => p.id === selectedProbabilityId);
    if (!selected) return false;

    return /100\s*%/.test(selected.label);
  })();
  const hasSelectedProject = typeof opportunityForm.projectId === "number";

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

      setLead((prev) => ({
        ...data,
        Contacts: data.Contacts || [],
        Activities: data.Activities || [],
        Reminders: data.Reminders || [],
        Opportunities: data.Opportunities || [],
        // Preserve already-loaded projects when this endpoint doesn't include them
        Projects: data.Projects || prev?.Projects || [],
      }));
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

    if (!selectedActivityContact) {
      alert(
        leadContacts.length === 0
          ? "No contacts available. Please add a contact first."
          : "Please select a contact"
      );
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
          ActivityDate: activityForm.ActivityDate,
          ContactId: selectedActivityContact?.LeadContactID ?? null,
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

      setShowAddActivity(false);
      resetActivityModal();
    } catch (err) {
      console.error("Frontend save error:", err);
      alert("Unexpected error while saving activity");
    }
  };

  const formatDateTime = (value?: string) => {
    return formatLocaleDateTime(value, undefined, "—");
  };

  const formatActivityNotesForDisplay = (activity: Activity) => {
    const raw = String(activity?.Notes || "").trim();
    if (!raw) return "—";

    const mode = String(activity?.Mode || "").trim().toLowerCase();
    if (mode !== "meeting") return raw;

    const attendeeMatch = raw.match(/Attendee:\s*([^\n<]+)/i);
    const agendaMatch = raw.match(/Agenda:\s*([^\n]+)/i);
    const subjectMatch = raw.match(/Meeting Subject:\s*([^\n]+)/i);

    const attendee = attendeeMatch?.[1]?.trim();
    const agenda = agendaMatch?.[1]?.trim();
    const subject = subjectMatch?.[1]?.trim();
    const dateText = formatDateTime(activity.ActivityDate);

    const parts: string[] = [];
    if (attendee) {
      parts.push(`Had a meeting with ${attendee}`);
    } else {
      parts.push("Had a meeting");
    }

    if (dateText && dateText !== "—") {
      parts.push(`on ${dateText}`);
    }

    let sentence = parts.join(" ");

    if (subject && subject !== "-") {
      sentence += `. Subject: ${subject}`;
    }

    if (agenda && agenda !== "-") {
      sentence += `. Agenda: ${agenda}`;
    }

    return sentence;
  };

  const toDisplayValue = (value?: string | null) => {
    if (value === null || value === undefined) return "Not Available";
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : "Not Available";
  };

  const toDisplayPoints = (value?: string | null) => {
    const displayValue = toDisplayValue(value);
    if (displayValue === "Not Available") return ["Not Available"];

    return displayValue
      .split(/\r?\n+/)
      .map((line) => line.replace(/^[\-•\d.)\s]+/, "").trim())
      .filter(Boolean);
  };

  const getProjectTeamMembers = () => {
    if (!selectedProject?.TeamMembers || !Array.isArray(selectedProject.TeamMembers)) {
      return [] as Array<{ EmployeeId?: number | string; EmployeeName?: string | null }>;
    }

    return selectedProject.TeamMembers.filter((member) => {
      const name = member?.EmployeeName;
      return typeof name === "string" && name.trim().length > 0;
    });
  };

  const getProjectContacts = () => {
    if (!selectedProject?.ProjectContacts || !Array.isArray(selectedProject.ProjectContacts)) {
      return [] as Array<{
        ContactId?: number;
        ProjectId?: number;
        ContactName?: string | null;
        ContactTypeId?: number;
        Title?: string | null;
        Email?: string | null;
        Phone?: string | null;
      }>;
    }

    return selectedProject.ProjectContacts.filter((contact) => {
      const name = contact?.ContactName;
      return typeof name === "string" && name.trim().length > 0;
    });
  };

  const getMemberField = (member: any, keys: string[]) => {
    for (const key of keys) {
      const value = member?.[key];
      if (value !== undefined && value !== null && String(value).trim().length > 0) {
        return String(value).trim();
      }
    }
    return "";
  };

  const isOngoingValue = (value?: string | null) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return true;
    return ["ongoing", "active", "current", "present", "open"].includes(normalized);
  };

  const oldProjectTeamMembers = getProjectTeamMembers().filter((member: any) => {
    const endDate = getMemberField(member, ["EndDate", "endDate", "AllocationEndDate"]);
    return endDate.length > 0 && !isOngoingValue(endDate);
  });

  const newProjectTeamMembers = getProjectTeamMembers().filter((member: any) => {
    const endDate = getMemberField(member, ["EndDate", "endDate", "AllocationEndDate"]);
    return endDate.length === 0 || isOngoingValue(endDate);
  });

  const formatMemberDate = (value?: string | null, fallback = "Ongoing") => {
    if (!value || isOngoingValue(value)) return fallback;
    return formatProjectDate(value);
  };

  const toggleProjectSummaryAccordion = (
    key: "techStack" | "keyWork" | "valueAdded" | "deliverables" | "challenges"
  ) => {
    setProjectSummaryAccordions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const resetProjectSummaryAccordions = () => {
    setProjectSummaryAccordions({
      techStack: true,
      keyWork: true,
      valueAdded: true,
      deliverables: true,
      challenges: true,
    });
  };

  const formatProjectDate = (value?: string | null) => {
    if (!value) return "Not Available";
    return formatLocaleDate(value, undefined, "Not Available");
  };

  const getProjectStartDateDisplay = (project?: { StartDate?: string | null } | null) => {
    return formatProjectDate(project?.StartDate ?? selectedProject?.StartDate ?? null);
  };

  const getProjectEndDateDisplay = (project?: { EndDate?: string | null } | null) => {
    const endDate = project?.EndDate ?? selectedProject?.EndDate ?? null;
    if (!endDate) return "Ongoing";
    return formatProjectDate(endDate);
  };

  const formatSowDate = (value?: string | null, fallback = "Not Available") => {
    if (!value) return fallback;
    return formatLocaleDate(value, undefined, fallback);
  };

  const formatSowDuration = (sow?: ProjectSowSummary | null) => {
    if (!sow) return "Not Available";
    const start = formatSowDate(sow.StartDate || null);
    const end = sow.EndDate ? formatSowDate(sow.EndDate) : "Ongoing";
    if (start === "Not Available" && end === "Ongoing") return "Not Available";
    return `${start} - ${end}`;
  };

  const toInputDate = (value?: string | null) => {
    if (!value) return "";
    const text = String(value);
    return text.includes("T") ? text.split("T")[0] : text;
  };

  const toInputText = (value: any) => {
    if (value === null || value === undefined) return "";
    return String(value);
  };

  const resetProjectSowState = () => {
    setProjectSow(null);
    setProjectSowMessage(null);
    setProjectSowDetails(null);
    setShowProjectSowDetails(false);
    setProjectSowDetailsTab("overview");
    setProjectSowDetailsSearch("");
    setProjectSowSelectedResourceKey(null);
  };

  const fetchProjectSow = async (projectId: number) => {
    try {
      setProjectSowLoading(true);
      const res = await fetch(`/api/sow/${projectId}`);
      if (!res.ok) {
        throw new Error("Failed to fetch SOW");
      }

      const payload = await res.json();
      setProjectSow(payload?.exists ? (payload.sow as ProjectSowSummary) : null);
    } catch (error: any) {
      setProjectSow(null);
      setProjectSowMessage({
        type: "error",
        text: error?.message || "Failed to fetch Statement of Work",
      });
    } finally {
      setProjectSowLoading(false);
    }
  };

  const triggerSowUpload = () => {
    if (!selectedProject?.ProjectId || projectSowUploadLoading) return;
    setProjectSowMessage(null);
    sowFileInputRef.current?.click();
  };

  const handleSowFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !selectedProject?.ProjectId) return;

    if (!/\.docx$/i.test(file.name || "")) {
      setProjectSowMessage({ type: "error", text: "Unsupported file type. Please upload a .docx file only." });
      return;
    }

    try {
      setProjectSowUploadLoading(true);
      setProjectSowMessage(null);

      const formData = new FormData();
      formData.append("projectId", String(selectedProject.ProjectId));
      formData.append("file", file);

      const res = await fetch("/api/sow/upload", {
        method: "POST",
        body: formData,
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "SOW upload failed");
      }

      setProjectSowMessage({
        type: "success",
        text: payload?.message || "SOW uploaded and parsed successfully",
      });
      await fetchProjectSow(selectedProject.ProjectId);
    } catch (error: any) {
      setProjectSowMessage({
        type: "error",
        text: error?.message || "Failed to upload and parse Statement of Work",
      });
    } finally {
      setProjectSowUploadLoading(false);
    }
  };

  const handleDownloadSow = async () => {
    if (!projectSow?.SOWId) return;
    try {
      const res = await fetch(`/api/sow/download/${projectSow.SOWId}`);
      if (!res.ok) throw new Error("Failed to download SOW");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = projectSow.FileName || `SOW-${projectSow.SOWId}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      setProjectSowMessage({ type: "error", text: error?.message || "Failed to download SOW" });
    }
  };

  const handleOpenSowDetails = async (sowId?: number | null) => {
    const finalSowId = sowId ?? projectSow?.SOWId;
    if (!finalSowId) return;
    try {
      setProjectSowDetailsLoading(true);
      setProjectSowMessage(null);
      const res = await fetch(`/api/sow/details/${finalSowId}`);
      if (!res.ok) throw new Error("Failed to fetch SOW details");
      const data = await res.json();
      setProjectSowDetails(data as ProjectSowDetails);
      setProjectSowDetailsTab("overview");
      setProjectSowDetailsSearch("");
      setProjectSowSelectedResourceKey(null);
      setShowProjectSowDetails(true);
    } catch (error: any) {
      setProjectSowMessage({ type: "error", text: error?.message || "Failed to load SOW details" });
    } finally {
      setProjectSowDetailsLoading(false);
    }
  };

  const fetchCustomerSows = async () => {
    if (!effectiveLeadId) return;
    try {
      setCustomerSowsLoading(true);
      const res = await fetch(`/api/sow/customer/${Number(effectiveLeadId)}`);
      if (!res.ok) throw new Error("Failed to fetch customer SOWs");
      const data = await res.json();
      setCustomerSows(Array.isArray(data?.sows) ? (data.sows as CustomerSowSummary[]) : []);
    } catch (error: any) {
      setCustomerSowMessage({
        type: "error",
        text: error?.message || "Failed to fetch customer SOWs",
      });
      setCustomerSows([]);
    } finally {
      setCustomerSowsLoading(false);
    }
  };

  const triggerCustomerSowUpload = () => {
    if (customerSowUploadLoading) return;
    setCustomerSowMessage(null);
    customerSowFileInputRef.current?.click();
  };

  const handleCustomerSowFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !effectiveLeadId) return;
    if (!/\.docx$/i.test(file.name || "")) {
      setCustomerSowMessage({ type: "error", text: "Unsupported file type. Please upload a .docx file only." });
      return;
    }

    try {
      setCustomerSowUploadLoading(true);
      setCustomerSowMessage(null);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("customerName", String(lead?.CompanyName || ""));

      const res = await fetch("/api/sow/upload", {
        method: "POST",
        body: formData,
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "SOW upload failed");
      }

      setCustomerSowMessage({
        type: "success",
        text: payload?.message || "SOW uploaded and parsed successfully",
      });
      await fetchCustomerSows();
    } catch (error: any) {
      setCustomerSowMessage({
        type: "error",
        text: error?.message || "Failed to upload and parse SOW",
      });
    } finally {
      setCustomerSowUploadLoading(false);
    }
  };

  const downloadSowById = async (sowId: number, fileName?: string | null) => {
    const res = await fetch(`/api/sow/download/${sowId}`);
    if (!res.ok) throw new Error("Failed to download SOW");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName || `SOW-${sowId}.docx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleCustomerDownloadSow = async (sow: CustomerSowSummary) => {
    try {
      await downloadSowById(sow.SOWId, sow.FileName);
    } catch (error: any) {
      setCustomerSowMessage({ type: "error", text: error?.message || "Failed to download SOW" });
    }
  };

  const handleOpenCustomerSowDetails = async (sowId: number) => {
    try {
      await handleOpenSowDetails(sowId);
    } catch (error: any) {
      setCustomerSowMessage({ type: "error", text: error?.message || "Failed to load SOW details" });
    }
  };

  const buildCustomerSowEditDraft = (details: ProjectSowDetails): CustomerSowEditDraft => {
    return {
      SOWId: Number(details.SOWId),
      SOWName: toInputText(details.SOWName),
      Client: toInputText(details.Client),
      Status: toInputText(details.Status || "Active"),
      EffectiveDate: toInputDate(details.EffectiveDate || null),
      StartDate: toInputDate(details.StartDate || null),
      EndDate: toInputDate(details.EndDate || null),
      ParseStatus: toInputText(details.ParseStatus || ""),
      ParseMessage: toInputText(details.ParseMessage || ""),
      Positions: (details.Positions || []).map((position, idx) => ({
        SOWPositionId: position.SOWPositionId,
        PositionNumber: Number(position.PositionNumber || idx + 1),
        Role: toInputText(position.Role),
        StartDate: toInputDate(position.StartDate || null),
        EndDate: toInputDate(position.EndDate || null),
        expanded: true,
        Resources: (position.Resources || []).map((resource) => ({
          SOWPositionResourceId: resource.SOWPositionResourceId,
          Resource: toInputText(resource.Resource),
          ResourceId: toInputText(resource.ResourceId ?? ""),
          EmployeeCode: toInputText(resource.EmployeeCode ?? ""),
          Location: toInputText(resource.Location ?? ""),
          Role: toInputText(position.Role),
          StartDate: toInputDate(resource.StartDate || null),
          EndDate: toInputDate(resource.EndDate || null),
          BusinessHours: toInputText((resource as any).BusinessHours ?? ""),
          BillingStartDate: toInputDate(resource.BillingStartDate || null),
          BillingEndDate: toInputDate(resource.BillingEndDate || null),
          BillingRate: toInputText(resource.BillingRate ?? ""),
          BudgetedHours: toInputText((resource as any).BudgetedHours ?? ""),
          BudgetedFees: toInputText((resource as any).BudgetedFees ?? ""),
          Currency: toInputText(resource.Currency ?? ""),
          RateType: toInputText(resource.RateType ?? ""),
          SOWRate: toInputText(resource.SOWRate ?? ""),
          EndReason: toInputText(resource.EndReason ?? ""),
        })),
      })),
    };
  };

  const handleOpenCustomerSowEdit = async (sowId: number) => {
    try {
      setCustomerSowEditLoading(true);
      setCustomerSowMessage(null);
      const res = await fetch(`/api/sow/details/${sowId}`);
      if (!res.ok) throw new Error("Failed to fetch SOW details");
      const details = (await res.json()) as ProjectSowDetails;
      setCustomerSowEditDraft(buildCustomerSowEditDraft(details));
      setShowCustomerSowEditModal(true);
    } catch (error: any) {
      setCustomerSowMessage({ type: "error", text: error?.message || "Failed to load SOW for edit" });
    } finally {
      setCustomerSowEditLoading(false);
    }
  };

  const handleSaveCustomerSowEdit = async () => {
    if (!customerSowEditDraft?.SOWId) return;

    try {
      setCustomerSowEditSaving(true);

      const payload = {
        SOW: {
          SOWName: customerSowEditDraft.SOWName.trim() || null,
          Client: customerSowEditDraft.Client.trim() || null,
          Status: customerSowEditDraft.Status.trim() || null,
          EffectiveDate: customerSowEditDraft.EffectiveDate || null,
          StartDate: customerSowEditDraft.StartDate || null,
          EndDate: customerSowEditDraft.EndDate || null,
          ParseStatus: customerSowEditDraft.ParseStatus.trim() || null,
          ParseMessage: customerSowEditDraft.ParseMessage.trim() || null,
        },
        Positions: (customerSowEditDraft.Positions || []).map((position, index) => ({
          SOWPositionId: position.SOWPositionId,
          PositionNumber: Number(position.PositionNumber || index + 1),
          Role: String(position.Role || "").trim() || null,
          StartDate: position.StartDate || null,
          EndDate: position.EndDate || null,
          Resources: (position.Resources || []).map((resource) => ({
            SOWPositionResourceId: resource.SOWPositionResourceId,
            Resource: String(resource.Resource || "").trim() || null,
            ResourceId: resource.ResourceId ? Number(resource.ResourceId) : null,
            EmployeeCode: String(resource.EmployeeCode || "").trim() || null,
            Location: String(resource.Location || "").trim() || null,
            StartDate: resource.StartDate || null,
            EndDate: resource.EndDate || null,
            BusinessHours: String(resource.BusinessHours || "").trim() || null,
            BillingStartDate: resource.BillingStartDate || null,
            BillingEndDate: resource.BillingEndDate || null,
            BillingRate: resource.BillingRate ? Number(resource.BillingRate) : null,
            BudgetedHours: resource.BudgetedHours ? Number(resource.BudgetedHours) : null,
            BudgetedFees: resource.BudgetedFees ? Number(resource.BudgetedFees) : null,
            Currency: String(resource.Currency || "").trim() || null,
            RateType: String(resource.RateType || "").trim() || null,
            SOWRate: resource.SOWRate ? Number(resource.SOWRate) : null,
            EndReason: String(resource.EndReason || "").trim() || null,
          })),
        })),
      };

      const res = await fetch(`/api/sow/details/${customerSowEditDraft.SOWId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const saved = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(saved?.error || "Failed to save SOW details");
      }

      setCustomerSowMessage({ type: "success", text: "SOW details updated successfully" });
      setShowCustomerSowEditModal(false);
      setCustomerSowEditDraft(null);
      await fetchCustomerSows();
      if (projectSow?.SOWId === customerSowEditDraft.SOWId && selectedProject?.ProjectId) {
        await fetchProjectSow(selectedProject.ProjectId);
      }
    } catch (error: any) {
      setCustomerSowMessage({ type: "error", text: error?.message || "Failed to save SOW changes" });
    } finally {
      setCustomerSowEditSaving(false);
    }
  };

  const updateCustomerSowDraft = (updater: (draft: CustomerSowEditDraft) => CustomerSowEditDraft) => {
    setCustomerSowEditDraft((prev) => (prev ? updater(prev) : prev));
  };

  const updateCustomerSowPosition = (
    positionIndex: number,
    patch: Partial<SOWPositionDraft>
  ) => {
    updateCustomerSowDraft((draft) => ({
      ...draft,
      Positions: draft.Positions.map((position, idx) =>
        idx === positionIndex ? { ...position, ...patch } : position
      ),
    }));
  };

  const addCustomerSowPosition = () => {
    updateCustomerSowDraft((draft) => ({
      ...draft,
      Positions: [
        ...draft.Positions,
        {
          PositionNumber: draft.Positions.length + 1,
          Role: "",
          StartDate: "",
          EndDate: "",
          expanded: true,
          Resources: [],
        },
      ],
    }));
  };

  const removeCustomerSowPosition = (positionIndex: number) => {
    updateCustomerSowDraft((draft) => ({
      ...draft,
      Positions: draft.Positions
        .filter((_, idx) => idx !== positionIndex)
        .map((position, idx) => ({ ...position, PositionNumber: idx + 1 })),
    }));
  };

  const addCustomerSowResource = (positionIndex: number) => {
    updateCustomerSowDraft((draft) => ({
      ...draft,
      Positions: draft.Positions.map((position, idx) => {
        if (idx !== positionIndex) return position;
        return {
          ...position,
          Resources: [
            ...position.Resources,
            {
              Resource: "",
              ResourceId: "",
              EmployeeCode: "",
              Location: "",
              Role: position.Role,
              StartDate: "",
              EndDate: "",
              BusinessHours: "",
              BillingStartDate: "",
              BillingEndDate: "",
              BillingRate: "",
              BudgetedHours: "",
              BudgetedFees: "",
              Currency: "",
              RateType: "",
              SOWRate: "",
              EndReason: "",
            },
          ],
        };
      }),
    }));
  };

  const updateCustomerSowResource = (
    positionIndex: number,
    resourceIndex: number,
    patch: Partial<SOWResourceDraft>
  ) => {
    updateCustomerSowDraft((draft) => ({
      ...draft,
      Positions: draft.Positions.map((position, idx) => {
        if (idx !== positionIndex) return position;
        return {
          ...position,
          Resources: position.Resources.map((resource, rIdx) =>
            rIdx === resourceIndex ? { ...resource, ...patch } : resource
          ),
        };
      }),
    }));
  };

  const removeCustomerSowResource = (positionIndex: number, resourceIndex: number) => {
    updateCustomerSowDraft((draft) => ({
      ...draft,
      Positions: draft.Positions.map((position, idx) => {
        if (idx !== positionIndex) return position;
        return {
          ...position,
          Resources: position.Resources.filter((_, rIdx) => rIdx !== resourceIndex),
        };
      }),
    }));
  };

  const formatPointsForEditor = (value?: string | null) => {
    const points = toDisplayPoints(value).filter((p) => p !== "Not Available");
    return points.map((p) => `• ${p}`).join("\n");
  };

  const normalizePointsFromEditor = (value?: string | null) => {
    if (!value) return null;
    const cleaned = String(value)
      .split(/\r?\n+/)
      .map((line) => line.replace(/^[\-•\d.)\s]+/, "").trim())
      .filter(Boolean)
      .join("\n");

    return cleaned.length > 0 ? cleaned : null;
  };

  const resetProjectForm = () => {
    setProjectForm({
      ProjectId: null,
      ProjectCode: "",
      ProjectName: "",
      ProjectDesc: "",
      TechStack: "",
      KeyWork: "",
      ValueAdded: "",
      Deliverables: "",
      Challenges: "",
      StartDate: "",
      EndDate: "",
    });
    setIsProjectOngoing(false);
    setProjectContactsInput([]);
    setProjectResourcesInput([]);
  };

  const mapTeamMembersToResourceDrafts = (
    teamMembers?: Array<{
      EmployeeId?: number | string;
      EmployeeName?: string | null;
      Title?: string | null;
      StartDate?: string | null;
      EndDate?: string | null;
      ReportingManager?: string | null;
      ReportingManagerTitle?: string | null;
    }>
  ): ProjectResourceDraft[] => {
    if (!Array.isArray(teamMembers)) return [];

    return teamMembers
      .map((member) => {
        const employeeId =
          member?.EmployeeId === null || member?.EmployeeId === undefined
            ? null
            : String(member.EmployeeId);
        const employeeName = String(member?.EmployeeName ?? "").trim();

        return {
          resourceName: employeeName || employeeId || "",
          employeeId,
          title: String((member as any)?.Title ?? "").trim(),
          startDate: member?.StartDate ? String(member.StartDate).split("T")[0] : "",
          endDate: member?.EndDate ? String(member.EndDate).split("T")[0] : "",
          isCurrent:
            !member?.EndDate ||
            isOngoingValue(String((member as any)?.EndDate ?? "").trim()),
          reportingManager: String((member as any)?.ReportingManager ?? "").trim(),
          reportingManagerTitle: String((member as any)?.ReportingManagerTitle ?? "").trim(),
          suggestions: [],
          showSuggestions: false,
          isSearching: false,
        };
      })
      .filter((resource) => resource.resourceName.length > 0);
  };

  const mapProjectContactsToInput = (
    contacts?: Array<{
      ContactName?: string | null;
      Title?: string | null;
      Email?: string | null;
      Phone?: string | null;
    }>
  ): ProjectContactDraft[] => {
    if (!Array.isArray(contacts)) return [];
    return contacts
      .map((contact) => ({
        contactName: String(contact?.ContactName ?? "").trim(),
        title: String((contact as any)?.Title ?? "").trim(),
        email: String((contact as any)?.Email ?? "").trim(),
        phone: String((contact as any)?.Phone ?? "").trim(),
      }))
      .filter((contact) => contact.contactName.length > 0);
  };

  const updateProjectResourceAt = (
    index: number,
    updater: (prev: ProjectResourceDraft) => ProjectResourceDraft
  ) => {
    setProjectResourcesInput((prev) =>
      prev.map((item, idx) => (idx === index ? updater(item) : item))
    );
  };

  const fetchEmployeeSuggestions = async (index: number, keyword: string) => {
    if (!effectiveLeadId) return;
    const term = keyword.trim();

    if (term.length < 2) {
      updateProjectResourceAt(index, (prev) => ({
        ...prev,
        suggestions: [],
        showSuggestions: false,
        isSearching: false,
      }));
      return;
    }

    updateProjectResourceAt(index, (prev) => ({ ...prev, isSearching: true }));

    try {
      const res = await fetch(
        `/api/employees/leads/${Number(effectiveLeadId)}/projects?employeeSearch=${encodeURIComponent(
          term
        )}`
      );

      if (!res.ok) {
        updateProjectResourceAt(index, (prev) => ({
          ...prev,
          suggestions: [],
          showSuggestions: false,
          isSearching: false,
        }));
        return;
      }

      const data = await res.json();
      const suggestions = Array.isArray(data) ? data : [];

      updateProjectResourceAt(index, (prev) => ({
        ...prev,
        suggestions,
        showSuggestions: suggestions.length > 0,
        isSearching: false,
      }));
    } catch {
      updateProjectResourceAt(index, (prev) => ({
        ...prev,
        suggestions: [],
        showSuggestions: false,
        isSearching: false,
      }));
    }
  };

  const prefillOpportunityFromProject = async (projectId: number) => {
    if (!effectiveLeadId || mode !== "add") return;

    try {
      const res = await fetch(
        `/api/employees/leads/${Number(effectiveLeadId)}/projects?projectId=${projectId}`
      );

      if (!res.ok) return;

      const projectData: Project = await res.json();
      const prefills = (projectData?.ProjectContacts || [])
        .map((contact) => ({
          FullName: String((contact as any)?.ContactName ?? "").trim(),
          WorkEmail: String((contact as any)?.Email ?? "").trim(),
          JobTitle: String((contact as any)?.Title ?? "").trim(),
          MobilePhone: String((contact as any)?.Phone ?? "").trim(),
        }))
        .filter((contact) => contact.FullName.length > 0)
        .map((contact) => ({
          ...EMPTY_OPP_CONTACT_FORM,
          ...contact,
        }));

      if (prefills.length > 0) {
        setOppContacts(prefills);
        setAutoPrefilledOppContacts(true);
      }
    } catch {
      // no-op
    }
  };

  const openAddProjectForm = () => {
    setProjectFormMode("add");
    resetProjectForm();
    setShowProjectForm(true);
  };

  const openProjectFormById = async (projectId: number) => {
    if (!effectiveLeadId || !projectId) return;

    const res = await fetch(
      `/api/employees/leads/${Number(effectiveLeadId)}/projects?projectId=${projectId}`
    );

    if (!res.ok) {
      throw new Error("Failed to load project details");
    }

    const project: Project = await res.json();
    setProjectFormMode("edit");
    setProjectForm({
      ProjectId: project.ProjectId,
      ProjectCode: project.ProjectCode || "",
      ProjectName: project.ProjectName || "",
      ProjectDesc: project.ProjectDesc || "",
      TechStack: project.TechStack || "",
      KeyWork: formatPointsForEditor(project.KeyWork),
      ValueAdded: formatPointsForEditor(project.ValueAdded),
      Deliverables: formatPointsForEditor(project.Deliverables),
      Challenges: formatPointsForEditor(project.Challenges),
      StartDate: project.StartDate ? String(project.StartDate).split("T")[0] : "",
      EndDate: project.EndDate ? String(project.EndDate).split("T")[0] : "",
    });
    setIsProjectOngoing(!project.EndDate);
    setProjectContactsInput(mapProjectContactsToInput(project.ProjectContacts));
    setProjectResourcesInput(mapTeamMembersToResourceDrafts(project.TeamMembers));
    setShowProjectForm(true);
  };

  const openEditProjectForm = (project: Project) => {
    openProjectFormById(project.ProjectId).catch((error: any) => {
      alert(error?.message || "Failed to load project details");
    });
  };

  const fetchProjectsForLead = async (status: "all" | "active" | "hidden" = projectStatusFilter) => {
    if (!effectiveLeadId) return;
    const res = await fetch(
      `/api/employees/leads/${Number(effectiveLeadId)}/projects?status=${status}`
    );
    if (!res.ok) throw new Error("Failed to refresh projects");
    const projects = await res.json();
    setLead((prev) => (prev ? { ...prev, Projects: projects || [] } : prev));
  };

  const handleSaveProject = async () => {
    if (!effectiveLeadId) return;
    if (!projectForm.ProjectName.trim()) {
      alert("Project Name is required");
      return;
    }

    try {
      setProjectActionLoading(projectForm.ProjectId ?? -1);

      const method = projectFormMode === "add" ? "POST" : "PUT";
      const normalizedProjectContacts = projectContactsInput
        .map((contact) => ({
          contactName: String(contact?.contactName || "").trim(),
          title: String(contact?.title || "").trim() || null,
          email: String(contact?.email || "").trim() || null,
          phone: String(contact?.phone || "").trim() || null,
        }))
        .filter((contact) => contact.contactName.length > 0);
      const normalizedProjectResources = projectResourcesInput
        .map((resource) => ({
          resourceName: String(resource.resourceName || "").trim(),
          employeeId: resource.employeeId,
          title: String(resource.title || "").trim() || null,
          startDate: String(resource.startDate || "").trim() || null,
          endDate: resource.isCurrent ? null : String(resource.endDate || "").trim() || null,
          reportingManager: String(resource.reportingManager || "").trim() || null,
          reportingManagerTitle: String(resource.reportingManagerTitle || "").trim() || null,
        }))
        .filter((resource) => resource.resourceName.length > 0);

      const res = await fetch(`/api/employees/leads/${Number(effectiveLeadId)}/projects`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(projectFormMode === "edit" ? { ProjectId: projectForm.ProjectId } : {}),
          ProjectCode: projectForm.ProjectCode.trim() || null,
          ProjectName: projectForm.ProjectName,
          ProjectDesc: projectForm.ProjectDesc || null,
          TechStack: projectForm.TechStack || null,
          KeyWork: normalizePointsFromEditor(projectForm.KeyWork),
          ValueAdded: normalizePointsFromEditor(projectForm.ValueAdded),
          Deliverables: normalizePointsFromEditor(projectForm.Deliverables),
          Challenges: normalizePointsFromEditor(projectForm.Challenges),
          StartDate: projectForm.StartDate || null,
          EndDate: isProjectOngoing ? null : projectForm.EndDate || null,
          ProjectContacts: normalizedProjectContacts,
          ProjectResources: normalizedProjectResources,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to save project");
      }

      await fetchProjectsForLead(projectStatusFilter);
      setShowProjectForm(false);
      resetProjectForm();
    } catch (error: any) {
      alert(error?.message || "Failed to save project");
    } finally {
      setProjectActionLoading(null);
    }
  };

  const handleToggleProjectHidden = async (project: Project) => {
    if (!effectiveLeadId) return;
    const isHidden = String(project.Status || "").toLowerCase() === "hidden";

    try {
      setProjectActionLoading(project.ProjectId);
      const res = await fetch(`/api/employees/leads/${Number(effectiveLeadId)}/projects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: project.ProjectId,
          IsHidden: !isHidden,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to update project visibility");
      }

      await fetchProjectsForLead(projectStatusFilter);
    } catch (error: any) {
      alert(error?.message || "Failed to update project visibility");
    } finally {
      setProjectActionLoading(null);
    }
  };

  const handleOpenProjectSummary = async (projectId: number) => {
    if (!effectiveLeadId || !projectId) return;

    try {
      setProjectSummaryLoading(true);
      const res = await fetch(
        `/api/employees/leads/${Number(effectiveLeadId)}/projects?projectId=${projectId}`
      );

      if (!res.ok) {
        throw new Error("Failed to fetch project summary");
      }

      const project = await res.json();
      setSelectedProject(project || null);
      await fetchProjectSow(Number(project?.ProjectId || projectId));
      resetProjectSummaryAccordions();
      setShowProjectSummary(true);
    } catch (err) {
      console.error("Failed to load project details:", err);
      alert("Failed to load project details");
    } finally {
      setProjectSummaryLoading(false);
    }
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
          ReminderDate: toSqlDateTime(reminderForm.ReminderDate),
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

  const handleSaveMeeting = async () => {
    if (!meetingForm.subject || !meetingForm.startDateTime || !meetingForm.endDateTime) {
      alert("Please fill all required meeting fields");
      return;
    }

    const leadId = lead?.LeadId;
    if (!leadId) {
      alert("Invalid Lead");
      return;
    }

    try {
      // Filter out empty attendees (both email and name empty)
      const validAttendees = meetingForm.attendees.filter(
        (attendee) => attendee.email.trim() !== "" || attendee.name.trim() !== ""
      );
      if (validAttendees.length === 0) {
        alert("Please add at least one attendee with email or name");
        return;
      }

      const res = await fetch(`/api/employees/leads/${leadId}/meetings/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: meetingForm.subject,
          attendees: validAttendees,
          startDateTime: toSqlDateTime(meetingForm.startDateTime).replace(" ", "T"),
          endDateTime: toSqlDateTime(meetingForm.endDateTime).replace(" ", "T"),
          agenda: meetingForm.agenda,
          location: meetingForm.location,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
          sendEmail: meetingForm.sendEmail,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to schedule meeting");
      }

      const data = await res.json();
      const meetingUrl =
        data?.event?.onlineMeetingUrl ||
        data?.event?.webLink ||
        "Meeting scheduled";

      alert(`Meeting scheduled successfully. Link: ${meetingUrl}`);
      setShowAddMeeting(false);
      resetMeetingForm();
      fetchLeadDetails();
    } catch (err: any) {
      alert(err?.message || "Meeting scheduling failed");
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
          ActivityDate: field === "ActivityDate" ? value : activity.ActivityDate,
          ContactId: field === "ContactId" ? value : (activity.ContactId ?? null),
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
      projectId: oppData.ProjectId ?? "",
      serviceId: oppData.ServiceId,
      statusId: oppData.StatusId,
      probabilityId: oppData.ProbabilityId,
      engagementId: oppData.EngagementId,
      technologies: oppData.TechnologyIds || [],
    });
    setOpportunityProjectSearch(oppData.ProjectName || "");
    setAutoPrefilledOppContacts(false);

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

  const handleSaveOpportunity = async (
    options?: { keepOpen?: boolean; markComplete?: boolean }
  ): Promise<{ OpportunityId: number | null; savedOpportunity: any } | null> => {
    const isEdit = mode === "edit";

    const id = effectiveLeadId ?? leadId;

    if (
      !opportunityForm.serviceId ||
      !opportunityForm.statusId ||
      !opportunityForm.probabilityId ||
      !opportunityForm.engagementId
    ) {
      alert("Please fill all required opportunity fields");
      return null;
    }

    if (!id) {
      alert("Invalid Lead selected");
      return null;
    }

    if (isEdit && !currentOpportunityId) {
      alert("Opportunity ID missing");
      return null;
    }

    if (opportunityForm.technologies.length === 0) {
      alert("Please select at least one Technology");
      return null;
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
        return null;
      }
    }

    // 1 SAVE OPPORTUNITY
    const res = await fetch(`/api/employees/leads/${id}/opportunities`, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isEdit && { OpportunityId: currentOpportunityId }),

        projectId: opportunityForm.projectId,

        serviceId: opportunityForm.serviceId,
        statusId: opportunityForm.statusId,
        probabilityId: opportunityForm.probabilityId,
        engagementId: opportunityForm.engagementId,

        technologies: opportunityForm.technologies,   // keep
        otherTechnologies: otherTechnologyMap,         // keep

        // 🔑 ADD THIS FLAG
        hasOtherTechnology: Object.keys(otherTechnologyMap).length > 0,
        isComplete: options?.markComplete ? 1 : undefined,

        OpportunityContact: buildOppContactSummary(),
      }),

    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to save opportunity");
      return null;
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
                ProjectId: savedOpportunity.ProjectId,
                ProjectName: savedOpportunity.ProjectName,
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

    // 5 RESET & CLOSE OPPORTUNITY MODAL
    if (!options?.keepOpen) {
      setShowAddOpportunity(false);
      setMode("add");
    }

    if (isEdit) {
      await fetchLeadDetails();
    }

    return { OpportunityId, savedOpportunity };
  };

  const handleConvertOpportunityToProject = async () => {
    if (!effectiveLeadId) return;

    const saveResult = await handleSaveOpportunity({ keepOpen: true, markComplete: true });
    if (!saveResult) return;

    let projectId =
      typeof opportunityForm.projectId === "number"
        ? opportunityForm.projectId
        : saveResult.savedOpportunity?.ProjectId ?? null;

    try {
      if (!projectId) {
        setShowAddOpportunity(false);
        setMode("add");
        setOpportunityView("OPPORTUNITY");
        openAddProjectForm();
        return;
      }

      await fetchProjectsForLead(projectStatusFilter);
      await openProjectFormById(Number(projectId));
      setShowAddOpportunity(false);
      setMode("add");
      setOpportunityView("OPPORTUNITY");
    } catch (error: any) {
      alert(error?.message || "Failed to open project form");
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
  const getBackLabel = () => {
    if (origin === "leads") return "← Back to Leads";
    if (origin === "Prospect") return "← Back to Prospects";
    if (origin === "Account") return "← Back to Customers";
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

  const handleConvert = async () => {
    await convertLeadWithExistingFlow({
      leadId: lead?.LeadId,
      origin: finalOrigin === "Prospect" || finalOrigin === "Account"
        ? finalOrigin
        : "leads",
      router,
    });
  };

  const handleConvertToAccount = async () => {
    await convertLeadDirectToAccountWithExistingFlow({
      leadId: lead?.LeadId,
      router,
    });
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
    if ((lead?.AccountTypeId ?? 0) < 30) {
      setCustomerSows([]);
      return;
    }
    fetchCustomerSows();
  }, [effectiveLeadId, lead?.AccountTypeId]);

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
          
          // Fetch projects for this lead
          try {
            const projectsRes = await fetch(
              `/api/employees/leads/${Number(effectiveLeadId)}/projects?status=${projectStatusFilter}`
            );
            if (projectsRes.ok) {
              const projects = await projectsRes.json();
              data.Projects = projects || [];
            }
          } catch (projectErr) {
            console.error("Failed to fetch projects:", projectErr);
            data.Projects = [];
          }
          
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
  }, [effectiveLeadId, origin, projectStatusFilter]);

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
  const isLead = lead?.AccountTypeId === 10;
  const isProspect = lead?.AccountTypeId === 20;
  const isAccount = lead?.AccountTypeId === 30;
  // STYLES


  const container: React.CSSProperties = {
    padding: 18,
    maxWidth: 1100,
    margin: "0 auto",
    fontFamily:
      "'Segoe UI', Roboto, system-ui, -apple-system, 'Helvetica Neue', Arial",
  };

  const headerRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  };

  const topActions: React.CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
  };

  const backBtn: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 6,
    border: "none",
    background: "#F26522",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 600,
    boxShadow: "0 4px 10px rgba(242, 101, 34, 0.25)",
  };

  const primaryBtn: React.CSSProperties = {
    padding: "9px 14px",
    borderRadius: 8,
    border: "none",
    background: "#F26522",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    boxShadow: "0 8px 18px rgba(242, 101, 34, 0.22)",
  };

  const secondaryBtn: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #F26522",
    background: "#fff",
    color: "#F26522",
    cursor: "pointer",
    fontWeight: 600,
  };

  const primaryBtnStyle: React.CSSProperties = {
    ...primaryBtn,
    padding: "7px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    boxShadow: "none",
  };

  const secondaryBtnStyle: React.CSSProperties = {
    ...secondaryBtn,
    padding: "7px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: 20,
    marginBottom: 16,
    alignItems: "stretch",
  };

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.06)",
    flex: 1,
    border: "1px solid #e6edf7",
  };

  const rightCardStyle: React.CSSProperties = {
    ...cardStyle,
    maxWidth: 520,
  };
  const contactCardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 10,
    padding: "16px 18px",
    border: "1px solid #eef1f4",
    boxShadow: "0 6px 14px rgba(15, 23, 42, 0.05)",
    marginBottom: 12,
    borderLeft: "4px solid #F26522",
  };

  const contactAccentStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    paddingLeft: 6,
  };

  const contactRowLabel: React.CSSProperties = {
    fontWeight: 700,
    width: 74,
    flexShrink: 0,
    fontSize: 13,
    color: "#111",
  };

  const contactRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    minWidth: 0,
  };

  const contactValueStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.35,
    color: "#111827",
    overflowWrap: "anywhere",
  };

  const contactLinkStyle: React.CSSProperties = {
    color: "#1F3A68",
    textDecoration: "none",
    overflowWrap: "anywhere",
  };

  const contactFooterStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    paddingTop: 8,
    marginTop: 2,
    borderTop: "1px solid #eef2f7",
  };

  const contactOutreachStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  };

  const contactCheckboxStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    fontWeight: 500,
    color: "#4b5563",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 10,
    color: "#1e293b",
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
    borderRadius: 10,
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)",
    border: "1px solid #e6edf7",
    marginBottom: 16,
    overflow: "hidden",
  };

  const addBtn = {
    backgroundColor: "#F26522",
    color: "white",
    width: 24,
    height: 24,
    borderRadius: 6,
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
    background: "#F26522",
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
    background: "#F26522",
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

  const sowHasValue = (value: any) => {
    if (value === null || value === undefined) return false;
    const text = String(value).trim();
    return !!text && text.toLowerCase() !== "not available";
  };

  const sowResourceRows = (projectSowDetails?.Positions || []).flatMap((position, pIndex) => {
    const resources = position.Resources || [];
    if (resources.length === 0) {
      return [
        {
          key: `pos-${position.SOWPositionId || pIndex}-empty`,
          position,
          resource: null as ProjectSowDetails["Positions"][number]["Resources"][number] | null,
          index: pIndex,
        },
      ];
    }
    return resources.map((resource, rIndex) => ({
      key: `res-${resource.SOWPositionResourceId || `${position.SOWPositionId || pIndex}-${rIndex}`}`,
      position,
      resource,
      index: pIndex,
    }));
  });

  const filteredSowResourceRows = sowResourceRows.filter((row) => {
    const q = projectSowDetailsSearch.trim().toLowerCase();
    if (!q) return true;
    const joined = [
      String(row.position.PositionNumber || ""),
      row.position.Role || "",
      row.resource?.Resource || "",
      row.resource?.EmployeeCode || "",
      row.resource?.Location || "",
      row.resource?.BusinessHours || "",
    ]
      .join(" ")
      .toLowerCase();
    return joined.includes(q);
  });

  const selectedSowResourceRow = filteredSowResourceRows.find(
    (row) => row.key === projectSowSelectedResourceKey
  ) || null;

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
          {/* LEAD (AccountTypeId = 10) */}
          {false && isLead && (
            <div
              ref={dropdownRef}
              style={{ position: "relative", display: "inline-block" }}
            >

              <button
                style={secondaryBtn}
                onClick={() => setShowConvertMenu((prev) => !prev)}
              >
                Convert ▾
              </button>

              {showConvertMenu && (
                <div
                  style={{
                    position: "absolute",
                    top: "110%",
                    right: 0,
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.08)",
                    padding: "6px",
                    minWidth: "180px",
                    zIndex: 100,
                  }}
                >
                  <button
                    onClick={handleConvert}
                    onMouseEnter={() => setHoveredItem("prospect")}
                    onMouseLeave={() => setHoveredItem(null)}
                    style={{
                      ...dropdownItem,
                      backgroundColor: hoveredItem === "prospect" ? "#f1f5f9" : "#fff",
                      color: hoveredItem === "prospect" ? "#1F3A68" : "#333",
                      cursor: "pointer",
                      transform: hoveredItem === "prospect" ? "scale(1.03)" : "scale(1)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Convert to Prospect
                  </button>

                  <button
                    onClick={handleConvertToAccount}
                    onMouseEnter={() => setHoveredItem("account")}
                    onMouseLeave={() => setHoveredItem(null)}
                    style={{
                      ...dropdownItem,
                      backgroundColor: hoveredItem === "account" ? "#f1f5f9" : "#fff",
                      color: hoveredItem === "account" ? "#1F3A68" : "#333",
                      cursor: "pointer",
                      transform: hoveredItem === "account" ? "scale(1.03)" : "scale(1)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Convert to Customer
                  </button>


                </div>
              )}
            </div>
          )}


          {/* PROSPECT (AccountTypeId = 20) */}
          {false && isProspect && (
            <button onClick={handleConvert} style={secondaryBtn}>
              Convert to Customer
            </button>
          )}

          {/* ACCOUNT (AccountTypeId = 30) */}
          {false && isAccount && (
            <button onClick={handleConvert} style={secondaryBtn}>
              Convert to Master Customer
            </button>
          )}

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
                ? formatLocaleDate(lead.LeadDate, undefined, "—")
                : "—"}
            </span>
          </div>

          <div style={{ marginBottom: 8 }}>
            <span style={contactRowLabel}>Status: </span>
            <span
              style={{
                padding: "2px 8px",
                background: "#eef2f7",
                borderRadius: 12,
                color: "#1F3A68",
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
              marginBottom: 10,
            }}
          >
            Contacts
          </div>

          {/* Search box */}
          <input
            type="text"
            placeholder="Search contacts..."
            value={contactSearch}
            onChange={(e) => {
              setContactSearch(e.target.value);
              setSelectedContactIdx(null);
            }}
            style={{
              width: "100%",
              padding: "7px 10px",
              marginBottom: 10,
              border: "1px solid #d0d7e2",
              borderRadius: 6,
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
              background: "#f8fafd",
            }}
          />

          {/* Scrollable contact list – max 2 cards visible */}
          <div
            style={{
              maxHeight: 310,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {(lead.Contacts || [])
              .map((c, originalIndex) => ({ c, originalIndex }))
              .filter(({ c }) =>
                (c.ContactName || "")
                  .toLowerCase()
                  .includes(contactSearch.toLowerCase())
              )
              .map(({ c, originalIndex }) => {
                const isSelected = selectedContactIdx === originalIndex;
                return (
                  <div
                    key={c.LeadContactID ?? originalIndex}
                    onClick={() =>
                      setSelectedContactIdx(isSelected ? null : originalIndex)
                    }
                    style={{
                      ...contactCardStyle,
                      cursor: "pointer",
                      borderLeft: isSelected
                        ? "4px solid #F26522"
                        : "4px solid #cbd8ea",
                      background: isSelected ? "#fff4ee" : "#fff",
                      boxShadow: isSelected
                        ? "0 0 0 2px rgba(242, 101, 34, 0.25)"
                        : "0 1px 3px rgba(0,0,0,0.06)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={contactAccentStyle}>
                      <div style={contactRowStyle}>
                        <div style={contactRowLabel}>Name:</div>
                        <div style={contactValueStyle}>
                          {c.ContactName || "—"}
                        </div>
                      </div>

                      {c.ContactTitle && (
                        <div style={contactRowStyle}>
                          <div style={contactRowLabel}>Title:</div>
                          <div style={contactValueStyle}>{c.ContactTitle}</div>
                        </div>
                      )}

                      {c.ContactRoleName && (
                        <div style={contactRowStyle}>
                          <div style={contactRowLabel}>Role:</div>
                          <div style={contactValueStyle}>
                            {c.ContactRoleName}
                          </div>
                        </div>
                      )}

                      {c.ContactEmail && (
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 6, gap: 10 }}>
                          <div style={contactRowLabel}>Email:</div>
                          <div style={{ fontSize: 13, color: "#F26522", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <a
                              href={`mailto:${c.ContactEmail}`}
                              title={c.ContactEmail}
                              style={{ color: "inherit", textDecoration: "none" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {c.ContactEmail}
                            </a>
                          </div>
                          <label
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 500, color: "#555", cursor: "pointer", userSelect: "none", marginLeft: 6 }}
                          >
                            <input
                              type="checkbox"
                              checked={!!c.EmailSent}
                              onChange={async (e) => {
                                e.stopPropagation();
                                const newVal = e.target.checked;
                                setLead((prev) => prev ? ({
                                  ...prev,
                                  Contacts: (prev.Contacts || []).map((ct, idx) =>
                                    idx === originalIndex ? { ...ct, EmailSent: newVal } : ct
                                  ),
                                }) : prev);
                                await fetch(
                                  `/api/employees/leads/${lead.LeadId}/contacts/${c.LeadContactID}`,
                                  { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ EmailSent: newVal }) }
                                );
                              }}
                              style={{ accentColor: "#F26522", cursor: "pointer" }}
                            />
                            Email Sent
                          </label>
                        </div>
                      )}

                      {c.ContactPhone && (
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 6, gap: 10 }}>
                          <div style={contactRowLabel}>Phone:</div>
                          <div style={{ fontSize: 13, color: "#F26522", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <a
                              href={`tel:${c.ContactPhone}`}
                              title={c.ContactPhone}
                              style={{ color: "inherit", textDecoration: "none" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {c.ContactPhone}
                            </a>
                          </div>
                        </div>
                      )}

                      {c.LinkedInProfile && (
                        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 6, gap: 10 }}>
                          <div style={contactRowLabel}>LinkedIn:</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: "#F26522", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <a
                                href={`https://${c.LinkedInProfile}`}
                                target="_blank"
                                rel="noreferrer"
                                title={c.LinkedInProfile}
                                style={{ color: "inherit", textDecoration: "none" }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {c.LinkedInProfile}
                              </a>
                            </div>
                            <div style={{ display: "flex", gap: 14 }}>
                              {(
                                [
                                  { key: "LinkedInRequestSent" as const, label: "Request Sent" },
                                  { key: "LinkedInRequestAccepted" as const, label: "Request Accepted" },
                                ]
                              ).map(({ key, label }) => (
                                <label
                                  key={key}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 500, color: "#555", cursor: "pointer", userSelect: "none" }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!c[key]}
                                    onChange={async (e) => {
                                      e.stopPropagation();
                                      const newVal = e.target.checked;
                                      setLead((prev) => prev ? ({
                                        ...prev,
                                        Contacts: (prev.Contacts || []).map((ct, idx) =>
                                          idx === originalIndex ? { ...ct, [key]: newVal } : ct
                                        ),
                                      }) : prev);
                                      await fetch(
                                        `/api/employees/leads/${lead.LeadId}/contacts/${c.LeadContactID}`,
                                        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: newVal }) }
                                      );
                                    }}
                                    style={{ accentColor: "#F26522", cursor: "pointer" }}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Add Activity button – only on selected card */}
                      {isSelected && (
                        <div style={{ marginTop: 8 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openActivityFromContact(originalIndex);
                            }}
                            style={{
                              padding: "5px 14px",
                              fontSize: 12,
                              fontWeight: 600,
                              background: "#F26522",
                              color: "#fff",
                              border: "none",
                              borderRadius: 5,
                              cursor: "pointer",
                            }}
                          >
                            + Add Activity
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

            {/* Empty state */}
            {(lead.Contacts || []).filter((c) =>
              (c.ContactName || "")
                .toLowerCase()
                .includes(contactSearch.toLowerCase())
            ).length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: "#999",
                  fontSize: 13,
                  padding: "20px 0",
                }}
              >
                No contacts found.
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={notesStyle}>
        <strong>Notes:</strong>{" "}
        <span style={{ marginLeft: 8 }}>{lead.LeadNotes || "—"}</span>
      </div>

      {/* Activities */}
      <div
        style={{
          ...sectionTitle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <span>Activities</span>
          <div style={{ display: "flex", gap: "8px", marginLeft: "12px" }}>
            <button style={addBtn} onClick={openActivityFromGlobal}>
              +
            </button>
          </div>
        </div>
        <button style={primaryBtn} onClick={() => setShowAddMeeting(true)}>
          Schedule Meeting
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
              <th style={{ ...thStyle, width: 160 }}>Contact</th>
              <th style={{ ...thStyle, width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(lead.Activities || []).map((a, i) => (
              <tr key={a.ActivityId}>
                {/* Activity Date (editable) */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`act-date-${a.ActivityId}`)}
                >
                  {editingCell === `act-date-${a.ActivityId}` ? (
                    <input
                      autoFocus
                      type="date"
                      style={inputBox}
                      defaultValue={a.ActivityDate ? a.ActivityDate.split("T")[0] : ""}
                      onBlur={(e) => {
                        if (isValueChanged(a.ActivityDate?.split("T")[0], e.target.value)) {
                          autoSaveActivityField(i, "ActivityDate", e.target.value);
                        }
                        setEditingCell(null);
                      }}
                    />
                  ) : (
                    formatDateTime(a.ActivityDate)
                  )}
                </td>

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
                    formatActivityNotesForDisplay(a)
                  )}
                </td>

                {/* Contact */}
                <td
                  style={tdStyle}
                  onClick={() => setEditingCell(`act-contact-${a.ActivityId}`)}
                >
                  {editingCell === `act-contact-${a.ActivityId}` ? (
                    <select
                      autoFocus
                      style={inputBox}
                      defaultValue={
                        a.ContactId !== null && a.ContactId !== undefined
                          ? String(a.ContactId)
                          : ""
                      }
                      onBlur={(e) => {
                        const selectedValue = e.target.value
                          ? Number(e.target.value)
                          : null;
                        
                        if (isValueChanged(a.ContactId ?? null, selectedValue)) {
                          autoSaveActivityField(i, "ContactId", selectedValue);
                        }
                        setEditingCell(null);
                      }}
                      onChange={(e) => {
                        const selectedValue = e.target.value
                          ? Number(e.target.value)
                          : null;

                        if (isValueChanged(a.ContactId ?? null, selectedValue)) {
                          autoSaveActivityField(i, "ContactId", selectedValue);
                        }
                        // Don't setEditingCell(null) here - let onBlur handle closing
                      }}
                    >
                      <option value="">-- Select Contact --</option>
                      {(lead.Contacts || []).map((contact) => (
                        <option
                          key={contact.LeadContactID}
                          value={contact.LeadContactID ?? ""}
                        >
                          {contact.ContactName || "Unnamed contact"}
                        </option>
                      ))}
                    </select>
                  ) : (
                    a.ContactName || "—"
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
        <div style={{ display: "flex", gap: "8px", marginLeft: "12px" }}>
          <button style={addBtn} onClick={() => setShowAddReminder(true)}>
            + 
          </button>
        </div>
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
              <th style={{ ...thStyle, width: 180 }}>Project</th>
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
                <td style={tdStyle}>{o.ProjectName || "-"}</td>
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
                <td colSpan={7} style={tdStyle}>
                  No opportunities
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(lead?.AccountTypeId ?? 0) >= 30 && (
        <>
          <div
            style={{
              ...sectionTitle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 24,
              marginBottom: 10,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>SOWs</span>
              <button
                type="button"
                onClick={() => triggerCustomerSowUpload()}
                disabled={customerSowUploadLoading}
                style={{
                ...primaryBtn,
                padding: "7px 12px",
                fontSize: 13,
                opacity: customerSowUploadLoading ? 0.7 : 1,
              }}
            >
              {customerSowUploadLoading ? "Uploading..." : "+ Add SOW"}
            </button>
          </div>

          {customerSowMessage && (
            <div
              style={{
                marginBottom: 10,
                fontSize: 12,
                fontWeight: 600,
                color: customerSowMessage.type === "success" ? "#166534" : "#b91c1c",
                background: customerSowMessage.type === "success" ? "#dcfce7" : "#fee2e2",
                border: `1px solid ${customerSowMessage.type === "success" ? "#bbf7d0" : "#fecaca"}`,
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              {customerSowMessage.text}
            </div>
          )}

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
                  <th style={{ ...thStyle, width: 220 }}>SOW Name</th>
                  <th style={{ ...thStyle, width: 170 }}>Client</th>
                  <th style={{ ...thStyle, width: 150 }}>Start Date</th>
                  <th style={{ ...thStyle, width: 150 }}>End Date</th>
                  <th style={{ ...thStyle, width: 110 }}>Version</th>
                  <th style={{ ...thStyle, width: 130 }}>Status</th>
                  <th style={{ ...thStyle, width: 210 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customerSowsLoading ? (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
                      Loading SOWs...
                    </td>
                  </tr>
                ) : customerSows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
                      No SOWs found for this customer.
                    </td>
                  </tr>
                ) : (
                  customerSows.map((sow) => (
                    <tr key={`customer-sow-${sow.SOWId}`}>
                      <td style={tdStyle}>{toDisplayValue(sow.SOWName)}</td>
                      <td style={tdStyle}>{toDisplayValue(sow.Client)}</td>
                      <td style={tdStyle}>{formatSowDate(sow.StartDate || null)}</td>
                      <td style={tdStyle}>{sow.EndDate ? formatSowDate(sow.EndDate) : "Ongoing"}</td>
                      <td style={tdStyle}>v{Number(sow.VersionNo || 1)}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 600,
                            backgroundColor: sow.IsCurrent ? "#dbeafe" : "#f3f4f6",
                            color: sow.IsCurrent ? "#1d4ed8" : "#374151",
                          }}
                        >
                          {toDisplayValue(sow.Status || (sow.IsCurrent ? "Current" : "Historical"))}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                          <button
                            type="button"
                            onClick={() => handleOpenCustomerSowDetails(sow.SOWId)}
                            style={secondaryBtnStyle}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenCustomerSowEdit(sow.SOWId)}
                            disabled={customerSowEditLoading}
                            style={secondaryBtnStyle}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCustomerDownloadSow(sow)}
                            style={secondaryBtnStyle}
                          >
                            Download
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <input
            ref={customerSowFileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: "none" }}
            onChange={handleCustomerSowFileChange}
          />
        </>
      )}

      {/* Projects Section - Only for Customers (AccountTypeId >= 30) */}
      {(lead?.AccountTypeId ?? 0) >= 30 && (
        <>
          <div
            style={{
              ...sectionTitle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 24,
              marginBottom: 10,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>Projects</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={projectStatusFilter}
                onChange={(e) => setProjectStatusFilter(e.target.value as "all" | "active" | "hidden")}
                style={{
                  ...inputBox,
                  width: 140,
                  height: 34,
                  fontSize: 13,
                  padding: "4px 10px",
                }}
              >
                <option value="active">Active</option>
                <option value="hidden">Hidden</option>
                <option value="all">All</option>
              </select>

              <button
                type="button"
                onClick={openAddProjectForm}
                style={{
                  ...primaryBtn,
                  padding: "7px 12px",
                  fontSize: 13,
                }}
              >
                + Add Project
              </button>
            </div>
          </div>

          {/* Project Search */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <span
                style={{
                  position: "absolute",
                  left: "12px",
                  color: "#94a3b8",
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Search size={14} />
              </span>
              <input
                type="text"
                placeholder="Search projects by name..."
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                style={{
                  ...inputBox,
                  width: "100%",
                  maxWidth: 400,
                  padding: "10px 12px 10px 36px",
                  fontSize: "14px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  background: "#f8fafc",
                }}
              />
            </div>
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
                  <th style={{ ...thStyle, width: 250 }}>Project Name</th>
                  {/* <th style={{ ...thStyle, width: 200 }}>Company Name</th> */}
                  <th style={{ ...thStyle, width: 150 }}>Start Date</th>
                  <th style={{ ...thStyle, width: 150 }}>End Date</th>
                  <th style={{ ...thStyle, width: 120 }}>Status</th>
                  <th style={{ ...thStyle, width: 180 }}>Actions</th>
                </tr>
              </thead>

              <tbody>
                {(() => {
                  const filteredProjects = (lead.Projects || [])
                    .filter((p) =>
                      (p.ProjectName || "")
                        .toLowerCase()
                        .includes(projectSearch.toLowerCase())
                    )
                    .sort((a, b) => {
                      return (a.ProjectName || "").localeCompare(b.ProjectName || "");
                    });

                  return filteredProjects.length > 0 ? (
                    filteredProjects.map((p) => (
                      <tr
                        key={p.ProjectId}
                        style={{ cursor: "pointer" }}
                        onClick={() => handleOpenProjectSummary(p.ProjectId)}
                      >
                        <td style={{ ...tdStyle, color: "#1F3A68", fontWeight: 600 }}>
                          {p.ProjectName}
                        </td>
                        {/* <td style={tdStyle}>{p.CompanyName}</td> */}
                        <td style={tdStyle}>{getProjectStartDateDisplay(p)}</td>
                        <td style={tdStyle}>{getProjectEndDateDisplay(p)}</td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: 12,
                              fontSize: 12,
                              fontWeight: 600,
                              backgroundColor: p.Status?.toLowerCase() === "active" ? "#d1fae5" : "#f3f4f6",
                              color: p.Status?.toLowerCase() === "active" ? "#065f46" : "#374151",
                            }}
                          >
                            {p.Status || "Active"}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                            <button
                              type="button"
                              onClick={() => openEditProjectForm(p)}
                              style={{
                                border: "1px solid rgba(31, 58, 104, 0.28)",
                                background: "#eef2f7",
                                color: "#1F3A68",
                                borderRadius: 6,
                                padding: "4px 9px",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#999" }}>
                        {(lead.Projects || []).length === 0 ? "No projects found" : "No matching projects"}
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>

          {projectSummaryLoading && (
            <div
              style={{
                marginTop: 12,
                color: "#475569",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Loading project summary...
            </div>
          )}

          {showProjectSummary && selectedProject && typeof window !== "undefined" &&
            createPortal(
              <div
                style={{
                  ...modalOverlay,
                  zIndex: 10001,
                  alignItems: "flex-start",
                  paddingTop: 84,
                  backdropFilter: "blur(4px)",
                  WebkitBackdropFilter: "blur(4px)",
                }}
                onClick={() => {
                  setShowProjectSummary(false);
                  resetProjectSowState();
                }}
              >
                <div
                  style={{
                    background: "#f8fafc",
                    width: "min(1200px, 78vw)",
                    maxHeight: "85vh",
                    borderRadius: 12,
                    overflowY: "auto",
                    border: "1px solid rgba(31, 58, 104, 0.22)",
                    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.22)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                <div
                  style={{
                    background: "#1F3A68",
                    color: "#fff",
                    padding: "12px 18px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    position: "sticky",
                    top: 0,
                    zIndex: 3,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 700 }}>
                      {toDisplayValue(selectedProject.ProjectName)}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.95, marginTop: 4 }}>
                      Customer: {toDisplayValue(lead?.CompanyName)} • Status: {toDisplayValue(selectedProject.Status || "Active")} • Start: {getProjectStartDateDisplay()} • End: {getProjectEndDateDisplay()}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => {
                        setShowProjectSummary(false);
                        resetProjectSowState();
                      }}
                      
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#fff",
                        fontSize: 24,
                        cursor: "pointer",
                        lineHeight: 1,
                      }}
                      aria-label="Close project summary"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    padding: 14,
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  <section
                    style={{
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "10px 12px",
                      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",
                      gridColumn: "1 / -1",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                      Project Description
                    </div>
                    <div style={{ marginTop: 6, color: "#0f172a", lineHeight: 1.5 }}>
                      {toDisplayValue(selectedProject.ProjectDesc)}
                    </div>
                  </section>

                  <section
                    style={{
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "10px 12px",
                      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",
                      gridColumn: "1 / -1",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                        Statement of Work
                      </div>
                      {(projectSowLoading || projectSowUploadLoading) && (
                        <div style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>
                          {projectSowUploadLoading ? "Uploading & Parsing..." : "Loading..."}
                        </div>
                      )}
                    </div>

                    {projectSowMessage && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          color: projectSowMessage.type === "success" ? "#166534" : "#b91c1c",
                          background: projectSowMessage.type === "success" ? "#dcfce7" : "#fee2e2",
                          border: `1px solid ${projectSowMessage.type === "success" ? "#bbf7d0" : "#fecaca"}`,
                          borderRadius: 6,
                          padding: "6px 8px",
                        }}
                      >
                        {projectSowMessage.text}
                      </div>
                    )}

                    {!projectSow && !projectSowLoading ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ color: "#64748b", fontSize: 13 }}>No Statement of Work uploaded.</div>
                        <button
                          type="button"
                          onClick={() => triggerSowUpload()}
                          disabled={projectSowUploadLoading}
                          style={{
                            marginTop: 8,
                            border: "1px solid #F26522",
                            color: "#F26522",
                            background: "#fff",
                            borderRadius: 6,
                            padding: "7px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: projectSowUploadLoading ? "not-allowed" : "pointer",
                            opacity: projectSowUploadLoading ? 0.6 : 1,
                          }}
                        >
                          Upload SOW
                        </button>
                      </div>
                    ) : projectSow ? (
                      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>SOW File Name:</strong> {toDisplayValue(projectSow.FileName)}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>Client:</strong> {toDisplayValue(projectSow.Client)}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>Duration:</strong> {formatSowDuration(projectSow)}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>Version:</strong> v{Number(projectSow.VersionNo || 1)}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>Positions:</strong> {projectSow.NumberOfPositions ?? 0}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>Resources:</strong> {projectSow.NumberOfResources ?? 0}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>Uploaded On:</strong> {formatSowDate(projectSow.UploadedOn || null)}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}><strong>Status:</strong> {toDisplayValue(projectSow.Status || projectSow.ParseStatus || "Active")}</div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                          <button
                            type="button"
                            onClick={() => handleOpenSowDetails()}
                            disabled={projectSowDetailsLoading}
                            style={secondaryBtnStyle}
                          >
                            {projectSowDetailsLoading ? "Loading..." : "View Details"}
                          </button>
                          <button type="button" onClick={handleDownloadSow} style={secondaryBtnStyle}>
                            Download
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <input
                      ref={sowFileInputRef}
                      type="file"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      style={{ display: "none" }}
                      onChange={handleSowFileChange}
                    />
                  </section>

                  <section
                    style={{
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleProjectSummaryAccordion("techStack")}
                      aria-expanded={projectSummaryAccordions.techStack}
                      style={{
                        width: "100%",
                        border: "none",
                        background: "#fff",
                        padding: "10px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                        Tech Stack
                      </span>
                      <span style={{ color: "#64748b", fontSize: 13 }}>
                        {projectSummaryAccordions.techStack ? "▲" : "▼"}
                      </span>
                    </button>

                    {projectSummaryAccordions.techStack && (
                      <div style={{ marginTop: -2, padding: "0 12px 10px", color: "#0f172a", lineHeight: 1.5 }}>
                        {toDisplayValue(selectedProject.TechStack)}
                      </div>
                    )}
                  </section>

                  <section
                    style={{
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "10px 12px",
                      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                        Project Contact
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#475569",
                          fontWeight: 600,
                          background: "#f1f5f9",
                          border: "1px solid #e2e8f0",
                          borderRadius: 999,
                          padding: "2px 10px",
                        }}
                      >
                        {getProjectContacts().length} Contact{getProjectContacts().length === 1 ? "" : "s"}
                      </div>
                    </div>

                    {getProjectContacts().length > 0 ? (
                      <div style={{ marginTop: 8, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                              <tr style={{ background: "#f8fafc" }}>
                                <th style={oppTh}>Contact Name</th>
                                <th style={oppTh}>Title</th>
                                <th style={oppTh}>Email</th>
                                <th style={oppTh}>Phone</th>
                              </tr>
                            </thead>
                            <tbody>
                              {getProjectContacts().map((contact, index) => (
                                <tr key={`${contact.ContactId ?? "contact"}-${index}`}>
                                  <td style={oppTd}>{toDisplayValue(contact.ContactName)}</td>
                                  <td style={oppTd}>{toDisplayValue((contact as any).Title || (contact as any).ContactTitle)}</td>
                                  <td style={oppTd}>{toDisplayValue((contact as any).Email || (contact as any).ContactEmail)}</td>
                                  <td style={oppTd}>{toDisplayValue((contact as any).Phone || (contact as any).ContactPhone)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
                        No project contacts added.
                      </div>
                    )}
                  </section>

                  {[{
                    title: "Old Project Team Members",
                    members: oldProjectTeamMembers,
                  }, {
                    title: "New Project Team Members",
                    members: newProjectTeamMembers,
                  }].map((group) => (
                    <section
                      key={group.title}
                      style={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        padding: "10px 12px",
                        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",
                        gridColumn: "span 1",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                          {group.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#475569",
                            fontWeight: 600,
                            background: "#f1f5f9",
                            border: "1px solid #e2e8f0",
                            borderRadius: 999,
                            padding: "2px 10px",
                          }}
                        >
                          {group.members.length} Member{group.members.length === 1 ? "" : "s"}
                        </div>
                      </div>

                      {group.members.length > 0 ? (
                        <div style={{ marginTop: 8, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                              <thead>
                                <tr style={{ background: "#f8fafc" }}>
                                  <th style={oppTh}>Name</th>
                                  <th style={oppTh}>Title</th>
                                  <th style={oppTh}>Start Date</th>
                                  <th style={oppTh}>End Date</th>
                                  <th style={oppTh}>Reporting Manager</th>
                                  <th style={oppTh}>Reporting Manager Title</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.members.map((member: any, index) => (
                                  <tr key={`${member.EmployeeId ?? group.title}-${index}`}>
                                    <td style={oppTd}>
                                      {toDisplayValue(getMemberField(member, ["EmployeeName", "Name"]))}
                                    </td>
                                    <td style={oppTd}>
                                      {toDisplayValue(getMemberField(member, ["Title", "EmployeeTitle", "Role"]))}
                                    </td>
                                    <td style={oppTd}>
                                      {formatMemberDate(getMemberField(member, ["StartDate", "startDate", "AllocationStartDate"]), "—")}
                                    </td>
                                    <td style={oppTd}>
                                      {formatMemberDate(getMemberField(member, ["EndDate", "endDate", "AllocationEndDate"]))}
                                    </td>
                                    <td style={oppTd}>
                                      {toDisplayValue(getMemberField(member, ["ReportingManager", "ManagerName"]))}
                                    </td>
                                    <td style={oppTd}>
                                      {toDisplayValue(
                                        getMemberField(member, ["ReportingManagerTitle", "ManagerTitle"])
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
                          No members available.
                        </div>
                      )}
                    </section>
                  ))}

                  {([
                    {
                      title: "Key Work",
                      body: toDisplayPoints(selectedProject.KeyWork),
                      Icon: Wrench,
                      keyName: "keyWork" as const,
                    },
                    {
                      title: "Value Added",
                      body: toDisplayPoints(selectedProject.ValueAdded),
                      Icon: Star,
                      keyName: "valueAdded" as const,
                    },
                    {
                      title: "Deliverables",
                      body: toDisplayPoints(selectedProject.Deliverables),
                      Icon: Package,
                      keyName: "deliverables" as const,
                    },
                    {
                      title: "Challenges",
                      body: toDisplayPoints(selectedProject.Challenges),
                      Icon: AlertTriangle,
                      keyName: "challenges" as const,
                    },
                  ] as Array<{
                    title: string;
                    body: string[];
                    Icon: any;
                    keyName: "keyWork" | "valueAdded" | "deliverables" | "challenges";
                  }>).map(({ title, body, Icon, keyName }) => (
                    <section
                      key={title}
                      style={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleProjectSummaryAccordion(keyName)}
                        aria-expanded={projectSummaryAccordions[keyName]}
                        style={{
                          width: "100%",
                          border: "none",
                          background: "#fff",
                          padding: "10px 12px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon size={14} />
                          <span>{title}</span>
                        </span>
                        <span style={{ color: "#64748b", fontSize: 13 }}>
                          {projectSummaryAccordions[keyName] ? "▲" : "▼"}
                        </span>
                      </button>

                      {projectSummaryAccordions[keyName] && Array.isArray(body) && (
                        <ul style={{ marginTop: -2, marginBottom: 10, paddingLeft: 32, paddingRight: 12, color: "#0f172a", lineHeight: 1.6 }}>
                          {body.map((point, index) => (
                            <li key={`${title}-${index}`}>{point}</li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}

                  <section
                    style={{
                      gridColumn: "1 / -1",
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <button
                      onClick={() => {
                        setShowProjectSummary(false);
                        resetProjectSowState();
                      }}
                      style={{
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        color: "#0f172a",
                        borderRadius: 6,
                        padding: "7px 12px",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Close
                    </button>
                  </section>
                </div>
                </div>
              </div>,
              document.body
            )}

          {showProjectSowDetails && projectSowDetails && typeof window !== "undefined" &&
            createPortal(
              <div
                style={{ ...modalOverlay, zIndex: 10003, backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}
                onClick={() => {
                  setShowProjectSowDetails(false);
                  setProjectSowSelectedResourceKey(null);
                  setProjectSowDetailsSearch("");
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    width: "min(1220px, 97vw)",
                    maxHeight: "90vh",
                    borderRadius: 12,
                    border: "1px solid rgba(31, 58, 104, 0.22)",
                    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.22)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    style={{
                      ...modalHeader,
                      position: "sticky",
                      top: 0,
                      zIndex: 3,
                      background: "linear-gradient(90deg, #1F3A68 0%, #2f4d82 60%, #3f5f96 100%)",
                      padding: "14px 16px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 2 }}>
                        <div style={{ fontSize: 17, fontWeight: 700 }}>Statement of Work Details</div>
                        <div style={{ fontSize: 12, opacity: 0.95 }}>
                          {toDisplayValue(projectSowDetails.SOWName)} • {toDisplayValue(projectSowDetails.Client)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setShowProjectSowDetails(false);
                            triggerSowUpload();
                          }}
                          disabled={projectSowUploadLoading}
                          style={primaryBtnStyle}
                        >
                          {projectSowUploadLoading ? "Uploading..." : "Upload New SOW"}
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadSowById(Number(projectSowDetails.SOWId), projectSowDetails.FileName || null)}
                          style={secondaryBtnStyle}
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowProjectSowDetails(false)}
                          style={{ ...secondaryBtnStyle, borderColor: "#ffffff66", color: "#fff", background: "transparent" }}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {([
                      { key: "overview", label: "Overview" },
                      { key: "positions", label: "Positions & Resources" },
                    ] as Array<{ key: "overview" | "positions"; label: string }>).map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setProjectSowDetailsTab(tab.key)}
                        style={{
                          border: "1px solid #d3dbe7",
                          background: projectSowDetailsTab === tab.key ? "#1F3A68" : "#fff",
                          color: projectSowDetailsTab === tab.key ? "#fff" : "#334155",
                          borderRadius: 999,
                          padding: "7px 14px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ padding: 14, display: "grid", gap: 12, overflowY: "auto" }}>
                    {projectSowDetailsTab === "overview" && (
                      <>
                        <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fff" }}>
                          <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
                            Snapshot
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                            {[
                              { label: "Positions", value: String(Number(projectSowDetails.NumberOfPositions || 0)) },
                              { label: "Resources", value: String(Number(projectSowDetails.NumberOfResources || 0)) },
                              { label: "Status", value: projectSowDetails.Status || "Active" },
                              { label: "Duration", value: formatSowDuration(projectSowDetails) },
                            ].map((item) => (
                              <div key={item.label} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#f8fafc" }}>
                                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>{item.label}</div>
                                <div style={{ marginTop: 2, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{item.value}</div>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fff" }}>
                          <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
                            SOW Information
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                            {[
                              { label: "SOW Name", value: projectSowDetails.SOWName },
                              { label: "Client", value: projectSowDetails.Client },
                              { label: "Effective Date", value: projectSowDetails.EffectiveDate ? formatSowDate(projectSowDetails.EffectiveDate) : null },
                              { label: "Start Date", value: projectSowDetails.StartDate ? formatSowDate(projectSowDetails.StartDate) : null },
                              { label: "End Date", value: projectSowDetails.EndDate ? formatSowDate(projectSowDetails.EndDate) : "Ongoing" },
                              { label: "Uploaded On", value: projectSowDetails.UploadedOn ? formatSowDate(projectSowDetails.UploadedOn) : null },
                              { label: "Document Name", value: projectSowDetails.FileName || null },
                              { label: "Parse Status", value: projectSowDetails.ParseStatus || null },
                            ]
                              .filter((item) => sowHasValue(item.value))
                              .map((item) => (
                                <div key={item.label} style={{ border: "1px dashed #d3dbe7", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
                                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>{item.label}</div>
                                  <div style={{ marginTop: 2, fontSize: 13, color: "#0f172a", wordBreak: "break-word" }}>{String(item.value)}</div>
                                </div>
                              ))}
                          </div>
                          {sowHasValue(projectSowDetails.ParseMessage) && (
                            <div style={{ marginTop: 10, border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 8, padding: "8px 10px", color: "#1e3a8a", fontSize: 12 }}>
                              {projectSowDetails.ParseMessage}
                            </div>
                          )}
                        </section>
                      </>
                    )}

                    {projectSowDetailsTab === "positions" && (
                      <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                            Resourcing Plan
                          </div>
                          <div style={{ position: "relative", width: "min(380px, 100%)" }}>
                            <span style={{ position: "absolute", left: 10, top: 9, color: "#94a3b8", pointerEvents: "none", display: "inline-flex" }}>
                              <Search size={14} />
                            </span>
                            <input
                              value={projectSowDetailsSearch}
                              onChange={(e) => setProjectSowDetailsSearch(e.target.value)}
                              placeholder="Search role, resource, code, location..."
                              style={{ ...inputBox, width: "100%", paddingLeft: 30, height: 32, background: "#f8fafc" }}
                            />
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: 10,
                            display: "grid",
                            gridTemplateColumns: selectedSowResourceRow ? "1fr 330px" : "1fr",
                            gap: 10,
                            alignItems: "start",
                          }}
                        >
                          <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                            <div style={{ maxHeight: "54vh", overflow: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                  <tr style={{ background: "#f8fafc" }}>
                                    <th style={oppTh}>Position #</th>
                                    <th style={oppTh}>Role</th>
                                    <th style={oppTh}>Resource</th>
                                    <th style={oppTh}>Employee Code</th>
                                    <th style={oppTh}>Location</th>
                                    <th style={oppTh}>Duration</th>
                                    <th style={{ ...oppTh, width: 90 }}>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredSowResourceRows.map((row) => (
                                    <tr key={row.key} style={{ background: projectSowSelectedResourceKey === row.key ? "#fff7ed" : "#fff" }}>
                                      <td style={oppTd}>{Number(row.position.PositionNumber || 0)}</td>
                                      <td style={oppTd}>{toDisplayValue(row.position.Role)}</td>
                                      <td style={oppTd}>{row.resource ? toDisplayValue(row.resource.Resource) : "—"}</td>
                                      <td style={oppTd}>{row.resource ? toDisplayValue(row.resource.EmployeeCode || null) : "—"}</td>
                                      <td style={oppTd}>{row.resource ? toDisplayValue(row.resource.Location || null) : "—"}</td>
                                      <td style={oppTd}>
                                        {formatSowDate(row.position.StartDate || null)} - {row.position.EndDate ? formatSowDate(row.position.EndDate) : "Ongoing"}
                                      </td>
                                      <td style={{ ...oppTd, textAlign: "center" }}>
                                        <button
                                          type="button"
                                          onClick={() => setProjectSowSelectedResourceKey(row.key)}
                                          style={secondaryBtnStyle}
                                        >
                                          View
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                  {filteredSowResourceRows.length === 0 && (
                                    <tr>
                                      <td colSpan={7} style={{ ...oppTd, textAlign: "center", color: "#64748b" }}>
                                        No matching rows found.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {selectedSowResourceRow && (
                            <aside style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, background: "#f8fafc", position: "sticky", top: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                                  Resource Details
                                </div>
                                <button type="button" onClick={() => setProjectSowSelectedResourceKey(null)} style={{ ...secondaryBtnStyle, padding: "4px 9px" }}>
                                  Close
                                </button>
                              </div>

                              <div style={{ marginTop: 8, display: "grid", gap: 7 }}>
                                {[
                                  { label: "Position", value: `#${Number(selectedSowResourceRow.position.PositionNumber || 0)}` },
                                  { label: "Role", value: selectedSowResourceRow.position.Role || null },
                                  { label: "Resource", value: selectedSowResourceRow.resource?.Resource || null },
                                  { label: "Employee Code", value: selectedSowResourceRow.resource?.EmployeeCode || null },
                                  { label: "Resource ID", value: selectedSowResourceRow.resource?.ResourceId ?? null },
                                  { label: "Location", value: selectedSowResourceRow.resource?.Location || null },
                                  { label: "Business Hours", value: selectedSowResourceRow.resource?.BusinessHours || null },
                                  { label: "Start Date", value: selectedSowResourceRow.resource?.StartDate ? formatSowDate(selectedSowResourceRow.resource.StartDate) : null },
                                  { label: "End Date", value: selectedSowResourceRow.resource?.EndDate ? formatSowDate(selectedSowResourceRow.resource.EndDate) : null },
                                  { label: "Billing Start", value: selectedSowResourceRow.resource?.BillingStartDate ? formatSowDate(selectedSowResourceRow.resource.BillingStartDate) : null },
                                  { label: "Billing End", value: selectedSowResourceRow.resource?.BillingEndDate ? formatSowDate(selectedSowResourceRow.resource.BillingEndDate) : null },
                                  { label: "Billing Rate", value: selectedSowResourceRow.resource?.BillingRate ?? null },
                                  { label: "Budgeted Hours", value: selectedSowResourceRow.resource?.BudgetedHours ?? null },
                                  { label: "Budgeted Fees", value: selectedSowResourceRow.resource?.BudgetedFees ?? null },
                                  { label: "Currency", value: selectedSowResourceRow.resource?.Currency || null },
                                  { label: "Rate Type", value: selectedSowResourceRow.resource?.RateType || null },
                                  { label: "SOW Rate", value: selectedSowResourceRow.resource?.SOWRate ?? null },
                                  { label: "End Reason", value: selectedSowResourceRow.resource?.EndReason || null },
                                ]
                                  .filter((item) => sowHasValue(item.value))
                                  .map((item) => (
                                    <div key={item.label} style={{ borderBottom: "1px dashed #d3dbe7", paddingBottom: 6 }}>
                                      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>{item.label}</div>
                                      <div style={{ marginTop: 2, fontSize: 13, color: "#0f172a", wordBreak: "break-word" }}>{String(item.value)}</div>
                                    </div>
                                  ))}
                              </div>
                            </aside>
                          )}
                        </div>
                      </section>
                    )}

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => {
                          setShowProjectSowDetails(false);
                          setProjectSowSelectedResourceKey(null);
                          setProjectSowDetailsSearch("");
                        }}
                        style={secondaryBtnStyle}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            )}

          {showCustomerSowEditModal && customerSowEditDraft && typeof window !== "undefined" &&
            createPortal(
              <div style={{ ...modalOverlay, zIndex: 10004 }} onClick={() => setShowCustomerSowEditModal(false)}>
                <div
                  style={{
                    background: "#fff",
                    width: "min(1080px, 97vw)",
                    maxHeight: "90vh",
                    overflowY: "auto",
                    borderRadius: 10,
                    border: "1px solid rgba(31, 58, 104, 0.22)",
                    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.22)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ ...modalHeader, position: "sticky", top: 0, zIndex: 2 }}>Edit SOW</div>
                  <div style={{ padding: 14, display: "grid", gap: 12 }}>
                    <div
                      style={{
                        background: "#fffbeb",
                        border: "1px solid #fde68a",
                        color: "#92400e",
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: 13,
                        lineHeight: 1.4,
                      }}
                    >
                      Edit updates system data only; upload a new SOW document when the source file changes.
                    </div>

                    <section style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>SOW Details</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                        <input style={{ ...inputBox, width: "100%" }} placeholder="SOW Name" value={customerSowEditDraft.SOWName} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, SOWName: e.target.value }))} />
                        <input style={{ ...inputBox, width: "100%" }} placeholder="Client" value={customerSowEditDraft.Client} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, Client: e.target.value }))} />
                        <input style={{ ...inputBox, width: "100%" }} placeholder="Status" value={customerSowEditDraft.Status} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, Status: e.target.value }))} />
                        <input type="date" style={{ ...inputBox, width: "100%" }} value={customerSowEditDraft.EffectiveDate} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, EffectiveDate: e.target.value }))} />
                        <input type="date" style={{ ...inputBox, width: "100%" }} value={customerSowEditDraft.StartDate} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, StartDate: e.target.value }))} />
                        <input type="date" style={{ ...inputBox, width: "100%" }} value={customerSowEditDraft.EndDate} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, EndDate: e.target.value }))} />
                        <input style={{ ...inputBox, width: "100%" }} placeholder="Parse Status" value={customerSowEditDraft.ParseStatus} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, ParseStatus: e.target.value }))} />
                        <input style={{ ...inputBox, width: "100%", gridColumn: "span 2" }} placeholder="Parse Message" value={customerSowEditDraft.ParseMessage} onChange={(e) => updateCustomerSowDraft((d) => ({ ...d, ParseMessage: e.target.value }))} />
                      </div>
                    </section>

                    <section style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Positions & Resources</div>
                        <button type="button" style={secondaryBtnStyle} onClick={addCustomerSowPosition}>+ Add Position</button>
                      </div>

                      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                        {customerSowEditDraft.Positions.map((position, pIdx) => (
                          <div key={`edit-position-${position.SOWPositionId ?? pIdx}`} style={{ border: "1px solid #dbe3ef", borderRadius: 8, padding: 8, background: "#f8fafc" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 140px 140px auto", gap: 8, alignItems: "center" }}>
                              <input type="number" style={{ ...inputBox, width: "100%" }} value={position.PositionNumber} onChange={(e) => updateCustomerSowPosition(pIdx, { PositionNumber: Number(e.target.value || pIdx + 1) })} />
                              <input style={{ ...inputBox, width: "100%" }} placeholder="Role" value={position.Role} onChange={(e) => updateCustomerSowPosition(pIdx, { Role: e.target.value })} />
                              <input type="date" style={{ ...inputBox, width: "100%" }} value={position.StartDate} onChange={(e) => updateCustomerSowPosition(pIdx, { StartDate: e.target.value })} />
                              <input type="date" style={{ ...inputBox, width: "100%" }} value={position.EndDate} onChange={(e) => updateCustomerSowPosition(pIdx, { EndDate: e.target.value })} />
                              <button type="button" style={{ ...cancelBtn, height: 36 }} onClick={() => removeCustomerSowPosition(pIdx)}>Remove</button>
                            </div>

                            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                              {position.Resources.map((resource, rIdx) => (
                                <div key={`edit-resource-${resource.SOWPositionResourceId ?? `${pIdx}-${rIdx}`}`} style={{ border: "1px dashed #cbd5e1", borderRadius: 8, padding: 8, background: "#fff" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Resource Name" value={resource.Resource} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { Resource: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Employee Code" value={resource.EmployeeCode} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { EmployeeCode: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Resource ID" value={resource.ResourceId} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { ResourceId: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Location" value={resource.Location} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { Location: e.target.value })} />
                                    <button type="button" style={{ ...cancelBtn, height: 36 }} onClick={() => removeCustomerSowResource(pIdx, rIdx)}>Remove</button>
                                  </div>

                                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 8 }}>
                                    <input type="date" style={{ ...inputBox, width: "100%" }} value={resource.StartDate} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { StartDate: e.target.value })} />
                                    <input type="date" style={{ ...inputBox, width: "100%" }} value={resource.EndDate} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { EndDate: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Business Hours" value={resource.BusinessHours} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { BusinessHours: e.target.value })} />
                                    <input type="date" style={{ ...inputBox, width: "100%" }} value={resource.BillingStartDate} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { BillingStartDate: e.target.value })} />
                                    <input type="date" style={{ ...inputBox, width: "100%" }} value={resource.BillingEndDate} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { BillingEndDate: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Billing Rate" value={resource.BillingRate} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { BillingRate: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Budgeted Hours" value={resource.BudgetedHours} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { BudgetedHours: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Budgeted Fees" value={resource.BudgetedFees} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { BudgetedFees: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Currency" value={resource.Currency} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { Currency: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="Rate Type" value={resource.RateType} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { RateType: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%" }} placeholder="SOW Rate" value={resource.SOWRate} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { SOWRate: e.target.value })} />
                                    <input style={{ ...inputBox, width: "100%", gridColumn: "span 2" }} placeholder="End Reason" value={resource.EndReason} onChange={(e) => updateCustomerSowResource(pIdx, rIdx, { EndReason: e.target.value })} />
                                  </div>
                                </div>
                              ))}

                              <div>
                                <button type="button" style={secondaryBtnStyle} onClick={() => addCustomerSowResource(pIdx)}>
                                  + Add Resource
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button type="button" style={secondaryBtnStyle} onClick={() => setShowCustomerSowEditModal(false)}>
                        Cancel
                      </button>
                      <button type="button" style={primaryBtnStyle} onClick={handleSaveCustomerSowEdit} disabled={customerSowEditSaving}>
                        {customerSowEditSaving ? "Saving..." : "Save SOW"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            )}

          {showProjectForm && (
            <div style={{ ...modalOverlay, zIndex: 10002 }} onClick={() => setShowProjectForm(false)}>
              <div
                style={{
                  background: "#fff",
                  width: "min(760px, 94vw)",
                  maxHeight: "86vh",
                  overflowY: "auto",
                  borderRadius: 10,
                  border: "1px solid rgba(31, 58, 104, 0.22)",
                  boxShadow: "0 18px 45px rgba(15, 23, 42, 0.22)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ ...modalHeader, position: "sticky", top: 0, zIndex: 2 }}>
                  {projectFormMode === "add" ? "Add Project" : "Edit Project"}
                </div>

                  <div style={{ padding: 14, display: "grid", gap: 10 }}>
                  <input
                    style={{ ...inputBox, width: "100%" }}
                    placeholder="Project Code"
                    value={projectForm.ProjectCode}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, ProjectCode: e.target.value }))}
                  />
                  <input
                    style={{ ...inputBox, width: "100%" }}
                    placeholder="Project Name*"
                    value={projectForm.ProjectName}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, ProjectName: e.target.value }))}
                  />
                  <textarea
                    style={{ ...inputBox, width: "100%", height: 70, resize: "vertical" }}
                    placeholder="Project Description"
                    value={projectForm.ProjectDesc}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, ProjectDesc: e.target.value }))}
                  />

                  <input
                    style={{ ...inputBox, width: "100%" }}
                    placeholder="Tech Stack"
                    value={projectForm.TechStack}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, TechStack: e.target.value }))}
                  />

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <textarea
                      style={{ ...inputBox, width: "100%", height: 80, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
                      placeholder="Key Work (one line per point)"
                      value={projectForm.KeyWork}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, KeyWork: e.target.value }))}
                    />
                    <textarea
                      style={{ ...inputBox, width: "100%", height: 80, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
                      placeholder="Value Added (one line per point)"
                      value={projectForm.ValueAdded}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, ValueAdded: e.target.value }))}
                    />
                    <textarea
                      style={{ ...inputBox, width: "100%", height: 80, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
                      placeholder="Deliverables (one line per point)"
                      value={projectForm.Deliverables}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, Deliverables: e.target.value }))}
                    />
                    <textarea
                      style={{ ...inputBox, width: "100%", height: 80, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
                      placeholder="Challenges (one line per point)"
                      value={projectForm.Challenges}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, Challenges: e.target.value }))}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={{ ...labelStyle, marginBottom: 4, display: "block" }}>Start Date</label>
                      <input
                        type="date"
                        style={{ ...inputBox, width: "100%" }}
                        value={projectForm.StartDate}
                        onChange={(e) => setProjectForm((prev) => ({ ...prev, StartDate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, marginBottom: 4, display: "block" }}>End Date</label>
                      <input
                        type="date"
                        style={{
                          ...inputBox,
                          width: "100%",
                          background: isProjectOngoing ? "#f1f5f9" : "#fff",
                          color: isProjectOngoing ? "#94a3b8" : "#0f172a",
                          cursor: isProjectOngoing ? "not-allowed" : "text",
                        }}
                        value={projectForm.EndDate}
                        disabled={isProjectOngoing}
                        onChange={(e) => setProjectForm((prev) => ({ ...prev, EndDate: e.target.value }))}
                      />
                    </div>
                  </div>

                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      color: "#334155",
                      fontWeight: 500,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isProjectOngoing}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsProjectOngoing(checked);
                        if (checked) {
                          setProjectForm((prev) => ({ ...prev, EndDate: "" }));
                        }
                      }}
                      style={{ accentColor: "#F26522", cursor: "pointer" }}
                    />
                    Project still going on (Current)
                  </label>

                  <div style={{ marginTop: 8 }}>
                    <label style={{ ...labelStyle, marginBottom: 6, display: "block" }}>
                      Project Contacts
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      {projectContactsInput.map((contact, index) => (
                        <div
                          key={`project-contact-${index}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 1fr 1.5fr 1fr auto",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <input
                            style={{ ...inputBox, width: "100%" }}
                            placeholder={`Contact Name ${index + 1}`}
                            value={contact.contactName}
                            onChange={(e) =>
                              setProjectContactsInput((prev) =>
                                prev.map((item, idx) =>
                                  idx === index
                                    ? { ...item, contactName: e.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <input
                            style={{ ...inputBox, width: "100%" }}
                            placeholder="Title"
                            value={contact.title}
                            onChange={(e) =>
                              setProjectContactsInput((prev) =>
                                prev.map((item, idx) =>
                                  idx === index
                                    ? { ...item, title: e.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <input
                            style={{ ...inputBox, width: "100%" }}
                            placeholder="Email"
                            value={contact.email}
                            onChange={(e) =>
                              setProjectContactsInput((prev) =>
                                prev.map((item, idx) =>
                                  idx === index
                                    ? { ...item, email: e.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <input
                            style={{ ...inputBox, width: "100%" }}
                            placeholder="Phone"
                            value={contact.phone}
                            onChange={(e) =>
                              setProjectContactsInput((prev) =>
                                prev.map((item, idx) =>
                                  idx === index
                                    ? { ...item, phone: e.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <button
                            type="button"
                            style={{ ...cancelBtn, padding: "0 12px", height: 36 }}
                            onClick={() =>
                              setProjectContactsInput((prev) =>
                                prev.filter((_, idx) => idx !== index)
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      style={{ ...secondaryBtn, marginTop: 8, width: "fit-content" }}
                      onClick={() =>
                        setProjectContactsInput((prev) => [
                          ...prev,
                          {
                            contactName: "",
                            title: "",
                            email: "",
                            phone: "",
                          },
                        ])
                      }
                    >
                      + Add Project Contact
                    </button>
                  </div>

                  <div>
                    <label style={{ ...labelStyle, marginBottom: 6, display: "block" }}>
                      Project Resources
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      {projectResourcesInput.map((resource, index) => (
                        <div key={`project-resource-${index}`} style={{ position: "relative" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              style={{ ...inputBox, width: "100%" }}
                              placeholder="Type resource name (employee suggestion supported)"
                              value={resource.resourceName}
                              onChange={(e) => {
                                const value = e.target.value;
                                updateProjectResourceAt(index, (prev) => ({
                                  ...prev,
                                  resourceName: value,
                                  employeeId: null,
                                }));
                                fetchEmployeeSuggestions(index, value);
                              }}
                              onFocus={() => {
                                if (resource.suggestions.length > 0) {
                                  updateProjectResourceAt(index, (prev) => ({
                                    ...prev,
                                    showSuggestions: true,
                                  }));
                                }
                              }}
                            />
                            <button
                              type="button"
                              style={{ ...cancelBtn, padding: "0 12px", height: 36 }}
                              onClick={() =>
                                setProjectResourcesInput((prev) =>
                                  prev.filter((_, idx) => idx !== index)
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
                            <input
                              style={{ ...inputBox, width: "100%" }}
                              placeholder="Title"
                              value={resource.title}
                              onChange={(e) =>
                                updateProjectResourceAt(index, (prev) => ({
                                  ...prev,
                                  title: e.target.value,
                                }))
                              }
                            />
                            <input
                              type="date"
                              style={{ ...inputBox, width: "100%" }}
                              value={resource.startDate}
                              onChange={(e) =>
                                updateProjectResourceAt(index, (prev) => ({
                                  ...prev,
                                  startDate: e.target.value,
                                }))
                              }
                            />
                            <input
                              type="date"
                              style={{
                                ...inputBox,
                                width: "100%",
                                background: resource.isCurrent ? "#f1f5f9" : "#fff",
                                color: resource.isCurrent ? "#94a3b8" : "#0f172a",
                                cursor: resource.isCurrent ? "not-allowed" : "text",
                              }}
                              value={resource.endDate}
                              disabled={resource.isCurrent}
                              onChange={(e) =>
                                updateProjectResourceAt(index, (prev) => ({
                                  ...prev,
                                  endDate: e.target.value,
                                }))
                              }
                            />
                          </div>

                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              marginTop: 8,
                              fontSize: 12,
                              color: "#334155",
                              fontWeight: 500,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={resource.isCurrent}
                              onChange={(e) =>
                                updateProjectResourceAt(index, (prev) => ({
                                  ...prev,
                                  isCurrent: e.target.checked,
                                  endDate: e.target.checked ? "" : prev.endDate,
                                }))
                              }
                              style={{ accentColor: "#F26522", cursor: "pointer" }}
                            />
                            Resource currently assigned (Current)
                          </label>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                            <input
                              style={{ ...inputBox, width: "100%" }}
                              placeholder="Reporting Manager"
                              value={resource.reportingManager}
                              onChange={(e) =>
                                updateProjectResourceAt(index, (prev) => ({
                                  ...prev,
                                  reportingManager: e.target.value,
                                }))
                              }
                            />
                            <input
                              style={{ ...inputBox, width: "100%" }}
                              placeholder="Reporting Manager Title"
                              value={resource.reportingManagerTitle}
                              onChange={(e) =>
                                updateProjectResourceAt(index, (prev) => ({
                                  ...prev,
                                  reportingManagerTitle: e.target.value,
                                }))
                              }
                            />
                          </div>

                          {/* {resource.employeeId && (
                            <div style={{ marginTop: 4, color: "#334155", fontSize: 12 }}>
                              Mapped Employee ID: {resource.employeeId}
                            </div>
                          )} */}

                          {resource.isSearching && (
                            <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                              Searching employees...
                            </div>
                          )}

                          {resource.showSuggestions && resource.suggestions.length > 0 && (
                            <div
                              style={{
                                position: "absolute",
                                top: "calc(100% + 4px)",
                                left: 0,
                                right: 0,
                                background: "#fff",
                                border: "1px solid #cbd5e1",
                                borderRadius: 6,
                                boxShadow: "0 8px 18px rgba(15, 23, 42, 0.14)",
                                zIndex: 5,
                                maxHeight: 190,
                                overflowY: "auto",
                              }}
                            >
                              {resource.suggestions.map((suggestion, sIndex) => (
                                <button
                                  key={`${suggestion.EmployeeId}-${sIndex}`}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updateProjectResourceAt(index, (prev) => ({
                                      ...prev,
                                      resourceName: suggestion.EmployeeName,
                                      employeeId: suggestion.EmployeeId,
                                      showSuggestions: false,
                                    }));
                                  }}
                                  style={{
                                    width: "100%",
                                    border: "none",
                                    textAlign: "left",
                                    background: "#fff",
                                    padding: "8px 10px",
                                    cursor: "pointer",
                                  }}
                                >
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                                    {suggestion.EmployeeName}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#64748b" }}>
                                    ID: {suggestion.EmployeeId}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      style={{ ...secondaryBtn, marginTop: 8, width: "fit-content" }}
                      onClick={() =>
                        setProjectResourcesInput((prev) => [
                          ...prev,
                          {
                            resourceName: "",
                            employeeId: null,
                            title: "",
                            startDate: "",
                            endDate: "",
                            isCurrent: false,
                            reportingManager: "",
                            reportingManagerTitle: "",
                            suggestions: [],
                            showSuggestions: false,
                            isSearching: false,
                          },
                        ])
                      }
                    >
                      + Add Project Resource
                    </button>
                  </div>
                </div>

                <div style={{ ...modalFooter, justifyContent: "flex-end" }}>
                  <button
                    style={cancelBtn}
                    onClick={() => {
                      setShowProjectForm(false);
                      resetProjectForm();
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={saveBtn}
                    onClick={handleSaveProject}
                    disabled={projectActionLoading !== null}
                  >
                    {projectActionLoading !== null ? "Saving..." : projectFormMode === "add" ? "Add Project" : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ADD ACTIVITY MODAL */}
      {showAddActivity && (
        <div style={modalOverlay} onClick={closeActivityModal}>
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
                onClick={closeActivityModal}
              >
                ✕
              </span>
            </div>

            {/* Body */}
            <div style={modalBody}>
              <label style={{ fontWeight: 500 }}>Contact</label>
              {isActivityContactLocked ? (
                <input
                  style={{
                    ...inputBox,
                    width: 480,
                    background: "#f1f5f9",
                    color: "#64748b",
                    cursor: "not-allowed",
                  }}
                  value={selectedActivityContact?.ContactName || "No contact selected"}
                  readOnly
                  disabled
                />
              ) : (
                <div style={{ position: "relative", width: 480, maxWidth: "100%" }}>
                  {showActivityContactDropdown ? (
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <span
  style={{
    position: "absolute",
    left: "8px",
    color: "#94a3b8",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
  }}
>
  <Search size={14} />
</span>
                      <input
                        autoFocus
                        type="text"
                        placeholder="Search..."
                        value={activityContactSearch}
                        onChange={(e) => setActivityContactSearch(e.target.value)}
                        style={{
                          ...inputBox,
                          width: "100%",
                          padding: "6px 8px 6px 32px",
                          fontSize: "13px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 4,
                          background: "#f8fafc",
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={leadContacts.length === 0}
                      onClick={() => {
                        if (leadContacts.length > 0) {
                          setShowActivityContactDropdown(true);
                        }
                      }}
                      style={{
                        ...inputBox,
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        textAlign: "left",
                        background: leadContacts.length === 0 ? "#f1f5f9" : "#fff",
                        color: selectedActivityContact ? "#0f172a" : "#64748b",
                        cursor: leadContacts.length === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {"Search contact"}
                      </span>
                      <span style={{ color: "#64748b", paddingLeft: 10 }}>v</span>
                    </button>
                  )}

                  {showActivityContactDropdown && leadContacts.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: "calc(100% + 4px)",
                        zIndex: 10000,
                        background: "#fff",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        boxShadow: "0 12px 24px rgba(15, 23, 42, 0.16)",
                        padding: 0,
                        display: "flex",
                        flexDirection: "column",
                        maxHeight: "240px",
                      }}
                    >
                      <div
                        style={{
                          maxHeight: "200px",
                          overflowY: "auto",
                          padding: "0px 4px",
                          flex: 1,
                        }}
                      >
                        {filteredActivityContacts.map(({ contact, originalIndex }) => {
                          const isSelected = activityContactIdx === originalIndex;

                          return (
                            <button
                              key={contact.LeadContactID ?? originalIndex}
                              type="button"
                              onClick={() => {
                                setActivityContactIdx(originalIndex);
                                setActivityContactSearch("");
                                setShowActivityContactDropdown(false);
                              }}
                              style={{
                                width: "100%",
                                border: "none",
                                borderRadius: 4,
                                padding: "6px 8px",
                                marginBottom: 0,
                                marginTop: "2px",
                                textAlign: "left",
                                background: isSelected ? "rgba(31, 58, 104, 0.16)" : "transparent",
                                color: "#0f172a",
                                cursor: "pointer",
                                transition: "background-color 0.15s ease",
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.backgroundColor = "#f1f5f9";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.backgroundColor = "transparent";
                                }
                              }}
                            >
                              <div style={{ fontWeight: 500, fontSize: "13px", lineHeight: "1.3" }}>
                                {contact.ContactName || "Unnamed contact"}
                              </div>
                              {(contact.ContactTitle || contact.ContactEmail) && (
                                <div
                                  style={{
                                    color: "#64748b",
                                    fontSize: "12px",
                                    lineHeight: "1.2",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    marginTop: "2px",
                                  }}
                                >
                                  {[contact.ContactTitle, contact.ContactEmail]
                                    .filter(Boolean)
                                    .join(" • ")}
                                </div>
                              )}
                            </button>
                          );
                        })}

                        {filteredActivityContacts.length === 0 && (
                          <div
                            style={{
                              color: "#94a3b8",
                              fontSize: "12px",
                              padding: "12px 8px",
                              textAlign: "center",
                            }}
                          >
                            No matching contacts.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {leadContacts.length === 0 && (
                    <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                      No contacts available. Please add a contact first.
                    </div>
                  )}
                </div>
              )}

              <label style={{ fontWeight: 500 }}>Activity Date*</label>
              <input
                type="date"
                style={{ ...inputBox, width: 480 }}
                value={activityForm.ActivityDate}
                onChange={(e) =>
                  setActivityForm({ ...activityForm, ActivityDate: e.target.value })
                }
              />

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
                {leadStatuses.map((status) => (
                  <option
                    key={status.StatusId}
                    value={status.StatusName}
                    title={status.StatusDesc}
                  >
                    {status.StatusName}
                  </option>
                ))}
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
                onClick={closeActivityModal}
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
              <label>Reminder Date & Time*</label>
              <input
                type="datetime-local"
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

      {/* SCHEDULE MEETING MODAL */}
      {showAddMeeting && (
        <div
          style={modalOverlay}
          onClick={() => {
            setShowAddMeeting(false);
            resetMeetingForm();
          }}
        >
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                ...modalHeader,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Schedule Meeting</span>
              <span
                style={{ cursor: "pointer", fontSize: 22 }}
                onClick={() => {
                  setShowAddMeeting(false);
                  resetMeetingForm();
                }}
              >
                ✕
              </span>
            </div>

            <div style={modalBody}>
              <label>Subject*</label>
              <input
                style={{ ...inputBox, width: 480 }}
                value={meetingForm.subject}
                onChange={(e) =>
                  setMeetingForm({
                    ...meetingForm,
                    subject: e.target.value,
                  })
                }
              />

              <label>Attendees</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {meetingForm.attendees.map((attendee, index) => (
                  <div key={index} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="email"
                      placeholder="Email"
                      style={{ ...inputBox, flex: 1 }}
                      value={attendee.email}
                      onChange={(e) => {
                        const newAttendees = [...meetingForm.attendees];
                        newAttendees[index] = { ...newAttendees[index], email: e.target.value };
                        setMeetingForm({ ...meetingForm, attendees: newAttendees });
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Name"
                      style={{ ...inputBox, flex: 1 }}
                      value={attendee.name}
                      onChange={(e) => {
                        const newAttendees = [...meetingForm.attendees];
                        newAttendees[index] = { ...newAttendees[index], name: e.target.value };
                        setMeetingForm({ ...meetingForm, attendees: newAttendees });
                      }}
                    />
                    {meetingForm.attendees.length > 1 && (
                      <button
                        type="button"
                        style={{
                          background: "#ef4444",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          padding: "6px 10px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                        onClick={() => {
                          const newAttendees = meetingForm.attendees.filter((_, i) => i !== index);
                          setMeetingForm({ ...meetingForm, attendees: newAttendees });
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  style={{
                    background: "#e5e7eb",
                    color: "#374151",
                    border: "none",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    alignSelf: "flex-start",
                  }}
                  onClick={() => {
                    setMeetingForm({
                      ...meetingForm,
                      attendees: [...meetingForm.attendees, { email: "", name: "" }],
                    });
                  }}
                >
                  + Add Attendee
                </button>
              </div>

              <label>Start Date & Time*</label>
              <input
                type="datetime-local"
                style={{ ...inputBox, width: 480 }}
                value={meetingForm.startDateTime}
                onChange={(e) =>
                  setMeetingForm({
                    ...meetingForm,
                    startDateTime: e.target.value,
                  })
                }
              />

              <label>End Date & Time*</label>
              <input
                type="datetime-local"
                style={{ ...inputBox, width: 480 }}
                value={meetingForm.endDateTime}
                onChange={(e) =>
                  setMeetingForm({
                    ...meetingForm,
                    endDateTime: e.target.value,
                  })
                }
              />

              <label>Location</label>
              <input
                style={{ ...inputBox, width: 480 }}
                value={meetingForm.location}
                onChange={(e) =>
                  setMeetingForm({
                    ...meetingForm,
                    location: e.target.value,
                  })
                }
              />

              <label>Agenda</label>
              <textarea
                style={{ ...inputBox, height: 80, width: 480, resize: "none" }}
                value={meetingForm.agenda}
                onChange={(e) =>
                  setMeetingForm({
                    ...meetingForm,
                    agenda: e.target.value,
                  })
                }
              />

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={meetingForm.sendEmail}
                  onChange={(e) =>
                    setMeetingForm({
                      ...meetingForm,
                      sendEmail: e.target.checked,
                    })
                  }
                />
                Send invitation via email
              </label>
            </div>

            <div style={{ ...modalFooter, paddingLeft: 240 }}>
              <button
                style={cancelBtn}
                onClick={() => {
                  setShowAddMeeting(false);
                  resetMeetingForm();
                }}
              >
                Cancel
              </button>
              <button style={saveBtn} onClick={handleSaveMeeting}>
                Schedule
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
                      <label>Project (Optional)</label>
                      {/* <input
                        style={{
                          ...inputBox,
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                        placeholder="Search project by name"
                        value={opportunityProjectSearch}
                        onChange={(e) => setOpportunityProjectSearch(e.target.value)}
                      /> */}
                      <select
                        style={{
                          ...inputBox,
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                        value={opportunityForm.projectId}
                        onChange={async (e) => {
                          const value = e.target.value;
                          const selectedProjectId = value ? Number(value) : "";
                          const selectedProject = (lead?.Projects || []).find(
                            (project) => project.ProjectId === selectedProjectId
                          );

                          setOpportunityForm({
                            ...opportunityForm,
                            projectId: selectedProjectId,
                          });
                          setOpportunityProjectSearch(selectedProject?.ProjectName || "");

                          if (typeof selectedProjectId === "number") {
                            await prefillOpportunityFromProject(selectedProjectId);
                          }
                        }}
                      >
                        <option value="">-- Select Project --</option>
                        {(lead?.Projects || [])
                          .filter(
                            (project) =>
                              String(project.Status || "Active").toLowerCase() !== "hidden"
                          )
                          .filter((project) => {
                            const search = opportunityProjectSearch.trim().toLowerCase();
                            if (!search) return true;
                            return String(project.ProjectName || "")
                              .toLowerCase()
                              .includes(search);
                          })
                          .map((project) => (
                            <option key={project.ProjectId} value={project.ProjectId}>
                              {project.ProjectName}
                            </option>
                          ))}
                      </select>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        Leave empty for new project opportunities. Select a project only when this opportunity belongs to an existing project.
                      </div>
                    </div>

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
                        flexWrap: "wrap",
                      }}
                    >
                      {(() => {
                        const baseOptions =
                          Array.isArray(probabilities) && probabilities.length > 0
                            ? probabilities.map((p) => ({
                              id: Number(p.ProbabilityId),
                              label: String(p.ProbabilityRange || "").trim(),
                            }))
                            : [
                              { id: 1, label: "<25%" },
                              { id: 2, label: "50%" },
                              { id: 3, label: "75%" },
                              { id: 4, label: "90%" },
                            ];

                        const hasHundred = baseOptions.some((p) =>
                          String(p.label || "").replace(/\s+/g, "").includes("100%")
                        );

                        const normalizedOptions = hasHundred
                          ? baseOptions
                          : [...baseOptions, { id: 5, label: "100%" }];

                        return normalizedOptions.map((p) => (
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
                      ));
                      })()}
                    </div>
                    {/* <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                      Selecting 90% or higher is usually a strong conversion signal. Use
                      "Mark as Converted" to make this opportunity Closed Won / Done.
                    </div> */}
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

                    {autoPrefilledOppContacts && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#334155" }}>
                        Opportunity contacts were auto-populated from the selected project. You can edit them before saving.
                      </div>
                    )}

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
                                <td style={{ ...oppTd, color: "#1F3A68" }}>
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
                      background: "#F26522",
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
                <button style={saveBtn} onClick={() => void handleSaveOpportunity()}>
                  Save Opportunity
                </button>
              )}
              {opportunityView === "OPPORTUNITY" && isHundredPercentProbabilitySelected && (
                <button
                  style={{ ...saveBtn, background: "#1F3A68" }}
                  onClick={() => void handleConvertOpportunityToProject()}
                >
                  {hasSelectedProject ? "Convert to Project" : "Add Project"}
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
  borderRadius: 8,
  border: "none",
  background: "#F26522",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 4px 10px rgba(242, 101, 34, 0.25)",
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

const dropdownItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  background: "none",
  border: "none",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: "4px",
  color: "#F26522",
};


