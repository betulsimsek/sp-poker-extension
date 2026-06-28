const DB_URL = FIREBASE_CONFIG.databaseURL;
const FIBONACCI = ["0","1","2","3","5","8","13","21","?","☕"];

// ── REST helpers ──────────────────────────────────────────────────────────────
async function dbGet(path) {
  const res = await fetch(`${DB_URL}/${path}.json`);
  return res.json();
}
async function dbSet(path, data) {
  await fetch(`${DB_URL}/${path}.json`, {
    method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data),
  });
}
async function dbUpdate(path, data) {
  await fetch(`${DB_URL}/${path}.json`, {
    method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data),
  });
}
async function dbPush(path, data) {
  const res = await fetch(`${DB_URL}/${path}.json`, {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data),
  });
  const result = await res.json();
  return result.name;
}
async function dbDelete(path) {
  await fetch(`${DB_URL}/${path}.json`, { method: "DELETE" });
}

// SSE listener — fires callback with latest snapshot on every change
function dbListen(path, callback) {
  const source = new EventSource(`${DB_URL}/${path}.json`);
  let cache = null;

  function getAtPath(root, subPath) {
    if (!root || subPath === "/") return root;
    let cur = root;
    for (const part of subPath.replace(/^\//, "").split("/")) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[part];
    }
    return cur;
  }

  function applyAtPath(root, subPath, value) {
    if (subPath === "/") return value;
    const parts = subPath.replace(/^\//, "").split("/");
    const out = root ? { ...root } : {};
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] ? { ...cur[parts[i]] } : {};
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete cur[last];
    else cur[last] = value;
    return out;
  }

  source.addEventListener("put", (e) => {
    const { path: subPath, data } = JSON.parse(e.data);
    cache = applyAtPath(cache, subPath, data);
    callback(cache);
  });

  source.addEventListener("patch", (e) => {
    const { path: subPath, data } = JSON.parse(e.data);
    if (subPath === "/") {
      // Root-level patch: merge into existing cache
      cache = Object.assign({}, cache || {}, data);
    } else {
      // Sub-path patch: merge with existing value at that path (preserves sibling keys)
      const existing = getAtPath(cache, subPath);
      const merged = (existing != null && typeof existing === "object")
        ? Object.assign({}, existing, data)
        : data;
      cache = applyAtPath(cache, subPath, merged);
    }
    callback(cache);
  });

  return source;
}

// ── State ─────────────────────────────────────────────────────────────────────
let S = {
  role: null, roomCode: null, myName: null, myId: null,
  selectedSP: null, myVote: null, activeTaskId: null, activeTaskNote: null, votingStartedAt: null,
};
let activeSource = null;
let timerInterval = null;

// ── Timer ─────────────────────────────────────────────────────────────────────
function fmtTimer(ms) {
  const t = Math.floor(ms / 1000), m = Math.floor(t / 60), s = t % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function startTimer(startedAt) {
  clearInterval(timerInterval);
  const tick = () => {
    const el = document.getElementById("timer-display");
    if (el) el.textContent = fmtTimer(Date.now() - startedAt);
  };
  const el = document.getElementById("timer-display");
  if (el) el.classList.remove("hidden");
  tick();
  timerInterval = setInterval(tick, 500);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const el = document.getElementById("timer-display");
  if (el) el.classList.add("hidden");
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}

function initials(name) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function stopListener() {
  if (activeSource) { activeSource.close(); activeSource = null; }
}

function saveSession() {
  chrome.storage.local.set({ spSession: { ...S } });
}

function clearSession() {
  stopListener();
  stopTimer();
  S = { role: null, roomCode: null, myName: null, myId: null,
        selectedSP: null, myVote: null, activeTaskId: null, votingStartedAt: null };
  chrome.storage.local.remove("spSession");
}

// ── Vote stats ────────────────────────────────────────────────────────────────
function getVoteStats(votesObj) {
  const votes = Object.values(votesObj || {});
  const nums = votes.map(v => parseFloat(v.value)).filter(n => !isNaN(n));
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  const fibNums = [0, 1, 2, 3, 5, 8, 13, 21];
  let suggested = "?";
  if (avg !== null) {
    let best = fibNums[0];
    fibNums.forEach(f => { if (Math.abs(f - avg) < Math.abs(best - avg)) best = f; });
    suggested = String(best);
  }
  const consensus = votes.length > 0 && new Set(votes.map(v => v.value)).size === 1;
  const lo = nums.length >= 2 ? Math.min(...nums) : null;
  const hi = nums.length >= 2 ? Math.max(...nums) : null;
  return { avg, suggested, consensus, lo, hi };
}

// ── Roster chips ──────────────────────────────────────────────────────────────
function renderRoster(participantsObj, votesObj, rosterId, legendId, phase) {
  const container = document.getElementById(rosterId);
  if (!container) return;
  const participants = Object.entries(participantsObj || {});
  const votes = Object.values(votesObj || {});
  const voteByPid = {};
  votes.forEach(v => { voteByPid[v.voterId] = v.value; });

  const { lo, hi } = getVoteStats(votesObj);

  const chips = participants.map(([id, p]) => {
    const hasVoted = id in voteByPid;
    const val = voteByPid[id];
    let statusEl = "";
    if (phase === "voting") {
      statusEl = hasVoted
        ? `<span class="pcard down">✓</span>`
        : `<span class="pcard empty"></span>`;
    } else if (phase === "revealed") {
      const num = parseFloat(val);
      let cls = "pcard";
      if (lo !== null && !isNaN(num) && num === lo && lo !== hi) cls += " lo";
      if (hi !== null && !isNaN(num) && num === hi && lo !== hi) cls += " hi";
      statusEl = `<span class="${cls}">${val !== undefined ? val : "—"}</span>`;
    }
    return `<div class="chip"><span class="ava">${initials(p.name)}</span><span>${p.name}</span>${statusEl}</div>`;
  }).join("");

  container.innerHTML = chips;

  if (legendId) {
    const legendEl = document.getElementById(legendId);
    if (legendEl) legendEl.classList.toggle("hidden", phase !== "revealed" || lo === null || lo === hi);
  }
}

// ── Stat bar ──────────────────────────────────────────────────────────────────
function updateStatBar(historyObj) {
  const items = Object.values(historyObj || {});
  const totalSP = items.reduce((a, h) => a + (parseFloat(h.sp) || 0), 0);
  const durations = items.map(h => h.duration).filter(d => d != null && d > 0);
  const avgTime = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const elN = document.getElementById("stat-count");
  const elSP = document.getElementById("stat-sp");
  const elT = document.getElementById("stat-time");
  if (elN) elN.textContent = items.length;
  if (elSP) elSP.textContent = totalSP;
  if (elT) elT.textContent = avgTime ? fmtTimer(avgTime * 1000) : "—";
}

// ── Decrypt a room snapshot in place (participants, votes, history, active task/note) ─
async function decryptRoom(roomCode, room) {
  if (!room) return room;
  room.activeTask = await decryptField(roomCode, room.activeTask);
  room.activeTaskNote = await decryptField(roomCode, room.activeTaskNote);
  if (room.participants) {
    for (const p of Object.values(room.participants)) {
      p.name = await decryptField(roomCode, p.name);
    }
  }
  if (room.votes) {
    for (const v of Object.values(room.votes)) {
      v.voterName = await decryptField(roomCode, v.voterName);
    }
  }
  if (room.history) {
    for (const h of Object.values(room.history)) {
      h.taskId = await decryptField(roomCode, h.taskId);
      h.note = await decryptField(roomCode, h.note);
    }
  }
  return room;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function setStatusBadge(status) {
  const el = document.getElementById("room-status-badge");
  if (!el) return;
  const map = {
    idle:      { text: chrome.i18n.getMessage("statusWaiting"),   bg: "var(--surface2)", color: "var(--muted)" },
    voting:    { text: chrome.i18n.getMessage("statusVoting"),    bg: "var(--info-bg)",  color: "var(--info)" },
    revealed:  { text: chrome.i18n.getMessage("statusRevealed"),  bg: "var(--ok-bg)",    color: "var(--ok)" },
    completed: { text: chrome.i18n.getMessage("statusCompleted"), bg: "var(--ok-bg)",    color: "var(--ok)" },
  };
  const s = map[status] || map.idle;
  el.textContent = s.text;
  el.style.background = s.bg;
  el.style.color = s.color;
}

// ── Home ──────────────────────────────────────────────────────────────────────
document.getElementById("btn-create-room").addEventListener("click", async () => {
  const name = document.getElementById("input-name").value.trim();
  if (!name) return showError("home-error", chrome.i18n.getMessage("errorEnterName"));

  const code = generateRoomCode();
  await dbSet(`rooms/${code}`, {
    code, createdAt: Date.now(), status: "idle", activeTask: null, participants: {},
  });
  const encName = await encryptField(code, name);
  const newKey = await dbPush(`rooms/${code}/participants`, { name: encName, joinedAt: Date.now(), isHost: true });
  S.role = "creator"; S.roomCode = code; S.myName = name; S.myId = newKey;
  saveSession();
  enterCreatorScreen();
});

document.getElementById("btn-join-room").addEventListener("click", async () => {
  const code = document.getElementById("input-join-code").value.trim().toUpperCase();
  const name = document.getElementById("input-name").value.trim();
  if (!code || code.length !== 6) return showError("home-error", chrome.i18n.getMessage("errorEnterRoomCode"));
  if (!name) return showError("home-error", chrome.i18n.getMessage("errorEnterName"));
  const room = await dbGet(`rooms/${code}`);
  if (!room) return showError("home-error", chrome.i18n.getMessage("errorRoomNotFound"));
  const encName = await encryptField(code, name);
  const newKey = await dbPush(`rooms/${code}/participants`, { name: encName, joinedAt: Date.now(), voted: false });
  S.role = "participant"; S.roomCode = code; S.myName = name; S.myId = newKey;
  saveSession();
  enterParticipantScreen();
});

// ── Creator Screen ────────────────────────────────────────────────────────────
function enterCreatorScreen() {
  showScreen("screen-creator");
  document.getElementById("creator-room-code").textContent = S.roomCode;

  document.getElementById("btn-copy-code").onclick = () =>
    navigator.clipboard.writeText(S.roomCode);

  const creatorGrid = document.getElementById("fibonacci-grid-creator");
  creatorGrid.innerHTML = "";
  FIBONACCI.forEach(val => {
    const card = document.createElement("div");
    card.className = "fib-card";
    card.textContent = val;
    card.onclick = () => castVote(String(val), card, "creator");
    creatorGrid.appendChild(card);
  });

  document.getElementById("btn-change-vote-creator").onclick = () => {
    document.getElementById("my-vote-display-creator").classList.add("hidden");
    document.querySelectorAll("#fibonacci-grid-creator .fib-card").forEach(c => c.classList.remove("selected"));
    S.myVote = null;
  };

  document.getElementById("btn-leave-creator").onclick = async () => {
    if (confirm(chrome.i18n.getMessage("confirmCloseRoom"))) {
      await dbDelete(`rooms/${S.roomCode}`);
      clearSession();
      showScreen("screen-home");
    }
  };

  document.getElementById("btn-start-voting").onclick = async () => {
    const taskId = document.getElementById("input-task-id").value.trim();
    if (!taskId) return;
    const note = document.getElementById("input-task-note").value.trim();
    S.myVote = null;
    S.activeTaskNote = note || null;
    S.votingStartedAt = Date.now();
    document.querySelectorAll("#fibonacci-grid-creator .fib-card").forEach(c => c.classList.remove("selected"));
    document.getElementById("my-vote-display-creator").classList.add("hidden");
    await dbDelete(`rooms/${S.roomCode}/votes`);
    const encTaskId = await encryptField(S.roomCode, taskId);
    const encNote = note ? await encryptField(S.roomCode, note) : null;
    await dbUpdate(`rooms/${S.roomCode}`, {
      status: "voting", activeTask: encTaskId, activeTaskNote: encNote,
      confirmedSP: null, votingStartedAt: S.votingStartedAt,
    });
    document.getElementById("input-task-id").value = "";
    document.getElementById("input-task-note").value = "";
  };

  document.getElementById("btn-reveal").onclick = async () => {
    stopTimer();
    const textareaNote = document.getElementById("creator-task-note-edit").value.trim();
    S.activeTaskNote = textareaNote || S.activeTaskNote || null;
    const encNote = S.activeTaskNote ? await encryptField(S.roomCode, S.activeTaskNote) : null;
    await dbUpdate(`rooms/${S.roomCode}`, { status: "revealed", activeTaskNote: encNote });
  };

  document.getElementById("btn-cancel-voting").onclick = async () => {
    stopTimer();
    S.votingStartedAt = null;
    await dbUpdate(`rooms/${S.roomCode}`, { status: "idle", activeTask: null });
    await dbDelete(`rooms/${S.roomCode}/votes`);
  };


  document.getElementById("btn-confirm-sp").onclick = async () => {
    if (!S.selectedSP) {
      const sel = document.querySelector("#sp-options .sp-option.selected");
      if (sel) S.selectedSP = sel.textContent.trim();
    }
    if (!S.selectedSP) { showError("home-error", chrome.i18n.getMessage("errorPickSp")); return; }
    if (!S.activeTaskId) { showError("home-error", chrome.i18n.getMessage("errorNoActiveTask")); return; }
    const btn = document.getElementById("btn-confirm-sp");
    btn.disabled = true;
    btn.textContent = chrome.i18n.getMessage("btnSaving");
    const key = S.activeTaskId.replace(/[.#$/\[\]]/g, "_");
    const duration = S.votingStartedAt ? Math.round((Date.now() - S.votingStartedAt) / 1000) : null;
    const encTaskId = await encryptField(S.roomCode, S.activeTaskId);
    const encNote = S.activeTaskNote ? await encryptField(S.roomCode, S.activeTaskNote) : null;
    const historyEntry = { taskId: encTaskId, sp: S.selectedSP, completedAt: Date.now(), duration, note: encNote };
    await dbUpdate(`rooms/${S.roomCode}/history`, { [key]: historyEntry });
    await dbUpdate(`rooms/${S.roomCode}`, { status: "completed", confirmedSP: S.selectedSP });
    S.selectedSP = null;
    S.myVote = null;
    S.votingStartedAt = null;
    btn.disabled = false;
    btn.textContent = chrome.i18n.getMessage("btnConfirmSp");
  };

  stopListener();
  activeSource = dbListen(`rooms/${S.roomCode}`, async (room) => {
    if (!room) return;
    room = await decryptRoom(S.roomCode, room);
    const participants = room.participants ? Object.values(room.participants) : [];
    document.getElementById("participant-count").textContent = chrome.i18n.getMessage("participantCount", [String(participants.length)]);
    setStatusBadge(room.status);
    updateStatBar(room.history);

    if (room.status === "voting" && room.activeTask) {
      if (S.activeTaskId !== room.activeTask) {
        S.myVote = null;
        document.querySelectorAll("#fibonacci-grid-creator .fib-card").forEach(c => c.classList.remove("selected"));
        document.getElementById("my-vote-display-creator").classList.add("hidden");
      }
      S.activeTaskId = room.activeTask;
      S.activeTaskNote = room.activeTaskNote || null;
      if (room.votingStartedAt && !timerInterval) startTimer(room.votingStartedAt);

      showCreatorState("voting");
      document.getElementById("creator-active-task").textContent = room.activeTask;
      const creatorNoteEdit = document.getElementById("creator-task-note-edit");
      if (creatorNoteEdit && creatorNoteEdit !== document.activeElement) {
        creatorNoteEdit.value = room.activeTaskNote || "";
      }

      const votes = room.votes ? Object.values(room.votes) : [];
      const votedNames = votes.map(v => v.voterName);
      document.getElementById("vote-count-display").textContent = chrome.i18n.getMessage("voteCount", [String(votes.length), String(participants.length)]);

      const myVoteEntry = votes.find(v => v.voterId === S.myId);
      if (myVoteEntry && myVoteEntry.value !== S.myVote) {
        S.myVote = myVoteEntry.value;
        document.querySelectorAll("#fibonacci-grid-creator .fib-card").forEach(c =>
          c.classList.toggle("selected", c.textContent === String(myVoteEntry.value)));
        document.getElementById("my-vote-value-creator").textContent = myVoteEntry.value;
        document.getElementById("my-vote-display-creator").classList.remove("hidden");
      }

      const avatarContainer = document.getElementById("vote-avatars");
      avatarContainer.innerHTML = "";
      participants.forEach(p => {
        const div = document.createElement("div");
        div.className = "vote-avatar" + (votedNames.includes(p.name) ? " voted" : "");
        div.textContent = initials(p.name);
        div.title = p.name;
        avatarContainer.appendChild(div);
      });

      renderRoster(room.participants, room.votes, "creator-roster", null, "voting");

    } else if (room.status === "revealed") {
      stopTimer();
      S.activeTaskId = room.activeTask;
      S.activeTaskNote = room.activeTaskNote || null;
      showCreatorState("results");
      document.getElementById("creator-results-task").textContent = room.activeTask;
      const creatorResultsNote = document.getElementById("creator-results-note");
      if (creatorResultsNote) { creatorResultsNote.textContent = room.activeTaskNote || ""; creatorResultsNote.classList.toggle("hidden", !room.activeTaskNote); }
      renderResults(
        room.votes || {}, "results-grid", "sp-options",
        "creator-avg", "creator-suggested", "creator-result-banner", "creator-consensus-badge"
      );
      renderRoster(room.participants, room.votes, "creator-roster-revealed", "roster-legend-results", "revealed");

    } else {
      stopTimer();
      showCreatorState("idle");
      renderHistory(room.history || {});
    }
  });
}

function showCreatorState(s) {
  ["idle", "voting", "results"].forEach(n =>
    document.getElementById(`creator-state-${n}`).classList.toggle("hidden", n !== s));
}

// ── Participant Screen ────────────────────────────────────────────────────────
function enterParticipantScreen() {
  showScreen("screen-participant");
  document.getElementById("participant-room-code").textContent = S.roomCode;
  document.getElementById("participant-name-display").textContent = S.myName;

  document.getElementById("btn-leave-participant").onclick = async () => {
    await dbDelete(`rooms/${S.roomCode}/participants/${S.myId}`);
    clearSession();
    showScreen("screen-home");
  };

  buildFibonacciGrid();

  stopListener();
  activeSource = dbListen(`rooms/${S.roomCode}`, async (room) => {
    if (!room) return;
    room = await decryptRoom(S.roomCode, room);

    if (room.status === "idle") {
      S.myVote = null;
      showParticipantState("waiting");

    } else if (room.status === "completed") {
      showParticipantState("completed");
      document.getElementById("participant-completed-task").textContent = room.activeTask || "";
      document.getElementById("participant-completed-sp").textContent = room.confirmedSP || "–";
      const completedNote = document.getElementById("participant-completed-note");
      if (completedNote) { completedNote.textContent = room.activeTaskNote || ""; completedNote.classList.toggle("hidden", !room.activeTaskNote); }
      renderResults(room.votes || {}, "participant-completed-grid", null, null, null, null, null);
      renderParticipantHistory(room.history || {});

    } else if (room.status === "voting" && room.activeTask) {
      S.activeTaskId = room.activeTask;
      document.getElementById("participant-active-task").textContent = room.activeTask;
      const pNote = document.getElementById("participant-task-note");
      if (pNote) { pNote.textContent = room.activeTaskNote || ""; pNote.classList.toggle("hidden", !room.activeTaskNote); }
      const myVoteEntry = room.votes
        ? Object.values(room.votes).find(v => v.voterId === S.myId) : null;
      if (myVoteEntry) {
        S.myVote = myVoteEntry.value;
        document.getElementById("participant-voted-task").textContent = room.activeTask;
        showParticipantState("voted");
      } else {
        showParticipantState("voting");
        document.querySelectorAll(".fib-card").forEach(c => c.classList.remove("selected"));
        document.getElementById("my-vote-display").classList.add("hidden");
      }

    } else if (room.status === "revealed") {
      showParticipantState("results");
      document.getElementById("participant-results-task").textContent = room.activeTask;
      const participantResultsNote = document.getElementById("participant-results-note");
      if (participantResultsNote) { participantResultsNote.textContent = room.activeTaskNote || ""; participantResultsNote.classList.toggle("hidden", !room.activeTaskNote); }
      renderResults(
        room.votes || {}, "participant-results-grid", null,
        "participant-avg", "participant-suggested", "participant-result-banner", null
      );
      document.getElementById("final-sp-display").classList.add("hidden");
      if (room.history && S.activeTaskId) {
        const key = S.activeTaskId.replace(/[.#$/\[\]]/g, "_");
        const entry = room.history[key];
        if (entry) {
          document.getElementById("final-sp-value").textContent = entry.sp;
          document.getElementById("final-sp-display").classList.remove("hidden");
        }
      }
    }
  });
}

function showParticipantState(s) {
  ["waiting", "voting", "voted", "results", "completed"].forEach(n =>
    document.getElementById(`participant-state-${n}`).classList.toggle("hidden", n !== s));
}

function buildFibonacciGrid() {
  const grid = document.getElementById("fibonacci-grid");
  grid.innerHTML = "";
  FIBONACCI.forEach(val => {
    const card = document.createElement("div");
    card.className = "fib-card";
    card.textContent = val;
    card.onclick = () => castVote(String(val), card, "participant");
    grid.appendChild(card);
  });
  document.getElementById("btn-change-vote").onclick = () => {
    document.getElementById("my-vote-display").classList.add("hidden");
    document.querySelectorAll(".fib-card").forEach(c => c.classList.remove("selected"));
    S.myVote = null;
  };
}

async function castVote(value, card, who) {
  if (!S.activeTaskId) return;
  const votes = await dbGet(`rooms/${S.roomCode}/votes`);
  if (votes) {
    const mine = Object.entries(votes).find(([, v]) => v.voterId === S.myId);
    if (mine) await dbDelete(`rooms/${S.roomCode}/votes/${mine[0]}`);
  }
  const encVoterName = await encryptField(S.roomCode, S.myName);
  await dbPush(`rooms/${S.roomCode}/votes`, {
    voterId: S.myId, voterName: encVoterName, value, votedAt: Date.now(),
  });
  S.myVote = value;
  if (who === "creator") {
    document.querySelectorAll("#fibonacci-grid-creator .fib-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    document.getElementById("my-vote-value-creator").textContent = value;
    document.getElementById("my-vote-display-creator").classList.remove("hidden");
  } else {
    document.querySelectorAll("#fibonacci-grid .fib-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    document.getElementById("my-vote-value").textContent = value;
    document.getElementById("my-vote-display").classList.remove("hidden");
  }
}

// ── Results & history ─────────────────────────────────────────────────────────
function renderResults(votesObj, gridId, spOptionsId, avgId, suggestedId, bannerId, badgeId) {
  const votes = Object.values(votesObj);
  const tally = {};
  const votersByValue = {};
  votes.forEach(v => {
    const val = String(v.value);
    tally[val] = (tally[val] || 0) + 1;
    (votersByValue[val] = votersByValue[val] || []).push(v.voterName);
  });
  const max = Math.max(...Object.values(tally), 1);
  const order = FIBONACCI.map(String);
  const sorted = Object.entries(tally).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));

  const grid = document.getElementById(gridId);
  if (grid) {
    grid.innerHTML = "";
    sorted.forEach(([val, count]) => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <span class="result-sp">${val}</span>
        <div class="result-bar-bg"><div class="result-bar-fg" style="width:${(count/max)*100}%"></div></div>
        <span class="result-voters">${votersByValue[val].join(", ")} (${count})</span>`;
      grid.appendChild(row);
    });
  }

  const stats = getVoteStats(votesObj);

  if (avgId) {
    const el = document.getElementById(avgId);
    if (el) el.textContent = stats.avg !== null ? stats.avg.toFixed(1) : "—";
  }
  if (suggestedId) {
    const el = document.getElementById(suggestedId);
    if (el) el.textContent = stats.suggested;
  }

  if (bannerId) {
    const el = document.getElementById(bannerId);
    if (el) {
      el.className = "hidden";
      if (votes.length > 0) {
        if (stats.consensus) {
          el.className = "banner ok";
          el.textContent = chrome.i18n.getMessage("consensusFullBanner");
        } else {
          const spread = (stats.lo !== null && stats.hi !== null) ? stats.hi - stats.lo : 0;
          if (spread > 3) {
            el.className = "banner warn";
            el.textContent = chrome.i18n.getMessage("spreadWarnBanner", [String(stats.lo), String(stats.hi)]);
          }
        }
      }
    }
  }

  if (badgeId) {
    const el = document.getElementById(badgeId);
    if (el) {
      if (stats.consensus && votes.length > 0) {
        el.textContent = chrome.i18n.getMessage("badgeConsensus");
        el.style.background = "var(--ok-bg)";
        el.style.color = "var(--ok)";
        el.classList.remove("hidden");
      } else if (votes.length > 0) {
        el.textContent = chrome.i18n.getMessage("badgeDiscussion");
        el.style.background = "var(--warn-bg)";
        el.style.color = "var(--warn)";
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
  }

  if (spOptionsId) {
    const spOptions = document.getElementById(spOptionsId);
    if (spOptions) {
      spOptions.innerHTML = "";
      FIBONACCI.forEach(val => {
        const btn = document.createElement("button");
        btn.className = "sp-option";
        btn.textContent = val;
        btn.onclick = () => {
          S.selectedSP = String(val);
          spOptions.querySelectorAll(".sp-option").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
        };
        spOptions.appendChild(btn);
      });
      if (sorted.length > 0) {
        const topByVote = sorted.reduce((a, b) => b[1] > a[1] ? b : a)[0];
        const pick = stats.suggested !== "?" ? stats.suggested : topByVote;
        S.selectedSP = pick;
        spOptions.querySelectorAll(".sp-option").forEach(b =>
          b.classList.toggle("selected", b.textContent.trim() === pick));
      }
    }
  }
}

function renderParticipantHistory(historyObj) {
  const items = Object.values(historyObj);
  const container = document.getElementById("participant-completed-history");
  const list = document.getElementById("participant-completed-history-list");
  if (!items.length) { container.classList.add("hidden"); return; }
  container.classList.remove("hidden");
  list.innerHTML = "";
  items.slice().reverse().forEach(item => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = `<span>${item.taskId}</span><span class="history-sp">${item.sp} SP</span>`;
    if (item.note) {
      const noteEl = document.createElement("div");
      noteEl.className = "history-note";
      noteEl.textContent = item.note;
      row.appendChild(noteEl);
    }
    list.appendChild(row);
  });
}

function renderHistory(historyObj) {
  const items = Object.values(historyObj);
  const container = document.getElementById("task-history");
  const list = document.getElementById("task-history-list");
  if (!items.length) { container.classList.add("hidden"); return; }
  container.classList.remove("hidden");
  list.innerHTML = "";
  items.slice().reverse().forEach(item => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = `<span>${item.taskId}</span><span class="history-sp">${item.sp} SP</span>`;
    if (item.note) {
      const noteEl = document.createElement("div");
      noteEl.className = "history-note";
      noteEl.textContent = item.note;
      row.appendChild(noteEl);
    }
    list.appendChild(row);
  });
}

// ── Boot: restore session ─────────────────────────────────────────────────────
chrome.storage.local.get("spSession", ({ spSession }) => {
  if (spSession && spSession.roomCode) {
    Object.assign(S, spSession);
    if (S.role === "creator") enterCreatorScreen();
    else if (S.role === "participant") enterParticipantScreen();
    else showScreen("screen-home");
  } else {
    showScreen("screen-home");
  }
});
