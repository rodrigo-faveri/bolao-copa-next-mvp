"use client";

import { useActionState } from "react";
import { createAssistantMatchAlert, type CreateMatchAlertState } from "../app/ai/actions";

const initialState: CreateMatchAlertState = { status: "idle" };

export function AssistantAlertActionButton({
  label,
  leadMinutes,
  matchId,
}: {
  label: string;
  leadMinutes: number;
  matchId: string;
}) {
  const [state, formAction, isPending] = useActionState(createAssistantMatchAlert, initialState);

  return (
    <form action={formAction} className="assistantInlineAction">
      <input name="matchId" type="hidden" value={matchId} />
      <input name="leadMinutes" type="hidden" value={leadMinutes} />
      <button className="buttonSecondary" disabled={isPending} type="submit">
        {isPending ? "Criando..." : label}
      </button>
      {state.status !== "idle" && (
        <small className={state.status === "success" ? "assistantActionSuccess" : "assistantActionError"} role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </small>
      )}
    </form>
  );
}
