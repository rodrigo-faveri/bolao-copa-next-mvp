"use client";

import { useState } from "react";
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

export function RankingDetails({ rows }: { rows: RankingRow[] }) {
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
              <span className="rankingPosition">{row.position}º</span>
              <span className="rankingParticipant">{row.name}</span>
              <span><strong>{row.points}</strong><small>pts</small></span>
              <span><strong>{row.exactHits}</strong><small>exatos</small></span>
              <span><strong>{row.outcomeHits}</strong><small>resultados</small></span>
              <span><strong>{row.predictions}</strong><small>palpites</small></span>
              <span><strong>{row.accuracy}%</strong><small>aprov.</small></span>
            </button>

            {isOpen && (
              <div className="rankingHitList">
                {row.hits.length === 0 ? (
                  <p className="muted">Nenhum jogo pontuado ainda. Quando houver resultados cadastrados, os acertos aparecem aqui.</p>
                ) : (
                  row.hits.map((hit) => (
                    <div className="rankingHit" key={`${row.userId}-${hit.matchId}`}>
                      <span className={`hitBadge ${hit.kind === "exact" ? "hitBadgeExact" : ""}`}>
                        {hit.kind === "exact" ? "Placar exato" : "Resultado"}
                      </span>
                      <span>{getTeamDisplayName(hit.teamA)} x {getTeamDisplayName(hit.teamB)}</span>
                      <span className="muted">Palpite {hit.prediction}</span>
                      <span className="muted">Resultado {hit.result}</span>
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
