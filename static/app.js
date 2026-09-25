let allServices = [];
let allContainers = [];
let currentFilter = 'all'; // 'all', 'running', 'inactive'
let currentCategoryFilter = 'all'; // 'all', 'web', 'containers', 'timers'
let currentSearch = '';
let currentViewMode = 'table';
let currentEditingUnit = null;
let currentLogsUnit = null;

const CATEGORY_ORDER = [
  "Web Apps & Dashboards",
  "Podman Containers",
  "Scheduled Tasks & Timers",
  "Local Utilities & Daemons"
];

document.addEventListener('DOMContentLoaded', () => {
  initThemeManager();
  initEventListeners();
  loadData();
  loadSettings();
});

function initEventListeners() {
  // Scan button
  document.getElementById('btn-scan').addEventListener('click', handleManualScan);

  // Search input
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase().trim();
    renderContent();
  });

  // Filter buttons (Running / Stopped / All)
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderContent();
    });
  });

  // Stat cards filter click
  document.querySelectorAll('.stat-card').forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.dataset.category;
      if (cat === 'all') {
        currentCategoryFilter = 'all';
        currentFilter = 'all';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
      } else if (cat === 'running') {
        currentFilter = 'running';
        currentCategoryFilter = 'all';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="running"]').classList.add('active');
      } else {
        currentCategoryFilter = cat;
      }
      renderContent();
    });
  });

  // Editor Modal Controls
  document.getElementById('btn-close-editor').addEventListener('click', closeEditorModal);
  document.getElementById('btn-cancel-editor').addEventListener('click', closeEditorModal);
  document.getElementById('btn-save-editor').addEventListener('click', () => saveUnitFile(false));
  document.getElementById('btn-save-restart-editor').addEventListener('click', () => saveUnitFile(true));

  // Logs Modal Controls
  document.getElementById('btn-close-logs').addEventListener('click', closeLogsModal);
  document.getElementById('btn-refresh-logs').addEventListener('click', refreshLogs);
  document.getElementById('btn-copy-logs').addEventListener('click', copyLogsToClipboard);

  // Theme Modal Controls
  document.getElementById('btn-theme-modal').addEventListener('click', openThemeModal);
  document.getElementById('btn-close-theme').addEventListener('click', closeThemeModal);
  document.getElementById('btn-done-theme').addEventListener('click', closeThemeModal);

  // Settings Modal Controls
  const btnSettings = document.getElementById('btn-settings-modal');
  if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
  const btnCloseSettings = document.getElementById('btn-close-settings');
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  const btnDoneSettings = document.getElementById('btn-done-settings');
  if (btnDoneSettings) btnDoneSettings.addEventListener('click', closeSettingsModal);

  // Settings Toggles & Actions
  const toggleGithubBtn = document.getElementById('toggle-github-btn');
  if (toggleGithubBtn) {
    toggleGithubBtn.addEventListener('change', async (e) => {
      const show = e.target.checked;
      const navGithub = document.getElementById('nav-github-link');
      if (navGithub) {
        navGithub.style.display = show ? 'inline-flex' : 'none';
      }
      await updateAppSetting({ show_github_btn: show });
    });
  }

  const toggleCheckUpdates = document.getElementById('toggle-check-updates');
  if (toggleCheckUpdates) {
    toggleCheckUpdates.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await updateAppSetting({ check_for_updates: enabled });
      if (enabled) {
        await triggerCheckUpdate(false);
      } else {
        const updateBadge = document.getElementById('nav-update-badge');
        if (updateBadge) updateBadge.classList.add('hidden');
        const settingsBadge = document.getElementById('settings-update-badge');
        if (settingsBadge) settingsBadge.classList.add('hidden');
        const settingsDesc = document.getElementById('settings-update-desc');
        if (settingsDesc) settingsDesc.textContent = 'Update checks disabled';
      }
    });
  }

  const btnCheckNow = document.getElementById('btn-check-update-now');
  if (btnCheckNow) {
    btnCheckNow.addEventListener('click', () => triggerCheckUpdate(true));
  }

  // Close modals on escape key or outside click
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeEditorModal();
      closeLogsModal();
      closeThemeModal();
      closeSettingsModal();
    }
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeEditorModal();
        closeLogsModal();
        closeThemeModal();
        closeSettingsModal();
      }
    });
  });

  // Tab key in textarea
  const textarea = document.getElementById('editor-textarea');
  textarea.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
      this.value = this.value.substring(0, start) + "    " + this.value.substring(end);
      this.selectionStart = this.selectionEnd = start + 4;
    }
  });
}

async function loadData() {
  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    applyData(data);
  } catch (err) {
    console.error('Failed to load services data:', err);
    showToast('Failed to fetch services data', 'error');
  }
}

async function handleManualScan() {
  const btn = document.getElementById('btn-scan');
  const spinIcon = btn.querySelector('.spin-icon');
  const btnText = document.getElementById('scan-btn-text');
  
  btn.disabled = true;
  spinIcon.classList.add('spinning');
  btnText.textContent = 'Scanning...';

  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    if (!res.ok) throw new Error(`Scan failed with status ${res.status}`);
    const result = await res.json();
    applyData(result.data);
    showToast('Scan completed successfully!');
  } catch (err) {
    console.error('Manual scan error:', err);
    showToast('Scan failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    spinIcon.classList.remove('spinning');
    btnText.textContent = 'Scan Now';
  }
}

function applyData(data) {
  allServices = data.services || [];
  allContainers = data.containers || [];
  
  // Calculate Web apps count
  const webCount = allServices.filter(s => s.category === "Web Apps & Dashboards").length;
  const runningServicesCount = allServices.filter(s => s.active_state === 'active').length;
  
  // Update stats
  document.getElementById('stat-total-services').textContent = allServices.length;
  document.getElementById('stat-running-services').textContent = runningServicesCount;
  document.getElementById('stat-web').textContent = webCount;
  document.getElementById('stat-containers').textContent = allContainers.length;
  document.getElementById('stat-timers').textContent = (data.stats && data.stats.active_timers) || 0;

  if (data.last_scan) {
    document.getElementById('last-scan-time').textContent = `Last scan: ${data.last_scan}`;
  }

  renderContent();
}

function getUnifiedItems() {
  let combined = [];
  const containerMap = new Map();
  allContainers.forEach(c => {
    containerMap.set(c.name.toLowerCase(), c);
  });

  const matchedContainerNames = new Set();

  // Process services (including Quadlets)
  allServices.forEach(s => {
    let cleanName = s.name.replace('.service', '').replace('container-', '');
    let matchedContainer = containerMap.get(cleanName.toLowerCase());

    if (matchedContainer) {
      matchedContainerNames.add(matchedContainer.name.toLowerCase());
    }

    let description = s.description;
    if (!description && matchedContainer) {
      description = `Podman Container: ${matchedContainer.image}`;
    }

    combined.push({
      itemType: s.type === 'quadlet' ? 'quadlet' : 'service',
      name: s.name,
      displayName: s.custom_name || cleanName,
      description: description || 'Background Service',
      filePath: s.file_path,
      activeState: s.active_state,
      subState: s.sub_state,
      port: s.port || (matchedContainer ? matchedContainer.port : null),
      timer: s.timer,
      category: s.category || "Local Utilities & Daemons"
    });
  });

  // Only add standalone containers that aren't already represented by a systemd quadlet or service
  allContainers.forEach(c => {
    if (!matchedContainerNames.has(c.name.toLowerCase())) {
      combined.push({
        itemType: 'container',
        name: c.name,
        displayName: c.name,
        description: `Container Image: ${c.image}`,
        filePath: `Container ID: ${c.id}`,
        activeState: c.state === 'running' ? 'active' : 'inactive',
        subState: c.status,
        port: c.port,
        timer: null,
        category: "Podman Containers"
      });
    }
  });

  // Status Filter
  let filtered = combined.filter(item => {
    if (currentFilter === 'running') {
      return item.activeState === 'active';
    }
    if (currentFilter === 'inactive') {
      return item.activeState !== 'active';
    }
    return true;
  });

  // Category Quick Filter
  if (currentCategoryFilter !== 'all') {
    if (currentCategoryFilter === 'web') {
      filtered = filtered.filter(i => i.category === 'Web Apps & Dashboards');
    } else if (currentCategoryFilter === 'containers') {
      filtered = filtered.filter(i => i.category === 'Podman Containers');
    } else if (currentCategoryFilter === 'timers') {
      filtered = filtered.filter(i => i.category === 'Scheduled Tasks & Timers');
    }
  }

  // Search Filter
  if (currentSearch) {
    filtered = filtered.filter(item => {
      const matchName = item.displayName.toLowerCase().includes(currentSearch);
      const matchFile = item.name.toLowerCase().includes(currentSearch);
      const matchDesc = item.description.toLowerCase().includes(currentSearch);
      const matchPort = item.port ? String(item.port).includes(currentSearch) : false;
      const matchTimer = item.timer ? (item.timer.name.toLowerCase().includes(currentSearch) || (item.timer.schedule && item.timer.schedule.toLowerCase().includes(currentSearch))) : false;
      return matchName || matchFile || matchDesc || matchPort || matchTimer;
    });
  }

  return filtered;
}

function renderContent() {
  const container = document.getElementById('categories-container');
  container.innerHTML = '';

  const items = getUnifiedItems();

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No matching services or timers found.</div>';
    return;
  }

  // Group by Category
  const grouped = {};
  CATEGORY_ORDER.forEach(cat => { grouped[cat] = []; });

  items.forEach(item => {
    const cat = item.category || "Local Utilities & Daemons";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  // Render each category section
  CATEGORY_ORDER.forEach(categoryName => {
    const categoryItems = grouped[categoryName] || [];
    if (categoryItems.length === 0) return;

    const section = document.createElement('section');
    section.className = 'category-section';

    // Category Header
    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `
      <div class="category-title-area">
        <h2 class="category-title">${escapeHtml(categoryName)}</h2>
        <span class="category-badge">${categoryItems.length}</span>
      </div>
    `;
    section.appendChild(header);

    // Body: Table Mode
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-responsive';
    tableWrapper.innerHTML = renderTableHTML(categoryItems);
    section.appendChild(tableWrapper);

    container.appendChild(section);
  });
}

function renderTableHTML(items) {
  let rows = '';
  items.forEach(item => {
    const isRunning = item.activeState === 'active';
    let statusClass = isRunning ? 'active' : 'inactive';
    let statusLabel = isRunning ? 'Running' : (item.timer ? 'Timer Active' : item.activeState);

    // Port link
    let webLink = '-';
    if (item.port) {
      webLink = `<a href="http://localhost:${item.port}" target="_blank" class="port-badge">:${item.port} &nearr;</a>`;
    }

    // Timer info
    let timerInfo = '-';
    if (item.timer) {
      const nextStr = item.timer.next_str ? item.timer.next_str : (item.timer.left_str || 'Scheduled');
      const rule = item.timer.schedule ? ` (${item.timer.schedule})` : '';
      timerInfo = `<span style="color:var(--blue); font-size:0.8rem;">${escapeHtml(nextStr)}${escapeHtml(rule)}</span>`;
    }

    // Actions
    let actionButtons = '';
    if (item.itemType === 'service' || item.itemType === 'quadlet') {
      actionButtons = `
        <div class="table-actions">
          ${isRunning 
            ? `<button class="btn btn-sm btn-danger-soft" onclick="performAction('${item.name}', 'stop')">Stop</button>`
            : `<button class="btn btn-sm btn-success-soft" onclick="performAction('${item.name}', 'start')">Start</button>`
          }
          <button class="btn btn-sm btn-secondary" onclick="performAction('${item.name}', 'restart')">Restart</button>
          <button class="btn btn-sm btn-secondary" onclick="openLogsModal('${item.name}')">Logs</button>
          <button class="btn btn-sm btn-primary" onclick="openEditorModal('${item.name}')">Edit</button>
        </div>
      `;
    } else {
      actionButtons = `
        <div class="table-actions">
          <span class="file-path-badge">${escapeHtml(item.subState)}</span>
          ${item.port ? `<a class="btn btn-sm btn-primary" href="http://localhost:${item.port}" target="_blank">Open UI</a>` : ''}
        </div>
      `;
    }

    rows += `
      <tr>
        <td style="width: 140px;">
          <span class="status-badge ${statusClass}">
            <span class="status-dot"></span>
            ${statusLabel}
          </span>
        </td>
        <td>
          <div class="table-service-name">${escapeHtml(item.displayName)}</div>
          <div class="table-service-file">${escapeHtml(item.name)}</div>
        </td>
        <td class="table-desc" title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</td>
        <td style="text-align: center;">${webLink}</td>
        <td>${timerInfo}</td>
        <td>${actionButtons}</td>
      </tr>
    `;
  });

  return `
    <table class="services-table">
      <thead>
        <tr>
          <th>Status</th>
          <th>Service Name</th>
          <th>Description</th>
          <th style="text-align: center;">Web UI</th>
          <th>Timer / Schedule</th>
          <th style="text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function createCardElement(item) {
  const card = document.createElement('div');
  card.className = 'service-card';

  const isRunning = item.activeState === 'active';
  let statusClass = isRunning ? 'active' : 'inactive';
  let statusText = isRunning ? 'Running' : (item.timer ? 'Timer Scheduled' : item.activeState);

  const typeLabel = item.itemType === 'quadlet' ? 'Quadlet' : (item.itemType === 'container' ? 'Container' : (item.timer ? 'Timer' : 'Service'));

  let metaHtml = '';
  if (item.timer) {
    const nextText = item.timer.next_str ? `Next: ${item.timer.next_str}` : (item.timer.left_str ? `Left: ${item.timer.left_str}` : 'Scheduled');
    const scheduleRule = item.timer.schedule ? ` (${item.timer.schedule})` : '';
    metaHtml += `
      <div class="meta-chip timer-chip">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>${escapeHtml(nextText)}${escapeHtml(scheduleRule)}</span>
      </div>
    `;
  }

  if (item.port) {
    metaHtml += `
      <div class="meta-chip web-chip">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <a href="http://localhost:${item.port}" target="_blank" rel="noopener noreferrer">
          Open Web UI (:${item.port}) &nearr;
        </a>
      </div>
    `;
  }

  let actionButtonsHtml = '';
  if (item.itemType === 'service' || item.itemType === 'quadlet') {
    actionButtonsHtml = `
      <div class="action-group-left">
        ${isRunning 
          ? `<button class="btn btn-sm btn-danger-soft" onclick="performAction('${item.name}', 'stop')">Stop</button>`
          : `<button class="btn btn-sm btn-success-soft" onclick="performAction('${item.name}', 'start')">Start</button>`
        }
        <button class="btn btn-sm btn-secondary" onclick="performAction('${item.name}', 'restart')">Restart</button>
      </div>
      <div class="action-group-right">
        <button class="btn btn-sm btn-secondary" onclick="openLogsModal('${item.name}')">Logs</button>
        <button class="btn btn-sm btn-primary" onclick="openEditorModal('${item.name}')">Edit</button>
      </div>
    `;
  } else {
    actionButtonsHtml = `
      <div class="action-group-left">
        <span class="file-path-badge">${escapeHtml(item.subState)}</span>
      </div>
      <div class="action-group-right">
        ${item.port ? `<a class="btn btn-sm btn-primary" href="http://localhost:${item.port}" target="_blank">Open UI</a>` : ''}
      </div>
    `;
  }

  card.innerHTML = `
    <div>
      <div class="card-top">
        <div class="card-title-group">
          <div class="service-title">${escapeHtml(item.displayName)}</div>
          <div class="service-filename">${escapeHtml(item.name)}</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
          <span class="status-badge ${statusClass}">
            <span class="status-dot"></span>
            ${statusText}
          </span>
          <span class="type-pill">${typeLabel}</span>
        </div>
      </div>
      <div class="service-desc">${escapeHtml(item.description)}</div>
      <div class="card-meta-bar">${metaHtml}</div>
    </div>
    <div class="card-actions">${actionButtonsHtml}</div>
  `;

  return card;
}

// Service Actions (Start / Stop / Restart)
async function performAction(unitName, action) {
  try {
    showToast(`Sending ${action} command to ${unitName}...`);
    const res = await fetch(`/api/service/${unitName}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || `Action failed`);
    }
    showToast(`Successfully performed ${action} on ${unitName}!`);
    loadData();
  } catch (err) {
    console.error('Service action error:', err);
    showToast(`Failed: ${err.message}`, 'error');
  }
}

// Editor Modal
async function openEditorModal(unitName) {
  currentEditingUnit = unitName;
  const modal = document.getElementById('editor-modal');
  const title = document.getElementById('editor-title');
  const pathBadge = document.getElementById('editor-file-path');
  const textarea = document.getElementById('editor-textarea');
  const banner = document.getElementById('editor-banner');

  banner.className = 'banner hidden';
  title.textContent = `Edit ${unitName}`;
  textarea.value = 'Loading file contents...';
  modal.classList.add('open');

  try {
    const res = await fetch(`/api/service/${unitName}/file`);
    if (!res.ok) throw new Error(`Could not load unit file`);
    const data = await res.json();
    pathBadge.textContent = data.file_path;
    textarea.value = data.content;
    textarea.focus();
  } catch (err) {
    console.error('Error fetching unit file:', err);
    textarea.value = `Error loading file: ${err.message}`;
  }
}

function closeEditorModal() {
  document.getElementById('editor-modal').classList.remove('open');
  currentEditingUnit = null;
}

async function saveUnitFile(restartAfter) {
  if (!currentEditingUnit) return;
  const textarea = document.getElementById('editor-textarea');
  const banner = document.getElementById('editor-banner');
  const saveBtn = document.getElementById('btn-save-editor');
  const saveRestartBtn = document.getElementById('btn-save-restart-editor');

  saveBtn.disabled = true;
  saveRestartBtn.disabled = true;
  banner.className = 'banner hidden';

  try {
    const res = await fetch(`/api/service/${currentEditingUnit}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: textarea.value,
        restart: restartAfter
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Save failed');
    }
    const result = await res.json();
    banner.className = 'banner success';
    banner.textContent = `File saved successfully! (Backup: ${result.backup})${result.restarted ? ' Service restarted.' : ''}`;
    banner.classList.remove('hidden');
    showToast(`Saved ${currentEditingUnit}!`);
    loadData();
    setTimeout(() => {
      closeEditorModal();
    }, 1200);
  } catch (err) {
    banner.className = 'banner error';
    banner.textContent = `Error saving file: ${err.message}`;
    banner.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveRestartBtn.disabled = false;
  }
}

// Logs Modal
async function openLogsModal(unitName) {
  currentLogsUnit = unitName;
  const modal = document.getElementById('logs-modal');
  const title = document.getElementById('logs-title');
  const unitBadge = document.getElementById('logs-unit-name');
  const terminal = document.getElementById('logs-terminal');

  title.textContent = `Journal Logs: ${unitName}`;
  unitBadge.textContent = unitName;
  terminal.textContent = 'Loading logs...';
  modal.classList.add('open');

  await refreshLogs();
}

function closeLogsModal() {
  document.getElementById('logs-modal').classList.remove('open');
  currentLogsUnit = null;
}

async function refreshLogs() {
  if (!currentLogsUnit) return;
  const terminal = document.getElementById('logs-terminal');
  try {
    const res = await fetch(`/api/service/${currentLogsUnit}/logs?lines=100`);
    if (!res.ok) throw new Error('Could not fetch logs');
    const data = await res.json();
    terminal.textContent = data.logs || 'No journal log entries found for this service.';
    terminal.scrollTop = terminal.scrollHeight;
  } catch (err) {
    terminal.textContent = `Error fetching logs: ${err.message}`;
  }
}

function copyLogsToClipboard() {
  const terminal = document.getElementById('logs-terminal');
  navigator.clipboard.writeText(terminal.textContent).then(() => {
    showToast('Logs copied to clipboard!');
  }).catch(() => {
    showToast('Failed to copy logs', 'error');
  });
}

// Toast
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.borderColor = type === 'error' ? 'var(--danger)' : 'var(--primary)';
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   Theme Management & Customization System
   ========================================================================== */

const BUILTIN_THEMES = {
  "dark-slate": {
    name: "Dark Slate (Default)",
    builtin: true,
    vars: {
      "--bg-base": "#0c111a",
      "--bg-surface": "#141c2b",
      "--bg-card": "#182235",
      "--bg-card-hover": "#1f2c42",
      "--border-color": "#27374f",
      "--border-subtle": "#1e2b3f",
      "--text-main": "#f1f5f9",
      "--text-muted": "#94a3b8",
      "--primary": "#3b82f6",
      "--accent": "#8b5cf6",
      "--success": "#10b981",
      "--warning": "#f59e0b"
    }
  },
  "oled-black": {
    name: "OLED Pure Black",
    builtin: true,
    vars: {
      "--bg-base": "#000000",
      "--bg-surface": "#0a0a0a",
      "--bg-card": "#121212",
      "--bg-card-hover": "#1c1c1c",
      "--border-color": "#262626",
      "--border-subtle": "#171717",
      "--text-main": "#ffffff",
      "--text-muted": "#a3a3a3",
      "--primary": "#3b82f6",
      "--accent": "#a855f7",
      "--success": "#22c55e",
      "--warning": "#eab308"
    }
  },
  "nord": {
    name: "Nord Frost",
    builtin: true,
    vars: {
      "--bg-base": "#242933",
      "--bg-surface": "#2e3440",
      "--bg-card": "#3b4252",
      "--bg-card-hover": "#434c5e",
      "--border-color": "#4c566a",
      "--border-subtle": "#3b4252",
      "--text-main": "#eceff4",
      "--text-muted": "#d8dee9",
      "--primary": "#88c0d0",
      "--accent": "#b48ead",
      "--success": "#a3be8c",
      "--warning": "#ebcb8b"
    }
  },
  "catppuccin-mocha": {
    name: "Catppuccin Mocha",
    builtin: true,
    vars: {
      "--bg-base": "#11111b",
      "--bg-surface": "#181825",
      "--bg-card": "#1e1e2e",
      "--bg-card-hover": "#313244",
      "--border-color": "#45475a",
      "--border-subtle": "#313244",
      "--text-main": "#cdd6f4",
      "--text-muted": "#a6adc8",
      "--primary": "#89b4fa",
      "--accent": "#cba6f7",
      "--success": "#a6e3a1",
      "--warning": "#f9e2af"
    }
  },
  "cyberpunk": {
    name: "Cyberpunk Neon",
    builtin: true,
    vars: {
      "--bg-base": "#0d0221",
      "--bg-surface": "#19053b",
      "--bg-card": "#260b54",
      "--bg-card-hover": "#381077",
      "--border-color": "#ff007f",
      "--border-subtle": "#4d1082",
      "--text-main": "#fdfdfd",
      "--text-muted": "#b8a3e0",
      "--primary": "#00f0ff",
      "--accent": "#ff007f",
      "--success": "#00ff66",
      "--warning": "#ffe600"
    }
  },
  "light-clean": {
    name: "Clean Light",
    builtin: true,
    vars: {
      "--bg-base": "#f8fafc",
      "--bg-surface": "#f1f5f9",
      "--bg-card": "#ffffff",
      "--bg-card-hover": "#f8fafc",
      "--border-color": "#cbd5e1",
      "--border-subtle": "#e2e8f0",
      "--text-main": "#0f172a",
      "--text-muted": "#64748b",
      "--primary": "#2563eb",
      "--accent": "#7c3aed",
      "--success": "#059669",
      "--warning": "#d97706"
    }
  }
};

const THEME_STORAGE_KEY = 'dashboard_active_theme_key';
const CUSTOM_THEMES_STORAGE_KEY = 'dashboard_custom_themes';

function getCustomThemes() {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveCustomThemes(themes) {
  localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
}

function getAllThemes() {
  return { ...BUILTIN_THEMES, ...getCustomThemes() };
}

function applyThemeVariables(vars) {
  const root = document.documentElement;
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val);
  }
}

function initThemeManager() {
  const allThemes = getAllThemes();
  let activeKey = localStorage.getItem(THEME_STORAGE_KEY) || 'dark-slate';
  if (!allThemes[activeKey]) {
    activeKey = 'dark-slate';
  }
  applyTheme(activeKey, false);

  // Bind color input pickers to live changes & hex sync
  document.querySelectorAll('.color-picker-wrapper').forEach(wrapper => {
    const colorInput = wrapper.querySelector('input[type="color"]');
    const hexInput = wrapper.querySelector('.color-hex-text');
    const cssVar = colorInput.dataset.var;

    colorInput.addEventListener('input', (e) => {
      const val = e.target.value;
      hexInput.value = val;
      document.documentElement.style.setProperty(cssVar, val);
    });

    hexInput.addEventListener('change', (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        colorInput.value = val;
        document.documentElement.style.setProperty(cssVar, val);
      }
    });
  });

  // Reset theme button
  document.getElementById('btn-reset-theme').addEventListener('click', () => {
    applyTheme('dark-slate', true);
    showToast('Reset to default Dark Slate theme');
  });

  // Save as new theme button
  document.getElementById('btn-save-custom-theme').addEventListener('click', () => {
    const nameInput = document.getElementById('custom-theme-name');
    const themeName = nameInput.value.trim();
    if (!themeName) {
      showToast('Please enter a theme name', 'error');
      return;
    }

    // Collect currently configured CSS variables from the inputs
    const currentVars = {};
    document.querySelectorAll('.color-picker-wrapper input[type="color"]').forEach(input => {
      currentVars[input.dataset.var] = input.value;
    });

    const key = 'custom-' + themeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const customThemes = getCustomThemes();
    customThemes[key] = {
      name: themeName,
      builtin: false,
      vars: currentVars
    };

    saveCustomThemes(customThemes);
    nameInput.value = '';
    applyTheme(key, true);
    showToast(`Saved and activated "${themeName}" theme!`);
  });
}

function applyTheme(themeKey, persist = true) {
  const allThemes = getAllThemes();
  const theme = allThemes[themeKey] || BUILTIN_THEMES['dark-slate'];

  if (theme && theme.vars) {
    applyThemeVariables(theme.vars);
  }

  if (persist) {
    localStorage.setItem(THEME_STORAGE_KEY, themeKey);
  }

  // Sync inputs and active cards with active theme
  syncThemeCustomizerUI(themeKey);
}

function renderPresetCard(key, theme, activeKey) {
  const card = document.createElement('div');
  card.className = `theme-preset-card ${key === activeKey ? 'active' : ''}`;
  card.dataset.themeKey = key;

  const top = document.createElement('div');
  top.className = 'theme-preset-top';

  const name = document.createElement('span');
  name.className = 'theme-preset-name';
  name.textContent = theme.name;
  top.appendChild(name);

  if (!theme.builtin) {
    const delBtn = document.createElement('button');
    delBtn.className = 'theme-preset-delete';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Delete custom theme';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const customThemes = getCustomThemes();
      delete customThemes[key];
      saveCustomThemes(customThemes);
      if (activeKey === key) {
        applyTheme('dark-slate', true);
      } else {
        syncThemeCustomizerUI(activeKey);
      }
      showToast(`Deleted theme "${theme.name}"`);
    });
    top.appendChild(delBtn);
  }

  const swatches = document.createElement('div');
  swatches.className = 'theme-preset-swatches';

  // Preview key colors
  const previewColors = [
    theme.vars["--bg-base"] || "#000",
    theme.vars["--bg-card"] || "#222",
    theme.vars["--primary"] || "#3b82f6",
    theme.vars["--accent"] || "#8b5cf6",
    theme.vars["--success"] || "#10b981"
  ];

  previewColors.forEach(col => {
    const sw = document.createElement('div');
    sw.className = 'theme-preset-swatch';
    sw.style.backgroundColor = col;
    swatches.appendChild(sw);
  });

  card.appendChild(top);
  card.appendChild(swatches);

  card.addEventListener('click', () => {
    applyTheme(key, true);
  });

  return card;
}

function syncThemeCustomizerUI(themeKey) {
  const allThemes = getAllThemes();
  const presetsGallery = document.getElementById('theme-presets-gallery');
  const customSection = document.getElementById('custom-themes-section');
  const customGallery = document.getElementById('custom-themes-gallery');

  if (presetsGallery) {
    presetsGallery.innerHTML = '';
    // Render Built-in Themes
    for (const [key, t] of Object.entries(allThemes)) {
      if (t.builtin) {
        presetsGallery.appendChild(renderPresetCard(key, t, themeKey));
      }
    }
  }

  if (customGallery && customSection) {
    customGallery.innerHTML = '';
    let customCount = 0;
    for (const [key, t] of Object.entries(allThemes)) {
      if (!t.builtin) {
        customGallery.appendChild(renderPresetCard(key, t, themeKey));
        customCount++;
      }
    }
    customSection.style.display = customCount > 0 ? 'flex' : 'none';
  }

  // Update color inputs from current computed style
  const compStyle = getComputedStyle(document.documentElement);
  document.querySelectorAll('.color-picker-wrapper').forEach(wrapper => {
    const colorInput = wrapper.querySelector('input[type="color"]');
    const hexInput = wrapper.querySelector('.color-hex-text');
    const cssVar = colorInput.dataset.var;
    const computedVal = compStyle.getPropertyValue(cssVar).trim();

    if (computedVal.startsWith('#')) {
      colorInput.value = computedVal;
      hexInput.value = computedVal;
    } else {
      // Convert rgb / rgba to hex if needed
      const rgbMatch = computedVal.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      if (rgbMatch) {
        const hex = "#" + [1, 2, 3].map(i => parseInt(rgbMatch[i], 10).toString(16).padStart(2, '0')).join('');
        colorInput.value = hex;
        hexInput.value = hex;
      }
    }
  });
}

function openThemeModal() {
  const activeKey = localStorage.getItem(THEME_STORAGE_KEY) || 'dark-slate';
  syncThemeCustomizerUI(activeKey);
  document.getElementById('theme-modal').classList.add('open');
}

function closeThemeModal() {
  document.getElementById('theme-modal').classList.remove('open');
}

// ========================================================
// Settings & Update Checker
// ========================================================
let cachedAppVersion = 'v1.0.0';
let cachedGithubRepo = 'PlasmaDrifter/podman-systemd-dashboard';
let isCheckingUpdate = false;

function openSettingsModal() {
  document.getElementById('settings-modal').classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('open');
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok') {
      const settings = data.settings || {};
      cachedAppVersion = data.app_version || 'v1.0.0';
      cachedGithubRepo = data.github_repo || 'PlasmaDrifter/podman-systemd-dashboard';

      // 1. Apply toggle states
      const toggleGithub = document.getElementById('toggle-github-btn');
      if (toggleGithub) {
        toggleGithub.checked = settings.show_github_btn !== false;
      }
      const navGithub = document.getElementById('nav-github-link');
      if (navGithub) {
        navGithub.style.display = (settings.show_github_btn !== false) ? 'inline-flex' : 'none';
      }

      const toggleUpdates = document.getElementById('toggle-check-updates');
      if (toggleUpdates) {
        toggleUpdates.checked = settings.check_for_updates !== false;
      }

      const versionPill = document.getElementById('settings-current-version');
      if (versionPill) {
        versionPill.textContent = cachedAppVersion;
      }

      // 2. Apply update info
      applyUpdateInfo(data.update_info, cachedAppVersion, cachedGithubRepo);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function applyUpdateInfo(info, appVersion, repo) {
  const hasUpdate = info && info.has_update;
  const latestVersion = (info && info.latest_version) || appVersion;
  const releaseUrl = (info && info.release_url) || `https://github.com/${repo}/releases`;

  // Top Nav GitHub Icon Link & Pulse Badge
  const navGithub = document.getElementById('nav-github-link');
  const navUpdateBadge = document.getElementById('nav-update-badge');
  if (navGithub) {
    if (hasUpdate) {
      navGithub.classList.add('has-update');
      navGithub.href = releaseUrl;
      navGithub.title = `Update available (${latestVersion}) - Click to view release`;
      if (navUpdateBadge) navUpdateBadge.classList.remove('hidden');
    } else {
      navGithub.classList.remove('has-update');
      navGithub.href = `https://github.com/${repo}`;
      navGithub.title = `GitHub Repository (${appVersion})`;
      if (navUpdateBadge) navUpdateBadge.classList.add('hidden');
    }
  }

  // Settings Modal Update Badge & Description
  const settingsBadge = document.getElementById('settings-update-badge');
  const settingsDesc = document.getElementById('settings-update-desc');
  if (settingsBadge && settingsDesc) {
    if (hasUpdate) {
      settingsBadge.textContent = `New: ${latestVersion}`;
      settingsBadge.href = releaseUrl;
      settingsBadge.classList.remove('hidden');
      settingsDesc.textContent = `Update available: ${latestVersion} (Current: ${appVersion})`;
    } else {
      settingsBadge.classList.add('hidden');
      const checkEnabled = info ? info.check_enabled : true;
      settingsDesc.textContent = checkEnabled 
        ? `Automatically check GitHub releases (Current: ${appVersion})` 
        : `Update checks disabled (Current: ${appVersion})`;
    }
  }
}

async function updateAppSetting(payload) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Settings update failed');
    const data = await res.json();
    if (data.status === 'ok') {
      applyUpdateInfo(data.update_info, cachedAppVersion, cachedGithubRepo);
    }
  } catch (err) {
    console.error('Error saving setting:', err);
    showToast('Failed to update setting', 'error');
  }
}

async function triggerCheckUpdate(manual = false) {
  if (isCheckingUpdate) return;
  const btn = document.getElementById('btn-check-update-now');

  isCheckingUpdate = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking...';
  }

  try {
    const res = await fetch('/api/check-update', { method: 'POST' });
    if (!res.ok) throw new Error('Update check failed');
    const data = await res.json();
    if (data.status === 'ok' && data.update_info) {
      applyUpdateInfo(data.update_info, cachedAppVersion, cachedGithubRepo);
      if (manual) {
        if (data.update_info.has_update) {
          showToast(`Update available: ${data.update_info.latest_version}`);
        } else {
          showToast(`Dashboard is up to date (${cachedAppVersion})`);
        }
      }
    }
  } catch (err) {
    console.error('Error checking updates:', err);
    if (manual) showToast('Failed to check for updates', 'error');
  } finally {
    // 15-second debounce cooldown
    setTimeout(() => {
      isCheckingUpdate = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Check Now';
      }
    }, 15000);

    // If still in cooldown, indicate waiting briefly
    if (btn) {
      btn.textContent = 'Checked';
      setTimeout(() => {
        if (isCheckingUpdate && btn) btn.textContent = 'Cooling down...';
      }, 2000);
    }
  }
}

