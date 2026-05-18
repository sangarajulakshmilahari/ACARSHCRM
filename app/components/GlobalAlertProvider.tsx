"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type AlertItem = {
  id: number;
  message: string;
};

export default function GlobalAlertProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queue, setQueue] = useState<AlertItem[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalAlert = window.alert.bind(window);

    window.alert = (message?: unknown) => {
      idRef.current += 1;
      const next: AlertItem = {
        id: idRef.current,
        message: String(message ?? ""),
      };

      setQueue((prev) => [...prev, next]);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, []);

  const current = useMemo(() => queue[0] ?? null, [queue]);

  const closeAlert = () => {
    setQueue((prev) => prev.slice(1));
  };

  return (
    <>
      {children}

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(15, 23, 42, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(460px, 92vw)",
              background: "#ffffff",
              borderRadius: 12,
              boxShadow: "0 24px 48px rgba(15, 23, 42, 0.28)",
              border: "1px solid #e2e8f0",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid #e2e8f0",
                fontSize: 20,
                fontWeight: 700,
                color: "#1e40af",
                letterSpacing: 0.2,
              }}
            >
              Notification
            </div>

            <div
              style={{
                padding: "18px",
                fontSize: 15,
                color: "#0f172a",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "52vh",
                overflowY: "auto",
              }}
            >
              {current.message}
            </div>

            <div
              style={{
                padding: "0 18px 16px",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={closeAlert}
                autoFocus
                style={{
                  border: "none",
                  borderRadius: 8,
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 14,
                  padding: "8px 18px",
                  cursor: "pointer",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

