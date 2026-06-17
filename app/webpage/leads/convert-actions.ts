"use client";

export type ConvertOrigin = "leads" | "Prospect" | "Account";
export type ConvertTarget = "Lead" | "Prospect" | "Account" | "MasterAccount";

type NavigationTarget = {
  push: (href: string) => void;
};

type ConvertParams = {
  leadId: number | string | null | undefined;
  origin: ConvertOrigin;
  router: NavigationTarget;
  target?: ConvertTarget;
};

type DirectConvertParams = {
  leadId: number | string | null | undefined;
  router: NavigationTarget;
};

export async function convertLeadWithExistingFlow({
  leadId,
  origin,
  router,
  target,
}: ConvertParams) {
  if (!leadId) {
    alert("ID not found");
    return;
  }

  try {
    const requestOptions: RequestInit = { method: "POST" };

    if (target) {
      requestOptions.headers = { "Content-Type": "application/json" };
      requestOptions.body = JSON.stringify({ target });
    }

    const res = await fetch(
      `/api/employees/leads/${leadId}/convert`,
      requestOptions
    );

    if (!res.ok) {
      let errorMessage = "Conversion failed";

      try {
        const err = await res.json();
        errorMessage = err.error || errorMessage;
      } catch {}

      throw new Error(errorMessage);
    }

    const payload = await res.json().catch(() => null);
    const convertedTo = payload?.to as ConvertTarget | undefined;

    if (convertedTo === "Lead") {
      alert("Moved successfully to Lead");
      router.push("/webpage?tab=leads");
    } else if (convertedTo === "Prospect") {
      alert("Converted successfully to Prospect");
      router.push("/webpage?tab=Prospect");
    } else if (convertedTo === "Account") {
      alert("Converted successfully to Customer");
      router.push("/webpage?tab=Account");
    } else if (convertedTo === "MasterAccount") {
      alert("Converted successfully to Master Customer");
      router.push("/webpage?tab=masteraccount");
    } else if (origin === "leads") {
      alert("Converted successfully to Prospect");
      router.push("/webpage?tab=Prospect");
    } else if (origin === "Prospect") {
      alert("Converted successfully to Customer");
      router.push("/webpage?tab=Account");
    } else if (origin === "Account") {
      alert("Converted successfully to Master Customer");
      router.push("/webpage?tab=masteraccount");
    }
  } catch (err: any) {
    alert(err.message || "Failed to convert");
  }
}

export async function convertLeadDirectToAccountWithExistingFlow({
  leadId,
  router,
}: DirectConvertParams) {
  if (!leadId) {
    alert("ID not found");
    return;
  }

  try {
    const res = await fetch(`/api/employees/leads/${leadId}/converttoaccount`, {
      method: "POST",
    });

    if (!res.ok) {
      let errorMessage = "Conversion failed";

      try {
        const err = await res.json();
        errorMessage = err.error || errorMessage;
      } catch {}

      throw new Error(errorMessage);
    }

    alert("Converted successfully to Customer");
    router.push("/webpage?tab=Account");
  } catch (err: any) {
    alert(err.message || "Failed to convert to customer");
  }
}
