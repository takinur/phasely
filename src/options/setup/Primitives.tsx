/**
 * Primitives.tsx — shared Options-page UI atoms.
 *
 * Lifted out of Options.tsx so the setup wizard and the remaining settings
 * sections render identical headers and alerts from one definition.
 */

import type { ReactNode } from "react";

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="options-heading text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && (
          <p className="options-subheading text-sm text-gray-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Alert({
  type,
  children,
}: {
  type: "success" | "error" | "info" | "warning";
  children: ReactNode;
}) {
  const classes = {
    success: "options-alert-success bg-green-50 border-green-200 text-green-800",
    error: "options-alert-error bg-red-50 border-red-200 text-red-800",
    info: "options-alert-info bg-indigo-50 border-indigo-200 text-indigo-800",
    warning: "options-alert-warning bg-amber-50 border-amber-200 text-amber-800",
  }[type];

  return (
    <div className={`options-alert rounded-md border px-4 py-3 text-sm ${classes}`}>
      {children}
    </div>
  );
}
