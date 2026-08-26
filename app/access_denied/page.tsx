'use client';

import React, { useState } from 'react';

export default function AccessDenied() {
  const userEmail = 'user@example.com';
  const applicationName = 'Sales CRM';
  const supportEmail = 'support@example.com';
  const isLoading = false;
  const reason = undefined;
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  const reasons = [
    {
      id: 'notProvisioned',
      title: 'Account Not Provisioned',
      description: 'Your account has not been set up for this application yet.',
      icon: '🔑',
    },
    {
      id: 'pendingApproval',
      title: 'Access Pending Approval',
      description: 'Your access request is still being reviewed by administrators.',
      icon: '⏳',
    },
    {
      id: 'roleRestricted',
      title: 'Role Not Authorized',
      description: 'Your current role does not include permissions for this application.',
      icon: '👤',
    },
    {
      id: 'authError',
      title: 'Authentication Issue',
      description: 'There was a temporary issue verifying your credentials.',
      icon: '⚠️',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-2xl">
        {/* Main Card */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-slate-100">
          
          {/* Header Section with Illustration */}
          <div className="relative bg-gradient-to-r from-blue-600 to-blue-700 px-6 sm:px-8 py-12 sm:py-16 text-center overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 right-0 w-40 h-40 bg-white rounded-full -mr-20 -mt-20"></div>
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-white rounded-full -ml-16 -mb-16"></div>
            </div>

            <div className="relative z-10">
              {/* Icon Container */}
              <div className="mx-auto mb-6 w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm ring-2 ring-white/40 transition-transform hover:scale-105">
                <svg className="w-10 h-10 sm:w-12 sm:h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm6-10V7a3 3 0 00-6 0v4a3 3 0 006 0z" />
                </svg>
              </div>

              {/* Headline */}
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                Access Restricted
              </h1>

              {/* Supporting Text */}
              <p className="text-blue-100 text-base sm:text-lg max-w-md mx-auto">
                You currently do not have permission to access this application.
              </p>
            </div>
          </div>

          {/* Content Section */}
          <div className="px-6 sm:px-8 py-8 sm:py-10">
            
            {/* Loading State */}
            {isLoading && (
              <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-5 w-5">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  </div>
                </div>
                <p className="text-sm text-blue-700">Validating your permissions...</p>
              </div>
            )}

            {/* Possible Reasons Card */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0-12a9 9 0 110 18 9 9 0 010-18z" />
                </svg>
                <h2 className="text-lg font-semibold text-slate-900">
                  Possible Reasons
                </h2>
              </div>

              <div className="space-y-3">
                {reasons.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedReason(selectedReason === item.id ? null : item.id)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      selectedReason === item.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0">{item.icon}</span>
                      <div>
                        <p className="font-medium text-slate-900">{item.title}</p>
                        <p className="text-sm text-slate-600 mt-1">{item.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* User Info Section */}
            <div className="bg-slate-50 rounded-lg p-4 mb-8 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-3 text-sm">Session Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Email:</span>
                  <span className="font-medium text-slate-900">{userEmail}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Application:</span>
                  <span className="font-medium text-slate-900">{applicationName}</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {/* Primary Button */}
              <a
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#F26522] text-white font-medium rounded-lg hover:bg-[#E45816] transition-colors active:bg-[#D94F11] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 col-span-1 sm:col-span-2 lg:col-span-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Return to Dashboard
              </a>

              {/* Secondary Button */}
              <a
                href="/access_denied"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-200 text-slate-900 font-medium rounded-lg hover:bg-slate-300 transition-colors active:bg-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
              >
              
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Login Again
              </a>
            </div>

            {/* Tertiary Link - Contact Admin */}
            <a
              href={`mailto:${supportEmail}`}
              className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 text-[#F26522] font-medium rounded-lg hover:bg-orange-50 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Contact Administrator
            </a>
          </div>

          {/* Help Section Footer */}
          <div className="bg-slate-50 px-6 sm:px-8 py-6 border-t border-slate-200">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.25 9a3.75 3.75 0 117.28 1.28c-.67 1.07-1.78 1.44-2.49 2.14-.48.47-.79 1.05-.79 2.08m0 3h.01M12 21a9 9 0 110-18 9 9 0 010 18z"
                />
              </svg>
              <div className="text-sm">
                <p className="font-medium text-slate-900 mb-1">Need Help?</p>
                <p className="text-slate-600">
                  If you believe you should have access, please contact your administrator at{' '}
                  <a
                    href={`mailto:${supportEmail}`}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    {supportEmail}
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Information */}
        <div className="mt-6 text-center text-sm text-slate-600">
          <p>
            Having trouble? Check your{' '}
            <a href="#" className="text-blue-600 hover:underline">
              email
            </a>{' '}
            for any access notifications.
          </p>
        </div>
      </div>
    </div>
  );
}
