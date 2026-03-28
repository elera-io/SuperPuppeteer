const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const execFileAsync = promisify(execFile);

const PROFILE_DIR = path.join(__dirname, '.user-data', 'chrome-profile');
const DATA_DIR = path.join(__dirname, '.data');
const SCENARIOS_FILE = path.join(DATA_DIR, 'scenarios.json');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const RECORDINGS_INDEX_FILE = path.join(DATA_DIR, 'recordings-index.json');
const SALESFORCE_TARGET_ORG = process.env.SALESFORCE_TARGET_ORG || 'Elera';
const SALESFORCE_ACCEPTANCE_OBJECT = 'agf__ADM_Acceptance_Criterion__c';
const SALESFORCE_ACCEPTANCE_FIELDS =
  'Id, Name, agf__Status__c, agf__Description__c, agf__Work__r.Project__r.Name, agf__Work__r.Name, agf__Work__r.NomeCliente__c';
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const SALESFORCE_ACCEPTANCE_STATUS_VALUES = new Set(['Passed', 'Failed']);
const SESSION_FILES = [
  path.join(PROFILE_DIR, 'Default', 'Current Session'),
  path.join(PROFILE_DIR, 'Default', 'Current Tabs'),
  path.join(PROFILE_DIR, 'Default', 'Last Session'),
  path.join(PROFILE_DIR, 'Default', 'Last Tabs'),
];

const state = {
  status: 'Idle',
  eventCount: 0,
  currentRecording: null,
  lastRecording: null,
  replayLog: [],
  savedScenarios: [],
  queue: [],
  queueRunning: false,
  queuePaused: false,
  queueRecordVideo: false,
  queueCursor: 0,
  extendScenarioId: null,
  browser: null,
  page: null,
  recordingEnabled: false,
};

const ensureDataDir = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
};
const ensureRecordingsDir = () => {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
};
const asBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não', 'off'].includes(normalized)) return false;
  }
  return false;
};
const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};
const normalizeOptionalText = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.length ? normalized : null;
};
const normalizeAcceptanceStatus = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'passed') return 'Passed';
  if (normalized === 'failed') return 'Failed';
  return null;
};
const extractScenarioTestCase = (item) => {
  const id = normalizeOptionalString(
    item?.testCase?.id || item?.testCase?.Id || item?.testCaseId
  );
  if (!id) return null;
  return {
    id,
    name: normalizeOptionalString(item?.testCase?.name || item?.testCase?.Name || item?.testCaseName),
    clientName: normalizeOptionalString(
      item?.testCase?.clientName ||
        item?.testCase?.client ||
        item?.testCase?.NomeCliente__c ||
        item?.testCase?.NomeCliente__C ||
        item?.testCaseClientName
    ),
    projectName: normalizeOptionalString(
      item?.testCase?.projectName || item?.testCase?.project || item?.testCaseProjectName
    ),
    workName: normalizeOptionalString(
      item?.testCase?.workName || item?.testCase?.work || item?.testCaseWorkName
    ),
    status: normalizeAcceptanceStatus(
      item?.testCase?.status ||
        item?.testCase?.Status ||
        item?.testCase?.agf__Status__c ||
        item?.testCaseStatus
    ),
    description: normalizeOptionalText(
      item?.testCase?.description ||
        item?.testCase?.Description ||
        item?.testCase?.agf__Description__c ||
        item?.testCaseDescription
    ),
  };
};
const buildAcceptanceCriterionQuery = (testCaseId) =>
  `SELECT ${SALESFORCE_ACCEPTANCE_FIELDS} FROM ${SALESFORCE_ACCEPTANCE_OBJECT} WHERE Id = '${testCaseId}'`;
const fetchTestCaseFromSalesforce = async (testCaseId) => {
  if (!SALESFORCE_ID_PATTERN.test(testCaseId)) {
    const error = new Error('ID do caso de teste inválido. Use um ID Salesforce com 15 ou 18 caracteres.');
    error.statusCode = 400;
    throw error;
  }

  const query = buildAcceptanceCriterionQuery(testCaseId);
  try {
    const { stdout } = await execFileAsync(
      'sf',
      ['data', 'query', '--query', query, '--target-org', SALESFORCE_TARGET_ORG, '--json'],
      { maxBuffer: 1024 * 1024 }
    );
    const payload = JSON.parse(stdout || '{}');
    const records = Array.isArray(payload?.result?.records) ? payload.result.records : [];
    const record = records[0];
    if (!record) {
      const error = new Error(
        `Caso de teste ${testCaseId} não encontrado no org ${SALESFORCE_TARGET_ORG}.`
      );
      error.statusCode = 404;
      throw error;
    }

    return {
      id: normalizeOptionalString(record.Id) || testCaseId,
      name: normalizeOptionalString(record.Name),
      clientName: normalizeOptionalString(
        record.agf__Work__r?.NomeCliente__c || record.agf__Work__r?.NomeCliente__C
      ),
      projectName: normalizeOptionalString(record.agf__Work__r?.Project__r?.Name),
      workName: normalizeOptionalString(record.agf__Work__r?.Name),
      status: normalizeAcceptanceStatus(record.agf__Status__c),
      description: normalizeOptionalText(record.agf__Description__c),
    };
  } catch (error) {
    if (error.statusCode) throw error;
    const stderr = normalizeOptionalString(error.stderr);
    const stdout = normalizeOptionalString(error.stdout);
    const detail = stderr || stdout || normalizeOptionalString(error.message) || 'Erro desconhecido.';
    const wrappedError = new Error(
      `Falha ao consultar o Salesforce para o caso ${testCaseId}: ${detail}`
    );
    wrappedError.statusCode = error.code === 'ENOENT' ? 500 : 502;
    throw wrappedError;
  }
};
const getSalesforceConnection = async () => {
  try {
    const { stdout } = await execFileAsync(
      'sf',
      ['org', 'display', '--target-org', SALESFORCE_TARGET_ORG, '--verbose', '--json'],
      { maxBuffer: 1024 * 1024 }
    );
    const payload = JSON.parse(stdout || '{}');
    const result = payload?.result || {};
    const accessToken = normalizeOptionalString(result.accessToken);
    const instanceUrl = normalizeOptionalString(result.instanceUrl);
    const apiVersion = normalizeOptionalString(result.apiVersion) || '60.0';
    if (!accessToken || !instanceUrl) {
      const error = new Error('Não foi possível obter a sessão ativa do Salesforce.');
      error.statusCode = 502;
      throw error;
    }
    return {
      accessToken,
      instanceUrl: instanceUrl.replace(/\/+$/, ''),
      apiVersion,
    };
  } catch (error) {
    if (error.statusCode) throw error;
    const detail = normalizeOptionalString(error.stderr) || normalizeOptionalString(error.message) || 'Erro desconhecido.';
    const wrappedError = new Error(
      `Falha ao obter a sessão Salesforce (${SALESFORCE_TARGET_ORG}): ${detail}`
    );
    wrappedError.statusCode = error.code === 'ENOENT' ? 500 : 502;
    throw wrappedError;
  }
};
const patchAcceptanceCriterionFields = async (testCaseId, values, label) => {
  if (!SALESFORCE_ID_PATTERN.test(testCaseId)) {
    const error = new Error('ID do caso de teste inválido. Use um ID Salesforce com 15 ou 18 caracteres.');
    error.statusCode = 400;
    throw error;
  }

  const { accessToken, instanceUrl, apiVersion } = await getSalesforceConnection();
  const endpoint = `${instanceUrl}/services/data/v${apiVersion}/sobjects/${encodeURIComponent(
    SALESFORCE_ACCEPTANCE_OBJECT
  )}/${encodeURIComponent(testCaseId)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
    });

    if (response.ok) return;

    const payload = await response.json().catch(() => null);
    let detail = null;
    if (Array.isArray(payload)) {
      detail = payload
        .map((item) => normalizeOptionalString(item?.message))
        .filter(Boolean)
        .join(' | ');
    } else if (payload && typeof payload === 'object') {
      detail = normalizeOptionalString(payload.message) || normalizeOptionalString(payload.error);
    }

    const error = new Error(
      `Falha ao atualizar ${label} no Salesforce para o caso ${testCaseId}: ${
        detail || `HTTP ${response.status}`
      }`
    );
    error.statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  } catch (error) {
    if (error.statusCode) throw error;
    const detail = normalizeOptionalString(error.message) || 'Erro desconhecido.';
    const wrappedError = new Error(
      `Falha ao atualizar ${label} no Salesforce para o caso ${testCaseId}: ${detail}`
    );
    wrappedError.statusCode = 502;
    throw wrappedError;
  }
};
const updateAcceptanceCriterionDescription = async (testCaseId, description) => {
  const nextDescription = typeof description === 'string' ? description.replace(/\r\n/g, '\n') : '';
  await patchAcceptanceCriterionFields(
    testCaseId,
    { agf__Description__c: nextDescription },
    'a descrição'
  );
  return normalizeOptionalText(nextDescription);
};
const updateAcceptanceCriterionStatus = async (testCaseId, status) => {
  const normalizedStatus = normalizeAcceptanceStatus(status);
  if (!normalizedStatus || !SALESFORCE_ACCEPTANCE_STATUS_VALUES.has(normalizedStatus)) {
    const error = new Error('Status inválido. Use Passed ou Failed.');
    error.statusCode = 400;
    throw error;
  }
  await patchAcceptanceCriterionFields(
    testCaseId,
    { agf__Status__c: normalizedStatus },
    'o status'
  );
  return normalizedStatus;
};
const syncTestCaseDescription = (testCaseId, description) => {
  const normalizedDescription = normalizeOptionalText(description);
  state.savedScenarios.forEach((scenario) => {
    if (!scenario?.testCase || scenario.testCase.id !== testCaseId) return;
    scenario.testCase.description = normalizedDescription;
  });
  return normalizedDescription;
};
const syncTestCaseStatus = (testCaseId, status) => {
  const normalizedStatus = normalizeAcceptanceStatus(status);
  state.savedScenarios.forEach((scenario) => {
    if (!scenario?.testCase || scenario.testCase.id !== testCaseId) return;
    scenario.testCase.status = normalizedStatus;
  });
  return normalizedStatus;
};

const loadScenarios = () => {
  try {
    if (!fs.existsSync(SCENARIOS_FILE)) return;
    const raw = fs.readFileSync(SCENARIOS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const savedList = Array.isArray(parsed)
      ? parsed
      : parsed?.savedScenarios || parsed?.scenarios;
    const queueList = parsed?.queue;
    if (!Array.isArray(savedList)) return;
    state.savedScenarios = savedList
      .filter((item) => item && Array.isArray(item.events))
      .map((item, index) => ({
        id: item.id || generateId('scn'),
        name: item.name || `Cenário ${index + 1}`,
        createdAt: item.createdAt || nowIso(),
        events: item.events || [],
        duration: item.duration || 0,
        startUrl: item.startUrl || null,
        testCase: extractScenarioTestCase(item),
      }));
    if (Array.isArray(queueList)) {
      state.queue = queueList
        .filter((item) => item && (item.scenarioId || item.scenario))
        .map((item) => ({
          id: item.id || generateId('q'),
          scenarioId: item.scenarioId || item.scenario?.id || null,
          name: item.name || item.scenario?.name || 'Cenário',
          duration: item.duration || item.scenario?.duration || 0,
          eventCount: item.eventCount || item.scenario?.events?.length || 0,
        }))
        .filter((item) => item.scenarioId);
    }
  } catch (error) {
    // ignore invalid files
  }
};

const saveScenarios = () => {
  ensureDataDir();
  fs.writeFileSync(
    SCENARIOS_FILE,
    JSON.stringify(
      {
        savedScenarios: state.savedScenarios,
        queue: state.queue,
      },
      null,
      2
    )
  );
};

const normalizeRecordingsIndexEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const name = normalizeOptionalString(entry.name);
  if (!name) return null;
  const source = normalizeOptionalString(entry.source) || 'single';
  const scenarioId = normalizeOptionalString(entry.scenarioId);
  const scenarioName = normalizeOptionalString(entry.scenarioName);
  const recordingId = normalizeOptionalString(entry.recordingId);
  const savedAt = normalizeOptionalString(entry.savedAt) || nowIso();
  const startUrl = normalizeOptionalString(entry.startUrl);
  const queueIndexRaw = Number(entry.queueIndex);
  const queueIndex =
    Number.isInteger(queueIndexRaw) && queueIndexRaw >= 0 ? queueIndexRaw : null;
  return {
    name,
    source,
    scenarioId,
    scenarioName,
    recordingId,
    savedAt,
    startUrl,
    queueIndex,
  };
};
const loadRecordingsIndex = () => {
  try {
    if (!fs.existsSync(RECORDINGS_INDEX_FILE)) return [];
    const raw = fs.readFileSync(RECORDINGS_INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.recordings;
    if (!Array.isArray(list)) return [];
    return list.map((entry) => normalizeRecordingsIndexEntry(entry)).filter(Boolean);
  } catch (error) {
    return [];
  }
};
const saveRecordingsIndex = (entries) => {
  ensureDataDir();
  fs.writeFileSync(
    RECORDINGS_INDEX_FILE,
    JSON.stringify(
      {
        recordings: Array.isArray(entries) ? entries : [],
      },
      null,
      2
    )
  );
};
const removeRecordingIndexEntry = (name) => {
  const targetName = normalizeOptionalString(name);
  if (!targetName) return;
  const entries = loadRecordingsIndex();
  const nextEntries = entries.filter((entry) => entry.name !== targetName);
  if (nextEntries.length !== entries.length) {
    saveRecordingsIndex(nextEntries);
  }
};
const registerRecordingExecution = (filePath, recording, options = {}) => {
  const fileName = normalizeOptionalString(path.basename(String(filePath || '')));
  if (!fileName) return null;

  const entry = normalizeRecordingsIndexEntry({
    name: fileName,
    source: normalizeOptionalString(options.source) || 'single',
    scenarioId: normalizeOptionalString(options.scenarioId),
    scenarioName: normalizeOptionalString(
      options.scenarioName || recording?.name || findScenario(options.scenarioId || '')?.name
    ),
    recordingId: normalizeOptionalString(recording?.id),
    savedAt: nowIso(),
    startUrl: normalizeOptionalString(options.overrideUrl || recording?.startUrl),
    queueIndex:
      Number.isInteger(options.queueIndex) && options.queueIndex >= 0 ? options.queueIndex : null,
  });
  if (!entry) return null;

  try {
    const entries = loadRecordingsIndex().filter((item) => item.name !== entry.name);
    entries.push(entry);
    entries.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    saveRecordingsIndex(entries);
    return entry;
  } catch (error) {
    return null;
  }
};

const listRecordings = (options = {}) => {
  ensureRecordingsDir();
  const filterScenarioId = normalizeOptionalString(options.scenarioId);
  const indexEntries = loadRecordingsIndex();
  const indexByName = new Map(indexEntries.map((entry) => [entry.name, entry]));
  const files = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true });
  const existingNames = new Set();
  const recordings = files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.webm'))
    .map((entry) => {
      const filePath = path.join(RECORDINGS_DIR, entry.name);
      existingNames.add(entry.name);
      let stats = null;
      try {
        stats = fs.statSync(filePath);
      } catch (error) {
        return null;
      }
      const indexEntry = indexByName.get(entry.name);
      const scenario = indexEntry?.scenarioId ? findScenario(indexEntry.scenarioId) : null;
      const scenarioName = scenario?.name || indexEntry?.scenarioName || null;
      return {
        name: entry.name,
        size: stats.size,
        createdAt: stats.birthtime ? stats.birthtime.toISOString() : nowIso(),
        updatedAt: stats.mtime ? stats.mtime.toISOString() : nowIso(),
        savedAt: indexEntry?.savedAt || (stats.mtime ? stats.mtime.toISOString() : nowIso()),
        source: indexEntry?.source || 'single',
        scenarioId: indexEntry?.scenarioId || null,
        scenarioName,
        queueIndex:
          Number.isInteger(indexEntry?.queueIndex) && indexEntry.queueIndex >= 0
            ? indexEntry.queueIndex
            : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const hasStaleEntries = indexEntries.some((entry) => !existingNames.has(entry.name));
  if (hasStaleEntries) {
    const nextEntries = indexEntries.filter((entry) => existingNames.has(entry.name));
    saveRecordingsIndex(nextEntries);
  }

  if (filterScenarioId) {
    return recordings.filter((recording) => recording.scenarioId === filterScenarioId);
  }

  return recordings;
};

const findScenario = (id) => state.savedScenarios.find((scenario) => scenario.id === id);

const scenarioSummary = (scenario) => ({
  id: scenario.id,
  name: scenario.name,
  createdAt: scenario.createdAt,
  duration: scenario.duration,
  eventCount: scenario.events.length,
  testCase: scenario.testCase
    ? {
        id: scenario.testCase.id,
        name: scenario.testCase.name || null,
        clientName: scenario.testCase.clientName || null,
        projectName: scenario.testCase.projectName || null,
        workName: scenario.testCase.workName || null,
        status: scenario.testCase.status || null,
        description: scenario.testCase.description || null,
      }
    : null,
});

const cloneEvent = (event) => ({
  ...event,
  selectors: Array.isArray(event.selectors) ? [...event.selectors] : event.selectors,
  shadowPath: Array.isArray(event.shadowPath)
    ? event.shadowPath.map((item) => (item ? { ...item } : item))
    : event.shadowPath,
  rect: event.rect ? { ...event.rect } : event.rect,
  offset: event.offset ? { ...event.offset } : event.offset,
  framePath: Array.isArray(event.framePath) ? [...event.framePath] : event.framePath,
});

const cloneEvents = (events) => (Array.isArray(events) ? events.map(cloneEvent) : []);

const eventsDuration = (events, fallback = 0) => {
  if (!Array.isArray(events) || events.length === 0) return fallback || 0;
  let max = 0;
  for (const event of events) {
    if (typeof event.t === 'number' && event.t > max) max = event.t;
  }
  return max;
};

const eventTargetKey = (event) => {
  if (!event) return null;
  const parts = [];
  if (Array.isArray(event.framePath) && event.framePath.length) {
    parts.push(`frame:${event.framePath.join('>')}`);
  }
  if (Array.isArray(event.shadowPath) && event.shadowPath.length) {
    const shadow = event.shadowPath
      .map((item) => (item ? `${item.enterShadow ? '1' : '0'}:${item.selector}` : ''))
      .join('>');
    if (shadow) parts.push(`shadow:${shadow}`);
  }
  if (event.selector) {
    parts.push(`sel:${event.selector}`);
  } else if (Array.isArray(event.selectors) && event.selectors.length) {
    parts.push(`sel:${event.selectors[0]}`);
  }
  return parts.length ? parts.join('|') : null;
};

const buildInputOverrides = (recording) => {
  const overrides = new Map();
  if (!recording || !Array.isArray(recording.events)) return overrides;
  for (const event of recording.events) {
    if (event.type !== 'input' && event.type !== 'change') continue;
    if (!Object.prototype.hasOwnProperty.call(event, 'customValue')) continue;
    const key = eventTargetKey(event);
    if (!key) continue;
    overrides.set(key, event.customValue ?? '');
  }
  return overrides;
};

const checkedFromValue = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim', 'checked', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não', 'unchecked', 'off'].includes(normalized)) return false;
  }
  return typeof fallback === 'boolean' ? fallback : undefined;
};

const queueItemFromScenario = (scenario) => ({
  id: generateId('q'),
  scenarioId: scenario.id,
  name: scenario.name,
  duration: scenario.duration,
  eventCount: scenario.events.length,
});

const syncQueueScenario = (scenario) => {
  state.queue.forEach((item) => {
    if (item.scenarioId === scenario.id) {
      item.name = scenario.name;
      item.duration = scenario.duration;
      item.eventCount = scenario.events.length;
    }
  });
};

const recorderScript = `(() => {
  if (window.__recorderInstalled) return;
  window.__recorderInstalled = true;

  const control = {
    paused: false,
    pauseStart: 0,
    timeOffset: 0,
    startAt: performance.now(),
  };

  const MAX_VALUE = 10000;

  const now = () => performance.now() - control.startAt - control.timeOffset;
  const nowRaw = () => performance.now();

  const cssEscape = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\\\' + ch);
  };

  const escapeAttribute = (value) => {
    return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  };

  const buildSelector = (element, docOverride) => {
    if (!element || element.nodeType !== 1) return null;
    const doc = docOverride || document;
    if (element.id) return '#' + cssEscape(element.id);
    const parts = [];
    let el = element;
    while (el && el.nodeType === 1 && el.tagName.toLowerCase() !== 'html') {
      let part = el.tagName.toLowerCase();
      const classList = (el.className || '').split(' ').filter(Boolean).slice(0, 2);
      if (classList.length) {
        part += '.' + classList.map(cssEscape).join('.');
      }
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(el) + 1;
          part += ':nth-of-type(' + index + ')';
        }
      }
      parts.unshift(part);
      const selector = parts.join(' > ');
      if (doc && doc.querySelector) {
        try {
          if (doc.querySelector(selector) === element) return selector;
        } catch (error) {
          // ignore
        }
      }
      el = el.parentElement;
    }
    return parts.join(' > ');
  };

  const getFramePath = () => {
    const path = [];
    let win = window;
    while (win && win !== win.parent) {
      const frameEl = win.frameElement;
      if (!frameEl) break;
      const selector = buildSelector(frameEl, frameEl.ownerDocument);
      if (selector) path.unshift(selector);
      win = win.parent;
    }
    return path;
  };

  const getClickableTarget = (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    const fallback = event.target && event.target.nodeType === 1 ? event.target : null;

    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (['button', 'a', 'input', 'textarea', 'select', 'label'].includes(tag)) return node;
      const role = node.getAttribute && node.getAttribute('role');
      if (role === 'button' || role === 'link') return node;
      if (typeof node.onclick === 'function' || node.getAttribute('onclick')) return node;
      if (node.tabIndex >= 0) return node;
    }

    return fallback;
  };

  const getOptionContext = (event) => {
    const path = event && event.composedPath ? event.composedPath() : [];
    let optionNode = null;
    let valueNode = null;
    let listboxId = null;

    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      const role = node.getAttribute && node.getAttribute('role');
      if (!optionNode && role === 'option') optionNode = node;
      if (!valueNode && node.getAttribute && node.getAttribute('data-value')) valueNode = node;
      if (!listboxId && role === 'listbox') listboxId = node.id || null;
      if (optionNode && valueNode && listboxId) break;
    }

    const baseNode = optionNode || valueNode;
    if (!baseNode) return null;

    let optionValue = null;
    if (valueNode && valueNode.getAttribute) {
      optionValue = valueNode.getAttribute('data-value') || null;
    }
    if (!optionValue && baseNode.getAttribute) {
      optionValue = baseNode.getAttribute('data-value') || null;
    }
    if (!optionValue && baseNode.dataset) {
      optionValue = baseNode.dataset.value || baseNode.dataset.id || null;
    }

    let optionLabel = null;
    if (baseNode.getAttribute) {
      optionLabel = baseNode.getAttribute('aria-label') || baseNode.getAttribute('title') || null;
    }
    if (!optionLabel) {
      optionLabel = (baseNode.innerText || baseNode.textContent || '').trim() || null;
    }

    return {
      option: baseNode,
      optionValue,
      optionLabel,
      listboxId,
    };
  };

  const getInputTarget = (event) => {
    const path = event && event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      const isFormField = ['input', 'textarea', 'select'].includes(tag) || node.isContentEditable;
      if (isFormField) return node;
    }
    const fallback = event && event.target && event.target.nodeType === 1 ? event.target : null;
    if (fallback) {
      const tag = fallback.tagName ? fallback.tagName.toLowerCase() : '';
      const isFormField = ['input', 'textarea', 'select'].includes(tag) || fallback.isContentEditable;
      if (isFormField) return fallback;
    }
    return null;
  };

  const getFormTarget = (event) => {
    const path = event && event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      if (node.tagName && node.tagName.toLowerCase() === 'form') return node;
    }
    const fallback = event && event.target && event.target.nodeType === 1 ? event.target : null;
    if (fallback && fallback.tagName && fallback.tagName.toLowerCase() === 'form') return fallback;
    return null;
  };

  const buildSelectorCandidates = (element) => {
    const selectors = [];
    if (!element || element.nodeType !== 1) return selectors;

    const tag = element.tagName ? element.tagName.toLowerCase() : '';
    const id = element.getAttribute && element.getAttribute('id');
    if (id) selectors.push('#' + cssEscape(id));

    const attrNames = [
      'data-testid',
      'data-test',
      'data-qa',
      'data-id',
      'data-key',
      'data-name',
      'data-label',
      'data-field',
    ];

    attrNames.forEach((attr) => {
      const value = element.getAttribute && element.getAttribute(attr);
      if (!value) return;
      const escaped = escapeAttribute(value);
      if (tag) selectors.push(tag + '[' + attr + '="' + escaped + '"]');
      selectors.push('[' + attr + '="' + escaped + '"]');
    });

    const aria = element.getAttribute && element.getAttribute('aria-label');
    if (aria) {
      const escaped = escapeAttribute(aria);
      if (tag) selectors.push(tag + '[aria-label="' + escaped + '"]');
      selectors.push('[aria-label="' + escaped + '"]');
    }

    const title = element.getAttribute && element.getAttribute('title');
    if (title) {
      const escaped = escapeAttribute(title);
      if (tag) selectors.push(tag + '[title="' + escaped + '"]');
      selectors.push('[title="' + escaped + '"]');
    }

    const name = element.getAttribute && element.getAttribute('name');
    if (name) {
      const escaped = escapeAttribute(name);
      if (tag) selectors.push(tag + '[name="' + escaped + '"]');
      selectors.push('[name="' + escaped + '"]');
    }

    const role = element.getAttribute && element.getAttribute('role');
    if (role && (aria || title)) {
      const label = aria || title;
      const escaped = escapeAttribute(label);
      selectors.push('[role="' + escapeAttribute(role) + '"][aria-label="' + escaped + '"]');
    }

    const fallback = buildSelector(element, element.getRootNode && element.getRootNode());
    if (fallback) selectors.push(fallback);

    return Array.from(new Set(selectors));
  };

  const buildShadowPath = (element) => {
    const path = [];
    let node = element;
    let root = node && node.getRootNode ? node.getRootNode() : null;
    let skipSelector = false;

    while (node && root) {
      if (!skipSelector) {
        const selector = buildSelector(node, root);
        if (selector) path.unshift({ selector, enterShadow: false });
      }
      skipSelector = false;

      if (!root.host) break;
      const host = root.host;
      const hostRoot = host.getRootNode ? host.getRootNode() : document;
      const hostSelector = buildSelector(host, hostRoot);
      if (hostSelector) path.unshift({ selector: hostSelector, enterShadow: true });
      node = host;
      root = hostRoot;
      skipSelector = true;
    }

    return path;
  };

  const record = (payload) => {
    if (control.paused) return;
    if (!window.__recordEvent) return;
    const data = {
      ...payload,
      t: now(),
      url: location.href,
      framePath: getFramePath(),
    };
    window.__recordEvent(data);
  };

  const isReplayCursor = (target) => target && target.id === '__replay-cursor';

  const markEventOnce = (event, key) => {
    if (!event) return false;
    const prop = '__sp_' + key;
    if (event[prop]) return false;
    try {
      Object.defineProperty(event, prop, { value: true, configurable: true });
    } catch (error) {
      event[prop] = true;
    }
    return true;
  };

  const isScrollable = (element) => {
    if (!element || element.nodeType !== 1) return false;
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const canScrollY =
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      element.scrollHeight > element.clientHeight + 1;
    const canScrollX =
      (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
      element.scrollWidth > element.clientWidth + 1;
    return canScrollY || canScrollX;
  };

  const findScrollableTarget = (event) => {
    const path = event && event.composedPath ? event.composedPath() : [];
    if (!path.length && event && event.target) path.push(event.target);
    for (const node of path) {
      if (isScrollable(node)) return node;
    }
    return null;
  };

  const scrollThrottle = new WeakMap();
  const shouldThrottle = (key) => {
    const last = scrollThrottle.get(key) || 0;
    const current = nowRaw();
    if (current - last < 120) return true;
    scrollThrottle.set(key, current);
    return false;
  };

  const recordElementScroll = (target) => {
    if (!target || shouldThrottle(target)) return;
    const rect = target.getBoundingClientRect();
    record({
      type: 'scroll',
      targetType: 'element',
      selector: buildSelector(target, target.getRootNode && target.getRootNode()),
      selectors: buildSelectorCandidates(target),
      shadowPath: buildShadowPath(target),
      rect: rect
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : null,
      scrollTop: target.scrollTop,
      scrollLeft: target.scrollLeft,
    });
  };

  const recordWindowScroll = () => {
    if (shouldThrottle(window)) return;
    record({
      type: 'scroll',
      targetType: 'window',
      x: window.scrollX,
      y: window.scrollY,
    });
  };

  const onClick = (event) => {
    if (isReplayCursor(event.target)) return;
    if (!markEventOnce(event, 'click')) return;
    if (event.detail && event.detail > 1) return;
    const optionContext = getOptionContext(event);
    const target = optionContext && optionContext.option ? optionContext.option : getClickableTarget(event);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const selectors = buildSelectorCandidates(target);
    const label =
      (target.getAttribute && (target.getAttribute('aria-label') || target.getAttribute('title'))) ||
      target.innerText ||
      '';
    const text = String(label || '').trim().slice(0, 80);

    record({
      type: 'click',
      selector: buildSelector(target, target.getRootNode && target.getRootNode()),
      selectors,
      shadowPath: buildShadowPath(target),
      rect: rect
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : null,
      offset: rect
        ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
        : null,
      text,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      optionValue: optionContext ? optionContext.optionValue : null,
      optionLabel: optionContext ? optionContext.optionLabel : null,
      listboxId: optionContext ? optionContext.listboxId : null,
    });
  };

  const onDblClick = (event) => {
    if (isReplayCursor(event.target)) return;
    if (!markEventOnce(event, 'dblclick')) return;
    if (event.detail && event.detail < 2) return;
    const optionContext = getOptionContext(event);
    const target = optionContext && optionContext.option ? optionContext.option : getClickableTarget(event);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const selectors = buildSelectorCandidates(target);
    const label =
      (target.getAttribute && (target.getAttribute('aria-label') || target.getAttribute('title'))) ||
      target.innerText ||
      '';
    const text = String(label || '').trim().slice(0, 80);

    record({
      type: 'double-click',
      selector: buildSelector(target, target.getRootNode && target.getRootNode()),
      selectors,
      shadowPath: buildShadowPath(target),
      rect: rect
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : null,
      offset: rect
        ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
        : null,
      text,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      optionValue: optionContext ? optionContext.optionValue : null,
      optionLabel: optionContext ? optionContext.optionLabel : null,
      listboxId: optionContext ? optionContext.listboxId : null,
    });
  };

  const captureInput = (event, kind) => {
    const target = getInputTarget(event) || (event && event.target && event.target.nodeType === 1 ? event.target : null);
    if (!target || isReplayCursor(target)) return;

    const tag = target.tagName ? target.tagName.toLowerCase() : '';

    let value = '';
    if (event && event.detail && typeof event.detail.value !== 'undefined') {
      value = String(event.detail.value);
    } else if (target.isContentEditable) {
      value = target.innerText || '';
    } else if (typeof target.value !== 'undefined') {
      value = target.value ?? '';
    } else if (typeof target.getAttribute === 'function') {
      const attrValue = target.getAttribute('value');
      value = attrValue || '';
    }
    if (value.length > MAX_VALUE) value = value.slice(0, MAX_VALUE);

    record({
      type: kind,
      selector: buildSelector(target, target.getRootNode && target.getRootNode()),
      selectors: buildSelectorCandidates(target),
      shadowPath: buildShadowPath(target),
      value,
      inputType: target.type || null,
      tag,
      checked: ['checkbox', 'radio'].includes(target.type) ? target.checked : undefined,
    });
  };

  const onSubmit = (event) => {
    const form = getFormTarget(event);
    if (!form || form.nodeType !== 1) return;
    record({
      type: 'submit',
      selector: buildSelector(form),
    });
  };

  const onKeydown = (event) => {
    if (!event) return;
    if (!markEventOnce(event, 'key')) return;
    if (event.repeat) return;
    const target =
      getInputTarget(event) ||
      (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
    if (!target || isReplayCursor(target)) return;

    record({
      type: 'key',
      selector: buildSelector(target, target.getRootNode && target.getRootNode()),
      selectors: buildSelectorCandidates(target),
      shadowPath: buildShadowPath(target),
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
    });
  };

  window.__recorderControl = {
    enable() {
      control.paused = false;
    },
    disable() {
      control.paused = false;
    },
    pause() {
      if (control.paused) return;
      control.paused = true;
      control.pauseStart = nowRaw();
    },
    resume() {
      if (!control.paused) return;
      control.paused = false;
      control.timeOffset += nowRaw() - control.pauseStart;
      control.pauseStart = 0;
    },
    reset() {
      control.paused = false;
      control.pauseStart = 0;
      control.timeOffset = 0;
      control.startAt = nowRaw();
    },
  };

  const onScroll = (event) => {
    const target = event && event.target;
    if (target && target.nodeType === 1 && target !== document.documentElement && target !== document.body) {
      recordElementScroll(target);
      return;
    }
    recordWindowScroll();
  };

  const onWheel = (event) => {
    const target = findScrollableTarget(event);
    if (target) {
      requestAnimationFrame(() => recordElementScroll(target));
      return;
    }
    requestAnimationFrame(recordWindowScroll);
  };

  const scrollRoots = new WeakSet();
  const interactionRoots = new WeakSet();

  const registerScrollRoot = (root) => {
    if (!root || !root.addEventListener) return;
    if (scrollRoots.has(root)) return;
    scrollRoots.add(root);
    root.addEventListener('scroll', onScroll, { passive: true, capture: true });
    root.addEventListener('wheel', onWheel, { passive: true, capture: true });
  };

  const registerInteractionRoot = (root) => {
    if (!root || !root.addEventListener) return;
    if (interactionRoots.has(root)) return;
    interactionRoots.add(root);
    root.addEventListener('click', onClick, true);
    root.addEventListener('dblclick', onDblClick, true);
    root.addEventListener('input', (event) => captureInput(event, 'input'), true);
    root.addEventListener('change', (event) => captureInput(event, 'change'), true);
    root.addEventListener('submit', onSubmit, true);
    root.addEventListener('keydown', onKeydown, true);
  };

  const registerRoot = (root) => {
    registerScrollRoot(root);
    registerInteractionRoot(root);
  };

  registerRoot(window);
  registerRoot(document);
  registerRoot(document.body);

  const originalAttachShadow = Element.prototype.attachShadow;
  if (originalAttachShadow) {
    Element.prototype.attachShadow = function () {
      const root = originalAttachShadow.apply(this, arguments);
      registerRoot(root);
      return root;
    };
  }

  const scanShadowRoots = () => {
    const all = document.querySelectorAll('*');
    for (const node of all) {
      if (node.shadowRoot) registerRoot(node.shadowRoot);
    }
  };

  scanShadowRoots();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!node || node.nodeType !== 1) return;
        if (node.shadowRoot) registerRoot(node.shadowRoot);
        if (node.querySelectorAll) {
          node.querySelectorAll('*').forEach((child) => {
            if (child.shadowRoot) registerRoot(child.shadowRoot);
          });
        }
      });
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('wheel', onWheel, { passive: true, capture: true });
})();`;

const nowIso = () => new Date().toISOString();
const generateId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const monotonicNow = () => Number(process.hrtime.bigint() / 1000000n);
const MAX_REPLAY_LOG_ITEMS = 300;
const safeFilePart = (value, fallback = 'replay') => {
  const raw = String(value || '').trim() || fallback;
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
};
const buildReplayVideoPath = (recording, options = {}) => {
  const source = options.source || 'single';
  const sourcePart = safeFilePart(source, 'single');
  const namePart = safeFilePart(options.scenarioName || recording?.name || recording?.id || 'cenario');
  const queuePart =
    Number.isInteger(options.queueIndex) && options.queueIndex >= 0
      ? `-fila_${options.queueIndex + 1}`
      : '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${namePart}-${sourcePart}${queuePart}-${stamp}.webm`;
  return path.join(RECORDINGS_DIR, fileName);
};
const roundMs = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
};
const resetReplayLog = () => {
  state.replayLog = [];
};
const pushReplayLog = (entry) => {
  const logItem = {
    id: generateId('log'),
    at: nowIso(),
    ...entry,
  };
  state.replayLog.push(logItem);
  if (state.replayLog.length > MAX_REPLAY_LOG_ITEMS) {
    state.replayLog.splice(0, state.replayLog.length - MAX_REPLAY_LOG_ITEMS);
  }
  broadcast({ type: 'replay-log', entry: logItem });
};
const waitForQueueResumeIfNeeded = async (options = {}, meta = {}) => {
  if (!options.queueAware || !state.queuePaused) return 0;
  const pauseStart = monotonicNow();
  pushReplayLog({
    type: 'queue-pause',
    stage: 'start',
    source: options.source || 'single',
    ...meta,
  });
  while (state.queuePaused) {
    await sleep(120);
  }
  const pausedMs = roundMs(monotonicNow() - pauseStart);
  pushReplayLog({
    type: 'queue-pause',
    stage: 'end',
    source: options.source || 'single',
    pausedMs,
    ...meta,
  });
  return pausedMs;
};
const waitForInteractionDelay = async (targetMs, options = {}, meta = {}) => {
  const waitTarget = roundMs(targetMs);
  if (waitTarget <= 0) return { targetMs: 0, waitMs: 0, pauseMs: 0, elapsedMs: 0 };

  const start = monotonicNow();
  let effectiveWait = 0;
  let queuePauseMs = 0;

  while (effectiveWait < waitTarget) {
    queuePauseMs += await waitForQueueResumeIfNeeded(options, meta);
    const remaining = waitTarget - effectiveWait;
    const chunk = Math.min(remaining, 100);
    await sleep(chunk);
    effectiveWait = monotonicNow() - start - queuePauseMs;
  }

  const elapsed = monotonicNow() - start;
  return {
    targetMs: waitTarget,
    waitMs: roundMs(elapsed - queuePauseMs),
    pauseMs: roundMs(queuePauseMs),
    elapsedMs: roundMs(elapsed),
  };
};

loadScenarios();

const serializeState = () => ({
  status: state.status,
  eventCount: state.eventCount,
  events: state.currentRecording ? state.currentRecording.events.slice(-200) : [],
  lastRecording: state.lastRecording
    ? {
        id: state.lastRecording.id,
        name: state.lastRecording.name || null,
        createdAt: state.lastRecording.createdAt,
        duration: state.lastRecording.duration,
        eventCount: state.lastRecording.events.length,
      }
    : null,
  savedScenarios: state.savedScenarios.map((scenario) => scenarioSummary(scenario)),
  queue: state.queue.map((item) => ({
    id: item.id,
    scenarioId: item.scenarioId,
    name: item.name,
    duration: item.duration,
    eventCount: item.eventCount,
  })),
  queueStatus: {
    running: state.queueRunning,
    paused: state.queuePaused,
    cursor: state.queueCursor,
  },
  replayLog: state.replayLog.slice(-200),
  extendScenario: state.extendScenarioId
    ? (() => {
        const scenario = findScenario(state.extendScenarioId);
        if (!scenario) {
          state.extendScenarioId = null;
          return null;
        }
        return scenarioSummary(scenario);
      })()
    : null,
});

const broadcast = (payload) => {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
};

const broadcastState = () => {
  broadcast({ type: 'state', state: serializeState() });
};

const handleRecordEvent = (event) => {
  if (!state.recordingEnabled || state.status !== 'Recording') return;
  if (!state.currentRecording) return;

  const base = state.currentRecording.startEpoch;
  const paused = state.currentRecording.pausedDuration || 0;
  const baseOffset = state.currentRecording.baseOffset || 0;
  const tRaw =
    typeof event.t === 'number'
      ? event.t
      : typeof event.ts === 'number'
        ? event.ts - base - paused
        : 0;
  const t = tRaw + baseOffset;
  const normalizedEvent = { ...event, t };

  state.currentRecording.events.push(normalizedEvent);
  state.currentRecording.duration = Math.max(state.currentRecording.duration || 0, t);
  state.eventCount = state.currentRecording.events.length;

  broadcast({ type: 'event', event: normalizedEvent, count: state.eventCount });
};

const setupPage = async (page) => {
  if (page.__recorderSetup) return;
  page.__recorderSetup = true;

  await page.exposeFunction('__recordEvent', (event) => handleRecordEvent(event));
  await page.evaluateOnNewDocument(recorderScript);
  try {
    await page.evaluate(recorderScript);
  } catch (error) {
    // Ignore evaluation errors on restricted or closed pages.
  }
};

const isIgnorableError = (error) => {
  const message = String(error?.message || error || '');
  return (
    message.includes('detached Frame') ||
    message.includes('Execution context was destroyed') ||
    message.includes('Target closed') ||
    message.includes('Cannot find context')
  );
};

const getActivePage = async () => {
  if (state.page && !state.page.isClosed()) return state.page;
  if (!state.browser) return null;
  const pages = await state.browser.pages();
  const page = pages.find((item) => !item.isClosed());
  if (page) {
    await setupPage(page);
    state.page = page;
  }
  return page || null;
};

const runOnPages = async (fn) => {
  if (!state.browser) return;
  const pages = await state.browser.pages();
  for (const page of pages) {
    if (page.isClosed()) continue;
    try {
      await fn(page);
    } catch (error) {
      if (isIgnorableError(error)) continue;
      throw error;
    }
  }
};

const attachBrowserListeners = (browser) => {
  if (browser.__recorderListenersAttached) return;
  browser.__recorderListenersAttached = true;

  const handleTarget = async (target) => {
    if (target.type() !== 'page') return;
    const page = await target.page().catch(() => null);
    if (!page) return;
    await setupPage(page);
    if (!state.page || state.page.isClosed()) {
      state.page = page;
    }
  };

  browser.on('targetcreated', handleTarget);
  browser.on('targetchanged', handleTarget);
};

const ensureBrowser = async () => {
  if (state.browser && state.page && !state.page.isClosed()) {
    attachBrowserListeners(state.browser);
    return;
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  SESSION_FILES.forEach((filePath) => {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      // ignore
    }
  });

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble'],
  });

  state.browser = browser;

  const existingPages = await browser.pages();
  const freshPage = await browser.newPage();
  await setupPage(freshPage);
  await Promise.all(
    existingPages.map((page) =>
      page
        .close({ runBeforeUnload: false })
        .catch(() => {})
    )
  );
  state.page = freshPage;
  await setupPage(freshPage);
  attachBrowserListeners(browser);

  browser.on('disconnected', () => {
    state.browser = null;
    state.page = null;
    state.status = 'Idle';
    state.recordingEnabled = false;
    broadcastState();
  });
};

const ensureReplayCursor = async (page) => {
  await page.evaluate(() => {
    if (window.__replayCursor) return;

    const style = document.createElement('style');
    style.id = '__replay-cursor-style';
    style.textContent = `
      #__replay-cursor {
        position: fixed;
        width: 14px;
        height: 14px;
        border: 2px solid #ff2d2d;
        border-radius: 999px;
        transform: translate(-100px, -100px);
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 0 10px rgba(255, 45, 45, 0.6);
      }
      #__replay-cursor.pulse {
        animation: replayPulse 0.4s ease-out;
      }
      @keyframes replayPulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 45, 45, 0.7); }
        100% { box-shadow: 0 0 0 14px rgba(255, 45, 45, 0); }
      }
    `;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = '__replay-cursor';
    document.body.appendChild(cursor);

    window.__replayCursor = {
      move(x, y) {
        cursor.style.transform = `translate(${x - 7}px, ${y - 7}px)`;
      },
      pulse() {
        cursor.classList.remove('pulse');
        void cursor.offsetWidth;
        cursor.classList.add('pulse');
      },
    };
  });
};
const showScenarioCompletionInPage = async (page, scenarioName) => {
  if (!page || page.isClosed()) return;
  const safeName = String(scenarioName || '').trim() || 'Cenário';
  await page.evaluate((name) => {
    const doc = document;
    if (!doc) return;

    const styleId = '__scenario-complete-style';
    if (!doc.getElementById(styleId)) {
      const style = doc.createElement('style');
      style.id = styleId;
      style.textContent = `
        #__scenario-complete-toast {
          position: fixed;
          top: 18px;
          right: 18px;
          z-index: 2147483647;
          max-width: min(460px, calc(100vw - 36px));
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(57, 215, 181, 0.75);
          background: rgba(5, 26, 24, 0.9);
          color: #d7fff6;
          font-family: "IBM Plex Sans", system-ui, sans-serif;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.35;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.32);
          opacity: 0;
          transform: translateY(-8px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          pointer-events: none;
        }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    }

    let toast = doc.getElementById('__scenario-complete-toast');
    if (!toast) {
      toast = doc.createElement('div');
      toast.id = '__scenario-complete-toast';
      (doc.body || doc.documentElement).appendChild(toast);
    }

    toast.textContent = `Cenário "${name}" concluído.`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    if (window.__scenarioCompleteToastTimer) {
      clearTimeout(window.__scenarioCompleteToastTimer);
    }
    window.__scenarioCompleteToastTimer = setTimeout(() => {
      const currentToast = document.getElementById('__scenario-complete-toast');
      if (!currentToast) return;
      currentToast.style.opacity = '0';
      currentToast.style.transform = 'translateY(-8px)';
    }, 5000);
  }, safeName.slice(0, 120));
};

const moveCursor = async (page, x, y, pulse = false) => {
  await page.evaluate(
    ({ xPos, yPos, pulseNow }) => {
      if (!window.__replayCursor) return;
      window.__replayCursor.move(xPos, yPos);
      if (pulseNow) window.__replayCursor.pulse();
    },
    { xPos: x, yPos: y, pulseNow: pulse }
  );
};

const resolveFrame = async (page, framePath = []) => {
  let frame = page.mainFrame();
  let frameBox = null;

  if (Array.isArray(framePath) && framePath.length) {
    for (const selector of framePath) {
      if (!selector) continue;
      const handle = await frame.$(selector);
      if (!handle) return { frame: null, frameBox: null };
      frameBox = await handle.boundingBox();
      const child = await handle.contentFrame();
      if (!child) return { frame: null, frameBox };
      frame = child;
    }
  }

  return { frame, frameBox };
};

const resolveShadowHandle = async (frame, shadowPath = []) => {
  if (!Array.isArray(shadowPath) || shadowPath.length === 0) return null;
  const handle = await frame.evaluateHandle((path) => {
    let root = document;
    let current = null;
    for (const segment of path) {
      if (!root || !root.querySelector) return null;
      try {
        current = root.querySelector(segment.selector);
      } catch (error) {
        return null;
      }
      if (!current) return null;
      if (segment.enterShadow) {
        root = current.shadowRoot;
        if (!root) return null;
      }
    }
    return current;
  }, shadowPath);
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
};

const resolveSelectorHandle = async (frame, payload) => {
  const handle = await frame.evaluateHandle((event) => {
    const selectors = Array.isArray(event.selectors) ? event.selectors : [];
    const fallback = event.selector ? [event.selector] : [];
    const rect = event.rect;
    const text = (event.text || '').trim();

    const seen = new Set();
    const candidates = [];

    const addCandidates = (selector) => {
      if (!selector) return;
      let list = [];
      try {
        list = Array.from(document.querySelectorAll(selector));
      } catch (error) {
        return;
      }
      list.forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        candidates.push(el);
      });
    };

    selectors.forEach(addCandidates);
    fallback.forEach(addCandidates);

    if (!candidates.length) return null;

    const scoreElement = (el) => {
      let score = 0;
      if (rect) {
        const r = el.getBoundingClientRect();
        const dx = r.left + r.width / 2 - (rect.left + rect.width / 2);
        const dy = r.top + r.height / 2 - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        score += 1000 - dist;
        const sizeDiff = Math.abs(r.width - rect.width) + Math.abs(r.height - rect.height);
        score -= sizeDiff * 2;
      }

      if (text) {
        const label =
          (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
          (el.innerText || '');
        const normalized = String(label || '').trim();
        if (normalized === text) score += 200;
        else if (normalized.includes(text) || text.includes(normalized)) score += 120;
      }

      return score;
    };

    let best = candidates[0];
    let bestScore = scoreElement(best);

    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const score = scoreElement(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }, payload);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
};

const resolveOptionHandle = async (frame, payload = {}) => {
  const handle = await frame.evaluateHandle((event) => {
    const normalize = (value) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const optionValue = normalize(event.optionValue || '');
    const optionLabel = normalize(event.optionLabel || event.text || '');
    const hasCriteria = Boolean(optionValue || optionLabel);

    const selectors = [
      '[role="option"]',
      '[data-value]',
      '[aria-selected]',
      '[class*="option"]',
      '[class*="menu-item"]',
      '[id*="option"]',
      'li',
    ];

    const isVisible = (el) => {
      if (!el || typeof el.getBoundingClientRect !== 'function') return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
    };

    const getCandidateValue = (el) => {
      if (!el) return '';
      return (
        (el.getAttribute && (el.getAttribute('data-value') || el.getAttribute('value'))) ||
        (el.dataset && (el.dataset.value || el.dataset.id || el.dataset.key)) ||
        ''
      );
    };

    const getCandidateLabel = (el) => {
      if (!el) return '';
      return (
        (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
        (el.innerText || el.textContent || '')
      );
    };

    const seen = new Set();
    const candidates = [];
    const collect = (root) => {
      if (!root || !root.querySelectorAll) return;
      selectors.forEach((selector) => {
        try {
          root.querySelectorAll(selector).forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            candidates.push(el);
          });
        } catch (error) {
          // ignore invalid selectors
        }
      });
      root.querySelectorAll('*').forEach((node) => {
        if (node.shadowRoot) collect(node.shadowRoot);
      });
    };

    const scopedRoot = event.listboxId ? document.getElementById(event.listboxId) : null;
    collect(scopedRoot || document);
    if (scopedRoot) collect(document);

    if (!candidates.length) return null;

    const score = (el) => {
      if (!isVisible(el)) return -10000;
      if ((el.getAttribute && el.getAttribute('aria-disabled') === 'true') || (el.hasAttribute && el.hasAttribute('disabled'))) {
        return -8000;
      }
      const value = normalize(getCandidateValue(el));
      const label = normalize(getCandidateLabel(el));
      let points = 0;

      if (optionValue) {
        if (value === optionValue) points += 1200;
        else if (value && (value.includes(optionValue) || optionValue.includes(value))) points += 350;
      }
      if (optionLabel) {
        if (label === optionLabel) points += 1000;
        else if (label.includes(optionLabel) || optionLabel.includes(label)) points += 300;
      }

      const role = el.getAttribute && el.getAttribute('role');
      if (role === 'option') points += 80;
      if (scopedRoot && scopedRoot.contains && scopedRoot.contains(el)) points += 120;
      if (!hasCriteria) points += 100;

      return points;
    };

    let best = null;
    let bestScore = -10000;
    candidates.forEach((candidate) => {
      const candidateScore = score(candidate);
      if (candidateScore > bestScore) {
        best = candidate;
        bestScore = candidateScore;
      }
    });

    if (!best) return null;
    if (hasCriteria && bestScore < 250) return null;
    return best;
  }, payload);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
};

const waitForHandle = async (resolver, timeoutMs = 2000, intervalMs = 90) => {
  const startAt = monotonicNow();
  while (monotonicNow() - startAt <= timeoutMs) {
    const handle = await resolver();
    if (handle) return handle;
    await sleep(intervalMs);
  }
  return null;
};

const clickHandleByMouse = async (page, handle, event, clickCount, useRecordedOffset = true) => {
  if (!handle) return false;
  const box = await handle.boundingBox();
  if (!box) {
    await handle.dispose();
    return false;
  }

  let point = null;
  if (
    useRecordedOffset &&
    event.offset &&
    typeof event.offset.x === 'number' &&
    typeof event.offset.y === 'number'
  ) {
    const ox = Math.min(Math.max(event.offset.x, 0), box.width);
    const oy = Math.min(Math.max(event.offset.y, 0), box.height);
    point = { x: box.x + ox, y: box.y + oy };
  } else {
    point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  await moveCursor(page, point.x, point.y, true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y, { clickCount });
  await handle.dispose();
  return true;
};

const performEvent = async (page, event, context = null) => {
  const { frame, frameBox } = await resolveFrame(page, event.framePath);
  if (!frame) return;

  const overrideKey = context && context.overrides ? eventTargetKey(event) : null;
  const hasOverride = overrideKey && context.overrides && context.overrides.has(overrideKey);
  const overrideApplied =
    hasOverride && context.appliedOverrides && context.appliedOverrides.has(overrideKey);

  if (event.type === 'key' && hasOverride) {
    return;
  }

  switch (event.type) {
    case 'scroll': {
      if (
        event.targetType === 'element' ||
        event.selector ||
        (event.selectors && event.selectors.length) ||
        (event.shadowPath && event.shadowPath.length)
      ) {
        let handle = await resolveShadowHandle(frame, event.shadowPath);
        if (!handle) {
          handle = await resolveSelectorHandle(frame, event);
        }
        if (handle) {
          await handle.evaluate(
            (el, st, sl) => {
              if (typeof st === 'number') el.scrollTop = st;
              if (typeof sl === 'number') el.scrollLeft = sl;
            },
            event.scrollTop,
            event.scrollLeft
          );
          await handle.dispose();
          return;
        }
      }

      await frame.evaluate(({ x, y }) => window.scrollTo(x, y), {
        x: event.x || 0,
        y: event.y || 0,
      });
      return;
    }
    case 'input':
    case 'change': {
      if (hasOverride && overrideApplied) {
        return;
      }

      const overrideValue = hasOverride ? context.overrides.get(overrideKey) : undefined;
      const forceValue = hasOverride && !overrideApplied;
      const shouldApplyDirect =
        forceValue ||
        typeof event.value !== 'string' ||
        ['checkbox', 'radio'].includes(event.inputType) ||
        event.tag === 'select';

      if (!shouldApplyDirect) {
        return;
      }

      let handle = await resolveShadowHandle(frame, event.shadowPath);
      if (!handle) {
        handle = await resolveSelectorHandle(frame, event);
      }
      if (handle) {
        try {
          const checkedOverride = forceValue
            ? checkedFromValue(overrideValue, event.checked)
            : event.checked;
          await handle.evaluate(
            (el, value, checked) => {
              const tryDispatch = (type) => {
                try {
                  el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
                } catch (error) {
                  // ignore dispatch errors
                }
              };

              if (el.type === 'checkbox' || el.type === 'radio') {
                if (typeof checked === 'boolean') el.checked = checked;
              } else if (el.isContentEditable) {
                el.innerText = value ?? '';
              } else if (typeof el.value !== 'undefined') {
                const descriptor = Object.getOwnPropertyDescriptor(el.__proto__ || Object.getPrototypeOf(el), 'value');
                if (descriptor && descriptor.set) {
                  descriptor.set.call(el, value ?? '');
                } else {
                  el.value = value ?? '';
                }
              } else if (typeof el.setAttribute === 'function') {
                el.setAttribute('value', value ?? '');
              }

              tryDispatch('input');
              tryDispatch('change');
            },
            forceValue ? overrideValue : event.value,
            checkedOverride
          );
        } catch (error) {
          // Ignore script errors from framework event handlers
        }
        await handle.dispose();
        if (hasOverride && context.appliedOverrides) {
          context.appliedOverrides.add(overrideKey);
        }
        return;
      }
      return;
    }
    case 'submit': {
      await frame.evaluate(({ selector }) => {
        const form = selector ? document.querySelector(selector) : null;
        if (!form) return;
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      }, event);
      return;
    }
    case 'key': {
      let handle = await resolveShadowHandle(frame, event.shadowPath);
      if (!handle) {
        handle = await resolveSelectorHandle(frame, event);
      }
      if (handle) {
        await handle.evaluate((el) => {
          try {
            if (el.focus) el.focus({ preventScroll: true });
          } catch (error) {
            if (el.focus) el.focus();
          }
        });
        await handle.dispose();
      }

      const isChar = event.key && event.key.length === 1;
      const needsMods = event.ctrlKey || event.metaKey || event.altKey;
      const modifiers = [];
      if (event.ctrlKey) modifiers.push('Control');
      if (event.metaKey) modifiers.push('Meta');
      if (event.altKey) modifiers.push('Alt');
      if (!isChar && event.shiftKey) modifiers.push('Shift');
      if (isChar && needsMods && event.shiftKey) modifiers.push('Shift');

      for (const mod of modifiers) {
        await page.keyboard.down(mod);
      }

      if (isChar && !needsMods) {
        await page.keyboard.type(event.key);
      } else if (event.key) {
        await page.keyboard.press(event.key);
      } else if (event.code) {
        await page.keyboard.press(event.code);
      }

      for (let i = modifiers.length - 1; i >= 0; i -= 1) {
        await page.keyboard.up(modifiers[i]);
      }
      return;
    }
    case 'click':
    case 'double-click': {
      const clickCount = event.type === 'double-click' ? 2 : 1;

      if (event.optionValue || event.optionLabel || event.listboxId) {
        const optionHandle = await waitForHandle(() => resolveOptionHandle(frame, event), 3200, 100);
        if (optionHandle) {
          const clicked = await clickHandleByMouse(page, optionHandle, event, clickCount, false);
          if (clicked) return;
        }
      }

      const handle = await waitForHandle(async () => {
        let resolved = await resolveShadowHandle(frame, event.shadowPath);
        if (!resolved) {
          resolved = await resolveSelectorHandle(frame, event);
        }
        return resolved;
      });
      if (handle) {
        const clicked = await clickHandleByMouse(page, handle, event, clickCount, true);
        if (clicked) return;
      }

      let coords = null;

      if (!coords && frameBox && typeof event.x === 'number' && typeof event.y === 'number') {
        coords = { x: frameBox.x + event.x, y: frameBox.y + event.y };
      }

      if (!coords && typeof event.x === 'number' && typeof event.y === 'number') {
        coords = { x: event.x, y: event.y };
      }

      if (!coords) return;
      await moveCursor(page, coords.x, coords.y, true);
      await page.mouse.move(coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, {
        clickCount,
      });
      return;
    }
    default:
      return;
  }
};

const replayRecording = async (recording, options = {}) => {
  if (!recording || !recording.events || recording.events.length === 0) return;
  await ensureBrowser();

  const events = recording.events
    .slice()
    .sort((a, b) => (typeof a.t === 'number' ? a.t : 0) - (typeof b.t === 'number' ? b.t : 0));
  const source = options.source || 'single';
  const scenarioId = normalizeOptionalString(options.scenarioId);
  const recordingName =
    String(options.scenarioName || recording.name || '').trim() || null;
  const playbackStart = monotonicNow();
  const recordVideo = asBoolean(options.recordVideo);
  let screenRecorder = null;
  let replayVideoPath = null;

  if (options.resetLog !== false) {
    resetReplayLog();
  }
  state.status = 'Replaying';
  state.recordingEnabled = false;
  broadcastState();
  pushReplayLog({
    type: 'session',
    stage: 'start',
    source,
    recordingId: recording.id || null,
    recordingName,
    totalEvents: events.length,
  });

  try {
    const page = await getActivePage();
    if (!page) {
      pushReplayLog({
        type: 'error',
        source,
        message: 'Página não disponível para replay.',
      });
      return;
    }

    await runOnPages((item) =>
      item.evaluate(() => {
        if (window.__recorderControl) window.__recorderControl.disable();
      })
    );

    if (recordVideo) {
      try {
        ensureRecordingsDir();
        replayVideoPath = buildReplayVideoPath(recording, options);
        screenRecorder = await page.screencast({
          path: replayVideoPath,
        });
        pushReplayLog({
          type: 'video',
          stage: 'start',
          source,
          scenarioId,
          filePath: replayVideoPath,
        });
      } catch (error) {
        pushReplayLog({
          type: 'video',
          stage: 'error',
          source,
          scenarioId,
          filePath: replayVideoPath,
          message: String(error?.message || error || 'Falha ao iniciar gravação de vídeo.'),
        });
      }
    }

    const overrideUrl = options.overrideUrl ? String(options.overrideUrl).trim() : '';
    const startUrl = overrideUrl || recording.startUrl;
    if (startUrl) {
      const navigationStart = monotonicNow();
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
      pushReplayLog({
        type: 'navigation',
        source,
        phase: 'start',
        url: startUrl,
        durationMs: roundMs(monotonicNow() - navigationStart),
      });
    }

    await ensureReplayCursor(page);

    const overrides = buildInputOverrides(recording);
    const overrideContext = overrides.size
      ? {
          overrides,
          appliedOverrides: new Set(),
        }
      : null;
    let previousEventTime = 0;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const eventTime = roundMs(typeof event.t === 'number' ? event.t : 0);
      const plannedIntervalMs = Math.max(0, eventTime - previousEventTime);
      const eventMeta = {
        source,
        eventIndex: index + 1,
        totalEvents: events.length,
        eventType: event.type || 'unknown',
      };

      const waitStats = await waitForInteractionDelay(plannedIntervalMs, options, eventMeta);
      if (plannedIntervalMs > 0 || waitStats.pauseMs > 0) {
        pushReplayLog({
          type: 'pause-between-actions',
          ...eventMeta,
          targetMs: waitStats.targetMs,
          waitMs: waitStats.waitMs,
          queuePauseMs: waitStats.pauseMs,
          elapsedMs: waitStats.elapsedMs,
        });
      } else {
        await waitForQueueResumeIfNeeded(options, eventMeta);
      }

      const actionStart = monotonicNow();
      let navigationMs = 0;

      const executionStart = monotonicNow();
      await performEvent(page, event, overrideContext);
      const executionMs = roundMs(monotonicNow() - executionStart);
      const totalActionMs = roundMs(monotonicNow() - actionStart);

      pushReplayLog({
        type: 'action',
        ...eventMeta,
        plannedAtMs: eventTime,
        plannedIntervalMs,
        waitMs: waitStats.waitMs,
        queuePauseMs: waitStats.pauseMs,
        navigationMs,
        executionMs,
        totalActionMs,
      });

      previousEventTime = eventTime;
    }
  } catch (error) {
    pushReplayLog({
      type: 'error',
      source,
      message: String(error?.message || error || 'Erro inesperado durante o replay.'),
    });
    throw error;
  } finally {
    if (screenRecorder) {
      try {
        await screenRecorder.stop();
        const execution = registerRecordingExecution(replayVideoPath, recording, {
          ...options,
          source,
          scenarioId,
          scenarioName: recordingName,
        });
        pushReplayLog({
          type: 'video',
          stage: 'saved',
          source,
          scenarioId,
          fileName: execution?.name || null,
          filePath: replayVideoPath,
        });
      } catch (error) {
        pushReplayLog({
          type: 'video',
          stage: 'error',
          source,
          scenarioId,
          filePath: replayVideoPath,
          message: String(error?.message || error || 'Falha ao finalizar gravação de vídeo.'),
        });
      }
    }

    state.status = 'Idle';
    pushReplayLog({
      type: 'session',
      stage: 'end',
      source,
      recordingId: recording.id || null,
      recordingName,
      totalMs: roundMs(monotonicNow() - playbackStart),
    });
    try {
      await runOnPages((item) => showScenarioCompletionInPage(item, recordingName));
    } catch (error) {
      // ignore toast rendering errors in the browser page
    }
    broadcastState();
  }
};

const runQueue = async (options = {}) => {
  if (state.queueRunning) return;
  if (!state.queue.length) return;
  const overrideUrl = options.overrideUrl;
  const recordVideo = asBoolean(options.recordVideo);

  if (state.queueCursor >= state.queue.length) state.queueCursor = 0;
  const startIndex = state.queueCursor;
  state.queueRunning = true;
  state.queuePaused = false;
  state.queueRecordVideo = recordVideo;
  broadcastState();

  for (let i = state.queueCursor; i < state.queue.length; i += 1) {
    const item = state.queue[i];
    const scenario = findScenario(item.scenarioId);
    state.queueCursor = i;
    broadcastState();

    if (scenario) {
      await replayRecording(scenario, {
        overrideUrl,
        queueAware: true,
        source: 'queue',
        resetLog: i === startIndex,
        recordVideo: state.queueRecordVideo,
        scenarioId: scenario.id,
        scenarioName: item.name || scenario.name,
        queueIndex: i,
      });
    }

    state.queueCursor = i + 1;
    if (state.queuePaused) break;
  }

  if (!state.queuePaused || state.queueCursor >= state.queue.length) {
    state.queueCursor = 0;
  }

  state.queueRunning = false;
  broadcastState();
};

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', state: serializeState() }));
});

app.post('/api/recording/start', async (req, res) => {
  try {
    if (state.status === 'Replaying') return res.status(409).json({ error: 'Replay em andamento.' });

    await ensureBrowser();
    const page = await getActivePage();
    if (!page) throw new Error('Página não disponível');

    const extendScenario = state.extendScenarioId ? findScenario(state.extendScenarioId) : null;
    const baseEvents = extendScenario ? cloneEvents(extendScenario.events) : [];
    const baseDuration = extendScenario
      ? eventsDuration(extendScenario.events, extendScenario.duration || 0)
      : 0;

    state.currentRecording = {
      id: generateId('rec'),
      createdAt: nowIso(),
      startUrl: extendScenario?.startUrl || page.url(),
      startEpoch: Date.now(),
      pausedDuration: 0,
      pauseStartedAt: null,
      events: baseEvents,
      duration: baseDuration,
      baseOffset: baseDuration,
      extendScenarioId: extendScenario ? extendScenario.id : null,
    };
    state.eventCount = baseEvents.length;
    state.recordingEnabled = true;
    state.status = 'Recording';

    await runOnPages((item) =>
      item.evaluate(() => {
        if (window.__recorderControl) window.__recorderControl.reset();
      })
    );

    broadcastState();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/recording/pause', async (req, res) => {
  try {
    if (state.status !== 'Recording') return res.status(409).json({ error: 'Não está gravando.' });
    state.status = 'Paused';
    if (state.currentRecording) {
      state.currentRecording.pauseStartedAt = Date.now();
    }
    await runOnPages((item) =>
      item.evaluate(() => {
        if (window.__recorderControl) window.__recorderControl.pause();
      })
    );
    broadcastState();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/recording/resume', async (req, res) => {
  try {
    if (state.status !== 'Paused') return res.status(409).json({ error: 'Não está pausado.' });
    state.status = 'Recording';
    if (state.currentRecording?.pauseStartedAt) {
      state.currentRecording.pausedDuration += Date.now() - state.currentRecording.pauseStartedAt;
      state.currentRecording.pauseStartedAt = null;
    }
    await runOnPages((item) =>
      item.evaluate(() => {
        if (window.__recorderControl) window.__recorderControl.resume();
      })
    );
    broadcastState();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/recording/stop', async (req, res) => {
  try {
    if (!state.currentRecording) return res.status(409).json({ error: 'Sem gravação ativa.' });

    if (state.currentRecording.pauseStartedAt) {
      state.currentRecording.pausedDuration += Date.now() - state.currentRecording.pauseStartedAt;
      state.currentRecording.pauseStartedAt = null;
    }

    const finalDuration = eventsDuration(
      state.currentRecording.events,
      state.currentRecording.duration || 0
    );
    const finishedRecording = {
      id: state.currentRecording.id,
      createdAt: state.currentRecording.createdAt,
      startUrl: state.currentRecording.startUrl,
      events: state.currentRecording.events,
      duration: finalDuration,
    };

    if (state.currentRecording.extendScenarioId) {
      const scenario = findScenario(state.currentRecording.extendScenarioId);
      if (scenario) {
        scenario.events = cloneEvents(state.currentRecording.events);
        scenario.duration = finalDuration;
        if (!scenario.startUrl && state.currentRecording.startUrl) {
          scenario.startUrl = state.currentRecording.startUrl;
        }
        syncQueueScenario(scenario);
        saveScenarios();
      }
      state.extendScenarioId = null;
    }

    state.lastRecording = finishedRecording;
    state.currentRecording = null;
    state.eventCount = 0;
    state.recordingEnabled = false;
    state.status = 'Idle';

    await runOnPages((item) =>
      item.evaluate(() => {
        if (window.__recorderControl) window.__recorderControl.disable();
      })
    );

    broadcastState();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/replay/last', async (req, res) => {
  if (!state.lastRecording) return res.status(404).json({ error: 'Nenhuma gravação finalizada.' });
  const overrideUrl = req.body?.overrideUrl;
  const recordVideo = asBoolean(req.body?.recordVideo);
  replayRecording(state.lastRecording, { overrideUrl, recordVideo }).catch(() => {
    state.status = 'Idle';
    broadcastState();
  });
  return res.json({ ok: true });
});

app.post('/api/scenarios/save', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const testCaseId = String(req.body?.testCaseId || '').trim();
  if (!state.lastRecording) return res.status(404).json({ error: 'Nenhuma gravação finalizada.' });

  try {
    const testCase = testCaseId ? await fetchTestCaseFromSalesforce(testCaseId) : null;
    const scenario = {
      id: generateId('scn'),
      name: name || testCase?.name || `Cenário ${state.savedScenarios.length + 1}`,
      createdAt: nowIso(),
      events: [...state.lastRecording.events],
      duration: state.lastRecording.duration,
      startUrl: state.lastRecording.startUrl,
      testCase,
    };
    state.savedScenarios.push(scenario);
    saveScenarios();
    broadcastState();
    return res.json({ ok: true, scenario: scenarioSummary(scenario) });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ error: error.message });
  }
});

app.get('/api/scenarios/:id', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  return res.json(scenario);
});

app.get('/api/scenarios/:id/recordings', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  try {
    const recordings = listRecordings({ scenarioId: scenario.id });
    return res.json({
      scenario: scenarioSummary(scenario),
      recordings,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao listar execuções do cenário.' });
  }
});

app.post('/api/scenarios/:id/inputs', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  const updates = req.body?.updates;
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'Formato inválido.' });

  updates.forEach((update) => {
    const index = Number(update?.index);
    if (!Number.isInteger(index) || index < 0 || index >= scenario.events.length) return;
    const event = scenario.events[index];
    if (!event || (event.type !== 'input' && event.type !== 'change')) return;

    if (!Object.prototype.hasOwnProperty.call(update, 'customValue') || update.customValue === null) {
      delete event.customValue;
      return;
    }

    event.customValue = String(update.customValue);
  });

  saveScenarios();
  broadcastState();
  return res.json({ ok: true });
});

app.post('/api/scenarios/:id/test-case/description', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  const testCaseId = normalizeOptionalString(scenario?.testCase?.id);
  if (!testCaseId) {
    return res.status(400).json({ error: 'Este cenário não possui caso de teste Salesforce vinculado.' });
  }

  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'description')) {
    return res.status(400).json({ error: 'Informe o campo "description".' });
  }

  const description = typeof req.body?.description === 'string' ? req.body.description : '';

  try {
    const normalizedDescription = await updateAcceptanceCriterionDescription(testCaseId, description);
    syncTestCaseDescription(testCaseId, normalizedDescription);
    saveScenarios();
    broadcastState();
    return res.json({
      ok: true,
      testCase: {
        ...(scenario.testCase || { id: testCaseId }),
        description: normalizedDescription,
      },
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ error: error.message });
  }
});

app.post('/api/scenarios/:id/test-case/status', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  const testCaseId = normalizeOptionalString(scenario?.testCase?.id);
  if (!testCaseId) {
    return res.status(400).json({ error: 'Este cenário não possui caso de teste Salesforce vinculado.' });
  }

  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
    return res.status(400).json({ error: 'Informe o campo "status".' });
  }

  const status = typeof req.body?.status === 'string' ? req.body.status : '';

  try {
    const normalizedStatus = await updateAcceptanceCriterionStatus(testCaseId, status);
    syncTestCaseStatus(testCaseId, normalizedStatus);
    saveScenarios();
    broadcastState();
    return res.json({
      ok: true,
      testCase: {
        ...(scenario.testCase || { id: testCaseId }),
        status: normalizedStatus,
      },
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ error: error.message });
  }
});

app.post('/api/scenarios/:id/move', async (req, res) => {
  const { id } = req.params;
  const direction = req.body?.direction;
  const index = state.savedScenarios.findIndex((scenario) => scenario.id === id);
  if (index === -1) return res.status(404).json({ error: 'Cenário não encontrado.' });

  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= state.savedScenarios.length) return res.json({ ok: true });

  const [item] = state.savedScenarios.splice(index, 1);
  state.savedScenarios.splice(newIndex, 0, item);
  saveScenarios();
  broadcastState();
  return res.json({ ok: true });
});

app.post('/api/scenarios/:id/run', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });

  const overrideUrl = req.body?.overrideUrl;
  const recordVideo = asBoolean(req.body?.recordVideo);
  replayRecording(scenario, {
    overrideUrl,
    recordVideo,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
  }).catch(() => {
    state.status = 'Idle';
    broadcastState();
  });

  return res.json({ ok: true });
});

app.post('/api/scenarios/:id/rename', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome inválido.' });
  scenario.name = name;
  syncQueueScenario(scenario);
  saveScenarios();
  broadcastState();
  return res.json({ ok: true });
});

app.post('/api/scenarios/:id/duplicate', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  const copy = {
    id: generateId('scn'),
    name: `${scenario.name} (cópia)`,
    createdAt: nowIso(),
    events: cloneEvents(scenario.events),
    duration: scenario.duration,
    startUrl: scenario.startUrl,
    testCase: scenario.testCase ? { ...scenario.testCase } : null,
  };
  state.savedScenarios.push(copy);
  saveScenarios();
  broadcastState();
  return res.json({ ok: true, scenario: scenarioSummary(copy) });
});

app.post('/api/scenarios/:id/extend', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  if (state.status === 'Recording' || state.status === 'Paused' || state.status === 'Replaying') {
    return res.status(409).json({ error: 'Não é possível estender durante a gravação.' });
  }

  if (state.extendScenarioId === scenario.id) {
    state.extendScenarioId = null;
  } else {
    state.extendScenarioId = scenario.id;
  }
  broadcastState();
  return res.json({ ok: true, active: state.extendScenarioId === scenario.id });
});

app.get('/api/scenarios/:id/export', async (req, res) => {
  const scenario = state.savedScenarios.find((item) => item.id === req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  const safeName = scenario.name ? scenario.name.replace(/[^a-z0-9-_]+/gi, '_') : 'scenario';
  const fileName = `${safeName}-${scenario.id}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(JSON.stringify(scenario, null, 2));
});

app.delete('/api/scenarios/:id', async (req, res) => {
  const index = state.savedScenarios.findIndex((scenario) => scenario.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Cenário não encontrado.' });

  const [removed] = state.savedScenarios.splice(index, 1);
  if (removed) {
    state.queue = state.queue.filter((item) => item.scenarioId !== removed.id);
    if (state.extendScenarioId === removed.id) state.extendScenarioId = null;
    if (state.queueCursor > state.queue.length) state.queueCursor = 0;
  }
  saveScenarios();
  broadcastState();
  return res.json({ ok: true });
});

app.get('/api/scenarios/export', async (req, res) => {
  const fileName = `scenarios-${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(JSON.stringify({ scenarios: state.savedScenarios }, null, 2));
});

app.post('/api/scenarios/import', async (req, res) => {
  const payload = req.body;
  const list = Array.isArray(payload) ? payload : payload?.scenarios;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Formato inválido.' });

  state.savedScenarios = list
    .filter((item) => item && Array.isArray(item.events))
    .map((item, index) => ({
      id: item.id || generateId('scn'),
      name: item.name || `Cenário ${index + 1}`,
      createdAt: item.createdAt || nowIso(),
      events: item.events || [],
      duration: item.duration || 0,
      startUrl: item.startUrl || null,
      testCase: extractScenarioTestCase(item),
    }));
  state.queue = [];
  state.queueCursor = 0;
  state.queuePaused = false;
  state.queueRunning = false;
  state.queueRecordVideo = false;
  state.extendScenarioId = null;

  saveScenarios();
  broadcastState();
  return res.json({ ok: true });
});

app.post('/api/queue/add', async (req, res) => {
  const scenarioId = String(req.body?.scenarioId || '').trim();
  const scenario = findScenario(scenarioId);
  if (!scenario) return res.status(404).json({ error: 'Cenário não encontrado.' });
  const item = queueItemFromScenario(scenario);
  state.queue.push(item);
  saveScenarios();
  broadcastState();
  return res.json({ ok: true, item });
});

app.post('/api/queue/:id/move', async (req, res) => {
  const { id } = req.params;
  const direction = req.body?.direction;
  const index = state.queue.findIndex((item) => item.id === id);
  if (index === -1) return res.status(404).json({ error: 'Item não encontrado.' });

  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= state.queue.length) return res.json({ ok: true });

  const [item] = state.queue.splice(index, 1);
  state.queue.splice(newIndex, 0, item);
  saveScenarios();
  broadcastState();
  return res.json({ ok: true });
});

app.delete('/api/queue/:id', async (req, res) => {
  const index = state.queue.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Item não encontrado.' });
  state.queue.splice(index, 1);
  if (state.queueCursor > state.queue.length) state.queueCursor = 0;
  saveScenarios();
  broadcastState();
  return res.json({ ok: true });
});

app.post('/api/queue/run', async (req, res) => {
  const overrideUrl = req.body?.overrideUrl;
  const recordVideo = asBoolean(req.body?.recordVideo);
  runQueue({ overrideUrl, recordVideo }).catch(() => {
    state.status = 'Idle';
    state.queueRunning = false;
    pushReplayLog({
      type: 'error',
      source: 'queue',
      message: 'Falha ao executar a fila de cenários.',
    });
    broadcastState();
  });
  return res.json({ ok: true });
});

app.post('/api/queue/pause', async (req, res) => {
  if (!state.queueRunning) return res.json({ ok: true });
  state.queuePaused = true;
  pushReplayLog({
    type: 'queue-control',
    source: 'queue',
    action: 'pause-requested',
  });
  broadcastState();
  return res.json({ ok: true });
});

app.post('/api/queue/resume', async (req, res) => {
  const bodyHasRecordVideo = Object.prototype.hasOwnProperty.call(req.body || {}, 'recordVideo');
  const requestedRecordVideo = asBoolean(req.body?.recordVideo);
  if (state.queueRunning) {
    state.queuePaused = false;
    if (bodyHasRecordVideo) {
      state.queueRecordVideo = requestedRecordVideo;
    }
    pushReplayLog({
      type: 'queue-control',
      source: 'queue',
      action: 'resume-requested',
    });
    broadcastState();
    return res.json({ ok: true });
  }
  state.queuePaused = false;
  const overrideUrl = req.body?.overrideUrl;
  const recordVideo = bodyHasRecordVideo ? requestedRecordVideo : state.queueRecordVideo;
  runQueue({ overrideUrl, recordVideo }).catch(() => {
    state.status = 'Idle';
    state.queueRunning = false;
    pushReplayLog({
      type: 'error',
      source: 'queue',
      message: 'Falha ao retomar a fila de cenários.',
    });
    broadcastState();
  });
  return res.json({ ok: true });
});

app.post('/api/navigate', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'URL inválida.' });
    await ensureBrowser();
    const page = await getActivePage();
    if (!page) throw new Error('Página não disponível');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/close', async (req, res) => {
  try {
    if (state.browser) await state.browser.close();
    state.browser = null;
    state.page = null;
    state.status = 'Idle';
    state.recordingEnabled = false;
    broadcastState();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/export/last', async (req, res) => {
  if (!state.lastRecording) return res.status(404).json({ error: 'Nenhuma gravação finalizada.' });
  const fileName = `recording-${state.lastRecording.id}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(JSON.stringify(state.lastRecording, null, 2));
});

app.get('/api/recordings', async (req, res) => {
  try {
    const recordings = listRecordings();
    return res.json({ recordings });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao listar capturas.' });
  }
});

app.get('/api/recordings/:name/download', async (req, res) => {
  try {
    ensureRecordingsDir();
    const requestedName = String(req.params.name || '');
    const safeName = path.basename(requestedName);
    if (!safeName || safeName !== requestedName) {
      return res.status(400).json({ error: 'Nome de arquivo inválido.' });
    }
    const filePath = path.join(RECORDINGS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Captura não encontrada.' });
    }
    res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    return res.sendFile(filePath, { dotfiles: 'allow' });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao baixar captura.' });
  }
});

app.delete('/api/recordings/:name', async (req, res) => {
  try {
    ensureRecordingsDir();
    const requestedName = String(req.params.name || '');
    const safeName = path.basename(requestedName);
    if (!safeName || safeName !== requestedName) {
      return res.status(400).json({ error: 'Nome de arquivo inválido.' });
    }
    const filePath = path.join(RECORDINGS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Captura não encontrada.' });
    }
    fs.rmSync(filePath, { force: true });
    removeRecordingIndexEntry(safeName);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao remover captura.' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`UI disponível em http://localhost:${PORT}`);
});
