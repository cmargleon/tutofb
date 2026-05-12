import React from 'react';

interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
}

interface AnalyticsChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
  labelFormatter?: (label: string | number | undefined) => string;
}

export const AnalyticsChartTooltip: React.FC<AnalyticsChartTooltipProps> = ({
  active,
  label,
  payload,
  labelFormatter,
}) => {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm shadow-md">
      <p className="font-medium text-gray-900">{labelFormatter ? labelFormatter(label) : label}</p>
      <div className="mt-1 space-y-0.5">
        {payload.map((item) => (
          <p key={`${item.name}-${item.color}`} className="flex items-center gap-2 text-gray-500">
            <span
              className="h-2 w-2 rounded-full bg-slate-400"
              aria-hidden="true"
            />
            <span>{item.name}: {item.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
};
