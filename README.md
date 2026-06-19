# Bolao Copa 2026

App recreativo para palpites da Copa do Mundo de 2026 entre amigos, sem dinheiro, odds ou apostas. O projeto combina bolao por rodadas, simulador de grupos, mata-mata, ranking, noticias, painel admin e assistente de IA.

## Stack

- Next.js 15 App Router
- React 19
- Auth.js com Google OAuth
- Prisma + PostgreSQL
- Zod para validacao
- OpenRouter opcional para sugestoes de IA
- LangChain + LangGraph para orquestracao do assistente IA

## Recursos

- Login com Google via Auth.js.
- Controle opcional de acesso por e-mail ou dominio.
- Palpites protegidos por sessao e validados no servidor.
- Fechamento automatico dos palpites 10 minutos antes de cada partida.
- Modo local para testar partidas sem horario definido.
- Jogos separados por grupo, rodada, data, horario e local.
- Bandeiras das selecoes.
- Contador regressivo por partida.
- Badge clicavel de partida ao vivo dentro do proprio confronto.
- Pagina de tempo real por partida com placar, status e linha do tempo.
- Controle administrativo de status da partida: agendada ou ao vivo.
- Tempo real automatico por horario, com link externo opcional.
- Cadastro manual opcional de lances pelo admin.
- Alertas no bolao para palpites pendentes perto do fechamento.
- Resultado oficial exibido separadamente do palpite do usuario.
- Pagina de resultados com jogos em acompanhamento, placar oficial, resumo automatico e motivo da pontuacao.
- Pontuacao automatica: 5 pontos para placar exato e 3 para resultado correto.
- Ranking com detalhes de acertos, sem expor e-mails.
- Perfil publico com apelido e avatar por cor.
- Historico de desempenho do usuario por rodada.
- Simulador de fase de grupos com classificacao em tempo real.
- Simulador de mata-mata por etapas.
- Palpites do mata-mata persistidos no banco, inclusive por bolao privado.
- Palpites do mata-mata podem ser removidos individualmente ou limpos de uma vez.
- Home com jogos ao vivo/proximos jogos e carrossel de noticias.
- Pagina de noticias com filtros.
- Painel admin para registrar resultados e recalcular pontos.
- Boloes privados com codigo/link de convite.
- Regras de pontuacao por fase do bolao privado: fase de grupos e mata-mata.
- Ranking filtrado por bolao privado.
- Ranking especifico do mata-mata por acerto de selecao classificada.
- Pagina detalhada do bolao com membros e controles do dono.
- Contexto de bolao privado na pagina de palpites com atalhos para ranking/detalhes.
- Assistente de IA por partida usando OpenRouter, com fallback local gratuito.
- Assistente IA em widget flutuante, com LangGraph, OpenRouter e RAG hibrido usando base de conhecimento, partidas, palpites, resultados, ranking e noticias recentes como contexto.
- Auditoria em banco para eventos sensiveis.
- Headers de seguranca no Next.js.
- Rate limit para salvar palpites e consultar IA.
- Push notifications reais opcionais, com preferencias por usuario no perfil.
- Notificacoes push de resultado final e resumo de desempenho da rodada.
- Historico de notificacoes recebidas no perfil do usuario.
- Dashboard admin de saude dos jobs agendados.
- Alertas automaticos no admin quando jobs falham, travam ou ficam muito tempo sem executar.
- Monitoramento externo opcional via webhook, Logtail ou Datadog para logs de erro.

## Paginas

- `/`: home com atalhos para as principais areas.
- `/bolao`: palpites do usuario por rodada e aba de mata-mata.
- `/boloes`: criar bolao privado, entrar por convite, listar grupos e abrir ranking privado.
- `/boloes/[inviteCode]`: detalhes do bolao, membros, convite e configuracoes do dono.
- `/simulador`: simulador de grupos e mata-mata.
- `/ranking`: ranking geral ou ranking privado com `?bolao=CODIGO`.
- `/resultados`: acompanhamento de jogos iniciados e comparacao dos palpites do usuario com placares oficiais.
- `/perfil`: perfil publico, apelido, avatar, preferencias, historico por rodada e notificacoes recebidas.
- `/noticias`: noticias recentes com filtros por fonte, data e busca.
- `/admin`: registro de resultados oficiais, restrito a admins.

## Requisitos

- Node.js `>=20.19.0 <21` ou `>=22.13.0`
- PostgreSQL
- Credenciais OAuth do Google
- Opcional: chave do OpenRouter

## Como Rodar

```bash
npm install
cp .env.example .env
npx auth secret
npm run prisma:deploy
npm run prisma:seed
npm run dev
```

Abra `http://localhost:3000`.

No Windows, se o build travar com `EPERM .next/trace`, pare processos Node e apague `.next` antes de rodar novamente.

## Variaveis de Ambiente

Arquivos de referencia:

- `.env.example`: lista geral de variaveis.
- `.env.local.example`: sugestao para desenvolvimento local.
- `.env.production.example`: sugestao para deploy.

Para comecar localmente:

```bash
copy .env.local.example .env
```

Depois preencha `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` e `ADMIN_EMAILS`.

Exemplo geral:

```env
DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/palpites?schema=public"

AUTH_SECRET="gere-com-npx-auth-secret"
AUTH_GOOGLE_ID="seu-google-client-id"
AUTH_GOOGLE_SECRET="seu-google-client-secret"
AUTH_URL="http://localhost:3000"

ALLOW_UNSCHEDULED_PREDICTIONS="false"
ENFORCE_HTTPS="true"
RATE_LIMIT_DRIVER="memory"
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""

ALLOWED_EMAILS=""
ALLOWED_EMAIL_DOMAINS=""
ADMIN_EMAILS=""

OPENROUTER_API_KEY=""
OPENROUTER_MODEL="nex-agi/nex-n2-pro:free"

SERPAPI_KEY=""
SERPAPI_RESULT_DELAY_MINUTES="120"
SERPAPI_RESULT_MAX_MATCHES="12"
SERPAPI_DRY_RUN="false"
SERPAPI_DEBUG="false"

VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:voce@email.com"
PUSH_REMINDER_WINDOW_MINUTES="60"
JOB_RUNNING_STALE_MINUTES="20"
JOB_RESULT_SYNC_STALE_MINUTES="180"
JOB_PUSH_REMINDER_STALE_MINUTES="180"

MONITORING_WEBHOOK_URL=""
OBSERVABILITY_PROVIDER="off"
OBSERVABILITY_ENDPOINT_URL=""
OBSERVABILITY_API_KEY=""
OBSERVABILITY_SERVICE_NAME="bolao-copa-next-mvp"

API_FOOTBALL_KEY=""
API_FOOTBALL_BASE_URL="https://v3.football.api-sports.io"
SPORTS_API_CACHE_SECONDS="60"
```

Notas:

- Use `ALLOW_UNSCHEDULED_PREDICTIONS="true"` apenas em desenvolvimento.
- Em producao, mantenha `ALLOW_UNSCHEDULED_PREDICTIONS="false"`.
- `ENFORCE_HTTPS="true"` redireciona HTTP para HTTPS em producao.
- `RATE_LIMIT_DRIVER="memory"` serve para uma unica instancia.
- Para rate limit distribuido em producao, use `RATE_LIMIT_DRIVER="redis"` com `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
- `ALLOWED_EMAILS` e `ALLOWED_EMAIL_DOMAINS` restringem quem pode entrar.
- `ADMIN_EMAILS` define quem pode acessar `/admin`.
- `OPENROUTER_API_KEY` e opcional. Sem chave, o app usa sugestao local.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` ativam Web Push real. Gere com `npx web-push generate-vapid-keys`.
- `PUSH_REMINDER_WINDOW_MINUTES` define a janela de envio dos avisos de palpite pendente.
- `JOB_RUNNING_STALE_MINUTES`, `JOB_RESULT_SYNC_STALE_MINUTES` e `JOB_PUSH_REMINDER_STALE_MINUTES` controlam os alertas automaticos do dashboard admin.
- `JOB_RESULT_PUSH_STALE_MINUTES` controla alerta de atraso do job de notificacoes de resultados.
- `MONITORING_WEBHOOK_URL` envia logs de erro para uma plataforma externa via HTTP POST e continua disponivel como modo legado.
- `OBSERVABILITY_PROVIDER` aceita `off`, `webhook`, `logtail`, `datadog` ou `sentry`.
- `OBSERVABILITY_ENDPOINT_URL`, `OBSERVABILITY_API_KEY` e `OBSERVABILITY_SERVICE_NAME` configuram o destino dedicado de observabilidade.
- `API_FOOTBALL_KEY` e opcional/legado. Sem chave, a pagina de tempo real usa dados locais.
- `SPORTS_API_CACHE_SECONDS` controla o cache das chamadas esportivas. O padrao de 60 segundos ajuda a preservar o plano free.

Para validar um arquivo de producao antes do deploy:

```bash
npm run production:check:prod
```

A verificacao falha se encontrar placeholders, HTTP em producao, senha fraca de banco, `ALLOW_UNSCHEDULED_PREDICTIONS=true`, admin fora da allowlist ou rate limit Redis incompleto.

## Google OAuth

Configure este redirect URI no Google Cloud Console:

```txt
http://localhost:3000/api/auth/callback/google
```

Em producao:

- use HTTPS;
- configure `AUTH_URL` com a URL publica;
- cadastre tambem o callback de producao no Google Cloud.

## Banco e Seed

As partidas ficam em `data/matches.csv`.

Para importar ou atualizar:

```bash
npm run prisma:seed
```

O seed e idempotente, entao pode ser executado novamente apos ajustes no CSV.

Tambem existe `data/match-schedule.csv`, com agenda da fase de grupos em horario de Brasilia.

## Resultados Oficiais

Resultados podem ser registrados pelo painel `/admin` ou pelo comando:

```bash
npm run result:set -- <matchId> <golsA> <golsB>
```

Tambem e possivel importar resultados em lote por CSV:

```bash
npm run result:import -- data/results.csv
```

Tambem existe sincronizacao semi-automatica pos-jogo usando SerpAPI/Google Sports:

```bash
npm run result:sync-serpapi
```

Ela procura partidas que ja passaram da janela configurada por `SERPAPI_RESULT_DELAY_MINUTES`, ainda nao tem resultado oficial e tenta importar o placar final. Se a resposta nao for confiavel ou nao estiver finalizada, a partida e ignorada. Quando a fonte traz gols ou cartoes no payload estruturado, esses lances sao importados automaticamente para `MatchEvent`.

Para testar sem salvar no banco:

```bash
SERPAPI_DRY_RUN=true npm run result:sync-serpapi
```

Em producao, agende esse comando em cron/job a partir das 16h de Brasilia e depois a cada 120 minutos durante a janela de jogos. O workflow `.github/workflows/sync-serpapi-results.yml` ja roda em `19:00`, `21:00`, `23:00`, `01:00` e `03:00` UTC, equivalente a `16h`, `18h`, `20h`, `22h` e `00h` em Brasilia. Use `SERPAPI_RESULT_MAX_MATCHES="12"` para cobrir varias partidas acumuladas na mesma execucao sem deixar jogos antigos presos na fila.

Variaveis relacionadas:

```env
SERPAPI_KEY=""
SERPAPI_RESULT_DELAY_MINUTES="120"
SERPAPI_RESULT_MAX_MATCHES="12"
SERPAPI_DRY_RUN="false"
SERPAPI_DEBUG="false"
```

Use `data/results.example.csv` como modelo. O CSV aceita `match_id` ou a combinacao `group`, `team_a`, `team_b`.

Ao registrar o resultado:

- o placar oficial fica separado do palpite do usuario;
- a partida fica encerrada;
- os pontos dos palpites da partida sao recalculados.
- lances retornados por fonte estruturada sao salvos na linha do tempo da partida.

## Push Notifications

O app suporta Web Push para avisar usuarios mesmo fora da aba do navegador.

Para ativar:

1. Gere as chaves VAPID:

```bash
npx web-push generate-vapid-keys
```

2. Configure:

```env
VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:voce@email.com"
```

3. Agende o job:

```bash
npm run push:pending-picks
npm run push:results
```

O job busca partidas cujo fechamento de palpite esta dentro de uma janela maxima de lembrete, ignora usuarios que ja palpitaram, respeita as preferencias salvas em `/perfil` e evita duplicidade usando a tabela `PushNotificationLog`.

O job `push:results` avisa quando um placar oficial entra, mostra os pontos do usuario naquele jogo e envia resumo de rodada quando todos os jogos daquela rodada do grupo estiverem finalizados.

## Partidas ao Vivo e Tempo Real

O badge `Ao vivo` aparece dentro do confronto e abre a pagina `/tempo-real/[matchId]`.

A regra atual usa o status administrativo e a agenda cadastrada no banco:

- uma partida marcada como `Ao vivo` no admin mostra imediatamente o badge no confronto;
- uma partida aparece como ao vivo quando o horario de inicio ja passou;
- ela permanece com o badge por uma janela estimada de 130 minutos;
- quando o resultado oficial e registrado, ela vira `Encerrada` e deixa de aparecer como ao vivo.

A pagina de tempo real usa uma linha do tempo automatica baseada no horario da partida. Esse caminho evita depender de APIs pagas ou com cobertura limitada.

Fluxo hibrido:

1. A partida aparece como `Ao vivo` automaticamente pela janela de horario ou manualmente pelo admin.
2. A linha do tempo mostra marcos estimados: inicio, intervalo, segundo tempo e fim previsto.
3. O badge `Ao vivo` no confronto abre `/tempo-real/[matchId]`.
4. Opcionalmente, o admin pode cadastrar lances especificos ou uma URL externa de tempo real.
5. Ao registrar o resultado oficial, a partida vira `Encerrada`.

No futuro, se aparecer uma API realmente gratuita e com cobertura da Copa, a estrutura de `MatchEvent` permite importar eventos automaticamente sem mudar a tela.

## Assistente de IA

O botao `IA` em cada partida chama `/api/ai/match-analysis`.

Fluxo:

1. Se `OPENROUTER_API_KEY` estiver configurada, tenta consultar o OpenRouter.
2. Se o modelo falhar, bater limite ou devolver resposta invalida, usa fallback local.
3. A sugestao mostra palpite conservador, palpite ousado, favorito, risco e explicacao.
4. O usuario pode aplicar a sugestao nos inputs ou fechar o painel.

Modelo padrao:

```env
OPENROUTER_MODEL="nex-agi/nex-n2-pro:free"
```

Voce pode trocar por outro modelo disponivel no OpenRouter, preferencialmente com sufixo `:free` para testes.

## Seguranca

Medidas atuais:

- Redirecionamento HTTP para HTTPS em producao via middleware.
- Auth.js com sessao no banco.
- Middleware protegendo `/bolao`, `/boloes`, `/ranking`, `/resultados`, `/perfil` e `/admin`.
- Checagem server-side de usuario e admin.
- Allowlist opcional de e-mails/dominios.
- Validacao com Zod em server actions e APIs.
- Rate limit por usuario para palpites, IA, perfil, bolao privado e acoes administrativas.
- Rate limit por IP no endpoint interno de tempo real.
- Rate limit distribuido opcional via Redis REST/Upstash.
- Resultado oficial nao sobrescreve palpite do usuario.
- Headers como `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `CSP` e `nosniff`.
- HSTS em producao.
- Chaves de IA ficam apenas no servidor.
- Logs estruturados em JSON para login bloqueado, admin e IA.
- Webhook externo opcional para logs de erro via `MONITORING_WEBHOOK_URL`.
- Observabilidade dedicada via `OBSERVABILITY_PROVIDER`, com suporte HTTP para webhook, Logtail, Datadog e endpoint customizado de Sentry/relay.
- Tabela `AuditLog` para eventos de negocio e seguranca: palpite salvo, resultado admin salvo e tentativa admin negada.
- Auditoria tambem registra atualizacao de perfil.
- `npm run production:check` carrega `.env` e valida configuracoes sensiveis antes do deploy.

Ainda recomendado antes de producao:

- revisar CSP conforme novos dominios;
- configurar `RATE_LIMIT_DRIVER="redis"` antes de escalar para varias instancias.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run test:integration
npm run check
npm run production:check
npm run production:check:prod
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run result:set -- <matchId> <golsA> <golsB>
npm run result:import -- data/results.csv
npm run result:sync-serpapi
npm run push:pending-picks
npm run push:results
```

## Verificacoes

Antes de abrir PR/deploy:

```bash
npm run lint
npm test
npm run build
```

Ou:

```bash
npm run check
```

### Testes de integracao com PostgreSQL

Os testes de integracao usam um banco separado informado por `TEST_DATABASE_URL`.
Eles criam dados temporarios, registram um resultado oficial e validam se os pontos dos palpites sao recalculados.

Exemplo:

```bash
DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/palpites_test?schema=public" npm run prisma:deploy
TEST_DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/palpites_test?schema=public" npm run test:integration
```

No Windows PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/palpites_test?schema=public"
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npm run prisma:deploy
npm run test:integration
```

## Proximas Evolucoes

- Ativar embeddings reais na tabela `KnowledgeDocument` quando houver volume maior de documentos.
- Adicionar ferramentas agenticas para executar acoes, como abrir jogo especifico, montar alerta ou salvar rascunho de palpite.
