"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { POST_LOGIN_DASHBOARD_PATH, selectionRequestLock } from "@/app/api/lib/company-tenancy";
import styles from "./select-company.module.css";

type CompanyCard = {
  companyId: number;
  companyName: string;
};

type SelectCompanyClientProps = {
  userName: string;
  companies: CompanyCard[];
  accessDenied: boolean;
};

function WorkspaceArt() {
  return (
    <svg width="132" height="86" viewBox="0 0 132 86" aria-hidden="true">
      <rect x="8" y="28" width="48" height="50" rx="6" fill="#dbe7f5" />
      <rect x="18" y="38" width="10" height="10" rx="2" fill="#8fb4d9" />
      <rect x="36" y="38" width="10" height="10" rx="2" fill="#8fb4d9" />
      <rect x="18" y="54" width="10" height="10" rx="2" fill="#8fb4d9" />
      <rect x="36" y="54" width="10" height="10" rx="2" fill="#8fb4d9" />
      <rect x="62" y="16" width="58" height="62" rx="8" fill="#c9783a" />
      <rect x="74" y="28" width="12" height="12" rx="2" fill="#f3d2b3" />
      <rect x="96" y="28" width="12" height="12" rx="2" fill="#f3d2b3" />
      <rect x="74" y="48" width="12" height="12" rx="2" fill="#f3d2b3" />
      <rect x="96" y="48" width="12" height="18" rx="2" fill="#7a431c" />
      <circle cx="118" cy="18" r="8" fill="#12b7c9" opacity="0.35" />
    </svg>
  );
}

export default function SelectCompanyClient({
  userName,
  companies,
  accessDenied,
}: SelectCompanyClientProps): JSX.Element {
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(
    accessDenied ? "You do not have an active company membership." : null
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hostname !== "0.0.0.0") return;
    const nextUrl = `${window.location.protocol}//localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(nextUrl);
  }, []);

  async function chooseCompany(companyId: number) {
    if (!selectionRequestLock(selectingId, companyId)) return;
    setSelectingId(companyId);
    setError(null);
    try {
      const res = await fetch("/api/auth/company", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Unable to open that workspace.");
        setSelectingId(null);
        return;
      }
      window.location.assign(POST_LOGIN_DASHBOARD_PATH);
    } catch {
      setError("Unable to open that workspace.");
      setSelectingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Image src="/logo.png" alt="Adroitent" width={42} height={42} className={styles.logo} />
          <div className={styles.brandCopy}>
            <p className={styles.brandTitle}>ACARSH</p>
            <p className={styles.brandSubtitle}>Sales CRM workspace</p>
          </div>
        </div>
        <div className={styles.userMeta}>
          {userName ? <span className={styles.userName}>{userName}</span> : null}
          <button className={styles.logout} type="button" onClick={() => { window.location.href = "/api/auth/logout"; }}>
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.panel}>
          <h1 className={styles.heading}>Choose your company</h1>
          <p className={styles.subtitle}>Select a workspace to continue to ACARSH CRM</p>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}

          {accessDenied || companies.length === 0 ? (
            <p className={styles.empty}>No authorized workspaces are available for this account.</p>
          ) : (
            <div className={styles.grid}>
              {companies.map((company) => {
                const busy = selectingId === company.companyId;
                return (
                  <button
                    key={company.companyId}
                    type="button"
                    className={`${styles.card} ${busy ? styles.busy : ""}`}
                    disabled={selectingId != null}
                    aria-label={`Enter ${company.companyName} Sales CRM workspace`}
                    onClick={() => chooseCompany(company.companyId)}
                  >
                    <div className={styles.illustration}>
                      <WorkspaceArt />
                    </div>
                    <div className={styles.cardFooter}>
                      <div className={styles.cardCopy}>
                        <h3>{company.companyName}</h3>
                        <p>Sales CRM workspace</p>
                      </div>
                      <span className={styles.arrow} aria-hidden="true">{busy ? "…" : "→"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <p className={styles.note}>
            You can switch companies later if you have access to multiple workspaces.
          </p>
        </section>
      </main>
    </div>
  );
}
