# SuperPuppeteer - AI Context

Este arquivo existe para reduzir custo de contexto/tokens em futuras sessoes.
Leia este arquivo primeiro antes de abrir `server.js` inteiro.

## Regra Obrigatoria de Manutencao

1. Qualquer alteracao funcional no projeto DEVE atualizar este arquivo no mesmo commit.
2. Se mudar endpoint, fluxo, variavel de ambiente, estrutura de dados, pasta de persistencia ou comportamento de UI, atualize este arquivo.
3. Se o codigo e este arquivo divergirem, trate este arquivo como desatualizado e corrija imediatamente.

## Resumo Rapido

- Stack: Node.js (CommonJS), Express, Puppeteer, WebSocket (`ws`), PostgreSQL (`pg`).
- Entrada backend: `server.js`.
- Frontend estatico: `public/index.html`, `public/app.js`, `public/styles.css`.
- Script npm disponivel: `npm start` (`node server.js`).
- Porta: `process.env.PORT || 3000`, vinculada a `127.0.0.1` por padrao.
- Objetivo: gravar interacoes no browser, replay de fluxo, salvar cenarios locais/offline, sincronizar casos pendentes com nuvem, executar fila, integrar com Salesforce para dados de caso de teste.

## Estrutura de Pastas e Arquivos

- `server.js`: backend completo (API REST + WebSocket + orquestracao Puppeteer + Salesforce).
- `public/index.html`: UI principal.
- `public/app.js`: logica de UI, chamadas para API, websocket, renderizacao de listas/modais.
- `public/styles.css`: tema claro/escuro e layout.
- LocalStorage (`superpuppeteer.localState.v1`): base local/offline de cenarios e fila por navegador/usuario.
- `.data/scenarios.json`: espelho/migracao legado do backend; nao e mais a base local principal.
- `.data/salesforce-orgs.json`: registro local de cliente, nome da org, alias Salesforce gerado pelo servidor e org ativa; nunca armazena tokens ou `sfdxAuthUrl`.
- `.data/recordings/`: arquivos de video `.webm` do replay.
- `.data/recordings-index.json`: indice/metadata das execucoes gravadas.
- `.user-data/chrome-profile/`: perfil do Chrome gerenciado pelo Puppeteer.
- Se o servidor reiniciar e sobrar um Chrome orfao com esse perfil, `ensureBrowser()` tenta encerrar o dono do `SingletonLock` e relancar.

## Como Executar

## Pre-requisitos

- Node.js 18+ recomendado.
- NPM.
- PostgreSQL 16 local para o cluster em `.data/postgres` (inicializado com usuario/banco `superpuppeteer` na porta `5433`).
- Ambiente com UI grafica (o fluxo abre navegador real via Puppeteer).

## Comandos

```powershell
cd C:\GIT\Repository\SuperPuppeteer
npm install
npm run db:start
npm start
```

Abrir no navegador:

```text
http://127.0.0.1:3000
```

Nao abrir a UI pelo Live Server (`127.0.0.1:5500`): os botoes dependem das APIs e do WebSocket servidos pelo `server.js`.

## Variaveis de Ambiente

- `PORT`: porta HTTP (default `3000`).
- `BIND_HOST`: host HTTP (default `127.0.0.1`). So altere para acesso em rede se toda a API estiver protegida por autenticacao.
- `DATABASE_URL`: conexao PostgreSQL para sincronizacao cloud (`postgres://usuario:senha@host:5432/superpuppeteer`).
- Alternativa PostgreSQL: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.
- `POSTGRES_SCENARIOS_TABLE`: tabela de destino (default `superpuppeteer_scenarios`).
- `SALESFORCE_TARGET_ORG`: fallback legado para cenarios antigos sem `salesforceOrgId` (default `Elera`). Novos casos de teste exigem uma org selecionada.
- `SALESFORCE_CLI_TIMEOUT_MS`: limite da chamada ao Salesforce CLI, entre 5000 e 120000 ms (default `60000`).
- `SALESFORCE_WEB_LOGIN_TIMEOUT_MS`: limite da autenticacao interativa com `sf org login web`, entre 30000 e 600000 ms (default `300000`).
- Tambem sao usados internamente no processo do `sf`: `SF_DISABLE_LOG_FILE`, `SF_DISABLE_TELEMETRY`, `SF_LOG_LEVEL`, `NO_COLOR`, `CI`.

Exemplo PowerShell:

```powershell
$env:PORT=3001
$env:DATABASE_URL="postgres://usuario:senha@localhost:5432/superpuppeteer"
$env:SALESFORCE_TARGET_ORG="Elera"
npm start
```

Configuracao local atual em `.env`:

```text
DATABASE_URL=postgres://superpuppeteer:superpuppeteer@127.0.0.1:5433/superpuppeteer
POSTGRES_SCENARIOS_TABLE=superpuppeteer_scenarios
```

Comandos uteis:

```bash
npm run db:start
npm run db:status
npm run db:stop
```

## Fluxo Funcional (Alto Nivel)

1. Em Ambiente, o usuario pode adicionar um acesso Salesforce importando um JSON ou fazendo login pelo navegador via `sf org login web`; em ambos os casos escolhe/cria o cliente e informa o nome da org. Segredos nunca sao salvos no projeto.
2. Em "Conectar na org", o usuario escolhe primeiro o cliente e depois uma org. Um caso de teste so pode ser salvo apos essa selecao; o cenario guarda `salesforceOrgId` para continuar usando a mesma org nas edicoes futuras.
3. Usuario abre URL alvo (`/api/navigate`): o backend primeiro gera uma URL autenticada com `sf org open --url-only` para a org conectada e abre essa sessao no navegador controlado, depois navega para a URL informada.
4. Inicia gravacao (`/api/recording/start`): antes de criar a gravacao, o backend conecta o navegador na org ativa via Salesforce CLI e abre a URL informada, para o login nao virar evento gravado.
5. Finaliza gravacao (`/api/recording/stop`) e pode:
   - exportar ultimo JSON (`/api/export/last`),
   - salvar cenario (`/api/scenarios/save`).
6. Replay:
   - ultimo (`/api/replay/last`),
   - por cenario (`/api/scenarios/:id/run`),
   - fila (`/api/queue/*`).
7. Opcional: gravar video no replay; arquivos vao para `.data/recordings`.
8. Usuario pode clicar em "Sincronizar Casos" para enviar apenas cenarios com `CasoSincronizado: false`.
9. Integracao Salesforce para caso de teste (descricao/status/work relacionada failed).

## Estado em Memoria (Backend)

Campos principais de `state`:

- sessao: `status`, `eventCount`, `currentRecording`, `lastRecording`
- browser: `browser`, `page`, `recordingEnabled`
- cenarios/fila: `savedScenarios`, `queue`, `queueRunning`, `queuePaused`, `queueCursor`, `extendScenarioId`
- replay: `replayLog`, `queueRecordVideo`

## Persistencia e Sync de Cenarios

- A base local/offline fica no LocalStorage do navegador, chave `superpuppeteer.localState.v1`.
- Ao abrir a UI, o frontend hidrata o espelho em memoria do backend com os cenarios locais.
- O backend ainda precisa do espelho em memoria para replay, fila, exportacao e integracao Salesforce.
- Cada cenario salvo possui `CasoSincronizado`, `cloudId`, `syncedAt` e `syncError`.
- Novo cenario e duplicata sempre iniciam com `CasoSincronizado: false`.
- Cenarios antigos sem o campo sao carregados como pendentes (`false`).
- Cenarios sem caso Salesforce aparecem na aba Casos como `Local > Sem projeto > Sem work`.
- Edicoes locais relevantes (inputs, rename, extensao, status/descricao Salesforce refletidos no cenario) voltam o cenario para pendente.
- `POST /api/scenarios/sync` envia somente pendentes para PostgreSQL. Sucesso marca `CasoSincronizado: true`.
- Exclusao de cenario recebe `deleteCloud`; se `true`, tenta remover no PostgreSQL antes de remover local.

## API REST (Mapa Rapido)

## Gravacao/Reproducao

- `POST /api/recording/start`
- `POST /api/recording/pause`
- `POST /api/recording/resume`
- `POST /api/recording/stop`
- `POST /api/replay/last`
- `POST /api/navigate`
- `POST /api/session/close`
- `GET /api/export/last`

## Cenarios

- `POST /api/scenarios/save`
- `POST /api/scenarios/sync`
- `POST /api/local-state/hydrate`
- `GET /api/scenarios/:id`
- `POST /api/scenarios/:id/run`
- `POST /api/scenarios/:id/rename`
- `POST /api/scenarios/:id/duplicate`
- `POST /api/scenarios/:id/extend`
- `POST /api/scenarios/:id/move`
- `DELETE /api/scenarios/:id` (`body.deleteCloud` controla exclusao na nuvem)
- `GET /api/scenarios/:id/export`
- `GET /api/scenarios/export`
- `POST /api/scenarios/import`
- `POST /api/scenarios/:id/inputs`

## Salesforce (caso de teste/work)

- `GET /api/salesforce/orgs`
- `POST /api/salesforce/orgs/import` (somente localhost; aceita `sfdxAuthUrl` no topo ou em `result.sfdxAuthUrl`)
- `POST /api/salesforce/orgs/login` (somente localhost; abre login web pelo Salesforce CLI)
- `POST /api/salesforce/orgs/:id/select`

- `POST /api/scenarios/:id/test-case/description`
- `POST /api/scenarios/:id/test-case/status`
- `GET /api/scenarios/:id/test-case/failed-work/template`
- `POST /api/scenarios/:id/test-case/failed-work`

## Fila

- `POST /api/queue/add`
- `POST /api/queue/:id/move`
- `DELETE /api/queue/:id`
- `POST /api/queue/run`
- `POST /api/queue/pause`
- `POST /api/queue/resume`

## Gravacoes de video

- `GET /api/scenarios/:id/recordings`
- `GET /api/recordings`
- `GET /api/recordings/:name/download`
- `DELETE /api/recordings/:name`

## WebSocket

Canal `ws://<host>` envia:

- `type: "state"`: snapshot serializado completo para sincronizar UI.
- `type: "event"`: evento capturado em tempo real.
- `type: "replay-log"`: log detalhado de execucao/replay/fila/video.

## Integracao Salesforce (Dependencia Externa)

- Usa Salesforce CLI `sf` via shell.
- A importacao usa `sf org login sfdx-url --sfdx-url-stdin`, com timeout; tokens nunca entram em `.data`, logs ou respostas HTTP.
- O login alternativo usa `sf org login web --alias <alias> --instance-url <url> --json`; quando a UI/API nao envia URL, o backend usa `https://test.salesforce.com` como default.
- Windows: tenta caminhos comuns (`%LOCALAPPDATA%\sf\client\bin\sf.cmd`, Program Files) e fallback para `sf`.
- Entidades usadas:
  - `agf__ADM_Acceptance_Criterion__c` (caso de teste)
  - `agf__ADM_Work__c` (work relacionada em falha)
- Validacoes:
  - ID Salesforce 15/18 chars.
  - Status aceitos: `Passed`, `Failed`.
  - Prioridade failed work: `P0`, `P1`, `P2`.

## Checklist para Alteracoes Futuras

Antes de encerrar uma tarefa que altere codigo:

1. Atualizei endpoints alterados/criados/removidos neste arquivo?
2. Atualizei fluxo funcional se mudou comportamento?
3. Atualizei variaveis de ambiente/pre-requisitos?
4. Atualizei persistencia (`.data`/arquivos) se mudou formato?
5. Mantive este arquivo curto e util para leitura rapida por IA?
