import React, { useState } from 'react';
import { Batch, Job } from '../../../shared/src/types';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { JobTraceabilityPanel } from './JobTraceabilityPanel';

export const CollapsibleTraceability: React.FC<{ batch: Batch; job: Job }> = ({ batch, job }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        <span>Trazabilidad del job</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open ? (
        <div className="border-t border-slate-100">
          <JobTraceabilityPanel batch={batch} job={job} />
        </div>
      ) : null}
    </div>
  );
};
