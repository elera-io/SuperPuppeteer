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
- Porta: `process.env.PORT || 3000`.
- Objetivo: gravar interacoes no browser, replay de fluxo, salvar cenarios locais/offline, sincronizar casos pendentes com nuvem, executar fila, integrar com Salesforce para dados de caso de teste.

## Estrutura de Pastas e Arquivos

- `server.js`: backend completo (API REST + WebSocket + orquestracao Puppeteer + Salesforce).
- `public/index.html`: UI principal.
- `public/app.js`: logica de UI, chamadas para API, websocket, renderizacao de listas/modais.
- `public/styles.css`: tema claro/escuro e layout.
- LocalStorage (`superpuppeteer.localState.v1`): base local/offline de cenarios e fila por navegador/usuario.
- `.data/scenarios.json`: espelho/migracao legado do backend; nao e mais a base local principal.
- `.data/recordings/`: arquivos de video `.webm` do replay.
- `.data/recordings-index.json`: indice/metadata das execucoes gravadas.
- `.user-data/chrome-profile/`: perfil do Chrome gerenciado pelo Puppeteer.
- Se o servidor reiniciar e sobrar um Chrome orfao com esse perfil, `ensureBrowser()` tenta encerrar o dono do `SingletonLock` e relancar.

## Como Executar

## Pre-requisitos

- Node.js 18+ recomendado.
- NPM.
- PostgreSQL acessivel pela rede Tailscale via `.env` local. Configuracao validada: host `100.80.233.118`, porta `5432`, usuario/banco `superpuppeteer`.
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
http://localhost:3000
```

Nao abrir a UI pelo Live Server (`127.0.0.1:5500`): os botoes dependem das APIs e do WebSocket servidos pelo `server.js`.

## Variaveis de Ambiente

- `PORT`: porta HTTP (default `3000`).
- `DATABASE_URL`: conexao PostgreSQL para sincronizacao cloud (`postgres://usuario:senha@host:5432/superpuppeteer`). Tem prioridade sobre as variaveis `PG*`.
- Alternativa PostgreSQL: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.
- Configuracao UAT via `.env` local: `PGHOST=100.80.233.118`, `PGPORT=5432`, `PGDATABASE=superpuppeteer`, `PGUSER=superpuppeteer`, `PGPASSWORD=superpuppeteer`.
- `POSTGRES_DISABLED=true`: desativa a integracao PostgreSQL.
- `POSTGRES_CONNECTION_TIMEOUT_MS`: timeout de conexao do PostgreSQL (default `5000`).
- `POSTGRES_IDLE_TIMEOUT_MS`: timeout de conexao ociosa no pool (default `30000`).
- `POSTGRES_SCENARIOS_TABLE`: tabela de destino (default `superpuppeteer_scenarios`).
- `SALESFORCE_TARGET_ORG`: org alvo do `sf` CLI (default `Elera`).
- Tambem sao usados internamente no processo do `sf`: `SF_DISABLE_LOG_FILE`, `SF_LOG_LEVEL`, `NO_COLOR`, `CI`.

Exemplo PowerShell:

```powershell
$env:PORT=3001
$env:PGHOST="100.80.233.118"
$env:PGPORT="5432"
$env:PGDATABASE="superpuppeteer"
$env:PGUSER="superpuppeteer"
$env:PGPASSWORD="superpuppeteer"
$env:SALESFORCE_TARGET_ORG="Elera"
npm start
```

Configuracao local atual em `.env`:

```text
PGHOST=100.80.233.118
PGPORT=5432
PGDATABASE=superpuppeteer
PGUSER=superpuppeteer
PGPASSWORD=superpuppeteer
POSTGRES_SCENARIOS_TABLE=superpuppeteer_scenarios
```

Endpoint de diagnostico do banco:

```text
GET /api/database/status
```

Esse endpoint conecta no PostgreSQL, garante/cria a tabela de cenarios, adiciona colunas faltantes quando a tabela ja existe e retorna as colunas encontradas. A tabela esperada e:

```text
superpuppeteer_scenarios
```

Colunas usadas para salvar/importar casos:

```text
cloud_id TEXT
local_id TEXT
name TEXT
test_case_id TEXT
client_name TEXT
project_name TEXT
work_name TEXT
payload JSONB
created_at TIMESTAMPTZ
synced_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Indices criados automaticamente:

```text
superpuppeteer_scenarios_cloud_id_uidx UNIQUE (cloud_id)
superpuppeteer_scenarios_local_id_idx (local_id)
```

Comandos uteis:

```bash
npm run db:start
npm run db:status
npm run db:stop
```

## Fluxo Funcional (Alto Nivel)

1. Usuario abre URL alvo (`/api/navigate`).
2. Inicia gravacao (`/api/recording/start`), eventos entram em memoria e via WebSocket na UI.
3. Finaliza gravacao (`/api/recording/stop`) e pode:
   - exportar ultimo JSON (`/api/export/last`),
   - salvar cenario (`/api/scenarios/save`).
4. Replay:
   - ultimo (`/api/replay/last`),
   - por cenario (`/api/scenarios/:id/run`),
   - fila (`/api/queue/*`).
5. Opcional: gravar video no replay; arquivos vao para `.data/recordings`.
6. Usuario pode clicar em "Sincronizar Casos" para enviar apenas cenarios com `CasoSincronizado: false`.
7. Integracao Salesforce para caso de teste (descricao/status/work relacionada failed).

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
