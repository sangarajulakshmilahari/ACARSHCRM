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

export function getGraphClient() {
  return new PlaceholderGraphClient();
}

