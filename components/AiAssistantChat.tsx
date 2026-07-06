"use client";

import { useState } from "react";
import { AssistantAlertActionButton } from "./AssistantAlertActionButton";
import type { AppLocale } from "../lib/i18n-shared";
import { t } from "../lib/i18n-shared";

type AssistantMessage = {
  role: "user" | "assistant";
  actions?: AssistantAction[];
  content: string;
  sources?: Array<{ label: string; url?: string }>;
  tools?: string[];
};

type AssistantAction =
  | { href: string; label: string; type?: "link" }
  | { label: string; leadMinutes: number; matchId: string; type: "create_alert" }
  | { href: string; label: string; matchId: string; type: "focus_match" }
  | { goalsA: number; goalsB: number; href: string; label: string; matchId: string; type: "apply_pick" };

const quickQuestions = [
  "Quais palpites ainda preciso fazer?",
  "Me sugira uma estrategia conservadora para a proxima rodada.",
  "O que as noticias recentes podem influenciar nos palpites?",
  "Como estou no ranking e onde posso melhorar?",
];

export function AiAssistantChat({ locale = "pt-BR", variant = "page" }: { locale?: AppLocale; variant?: "page" | "widget" }) {
  const copy = t(locale);
  const [isOpen, setIsOpen] = useState(variant === "page");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([
    { role: "assistant", content: copy.assistant.welcome },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  async function askAssistant(nextQuestion: string) {
    const trimmedQuestion = nextQuestion.trim();
    if (!trimmedQuestion || isLoading) return;

    setQuestion("");
    setIsLoading(true);
    setMessages((current) => [...current, { role: "user", content: trimmedQuestion }]);
    if (variant === "widget") {
      setIsOpen(false);
    }

    try {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion }),
      });
      const payload = await response.json().catch(() => null) as {
        actions?: AssistantAction[];
        answer?: string;
        error?: string;
        sources?: Array<{ label: string; url?: string }>;
        toolsUsed?: string[];
      } | null;

      if (!response.ok) {
        setMessages((current) => [...current, { role: "assistant", content: payload?.error || copy.assistant.error }]);
        return;
      }

      setMessages((current) => [...current, {
        role: "assistant",
        actions: payload?.actions ?? [],
        content: payload?.answer || copy.assistant.empty,
        sources: payload?.sources ?? [],
        tools: payload?.toolsUsed ?? [],
      }]);
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: copy.assistant.error }]);
    } finally {
      setIsLoading(false);
    }
  }

  function applySuggestedPick(action: Extract<AssistantAction, { type: "apply_pick" }>) {
    window.dispatchEvent(new CustomEvent("bolao:apply-pick", {
      detail: {
        goalsA: action.goalsA,
        goalsB: action.goalsB,
        matchId: action.matchId,
      },
    }));

    window.setTimeout(() => {
      if (!document.getElementById(`match-${action.matchId}`)) {
        window.location.href = action.href;
      }
    }, 120);
  }

  function focusSuggestedMatch(action: Extract<AssistantAction, { type: "focus_match" }>) {
    window.dispatchEvent(new CustomEvent("bolao:focus-match", {
      detail: { matchId: action.matchId },
    }));

    window.setTimeout(() => {
      if (!document.getElementById(`match-${action.matchId}`)) {
        window.location.href = action.href;
      }
    }, 120);
  }

  const chat = (
    <section className={`assistantShell ${variant === "page" ? "card" : "assistantWidgetPanel"}`}>
      <div className="assistantIntro">
        <span className="badge badgeGold">{copy.assistant.badge}</span>
        <h2>{copy.assistant.chatTitle}</h2>
        <p className="muted">{copy.assistant.chatDescription}</p>
        {variant === "widget" && (
          <button className="assistantWidgetClose" onClick={() => setIsOpen(false)} type="button" aria-label={copy.assistant.close}>
            x
          </button>
        )}
      </div>

      <div className="assistantQuickQuestions">
        {quickQuestions.map((item) => (
          <button className="buttonSecondary" disabled={isLoading} key={item} onClick={() => askAssistant(item)} type="button">
            {item}
          </button>
        ))}
      </div>

      <div className="assistantMessages" aria-live="polite">
        {messages.map((message, index) => (
          <article className={`assistantMessage assistantMessage${message.role === "user" ? "User" : "Bot"}`} key={`${message.role}-${index}`}>
            <strong>{message.role === "user" ? copy.assistant.you : copy.assistant.assistant}</strong>
            <p>{message.content}</p>
            {message.tools && message.tools.length > 0 && (
              <div className="assistantTools">
                <span>{copy.assistant.toolsUsed}</span>
                <small>{message.tools.join(", ")}</small>
              </div>
            )}
            {message.actions && message.actions.length > 0 && (
              <div className="assistantActions">
                <span>{copy.assistant.suggestedActions}</span>
                <div>
                  {message.actions.map((action) => action.type === "apply_pick" ? (
                    <button
                      className="buttonSecondary"
                      key={`${action.matchId}-${action.goalsA}-${action.goalsB}`}
                      onClick={() => applySuggestedPick(action)}
                      type="button"
                    >
                      {action.label}
                    </button>
                  ) : action.type === "create_alert" ? (
                    <AssistantAlertActionButton
                      key={`${action.matchId}-${action.leadMinutes}`}
                      label={action.label}
                      leadMinutes={action.leadMinutes}
                      matchId={action.matchId}
                    />
                  ) : action.type === "focus_match" ? (
                    <button
                      className="buttonSecondary"
                      key={`${action.matchId}-${action.href}`}
                      onClick={() => focusSuggestedMatch(action)}
                      type="button"
                    >
                      {action.label}
                    </button>
                  ) : (
                    <a className="buttonLink buttonSecondary" href={action.href} key={action.href}>{action.label}</a>
                  ))}
                </div>
              </div>
            )}
            {message.sources && message.sources.length > 0 && (
              <div className="assistantSources">
                <span>{copy.assistant.sources}</span>
                {message.sources.map((source) => source.url ? (
                  <a href={source.url} key={source.label} rel="noreferrer" target="_blank">{source.label}</a>
                ) : (
                  <small key={source.label}>{source.label}</small>
                ))}
              </div>
            )}
          </article>
        ))}
        {isLoading && <article className="assistantMessage assistantMessageBot"><strong>{copy.assistant.assistant}</strong><p>{copy.common.loading}</p></article>}
      </div>

      <form className="assistantForm" onSubmit={(event) => { event.preventDefault(); void askAssistant(question); }}>
        <label>
          <span>{copy.assistant.questionLabel}</span>
          <textarea
            maxLength={800}
            minLength={4}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={copy.assistant.placeholder}
            value={question}
          />
        </label>
        <button disabled={isLoading || question.trim().length < 4} type="submit">
          {isLoading ? copy.assistant.thinking : copy.assistant.send}
        </button>
      </form>
    </section>
  );

  if (variant === "page") return chat;

  return (
    <div className="assistantWidget">
      {isOpen && chat}
      <button
        aria-expanded={isOpen}
        aria-busy={isLoading}
        aria-label={copy.assistant.open}
        className={`assistantWidgetButton ${isLoading ? "assistantWidgetButtonLoading" : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="assistantRobotIcon" aria-hidden="true">
          <span className="assistantRobotAntenna" />
          <span className="assistantRobotFace">
            <span />
            <span />
          </span>
          <span className="assistantRobotMouth" />
        </span>
        {isLoading && <span className="srOnly">{copy.assistant.thinking}</span>}
      </button>
    </div>
  );
}
