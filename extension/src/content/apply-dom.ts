/**
 * DOM pre-fill applier (the ONLY impure part of pre-fill).
 *
 * Walks a PrefillPlan and writes values into matching form fields. It NEVER
 * clicks a submit button — the user must approve and submit themselves
 * (LEGITIMACY RULE 2). It dispatches input/change events so SPA frameworks
 * (React/Vue on JobVision) register the value.
 */
import { buildPrefillPlan } from "@ext/lib/prefill-plan";
import type { ApplyQueueItem } from "@ext/lib/types";

export interface ApplyDomResult {
  ok: boolean;
  filledFields: string[];
  message?: string;
}

/** Set a field's value in a framework-friendly way and emit input/change. */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Apply a queue item's pre-fill plan to the current document.
 * Returns which labelled fields were successfully filled (for the approval UI).
 */
export function applyPrefill(item: ApplyQueueItem, doc: Document = document): ApplyDomResult {
  const plan = buildPrefillPlan(item);
  const filledFields: string[] = [];

  for (const field of plan.fields) {
    let target: HTMLInputElement | HTMLTextAreaElement | null = null;
    for (const selector of field.selectorCandidates) {
      const found = doc.querySelector(selector);
      if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) {
        target = found;
        break;
      }
    }
    if (target) {
      setFieldValue(target, field.value);
      filledFields.push(field.label);
    }
  }

  if (filledFields.length === 0) {
    return {
      ok: false,
      filledFields,
      message: "هیچ فیلد قابل‌تکمیلی پیدا نشد — ممکن است فرم اپلای باز نباشد.",
    };
  }
  return { ok: true, filledFields };
}
