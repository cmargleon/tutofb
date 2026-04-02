import React from 'react';

interface AnalyticsReviewMetricProps {
  label: string;
  value: string | number;
  detail: string;
}

export function AnalyticsReviewMetric({ label, value, detail }: AnalyticsReviewMetricProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{detail}</p>
    </div>
  );
}
