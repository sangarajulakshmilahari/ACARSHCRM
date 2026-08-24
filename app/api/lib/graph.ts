import { ClientSecretCredential } from "@azure/identity";

type CalendarEventInput = {
  subject: string;
  content?: string;
  start?: { dateTime: string; timeZone?: string };
  end?: { dateTime: string; timeZone?: string };
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    type?: "required" | "optional";
  }>;
  location?: { displayName: string };
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: "teamsForBusiness";
};

class PlaceholderGraphClient {
  async createCalendarEvent(eventData: CalendarEventInput) {
    return {
      id: `placeholder-${Date.now()}`,
      subject: eventData.subject,
      webLink: null,
      start: eventData.start,
      end: eventData.end,
      onlineMeeting: eventData.isOnlineMeeting
        ? { joinUrl: null }
        : undefined,
    };
  }

  async createOnlineMeeting(meetingData: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    participants?: unknown;
  }) {
    return {
      id: `placeholder-online-${Date.now()}`,
      subject: meetingData.subject,
      joinWebUrl: null,
    };
  }

  async deleteCalendarEvent(_eventId: string) {
    return;
  }
}

class AzureGraphClient {
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private organizerUser: string;

  constructor() {
    this.tenantId = String(process.env.AZURE_TENANT_ID || "").trim();
    this.clientId = String(process.env.AZURE_CLIENT_ID || "").trim();
    this.clientSecret = String(process.env.AZURE_CLIENT_SECRET || "").trim();
    this.organizerUser = String(
      process.env.AZURE_GRAPH_USER_ID ||
        process.env.GRAPH_USER_ID ||
        process.env.GRAPH_USER_EMAIL ||
        process.env.SMTP_USER ||
        ""
    ).trim();
  }

  private async getAccessToken() {
    if (!this.tenantId || !this.clientId || !this.clientSecret) {
      throw new Error("Azure AD credentials are missing");
    }

    const credential = new ClientSecretCredential(
      this.tenantId,
      this.clientId,
      this.clientSecret
    );

    const token = await credential.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) {
      throw new Error("Failed to acquire Microsoft Graph access token");
    }
    return token.token;
  }

  private async graphRequest(path: string, init?: RequestInit) {
    const token = await this.getAccessToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Graph API ${response.status} ${response.statusText}: ${body || "Unknown error"}`
      );
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  private getOrganizerUserPath() {
    if (!this.organizerUser) {
      throw new Error(
        "Graph organizer user is not configured. Set AZURE_GRAPH_USER_ID or GRAPH_USER_EMAIL"
      );
    }

    return encodeURIComponent(this.organizerUser);
  }

  async createCalendarEvent(eventData: CalendarEventInput) {
    const user = this.getOrganizerUserPath();
    return this.graphRequest(`/users/${user}/events`, {
      method: "POST",
      body: JSON.stringify({
        subject: eventData.subject,
        body: eventData.content
          ? {
              contentType: "HTML",
              content: eventData.content,
            }
          : undefined,
        start: eventData.start,
        end: eventData.end,
        attendees: eventData.attendees,
        location: eventData.location,
        isOnlineMeeting: Boolean(eventData.isOnlineMeeting),
        onlineMeetingProvider: eventData.onlineMeetingProvider,
      }),
    });
  }

  async createOnlineMeeting(meetingData: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    participants?: unknown;
  }) {
    const user = this.getOrganizerUserPath();
    return this.graphRequest(`/users/${user}/onlineMeetings`, {
      method: "POST",
      body: JSON.stringify({
        subject: meetingData.subject,
        startDateTime: meetingData.startDateTime,
        endDateTime: meetingData.endDateTime,
        participants: meetingData.participants,
      }),
    });
  }

  async deleteCalendarEvent(eventId: string) {
    const user = this.getOrganizerUserPath();
    await this.graphRequest(`/users/${user}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  }
}

export function getGraphClient() {
  const hasAzureConfig =
    Boolean(String(process.env.AZURE_TENANT_ID || "").trim()) &&
    Boolean(String(process.env.AZURE_CLIENT_ID || "").trim()) &&
    Boolean(String(process.env.AZURE_CLIENT_SECRET || "").trim());

  if (!hasAzureConfig) {
    return new PlaceholderGraphClient();
  }

  return new AzureGraphClient();
}

