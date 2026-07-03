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

type FunnelMetrics = {
  leads: number;
  prospects: number;
  accounts: number;
};

export default function DashboardPage() {
  const chartPalette = ["#1F3A68", "#F26522", "#12B7C9", "#0F1F3D", "#475569", "#9B3F14"];
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
  const [funnel, setFunnel] = useState<FunnelMetrics>({
    leads: 0,
    prospects: 0,
    accounts: 0,
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
        setFunnel({
          leads: Number(data?.funnel?.leads ?? data.totalLeads ?? 0),
          prospects: Number(data?.funnel?.prospects ?? 0),
          accounts: Number(data?.funnel?.accounts ?? 0),
        });

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
        backgroundColor: chartPalette[index % chartPalette.length],
        borderRadius: 8,
        borderSkipped: false,
      })),
    [owners, monthlyTrends, rollingMonths, chartPalette]
  );

  const sent = outreachAnalytics.totalLinkedInRequestsSent;
  const accepted = outreachAnalytics.totalLinkedInRequestsAccepted;
  const pending = Math.max(sent - accepted, 0);
  const chartTextColor = isDarkTheme ? "#cbd5e1" : "#667085";
  const chartGridColor = isDarkTheme
    ? "rgba(148,163,184,0.18)"
    : "rgba(148,163,184,0.12)";

  const funnelStages = useMemo(() => {
    const leads = Math.max(Number(funnel.leads || totalLeads || 0), 0);
    const prospects = Math.min(Math.max(Number(funnel.prospects || 0), 0), leads);
    const accounts = Math.min(Math.max(Number(funnel.accounts || 0), 0), prospects);

    const leadToProspect = leads > 0 ? (prospects / leads) * 100 : 0;
    const prospectToAccount = prospects > 0 ? (accounts / prospects) * 100 : 0;

    const leadWidth = 100;
    const prospectWidth = leads > 0 ? Math.max(60, Math.min(92, leadToProspect)) : 74;
    const accountWidth = leads > 0
      ? Math.max(40, Math.min(prospectWidth - 10, (accounts / Math.max(leads, 1)) * 100))
      : 52;

    return [
      {
        key: "leads",
        label: "Leads",
        count: leads,
        width: leadWidth,
        icon: "fa-layer-group",
        color: "#1F3A68",
        conversion: null as number | null,
      },
      {
        key: "prospects",
        label: "Prospects",
        count: prospects,
        width: prospectWidth,
        icon: "fa-user-check",
        color: "#F26522",
        conversion: leadToProspect,
      },
      {
        key: "accounts",
        label: "Customers",
        count: accounts,
        width: accountWidth,
        icon: "fa-building",
        color: "#12B7C9",
        conversion: prospectToAccount,
      },
    ];
  }, [funnel, totalLeads]);

  const funnelInsights = useMemo(() => {
    const leads = funnelStages[0]?.count ?? 0;
    const prospects = funnelStages[1]?.count ?? 0;
    const accounts = funnelStages[2]?.count ?? 0;

    return {
      leadToProspectDropOff: Math.max(leads - prospects, 0),
      prospectToAccountDropOff: Math.max(prospects - accounts, 0),
      overallConversion: leads > 0 ? ((accounts / leads) * 100).toFixed(1) : "0.0",
    };
  }, [funnelStages]);

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
            backgroundColor: ["#12B7C9", "#94a3b8"],
            borderColor: isDarkTheme ? "#0f172a" : "#ffffff",
            borderWidth: 4,
            hoverOffset: 6,
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
              color: chartTextColor,
              usePointStyle: true,
              boxWidth: 8,
              padding: 14,
              font: { size: 12, weight: 600 },
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
            backgroundColor: ["#1F3A68", "#12B7C9", "#F26522"],
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
              color: chartTextColor,
            },
            grid: { color: chartGridColor },
          },
          x: {
            ticks: {
              color: chartTextColor,
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
            backgroundColor: leadsByOwner.map(
              (_owner, i) => chartPalette[i % chartPalette.length]
            ),
            borderWidth: 0,
            borderRadius: 8,
            borderSkipped: false,
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
              color: chartTextColor,
            },
            grid: { color: chartGridColor },
          },
          x: {
            ticks: {
              color: chartTextColor,
            },
            grid: { color: chartGridColor },
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
          legend: {
            position: "bottom",
            labels: {
              color: chartTextColor,
              usePointStyle: true,
              boxWidth: 8,
              font: { size: 12, weight: 600 },
            },
          },
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
              color: chartTextColor,
            },
            grid: { color: chartGridColor },
          },
          x: {
            ticks: {
              color: chartTextColor,
            },
            grid: { color: chartGridColor },
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

        <div className="funnel-trends-row">
          <div className="chart-card funnel-card">
            <div className="chart-header" style={{ textAlign: "left" }}>
              <h3>Sales Funnel</h3>
              <p className="chart-subtitle" style={{ marginTop: 4, marginBottom: 0 }}>
                Lead → Prospect → Customer conversion pipeline
              </p>
            </div>

            <div className="funnel-kpi-strip">
              <div className="funnel-kpi-pill">
                <span>Lead → Prospect Drop-off</span>
                <strong>{funnelInsights.leadToProspectDropOff}</strong>
              </div>
              <div className="funnel-kpi-pill">
                <span>Prospect → Customer Drop-off</span>
                <strong>{funnelInsights.prospectToAccountDropOff}</strong>
              </div>
              <div className="funnel-kpi-pill accent">
                <span>Overall Conversion</span>
                <strong>{funnelInsights.overallConversion}%</strong>
              </div>
            </div>

            <div className="funnel-shell">
              {funnelStages.map((stage, idx) => (
                <React.Fragment key={stage.key}>
                  <div
                    className="funnel-stage"
                    style={{
                      width: `${stage.width}%`,
                      borderColor: `${stage.color}55`,
                      background: `linear-gradient(135deg, ${stage.color}EE 0%, ${stage.color}B8 100%)`,
                    }}
                    title={`${stage.label}: ${stage.count}`}
                  >
                    <div className="funnel-stage-gloss" />
                    <div className="funnel-stage-inner">
                      <div className="funnel-left">
                        <div className="funnel-icon" style={{ background: "rgba(255,255,255,0.22)", color: "#fff" }}>
                          <i className={`fas ${stage.icon}`}></i>
                        </div>
                        <div className="funnel-meta">
                          <strong>{stage.label}</strong>
                          <span>{stage.conversion === null ? "Entry stage" : `${stage.conversion.toFixed(1)}% from previous`}</span>
                        </div>
                      </div>
                      <div className="funnel-count">{stage.count}</div>
                    </div>
                  </div>

                  {idx < funnelStages.length - 1 && (
                    <div className="funnel-conversion">
                      <i className="fas fa-arrow-down"></i>
                      <span>{(funnelStages[idx + 1].conversion ?? 0).toFixed(1)}% conversion</span>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="chart-card monthly-half">
            <div className="chart-header">
              <h3>Monthly Trends by Owner</h3>
            </div>
            <div className="chart-container">
              <canvas ref={monthlyRef} />
            </div>
          </div>
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
              {/* <div className="kpi kpi-eff">
                <span>LinkedIn Acceptance Rate</span>
                <strong>{outreachAnalytics.engagementEfficiency}%</strong>
              </div> */}
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

      </div>

      <style jsx>{`
        .dashboard-container {
          padding: 24px;
          background: rgba(248, 244, 239, 0.72);
          min-height: 100vh;
        }
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background:
            linear-gradient(120deg, #ffffff 0%, rgba(248, 244, 239, 0.92) 48%, rgba(255, 246, 241, 0.96) 100%);
          background-size: 180% 180%;
          padding: 10px 18px;
          border-radius: 14px;
          border: 1px solid rgba(31, 58, 104, 0.14);
          box-shadow: 0 12px 26px rgba(15, 31, 61, 0.08);
          overflow: hidden;
          position: relative;
          isolation: isolate;
          animation: dashboardBreath 12s ease-in-out infinite alternate;
        }
        .dashboard-header::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          opacity: 0.62;
          background:
            radial-gradient(circle at 18% 50%, rgba(242, 101, 34, 0.08), transparent 28%),
            radial-gradient(circle at 84% 42%, rgba(31, 58, 104, 0.055), transparent 30%);
          animation: dashboardBreathGlow 12s ease-in-out infinite alternate;
        }
        .dashboard-header > * {
          position: relative;
          z-index: 1;
        }
        @keyframes dashboardBreath {
          from {
            background-position: 0% 50%;
          }
          to {
            background-position: 100% 50%;
          }
        }
        @keyframes dashboardBreathGlow {
          from {
            opacity: 0.42;
            transform: scale(1);
          }
          to {
            opacity: 0.72;
            transform: scale(1.03);
          }
        }
        .total-count {
          background: rgba(242, 101, 34, 0.1);
          color: #F26522;
          padding: 10px 16px;
          border-radius: 999px;
          border: 1px solid rgba(242, 101, 34, 0.22);
          font-weight: 600;
          font-size: 13px;
        }
        .status-cards-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 12px;
          
          margin: 20px 0 22px;
        }
        .status-card {
          background: #fff;
          min-height: 120px;
          padding: 14px 12px;
          border-radius: 12px;
          border: 1px solid rgba(31, 58, 104, 0.14);
          box-shadow: 0 10px 22px rgba(15, 31, 61, 0.06);
          text-align: center;
          position: relative;
          overflow: hidden;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .status-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 28px rgba(15, 31, 61, 0.1);
        }
        .status-card::before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 5px;
          border-radius: 14px 14px 0 0;
        }
        .new::before {
          background: #12B7C9;
        }
        .contacted::before {
          background: #1F3A68;
        }
        .followup::before {
          background: #F26522;
        }
        .qualified::before {
          background: #0F1F3D;
        }
        .unqualified::before {
          background: #6c757d;
        }
        .lost::before {
          background: #dc3545;
        }
        .converted::before {
          background: #12B7C9;
        }

        .status-icon {
          font-size: 18px;
          margin-bottom: 8px;
        }
        .status-content h4 {
          margin: 0;
          font-size: 26px;
          font-weight: 700;
          line-height: 1.08;
        }
        .status-content p {
          margin: 3px 0 2px;
          font-size: 12px;
          font-weight: 600;
          color: #475569;
        }
        .percentage {
          font-size: 11px;
          color: #64748b;
          font-weight: 500;
        }

        .charts-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .funnel-trends-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 20px;
          align-items: stretch;
        }
        .funnel-card {
          margin-bottom: 0;
          background: linear-gradient(180deg, #ffffff 0%, #fbf8f4 100%);
        }
        .monthly-half .chart-container {
          height: 420px;
        }
        .funnel-kpi-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }
        .funnel-kpi-pill {
          border: 1px solid rgba(31, 58, 104, 0.14);
          border-radius: 14px;
          padding: 10px 12px;
          background: #fff;
          box-shadow: 0 8px 16px rgba(15, 31, 61, 0.06);
        }
        .funnel-kpi-pill span {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          margin-bottom: 2px;
        }
        .funnel-kpi-pill strong {
          font-size: 18px;
          color: #0F1F3D;
          line-height: 1;
        }
        .funnel-kpi-pill.accent {
          background: linear-gradient(135deg, #fff 0%, rgba(242, 101, 34, 0.09) 100%);
          border-color: rgba(242, 101, 34, 0.2);
        }
        .funnel-shell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding-top: 6px;
        }
        .funnel-stage {
          border: 1px solid;
          border-radius: 16px;
          box-shadow: 0 12px 24px rgba(15, 31, 61, 0.14);
          transition: transform 0.22s ease, box-shadow 0.22s ease;
          position: relative;
          overflow: hidden;
        }
        .funnel-stage-gloss {
          position: absolute;
          inset: 0 auto auto 0;
          width: 100%;
          height: 48%;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.32) 0%,
            rgba(255, 255, 255, 0.02) 100%
          );
        }
        .funnel-stage:hover {
          transform: translateY(-2px);
          box-shadow: 0 16px 30px rgba(15, 31, 61, 0.18);
        }
        .funnel-stage-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 14px;
        }
        .funnel-left {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .funnel-icon {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .funnel-meta {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .funnel-meta strong {
          color: #ffffff;
          font-size: 14px;
          line-height: 1.1;
        }
        .funnel-meta span {
          color: rgba(255, 255, 255, 0.92);
          font-size: 12px;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .funnel-count {
          font-size: 24px;
          font-weight: 700;
          color: #fff;
          line-height: 1;
          padding-left: 10px;
          flex-shrink: 0;
        }
        .funnel-conversion {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #F26522;
          font-weight: 600;
          background: rgba(242, 101, 34, 0.09);
          border: 1px solid rgba(242, 101, 34, 0.24);
          border-radius: 999px;
          padding: 5px 11px;
        }
        .chart-card {
          background: #fff;
          padding: 20px;
          border-radius: 14px;
          border: 1px solid rgba(31, 58, 104, 0.14);
          box-shadow: 0 12px 26px rgba(15, 31, 61, 0.08);
          transition: box-shadow 0.2s ease, transform 0.2s ease;
        }
        .chart-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 16px 30px rgba(15, 31, 61, 0.1);
        }
        .chart-card.full {
          margin-top: 20px;
        }
        .chart-header {
          text-align: left;
          border-bottom: 1px solid #edf2f7;
          margin-bottom: 16px;
          padding-bottom: 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .chart-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: 0.1px;
          color: #0F1F3D;
        }
        .chart-subtitle {
          margin-top: 0;
          margin-bottom: 0;
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
        }
        .chart-container {
          height: 280px;
        }

        .outreach-experiment {
          background: linear-gradient(180deg, #ffffff 0%, #fbf8f4 100%);
        }
        .outreach-kpis {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 12px;
        }
        .kpi {
          border: 1px solid #e8edf6;
          border-radius: 12px;
          padding: 12px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .kpi:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
        }
        .kpi span {
          display: block;
          font-size: 12px;
          color: #64748b;
          margin-bottom: 4px;
          font-weight: 600;
        }
        .kpi strong {
          font-size: 24px;
          color: #0F1F3D;
          line-height: 1;
        }
        .kpi-sent {
          background: rgba(31, 58, 104, 0.1);
        }
        .kpi-accepted {
          background: rgba(18, 183, 201, 0.12);
        }
        .kpi-emails {
          background: rgba(242, 101, 34, 0.14);
        }
        .kpi-eff {
          background: rgba(168, 85, 247, 0.1);
        }
        .conversion-progress {
          border: 1px solid #e7ecf5;
          border-radius: 12px;
          padding: 12px;
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
          color: #F26522;
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
          background: linear-gradient(90deg, #1F3A68 0%, #12B7C9 58%, #F26522 100%);
          border-radius: 999px;
          transition: width 0.3s ease;
        }
        .outreach-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .mini-chart {
          border: 1px solid #e6ebf4;
          border-radius: 12px;
          padding: 10px;
          background: #fff;
        }
        .mini-chart h4 {
          margin: 0 0 8px;
          font-size: 13px;
          color: #0F1F3D;
        }
        .mini-canvas {
          height: 200px;
        }

        @media (max-width: 1024px) {
          .status-cards-grid {
            grid-template-columns: repeat(4, 1fr);
          }
          .monthly-half .chart-container {
            height: 360px;
          }
        }
        @media (max-width: 768px) {
          .dashboard-container {
            padding: 16px;
          }
          .dashboard-header {
            padding: 10px 12px;
          }
          .dashboard-header p {
            font-size: 18px !important;
          }
          .total-count {
            padding: 8px 12px;
            font-size: 12px;
          }
          .funnel-kpi-strip {
            grid-template-columns: 1fr;
          }
          .funnel-trends-row {
            grid-template-columns: 1fr;
          }
          .charts-row {
            grid-template-columns: 1fr;
          }
          .status-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .outreach-grid {
            grid-template-columns: 1fr;
          }
          .outreach-kpis {
            grid-template-columns: 1fr;
          }
          .funnel-stage {
            width: 100% !important;
          }
          .funnel-count {
            font-size: 20px;
          }
        }

        .new .status-icon {
          color: #12B7C9;
        }
        .contacted .status-icon {
          color: #1F3A68;
        }
        .followup .status-icon {
          color: #F26522;
        }
        .qualified .status-icon {
          color: #0F1F3D;
        }
        .unqualified .status-icon {
          color: #6c757d;
        }
        .lost .status-icon {
          color: #dc3545;
        }
        .converted .status-icon {
          color: #12B7C9;
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
          .funnel-stage {
            box-shadow: 0 10px 24px rgba(2, 6, 23, 0.4);
          }
          .funnel-kpi-pill {
            background: #0f172a;
            border-color: #1e293b;
            box-shadow: 0 8px 20px rgba(2, 6, 23, 0.35);
          }
          .funnel-kpi-pill.accent {
            background: linear-gradient(135deg, #312e81 0%, #134e4a 60%, #78350f 100%);
            border-color: #334155;
          }
          .funnel-kpi-pill span,
          .funnel-kpi-pill strong {
            color: #e2e8f0;
          }
          .funnel-meta strong,
          .funnel-count {
            color: #e2e8f0;
          }
          .funnel-meta span,
          .funnel-conversion {
            color: #94a3b8;
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

