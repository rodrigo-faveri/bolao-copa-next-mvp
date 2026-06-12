import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../auth";
import { logger } from "../../../../lib/logger";
import { MAX_GOALS } from "../../../../lib/prediction";
import { prisma } from "../../../../lib/prisma";
import { assertRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

const requestSchema = z.object({
  matchId: z.string().cuid(),
});

const aiAnalysisSchema = z.object({
  favorite: z.string().min(1).max(80),
  risk: z.enum(["Baixo", "Medio", "Alto"]),
  conservativeGoalsA: z.number().int().min(0).max(MAX_GOALS),
  conservativeGoalsB: z.number().int().min(0).max(MAX_GOALS),
  boldGoalsA: z.number().int().min(0).max(MAX_GOALS),
  boldGoalsB: z.number().int().min(0).max(MAX_GOALS),
  explanation: z.string().min(20).max(420),
  source: z.enum(["openrouter", "local"]).default("openrouter"),
});

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

type MatchForAnalysis = {
  group: string;
  teamA: string;
  teamB: string;
  startsAt: Date | null;
};

function userSafetyId(email: string) {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 64);
}

function getOutputText(response: unknown) {
  if (typeof response !== "object" || response === null) return null;
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;

  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) return null;
  const message = (firstChoice as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function getFinishReason(response: unknown) {
  if (typeof response !== "object" || response === null) return null;
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) return null;
  const finishReason = (firstChoice as { finish_reason?: unknown }).finish_reason;
  return typeof finishReason === "string" ? finishReason : null;
}

function getOpenRouterErrorMessage(status: number, body: string) {
  if (status === 401) return "A chave OPENROUTER_API_KEY parece invalida. Confira a chave no .env e reinicie o servidor.";
  if (status === 402) return "O OpenRouter pediu credito para este modelo. Tente um modelo com sufixo :free.";
  if (status === 403) return "Sua chave do OpenRouter nao tem permissao para esse modelo.";
  if (status === 404) return "Modelo do OpenRouter nao encontrado. Confira OPENROUTER_MODEL no .env.";
  if (status === 429) return "Limite do modelo free atingido no OpenRouter. Vou usar a sugestao local.";

  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") return parsed.error.message;
  } catch {
    // Keep the generic fallback below.
  }

  return "Nao consegui consultar o OpenRouter agora. Vou usar a sugestao local.";
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

function makeLocalAnalysis(match: MatchForAnalysis, reason: string) {
  const seed = stableHash(`${match.group}:${match.teamA}:${match.teamB}`);
  const edge = seed % 5;
  const teamAEdge = edge === 0 || edge === 3;
  const drawish = edge === 2 || edge === 4;

  const favorite = drawish ? "Jogo equilibrado" : teamAEdge ? match.teamA : match.teamB;
  const risk = drawish ? "Alto" : edge === 3 ? "Baixo" : "Medio";
  const conservativeGoalsA = drawish ? 1 : teamAEdge ? 1 : 0;
  const conservativeGoalsB = drawish ? 1 : teamAEdge ? 0 : 1;
  const boldGoalsA = drawish ? 2 : teamAEdge ? 2 : 1;
  const boldGoalsB = drawish ? 2 : teamAEdge ? 1 : 2;

  return {
    favorite,
    risk,
    conservativeGoalsA,
    conservativeGoalsB,
    boldGoalsA,
    boldGoalsB,
    explanation: `Sugestao local gerada sem dados em tempo real (${reason}). Ela usa um padrao conservador para bolao: placares baixos, risco de empate e uma alternativa um pouco mais ousada.`,
    source: "local" as const,
  };
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return jsonNoStore({ error: "Faca login para usar a IA." }, { status: 401 });
  }

  try {
    await assertRateLimit(`ai-match:${email}`, 12, 60 * 1000);
  } catch (error) {
    return jsonNoStore({ error: error instanceof Error ? error.message : "Aguarde um minuto e tente novamente." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return jsonNoStore({ error: "Partida invalida." }, { status: 400 });
  }

  const match = await prisma.match.findUnique({
    where: { id: parsedRequest.data.matchId },
    select: { group: true, teamA: true, teamB: true, startsAt: true, resultGoalsA: true, resultGoalsB: true },
  });

  if (!match) {
    return jsonNoStore({ error: "Partida nao encontrada." }, { status: 404 });
  }

  if (match.resultGoalsA !== null && match.resultGoalsB !== null) {
    return jsonNoStore({ error: "Esta partida ja tem resultado final." }, { status: 409 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn("ai_match_analysis_local_fallback", { reason: "missing_openrouter_key", matchId: parsedRequest.data.matchId });
    return jsonNoStore(makeLocalAnalysis(match, "sem chave do OpenRouter configurada"));
  }

  const model = process.env.OPENROUTER_MODEL || "nex-agi/nex-n2-pro:free";
  const matchDate = match.startsAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(match.startsAt)
    : "horario a definir";

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.AUTH_URL || "http://localhost:3000",
      "X-Title": "Bolao Copa 2026",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Responda somente JSON valido, sem markdown e sem texto extra. Seja curto. Nao afirme ter dados em tempo real.",
        },
        {
          role: "user",
          content: `Partida: ${match.teamA} x ${match.teamB}. Grupo ${match.group}. Data ${matchDate}. Retorne JSON com: favorite, risk ("Baixo","Medio","Alto"), conservativeGoalsA, conservativeGoalsB, boldGoalsA, boldGoalsB, explanation. Placar entre 0 e ${MAX_GOALS}. Explanation em uma frase curta.`,
        },
      ],
      max_tokens: 900,
      max_completion_tokens: 900,
      temperature: 0.4,
      response_format: { type: "json_object" },
      user: userSafetyId(email),
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    logger.error("openrouter_match_analysis_failed", {
      status: response.status,
      model,
      bodyPreview: responseBody.slice(0, 500),
    });
    if ([402, 429, 500, 502, 503, 504].includes(response.status)) {
      return jsonNoStore(makeLocalAnalysis(match, getOpenRouterErrorMessage(response.status, responseBody)));
    }

    return jsonNoStore({ error: getOpenRouterErrorMessage(response.status, responseBody) }, { status: 502 });
  }

  const rawResponse: unknown = await response.json();
  const outputText = getOutputText(rawResponse);
  if (!outputText) {
    logger.error("openrouter_match_analysis_empty_content", {
      finishReason: getFinishReason(rawResponse),
      responsePreview: JSON.stringify(rawResponse).slice(0, 500),
    });
    return jsonNoStore({ error: "A IA retornou uma resposta vazia." }, { status: 502 });
  }

  let parsedJson: unknown;
  try {
    const normalizedOutput = outputText.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    parsedJson = JSON.parse(normalizedOutput);
  } catch {
    logger.error("openrouter_match_analysis_invalid_json", {
      finishReason: getFinishReason(rawResponse),
      outputPreview: outputText.slice(0, 500),
    });
    return jsonNoStore(makeLocalAnalysis(match, "resposta invalida do OpenRouter"));
  }
  const parsedAnalysis = aiAnalysisSchema.safeParse(parsedJson);
  if (!parsedAnalysis.success) {
    logger.error("openrouter_match_analysis_schema_mismatch", { issues: JSON.stringify(parsedAnalysis.error.flatten()).slice(0, 500) });
    return jsonNoStore(makeLocalAnalysis(match, "formato inesperado do OpenRouter"));
  }

  logger.info("openrouter_match_analysis_success", { model, matchId: parsedRequest.data.matchId });
  return jsonNoStore({ ...parsedAnalysis.data, source: "openrouter" });
}
