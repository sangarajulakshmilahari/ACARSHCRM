import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { resolveAuthUser } from "@/app/api/lib/auth";
import { getGraphClient } from "@/app/api/lib/graph";
import { sendMeetingInviteEmail } from "@/app/api/lib/mailer";

function toDate(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const leadId = Number(params.leadID);
    if (Number.isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    const authUser = await resolveAuthUser(req);
    if (!authUser?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      subject,
      agenda,
      attendees = [],
      startDateTime,
      endDateTime,
      meetingLink,
      location,
      timeZone,
      sendEmail = true,
    } = await req.json();

    if (!String(subject || "").trim()) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }

    const start = toDate(startDateTime);
    const end = toDate(endDateTime);

    if (!start || !end) {
      return NextResponse.json(
        { error: "Valid startDateTime and endDateTime are required" },
        { status: 400 }
      );
    }

    if (start >= end) {
      return NextResponse.json(
        { error: "endDateTime must be after startDateTime" },
        { status: 400 }
      );
    }

    const pool = await getPool();

    const [leadRows]: any = await pool.query(
      `SELECT LeadId, CompanyName FROM Leads WHERE LeadId = ? LIMIT 1`,
      [leadId]
    );

    if (!leadRows?.length) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Validate attendees array
    if (!Array.isArray(attendees)) {
      return NextResponse.json(
        { error: "attendees must be an array" },
        { status: 400 }
      );
    }

    // Filter out empty attendees (both email and name empty)
    const validAttendees = attendees.filter(
      (attendee) =>
        (attendee?.email && String(attendee.email).trim() !== "") ||
        (attendee?.name && String(attendee.name).trim() !== "")
    );

    if (validAttendees.length === 0) {
      // Try to get default contact from lead
      const [contactRows]: any = await pool.query(
        `
        SELECT ContactEmail, ContactName
        FROM LeadContacts
        WHERE LeadId = ?
          AND ContactEmail IS NOT NULL
          AND TRIM(ContactEmail) <> ''
        ORDER BY LeadContactID DESC
        LIMIT 1
        `,
        [leadId]
      );

      const defaultEmail = String(contactRows?.[0]?.ContactEmail || "").trim();
      const defaultName = String(contactRows?.[0]?.ContactName || "").trim();

      if (!defaultEmail) {
        return NextResponse.json(
          { error: "At least one attendee with email is required (or add a lead contact with email)" },
          { status: 400 }
        );
      }

      validAttendees.push({ email: defaultEmail, name: defaultName });
    }

    // Resolve contact IDs for attendees
    const resolvedAttendees = await Promise.all(
      validAttendees.map(async (attendee) => {
        const email = String(attendee.email || "").trim();
        const name = String(attendee.name || "").trim();
        
        if (!email) {
          return { email, name, contactId: null };
        }

        const [contactRows]: any = await pool.query(
          `
          SELECT LeadContactID
          FROM LeadContacts
          WHERE LeadId = ?
            AND LOWER(TRIM(ContactEmail)) = LOWER(TRIM(?))
          ORDER BY LeadContactID DESC
          LIMIT 1
          `,
          [leadId, email]
        );

        const contactId = Number(contactRows?.[0]?.LeadContactID) || null;
        return { email, name, contactId };
      })
    );

    const resolvedTimeZone = String(timeZone || "Asia/Kolkata").trim() || "Asia/Kolkata";

    const graph = getGraphClient();
    const createdEvent = await graph.createCalendarEvent({
      subject: String(subject).trim(),
      content: String(agenda || "").trim() || undefined,
      start: { dateTime: start.toISOString(), timeZone: resolvedTimeZone },
      end: { dateTime: end.toISOString(), timeZone: resolvedTimeZone },
      attendees: resolvedAttendees
        .filter((attendee) => attendee.email && attendee.email.trim() !== "")
        .map((attendee) => ({
          emailAddress: {
            address: attendee.email,
            name: attendee.name || undefined,
          },
          type: "required",
        })),
      location: location ? { displayName: String(location) } : undefined,
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    });

    const resolvedMeetingLink =
      String(meetingLink || "").trim() ||
      String(createdEvent?.onlineMeeting?.joinUrl || "").trim() ||
      String(createdEvent?.webLink || "").trim();

    if (!resolvedMeetingLink) {
      return NextResponse.json(
        { error: "Unable to generate Teams meeting URL. Please verify Graph permissions." },
        { status: 500 }
      );
    }

    if (sendEmail) {
      // Send emails to all attendees with valid email addresses
      const emailPromises = resolvedAttendees
        .filter((attendee) => attendee.email && attendee.email.trim() !== "")
        .map((attendee) =>
          sendMeetingInviteEmail({
            to: attendee.email,
            subject: String(subject).trim(),
            startDateTime: start,
            endDateTime: end,
            meetingLink: resolvedMeetingLink,
            agenda: String(agenda || "").trim(),
            location: String(location || "").trim() || "Online",
            timeZone: resolvedTimeZone,
            organizerName: authUser.userName || `User #${authUser.userId}`,
            leadCompanyName: String(leadRows?.[0]?.CompanyName || "").trim() || undefined,
          }).catch((err) => {
            console.warn(`Failed to send email to ${attendee.email}:`, err);
            return { success: false, email: attendee.email, error: err.message };
          })
        );

      await Promise.all(emailPromises);
    }

    const [statusRows]: any = await pool.query(
      `SELECT StatusId FROM LeadStatuses WHERE LOWER(StatusName) LIKE '%meeting%' LIMIT 1`
    );
    const statusId = Number(statusRows?.[0]?.StatusId) || 1;

    const attendeeList = resolvedAttendees
      .map((attendee) => {
        if (attendee.email && attendee.name) {
          return `${attendee.name} <${attendee.email}>`;
        } else if (attendee.email) {
          return `<${attendee.email}>`;
        } else if (attendee.name) {
          return attendee.name;
        }
        return "";
      })
      .filter((str) => str !== "")
      .join(", ");

    const meetingNote = [
      `Meeting Subject: ${String(subject).trim()}`,
      `Start: ${start.toISOString()}`,
      `End: ${end.toISOString()}`,
      `Time Zone: ${resolvedTimeZone}`,
      `Attendees: ${attendeeList || "-"}`,
      `Link: ${resolvedMeetingLink}`,
      `Provider: Microsoft Teams`,
      `Graph Event ID: ${String(createdEvent?.id || "-")}`,
      `Agenda: ${String(agenda || "").trim() || "-"}`,
    ].join("\n");

    const [insertActivity]: any = await pool.query(
      `
      INSERT INTO LeadActivities
      (LeadId, ActivityType, Notes, StatusId, ActivityDate, ContactId)
      VALUES (?, 'Meeting', ?, ?, ?, NULL)
      `,
      [leadId, meetingNote, statusId, start]
    );

    try {
      const [meetingTableRows]: any = await pool.query(
        `
        SELECT COUNT(*) AS cnt
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'LeadMeetings'
        `
      );

      const hasLeadMeetingsTable = Number(meetingTableRows?.[0]?.cnt || 0) > 0;

      if (hasLeadMeetingsTable) {
        // Get first attendee for backward compatibility
        const firstAttendee = resolvedAttendees.find((a) => a.email && a.email.trim() !== "") ||
                             resolvedAttendees[0] ||
                             { email: "", name: "" };
        const firstContactId = firstAttendee.contactId || null;

        await pool.query(
          `
          INSERT INTO LeadMeetings
          (
            LeadId,
            ActivityId,
            Subject,
            Agenda,
            AttendeeEmail,
            AttendeeName,
            StartDateTime,
            EndDateTime,
            TimeZone,
            MeetingProvider,
            MeetingLink,
            GraphEventId,
            GraphWebLink,
            OrganizerUserId,
            ContactId,
            InviteEmailSent,
            RawGraphPayload,
            CreatedAt,
            UpdatedAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'teams', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
          `,
          [
            leadId,
            insertActivity?.insertId ?? null,
            String(subject).trim(),
            String(agenda || "").trim() || null,
            firstAttendee.email || null,
            firstAttendee.name || null,
            start,
            end,
            resolvedTimeZone,
            resolvedMeetingLink,
            String(createdEvent?.id || "").trim() || null,
            String(createdEvent?.webLink || "").trim() || null,
            authUser.userId,
            firstContactId,
            sendEmail ? 1 : 0,
            JSON.stringify({
              ...(createdEvent || {}),
              allAttendees: resolvedAttendees,
            }),
          ]
        );
      }
    } catch (meetingStoreError) {
      console.warn("LeadMeetings insert skipped:", meetingStoreError);
    }

    // Get list of emails that received invites
    const invitedEmails = resolvedAttendees
      .filter((attendee) => attendee.email && attendee.email.trim() !== "")
      .map((attendee) => attendee.email);

    return NextResponse.json({
      success: true,
      message: "Meeting scheduled successfully",
      activityId: insertActivity?.insertId ?? null,
      event: {
        id: createdEvent?.id || null,
        webLink: createdEvent?.webLink || null,
        onlineMeetingUrl: createdEvent?.onlineMeeting?.joinUrl || resolvedMeetingLink,
        provider: "teams",
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: resolvedTimeZone,
      },
      invite: {
        sent: Boolean(sendEmail),
        to: invitedEmails,
        count: invitedEmails.length,
      },
      attendees: resolvedAttendees,
    });
  } catch (error) {
    console.error("Meeting schedule error:", error);
    return NextResponse.json(
      { error: "Failed to schedule meeting" },
      { status: 500 }
    );
  }
}

