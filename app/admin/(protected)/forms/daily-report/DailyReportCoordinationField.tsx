"use client";

import { useState } from "react";

type CoordinationFieldKey =
  | "inspections_received"
  | "equipment_notes"
  | "material_delivery"
  | "manpower_notes";

type CoordinationFieldConfig = {
  buttonLabel: string;
  label: string;
  placeholder: string;
};

const FIELD_CONFIG: Record<CoordinationFieldKey, CoordinationFieldConfig> = {
  inspections_received: {
    buttonLabel: "Add Inspections",
    label: "Inspections Received",
    placeholder: "List inspections received or note that there were none.",
  },
  equipment_notes: {
    buttonLabel: "Add Equipment Notes",
    label: "Equipment Notes",
    placeholder: "Add equipment notes, concerns, or status updates.",
  },
  material_delivery: {
    buttonLabel: "Add Material Delivery",
    label: "Material Delivery",
    placeholder: "Add delivery details, materials received, or delivery timing.",
  },
  manpower_notes: {
    buttonLabel: "Add Manpower Notes",
    label: "Manpower Notes",
    placeholder: "Add manpower notes, shortages, or staffing details.",
  },
};

export default function DailyReportCoordinationField() {
  const [activeFields, setActiveFields] = useState<
    Record<CoordinationFieldKey, boolean>
  >({
    inspections_received: false,
    equipment_notes: false,
    material_delivery: false,
    manpower_notes: false,
  });

  function showField(field: CoordinationFieldKey) {
    setActiveFields((current) => ({ ...current, [field]: true }));
  }

  function hideField(field: CoordinationFieldKey) {
    setActiveFields((current) => ({ ...current, [field]: false }));
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900">
            Jobsite Coordination Items
          </h3>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
            Optional
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-slate-600">
          Add coordination notes only for the items you need to report.
        </p>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {(Object.keys(FIELD_CONFIG) as CoordinationFieldKey[]).map((field) =>
          activeFields[field] ? null : (
            <button
              key={field}
              type="button"
              onClick={() => showField(field)}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
            >
              + {FIELD_CONFIG[field].buttonLabel}
            </button>
          )
        )}
      </div>

      {(Object.keys(FIELD_CONFIG) as CoordinationFieldKey[]).every(
        (field) => !activeFields[field]
      ) ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-4 text-sm text-slate-500">
          No coordination items added.
        </div>
      ) : (
        <div className="space-y-4">
          {(Object.keys(FIELD_CONFIG) as CoordinationFieldKey[]).map((field) =>
            activeFields[field] ? (
              <div
                key={field}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor={field}
                    className="block text-sm font-semibold text-slate-900"
                  >
                    {FIELD_CONFIG[field].label}
                  </label>

                  <button
                    type="button"
                    onClick={() => hideField(field)}
                    className="rounded-full px-3 py-1 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>

                <textarea
                  id={field}
                  name={field}
                  rows={3}
                  className="mt-3 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:bg-white"
                  placeholder={FIELD_CONFIG[field].placeholder}
                />
              </div>
            ) : null
          )}
        </div>
      )}
    </section>
  );
}
