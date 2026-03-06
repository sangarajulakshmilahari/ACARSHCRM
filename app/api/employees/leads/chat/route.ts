// app/api/employees/leads/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

const FORM_FIELDS = [
  "CompanyName",
  "CompanyLocation",
  "LeadSource",
  "ContactName",
  "ContactTitle",
  "ContactRoleName",
  "ContactEmail",
  "ContactPhone",
  "ContactLocation",
  "ExpansionAreas",
  "Tags",
  "Notes",
  "OwnerName",
];

const REQUIRED_FIELDS = [
  "CompanyName",
  "ContactName",
  "ContactEmail",
  "ContactRoleName",
  "OwnerName",
];

// Fields that MUST match a dropdown option exactly
const DROPDOWN_FIELDS = [
  "CompanyName",
  "ContactRoleName",
  "OwnerName",
  "LeadSource",
];

// ─── FUZZY MATCH: finds closest dropdown option ───
function fuzzyMatch(input: string, options: string[]): string | null {
  if (!input || options.length === 0) return null;
  const lower = input.toLowerCase().trim();

  // 1. Exact match
  const exact = options.find((o) => o.toLowerCase() === lower);
  if (exact) return exact;

  // 2. Starts-with match
  const startsWith = options.find(
    (o) =>
      o.toLowerCase().startsWith(lower) || lower.startsWith(o.toLowerCase()),
  );
  if (startsWith) return startsWith;

  // 3. Contains match (either direction)
  const contains = options.find(
    (o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()),
  );
  if (contains) return contains;

  // 4. Word overlap match
  const inputWords = lower.split(/\s+/);
  let bestMatch: string | null = null;
  let bestScore = 0;
  for (const option of options) {
    const optWords = option.toLowerCase().split(/\s+/);
    const overlap = inputWords.filter((w) =>
      optWords.some((ow) => ow.includes(w) || w.includes(ow)),
    ).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestMatch = option;
    }
  }
  if (bestScore > 0) return bestMatch;

  return null; // No match at all
}

function buildSystemPrompt(
  companyList: string[],
  roleList: string[],
  ownerList: string[],
  sourceList: string[],
  currentFormState: Record<string, any>,
) {
  const relevantState: Record<string, any> = {};
  for (const key of FORM_FIELDS) {
    if (currentFormState[key]) {
      relevantState[key] = currentFormState[key];
    }
  }

  return `You are a CRM lead entry assistant for ACARsh.

Your job is to extract lead information from natural language and progressively fill a CRM form.

FORM FIELDS:
${FORM_FIELDS.join(", ")}

REQUIRED FIELDS:
${REQUIRED_FIELDS.join(", ")}

DROPDOWN OPTIONS:
CompanyName: [${companyList.join(", ")}]
ContactRoleName: [${roleList.join(", ")}]
OwnerName: [${ownerList.join(", ")}]
LeadSource: [${sourceList.join(", ")}]

CURRENT FORM STATE:
${Object.keys(relevantState).length ? JSON.stringify(relevantState) : "Empty"}

IMPORTANT BEHAVIOR RULES:

1. Extract ALL fields you can from the user's message.
2. NEVER repeat a full summary of the form.
3. NEVER list what was already filled.
4. Ask ONLY ONE missing required field at a time.
5. If all required fields are filled, say:
   "All required fields are filled. You can create the lead now."
6. Keep responses SHORT and conversational.
7. Do NOT list dropdown options in the message.
8. OwnerName, CompanyName, ContactRoleName must match dropdown options.

RESPONSE FORMAT (STRICT JSON ONLY):

{
"extractedFields": {
  "ContactName": "Lakshmi Lahri"
},
"missingRequired": ["ContactEmail","OwnerName"],
"message": "Please provide the contact email."
}

Only JSON. No markdown.`;
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userMessage,
      chatHistory,
      currentForm,
      companies,
      roles,
      owners,
      sources,
    } = body;

    const safeCompanies = Array.isArray(companies) ? companies : [];
    const safeRoles = Array.isArray(roles) ? roles : [];
    const safeOwners = Array.isArray(owners) ? owners : [];
    const safeSources = Array.isArray(sources) ? sources : [];

    const systemPrompt = buildSystemPrompt(
      safeCompanies,
      safeRoles,
      safeOwners,
      safeSources,
      currentForm || {},
    );

    const cleanHistory = Array.isArray(chatHistory)
      ? chatHistory
          .filter((msg: any) => msg && msg.role && msg.content)
          .map((msg: any) => ({
            role: msg.role === "user" ? "user" : "assistant",
            content: String(msg.content),
          }))
      : [];

    const messages = [
      { role: "system", content: systemPrompt },
      ...cleanHistory,
      { role: "user", content: userMessage },
    ];

    console.log("=== GROQ API REQUEST ===");
    console.log("User message:", userMessage);
    console.log("Companies:", safeCompanies);
    console.log("Roles:", safeRoles);
    console.log("Owners:", safeOwners);

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({
        extractedFields: {},
        missingRequired: REQUIRED_FIELDS,
        message:
          "⚠️ GROQ_API_KEY not found in .env.local. Add it and restart the server.",
      });
    }

    // ─── CALL GROQ API ───
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: messages,
          temperature: 0.1,
          max_tokens: 1024,
          response_format: { type: "json_object" },
        }),
      },
    );

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("Groq API error:", groqResponse.status, errorText);
      return NextResponse.json({
        extractedFields: {},
        
        missingRequired: REQUIRED_FIELDS,
        message: `⚠️ Groq API error (${groqResponse.status}): ${errorText.substring(0, 200)}`,
      });
    }

    const groqData = await groqResponse.json();
    const aiText = groqData.choices?.[0]?.message?.content;

    console.log("=== GROQ RAW RESPONSE ===");
    console.log(aiText);

    if (!aiText) {
      return NextResponse.json({
        extractedFields: {},
        missingRequired: REQUIRED_FIELDS,
        message: "⚠️ AI returned empty response. Please try again.",
      });
    }

    // ─── PARSE JSON ───
    let parsed;
    try {
      let cleanedText = aiText.trim();
      if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText
          .replace(/^```(?:json)?\s*\n?/, "")
          .replace(/\n?\s*```$/, "");
      }
      parsed = JSON.parse(cleanedText);
    } catch {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }
      if (!parsed) {
        return NextResponse.json({
          extractedFields: {},
          missingRequired: REQUIRED_FIELDS,
          message: `Couldn't parse AI response. Raw:\n${aiText.substring(0, 300)}`,
        });
      }
    }

    // ─── VALIDATE & FUZZY-MATCH DROPDOWN FIELDS ───
    const validFields: Record<string, any> = {};
    const dropdownMismatches: string[] = [];

    // Map field names to their dropdown options
    const dropdownOptions: Record<string, string[]> = {
      CompanyName: safeCompanies,
      ContactRoleName: safeRoles,
      OwnerName: safeOwners,
      LeadSource: safeSources,
    };

    if (parsed.extractedFields && typeof parsed.extractedFields === "object") {
      for (const [key, value] of Object.entries(parsed.extractedFields)) {
        if (
          !FORM_FIELDS.includes(key) ||
          value === null ||
          value === undefined ||
          value === ""
        ) {
          continue;
        }

        const strValue = String(value);

        // Is this a dropdown field?
        if (DROPDOWN_FIELDS.includes(key)) {
          const options = dropdownOptions[key] || [];
          if (options.length === 0) {
            // No dropdown data loaded yet — accept the value as-is
            validFields[key] = strValue;
          } else {
            // Try fuzzy match
            const matched = fuzzyMatch(strValue, options);
            if (matched) {
              validFields[key] = matched; // Use the exact dropdown value
              console.log(`Fuzzy matched ${key}: "${strValue}" → "${matched}"`);
            } else {
              // No match — don't set the field, report it
              dropdownMismatches.push(
                `"${strValue}" doesn't match any ${key} option. Available: ${options.slice(0, 8).join(", ")}${options.length > 8 ? "..." : ""}`,
              );
              console.log(
                `No match for ${key}: "${strValue}". Options: ${options.join(", ")}`,
              );
            }
          }
        } else {
          // Free-text field — accept directly
          validFields[key] = strValue;
        }
      }
    }

    console.log("=== FINAL VALID FIELDS ===");
    console.log(JSON.stringify(validFields));
    if (dropdownMismatches.length > 0) {
      console.log("Dropdown mismatches:", dropdownMismatches);
    }

    // ─── BUILD RESPONSE MESSAGE ───
    let message = parsed.message || "";

    // If dropdown mismatches exist, override message with the next required question
    if (dropdownMismatches.length > 0) {
      message = dropdownMismatches[0];
    }

    // Append dropdown mismatch warnings
    if (dropdownMismatches.length > 0) {
      message +=
        "\n\n⚠️ Some values didn't match the dropdown options:\n• " +
        dropdownMismatches.join("\n• ");
    }

    if (!message) {
      message =
        Object.keys(validFields).length > 0
          ? `Extracted ${Object.keys(validFields).length} field(s). Check the form!`
          : "I couldn't extract any fields from that. Could you provide more details?";
    }

    return NextResponse.json({
      extractedFields: validFields,
      missingRequired: Array.isArray(parsed.missingRequired)
        ? parsed.missingRequired
        : [],
      message,
    });
  } catch (error: any) {
    console.error("=== CHAT API CRASH ===", error.message, error.stack);
    return NextResponse.json({
      extractedFields: {},
      missingRequired: REQUIRED_FIELDS,
      message: `⚠️ Server error: ${error.message}`,
    });
  }
}
