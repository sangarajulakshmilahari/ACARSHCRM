"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "chart.js/auto";

type OutreachAnalytics = {
  totalLinkedInRequestsSent: number;
  totalLinkedInRequestsAccepted: number;
  totalEmailsSent: number;
  acceptanceRate: number;
  engagementEfficiency: number;
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState<number>(0);
  const [statusCounts, setStatusCounts] = useState<Record<number, number>>({});
  const [leadsByOwner, setLeadsByOwner] = useState<
    { OwnerName: string; count: number }[]
  >([]);
  const [monthlyTrends, setMonthlyTrends] = useState<
    {
      MonthYear: string;
      YearNum: number;
      MonthNum: number;
      OwnerName: string;
      count: number;
    }[]
  >([]);
  const [outreachAnalytics, setOutreachAnalytics] = useState<OutreachAnalytics>({
    totalLinkedInRequestsSent: 0,
    totalLinkedInRequestsAccepted: 0,
    totalEmailsSent: 0,
    acceptanceRate: 0,
    engagementEfficiency: 0,
  });
  const [isDarkTheme, setIsDarkTheme] = useState(false);

  const outreachDonutRef = useRef<HTMLCanvasElement>(null);
  const outreachBarRef = useRef<HTMLCanvasElement>(null);
  const ownerRef = useRef<HTMLCanvasElement>(null);
  const monthlyRef = useRef<HTMLCanvasElement>(null);

  const outreachDonutChart = useRef<Chart | null>(null);
  const outreachBarChart = useRef<Chart | null>(null);
  const ownerChart = useRef<Chart | null>(null);
  const monthlyChart = useRef<Chart | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => {
        setTotalLeads(Number(data.totalLeads ?? 0));

        const map: Record<number, number> = {};
        (data.statusCounts || []).forEach((s: any) => {
          map[s.StatusId] = s.count;
        });

        setStatusCounts(map);
        setLeadsByOwner(data.leadsByOwner || []);
        setMonthlyTrends(data.monthlyTrends || []);
        setOutreachAnalytics({
          totalLinkedInRequestsSent: Number(
            data?.outreachAnalytics?.totalLinkedInRequestsSent ?? 0
          ),
          totalLinkedInRequestsAccepted: Number(
            data?.outreachAnalytics?.totalLinkedInRequestsAccepted ?? 0
          ),
          totalEmailsSent: Number(data?.outreachAnalytics?.totalEmailsSent ?? 0),
          acceptanceRate: Number(data?.outreachAnalytics?.acceptanceRate ?? 0),
          engagementEfficiency: Number(
            data?.outreachAnalytics?.engagementEfficiency ?? 0
          ),
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDarkTheme(mediaQuery.matches);

    const onChange = (e: MediaQueryListEvent) => {
      setIsDarkTheme(e.matches);
    };

    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  const rollingMonths = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    });

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    return Array.from({ length: 13 }, (_, index) => {
      const d = new Date(start.getFullYear(), start.getMonth() + index, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return {
        label: formatter.format(d),
        key,
      };
    });
  }, []);

  const months = useMemo(() => rollingMonths.map((m) => m.label), [rollingMonths]);

  const owners = useMemo(
    () => Array.from(new Set(monthlyTrends.map((m) => m.OwnerName))),
    [monthlyTrends]
  );

  const monthlyDatasets = useMemo(
    () =>
      owners.map((owner, index) => ({
        label: owner,
        data: rollingMonths.map((monthRef) => {
          const record = monthlyTrends.find(
            (m) =>
              `${m.YearNum}-${String(m.MonthNum).padStart(2, "0")}` === monthRef.key &&
              m.OwnerName === owner
          );
          return record ? record.count : 0;
        }),
        backgroundColor: ["#007bff", "#28a745", "#ffc107", "#dc3545", "#17a2b8"][
          index % 5
        ],
      })),
    [owners, monthlyTrends, rollingMonths]
  );

  const sent = outreachAnalytics.totalLinkedInRequestsSent;
  const accepted = outreachAnalytics.totalLinkedInRequestsAccepted;
  const pending = Math.max(sent - accepted, 0);

  useEffect(() => {
    if (!outreachDonutRef.current) return;
    outreachDonutChart.current?.destroy();

    outreachDonutChart.current = new Chart(outreachDonutRef.current, {
      type: "doughnut",
      data: {
        labels: ["Accepted", "Pending"],
        datasets: [
          {
            data: [accepted, pending],
            backgroundColor: ["#34d399", "#60a5fa"],
            borderColor: isDarkTheme ? "#0f172a" : "#ffffff",
            borderWidth: 3,
            hoverOffset: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "66%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: isDarkTheme ? "#cbd5e1" : "#64748b",
              usePointStyle: true,
              boxWidth: 8,
            },
          },
        },
      },
    });

    return () => {
      outreachDonutChart.current?.destroy();
    };
  }, [accepted, pending, isDarkTheme]);

  useEffect(() => {
    if (!outreachBarRef.current) return;
    outreachBarChart.current?.destroy();

    outreachBarChart.current = new Chart(outreachBarRef.current, {
      type: "bar",
      data: {
        labels: ["LinkedIn Sent", "Accepted", "Emails"],
        datasets: [
          {
            label: "Outreach Volume",
            data: [
              outreachAnalytics.totalLinkedInRequestsSent,
              outreachAnalytics.totalLinkedInRequestsAccepted,
              outreachAnalytics.totalEmailsSent,
            ],
            backgroundColor: ["#3b82f6", "#10b981", "#f97316"],
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: isDarkTheme ? "#cbd5e1" : "#64748b",
            },
            grid: {
              color: isDarkTheme
                ? "rgba(148,163,184,0.22)"
                : "rgba(148,163,184,0.16)",
            },
          },
          x: {
            ticks: {
              color: isDarkTheme ? "#cbd5e1" : "#64748b",
            },
            grid: { display: false },
          },
        },
      },
    });

    return () => {
      outreachBarChart.current?.destroy();
    };
  }, [outreachAnalytics, isDarkTheme]);

  useEffect(() => {
    if (!ownerRef.current || leadsByOwner.length === 0) return;

    ownerChart.current?.destroy();
    ownerChart.current = new Chart(ownerRef.current, {
      type: "bar",
      data: {
        labels: leadsByOwner.map((o) => o.OwnerName),
        datasets: [
          {
            data: leadsByOwner.map((o) => o.count),
            backgroundColor: ["#007bff", "#28a745", "#ffc107", "#dc3545", "#17a2b8"],
            borderColor: ["#0056b3", "#1e7e34", "#e0a800", "#bd2130", "#138496"],
            borderWidth: 3,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 5,
              precision: 0,
              color: isDarkTheme ? "#cbd5e1" : "#64748b",
            },
            grid: {
              color: isDarkTheme
                ? "rgba(148,163,184,0.22)"
                : "rgba(148,163,184,0.16)",
            },
          },
          x: {
            ticks: {
              color: isDarkTheme ? "#cbd5e1" : "#64748b",
            },
            grid: {
              color: isDarkTheme
                ? "rgba(148,163,184,0.22)"
                : "rgba(148,163,184,0.16)",
            },
          },
        },
      },
    });

    return () => {
      ownerChart.current?.destroy();
    };
  }, [leadsByOwner, isDarkTheme]);

  useEffect(() => {
    if (!monthlyRef.current) return;

    monthlyChart.current?.destroy();
    monthlyChart.current = new Chart(monthlyRef.current, {
      type: "bar",
      data: {
        labels: months,
        datasets: monthlyDatasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => `${item.dataset.label}: ${item.raw}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 5,
              precision: 0,
              color: isDarkTheme ? "#cbd5e1" : "#64748b",
            },
            grid: {
              color: isDarkTheme
                ? "rgba(148,163,184,0.22)"
                : "rgba(148,163,184,0.16)",
            },
          },
          x: {
            ticks: {
              color: isDarkTheme ? "#cbd5e1" : "#64748b",
            },
            grid: {
              color: isDarkTheme
                ? "rgba(148,163,184,0.22)"
                : "rgba(148,163,184,0.16)",
            },
          },
        },
      },
    });

    return () => {
      monthlyChart.current?.destroy();
    };
  }, [monthlyTrends, monthlyDatasets, isDarkTheme]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8f9fa",
          fontSize: 16,
          fontWeight: 500,
          color: "#6b7280",
        }}
      ></div>
    );
  }

  return (
    <>
      <div className="dashboard-container">
        <div className="dashboard-header">
          <p style={{ fontSize: "25px", fontWeight: 600 }}>Leads Dashboard</p>
          <div className="total-count">
            Total Leads: <strong>{totalLeads}</strong>
          </div>
        </div>

        <div className="status-cards-grid">
          {[
            { id: 1, cls: "new", icon: "fa-star", label: "New" },
            { id: 2, cls: "contacted", icon: "fa-phone", label: "Contacted" },
            { id: 3, cls: "followup", icon: "fa-clock", label: "Follow-Up" },
            { id: 4, cls: "qualified", icon: "fa-thumbs-up", label: "Qualified" },
            { id: 5, cls: "unqualified", icon: "fa-thumbs-down", label: "Unqualified" },
            { id: 6, cls: "lost", icon: "fa-times-circle", label: "Lost" },
            { id: 7, cls: "converted", icon: "fa-check-circle", label: "Converted" },
          ].map(({ id, cls, icon, label }) => {
            const count = statusCounts[id] || 0;
            const percentage = totalLeads ? ((count / totalLeads) * 100).toFixed(1) : "0";

            return (
              <div key={id} className={`status-card ${cls}`}>
                <div className="status-icon">
                  <i className={`fas ${icon}`}></i>
                </div>
                <div className="status-content">
                  <h4>{count}</h4>
                  <p>{label}</p>
                  <span className="percentage">{percentage}%</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="charts-row">
          <div className="chart-card outreach-experiment">
            {/* <div className="chart-header">
                <h3>Outreach Analytics</h3>
                <p className="chart-subtitle">
                    Experimental visualization for outreach volume, conversion, and engagement.
                </p>
            </div> */}

            <div className="outreach-kpis">
              <div className="kpi kpi-sent">
                <span>LinkedIn Sent</span>
                <strong>{outreachAnalytics.totalLinkedInRequestsSent}</strong>
              </div>
              <div className="kpi kpi-accepted">
                <span>Accepted</span>
                <strong>{outreachAnalytics.totalLinkedInRequestsAccepted}</strong>
              </div>
              <div className="kpi kpi-emails">
                <span>Emails</span>
                <strong>{outreachAnalytics.totalEmailsSent}</strong>
              </div>
              <div className="kpi kpi-eff">
                <span>LinkedIn Acceptance Rate</span>
                <strong>{outreachAnalytics.engagementEfficiency}%</strong>
              </div>
            </div>

            <div className="conversion-progress">
              <div className="conversion-head">
                <span>Sent → Accepted conversion</span>
                <strong>{outreachAnalytics.acceptanceRate}%</strong>
              </div>
              <div className="track">
                <div
                  className="fill"
                  style={{ width: `${Math.min(outreachAnalytics.acceptanceRate, 100)}%` }}
                />
              </div>
            </div>

            <div className="outreach-grid">
              <div className="mini-chart">
                <h4>Conversion Split</h4>
                <div className="mini-canvas">
                  <canvas ref={outreachDonutRef} />
                </div>
              </div>
              <div className="mini-chart">
                <h4>Outreach Mix</h4>
                <div className="mini-canvas">
                  <canvas ref={outreachBarRef} />
                </div>
              </div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h3>Leads By Owner</h3>
            </div>
            <div className="chart-container">
              <canvas ref={ownerRef} />
            </div>
          </div>
        </div>

        <div className="chart-card full">
          <div className="chart-header">
            <h3>Monthly Trends by Owner</h3>
          </div>
          <div className="chart-container">
            <canvas ref={monthlyRef} />
          </div>
        </div>
      </div>

      <style jsx>{`
        .dashboard-container {
          padding: 22px;
          background: #f6f8fc;
          min-height: 100vh;
        }
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fff;
          padding: 4px 16px;
          border-radius: 12px;
          border: 1px solid #e7edf6;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }
        .total-count {
          background: #007bff;
          color: #fff;
          padding: 12px 20px;
          border-radius: 25px;
          font-weight: 500;
        }
        .status-cards-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 10px;
          margin: 20px 0;
        }
        .status-card {
          background: #fff;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid #e8eef8;
          box-shadow: 0 8px 16px rgba(15, 23, 42, 0.05);
          text-align: center;
          position: relative;
        }
        .status-card::before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
        }
        .new::before {
          background: #28a745;
        }
        .contacted::before {
          background: #17a2b8;
        }
        .followup::before {
          background: #ffc107;
        }
        .qualified::before {
          background: #007bff;
        }
        .unqualified::before {
          background: #6c757d;
        }
        .lost::before {
          background: #dc3545;
        }
        .converted::before {
          background: #20c997;
        }

        .status-icon {
          font-size: 18px;
          margin-bottom: 5px;
        }
        .status-content h4 {
          margin: 0;
          font-size: 20px;
        }
        .status-content p {
          margin: 0;
          font-size: 11px;
        }
        .percentage {
          font-size: 9px;
          color: #777;
        }

        .charts-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .chart-card {
          background: #fff;
          padding: 20px;
          border-radius: 12px;
          border: 1px solid #e7edf6;
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
        }
        .chart-card.full {
          margin-top: 20px;
        }
        .chart-header {
          text-align: center;
          border-bottom: 2px solid #f1f3f4;
          margin-bottom: 16px;
          padding-bottom: 2px;
        }
        .chart-subtitle {
          margin-top: -6px;
          margin-bottom: 10px;
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
        }
        .chart-container {
          height: 280px;
        }

        .outreach-experiment {
          background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
        }
        .outreach-kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 12px;
        }
        .kpi {
          border: 1px solid #e5ebf4;
          border-radius: 10px;
          padding: 11px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
        }
        .kpi span {
          display: block;
          font-size: 11px;
          color: #64748b;
          margin-bottom: 4px;
          font-weight: 600;
        }
        .kpi strong {
          font-size: 21px;
          color: #0f172a;
          line-height: 1;
        }
        .kpi-sent {
          background: rgba(59, 130, 246, 0.08);
        }
        .kpi-accepted {
          background: rgba(16, 185, 129, 0.1);
        }
        .kpi-emails {
          background: rgba(249, 115, 22, 0.1);
        }
        .kpi-eff {
          background: rgba(168, 85, 247, 0.1);
        }
        .conversion-progress {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 12px;
          background: #fff;
        }
        .conversion-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 12px;
          color: #334155;
        }
        .conversion-head strong {
          color: #2563eb;
          font-size: 14px;
        }
        .track {
          height: 10px;
          background: #e2e8f0;
          border-radius: 999px;
          overflow: hidden;
        }
        .fill {
          height: 100%;
          background: linear-gradient(90deg, #38bdf8 0%, #10b981 100%);
          border-radius: 999px;
          transition: width 0.3s ease;
        }
        .outreach-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .mini-chart {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px;
          background: #fff;
        }
        .mini-chart h4 {
          margin: 0 0 8px;
          font-size: 13px;
          color: #0f172a;
        }
        .mini-canvas {
          height: 200px;
        }

        @media (max-width: 1024px) {
          .status-cards-grid {
            grid-template-columns: repeat(4, 1fr);
          }
          .outreach-kpis {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 768px) {
          .charts-row {
            grid-template-columns: 1fr;
          }
          .status-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .outreach-grid {
            grid-template-columns: 1fr;
          }
        }

        .new .status-icon {
          color: #28a745;
        }
        .contacted .status-icon {
          color: #17a2b8;
        }
        .followup .status-icon {
          color: #ffc107;
        }
        .qualified .status-icon {
          color: #007bff;
        }
        .unqualified .status-icon {
          color: #6c757d;
        }
        .lost .status-icon {
          color: #dc3545;
        }
        .converted .status-icon {
          color: #20c997;
        }

        @media (prefers-color-scheme: dark) {
          .dashboard-container {
            background: #020617;
          }
          .dashboard-header,
          .status-card,
          .chart-card,
          .mini-chart,
          .conversion-progress {
            background: #0f172a;
            color: #e2e8f0;
            border-color: #1e293b;
            box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
          }
          .chart-header {
            border-bottom-color: #1e293b;
          }
          .chart-subtitle,
          .kpi span,
          .percentage,
          .conversion-head {
            color: #94a3b8;
          }
          .kpi,
          .mini-chart {
            border-color: #1e293b;
            background: #0f172a;
          }
          .kpi strong,
          .mini-chart h4,
          .status-content h4 {
            color: #e2e8f0;
          }
          .track {
            background: #1e293b;
          }
        }
      `}</style>
    </>
  );
}

