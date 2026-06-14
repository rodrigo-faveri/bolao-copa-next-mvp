"use client";

import { useState } from "react";
import type { AppLocale } from "../lib/i18n-shared";
import { t } from "../lib/i18n-shared";
import { getTeamDisplayName } from "../lib/teams";

export type RankingHit = {
  matchId: string;
  teamA: string;
  teamB: string;
  prediction: string;
  result: string;
  points: number;
  kind: "exact" | "outcome";
};

export type RankingRow = {
  userId: string;
  name: string;
  position: number;
  points: number;
  predictions: number;
  exactHits: number;
  outcomeHits: number;
  accuracy: number;
  hits: RankingHit[];
};

export function RankingDetails({ locale = "pt-BR", rows }: { locale?: AppLocale; rows: RankingRow[] }) {
  const copy = t(locale);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  return (
    <div className="rankingRows">
      {rows.map((row) => {
        const isOpen = openUserId === row.userId;
        return (
          <article className="rankingRowCard" key={row.userId}>
            <button
              aria-expanded={isOpen}
              className="rankingRowButton"
              onClick={() => setOpenUserId(isOpen ? null : row.userId)}
              type="button"
            >
              <span className="rankingPosition">{row.position}</span>
              <span className="rankingParticipant">{row.name}</span>
              <span><strong>{row.points}</strong><small>pts</small></span>
              <span><strong>{row.exactHits}</strong><small>{copy.ranking.exact}</small></span>
              <span><strong>{row.outcomeHits}</strong><small>{copy.ranking.outcomes}</small></span>
              <span><strong>{row.predictions}</strong><small>{copy.ranking.predictions}</small></span>
              <span><strong>{row.accuracy}%</strong><small>{copy.ranking.accuracy}</small></span>
            </button>

            {isOpen && (
              <div className="rankingHitList">
                {row.hits.length === 0 ? (
                  <p className="muted">{copy.ranking.noHits}</p>
                ) : (
                  row.hits.map((hit) => (
                    <div className="rankingHit" key={`${row.userId}-${hit.matchId}`}>
                      <span className={`hitBadge ${hit.kind === "exact" ? "hitBadgeExact" : ""}`}>
                        {hit.kind === "exact" ? copy.ranking.exactScore : copy.ranking.result}
                      </span>
                      <span>{getTeamDisplayName(hit.teamA, locale)} x {getTeamDisplayName(hit.teamB, locale)}</span>
                      <span className="muted">{copy.ranking.prediction} {hit.prediction}</span>
                      <span className="muted">{copy.ranking.result} {hit.result}</span>
                      <strong>+{hit.points}</strong>
                    </div>
                  ))
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
