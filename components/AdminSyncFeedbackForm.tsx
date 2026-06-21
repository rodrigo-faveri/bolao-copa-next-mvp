"use client";

import { useActionState, useEffect, useState } from "react";
import { formatMessage } from "../lib/i18n-shared";
import type { AdminSyncFeedbackState } from "../app/admin/actions";

const initialState: AdminSyncFeedbackState = { status: "idle" };

export function AdminSyncFeedbackForm({
  action,
  buttonLabel,
  closeLabel,
  errorTitle,
  hint,
  loadingLabel,
  runningText,
  runningTitle,
  successSummary,
  successTitle,
}: {
  action: (state: AdminSyncFeedbackState, formData: FormData) => Promise<AdminSyncFeedbackState>;
  buttonLabel: string;
  closeLabel: string;
  errorTitle: string;
  hint: string;
  loadingLabel: string;
  runningText: string;
  runningTitle: string;
  successSummary: string;
  successTitle: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [isToastVisible, setIsToastVisible] = useState(false);

  useEffect(() => {
    if (isPending || state.status !== "idle") setIsToastVisible(true);
  }, [isPending, state.status, state.submittedAt]);

  const toastStatus = isPending ? "running" : state.status;
  const showToast = isToastVisible && toastStatus !== "idle";

  return (
    <>
      <form action={formAction} className="adminSyncAction">
        <button disabled={isPending} type="submit">{isPending ? loadingLabel : buttonLabel}</button>
        <span>{hint}</span>
      </form>

      {showToast && (
        <div
          aria-live={toastStatus === "error" ? "assertive" : "polite"}
          className={`adminSyncToast adminSyncToast${toastStatus === "error" ? "Error" : toastStatus === "success" ? "Success" : "Running"}`}
          role={toastStatus === "error" ? "alert" : "status"}
        >
          <div>
            <strong>{toastStatus === "running" ? runningTitle : toastStatus === "error" ? errorTitle : successTitle}</strong>
            <p>
              {toastStatus === "running"
                ? runningText
                : toastStatus === "error"
                  ? state.message
                  : formatMessage(successSummary, {
                    candidates: state.candidates ?? 0,
                    imported: state.imported ?? 0,
                    skipped: state.skipped ?? 0,
                  })}
            </p>
          </div>
          {toastStatus !== "running" && (
            <button aria-label={closeLabel} onClick={() => setIsToastVisible(false)} type="button">
              x
            </button>
          )}
        </div>
      )}
    </>
  );
}
