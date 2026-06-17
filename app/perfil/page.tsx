import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t } from "../../lib/i18n-shared";
import { prisma } from "../../lib/prisma";
import { saveProfile } from "./actions";

export const dynamic = "force-dynamic";

const avatarColors = ["#116530", "#0f766e", "#1d4ed8", "#7a4d00", "#9a3412", "#6d28d9"] as const;

type PredictionWithMatch = Awaited<ReturnType<typeof getUserProfileData>>["predictions"][number];

async function getUserProfileData(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      nickname: true,
      avatarColor: true,
      predictions: {
        include: { match: true },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!user) redirect("/");
  return user;
}

function displayName(user: { name: string | null; nickname: string | null; id: string }) {
  return user.nickname?.trim() || user.name?.trim() || `Participante ${user.id.slice(-6)}`;
}

function groupRoundKey(prediction: PredictionWithMatch, groupMatches: PredictionWithMatch[]) {
  const sorted = [...groupMatches].sort((a, b) => {
    const timeA = a.match.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const timeB = b.match.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return timeA - timeB || a.match.teamA.localeCompare(b.match.teamA);
  });
  const index = sorted.findIndex((item) => item.matchId === prediction.matchId);
  return Math.floor(Math.max(index, 0) / 2) + 1;
}

function buildRoundHistory(predictions: PredictionWithMatch[]) {
  const byGroup = new Map<string, PredictionWithMatch[]>();
  for (const prediction of predictions) {
    const groupPredictions = byGroup.get(prediction.match.group) ?? [];
    groupPredictions.push(prediction);
    byGroup.set(prediction.match.group, groupPredictions);
  }

  const rounds = new Map<number, { round: number; points: number; exactHits: number; outcomeHits: number; resolved: number; predictions: number }>();

  for (const prediction of predictions) {
    const round = groupRoundKey(prediction, byGroup.get(prediction.match.group) ?? []);
    const current = rounds.get(round) ?? { round, points: 0, exactHits: 0, outcomeHits: 0, resolved: 0, predictions: 0 };
    current.predictions += 1;
    current.points += prediction.points;

    const { match } = prediction;
    if (match.resultGoalsA !== null && match.resultGoalsB !== null) {
      current.resolved += 1;
      const exact = prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB;
      if (exact) current.exactHits += 1;
      else if (prediction.points > 0) current.outcomeHits += 1;
    }

    rounds.set(round, current);
  }

  return Array.from(rounds.values()).sort((a, b) => a.round - b.round);
}

function buildProfileStats(predictions: PredictionWithMatch[], roundHistory: ReturnType<typeof buildRoundHistory>) {
  const resolvedPredictions = predictions.filter((prediction) => prediction.match.resultGoalsA !== null && prediction.match.resultGoalsB !== null);
  const exactHits = resolvedPredictions.filter((prediction) => prediction.goalsA === prediction.match.resultGoalsA && prediction.goalsB === prediction.match.resultGoalsB).length;
  const outcomeHits = resolvedPredictions.filter((prediction) => prediction.points > 0 && !(prediction.goalsA === prediction.match.resultGoalsA && prediction.goalsB === prediction.match.resultGoalsB)).length;
  const pendingPredictions = predictions.length - resolvedPredictions.length;
  const scoringHits = exactHits + outcomeHits;
  const bestRound = roundHistory.reduce<(typeof roundHistory)[number] | null>((best, round) => {
    if (!best || round.points > best.points) return round;
    return best;
  }, null);

  return {
    accuracy: resolvedPredictions.length > 0 ? Math.round((scoringHits / resolvedPredictions.length) * 100) : 0,
    exactHits,
    outcomeHits,
    pendingPredictions,
    bestRound,
  };
}

export default async function PerfilPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const locale = await getCurrentLocale();
  const copy = t(locale);
  const user = await getUserProfileData(email);
  const name = displayName(user);
  const initial = name.slice(0, 1).toUpperCase();
  const avatarColor = user.avatarColor ?? avatarColors[0];
  const totalPoints = user.predictions.reduce((sum, prediction) => sum + prediction.points, 0);
  const roundHistory = buildRoundHistory(user.predictions);
  const stats = buildProfileStats(user.predictions, roundHistory);

  return (
    <main className="container bolaoPage">
      <CupHeader active="perfil" title={copy.profile.title} description={copy.profile.description} />

      <section className="profileGrid">
        <article className="profileCard">
          <div className="profilePreview">
            <span className="profileAvatar" style={{ backgroundColor: avatarColor }}>{initial}</span>
            <div>
              <span className="badge badgeGold">{copy.profile.publicProfile}</span>
              <h2>{name}</h2>
              <p className="muted">{formatMessage(copy.profile.accumulated, { points: totalPoints, predictions: user.predictions.length })}</p>
            </div>
          </div>

          <div className="profileStatsGrid">
            <article>
              <span>{copy.profile.accuracy}</span>
              <strong>{stats.accuracy}%</strong>
            </article>
            <article>
              <span>{copy.profile.exactHits}</span>
              <strong>{stats.exactHits}</strong>
            </article>
            <article>
              <span>{copy.profile.outcomeHits}</span>
              <strong>{stats.outcomeHits}</strong>
            </article>
            <article>
              <span>{copy.profile.pending}</span>
              <strong>{stats.pendingPredictions}</strong>
            </article>
            <article className="profileStatsWide">
              <span>{copy.profile.bestRound}</span>
              <strong>{stats.bestRound ? formatMessage(copy.profile.bestRoundValue, { round: stats.bestRound.round, points: stats.bestRound.points }) : copy.profile.noBestRound}</strong>
            </article>
          </div>

          <form action={saveProfile} className="profileForm">
            <label>
              <span>{copy.profile.nickname}</span>
              <input defaultValue={user.nickname ?? user.name ?? ""} maxLength={32} minLength={2} name="nickname" required type="text" />
            </label>
            <fieldset>
              <legend>{copy.profile.avatarColor}</legend>
              <div className="avatarColorGrid">
                {avatarColors.map((color) => (
                  <label key={color}>
                    <input defaultChecked={color === avatarColor} name="avatarColor" type="radio" value={color} />
                    <span style={{ backgroundColor: color }} />
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit">{copy.profile.save}</button>
          </form>
        </article>

        <article className="profileCard">
          <span className="badge">{copy.profile.history}</span>
          <h2>{copy.profile.performance}</h2>
          {roundHistory.length > 0 ? (
            <div className="roundHistory">
              {roundHistory.map((round) => (
                <div className="roundHistoryItem" key={round.round}>
                  <strong>{formatMessage(copy.profile.round, { round: round.round })}</strong>
                  <span>{round.points} pts</span>
                  <small>{round.exactHits} {copy.ranking.exact} · {round.outcomeHits} {copy.ranking.outcomes} · {formatMessage(copy.profile.finished, { resolved: round.resolved, predictions: round.predictions })}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{copy.profile.emptyHistory}</p>
          )}
        </article>
      </section>
    </main>
  );
}
