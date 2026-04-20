# SuperPuppeteer - AI Context

Este arquivo existe para reduzir custo de contexto/tokens em futuras sessoes.
Leia este arquivo primeiro antes de abrir `server.js` inteiro.

## Regra Obrigatoria de Manutencao

1. Qualquer alteracao funcional no projeto DEVE atualizar este arquivo no mesmo commit.
2. Se mudar endpoint, fluxo, variavel de ambiente, estrutura de dados, pasta de persistencia ou comportamento de UI, atualize este arquivo.
3. Se o codigo e este arquivo divergirem, trate este arquivo como desatualizado e corrija imediatamente.

## Resumo Rapido

- Stack: Node.js (CommonJS), Express, Puppeteer, WebSocket (`ws`).
- Entrada backend: `server.js`.
- Frontend estatico: `public/index.html`, `public/app.js`, `public/styles.css`.
- Script npm disponivel: `npm start` (`node server.js`).
- Porta: `process.env.PORT || 3000`.
- Objetivo: gravar interacoes no browser, replay de fluxo, salvar cenarios, executar fila, integrar com Salesforce para dados de caso de teste.

## Estrutura de Pastas e Arquivos

- `server.js`: backend completo (API REST + WebSocket + orquestracao Puppeteer + Salesforce).
- `public/index.html`: UI principal.
- `public/app.js`: logica de UI, chamadas para API, websocket, renderizacao de listas/modais.
- `public/styles.css`: tema claro/escuro e layout.
- `.data/scenarios.json`: persistencia de cenarios e fila.
- `.data/recordings/`: arquivos de video `.webm` do replay.
- `.data/recordings-index.json`: indice/metadata das execucoes gravadas.
- `.user-data/chrome-profile/`: perfil do Chrome gerenciado pelo Puppeteer.

## Como Executar

## Pre-requisitos

- Node.js 18+ recomendado.
- NPM.
- Ambiente com UI grafica (o fluxo abre navegador real via Puppeteer).

## Comandos

```powershell
cd C:\GIT\Repository\SuperPuppeteer
npm install
npm start
```

Abrir no navegador:

```text
http://localhost:3000
```

## Variaveis de Ambiente

- `PORT`: porta HTTP (default `3000`).
- `SALESFORCE_TARGET_ORG`: org alvo do `sf` CLI (default `Elera`).
- Tambem sao usados internamente no processo do `sf`: `SF_DISABLE_LOG_FILE`, `SF_LOG_LEVEL`, `NO_COLOR`, `CI`.

Exemplo PowerShell:

```powershell
$env:PORT=3001
$env:SALESFORCE_TARGET_ORG="Elera"
npm start
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
6. Integracao Salesforce para caso de teste (descricao/status/work relacionada failed).

## Estado em Memoria (Backend)

Campos principais de `state`:

- sessao: `status`, `eventCount`, `currentRecording`, `lastRecording`
- browser: `browser`, `page`, `recordingEnabled`
- cenarios/fila: `savedScenarios`, `queue`, `queueRunning`, `queuePaused`, `queueCursor`, `extendScenarioId`
- replay: `replayLog`, `queueRecordVideo`

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
- `GET /api/scenarios/:id`
- `POST /api/scenarios/:id/run`
- `POST /api/scenarios/:id/rename`
- `POST /api/scenarios/:id/duplicate`
- `POST /api/scenarios/:id/extend`
- `POST /api/scenarios/:id/move`
- `DELETE /api/scenarios/:id`
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

