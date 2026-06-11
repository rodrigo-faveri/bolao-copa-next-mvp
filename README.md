# Bolao Copa 2026

App recreativo para palpites da Copa do Mundo de 2026 entre amigos, sem dinheiro, odds ou apostas. O projeto combina bolao por rodadas, simulador de grupos, mata-mata, ranking, noticias, painel admin e assistente de IA.

## Stack

- Next.js 15 App Router
- React 19
- Auth.js com Google OAuth
- Prisma + PostgreSQL
- Zod para validacao
- OpenRouter opcional para sugestoes de IA

## Recursos

- Login com Google via Auth.js.
- Controle opcional de acesso por e-mail ou dominio.
- Palpites protegidos por sessao e validados no servidor.
- Fechamento automatico dos palpites 10 minutos antes de cada partida.
- Modo local para testar partidas sem horario definido.
- Jogos separados por grupo, rodada, data, horario e local.
- Bandeiras das selecoes.
- Contador regressivo por partida.
- Alertas no bolao para palpites pendentes perto do fechamento.
- Resultado oficial exibido separadamente do palpite do usuario.
- Pontuacao automatica: 5 pontos para placar exato e 3 para resultado correto.
- Ranking com detalhes de acertos, sem expor e-mails.
- Perfil publico com apelido e avatar por cor.
- Historico de desempenho do usuario por rodada.
- Simulador de fase de grupos com classificacao em tempo real.
- Simulador de mata-mata por etapas.
- Pagina de noticias com filtros.
- Painel admin para registrar resultados e recalcular pontos.
- Boloes privados com codigo/link de convite.
- Ranking filtrado por bolao privado.
- Pagina detalhada do bolao com membros e controles do dono.
- Contexto de bolao privado na pagina de palpites com atalhos para ranking/detalhes.
- Assistente de IA por partida usando OpenRouter, com fallback local gratuito.
- Auditoria em banco para eventos sensiveis.
- Headers de seguranca no Next.js.
- Rate limit para salvar palpites e consultar IA.

## Paginas

- `/`: home com atalhos para as principais areas.
- `/bolao`: palpites do usuario por rodada e aba de mata-mata.
- `/boloes`: criar bolao privado, entrar por convite, listar grupos e abrir ranking privado.
- `/boloes/[inviteCode]`: detalhes do bolao, membros, convite e configuracoes do dono.
- `/simulador`: simulador de grupos e mata-mata.
- `/ranking`: ranking geral ou ranking privado com `?bolao=CODIGO`.
- `/perfil`: perfil publico, apelido, avatar e historico por rodada.
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

Exemplo completo:

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

Use `data/results.example.csv` como modelo. O CSV aceita `match_id` ou a combinacao `group`, `team_a`, `team_b`.

Ao registrar o resultado:

- o placar oficial fica separado do palpite do usuario;
- a partida fica encerrada;
- os pontos dos palpites da partida sao recalculados.

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
- Middleware protegendo `/bolao`, `/boloes`, `/ranking`, `/perfil` e `/admin`.
- Checagem server-side de usuario e admin.
- Allowlist opcional de e-mails/dominios.
- Validacao com Zod em server actions e APIs.
- Rate limit por usuario para palpites e IA.
- Rate limit distribuido opcional via Redis REST/Upstash.
- Resultado oficial nao sobrescreve palpite do usuario.
- Headers como `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `CSP` e `nosniff`.
- HSTS em producao.
- Chaves de IA ficam apenas no servidor.
- Logs estruturados em JSON para login bloqueado, admin e IA.
- Tabela `AuditLog` para eventos de negocio e seguranca: palpite salvo, resultado admin salvo e tentativa admin negada.
- Auditoria tambem registra atualizacao de perfil.
- `npm run production:check` valida configuracoes sensiveis antes do deploy.

Ainda recomendado antes de producao:

- revisar CSP conforme novos dominios;
- conectar logs e erros a uma plataforma de monitoramento;
- configurar `RATE_LIMIT_DRIVER="redis"` antes de escalar para varias instancias.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run check
npm run production:check
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run result:set -- <matchId> <golsA> <golsB>
npm run result:import -- data/results.csv
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

## Proximas Evolucoes

- Perfil publico com apelido e avatar.
- Auditoria de alteracoes administrativas.
- Testes de integracao com PostgreSQL.
- Historico de desempenho do usuario por rodada.
