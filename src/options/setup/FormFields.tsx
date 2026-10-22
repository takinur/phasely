/**
 * FormFields.tsx — plain labelled inputs for the guided setup form.
 *
 * Every field renders its own validation message directly underneath itself:
 * "That doesn't look like a phone number" next to the phone input, never a
 * single error summary at the bottom of the page.
 *
 * Styling reuses the existing .options-* CSS variables so these inputs follow
 * the page's light/dark theme without new stylesheet rules.
 */

import type { ReactNode } from "react";

const BASE_INPUT =
  "options-input w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent";

function inputClasses(hasError: boolean): string {
  return [
    BASE_INPUT,
    hasError
      ? "border-red-400 focus:ring-red-400"
      : "border-gray-300 focus:ring-indigo-500",
  ].join(" ");
}

function FieldShell({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="options-heading block text-sm font-medium mb-1.5">
        {label}
        {required && <span className="ml-1 text-indigo-500">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="options-profile-help mt-1 text-xs">{hint}</p>
      )}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  placeholder,
  type = "text",
  suggestions,
  autoComplete = "off",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "url" | "number";
  /** Rendered as a datalist — suggestions, not a forced choice. */
  suggestions?: readonly string[];
  autoComplete?: string;
}) {
  const listId = suggestions && suggestions.length > 0 ? `${id}-options` : undefined;
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        list={listId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClasses(Boolean(error))}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions?.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  placeholder,
  rows = 5,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClasses(Boolean(error))} resize-y`}
      />
    </FieldShell>
  );
}

export function ToggleField({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="options-heading block text-sm font-medium">
          {label}
        </label>
        {hint && <p className="options-profile-help mt-0.5 text-xs">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
          checked ? "bg-indigo-600" : "bg-gray-200",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

/** Two fields side by side on wide screens, stacked on narrow ones. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}
