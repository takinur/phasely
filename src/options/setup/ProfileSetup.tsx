/**
 * ProfileSetup.tsx — the primary profile authoring path.
 *
 * Three short steps of plain labelled inputs. No markdown, no YAML, no front
 * matter: the form synthesizes a valid profile.md on save (see
 * buildProfileMarkdownFromForm) and sends it to the service worker, which
 * remains the only writer to encrypted storage.
 *
 * Progressive gating: firstName, lastName, email, phone, location and workAuth
 * are what a first fill needs. Everything else is a soft nudge — never a
 * blocking error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildProfileMarkdownFromForm,
  parseProfile,
  PROFILE_FIELD_LABELS,
  ProfileParseError,
  profileToFormValues,
  validateProfileForm,
  type ProfileFormField,
  type ProfileFormValues,
} from "@/lib/profile";
import type { Profile } from "@/lib/types";
import { MarkdownAdvanced } from "./MarkdownAdvanced";
import { Alert, SectionHeader } from "./Primitives";
import { sendMsg } from "./messaging";
import { StepContact, StepEligibility, StepExperience, type StepProps } from "./ProfileSteps";

const STEPS: readonly {
  id: string;
  title: string;
  blurb: string;
  fields: readonly ProfileFormField[];
  Component: (props: StepProps) => React.JSX.Element;
}[] = [
  {
    id: "contact",
    title: "Contact",
    blurb: "Who you are and how employers reach you.",
    fields: ["firstName", "lastName", "email", "phone", "location", "linkedin", "github", "portfolio"],
    Component: StepContact,
  },
  {
    id: "eligibility",
    title: "Eligibility & preferences",
    blurb: "The questions almost every application form asks.",
    fields: [
      "workAuth",
      "remotePreference",
      "noticePeriod",
      "salaryExpectation",
      "willingToRelocate",
      "referencesAvailable",
    ],
    Component: StepEligibility,
  },
  {
    id: "experience",
    title: "Experience",
    blurb: "What you've done — used for fills and as AI context.",
    fields: [
      "currentTitle",
      "currentCompany",
      "yearsExperience",
      "skills",
      "education",
      "notes",
    ],
    Component: StepExperience,
  },
];

export function ProfileSetup({
  profile,
  onProfileSaved,
}: {
  profile: Profile | null;
  onProfileSaved: (profile: Profile) => void;
}) {
  const [values, setValues] = useState<ProfileFormValues>(() => profileToFormValues(profile));
  const hydratedRef = useRef(profile !== null);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState<Partial<Record<ProfileFormField, boolean>>>({});
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [mode, setMode] = useState<"form" | "markdown">("form");
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [applyErrors, setApplyErrors] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // The profile arrives asynchronously after mount — hydrate the form once.
  useEffect(() => {
    if (profile && !hydratedRef.current) {
      hydratedRef.current = true;
      setValues(profileToFormValues(profile));
    }
  }, [profile]);

  const validation = useMemo(() => validateProfileForm(values), [values]);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(profileToFormValues(profile)),
    [values, profile],
  );

  const onChange = useCallback((patch: Partial<ProfileFormValues>) => {
    // Typing counts as hydration: a late-arriving stored profile must never
    // overwrite what the user is in the middle of entering.
    hydratedRef.current = true;
    setValues((prev) => ({ ...prev, ...patch }));
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  const onTouch = useCallback((field: ProfileFormField) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const errorFor = useCallback(
    (field: ProfileFormField): string | undefined =>
      touched[field] || attemptedSave ? validation.errors[field] : undefined,
    [touched, attemptedSave, validation],
  );

  const saveMarkdown = useCallback(
    async (markdown: string) => {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(false);
      try {
        const res = await sendMsg<{ ok: boolean; profile: Profile; error?: string }>({
          type: "SAVE_PROFILE",
          markdown,
        });
        if (!res.ok) throw new Error(res.error ?? "Save failed");
        onProfileSaved(res.profile);
        hydratedRef.current = true;
        setValues(profileToFormValues(res.profile));
        setSaveSuccess(true);
      } catch (err) {
        console.error("[Phasely] profile save failed:", err);
        setSaveError(String(err));
      } finally {
        setSaving(false);
      }
    },
    [onProfileSaved],
  );

  const handleSaveForm = useCallback(() => {
    setAttemptedSave(true);
    if (!validation.savable) {
      // Jump to the step that owns the first unresolved error so the inline
      // message is actually on screen.
      const firstBad = (Object.keys(validation.errors) as ProfileFormField[])[0];
      const target = STEPS.findIndex((s) => s.fields.includes(firstBad));
      if (target >= 0) setStep(target);
      return;
    }
    void saveMarkdown(buildProfileMarkdownFromForm(values));
  }, [validation, values, saveMarkdown]);

  const enterMarkdownMode = useCallback(() => {
    setMarkdownDraft(buildProfileMarkdownFromForm(values));
    setApplyErrors(null);
    setMode("markdown");
  }, [values]);

  const applyMarkdownToForm = useCallback(() => {
    try {
      const parsed = parseProfile(markdownDraft);
      setValues(profileToFormValues(parsed));
      setApplyErrors(null);
      setMode("form");
      setSaveSuccess(false);
    } catch (err) {
      setApplyErrors(err instanceof ProfileParseError ? err.fields : [String(err)]);
    }
  }, [markdownDraft]);

  const downloadMarkdown = useCallback((markdown: string) => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "profile.md";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const StepBody = STEPS[step].Component;

  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Your profile"
        subtitle={
          profile
            ? "Phasely fills job application forms from these fields. Update them any time."
            : "Fill in a few fields and Phasely can complete job application forms in one click. Takes about two minutes — no file formats to learn."
        }
        action={
          <button
            type="button"
            onClick={mode === "form" ? enterMarkdownMode : () => setMode("form")}
            className="options-profile-export text-xs"
          >
            {mode === "form" ? "Edit as markdown" : "Back to form"}
          </button>
        }
      />

      {mode === "markdown" ? (
        <MarkdownAdvanced
          markdown={markdownDraft}
          onMarkdownChange={(md) => {
            setMarkdownDraft(md);
            setApplyErrors(null);
            setSaveSuccess(false);
          }}
          onApplyToForm={applyMarkdownToForm}
          applyErrors={applyErrors}
          onSave={() => void saveMarkdown(markdownDraft)}
          onExport={() => downloadMarkdown(markdownDraft)}
          canExport={markdownDraft.trim().length > 0}
          saving={saving}
        />
      ) : (
        <div className="space-y-5">
          <ReadinessBanner
            readyToFill={validation.readyToFill}
            blocking={validation.blocking}
            nudges={validation.nudges}
            hasProfile={profile !== null}
          />

          {/* Stepper */}
          <nav aria-label="Setup steps" className="flex gap-2">
            {STEPS.map((s, index) => {
              const hasError = s.fields.some((f) => errorFor(f) !== undefined);
              const active = index === step;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(index)}
                  aria-current={active ? "step" : undefined}
                  className={[
                    "flex-1 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                    active
                      ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                      : "options-inset text-gray-600 hover:border-gray-400",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    <span
                      className={[
                        "inline-block h-1.5 w-1.5 rounded-full",
                        hasError ? "bg-red-500" : active ? "bg-indigo-500" : "bg-gray-300",
                      ].join(" ")}
                    />
                    {index + 1}. {s.title}
                  </span>
                </button>
              );
            })}
          </nav>

          <p className="options-profile-help text-xs">{STEPS[step].blurb}</p>

          <StepBody
            values={values}
            onChange={onChange}
            errorFor={errorFor}
            onTouch={onTouch}
            educationErrors={
              // Same touched-or-attempted rule as every other field, so a
              // half-typed year doesn't shout at the user mid-keystroke.
              touched.education || attemptedSave ? validation.educationErrors : []
            }
          />

          {saveError && <Alert type="error">{saveError}</Alert>}
          {saveSuccess && <Alert type="success">Profile saved and encrypted.</Alert>}

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className={[
                  "options-btn-secondary rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  step === 0 ? "opacity-40 cursor-not-allowed" : "",
                ].join(" ")}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                disabled={step === STEPS.length - 1}
                className={[
                  "options-btn-secondary rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  step === STEPS.length - 1 ? "opacity-40 cursor-not-allowed" : "",
                ].join(" ")}
              >
                Next
              </button>
            </div>

            <div className="flex items-center gap-3">
              {dirty && !saving && (
                <span className="options-profile-help text-xs">Unsaved changes</span>
              )}
              <button
                type="button"
                onClick={handleSaveForm}
                disabled={saving}
                className={[
                  "options-btn-primary rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  saving ? "opacity-50 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {saving ? "Saving…" : profile ? "Save changes" : "Save profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Readiness + nudges
// ---------------------------------------------------------------------------

function ReadinessBanner({
  readyToFill,
  blocking,
  nudges,
  hasProfile,
}: {
  readyToFill: boolean;
  blocking: ProfileFormField[];
  nudges: ProfileFormField[];
  hasProfile: boolean;
}) {
  const nudgeLine =
    nudges.length > 0 ? (
      <span className="block mt-1 text-xs opacity-90">
        {nudges.length} optional field{nudges.length === 1 ? "" : "s"} left to improve your
        match rate — {nudges.slice(0, 4).map((f) => PROFILE_FIELD_LABELS[f]).join(", ")}
        {nudges.length > 4 ? ", and more" : ""}.
      </span>
    ) : null;

  if (!readyToFill) {
    return (
      <Alert type="warning">
        <span className="font-semibold">
          {blocking.length} field{blocking.length === 1 ? "" : "s"} needed before your first
          fill:
        </span>{" "}
        {blocking.map((f) => PROFILE_FIELD_LABELS[f]).join(", ")}. Everything else is
        optional.
        {nudgeLine}
      </Alert>
    );
  }

  return (
    <Alert type="success">
      <span className="font-semibold">Ready to fill.</span>{" "}
      {hasProfile
        ? "Phasely has what it needs for a one-click fill."
        : "Save to start filling applications in one click."}
      {nudgeLine}
    </Alert>
  );
}
