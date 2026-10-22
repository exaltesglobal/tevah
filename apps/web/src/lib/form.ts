import type { z } from "zod";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** What was submitted, so React's post-action form reset doesn't wipe the user's input. */
  values?: Record<string, string>;
  /** Set when a form that stays on the page saved successfully. */
  saved?: boolean;
}

export const emptyForm: FormState = {};

/** Plain object of a FormData, trimming strings and turning blanks into undefined. */
export function formValues(data: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    out[key] = trimmed === "" ? undefined : trimmed;
  }
  return out;
}

/** Submitted text fields (secrets excluded) for echoing back into a failed form. */
export function submitted(data: FormData, omit: readonly string[] = ["password"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === "string" && !omit.includes(key)) out[key] = value;
  }
  return out;
}

export function zodErrors(error: z.ZodError, data?: FormData): FormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    fieldErrors[key] ??= issue.message;
  }
  return { error: "Please fix the highlighted fields.", fieldErrors, values: data && submitted(data) };
}
