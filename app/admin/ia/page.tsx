import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { CupHeader } from "../../../components/CupHeader";
import { isAdminEmail } from "../../../lib/access-control";
import { getCurrentLocale } from "../../../lib/i18n";
import { auditKnowledgeRetrieval, type KnowledgeAuditItem } from "../../../lib/knowledge";
import { prisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatScore(value: number) {
  return value.toFixed(value >= 1 ? 1 : 3);
}

function contentPreview(content: string) {
  return content.length > 260 ? `${content.slice(0, 260)}...` : content;
}

function formatAverage(value: number) {
  return `${value.toFixed(1)}/100`;
}

function AuditResultList({
  emptyText,
  items,
  scoreLabel,
  title,
  variant,
}: {
  emptyText: string;
  items: KnowledgeAuditItem[];
  scoreLabel: (item: KnowledgeAuditItem) => string;
  title: string;
  variant: "combined" | "lexical" | "semantic";
}) {
  return (
    <section className="knowledgeAuditColumn">
      <div className="knowledgeAuditColumnHeader">
        <h3>{title}</h3>
        <span>{items.length} fonte(s)</span>
      </div>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="knowledgeAuditList">
          {items.map((item) => (
            <article className="knowledgeAuditItem" key={`${variant}-${item.source}-${item.sourceId}`}>
              <div>
                <span className="badge badgeSoft">{item.source}</span>
                <strong>{item.title}</strong>
                <p>{contentPreview(item.content)}</p>
              </div>
              <footer>
                <span>{scoreLabel(item)}</span>
                <time dateTime={item.updatedAt.toISOString()}>{dateFormatter.format(item.updatedAt)}</time>
                {item.url && (
                  <Link href={item.url} target={item.url.startsWith("http") ? "_blank" : undefined}>
                    Abrir fonte
                  </Link>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function AdminAiAuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const locale = await getCurrentLocale();
  const params = await searchParams;
  const query = params?.q?.trim() || "Mexico Africa do Sul resultado palpites";
  const [audit, evaluationRuns] = await Promise.all([
    auditKnowledgeRetrieval(prisma, query, 8),
    prisma.aiEvaluationRun.findMany({
      include: {
        caseResults: {
          orderBy: [{ passed: "asc" }, { score: "asc" }],
          take: 4,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="admin"
        eyebrow="Auditoria de IA"
        title="Fontes e embeddings"
        description="Compare a busca textual com a busca semantica usada pelo RAG da assistente."
      />

      <section className="pageToolbar">
        <div>
          <span className="badge badgeGold">RAG</span>
          <h2>Auditar recuperacao de contexto</h2>
          <p className="muted">Use esta tela para entender quais documentos a assistente encontra antes de responder.</p>
        </div>
        <Link className="buttonSecondary" href="/admin">Voltar ao admin</Link>
      </section>

      <section className="adminSyncCard knowledgeAuditSearch">
        <form>
          <label>
            <span>Pergunta ou contexto</span>
            <input
              defaultValue={audit.query}
              maxLength={240}
              name="q"
              placeholder="Ex: quais noticias ajudam no palpite de Brasil x Alemanha?"
              type="search"
            />
          </label>
          <button type="submit">Comparar fontes</button>
        </form>
      </section>

      <section className="knowledgeAuditMetrics">
        <article>
          <span>Documentos</span>
          <strong>{audit.totalDocuments}</strong>
          <small>{audit.sampleSize} analisado(s) nesta consulta</small>
        </article>
        <article>
          <span>Embeddings</span>
          <strong>{audit.embeddingsConfigured ? "Ativo" : "Fallback textual"}</strong>
          <small>{audit.embeddedDocumentsInSample} documento(s) com vetor na amostra</small>
        </article>
        <article>
          <span>Consulta vetorial</span>
          <strong>{audit.queryEmbeddingAvailable ? "Disponivel" : "Indisponivel"}</strong>
          <small>{audit.embeddingError ?? "Sem erro de embedding"}</small>
        </article>
        <article>
          <span>Termos textuais</span>
          <strong>{audit.terms.length || 0}</strong>
          <small>{audit.terms.length > 0 ? audit.terms.join(", ") : "Nenhum termo relevante"}</small>
        </article>
      </section>

      <section className="knowledgeAuditGrid">
        <AuditResultList
          emptyText="Nenhum documento pontuou na combinacao atual."
          items={audit.combined}
          scoreLabel={(item) => `score ${formatScore(item.combinedScore)}`}
          title="Ranking combinado"
          variant="combined"
        />
        <AuditResultList
          emptyText="Nenhum documento bateu com os termos textuais."
          items={audit.lexical}
          scoreLabel={(item) => `texto ${formatScore(item.lexicalScore)}`}
          title="Busca textual"
          variant="lexical"
        />
        <AuditResultList
          emptyText={audit.embeddingsConfigured ? "Nenhum documento vetorial foi recuperado." : "Configure EMBEDDINGS_API_KEY para ativar busca semantica."}
          items={audit.semantic}
          scoreLabel={(item) => `semantico ${formatScore(item.semanticScore)}`}
          title="Busca semantica"
          variant="semantic"
        />
      </section>

      <section className="adminSyncCard">
        <div className="adminSectionHeader">
          <div>
            <span className="badge badgeSoft">Qualidade da IA</span>
            <h2>Historico de avaliacoes</h2>
            <p className="muted">
              Grave execucoes com <code>npm run ai:evaluate -- --persist</code> para acompanhar regressao ou melhoria por commit.
            </p>
          </div>
        </div>

        {evaluationRuns.length === 0 ? (
          <p className="muted">Nenhuma avaliacao persistida ainda.</p>
        ) : (
          <div className="adminJobGrid">
            {evaluationRuns.map((run) => (
              <article className="adminJobCard" key={run.id}>
                <div>
                  <span className={run.failedCases > 0 ? "badge badgeGold" : "badge badgeSoft"}>
                    {run.failedCases > 0 ? `${run.failedCases} falha(s)` : "Tudo ok"}
                  </span>
                  <h3>{formatAverage(run.averageScore)}</h3>
                  <p className="muted">
                    {run.passedCases}/{run.totalCases} caso(s) passaram
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Commit</dt>
                    <dd>{run.gitCommit ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd>{run.gitBranch ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Data</dt>
                    <dd>{dateFormatter.format(run.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Embeddings</dt>
                    <dd>{run.embeddingsEnabled ? "Ativo" : "Fallback"}</dd>
                  </div>
                </dl>
                <div className="adminJobCases">
                  {run.caseResults.map((item) => (
                    <span className={item.passed ? "badge badgeSoft" : "badge badgeGold"} key={item.id}>
                      {item.caseId}: {item.score}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="adminSyncCard">
        <h2>Como ler esta tela</h2>
        <p className="muted">
          O ranking combinado e o que mais se aproxima do comportamento da assistente. A busca textual favorece palavras exatas;
          a semantica depende dos embeddings gravados em <code>KnowledgeDocument</code>. Quando embeddings nao estao ativos, o app segue usando o fallback textual.
        </p>
        <p className="muted">Locale atual: {locale}</p>
      </section>
    </main>
  );
}
