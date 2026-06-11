# Bolão Copa 2026

MVP recreativo para palpites da Copa do Mundo de 2026, sem dinheiro, odds ou apostas.

## Recursos atuais

- Login com Google usando Auth.js
- Palpites protegidos por sessão e validação no servidor
- Bloqueio automático 10 minutos antes do início da partida
- Modo local para testar partidas sem horário definido
- Jogos agrupados por data
- Bandeiras das seleções na tela de palpites
- Pontuação de 5 pontos para placar exato e 3 para resultado correto
- Ranking sem exposição de e-mails
- Importação idempotente das partidas por CSV

## Requisitos

- Node.js 20.19 ou superior
- PostgreSQL
- Credenciais OAuth do Google

## Como rodar

```bash
npm install
cp .env.example .env
npx auth secret
npm run prisma:deploy
npm run prisma:seed
npm run dev
```

Abra `http://localhost:3000`.

## Variáveis de ambiente

```env
DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/palpites?schema=public"
AUTH_SECRET="gere-com-npx-auth-secret"
AUTH_GOOGLE_ID="seu-google-client-id"
AUTH_GOOGLE_SECRET="seu-google-client-secret"
AUTH_URL="http://localhost:3000"
ALLOW_UNSCHEDULED_PREDICTIONS="true"
```

Use `ALLOW_UNSCHEDULED_PREDICTIONS="true"` apenas em desenvolvimento. Em produção, remova a variável ou use `"false"` para exigir horários reais nas partidas.

## Configuração do Google OAuth

Configure este redirect URI no Google Cloud Console:

```txt
http://localhost:3000/api/auth/callback/google
```

Em produção, use apenas HTTPS e configure `AUTH_URL` com a URL pública.

## Datas das partidas

Por segurança, partidas sem `startsAt` ficam fechadas para palpites quando `ALLOW_UNSCHEDULED_PREDICTIONS` não está ativo. Para abrir os jogos de forma definitiva, acrescente uma coluna `starts_at` ao arquivo `data/matches.csv`, usando datas ISO 8601 com fuso horário, e execute novamente:

```bash
npm run prisma:seed
```

Exemplo: `2026-06-11T16:00:00-03:00`.

Também existe o arquivo `data/match-schedule.csv`, com a agenda da fase de grupos em horário de Brasília. A agenda foi montada a partir da publicação do ge de 08/06/2026.

## Registrar resultado

O comando abaixo registra o resultado e recalcula os pontos de todos os palpites da partida:

```bash
npm run result:set -- <matchId> <golsA> <golsB>
```

Este é um comando administrativo e deve ser executado apenas em ambiente confiável.

## Verificações

```bash
npm run lint
npm test
npm run build
```

## Próximas evoluções

- Bolões privados com convites
- Perfil com apelido público
- Painel administrativo com trilha de auditoria
- Importação automatizada de horários e resultados oficiais
- Rate limiting distribuído
- Testes de integração com PostgreSQL
