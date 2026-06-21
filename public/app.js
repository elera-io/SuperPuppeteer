const statusPill = document.getElementById('statusPill');
const eventCount = document.getElementById('eventCount');
const lastInfo = document.getElementById('lastInfo');
const actionsHint = document.getElementById('actionsHint');
const lastKeyEl = document.getElementById('lastKey');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const closeBtn = document.getElementById('closeBtn');
const replayLastBtn = document.getElementById('replayLastBtn');
const saveScenarioBtn = document.getElementById('saveScenarioBtn');
const openUrlBtn = document.getElementById('openUrlBtn');
const syncScenariosBtn = document.getElementById('syncScenariosBtn');
const importCloudScenariosBtn = document.getElementById('importCloudScenariosBtn');
const exportScenariosBtn = document.getElementById('exportScenariosBtn');
const importScenariosBtn = document.getElementById('importScenariosBtn');
const importScenariosInput = document.getElementById('importScenariosInput');
const replayUrlInput = document.getElementById('replayUrl');
const recordVideoToggle = document.getElementById('recordVideoToggle');
const queueRunBtn = document.getElementById('queueRunBtn');
const queuePauseBtn = document.getElementById('queuePauseBtn');
const queueResumeBtn = document.getElementById('queueResumeBtn');
const execCasesBtn = document.getElementById('execCasesBtn');
const scenarioModal = document.getElementById('scenarioModal');
const scenarioModalTitle = document.getElementById('scenarioModalTitle');
const scenarioModalClose = document.getElementById('scenarioModalClose');
const scenarioInputsList = document.getElementById('scenarioInputsList');
const scenarioInputsSave = document.getElementById('scenarioInputsSave');
const scenarioDescriptionAccordion = document.getElementById('scenarioDescriptionAccordion');
const scenarioStatusInput = document.getElementById('scenarioStatusInput');
const scenarioStatusSave = document.getElementById('scenarioStatusSave');
const scenarioStatusStatus = document.getElementById('scenarioStatusStatus');
const scenarioDescriptionInput = document.getElementById('scenarioDescriptionInput');
const scenarioDescriptionSave = document.getElementById('scenarioDescriptionSave');
const scenarioDescriptionStatus = document.getElementById('scenarioDescriptionStatus');
const scenarioRecordingsAccordion = document.getElementById('scenarioRecordingsAccordion');
const scenarioRecordingsRefresh = document.getElementById('scenarioRecordingsRefresh');
const scenarioRecordingsList = document.getElementById('scenarioRecordingsList');
const failedWorkModal = document.getElementById('failedWorkModal');
const failedWorkClose = document.getElementById('failedWorkClose');
const failedWorkCancel = document.getElementById('failedWorkCancel');
const failedWorkSource = document.getElementById('failedWorkSource');
const failedWorkSummary = document.getElementById('failedWorkSummary');
const failedWorkNameInput = document.getElementById('failedWorkNameInput');
const failedWorkDescriptionInput = document.getElementById('failedWorkDescriptionInput');
const failedWorkPriorityInput = document.getElementById('failedWorkPriorityInput');
const failedWorkCreate = document.getElementById('failedWorkCreate');
const failedWorkStatus = document.getElementById('failedWorkStatus');
const deleteScenarioModal = document.getElementById('deleteScenarioModal');
const deleteScenarioName = document.getElementById('deleteScenarioName');
const deleteScenarioStatus = document.getElementById('deleteScenarioStatus');
const deleteScenarioLocal = document.getElementById('deleteScenarioLocal');
const deleteScenarioCloud = document.getElementById('deleteScenarioCloud');
const deleteScenarioCancel = document.getElementById('deleteScenarioCancel');
const cloudImportModal = document.getElementById('cloudImportModal');
const cloudImportClose = document.getElementById('cloudImportClose');
const cloudImportCancel = document.getElementById('cloudImportCancel');
const cloudImportRefresh = document.getElementById('cloudImportRefresh');
const cloudImportSelectAll = document.getElementById('cloudImportSelectAll');
const cloudImportConfirm = document.getElementById('cloudImportConfirm');
const cloudImportList = document.getElementById('cloudImportList');
const cloudImportStatus = document.getElementById('cloudImportStatus');

const urlInput = document.getElementById('urlInput');
const scenarioNameInput = document.getElementById('scenarioName');
const scenarioTestCaseIdInput = document.getElementById('scenarioTestCaseId');
const savedScenarioClientFilter = document.getElementById('savedScenarioClientFilter');
const savedScenarioProjectFilter = document.getElementById('savedScenarioProjectFilter');
const savedScenarioWorkFilter = document.getElementById('savedScenarioWorkFilter');
const scenarioCompletionBanner = document.getElementById('scenarioCompletionBanner');
const workspaceTabButtons = document.querySelectorAll('[data-workspace-tab]');
const workspacePanelMain = document.getElementById('workspacePanelMain');
const workspacePanelScenarios = document.getElementById('workspacePanelScenarios');
const eventsList = document.getElementById('eventsList');
const replayLogList = document.getElementById('replayLogList');
const savedScenariosList = document.getElementById('savedScenariosList');
const queueList = document.getElementById('queueList');
const themeToggle = document.getElementById('themeToggle');

const state = {
  status: 'Idle',
  eventCount: 0,
  events: [],
  replayLog: [],
  savedScenarios: [],
  queue: [],
  queueStatus: { running: false, paused: false, cursor: 0 },
  lastRecording: null,
  lastKey: '',
  extendScenario: null,
  recordVideoEnabled:
    typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem('recordVideoEnabled') === 'true'
      : false,
};

let currentScenarioDetails = null;
let currentScenarioRecordings = [];
let pendingFailedWorkContext = null;
let pendingDeleteScenarioId = null;
let cloudScenarioCandidates = [];
let scenarioCompletionTimeout = null;
let localStateHydrated = false;
const workspacePanels = {
  main: workspacePanelMain,
  scenarios: workspacePanelScenarios,
};
const THEME_STORAGE_KEY = 'uiThemePreference';
const LOCAL_STATE_STORAGE_KEY = 'superpuppeteer.localState.v1';

const normalizeTheme = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'light' || normalized === 'dark') return normalized;
  return null;
};
const preferredThemeFromSystem = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
const currentTheme = () =>
  normalizeTheme(document.documentElement.getAttribute('data-theme')) || 'dark';
const applyTheme = (theme) => {
  const resolvedTheme = normalizeTheme(theme) || 'dark';
  document.documentElement.setAttribute('data-theme', resolvedTheme);
  if (!themeToggle) return;
  const isDark = resolvedTheme === 'dark';
  const targetTheme = isDark ? 'claro' : 'escuro';
  themeToggle.textContent = isDark ? 'Tema: Escuro' : 'Tema: Claro';
  themeToggle.setAttribute(
    'aria-label',
    `Tema atual ${isDark ? 'escuro' : 'claro'}. Clique para ativar o tema ${targetTheme}.`
  );
};
const initializeTheme = () => {
  let savedTheme = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    savedTheme = normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  }
  applyTheme(savedTheme || preferredThemeFromSystem());
};
const toggleTheme = () => {
  const nextTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }
};

const escapeHtml = (value) => {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const normalizeLocalScenario = (item, index = 0) => {
  if (!item || !Array.isArray(item.events)) return null;
  return {
    ...item,
    id: String(item.id || `local_${Date.now()}_${index}`),
    name: String(item.name || `Cenário ${index + 1}`),
    createdAt: item.createdAt || new Date().toISOString(),
    events: item.events,
    duration: Number(item.duration) || 0,
    startUrl: item.startUrl || null,
    testCase: item.testCase || null,
    CasoSincronizado: item.CasoSincronizado === true,
    cloudId: item.cloudId || null,
    syncedAt: item.syncedAt || null,
    syncError: item.syncError || null,
  };
};
const loadLocalState = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { savedScenarios: [], queue: [] };
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_STATE_STORAGE_KEY);
    if (!raw) return { savedScenarios: [], queue: [] };
    const parsed = JSON.parse(raw);
    const savedScenarios = Array.isArray(parsed?.savedScenarios)
      ? parsed.savedScenarios.map(normalizeLocalScenario).filter(Boolean)
      : [];
    const scenarioIds = new Set(savedScenarios.map((scenario) => scenario.id));
    const queue = Array.isArray(parsed?.queue)
      ? parsed.queue
          .filter((item) => item && scenarioIds.has(item.scenarioId))
          .map((item) => ({
            id: String(item.id || `q_${Date.now()}`),
            scenarioId: item.scenarioId,
            name: item.name || 'Cenário',
            duration: Number(item.duration) || 0,
            eventCount: Number(item.eventCount) || 0,
          }))
      : [];
    return { savedScenarios, queue };
  } catch (error) {
    return { savedScenarios: [], queue: [] };
  }
};
const persistLocalState = () => {
  if (!localStateHydrated || typeof window === 'undefined' || !window.localStorage) return;
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    savedScenarios: Array.isArray(state.savedScenarios) ? state.savedScenarios : [],
    queue: Array.isArray(state.queue) ? state.queue : [],
  };
  window.localStorage.setItem(LOCAL_STATE_STORAGE_KEY, JSON.stringify(payload));
};
const hydrateServerFromLocalState = async () => {
  try {
    await apiRequest('/api/local-state/hydrate', {
      method: 'POST',
      body: JSON.stringify({
        savedScenarios: state.savedScenarios,
        queue: state.queue,
      }),
    });
  } catch (error) {
    window.alert(error.message || 'Falha ao carregar a base local no servidor.');
  }
};

const formatDuration = (ms) => {
  if (!ms || Number.isNaN(ms)) return '0s';
  const seconds = Math.max(0, Math.round(ms / 100) / 10);
  return `${seconds}s`;
};
const formatMs = (value) => `${Math.max(0, Math.round(Number(value) || 0))}ms`;
const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatEvent = (event) => {
  const title = `${event.type}`;
  const detail = event.selector ? `· ${event.selector}` : '';
  const value = typeof event.value === 'string' && event.value.length
    ? `Valor: ${event.value.slice(0, 40)}`
    : '';
  const time = typeof event.t === 'number' ? `${(event.t / 1000).toFixed(2)}s` : '';
  return { title, detail, value, time };
};
const formatRecordingSource = (recording) => {
  const source = String(recording?.source || '').trim().toLowerCase();
  if (source === 'queue') {
    const queueIndex =
      Number.isInteger(recording?.queueIndex) && recording.queueIndex >= 0
        ? ` #${recording.queueIndex + 1}`
        : '';
    return `Fila${queueIndex}`;
  }
  return 'Replay';
};
const setScenarioDescriptionStatus = (message, tone = '') => {
  if (!scenarioDescriptionStatus) return;
  scenarioDescriptionStatus.textContent = message || '';
  scenarioDescriptionStatus.className = 'hint description-status';
  if (tone === 'success' || tone === 'error') {
    scenarioDescriptionStatus.classList.add(tone);
  }
};
const normalizeScenarioStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'passed') return 'Passed';
  if (normalized === 'failed') return 'Failed';
  return '';
};
const setScenarioStatusFeedback = (message, tone = '') => {
  if (!scenarioStatusStatus) return;
  scenarioStatusStatus.textContent = message || '';
  scenarioStatusStatus.className = 'hint description-status';
  if (tone === 'success' || tone === 'error') {
    scenarioStatusStatus.classList.add(tone);
  }
};
const normalizeFailedWorkPriority = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'P0' || normalized === 'P1' || normalized === 'P2') return normalized;
  return '';
};
const setFailedWorkStatus = (message, tone = '') => {
  if (!failedWorkStatus) return;
  failedWorkStatus.textContent = message || '';
  failedWorkStatus.className = 'hint description-status';
  if (tone === 'success' || tone === 'error') {
    failedWorkStatus.classList.add(tone);
  }
};
const setFailedWorkControlsDisabled = (disabled) => {
  if (failedWorkNameInput) failedWorkNameInput.disabled = disabled;
  if (failedWorkDescriptionInput) failedWorkDescriptionInput.disabled = disabled;
  if (failedWorkPriorityInput) failedWorkPriorityInput.disabled = disabled;
  if (failedWorkCreate) failedWorkCreate.disabled = disabled;
};
const formatNameWithId = (name, id) => {
  const normalizedName = String(name || '').trim();
  const normalizedId = String(id || '').trim();
  if (normalizedName && normalizedId) return `${normalizedName} (${normalizedId})`;
  if (normalizedName) return normalizedName;
  if (normalizedId) return normalizedId;
  return '—';
};
const buildFailedWorkNameDefault = (scenario, template = null) => {
  const fromTemplate = String(template?.suggestedWorkName || '').trim();
  if (fromTemplate) return fromTemplate;
  const workName = String(template?.workName || scenario?.testCase?.workName || '').trim();
  const testCaseName = String(scenario?.testCase?.name || template?.testCaseName || scenario?.name || '').trim();
  const joined = [workName, testCaseName].filter(Boolean).join(' - ');
  return joined || workName || testCaseName;
};
const renderFailedWorkSummary = (template) => {
  if (!failedWorkSummary) return;
  if (!template || typeof template !== 'object') {
    failedWorkSummary.innerHTML = '<div class="meta">Carregando dados da Work vinculada...</div>';
    return;
  }
  const line = (label, value) =>
    `<div class="meta"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || '—')}</div>`;
  failedWorkSummary.innerHTML = `
    <div class="title">${escapeHtml(formatNameWithId(template.workName, template.workId))}</div>
    ${line('Cliente', template.clientName)}
    ${line('Projeto', template.projectName)}
    ${line('Work', formatNameWithId(template.workName, template.workId))}
    ${line('Product Tag', formatNameWithId(template.productTagName, template.productTagId))}
    ${line('Scrum Team', formatNameWithId(template.scrumTeamName, template.scrumTeamId))}
    ${line('Found in Build', formatNameWithId(template.foundInBuildName, template.foundInBuildId))}
    ${line('Assignee', formatNameWithId(template.assigneeName, template.assigneeId))}
    ${line('Product Owner', formatNameWithId(template.productOwnerName, template.productOwnerId))}
  `;
};
const closeFailedWorkModal = () => {
  if (!failedWorkModal) return;
  failedWorkModal.classList.add('hidden');
  failedWorkModal.setAttribute('aria-hidden', 'true');
  pendingFailedWorkContext = null;
  if (failedWorkSource) failedWorkSource.textContent = '';
  if (failedWorkNameInput) failedWorkNameInput.value = '';
  if (failedWorkDescriptionInput) failedWorkDescriptionInput.value = '';
  if (failedWorkPriorityInput) failedWorkPriorityInput.value = 'P1';
  if (failedWorkSummary) failedWorkSummary.innerHTML = '';
  setFailedWorkStatus('');
  setFailedWorkControlsDisabled(false);
};
const setDeleteScenarioStatus = (message, tone = '') => {
  if (!deleteScenarioStatus) return;
  deleteScenarioStatus.textContent = message || '';
  deleteScenarioStatus.className = 'hint description-status';
  if (tone === 'success' || tone === 'error') {
    deleteScenarioStatus.classList.add(tone);
  }
};
const setDeleteScenarioControlsDisabled = (disabled) => {
  if (deleteScenarioLocal) deleteScenarioLocal.disabled = disabled;
  if (deleteScenarioCloud) deleteScenarioCloud.disabled = disabled;
  if (deleteScenarioCancel) deleteScenarioCancel.disabled = disabled;
};
const closeDeleteScenarioModal = () => {
  if (!deleteScenarioModal) return;
  deleteScenarioModal.classList.add('hidden');
  deleteScenarioModal.setAttribute('aria-hidden', 'true');
  pendingDeleteScenarioId = null;
  if (deleteScenarioName) deleteScenarioName.textContent = '';
  setDeleteScenarioStatus('');
  setDeleteScenarioControlsDisabled(false);
};
const openDeleteScenarioModal = (scenarioId) => {
  if (!deleteScenarioModal) return;
  const scenario = state.savedScenarios.find((item) => item.id === scenarioId);
  if (!scenario) return;
  pendingDeleteScenarioId = scenarioId;
  if (deleteScenarioName) {
    deleteScenarioName.textContent = scenario.name ? `Caso: ${scenario.name}` : '';
  }
  setDeleteScenarioStatus('');
  setDeleteScenarioControlsDisabled(false);
  deleteScenarioModal.classList.remove('hidden');
  deleteScenarioModal.setAttribute('aria-hidden', 'false');
};
const deletePendingScenario = async (deleteCloud) => {
  const scenarioId = String(pendingDeleteScenarioId || '').trim();
  if (!scenarioId) return;
  setDeleteScenarioControlsDisabled(true);
  setDeleteScenarioStatus(
    deleteCloud ? 'Removendo caso local e registro da nuvem...' : 'Removendo caso apenas localmente...'
  );
  try {
    await apiRequest(`/api/scenarios/${scenarioId}`, {
      method: 'DELETE',
      body: JSON.stringify({ deleteCloud }),
    });
    setDeleteScenarioStatus('Caso removido com sucesso.', 'success');
    closeDeleteScenarioModal();
  } catch (error) {
    setDeleteScenarioStatus(error.message || 'Falha ao remover o caso.', 'error');
    setDeleteScenarioControlsDisabled(false);
  }
};
const openFailedWorkModal = async (scenario) => {
  if (!failedWorkModal) return;
  const scenarioId = String(scenario?.id || '').trim();
  const testCaseId = String(scenario?.testCase?.id || '').trim();
  if (!scenarioId || !testCaseId) return;

  pendingFailedWorkContext = {
    scenarioId,
    testCaseId,
    template: null,
  };

  if (failedWorkSource) {
    const testCaseName = String(scenario?.testCase?.name || '').trim() || 'Caso sem nome';
    const scenarioName = String(scenario?.name || '').trim() || 'Cenário sem nome';
    failedWorkSource.textContent = `Caso: ${testCaseName} · Cenário: ${scenarioName}`;
  }
  if (failedWorkNameInput) {
    failedWorkNameInput.value = buildFailedWorkNameDefault(scenario);
  }
  if (failedWorkDescriptionInput) {
    const fallbackDescription =
      typeof scenarioDescriptionInput?.value === 'string' && scenarioDescriptionInput.value.length
        ? scenarioDescriptionInput.value
        : typeof scenario?.testCase?.description === 'string'
          ? scenario.testCase.description
          : '';
    failedWorkDescriptionInput.value = fallbackDescription;
  }
  if (failedWorkPriorityInput) failedWorkPriorityInput.value = 'P1';
  renderFailedWorkSummary(null);
  setFailedWorkStatus('Carregando dados da Work do caso de teste...');
  setFailedWorkControlsDisabled(true);
  failedWorkModal.classList.remove('hidden');
  failedWorkModal.setAttribute('aria-hidden', 'false');

  try {
    const response = await apiRequest(`/api/scenarios/${scenarioId}/test-case/failed-work/template`);
    const payload = await response.json().catch(() => ({}));
    const template = payload?.template && typeof payload.template === 'object' ? payload.template : null;
    if (!template || !template.workId) {
      throw new Error('Não foi possível obter os dados da Work vinculada ao caso de teste.');
    }
    pendingFailedWorkContext = {
      ...pendingFailedWorkContext,
      template,
    };
    if (failedWorkNameInput && !failedWorkNameInput.value.trim()) {
      failedWorkNameInput.value = buildFailedWorkNameDefault(scenario, template);
    }
    renderFailedWorkSummary(template);
    setFailedWorkStatus('Dados carregados. Informe a descrição e selecione a prioridade.');
    setFailedWorkControlsDisabled(false);
  } catch (error) {
    setFailedWorkStatus(error.message || 'Falha ao carregar dados da Work vinculada.', 'error');
  }
};
const renderScenarioDescription = (scenario) => {
  if (
    !scenarioDescriptionAccordion ||
    !scenarioDescriptionInput ||
    !scenarioDescriptionSave ||
    !scenarioStatusInput ||
    !scenarioStatusSave
  ) {
    return;
  }
  const testCase = scenario?.testCase;
  const hasTestCase = Boolean(testCase && testCase.id);
  scenarioDescriptionAccordion.hidden = !hasTestCase;
  if (!hasTestCase) {
    scenarioDescriptionAccordion.open = false;
    scenarioStatusInput.value = '';
    scenarioStatusInput.disabled = false;
    scenarioStatusSave.disabled = false;
    scenarioDescriptionInput.value = '';
    scenarioDescriptionInput.disabled = false;
    scenarioDescriptionSave.disabled = false;
    setScenarioStatusFeedback('');
    setScenarioDescriptionStatus('');
    return;
  }

  scenarioStatusInput.value = normalizeScenarioStatus(testCase.status);
  scenarioStatusInput.disabled = false;
  scenarioStatusSave.disabled = false;
  scenarioDescriptionInput.value = typeof testCase.description === 'string' ? testCase.description : '';
  scenarioDescriptionInput.disabled = false;
  scenarioDescriptionSave.disabled = false;
  setScenarioStatusFeedback('');
  setScenarioDescriptionStatus('');
};
const LOCAL_CLIENT_LABEL = 'Local';
const LOCAL_PROJECT_LABEL = 'Sem projeto';
const LOCAL_WORK_LABEL = 'Sem work';
const scenarioHasTestCase = (scenario) => Boolean(String(scenario?.testCase?.id || '').trim());
const scenarioTestCaseId = (scenario) => {
  const testCaseId = String(scenario?.testCase?.id || '').trim();
  return testCaseId || (scenario?.id ? `local:${scenario.id}` : '');
};
const scenarioClientName = (scenario) =>
  String(scenario?.testCase?.clientName || '').trim() || LOCAL_CLIENT_LABEL;
const scenarioProjectName = (scenario) =>
  String(scenario?.testCase?.projectName || '').trim() || LOCAL_PROJECT_LABEL;
const scenarioWorkName = (scenario) =>
  String(scenario?.testCase?.workName || '').trim() || LOCAL_WORK_LABEL;
const scenarioSyncState = (scenario) => {
  if (scenario?.syncError) {
    return {
      label: 'Erro',
      className: 'sync-error',
      title: scenario.syncError,
    };
  }
  if (scenario?.CasoSincronizado === true) {
    return {
      label: 'Sincronizado',
      className: 'sync-ok',
      title: scenario.syncedAt ? `Sincronizado em ${new Date(scenario.syncedAt).toLocaleString()}` : '',
    };
  }
  return {
    label: 'Pendente',
    className: 'sync-pending',
    title: 'Caso ainda não sincronizado com a nuvem.',
  };
};
const scenarioFilterOptions = (scenarios, resolver) => {
  return [...new Set((scenarios || []).map(resolver).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
  );
};
const savedScenariosWithTestCase = () => {
  return state.savedScenarios.filter((scenario) => Boolean(scenarioTestCaseId(scenario)));
};
const fillScenarioFilter = (selectEl, options, allLabel) => {
  if (!selectEl) return;
  const previous = selectEl.value;
  selectEl.innerHTML = '';
  const baseOption = document.createElement('option');
  baseOption.value = '';
  baseOption.textContent = allLabel;
  selectEl.appendChild(baseOption);
  options.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  });
  if (previous && options.includes(previous)) {
    selectEl.value = previous;
  } else {
    selectEl.value = '';
  }
};
const syncScenarioFilters = () => {
  const scenarios = savedScenariosWithTestCase();

  const clients = scenarioFilterOptions(scenarios, scenarioClientName);
  fillScenarioFilter(savedScenarioClientFilter, clients, 'Selecione o cliente');

  const selectedClient = savedScenarioClientFilter ? savedScenarioClientFilter.value : '';
  const clientScopedScenarios = selectedClient
    ? scenarios.filter((scenario) => scenarioClientName(scenario) === selectedClient)
    : [];

  const projects = scenarioFilterOptions(clientScopedScenarios, scenarioProjectName);
  fillScenarioFilter(
    savedScenarioProjectFilter,
    projects,
    selectedClient ? 'Selecione o projeto' : 'Escolha o cliente primeiro'
  );

  const selectedProject = savedScenarioProjectFilter ? savedScenarioProjectFilter.value : '';
  const projectScopedScenarios = selectedClient && selectedProject
    ? clientScopedScenarios.filter((scenario) => scenarioProjectName(scenario) === selectedProject)
    : [];
  const works = scenarioFilterOptions(projectScopedScenarios, scenarioWorkName);
  fillScenarioFilter(
    savedScenarioWorkFilter,
    works,
    selectedProject
      ? 'Selecione o work'
      : selectedClient
        ? 'Escolha o projeto primeiro'
        : 'Escolha o cliente primeiro'
  );

  if (savedScenarioProjectFilter) {
    savedScenarioProjectFilter.disabled = !selectedClient;
  }
  if (savedScenarioWorkFilter) {
    savedScenarioWorkFilter.disabled = !(selectedClient && selectedProject);
  }
};
const filteredSavedScenarios = () => {
  const selectedClient = savedScenarioClientFilter ? savedScenarioClientFilter.value : '';
  const selectedProject = savedScenarioProjectFilter ? savedScenarioProjectFilter.value : '';
  const selectedWork = savedScenarioWorkFilter ? savedScenarioWorkFilter.value : '';
  if (!selectedClient || !selectedProject || !selectedWork) return [];
  return savedScenariosWithTestCase().filter((scenario) => {
    return (
      scenarioClientName(scenario) === selectedClient &&
      scenarioProjectName(scenario) === selectedProject &&
      scenarioWorkName(scenario) === selectedWork
    );
  });
};
const groupedTestCases = (scenarios) => {
  const byTestCase = new Map();
  (scenarios || []).forEach((scenario) => {
    const testCaseId = scenarioTestCaseId(scenario);
    if (!testCaseId) return;
    const testCase = scenario.testCase || {};
    const hasTestCase = scenarioHasTestCase(scenario);
    const current = byTestCase.get(testCaseId);
    if (!current) {
      byTestCase.set(testCaseId, {
        id: testCaseId,
        isLocal: !hasTestCase,
        name: String(testCase.name || scenario.name || '').trim(),
        status: String(
          testCase.status || (scenario.CasoSincronizado ? 'Sincronizado' : 'Pendente')
        ).trim(),
        clientName: scenarioClientName(scenario),
        projectName: scenarioProjectName(scenario),
        workName: scenarioWorkName(scenario),
        scenarios: [scenario],
      });
      return;
    }
    if (!current.name && testCase.name) current.name = String(testCase.name).trim();
    if (!current.status && testCase.status) current.status = String(testCase.status).trim();
    if (!current.clientName && scenarioClientName(scenario)) current.clientName = scenarioClientName(scenario);
    if (!current.projectName && scenarioProjectName(scenario)) current.projectName = scenarioProjectName(scenario);
    if (!current.workName && scenarioWorkName(scenario)) current.workName = scenarioWorkName(scenario);
    current.scenarios.push(scenario);
  });

  return [...byTestCase.values()]
    .map((testCase) => ({
      ...testCase,
      scenarios: [...testCase.scenarios].sort((a, b) =>
        String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR', { sensitivity: 'base' })
      ),
    }))
    .sort((a, b) => {
      const left = `${a.clientName || ''}|${a.projectName || ''}|${a.workName || ''}|${a.name || ''}|${a.id}`.trim();
      const right = `${b.clientName || ''}|${b.projectName || ''}|${b.workName || ''}|${b.name || ''}|${b.id}`.trim();
      return left.localeCompare(right, 'pt-BR', { sensitivity: 'base' });
    });
};

const formatReplayLogEntry = (entry) => {
  if (!entry) return { title: 'Registro inválido', detail: '' };
  const indexLabel =
    entry.eventIndex && entry.totalEvents ? `${entry.eventIndex}/${entry.totalEvents}` : '';

  if (entry.type === 'session') {
    if (entry.stage === 'start') {
      return {
        title: `Replay iniciado${entry.recordingName ? `: ${entry.recordingName}` : ''}`,
        detail: `${entry.totalEvents || 0} ações`,
      };
    }
    return {
      title: entry.recordingName
        ? `Cenário concluído: ${entry.recordingName}`
        : 'Replay finalizado',
      detail: `Tempo total: ${formatMs(entry.totalMs)}`,
    };
  }

  if (entry.type === 'pause-between-actions') {
    const parts = [
      `Planejado: ${formatMs(entry.targetMs)}`,
      `Aguardado: ${formatMs(entry.waitMs)}`,
    ];
    if (entry.queuePauseMs) parts.push(`Pausa da fila: ${formatMs(entry.queuePauseMs)}`);
    return {
      title: `Pausa antes da ação ${indexLabel || ''}`.trim(),
      detail: parts.join(' · '),
    };
  }

  if (entry.type === 'queue-pause') {
    return {
      title:
        entry.stage === 'start'
          ? `Fila pausada${indexLabel ? ` na ação ${indexLabel}` : ''}`
          : `Fila retomada${indexLabel ? ` na ação ${indexLabel}` : ''}`,
      detail: entry.stage === 'end' ? `Duração da pausa: ${formatMs(entry.pausedMs)}` : 'Aguardando retomada',
    };
  }

  if (entry.type === 'navigation') {
    return {
      title:
        entry.phase === 'start'
          ? 'Navegação inicial'
          : `Navegação antes da ação ${indexLabel || ''}`.trim(),
      detail: `${entry.url || 'URL não informada'} · ${formatMs(entry.durationMs)}`,
    };
  }

  if (entry.type === 'queue-control') {
    return {
      title: entry.action === 'pause-requested' ? 'Solicitação de pausa da fila' : 'Solicitação de retomada da fila',
      detail: 'Comando recebido no painel.',
    };
  }

  if (entry.type === 'error') {
    return {
      title: 'Erro no replay',
      detail: entry.message || 'Falha inesperada.',
    };
  }

  if (entry.type === 'video') {
    const filePath = entry.filePath || '';
    const fileName = filePath ? filePath.split('/').pop() : '';
    if (entry.stage === 'start') {
      return {
        title: 'Gravação de vídeo iniciada',
        detail: fileName || filePath || 'Arquivo em preparação',
      };
    }
    if (entry.stage === 'saved') {
      return {
        title: 'Vídeo salvo',
        detail: filePath || fileName || 'Arquivo salvo com sucesso',
      };
    }
    return {
      title: 'Erro na gravação de vídeo',
      detail: entry.message || 'Falha ao gravar o replay.',
    };
  }

  if (entry.type === 'action') {
    const details = [
      `Espera: ${formatMs(entry.waitMs)}`,
      `Execução: ${formatMs(entry.executionMs)}`,
      `Total: ${formatMs(entry.totalActionMs)}`,
    ];
    if (entry.navigationMs) details.push(`Navegação: ${formatMs(entry.navigationMs)}`);
    if (entry.queuePauseMs) details.push(`Pausa fila: ${formatMs(entry.queuePauseMs)}`);
    return {
      title: `Ação ${indexLabel || ''} · ${entry.eventType || 'evento'}`.trim(),
      detail: details.join(' · '),
    };
  }

  return {
    title: entry.type || 'Registro',
    detail: '',
  };
};
const setWorkspaceTab = (tabName) => {
  const activeTab = tabName === 'scenarios' ? 'scenarios' : 'main';
  Object.entries(workspacePanels).forEach(([name, panel]) => {
    if (!panel) return;
    const active = name === activeTab;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });

  workspaceTabButtons.forEach((button) => {
    const active = button.dataset.workspaceTab === activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
};
const hideScenarioCompletionBanner = () => {
  if (!scenarioCompletionBanner) return;
  scenarioCompletionBanner.classList.add('hidden');
  scenarioCompletionBanner.textContent = '';
  if (scenarioCompletionTimeout) {
    clearTimeout(scenarioCompletionTimeout);
    scenarioCompletionTimeout = null;
  }
};
const showScenarioCompletionBanner = (scenarioName) => {
  if (!scenarioCompletionBanner) return;
  const safeName = String(scenarioName || '').trim() || 'Cenário';
  scenarioCompletionBanner.textContent = `Cenário "${safeName}" concluído.`;
  scenarioCompletionBanner.classList.remove('hidden');
  if (scenarioCompletionTimeout) {
    clearTimeout(scenarioCompletionTimeout);
  }
  scenarioCompletionTimeout = setTimeout(() => {
    hideScenarioCompletionBanner();
  }, 8000);
};

const updateRecordVideoToggle = () => {
  if (!recordVideoToggle) return;
  const enabled = Boolean(state.recordVideoEnabled);
  recordVideoToggle.textContent = `Gravar vídeo: ${enabled ? 'ON' : 'OFF'}`;
  recordVideoToggle.classList.toggle('active', enabled);
};

const updateStatus = () => {
  const localizedStatus = {
    Idle: 'Ocioso',
    Recording: 'Gravando',
    Paused: 'Pausado',
    Replaying: 'Reproduzindo',
  };
  statusPill.textContent = localizedStatus[state.status] || state.status;
  statusPill.classList.remove('recording', 'paused', 'replaying');

  if (state.status === 'Recording') statusPill.classList.add('recording');
  if (state.status === 'Paused') statusPill.classList.add('paused');
  if (state.status === 'Replaying') statusPill.classList.add('replaying');

  eventCount.textContent = state.eventCount ?? 0;
  actionsHint.textContent = state.status === 'Recording' ? 'Live' : 'Histórico';

  const last = state.lastRecording;
  if (!last) {
    lastInfo.querySelector('.value').textContent = '—';
  } else {
    lastInfo.querySelector('.value').textContent = `${last.eventCount} eventos · ${formatDuration(last.duration)}`;
  }

  if (lastKeyEl) {
    lastKeyEl.textContent = state.lastKey || '—';
  }
};

const formatKey = (event) => {
  if (!event) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  const key = event.key || event.code || '';
  if (key) parts.push(key);
  return parts.join('+') || '';
};

const updateButtons = () => {
  const isRecording = state.status === 'Recording';
  const isPaused = state.status === 'Paused';
  const isReplaying = state.status === 'Replaying';

  startBtn.disabled = isRecording || isPaused || isReplaying;
  pauseBtn.disabled = !isRecording;
  resumeBtn.disabled = !isPaused;
  stopBtn.disabled = !(isRecording || isPaused);

  exportBtn.disabled = !state.lastRecording;
  replayLastBtn.disabled = !state.lastRecording || isRecording || isPaused || isReplaying;
  saveScenarioBtn.disabled = !state.lastRecording;
  if (exportScenariosBtn) exportScenariosBtn.disabled = state.savedScenarios.length === 0;
  if (syncScenariosBtn) {
    syncScenariosBtn.disabled =
      state.savedScenarios.length === 0 ||
      !state.savedScenarios.some((scenario) => scenario.CasoSincronizado !== true);
  }

  const queueRunning = state.queueStatus?.running;
  const queuePaused = state.queueStatus?.paused;
  if (queueRunBtn) queueRunBtn.disabled = queueRunning || state.queue.length === 0 || isRecording || isPaused;
  if (queuePauseBtn) queuePauseBtn.disabled = !queueRunning;
  if (queueResumeBtn) {
    queueResumeBtn.disabled = !queuePaused || queueRunning || state.queue.length === 0 || isRecording || isPaused;
  }
};

const formatSelectorLabel = (event) => {
  return event.selector || (Array.isArray(event.selectors) && event.selectors.length ? event.selectors[0] : '') || '';
};

const hasCustomValue = (event) => Object.prototype.hasOwnProperty.call(event, 'customValue');

const renderScenarioInputs = (scenario) => {
  if (!scenarioInputsList) return;
  scenarioInputsList.innerHTML = '';
  const inputEvents = scenario.events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        (event.type === 'input' || event.type === 'change') &&
        typeof event.value === 'string'
    );

  if (!inputEvents.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item';
    empty.textContent = 'Nenhum input com valor encontrado neste cenário.';
    scenarioInputsList.appendChild(empty);
    return;
  }

  inputEvents.forEach(({ event, index }) => {
    const item = document.createElement('div');
    item.className = 'list-item input-detail';
    item.dataset.index = String(index);
    const label = formatSelectorLabel(event);
    const original = event.value ?? '';
    const custom = hasCustomValue(event) ? event.customValue ?? '' : '';
    const useOriginal = !hasCustomValue(event);

    item.innerHTML = `
      <div class="title">Campo ${index + 1}</div>
      <div class="field-row">
        <div class="meta">Selector: <span class="mono">${escapeHtml(label || '—')}</span></div>
        <div class="meta">Original: ${escapeHtml(String(original).slice(0, 120))}</div>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" data-role="use-original" ${useOriginal ? 'checked' : ''} />
        Usar valor original
      </label>
      <input type="text" data-role="custom-value" value="${escapeHtml(custom)}" ${
        useOriginal ? 'disabled' : ''
      } />
    `;

    const inputEl = item.querySelector('[data-role="custom-value"]');
    if (inputEl && useOriginal) {
      inputEl.value = original;
    }

    scenarioInputsList.appendChild(item);
  });
};

const openScenarioDetails = async (id) => {
  if (!scenarioModal) return;
  const response = await apiRequest(`/api/scenarios/${id}`);
  const scenario = await response.json();
  currentScenarioDetails = scenario;
  if (scenarioModalTitle) {
    scenarioModalTitle.textContent = `Detalhes do cenário: ${scenario.name}`;
  }
  renderScenarioDescription(scenario);
  renderScenarioInputs(scenario);
  if (scenarioRecordingsAccordion) {
    scenarioRecordingsAccordion.open = true;
  }
  void loadScenarioRecordings(scenario.id);
  scenarioModal.classList.remove('hidden');
  scenarioModal.setAttribute('aria-hidden', 'false');
};

const openScenarioEvidence = async (id) => {
  await openScenarioDetails(id);
  if (scenarioModalTitle && currentScenarioDetails?.name) {
    scenarioModalTitle.textContent = `Evidências do cenário: ${currentScenarioDetails.name}`;
  }
  if (scenarioRecordingsAccordion) {
    scenarioRecordingsAccordion.hidden = false;
    scenarioRecordingsAccordion.open = true;
    scenarioRecordingsAccordion.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
};

const closeScenarioDetails = () => {
  if (!scenarioModal) return;
  closeFailedWorkModal();
  scenarioModal.classList.add('hidden');
  scenarioModal.setAttribute('aria-hidden', 'true');
  currentScenarioDetails = null;
  currentScenarioRecordings = [];
  renderScenarioDescription(null);
  if (scenarioRecordingsAccordion) {
    scenarioRecordingsAccordion.hidden = true;
    scenarioRecordingsAccordion.open = false;
  }
  renderScenarioRecordings({ recordings: [] });
  if (scenarioInputsList) scenarioInputsList.innerHTML = '';
};

const renderEvents = () => {
  eventsList.innerHTML = '';
  if (!state.events.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Nenhuma ação capturada ainda.';
    eventsList.appendChild(empty);
    return;
  }

  [...state.events].reverse().forEach((event) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const { title, detail, value, time } = formatEvent(event);
    item.innerHTML = `
      <div class="title">${title} <span class="meta">${detail}</span></div>
      <div class="meta">${[value, time].filter(Boolean).join(' · ')}</div>
    `;
    eventsList.appendChild(item);
  });
};

const renderReplayLog = () => {
  if (!replayLogList) return;
  replayLogList.innerHTML = '';
  if (!state.replayLog || !state.replayLog.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Sem logs de replay no momento.';
    replayLogList.appendChild(empty);
    return;
  }

  [...state.replayLog].reverse().forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const { title, detail } = formatReplayLogEntry(entry);
    const timestamp = entry.at ? new Date(entry.at).toLocaleTimeString() : '';
    item.innerHTML = `
      <div class="title">${escapeHtml(title || 'Evento')}</div>
      <div class="meta">${escapeHtml([timestamp, detail].filter(Boolean).join(' · '))}</div>
    `;
    replayLogList.appendChild(item);
  });
};

const renderSavedScenarios = () => {
  syncScenarioFilters();
  savedScenariosList.innerHTML = '';
  const linkedScenarios = savedScenariosWithTestCase();
  if (!linkedScenarios.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Nenhum cenário salvo ainda.';
    savedScenariosList.appendChild(empty);
    return;
  }

  const selectedClient = savedScenarioClientFilter ? savedScenarioClientFilter.value : '';
  const selectedProject = savedScenarioProjectFilter ? savedScenarioProjectFilter.value : '';
  const selectedWork = savedScenarioWorkFilter ? savedScenarioWorkFilter.value : '';
  if (!selectedClient) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Selecione um cliente para listar os casos de teste.';
    savedScenariosList.appendChild(empty);
    return;
  }

  if (!selectedProject) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Selecione um projeto para listar os casos de teste.';
    savedScenariosList.appendChild(empty);
    return;
  }

  if (!selectedWork) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Selecione um work para listar os casos de teste.';
    savedScenariosList.appendChild(empty);
    return;
  }

  const scenarios = filteredSavedScenarios();
  if (!scenarios.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Nenhum caso de teste encontrado para o projeto/work selecionados.';
    savedScenariosList.appendChild(empty);
    return;
  }

  const testCases = groupedTestCases(scenarios);
  testCases.forEach((testCase) => {
    const statusLabel = testCase.status || 'Sem status';
    const scenarioRows = testCase.scenarios
      .map((scenario) => {
        const isExtendActive = state.extendScenario && state.extendScenario.id === scenario.id;
        const extendLabel = isExtendActive ? 'Cancelar extensão' : 'Estender';
        const extendDisabled =
          state.status === 'Recording' || state.status === 'Paused' || state.status === 'Replaying';
        const syncState = scenarioSyncState(scenario);
        const syncTitle = syncState.title ? ` title="${escapeHtml(syncState.title)}"` : '';
        const syncErrorText = scenario.syncError ? ` · ${scenario.syncError}` : '';
        return `
          <div class="case-scenario-row">
            <div class="case-scenario-title">
              <div class="title">${escapeHtml(scenario.name)}</div>
              <span class="sync-chip ${syncState.className}"${syncTitle}>${syncState.label}</span>
            </div>
            <div class="meta">${
              Number.isFinite(Number(scenario.eventCount)) ? Number(scenario.eventCount) : 0
            } eventos · ${formatDuration(scenario.duration)}${escapeHtml(syncErrorText)}</div>
            <div class="scenario-actions">
              <button data-action="run" data-id="${scenario.id}">Executar</button>
              <button data-action="queue" data-id="${scenario.id}">Enviar à fila</button>
              <button data-action="export" data-id="${scenario.id}">Exportar</button>
              <button data-action="duplicate" data-id="${scenario.id}">Duplicar</button>
              <button data-action="extend" data-id="${scenario.id}" ${extendDisabled ? 'disabled' : ''}>
                ${extendLabel}
              </button>
              <button data-action="evidence" data-id="${scenario.id}">Evidência</button>
              <button data-action="details" data-id="${scenario.id}">Detalhes</button>
              <button data-action="rename" data-id="${scenario.id}">Renomear</button>
              <button data-action="delete" data-id="${scenario.id}" class="danger">Remover</button>
            </div>
          </div>
        `;
      })
      .join('');
    const item = document.createElement('div');
    item.className = 'list-item';
    const sourceMeta = testCase.isLocal ? 'Origem: Local' : `ID: ${testCase.id}`;
    item.innerHTML = `
      <div class="title">${escapeHtml(testCase.name || 'Caso sem nome')}</div>
      <div class="meta">${escapeHtml(
        `${sourceMeta} · Status: ${statusLabel} · Cliente: ${testCase.clientName || '—'} · Projeto: ${
          testCase.projectName || '—'
        } · Work: ${testCase.workName || '—'}`
      )}</div>
      <div class="meta">${testCase.scenarios.length} cenário(s) vinculado(s)</div>
      <div class="case-scenarios">${scenarioRows}</div>
    `;
    savedScenariosList.appendChild(item);
  });
};

const renderQueue = () => {
  queueList.innerHTML = '';
  if (!state.queue.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Fila vazia. Envie cenários para executar em sequência.';
    queueList.appendChild(empty);
    return;
  }

  state.queue.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `
      <div class="title">${index + 1}. ${item.name}</div>
      <div class="meta">${item.eventCount} eventos · ${formatDuration(item.duration)} · Status: ${item.status || 'Pendente'}</div>
      <div class="scenario-actions">
        <button data-action="up" data-id="${item.id}">Subir</button>
        <button data-action="down" data-id="${item.id}">Descer</button>
        <button data-action="remove" data-id="${item.id}">Remover</button>
      </div>
    `;
    queueList.appendChild(row);
  });
};

const renderScenarioRecordings = (options = {}) => {
  if (!scenarioRecordingsList) return;
  const loading = Boolean(options.loading);
  const recordings = Array.isArray(options.recordings)
    ? options.recordings
    : currentScenarioRecordings;

  scenarioRecordingsList.innerHTML = '';
  if (loading) {
    const loadingRow = document.createElement('div');
    loadingRow.className = 'list-item';
    loadingRow.textContent = 'Carregando execuções...';
    scenarioRecordingsList.appendChild(loadingRow);
    return;
  }

  if (!recordings.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item';
    empty.textContent = 'Nenhuma execução em vídeo encontrada para este cenário.';
    scenarioRecordingsList.appendChild(empty);
    return;
  }

  recordings.forEach((recording) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    const savedAt = recording.savedAt || recording.updatedAt || recording.createdAt;
    const dateLabel = savedAt ? new Date(savedAt).toLocaleString() : '';
    const executionMeta = [formatRecordingSource(recording), dateLabel].filter(Boolean).join(' · ');
    row.innerHTML = `
      <div class="title">${escapeHtml(recording.name || 'captura.webm')}</div>
      <div class="meta">${escapeHtml(
        [formatBytes(recording.size), executionMeta].filter(Boolean).join(' · ')
      )}</div>
      <div class="scenario-actions">
        <button data-action="download" data-name="${escapeHtml(recording.name || '')}">Baixar</button>
        <button data-action="delete" data-name="${escapeHtml(recording.name || '')}">Remover</button>
      </div>
    `;
    scenarioRecordingsList.appendChild(row);
  });
};

const loadScenarioRecordings = async (scenarioId) => {
  if (!scenarioRecordingsAccordion || !scenarioRecordingsList) return;
  if (!scenarioId) {
    scenarioRecordingsAccordion.hidden = true;
    currentScenarioRecordings = [];
    renderScenarioRecordings({ recordings: [] });
    return;
  }

  scenarioRecordingsAccordion.hidden = false;
  renderScenarioRecordings({ loading: true });
  try {
    const response = await apiRequest(`/api/scenarios/${scenarioId}/recordings`);
    const payload = await response.json().catch(() => ({}));
    currentScenarioRecordings = Array.isArray(payload.recordings) ? payload.recordings : [];
    renderScenarioRecordings();
  } catch (error) {
    currentScenarioRecordings = [];
    renderScenarioRecordings({ recordings: [] });
    const errorRow = document.createElement('div');
    errorRow.className = 'list-item';
    errorRow.textContent = error.message || 'Falha ao carregar execuções.';
    scenarioRecordingsList.innerHTML = '';
    scenarioRecordingsList.appendChild(errorRow);
  }
};

const render = () => {
  updateStatus();
  updateButtons();
  updateRecordVideoToggle();
  renderEvents();
  renderReplayLog();
  renderSavedScenarios();
  renderQueue();
};

const apiRequest = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || 'Erro na operação');
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return response;
};

const downloadRecording = async () => {
  const response = await apiRequest('/api/export/last');
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = match ? match[1] : 'recording.json';

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const downloadScenarios = async () => {
  const response = await apiRequest('/api/scenarios/export');
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = match ? match[1] : 'scenarios.json';

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const downloadVideoCapture = async (name) => {
  const response = await apiRequest(`/api/recordings/${encodeURIComponent(name)}/download`);
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = match ? match[1] : name || 'capture.webm';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const importScenarios = async (file) => {
  if (!file) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  await apiRequest('/api/scenarios/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

const syncScenarios = async () => {
  if (!syncScenariosBtn) return;
  const originalText = syncScenariosBtn.textContent;
  syncScenariosBtn.disabled = true;
  syncScenariosBtn.textContent = 'Sincronizando...';
  try {
    const response = await apiRequest('/api/scenarios/sync', { method: 'POST' });
    const payload = await response.json().catch(() => ({}));
    if (!payload.pending) {
      window.alert('Nenhum caso pendente para sincronizar.');
      return;
    }
    if (payload.failed) {
      window.alert(
        `${payload.synced || 0} caso(s) sincronizado(s), ${payload.failed} com falha. Verifique os casos marcados com erro.`
      );
      return;
    }
    window.alert(`${payload.synced || 0} caso(s) sincronizado(s) com sucesso.`);
  } catch (error) {
    window.alert(error.message || 'Falha ao sincronizar casos.');
  } finally {
    syncScenariosBtn.textContent = originalText;
    updateButtons();
  }
};

const cloudScenarioKey = (scenario) =>
  String(scenario?.cloudId || scenario?.id || '').trim();
const scenarioAlreadyImported = (scenario) => {
  const cloudId = String(scenario?.cloudId || '').trim();
  const localId = String(scenario?.id || '').trim();
  return state.savedScenarios.some((item) => {
    const itemCloudId = String(item?.cloudId || '').trim();
    const itemId = String(item?.id || '').trim();
    return (cloudId && itemCloudId === cloudId) || (localId && itemId === localId);
  });
};
const nextImportedScenarioId = (index = 0) =>
  `imported_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`;
const selectedCloudScenarioKeys = () => {
  if (!cloudImportList) return new Set();
  return new Set(
    [...cloudImportList.querySelectorAll('input[data-cloud-key]:checked')].map((input) =>
      input.getAttribute('data-cloud-key')
    )
  );
};
const updateCloudImportConfirmState = () => {
  if (!cloudImportConfirm) return;
  cloudImportConfirm.disabled = selectedCloudScenarioKeys().size === 0;
};
const renderCloudImportList = (options = {}) => {
  if (!cloudImportList) return;
  const loading = Boolean(options.loading);
  cloudImportList.innerHTML = '';
  if (loading) {
    const loadingItem = document.createElement('div');
    loadingItem.className = 'list-item empty-state';
    loadingItem.textContent = 'Carregando casos da nuvem...';
    cloudImportList.appendChild(loadingItem);
    if (cloudImportStatus) cloudImportStatus.textContent = 'Consultando o PostgreSQL remoto.';
    updateCloudImportConfirmState();
    return;
  }

  if (!cloudScenarioCandidates.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item empty-state';
    empty.textContent = 'Nenhum caso encontrado na nuvem.';
    cloudImportList.appendChild(empty);
    if (cloudImportStatus) cloudImportStatus.textContent = 'Nenhum caso retornado pelo PostgreSQL remoto.';
    updateCloudImportConfirmState();
    return;
  }

  const availableCount = cloudScenarioCandidates.filter((scenario) => !scenarioAlreadyImported(scenario)).length;
  if (cloudImportStatus) {
    cloudImportStatus.textContent = `${cloudScenarioCandidates.length} caso(s) na nuvem, ${availableCount} disponível(is) para importar.`;
  }

  cloudScenarioCandidates.forEach((scenario, index) => {
    const key = cloudScenarioKey(scenario) || `cloud_${index}`;
    const imported = scenarioAlreadyImported(scenario);
    const syncedAt = scenario.syncedAt ? new Date(scenario.syncedAt).toLocaleString() : '—';
    const item = document.createElement('label');
    item.className = `list-item cloud-scenario-row${imported ? ' cloud-scenario-row-disabled' : ''}`;
    item.innerHTML = `
      <input
        type="checkbox"
        data-cloud-key="${escapeHtml(key)}"
        ${imported ? 'disabled' : ''}
      />
      <div class="cloud-scenario-content">
        <div class="case-scenario-title">
          <div class="title">${escapeHtml(scenario.name || 'Cenário')}</div>
          <span class="sync-chip ${imported ? 'sync-pending' : 'sync-ok'}">
            ${imported ? 'Já importado' : 'Na nuvem'}
          </span>
        </div>
        <div class="meta">${escapeHtml(
          `Cliente: ${scenarioClientName(scenario)} · Projeto: ${scenarioProjectName(scenario)} · Work: ${scenarioWorkName(scenario)}`
        )}</div>
        <div class="meta">${escapeHtml(
          `${Number(scenario.eventCount || scenario.events?.length || 0)} eventos · ${formatDuration(
            scenario.duration
          )} · Sincronizado em ${syncedAt}`
        )}</div>
      </div>
    `;
    cloudImportList.appendChild(item);
  });
  updateCloudImportConfirmState();
};
const loadCloudScenarios = async () => {
  renderCloudImportList({ loading: true });
  const response = await apiRequest('/api/scenarios/cloud?limit=500');
  const payload = await response.json().catch(() => ({}));
  cloudScenarioCandidates = Array.isArray(payload.scenarios)
    ? payload.scenarios.map(normalizeLocalScenario).filter(Boolean)
    : [];
  renderCloudImportList();
};
const formatCloudImportError = (error) => {
  const payload = error?.payload || {};
  const connection = payload.connection || {};
  const host = String(connection.host || '').trim();
  const port = String(connection.port || '').trim();
  const address = host ? `${host}${port ? `:${port}` : ''}` : '';
  const detail = String(payload.detail || error?.message || '').trim();
  const isTimeout =
    payload.code === 'POSTGRES_CONNECTION_TIMEOUT' ||
    /connection timeout|timeout expired|tempo esgotado/i.test(detail);

  if (isTimeout) {
    return [
      `Tempo esgotado ao conectar no PostgreSQL remoto${address ? ` (${address})` : ''}.`,
      'Verifique se a VPN/Tailscale está conectada e se o banco está aceitando conexões nessa porta.',
      connection.table ? `Tabela configurada: ${connection.table}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return error?.message || 'Falha ao carregar casos da nuvem.';
};
const openCloudImportModal = async () => {
  if (!cloudImportModal) return;
  cloudImportModal.classList.remove('hidden');
  cloudImportModal.setAttribute('aria-hidden', 'false');
  cloudScenarioCandidates = [];
  try {
    await loadCloudScenarios();
  } catch (error) {
    showCloudImportError(error);
  }
};
const showCloudImportError = (error) => {
  cloudScenarioCandidates = [];
  if (cloudImportList) {
    cloudImportList.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'list-item empty-state';
    item.textContent = formatCloudImportError(error);
    cloudImportList.appendChild(item);
  }
  if (cloudImportStatus) cloudImportStatus.textContent = 'Não foi possível consultar a nuvem.';
  updateCloudImportConfirmState();
};
const closeCloudImportModal = () => {
  if (!cloudImportModal) return;
  cloudImportModal.classList.add('hidden');
  cloudImportModal.setAttribute('aria-hidden', 'true');
  cloudScenarioCandidates = [];
  if (cloudImportList) cloudImportList.innerHTML = '';
  if (cloudImportStatus) {
    cloudImportStatus.textContent = 'Selecione os casos do PostgreSQL remoto para trazer para esta máquina.';
  }
  updateCloudImportConfirmState();
};
const selectAvailableCloudScenarios = () => {
  if (!cloudImportList) return;
  cloudImportList.querySelectorAll('input[data-cloud-key]:not(:disabled)').forEach((input) => {
    input.checked = true;
  });
  updateCloudImportConfirmState();
};
const importSelectedCloudScenarios = async () => {
  const selectedKeys = selectedCloudScenarioKeys();
  if (!selectedKeys.size) {
    window.alert('Selecione pelo menos um caso para importar.');
    return;
  }

  const existingIds = new Set(state.savedScenarios.map((scenario) => scenario.id).filter(Boolean));
  const existingCloudIds = new Set(state.savedScenarios.map((scenario) => scenario.cloudId).filter(Boolean));
  const imported = [];
  cloudScenarioCandidates.forEach((scenario, index) => {
    const key = cloudScenarioKey(scenario) || `cloud_${index}`;
    if (!selectedKeys.has(key) || scenarioAlreadyImported(scenario)) return;
    const cloned = normalizeLocalScenario(JSON.parse(JSON.stringify(scenario)), state.savedScenarios.length + index);
    if (!cloned) return;
    cloned.CasoSincronizado = true;
    cloned.syncError = null;
    cloned.syncedAt = cloned.syncedAt || new Date().toISOString();
    if (cloned.cloudId && existingCloudIds.has(cloned.cloudId)) return;
    if (existingIds.has(cloned.id)) {
      cloned.id = nextImportedScenarioId(index);
    }
    existingIds.add(cloned.id);
    if (cloned.cloudId) existingCloudIds.add(cloned.cloudId);
    imported.push(cloned);
  });

  if (!imported.length) {
    window.alert('Nenhum caso novo para importar.');
    renderCloudImportList();
    return;
  }

  state.savedScenarios = [...state.savedScenarios, ...imported];
  persistLocalState();
  render();
  await hydrateServerFromLocalState();
  window.alert(`${imported.length} caso(s) importado(s) da nuvem.`);
  closeCloudImportModal();
};

const normalizeUrl = (value) => {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
};

const getReplayUrlOverride = () => {
  const value = replayUrlInput ? replayUrlInput.value.trim() : '';
  return value ? normalizeUrl(value) : '';
};
const shouldRecordVideo = () => Boolean(state.recordVideoEnabled);
const runButtonAction = async (button, action, fallbackMessage) => {
  if (button) button.disabled = true;
  try {
    await action();
  } catch (error) {
    window.alert(error.message || fallbackMessage || 'Falha na operação.');
  } finally {
    updateButtons();
  }
};

startBtn.addEventListener('click', async () => {
  await runButtonAction(
    startBtn,
    () => apiRequest('/api/recording/start', { method: 'POST' }),
    'Não foi possível iniciar a gravação.'
  );
});

pauseBtn.addEventListener('click', async () => {
  await runButtonAction(
    pauseBtn,
    () => apiRequest('/api/recording/pause', { method: 'POST' }),
    'Não foi possível pausar a gravação.'
  );
});

resumeBtn.addEventListener('click', async () => {
  await runButtonAction(
    resumeBtn,
    () => apiRequest('/api/recording/resume', { method: 'POST' }),
    'Não foi possível retomar a gravação.'
  );
});

stopBtn.addEventListener('click', async () => {
  await runButtonAction(
    stopBtn,
    () => apiRequest('/api/recording/stop', { method: 'POST' }),
    'Não foi possível finalizar a gravação.'
  );
});

exportBtn.addEventListener('click', async () => {
  await downloadRecording();
});

if (exportScenariosBtn) {
  exportScenariosBtn.addEventListener('click', async () => {
    await downloadScenarios();
  });
}

if (syncScenariosBtn) {
  syncScenariosBtn.addEventListener('click', async () => {
    await syncScenarios();
  });
}

if (importCloudScenariosBtn) {
  importCloudScenariosBtn.addEventListener('click', async () => {
    await openCloudImportModal();
  });
}

if (importScenariosBtn && importScenariosInput) {
  importScenariosBtn.addEventListener('click', () => {
    importScenariosInput.click();
  });

  importScenariosInput.addEventListener('change', async () => {
    const file = importScenariosInput.files ? importScenariosInput.files[0] : null;
    if (!file) return;
    try {
      await importScenarios(file);
    } finally {
      importScenariosInput.value = '';
    }
  });
}

closeBtn.addEventListener('click', async () => {
  await apiRequest('/api/session/close', { method: 'POST' });
});

replayLastBtn.addEventListener('click', async () => {
  const overrideUrl = getReplayUrlOverride();
  await apiRequest('/api/replay/last', {
    method: 'POST',
    body: JSON.stringify({ overrideUrl, recordVideo: shouldRecordVideo() }),
  });
});

if (recordVideoToggle) {
  recordVideoToggle.addEventListener('click', () => {
    state.recordVideoEnabled = !state.recordVideoEnabled;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('recordVideoEnabled', String(state.recordVideoEnabled));
    }
    updateRecordVideoToggle();
  });
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    toggleTheme();
  });
}

if (queueRunBtn) {
  queueRunBtn.addEventListener('click', async () => {
    const overrideUrl = getReplayUrlOverride();
    await apiRequest('/api/queue/run', {
      method: 'POST',
      body: JSON.stringify({ overrideUrl, recordVideo: shouldRecordVideo() }),
    });
  });
}

if (queuePauseBtn) {
  queuePauseBtn.addEventListener('click', async () => {
    await apiRequest('/api/queue/pause', { method: 'POST' });
  });
}

if (queueResumeBtn) {
  queueResumeBtn.addEventListener('click', async () => {
    const overrideUrl = getReplayUrlOverride();
    await apiRequest('/api/queue/resume', {
      method: 'POST',
      body: JSON.stringify({ overrideUrl, recordVideo: shouldRecordVideo() }),
    });
  });
}

if (execCasesBtn) {
  execCasesBtn.addEventListener('click', async () => {
    const overrideUrl = getReplayUrlOverride();
    await apiRequest('/api/cases/execute', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  });
}

saveScenarioBtn.addEventListener('click', async () => {
  const name = scenarioNameInput.value.trim();
  const testCaseId = scenarioTestCaseIdInput ? scenarioTestCaseIdInput.value.trim() : '';
  try {
    await apiRequest('/api/scenarios/save', {
      method: 'POST',
      body: JSON.stringify({ name, testCaseId }),
    });
    scenarioNameInput.value = '';
    if (scenarioTestCaseIdInput) scenarioTestCaseIdInput.value = '';
  } catch (error) {
    window.alert(
      error.message ||
        'Não foi possível salvar o cenário. Corrija os dados do caso de teste no Salesforce e tente novamente.'
    );
  }
});

openUrlBtn.addEventListener('click', async () => {
  const url = normalizeUrl(urlInput.value.trim());
  if (!url) return;
  openUrlBtn.disabled = true;
  try {
    await apiRequest('/api/navigate', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  } catch (error) {
    window.alert(error.message || 'Não foi possível abrir a URL.');
  } finally {
    openUrlBtn.disabled = false;
  }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') openUrlBtn.click();
});

scenarioNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveScenarioBtn.click();
});

savedScenariosList.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  if (!id || !action) return;

  if (action === 'run') {
    const overrideUrl = getReplayUrlOverride();
    await apiRequest(`/api/scenarios/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ overrideUrl, recordVideo: shouldRecordVideo() }),
    });
  }

  if (action === 'queue') {
    await apiRequest('/api/queue/add', {
      method: 'POST',
      body: JSON.stringify({ scenarioId: id }),
    });
  }

  if (action === 'export') {
    const response = await apiRequest(`/api/scenarios/${id}/export`);
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const fileName = match ? match[1] : 'scenario.json';

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (action === 'duplicate') {
    await apiRequest(`/api/scenarios/${id}/duplicate`, { method: 'POST' });
  }

  if (action === 'extend') {
    const response = await apiRequest(`/api/scenarios/${id}/extend`, { method: 'POST' });
    const result = await response.json().catch(() => null);
    if (result && result.active) {
      try {
        await apiRequest('/api/recording/start', { method: 'POST' });
      } catch (error) {
        await apiRequest(`/api/scenarios/${id}/extend`, { method: 'POST' });
        throw error;
      }
    }
  }

  if (action === 'details') {
    await openScenarioDetails(id);
  }

  if (action === 'evidence') {
    await openScenarioEvidence(id);
  }

  if (action === 'rename') {
    const current = state.savedScenarios.find((item) => item.id === id);
    const name = window.prompt('Novo nome do cenário:', current ? current.name : '');
    if (!name) return;
    await apiRequest(`/api/scenarios/${id}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  if (action === 'delete') {
    openDeleteScenarioModal(id);
  }
});

queueList.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  if (!id || !action) return;

  if (action === 'up' || action === 'down') {
    await apiRequest(`/api/queue/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction: action }),
    });
  }

  if (action === 'remove') {
    await apiRequest(`/api/queue/${id}`, { method: 'DELETE' });
  }
});

if (savedScenarioClientFilter) {
  savedScenarioClientFilter.addEventListener('change', () => {
    if (savedScenarioProjectFilter) {
      savedScenarioProjectFilter.value = '';
    }
    if (savedScenarioWorkFilter) {
      savedScenarioWorkFilter.value = '';
    }
    renderSavedScenarios();
  });
}

if (savedScenarioProjectFilter) {
  savedScenarioProjectFilter.addEventListener('change', () => {
    if (savedScenarioWorkFilter) {
      savedScenarioWorkFilter.value = '';
    }
    renderSavedScenarios();
  });
}

if (savedScenarioWorkFilter) {
  savedScenarioWorkFilter.addEventListener('change', () => {
    renderSavedScenarios();
  });
}

if (workspaceTabButtons.length) {
  workspaceTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setWorkspaceTab(button.dataset.workspaceTab || 'main');
    });
  });
}

if (scenarioRecordingsRefresh) {
  scenarioRecordingsRefresh.addEventListener('click', async () => {
    if (!currentScenarioDetails?.id) return;
    await loadScenarioRecordings(currentScenarioDetails.id);
  });
}

if (scenarioRecordingsList) {
  scenarioRecordingsList.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    const name = button.dataset.name;
    if (!action || !name) return;

    if (action === 'download') {
      await downloadVideoCapture(name);
      return;
    }

    if (action === 'delete') {
      const confirmed = window.confirm(`Remover a captura "${name}"?`);
      if (!confirmed) return;
      await apiRequest(`/api/recordings/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (currentScenarioDetails?.id) {
        await loadScenarioRecordings(currentScenarioDetails.id);
      }
    }
  });
}

if (scenarioInputsList) {
  scenarioInputsList.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-role="use-original"]');
    if (!checkbox) return;
    const row = checkbox.closest('.input-detail');
    if (!row) return;
    const input = row.querySelector('[data-role="custom-value"]');
    if (!input) return;
    input.disabled = checkbox.checked;
    if (checkbox.checked) {
      const index = Number(row.dataset.index);
      const source = currentScenarioDetails?.events?.[index];
      if (source && typeof source.value === 'string') {
        input.value = source.value;
      }
    }
  });
}

if (scenarioInputsSave) {
  scenarioInputsSave.addEventListener('click', async () => {
    if (!currentScenarioDetails) return;
    const rows = scenarioInputsList ? scenarioInputsList.querySelectorAll('.input-detail') : [];
    const updates = [];
    rows.forEach((row) => {
      const index = Number(row.dataset.index);
      if (!Number.isInteger(index)) return;
      const useOriginal = row.querySelector('[data-role="use-original"]')?.checked;
      const input = row.querySelector('[data-role="custom-value"]');
      const customValue = input ? input.value : '';
      updates.push({
        index,
        customValue: useOriginal ? null : customValue,
      });
    });

    await apiRequest(`/api/scenarios/${currentScenarioDetails.id}/inputs`, {
      method: 'POST',
      body: JSON.stringify({ updates }),
    });
    closeScenarioDetails();
  });
}

if (scenarioDescriptionSave) {
  scenarioDescriptionSave.addEventListener('click', async () => {
    if (!currentScenarioDetails?.id || !currentScenarioDetails?.testCase?.id) return;
    const description = scenarioDescriptionInput ? scenarioDescriptionInput.value : '';
    setScenarioDescriptionStatus('Atualizando descrição no Salesforce...');
    scenarioDescriptionSave.disabled = true;
    if (scenarioDescriptionInput) scenarioDescriptionInput.disabled = true;

    try {
      const response = await apiRequest(
        `/api/scenarios/${currentScenarioDetails.id}/test-case/description`,
        {
          method: 'POST',
          body: JSON.stringify({ description }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      const returnedTestCase = payload?.testCase && typeof payload.testCase === 'object' ? payload.testCase : {};
      const hasDescription = Object.prototype.hasOwnProperty.call(returnedTestCase, 'description');
      const descriptionValue = hasDescription
        ? returnedTestCase.description ?? ''
        : description;

      currentScenarioDetails = {
        ...currentScenarioDetails,
        testCase: {
          ...(currentScenarioDetails.testCase || {}),
          ...returnedTestCase,
          description: descriptionValue || null,
        },
      };

      if (scenarioDescriptionInput) scenarioDescriptionInput.value = descriptionValue;
      setScenarioDescriptionStatus('Descrição atualizada com sucesso.', 'success');
    } catch (error) {
      setScenarioDescriptionStatus(error.message || 'Falha ao atualizar descrição.', 'error');
    } finally {
      scenarioDescriptionSave.disabled = false;
      if (scenarioDescriptionInput) scenarioDescriptionInput.disabled = false;
    }
  });
}

if (scenarioStatusSave) {
  scenarioStatusSave.addEventListener('click', async () => {
    if (!currentScenarioDetails?.id || !currentScenarioDetails?.testCase?.id) return;
    const statusValue = normalizeScenarioStatus(scenarioStatusInput ? scenarioStatusInput.value : '');
    if (!statusValue) {
      setScenarioStatusFeedback('Selecione Passed ou Failed.', 'error');
      return;
    }

    setScenarioStatusFeedback('Atualizando status no Salesforce...');
    scenarioStatusSave.disabled = true;
    if (scenarioStatusInput) scenarioStatusInput.disabled = true;

    try {
      const response = await apiRequest(
        `/api/scenarios/${currentScenarioDetails.id}/test-case/status`,
        {
          method: 'POST',
          body: JSON.stringify({ status: statusValue }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      const returnedTestCase = payload?.testCase && typeof payload.testCase === 'object' ? payload.testCase : {};
      const hasStatus = Object.prototype.hasOwnProperty.call(returnedTestCase, 'status');
      const normalizedStatus = normalizeScenarioStatus(
        hasStatus ? returnedTestCase.status : statusValue
      );

      currentScenarioDetails = {
        ...currentScenarioDetails,
        testCase: {
          ...(currentScenarioDetails.testCase || {}),
          ...returnedTestCase,
          status: normalizedStatus || null,
        },
      };

      if (scenarioStatusInput) scenarioStatusInput.value = normalizedStatus;
      setScenarioStatusFeedback('Status atualizado com sucesso.', 'success');
      if (normalizedStatus === 'Failed') {
        await openFailedWorkModal(currentScenarioDetails);
      } else if (failedWorkModal && !failedWorkModal.classList.contains('hidden')) {
        closeFailedWorkModal();
      }
    } catch (error) {
      setScenarioStatusFeedback(error.message || 'Falha ao atualizar status.', 'error');
    } finally {
      scenarioStatusSave.disabled = false;
      if (scenarioStatusInput) scenarioStatusInput.disabled = false;
    }
  });
}

if (failedWorkCreate) {
  failedWorkCreate.addEventListener('click', async () => {
    const scenarioId = String(pendingFailedWorkContext?.scenarioId || '').trim();
    if (!scenarioId) {
      setFailedWorkStatus('Fluxo inválido. Atualize o status para Failed novamente.', 'error');
      return;
    }
    const workName = typeof failedWorkNameInput?.value === 'string' ? failedWorkNameInput.value.trim() : '';
    if (!workName) {
      setFailedWorkStatus('Preencha o assunto da nova Work para continuar.', 'error');
      return;
    }
    const description = typeof failedWorkDescriptionInput?.value === 'string'
      ? failedWorkDescriptionInput.value.replace(/\r\n/g, '\n')
      : '';
    if (!description.trim()) {
      setFailedWorkStatus('Preencha a descrição da falha para continuar.', 'error');
      return;
    }
    const priority = normalizeFailedWorkPriority(failedWorkPriorityInput ? failedWorkPriorityInput.value : '');
    if (!priority) {
      setFailedWorkStatus('Selecione uma prioridade válida (P0, P1 ou P2).', 'error');
      return;
    }

    setFailedWorkStatus('Criando Work relacionada no Salesforce...');
    setFailedWorkControlsDisabled(true);

    try {
      const response = await apiRequest(`/api/scenarios/${scenarioId}/test-case/failed-work`, {
        method: 'POST',
        body: JSON.stringify({ name: workName, description, priority }),
      });
      const payload = await response.json().catch(() => ({}));
      const createdWork = payload?.work && typeof payload.work === 'object' ? payload.work : {};
      const workId = String(createdWork.id || '').trim();
      const idSuffix = workId ? ` (${workId})` : '';
      const createdName = String(createdWork.name || workName).trim();
      const nameSuffix = createdName ? ` ${createdName}` : '';
      setFailedWorkStatus(`Work relacionada criada com sucesso:${nameSuffix}${idSuffix}.`, 'success');
      setScenarioStatusFeedback(`Status atualizado e Work relacionada criada${idSuffix}.`, 'success');
      if (payload?.template && typeof payload.template === 'object') {
        renderFailedWorkSummary(payload.template);
      }
      window.setTimeout(() => {
        closeFailedWorkModal();
      }, 1200);
    } catch (error) {
      setFailedWorkStatus(error.message || 'Falha ao criar Work relacionada.', 'error');
      setScenarioStatusFeedback(
        'Status atualizado para Failed, mas a Work relacionada não foi criada.',
        'error'
      );
    } finally {
      if (!failedWorkModal || failedWorkModal.classList.contains('hidden')) return;
      setFailedWorkControlsDisabled(false);
    }
  });
}

if (failedWorkClose) {
  failedWorkClose.addEventListener('click', () => closeFailedWorkModal());
}

if (failedWorkCancel) {
  failedWorkCancel.addEventListener('click', () => closeFailedWorkModal());
}

if (deleteScenarioCancel) {
  deleteScenarioCancel.addEventListener('click', () => closeDeleteScenarioModal());
}

if (deleteScenarioLocal) {
  deleteScenarioLocal.addEventListener('click', async () => {
    await deletePendingScenario(false);
  });
}

if (deleteScenarioCloud) {
  deleteScenarioCloud.addEventListener('click', async () => {
    await deletePendingScenario(true);
  });
}

if (scenarioModalClose) {
  scenarioModalClose.addEventListener('click', () => closeScenarioDetails());
}

if (scenarioModal) {
  scenarioModal.addEventListener('click', (event) => {
    const closeTarget = event.target.closest('[data-action="close"]');
    if (closeTarget) closeScenarioDetails();
  });
}

if (failedWorkModal) {
  failedWorkModal.addEventListener('click', (event) => {
    const closeTarget = event.target.closest('[data-action="close"]');
    if (closeTarget) closeFailedWorkModal();
  });
}

if (deleteScenarioModal) {
  deleteScenarioModal.addEventListener('click', (event) => {
    const closeTarget = event.target.closest('[data-action="close"]');
    if (closeTarget) closeDeleteScenarioModal();
  });
}

if (cloudImportClose) {
  cloudImportClose.addEventListener('click', () => closeCloudImportModal());
}

if (cloudImportCancel) {
  cloudImportCancel.addEventListener('click', () => closeCloudImportModal());
}

if (cloudImportRefresh) {
  cloudImportRefresh.addEventListener('click', async () => {
    try {
      await loadCloudScenarios();
    } catch (error) {
      showCloudImportError(error);
      window.alert(formatCloudImportError(error));
    }
  });
}

if (cloudImportSelectAll) {
  cloudImportSelectAll.addEventListener('click', () => selectAvailableCloudScenarios());
}

if (cloudImportConfirm) {
  cloudImportConfirm.addEventListener('click', async () => {
    cloudImportConfirm.disabled = true;
    try {
      await importSelectedCloudScenarios();
    } catch (error) {
      window.alert(error.message || 'Falha ao importar casos da nuvem.');
    } finally {
      updateCloudImportConfirmState();
    }
  });
}

if (cloudImportList) {
  cloudImportList.addEventListener('change', (event) => {
    if (event.target.matches('input[data-cloud-key]')) {
      updateCloudImportConfirmState();
    }
  });
}

if (cloudImportModal) {
  cloudImportModal.addEventListener('click', (event) => {
    const closeTarget = event.target.closest('[data-action="close"]');
    if (closeTarget) closeCloudImportModal();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (cloudImportModal && !cloudImportModal.classList.contains('hidden')) {
      closeCloudImportModal();
      return;
    }
    if (deleteScenarioModal && !deleteScenarioModal.classList.contains('hidden')) {
      closeDeleteScenarioModal();
      return;
    }
    if (failedWorkModal && !failedWorkModal.classList.contains('hidden')) {
      closeFailedWorkModal();
      return;
    }
    if (!scenarioModal || scenarioModal.classList.contains('hidden')) return;
    closeScenarioDetails();
  });
}

const ws = new WebSocket(`ws://${window.location.host}`);
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  console.debug('Received message:', message);
  if (message.type === 'state') {
    if (!localStateHydrated) {
      const localState = loadLocalState();
      const hasLocalData = localState.savedScenarios.length > 0 || localState.queue.length > 0;
      Object.assign(state, message.state);
      if (hasLocalData) {
        state.savedScenarios = localState.savedScenarios;
        state.queue = localState.queue;
        localStateHydrated = true;
        render();
        void hydrateServerFromLocalState();
        return;
      }
      localStateHydrated = true;
      persistLocalState();
      render();
      return;
    }
    Object.assign(state, message.state);
    persistLocalState();
    render();
    return;
  }

  if (message.type === 'replay-log') {
    state.replayLog = [...(state.replayLog || []), message.entry].slice(-300);
    if (message.entry?.type === 'session' && message.entry?.stage === 'start') {
      hideScenarioCompletionBanner();
    }
    if (message.entry?.type === 'session' && message.entry?.stage === 'end') {
      showScenarioCompletionBanner(message.entry.recordingName);
    }
    renderReplayLog();
    if (
      message.entry &&
      message.entry.type === 'video' &&
      message.entry.stage === 'saved' &&
      currentScenarioDetails?.id
    ) {
      void loadScenarioRecordings(currentScenarioDetails.id);
    }
    return;
  }

  if (message.type === 'event') {
    state.events = [...(state.events || []), message.event].slice(-200);
    state.eventCount = message.count;
    if (message.event && message.event.type === 'key') {
      state.lastKey = formatKey(message.event);
      if (lastKeyEl) {
        lastKeyEl.classList.remove('flash');
        void lastKeyEl.offsetWidth;
        lastKeyEl.classList.add('flash');
      }
    }
    renderEvents();
    updateStatus();
    updateButtons();
  }
});

initializeTheme();
setWorkspaceTab('main');
