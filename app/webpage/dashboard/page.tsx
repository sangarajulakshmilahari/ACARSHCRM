"use client";

import React, { useEffect, useRef, useState } from "react";
import { Chart } from "chart.js/auto";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState<number>(0);
  const [statusCounts, setStatusCounts] = useState<Record<number, number>>({});
  const [leadsByStatus, setLeadsByStatus] = useState<
    { StatusName: string; count: number }[]
  >([]);
  const [leadsByOwner, setLeadsByOwner] = useState<
    { OwnerName: string; count: number }[]
  >([]);
  const [monthlyTrends, setMonthlyTrends] = useState<
    { MonthYear: string; OwnerName: string; count: number }[]
  >([]);

  const statusRef = useRef<HTMLCanvasElement>(null);
  const ownerRef = useRef<HTMLCanvasElement>(null);
  const monthlyRef = useRef<HTMLCanvasElement>(null);

  const statusChart = useRef<Chart | null>(null);
  const ownerChart = useRef<Chart | null>(null);
  const monthlyChart = useRef<Chart | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => {
        setTotalLeads(data.totalLeads);

        const map: Record<number, number> = {};
        data.statusCounts.forEach((s: any) => {
          map[s.StatusId] = s.count;
        });

        setStatusCounts(map);
        setLeadsByStatus(data.leadsByStatus);
        setLeadsByOwner(data.leadsByOwner);
        setMonthlyTrends(data.monthlyTrends);

        setLoading(false); 
      });
  }, []);

  useEffect(() => {
    if (!statusRef.current || leadsByStatus.length === 0) return;

    statusChart.current?.destroy();

    statusChart.current = new Chart(statusRef.current, {
      type: "bar",
      data: {
        labels: leadsByStatus.map((s) => s.StatusName), 
        datasets: [
          {
            label: " No.of Leads",
            data: leadsByStatus.map((s) => s.count), 
            backgroundColor: [
              "#28a745",
              "#17a2b8",
              "#ffc107",
              "#007bff",
              "#6c757d",
              "#dc3545",
              "#20c997",
            ],
            borderRadius: 1,
            borderColor: [
              "#1e7e34",
              "#138496",
              "#e0a800",
              "#0056b3",
              "#545b62",
              "#bd2130",
              "#1a9b7d",
            ],
            borderWidth: 2,
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
              stepSize: 10,
              precision: 0,
            },
            title: {
              display: true,
            },
          },
          x: {
            title: {
              display: true,
            },
          },
        },
      },
    });

    return () => {
      statusChart.current?.destroy();
    };
  }, [leadsByStatus]);

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
            backgroundColor: [
              "#007bff",
              "#28a745",
              "#ffc107",
              "#dc3545",
              "#17a2b8",
            ],

            borderColor: [
              "#0056b3",
              "#1e7e34",
              "#e0a800",
              "#bd2130",
              "#138496",
              "#5a2d91",
              "#e8590c",
              "#1a9b7d",
            ],
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
            ticks: { stepSize: 5, precision: 0 },
            title: {
              display: true,
            },
          },
          x: {
            title: {
              display: true,
            },
          },
        },
      },
    });

    return () => {
      ownerChart.current?.destroy();
    };
  }, [leadsByOwner]);

  const months = [
    "Jan 2025",
    "Feb 2025",
    "Mar 2025",
    "Apr 2025",
    "May 2025",
    "Jun 2025",
    "Jul 2025",
    "Aug 2025",
    "Sep 2025",
    "Oct 2025",
    "Nov 2025",
    "Dec 2025",
  ];

  const owners = Array.from(new Set(monthlyTrends.map((m) => m.OwnerName)));

  const datasets = owners.map((owner, index) => ({
    label: owner,
    data: months.map((month) => {
      const record = monthlyTrends.find(
        (m) => m.MonthYear === month && m.OwnerName === owner
      );
      return record ? record.count : 0;
    }),
    backgroundColor: ["#007bff", "#28a745", "#ffc107", "#dc3545", "#17a2b8"][
      index % 5
    ],
  }));

  useEffect(() => {
    if (!monthlyRef.current || monthlyTrends.length === 0) return;

    monthlyChart.current?.destroy();

    monthlyChart.current = new Chart(monthlyRef.current, {
      type: "bar",
      data: {
        labels: months, 
        datasets,
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
            },
            title: {
              display: true,
            },
          },
          x: {
            title: {
              display: true,
            },
          },
        },
      },
    });

    return () => {
      monthlyChart.current?.destroy();
    };
  }, [monthlyTrends]);

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
      >
        {/* Loading dashboard... */}
      </div>
    );
  }
  return (
    <>
      <div className="dashboard-container">
        {/* HEADER */}
        <div className="dashboard-header">
          <p style={{ fontSize: "25px", fontWeight: 600 }}>Leads Dashboard</p>
          <div className="total-count">
            Total Leads: <strong>{totalLeads}</strong>
          </div>
        </div>

        {/* STATUS CARDS */}
        <div className="status-cards-grid">
          {[
            { id: 1, cls: "new", icon: "fa-star", label: "New" },
            { id: 2, cls: "contacted", icon: "fa-phone", label: "Contacted" },
            { id: 3, cls: "followup", icon: "fa-clock", label: "Follow-Up" },
            {
              id: 4,
              cls: "qualified",
              icon: "fa-thumbs-up",
              label: "Qualified",
            },
            {
              id: 5,
              cls: "unqualified",
              icon: "fa-thumbs-down",
              label: "Unqualified",
            },
            { id: 6, cls: "lost", icon: "fa-times-circle", label: "Lost" },
            {
              id: 7,
              cls: "converted",
              icon: "fa-check-circle",
              label: "Converted",
            },
          ].map(({ id, cls, icon, label }) => {
            const count = statusCounts[id] || 0;
            const percentage = totalLeads
              ? ((count / totalLeads) * 100).toFixed(1)
              : "0";

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

        {/* CHARTS */}
        <div className="charts-row">
          <div className="chart-card">
            <div className="chart-header">
              <h3>Leads By Status</h3>
            </div>
            <div className="chart-container">
              <canvas ref={statusRef} />
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
          padding: 20px;
          background: #f8f9fa;
          min-height: 100vh;
        }
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fff;
          padding: 1px 14px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
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
          padding: 10px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
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
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .chart-card.full {
          margin-top: 20px;
        }
        .chart-header {
          text-align: center;
          border-bottom: 2px solid #f1f3f4;
          margin-bottom: 15px;
        }
        .chart-container {
          height: 280px;
        }

        @media (max-width: 1024px) {
          .status-cards-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }
        @media (max-width: 768px) {
          .charts-row {
            grid-template-columns: 1fr;
          }
          .status-cards-grid {
            grid-template-columns: repeat(2, 1fr);
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
      `}</style>
    </>
  );
}
