const APP_STORAGE_KEY = "stock-weekly-contest-app-v2";
const LEGACY_STORAGE_KEY = "stock-weekly-contest-week-1-v1";

const fileState = window.STOCK_CONTEST_DATA || {};
const firstWeekEntries = Array.isArray(fileState.entries) ? structuredClone(fileState.entries) : [];

const els = {
  rankingBody: document.querySelector("#rankingBody"),
  emptyRanking: document.querySelector("#emptyRanking"),
  settleList: document.querySelector("#settleList"),
  settleTemplate: document.querySelector("#settleTemplate"),
  entryForm: document.querySelector("#entryForm"),
  submitMessage: document.querySelector("#submitMessage"),
  settleAll: document.querySelector("#settleAll"),
  archiveWeek: document.querySelector("#archiveWeek"),
  newWeek: document.querySelector("#newWeek"),
  resetDemo: document.querySelector("#resetDemo"),
  reloadFileData: document.querySelector("#reloadFileData"),
  dataUpdatedAt: document.querySelector("#dataUpdatedAt"),
  statEntries: document.querySelector("#statEntries"),
  statValid: document.querySelector("#statValid"),
  statLeader: document.querySelector("#statLeader"),
  statBest: document.querySelector("#statBest"),
  currentWeekTitle: document.querySelector("#currentWeekTitle"),
  podiumBoard: document.querySelector("#podiumBoard"),
  weekLabelInput: document.querySelector("#weekLabelInput"),
  historyList: document.querySelector("#historyList"),
  emptyHistory: document.querySelector("#emptyHistory"),
};

let state = loadState();

function makeInitialState(entries = firstWeekEntries) {
  return {
    currentWeekLabel: fileState.currentWeekLabel || "第一周",
    entries: structuredClone(entries),
    history: Array.isArray(fileState.history) ? structuredClone(fileState.history) : [],
    dataVersion: fileState.version || "",
    dataUpdatedAt: fileState.updatedAt || "",
  };
}

function normalizeState(value) {
  return {
    currentWeekLabel: value.currentWeekLabel || fileState.currentWeekLabel || "第一周",
    entries: Array.isArray(value.entries) ? value.entries : structuredClone(firstWeekEntries),
    history: Array.isArray(value.history) ? value.history : structuredClone(fileState.history || []),
    dataVersion: value.dataVersion || fileState.version || "",
    dataUpdatedAt: value.dataUpdatedAt || fileState.updatedAt || "",
  };
}

function loadState() {
  const saved = localStorage.getItem(APP_STORAGE_KEY);
  if (saved) {
    try {
      return normalizeState(JSON.parse(saved));
    } catch {
      return makeInitialState();
    }
  }

  const legacyEntries = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyEntries) {
    try {
      const parsed = JSON.parse(legacyEntries);
      if (Array.isArray(parsed)) return makeInitialState(parsed);
    } catch {
      return makeInitialState();
    }
  }

  return makeInitialState();
}

function saveState() {
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
}

function replaceStateFromFile() {
  state = makeInitialState();
  saveState();
  renderAll();
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "--";
  return Number(value).toFixed(2);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function calculateReturn(entry) {
  const mondayOpen = Number(entry.mondayOpen);
  const fridayClose = Number(entry.fridayClose);

  if (entry.invalid) return null;
  if (entry.mondayLimitUp) return 0;
  if (!Number.isFinite(mondayOpen) || !Number.isFinite(fridayClose)) return null;
  if (mondayOpen <= 0 || fridayClose <= 0) return null;

  return ((fridayClose - mondayOpen) / mondayOpen) * 100;
}

function getRankedEntries(entries = state.entries) {
  return entries
    .map((entry) => ({ ...entry, returnRate: calculateReturn(entry) }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.returnRate);
      const bValid = Number.isFinite(b.returnRate);

      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (!aValid && !bValid) return new Date(a.submittedAt) - new Date(b.submittedAt);
      if (b.returnRate !== a.returnRate) return b.returnRate - a.returnRate;
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    });
}

function getValidRankedEntries(entries = state.entries) {
  return getRankedEntries(entries).filter((entry) => Number.isFinite(entry.returnRate));
}

function statusFor(entry) {
  if (entry.invalid) return { text: entry.note || "无效", tone: "bad" };
  if (entry.mondayLimitUp) return { text: "涨停记 0%", tone: "warn" };
  if (!Number.isFinite(entry.returnRate)) return { text: "待结算", tone: "idle" };
  return { text: "有效", tone: "good" };
}

function getHonorMap() {
  const honorMap = new Map();

  state.history.forEach((week) => {
    week.results
      .filter((result) => result.rank >= 1 && result.rank <= 3)
      .forEach((result) => {
        const key = result.playerName.trim();
        const current = honorMap.get(key) || { 1: 0, 2: 0, 3: 0 };
        current[result.rank] += 1;
        honorMap.set(key, current);
      });
  });

  return honorMap;
}

function renderPlayerName(playerName) {
  const honors = getHonorMap().get(playerName.trim());
  const badges = [];

  if (honors?.[1]) badges.push(`<span class="honor honor-1" title="历史冠军">🥇${honors[1] > 1 ? `×${honors[1]}` : ""}</span>`);
  if (honors?.[2]) badges.push(`<span class="honor honor-2" title="历史亚军">🥈${honors[2] > 1 ? `×${honors[2]}` : ""}</span>`);
  if (honors?.[3]) badges.push(`<span class="honor honor-3" title="历史季军">🥉${honors[3] > 1 ? `×${honors[3]}` : ""}</span>`);

  return `<span class="player-name">${escapeHtml(playerName)}${badges.join("")}</span>`;
}

function renderRanking() {
  if (!els.rankingBody) return;

  const ranked = getRankedEntries();
  const validRanked = ranked.filter((entry) => Number.isFinite(entry.returnRate));
  let rank = 0;

  els.rankingBody.innerHTML = "";

  ranked.forEach((entry) => {
    const valid = Number.isFinite(entry.returnRate);
    if (valid) rank += 1;

    const status = statusFor(entry);
    const tr = document.createElement("tr");
    tr.className = valid && rank <= 3 ? `rank-top rank-top-${rank}` : "";
    tr.innerHTML = `
      <td>${valid ? rank : "--"}</td>
      <td>${renderPlayerName(entry.playerName)}</td>
      <td>
        <strong>${escapeHtml(entry.stockName)}</strong>
        <small>${escapeHtml(entry.stockCode)}</small>
      </td>
      <td>${formatDateTime(entry.submittedAt)}</td>
      <td>${formatNumber(entry.mondayOpen)}</td>
      <td>${formatNumber(entry.fridayClose)}</td>
      <td class="${entry.returnRate > 0 ? "up" : entry.returnRate < 0 ? "down" : ""}">${formatPercent(entry.returnRate)}</td>
      <td><span class="status ${status.tone}">${escapeHtml(status.text)}</span></td>
    `;
    els.rankingBody.append(tr);
  });

  els.emptyRanking.hidden = state.entries.length > 0;
  if (els.statEntries) els.statEntries.textContent = state.entries.length;
  if (els.statValid) els.statValid.textContent = validRanked.length;
  if (els.statLeader) els.statLeader.innerHTML = validRanked[0] ? renderPlayerName(validRanked[0].playerName) : "--";
  if (els.statBest) els.statBest.textContent = validRanked[0] ? formatPercent(validRanked[0].returnRate) : "--";
}

function renderPodiumBoard() {
  if (!els.podiumBoard) return;

  const topThree = getValidRankedEntries().slice(0, 3);
  const labels = [
    { rank: 1, medal: "🥇", title: "冠军" },
    { rank: 2, medal: "🥈", title: "亚军" },
    { rank: 3, medal: "🥉", title: "季军" },
  ];

  els.podiumBoard.innerHTML = labels
    .map((slot) => {
      const entry = topThree[slot.rank - 1];
      if (!entry) {
        return `
          <article class="champion-card champion-card-${slot.rank} is-empty">
            <span class="champion-medal">${slot.medal}</span>
            <p>${slot.title}</p>
            <h3>待结算</h3>
            <small>录入价格后自动产生</small>
          </article>
        `;
      }

      return `
        <article class="champion-card champion-card-${slot.rank}">
          <span class="champion-medal">${slot.medal}</span>
          <p>${slot.title}</p>
          <h3>${renderPlayerName(entry.playerName)}</h3>
          <strong class="${entry.returnRate > 0 ? "up" : entry.returnRate < 0 ? "down" : ""}">${formatPercent(entry.returnRate)}</strong>
          <small>${escapeHtml(entry.stockName)} ${escapeHtml(entry.stockCode)}</small>
        </article>
      `;
    })
    .join("");
}

function renderSettleList() {
  if (!els.settleList || !els.settleTemplate) return;

  els.settleList.innerHTML = "";

  state.entries
    .slice()
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
    .forEach((entry) => {
      const node = els.settleTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.id = entry.id;
      node.querySelector("[data-field='title']").innerHTML = `${renderPlayerName(entry.playerName)} · ${escapeHtml(entry.stockName)} ${escapeHtml(entry.stockCode)}`;
      node.querySelector("[data-field='submitted']").textContent = `提交：${formatDateTime(entry.submittedAt)}`;

      const mondayOpen = node.querySelector("[data-input='mondayOpen']");
      const fridayClose = node.querySelector("[data-input='fridayClose']");
      const mondayLimitUp = node.querySelector("[data-input='mondayLimitUp']");
      const invalid = node.querySelector("[data-input='invalid']");
      const note = node.querySelector("[data-input='note']");

      mondayOpen.value = entry.mondayOpen || "";
      fridayClose.value = entry.fridayClose || "";
      mondayLimitUp.checked = Boolean(entry.mondayLimitUp);
      invalid.checked = Boolean(entry.invalid);
      note.value = entry.note || "";

      node.addEventListener("input", () => {
        updateEntry(entry.id, {
          mondayOpen: numberOrBlank(mondayOpen.value),
          fridayClose: numberOrBlank(fridayClose.value),
          mondayLimitUp: mondayLimitUp.checked,
          invalid: invalid.checked,
          note: note.value.trim(),
        });
      });

      els.settleList.append(node);
    });
}

function renderHistory() {
  if (!els.historyList || !els.emptyHistory) return;

  els.historyList.innerHTML = "";
  els.emptyHistory.hidden = state.history.length > 0;

  state.history
    .slice()
    .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt))
    .forEach((week) => {
      const article = document.createElement("article");
      article.className = "history-week";

      const rows = week.results
        .map((result) => `
          <tr class="${result.rank >= 1 && result.rank <= 3 ? `rank-top rank-top-${result.rank}` : ""}">
            <td>${result.rank || "--"}</td>
            <td>${renderPlayerName(result.playerName)}</td>
            <td>
              <strong>${escapeHtml(result.stockName)}</strong>
              <small>${escapeHtml(result.stockCode)}</small>
            </td>
            <td class="${result.returnRate > 0 ? "up" : result.returnRate < 0 ? "down" : ""}">${formatPercent(result.returnRate)}</td>
            <td>${escapeHtml(result.note || "")}</td>
          </tr>
        `)
        .join("");

      const topThree = week.results
        .filter((result) => result.rank >= 1 && result.rank <= 3)
        .map((result) => `<span class="podium podium-${result.rank}">${result.rank} ${renderPlayerName(result.playerName)} ${formatPercent(result.returnRate)}</span>`)
        .join("");

      article.innerHTML = `
        <div class="history-head">
          <div>
            <h3>${escapeHtml(week.weekLabel)}</h3>
            <p>保存于 ${formatDateTime(week.archivedAt)}</p>
          </div>
          <div class="podium-list">${topThree || "<span class=\"podium\">暂无前三名</span>"}</div>
        </div>
        <div class="table-shell history-table">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>选手</th>
                <th>股票</th>
                <th>收益率</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      els.historyList.append(article);
    });
}

function archiveCurrentWeek() {
  const validRanked = getValidRankedEntries();
  if (validRanked.length === 0) {
    alert("当前还没有可保存的有效排名。请先录入价格并结算。");
    return;
  }

  let rank = 0;
  const results = getRankedEntries()
    .map((entry) => ({ ...entry, returnRate: calculateReturn(entry) }))
    .map((entry) => {
      const valid = Number.isFinite(entry.returnRate);
      if (valid) rank += 1;
      const status = statusFor(entry);
      return {
        rank: valid ? rank : null,
        playerName: entry.playerName,
        stockCode: entry.stockCode,
        stockName: entry.stockName,
        submittedAt: entry.submittedAt,
        mondayOpen: entry.mondayOpen,
        fridayClose: entry.fridayClose,
        returnRate: entry.returnRate,
        note: entry.mondayLimitUp ? "周一开盘涨停，按 0% 计算" : entry.note || status.text,
      };
    });

  const archivedWeek = {
    id: slugify(state.currentWeekLabel),
    weekLabel: state.currentWeekLabel,
    archivedAt: new Date().toISOString(),
    results,
  };

  state.history = [
    archivedWeek,
    ...state.history.filter((week) => week.weekLabel !== state.currentWeekLabel),
  ];
  saveState();
  renderAll();
  window.location.href = "./index.html#history";
}

function startNewWeek() {
  if (!confirm("开启下一周会清空当前参赛列表。请先保存本周回溯，已经保存的历史不会丢失。确定继续吗？")) return;

  const nextLabel = inferNextWeekLabel(state.currentWeekLabel);
  state.currentWeekLabel = nextLabel;
  state.entries = [];
  saveState();
  renderAll();
  location.hash = "#submit";
}

function inferNextWeekLabel(label) {
  const match = String(label).match(/第([一二三四五六七八九十\d]+)周/);
  if (!match) return "下一周";
  const number = chineseOrNumberToNumber(match[1]);
  if (!number) return "下一周";
  return `第${numberToChinese(number + 1)}周`;
}

function chineseOrNumberToNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (map[value[1]] || 0);
  if (value.endsWith("十")) return (map[value[0]] || 1) * 10;
  if (value.includes("十")) return (map[value[0]] || 1) * 10 + (map[value[2]] || 0);
  return map[value] || 0;
}

function numberToChinese(number) {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (number <= 10) return number === 10 ? "十" : digits[number];
  if (number < 20) return `十${digits[number - 10]}`;
  if (number % 10 === 0) return `${digits[Math.floor(number / 10)]}十`;
  return `${digits[Math.floor(number / 10)]}十${digits[number % 10]}`;
}

function numberOrBlank(value) {
  if (value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function updateEntry(id, patch) {
  state.entries = state.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  saveState();
  renderRanking();
  renderPodiumBoard();
}

function addEntry(data) {
  state.entries = [
    ...state.entries,
    {
      id: crypto.randomUUID(),
      playerName: data.playerName.trim(),
      stockCode: data.stockCode.trim(),
      stockName: data.stockName.trim(),
      submittedAt: new Date().toISOString(),
      mondayOpen: "",
      fridayClose: "",
      mondayLimitUp: false,
      invalid: false,
      note: "",
    },
  ];
  saveState();
  renderAll();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value) {
  return String(value).trim().replace(/\s+/g, "-").toLowerCase() || `week-${Date.now()}`;
}

function renderAll() {
  if (els.currentWeekTitle) els.currentWeekTitle.textContent = state.currentWeekLabel;
  if (els.weekLabelInput) els.weekLabelInput.value = state.currentWeekLabel;
  if (els.dataUpdatedAt) {
    els.dataUpdatedAt.textContent = state.dataUpdatedAt ? `数据文件更新时间：${formatDateTime(state.dataUpdatedAt)}` : "数据文件尚未同步";
  }
  renderRanking();
  renderPodiumBoard();
  renderSettleList();
  renderHistory();
}

if (els.entryForm) {
  els.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(els.entryForm);
    const stockCode = String(form.get("stockCode") || "").trim();

    if (!/^\d{6}$/.test(stockCode)) {
      els.submitMessage.textContent = "股票代码需要是 6 位数字。";
      return;
    }

    addEntry({
      playerName: form.get("playerName"),
      stockCode,
      stockName: form.get("stockName"),
    });

    els.entryForm.reset();
    els.submitMessage.textContent = "提交成功，已进入管理员结算列表。";
  });
}

if (els.weekLabelInput) {
  els.weekLabelInput.addEventListener("input", () => {
    state.currentWeekLabel = els.weekLabelInput.value.trim() || "本周";
    saveState();
    renderRanking();
    if (els.currentWeekTitle) els.currentWeekTitle.textContent = state.currentWeekLabel;
  });
}

if (els.settleAll) {
  els.settleAll.addEventListener("click", () => {
    saveState();
    renderAll();
    window.location.href = "./index.html#ranking";
  });
}

if (els.archiveWeek) els.archiveWeek.addEventListener("click", archiveCurrentWeek);
if (els.newWeek) els.newWeek.addEventListener("click", startNewWeek);

if (els.resetDemo) {
  els.resetDemo.addEventListener("click", () => {
    state.currentWeekLabel = "第一周";
    state.entries = structuredClone(firstWeekEntries);
    saveState();
    renderAll();
  });
}

if (els.reloadFileData) {
  els.reloadFileData.addEventListener("click", () => {
    if (!confirm("这会用 data.js 覆盖浏览器本地数据。确定刷新吗？")) return;
    replaceStateFromFile();
  });
}

renderAll();
