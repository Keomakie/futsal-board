(() => {
  /*
   * 座標與 index.html 的 viewBox="-25 -25 450 250" 對齊。
   * 比賽區 40m × 20m，四邊各 2.5m。原點在紅隊球門線與上方邊線的交點。
   * u：0 紅隊球門 → 1 藍隊球門；v：0 → 1 沿場地寬度。
   */
  const VB = { x: -25, y: -25, w: 450, h: 250 };
  const FIELD = { x: 0, y: 0, w: 400, h: 200 };
  const RATIO = VB.w / VB.h;

  const TOOLS = {
    "move": { label: "移動：拖曳球員同足球" },
    "run-solid": { color: "#ffe14a", dashed: false, arrow: false, label: "黃實線：畫跑動路線" },
    "run-dashed": { color: "#ffe14a", dashed: true, arrow: false, label: "黃虛線：畫跑動路線" },
    "pass-solid": { color: "#ffffff", dashed: false, arrow: false, label: "白實線：畫傳球路線" },
    "pass-arrow": { color: "#ffffff", dashed: false, arrow: true, label: "白箭頭：畫傳球方向" }
  };

  const BALL_SVG = `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48" fill="#fbfbfb" stroke="#161616" stroke-width="3"/>
      <polygon fill="#161616" points="50,27 62,38 57,53 43,53 38,38"/>
      <g fill="none" stroke="#161616" stroke-width="2.6" stroke-linecap="round">
        <path d="M50 27 V8"/>
        <path d="M62 38 L81 29"/>
        <path d="M57 53 L75 69"/>
        <path d="M43 53 L25 69"/>
        <path d="M38 38 L19 29"/>
      </g>
    </svg>`;

  const FORMATIONS = {
    "2-2": [
      { num: "1", role: "守門員", u: 0.08, v: 0.5 },
      { num: "2", role: "左後衛", u: 0.26, v: 0.3 },
      { num: "3", role: "右後衛", u: 0.26, v: 0.7 },
      { num: "4", role: "左前鋒", u: 0.42, v: 0.3 },
      { num: "5", role: "右前鋒", u: 0.42, v: 0.7 }
    ],
    "1-2-1": [
      { num: "1", role: "守門員", u: 0.08, v: 0.5 },
      { num: "2", role: "後腰", u: 0.22, v: 0.5 },
      { num: "3", role: "左翼", u: 0.34, v: 0.24 },
      { num: "4", role: "右翼", u: 0.34, v: 0.76 },
      { num: "5", role: "前鋒", u: 0.42, v: 0.5 }
    ],
    "2-1-1": [
      { num: "1", role: "守門員", u: 0.08, v: 0.5 },
      { num: "2", role: "左後衛", u: 0.22, v: 0.28 },
      { num: "3", role: "右後衛", u: 0.22, v: 0.72 },
      { num: "4", role: "中場", u: 0.32, v: 0.5 },
      { num: "5", role: "前鋒", u: 0.42, v: 0.5 }
    ],
    "3-0-1": [
      { num: "1", role: "守門員", u: 0.08, v: 0.5 },
      { num: "2", role: "左後衛", u: 0.26, v: 0.22 },
      { num: "3", role: "中後衛", u: 0.24, v: 0.5 },
      { num: "4", role: "右後衛", u: 0.26, v: 0.78 },
      { num: "5", role: "前鋒", u: 0.42, v: 0.5 }
    ]
  };

  const pitch = document.getElementById("pitch");
  const markings = pitch.querySelector(".markings");
  const canvas = document.getElementById("draw-layer");
  const tokensEl = document.getElementById("tokens");
  const stage = document.querySelector(".stage");
  const appEl = document.querySelector(".app");
  const statusEl = document.getElementById("status");
  const ctx = canvas.getContext("2d");

  const formation = { red: "2-2", blue: "2-2" };
  const pieces = slotsFor(formation.red, formation.blue).map((item) => ({
    ...item,
    homeU: item.u,
    homeV: item.v,
    el: null
  }));

  let portrait = true;
  let penId = "run-solid";
  let toolId = "run-solid";
  let panelOpen = true;
  let strokes = [];
  let currentStroke = null;
  let drawing = false;
  let dragging = null;
  let dragDx = 0;
  let dragDy = 0;
  let activeTouchId = null;
  let mouseMode = false;
  let touchedAt = 0;
  let statusTimer = 0;
  let layoutFrame = 0;
  let laidOut = { w: 0, h: 0, portrait: null, dpr: 0 };
  let boxCache = null;
  let drawFrame = 0;
  let snapshotReady = false;
  let playing = false;
  let paused = false;
  let playClock = 0;
  let lastTick = 0;
  let animFrame = 0;
  let routes = null;
  let origins = null;
  let sameTime = false;
  let slowPlay = false;
  let holdStep = -1;
  let selectedStep = null;
  let reassignMode = false;
  let routineStart = null;
  let benched = {};
  let lastTokenTap = { id: null, t: 0 };
  const setCursors = { corner: 0, kickin: 0, penalty: 0, goalkick: 0 };
  const ROUTINE_KEY = "futsal-board-routines";
  const snapshot = document.createElement("canvas");
  const snapCtx = snapshot.getContext("2d");
  const STORE_KEY = "futsal-board-state";

  pieces.forEach(createToken);
  loadState();
  applyHomes("red");
  applyHomes("blue");
  bindTools();
  markFormationButtons();
  syncUndo();
  syncChrome();
  bindPointer();
  registerServiceWorker();
  layout();
  if (!routineStart) rememberStart();
  renderRoutines();
  renderBench();
  if (holdStep >= 0) showStep(holdStep);
  else syncStepUi();

  window.addEventListener("resize", requestLayout);
  window.addEventListener("orientationchange", () => {
    setTimeout(requestLayout, 60);
    setTimeout(requestLayout, 240);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", requestLayout);
  }
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(requestLayout);
    observer.observe(stage);
  }

  function createToken(piece) {
    const el = document.createElement("div");
    el.className = `token ${piece.team}`;
    el.dataset.id = piece.id;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `${piece.name}，可拖曳`);
    el.innerHTML = `<span class="token-face">${piece.team === "ball" ? BALL_SVG : piece.num}</span>`;
    el.addEventListener("dragstart", (event) => event.preventDefault());
    el.addEventListener("contextmenu", (event) => event.preventDefault());

    el.addEventListener("touchstart", (event) => {
      if (activeTouchId !== null || mouseMode) return;
      const touch = event.changedTouches[0];
      event.preventDefault();
      noteTouch();
      activeTouchId = touch.identifier;
      onTokenDown(piece, touch.clientX, touch.clientY);
    }, { passive: false });

    el.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || isGhostMouse() || mouseMode || activeTouchId !== null) return;
      event.preventDefault();
      mouseMode = true;
      onTokenDown(piece, event.clientX, event.clientY);
    });

    tokensEl.appendChild(el);
    piece.el = el;
  }

  function teamSlots(team, id) {
    const shape = FORMATIONS[id] || FORMATIONS["2-2"];
    const label = team === "red" ? "紅隊" : "藍隊";
    return shape.map((slot) => ({
      id: `${team}-${slot.num}`,
      team,
      num: slot.num,
      name: `${label}${slot.role}`,
      u: team === "red" ? slot.u : round4(1 - slot.u),
      v: team === "red" ? slot.v : round4(1 - slot.v)
    }));
  }

  function slotsFor(redId, blueId) {
    return teamSlots("red", redId).concat(
      teamSlots("blue", blueId),
      [{ id: "ball", team: "ball", num: "", name: "足球", u: 0.5, v: 0.5 }]
    );
  }

  function applyHomes(team) {
    teamSlots(team, formation[team]).forEach((slot) => {
      const piece = pieces.find((item) => item.id === slot.id);
      if (!piece) return;
      piece.homeU = slot.u;
      piece.homeV = slot.v;
      piece.name = slot.name;
      if (piece.el) piece.el.setAttribute("aria-label", `${slot.name}，可拖曳`);
    });
  }

  function markFormationButtons() {
    document.querySelectorAll("[data-formation]").forEach((button) => {
      const on = button.dataset.formation === formation[button.dataset.team];
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const resetButton = document.getElementById("reset-formation");
    if (resetButton) {
      resetButton.setAttribute("aria-label", `重設為紅隊 ${formation.red}、藍隊 ${formation.blue}，並清除線條`);
    }
  }

  function applyFormation(team, id) {
    if ((team !== "red" && team !== "blue") || !FORMATIONS[id]) return;
    if (dragging) {
      dragging.el.classList.remove("is-dragging");
      dragging = null;
    }
    formation[team] = id;
    applyHomes(team);
    forgetPlayback();
    pieces.forEach((piece) => {
      if (piece.team !== team) return;
      piece.u = piece.homeU;
      piece.v = piece.homeV;
      piece.el.classList.remove("is-dragging");
      place(piece);
    });
    markFormationButtons();
    holdStep = -1;
    rememberStart();
    saveState();
    syncStepUi();
    flash(`${team === "red" ? "紅隊" : "藍隊"} ${id}，路線保留`);
  }

  function syncUndo() {
    const button = document.getElementById("undo-line");
    if (!button) return;
    const empty = strokes.filter((stroke) => stroke !== currentStroke).length === 0;
    button.disabled = empty;
  }

  function undoLine() {
    let index = strokes.length - 1;
    if (strokes[index] === currentStroke) index -= 1;
    if (index < 0) {
      flash("沒有可還原的線條");
      return;
    }
    strokes.splice(index, 1);
    redraw();
    saveState();
    syncUndo();
    holdStep = -1;
    selectedStep = null;
    syncStepUi();
    flash("已還原上一筆");
  }

  function bindTools() {
    document.querySelectorAll("[data-formation]").forEach((button) => {
      button.addEventListener("click", () => applyFormation(button.dataset.team, button.dataset.formation));
    });

    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => selectTool(button.dataset.tool));
    });

    document.getElementById("toggle-panel").addEventListener("click", () => {
      panelOpen = !panelOpen;
      syncChrome();
      saveState();
      requestLayout();
    });

    document.getElementById("move-pieces").addEventListener("click", () => {
      selectTool(toolId === "move" ? penId : "move");
    });

    document.getElementById("same-time").addEventListener("click", () => {
      sameTime = !sameTime;
      syncChrome();
      saveState();
      flash(sameTime ? "下一筆會同時發生" : "下一筆接着發生");
    });

    document.getElementById("slow-play").addEventListener("click", () => {
      slowPlay = !slowPlay;
      syncChrome();
      saveState();
      flash(slowPlay ? "慢速播放" : "正常速度");
    });

    document.getElementById("play-route").addEventListener("click", togglePlay);

    document.getElementById("undo-line").addEventListener("click", () => {
      forgetPlayback();
      undoLine();
    });

    document.getElementById("clear-lines").addEventListener("click", () => {
      forgetPlayback();
      strokes = [];
      currentStroke = null;
      drawing = false;
      redraw();
      saveState();
      syncUndo();
      holdStep = -1;
      selectedStep = null;
      syncStepUi();
      flash("線條已清除");
    });

    document.getElementById("step-prev").addEventListener("click", () => showStep(holdStep - 1));
    document.getElementById("step-next").addEventListener("click", () => showStep(holdStep + 1));
    document.getElementById("step-del").addEventListener("click", deleteSelected);
    document.getElementById("step-earlier").addEventListener("click", () => shiftStep(-1));
    document.getElementById("step-later").addEventListener("click", () => shiftStep(1));
    document.getElementById("step-join").addEventListener("click", joinSelected);
    document.getElementById("step-split").addEventListener("click", splitSelected);
    document.getElementById("step-owner").addEventListener("click", () => {
      if (!selectedStep) return;
      reassignMode = !reassignMode;
      syncStepUi();
      flash(reassignMode ? "點選負責呢一步嘅人" : "已取消改人");
    });
    document.querySelectorAll("[data-note]").forEach((button) => {
      button.addEventListener("click", () => setNote(button.dataset.note));
    });
    document.getElementById("back-start").addEventListener("click", backToStart);
    document.getElementById("mirror-board").addEventListener("click", mirrorBoard);
    document.getElementById("fly-red").addEventListener("click", () => flyKeeper("red"));
    document.getElementById("fly-blue").addEventListener("click", () => flyKeeper("blue"));
    document.querySelectorAll("[data-set]").forEach((button) => {
      button.addEventListener("click", () => applySetPiece(button.dataset.set));
    });
    document.getElementById("routine-save").addEventListener("click", saveRoutine);
    const nameInput = document.getElementById("routine-name");
    nameInput.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });
    nameInput.addEventListener("mousedown", (event) => event.stopPropagation());

    document.getElementById("reset-formation").addEventListener("click", () => {
      forgetPlayback();
      if (dragging) {
        dragging.el.classList.remove("is-dragging");
        dragging = null;
      }
      pieces.forEach((piece) => {
        piece.u = piece.homeU;
        piece.v = piece.homeV;
        piece.el.classList.remove("is-dragging");
        place(piece);
      });
      strokes = [];
      currentStroke = null;
      drawing = false;
      benched = {};
      pieces.forEach((piece) => piece.el.classList.remove("is-benched"));
      holdStep = -1;
      selectedStep = null;
      redraw();
      rememberStart();
      saveState();
      syncUndo();
      renderBench();
      syncStepUi();
      flash(`紅 ${formation.red}、藍 ${formation.blue}，線已清除`);
    });
  }

  function bindPointer() {
    canvas.addEventListener("touchstart", (event) => {
      event.preventDefault();
      noteTouch();
      if (activeTouchId !== null || mouseMode) return;
      const touch = event.changedTouches[0];
      activeTouchId = touch.identifier;
      beginStroke(touch.clientX, touch.clientY);
    }, { passive: false });

    canvas.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || isGhostMouse() || mouseMode || activeTouchId !== null) return;
      event.preventDefault();
      mouseMode = true;
      beginStroke(event.clientX, event.clientY);
    });

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    document.addEventListener("touchmove", (event) => {
      const panel = document.getElementById("panel");
      const allowScroll = panelOpen && panel && panel.contains(event.target) && !dragging && !drawing;
      if (!allowScroll) event.preventDefault();
      if (activeTouchId === null) return;
      const touch = findTouch(event.touches, activeTouchId);
      if (!touch) return;
      if (dragging) updateDrag(touch.clientX, touch.clientY);
      else if (drawing) extendStroke(touch.clientX, touch.clientY);
    }, { passive: false });

    document.addEventListener("touchend", (event) => {
      noteTouch();
      if (activeTouchId === null) return;
      if (!findTouch(event.changedTouches, activeTouchId)) return;
      finishPointer();
    }, { passive: false });

    document.addEventListener("touchcancel", (event) => {
      if (activeTouchId === null) return;
      if (!findTouch(event.changedTouches, activeTouchId)) return;
      finishPointer();
    });

    document.addEventListener("mousemove", (event) => {
      if (!mouseMode) return;
      if (dragging) updateDrag(event.clientX, event.clientY);
      else if (drawing) extendStroke(event.clientX, event.clientY);
    });

    document.addEventListener("mouseup", () => {
      if (!mouseMode) return;
      mouseMode = false;
      finishPointer();
    });

    document.addEventListener("selectstart", (event) => {
      if (dragging || drawing) event.preventDefault();
    });

    window.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
    window.addEventListener("gesturechange", (event) => event.preventDefault(), { passive: false });
  }

  function onTokenDown(piece, clientX, clientY) {
    if (benched[piece.id]) return;
    if (reassignMode) {
      assignOwner(piece);
      return;
    }
    if (toolId !== "move") return;
    const now = Date.now();
    if (lastTokenTap.id === piece.id && now - lastTokenTap.t < 340) {
      lastTokenTap = { id: null, t: 0 };
      toggleBench(piece);
      return;
    }
    lastTokenTap = { id: piece.id, t: now };
    startDrag(piece, clientX, clientY);
  }

  function startDrag(piece, clientX, clientY) {
    forgetPlayback();
    dragging = piece;
    drawing = false;
    currentStroke = null;
    piece.el.classList.add("is-dragging");
    const origin = pitchBox();
    const spot = uvToScreen(piece.u, piece.v);
    dragDx = clientX - origin.left - spot.x;
    dragDy = clientY - origin.top - spot.y;
  }

  function updateDrag(clientX, clientY) {
    const origin = pitchBox();
    const uv = screenToUV(clientX - origin.left - dragDx, clientY - origin.top - dragDy);
    dragging.u = clamp(uv.u, -0.04, 1.04);
    dragging.v = clamp(uv.v, -0.06, 1.06);
    place(dragging);
  }

  function nextStepNumber() {
    const done = strokes.filter((stroke) => stroke !== currentStroke && stroke.step);
    if (!done.length) return 1;
    const last = done[done.length - 1].step;
    return sameTime ? last : last + 1;
  }

  function beginStroke(clientX, clientY) {
    if (toolId === "move") return;
    forgetPlayback();
    drawing = true;
    const point = clientToUV(clientX, clientY);
    const tool = TOOLS[toolId];
    currentStroke = {
      color: tool.color,
      dashed: tool.dashed,
      arrow: tool.arrow,
      step: nextStepNumber(),
      points: [point],
      lx: clientX,
      ly: clientY
    };
    strokes.push(currentStroke);
    requestRedraw();
  }

  function extendStroke(clientX, clientY) {
    if (!currentStroke) return;
    const dx = clientX - currentStroke.lx;
    const dy = clientY - currentStroke.ly;
    if (dx * dx + dy * dy < 9) return;
    currentStroke.lx = clientX;
    currentStroke.ly = clientY;
    currentStroke.points.push(clientToUV(clientX, clientY));
    requestRedraw();
  }

  function finishPointer() {
    const drew = drawing;
    const moved = dragging !== null;
    const stroke = currentStroke;
    if (dragging) {
      dragging.el.classList.remove("is-dragging");
      dragging = null;
    }
    drawing = false;
    currentStroke = null;
    activeTouchId = null;
    if (drew && stroke && takeBadgeTap(stroke)) {
      redraw();
      saveState();
      syncUndo();
      syncStepUi();
      return;
    }
    if (drew && stroke) claimOwner(stroke);
    if (moved && holdStep < 0) rememberStart();
    if (drew) {
      selectedStep = null;
      reassignMode = false;
      redraw();
    }
    if (drew || moved) saveState();
    if (drew) syncUndo();
    syncStepUi();
  }

  function findTouch(list, id) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  }

  function noteTouch() {
    touchedAt = Date.now();
  }

  function isGhostMouse() {
    return Date.now() - touchedAt < 700;
  }

  function requestLayout() {
    if (layoutFrame) return;
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0;
      layout();
    });
  }

  function layout() {
    const bounds = stage.getBoundingClientRect();
    const availW = Math.max(0, bounds.width - 2);
    const availH = Math.max(0, bounds.height - 2);
    if (availW < 40 || availH < 40) return;

    const land = fit(availW, availH, RATIO);
    const port = fit(availW, availH, 1 / RATIO);
    const nextPortrait = port.area > land.area;
    const box = nextPortrait ? port : land;
    let width = Math.max(1, Math.round(box.w));
    let height = Math.round(nextPortrait ? width * RATIO : width / RATIO);
    if (height > availH) {
      height = Math.max(1, Math.floor(availH));
      width = Math.max(1, Math.round(nextPortrait ? height / RATIO : height * RATIO));
    }
    if (width > availW) {
      width = Math.max(1, Math.floor(availW));
      height = Math.max(1, Math.round(nextPortrait ? width * RATIO : width / RATIO));
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    if (width === laidOut.w && height === laidOut.h && nextPortrait === laidOut.portrait && dpr === laidOut.dpr) return;

    portrait = nextPortrait;
    laidOut = { w: width, h: height, portrait, dpr };
    pitch.style.width = `${width}px`;
    pitch.style.height = `${height}px`;
    pitch.classList.toggle("is-portrait", portrait);
    pitch.classList.toggle("is-landscape", !portrait);
    pitch.dataset.orientation = portrait ? "portrait" : "landscape";

    boxCache = null;
    snapshotReady = false;
    const rect = pitch.getBoundingClientRect();
    applyMarkings(rect.width, rect.height);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    sizeTokens(Math.min(rect.width, rect.height));
    pieces.forEach(place);
    redraw();
  }

  function fit(availW, availH, ratio) {
    let w = availW;
    let h = w / ratio;
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
    return { w, h, area: w * h };
  }

  function applyMarkings(pitchW, pitchH) {
    if (portrait) {
      markings.style.width = `${pitchH}px`;
      markings.style.height = `${pitchW}px`;
      markings.style.left = "50%";
      markings.style.top = "50%";
      markings.style.transform = "translate(-50%, -50%) rotate(-90deg)";
      return;
    }
    markings.style.width = `${pitchW}px`;
    markings.style.height = `${pitchH}px`;
    markings.style.left = "0";
    markings.style.top = "0";
    markings.style.transform = "none";
  }

  function sizeTokens(shortSide) {
    const player = Math.max(30, Math.min(54, shortSide * 0.105));
    const ball = player * 0.78;
    pitch.style.setProperty("--token", `${player}px`);
    pitch.style.setProperty("--ball", `${ball}px`);
  }

  function place(piece) {
    const { w, h } = pitchBox();
    if (!w || !h) return;
    const spot = uvToScreen(piece.u, piece.v);
    piece.el.style.left = `${(spot.x / w) * 100}%`;
    piece.el.style.top = `${(spot.y / h) * 100}%`;
  }

  function lineWidthFor(w, h) {
    return Math.min(8, Math.max(3, Math.min(w, h) * 0.011));
  }

  function requestRedraw() {
    if (drawFrame) return;
    drawFrame = window.requestAnimationFrame(() => {
      drawFrame = 0;
      paint();
    });
  }

  function redraw() {
    snapshotReady = false;
    if (drawFrame) {
      window.cancelAnimationFrame(drawFrame);
      drawFrame = 0;
    }
    paint();
  }

  function paint() {
    const { w, h } = pitchBox();
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = lineWidthFor(w, h);
    ensureSnapshot(w, h, dpr, width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(snapshot, 0, 0);
    if (!currentStroke) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    trace(currentStroke, width, ctx);
  }

  function ensureSnapshot(w, h, dpr, width) {
    const bufferW = Math.max(1, Math.round(w * dpr));
    const bufferH = Math.max(1, Math.round(h * dpr));
    if (snapshotReady && snapshot.width === bufferW && snapshot.height === bufferH) return;
    snapshot.width = bufferW;
    snapshot.height = bufferH;
    snapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    snapCtx.clearRect(0, 0, w, h);
    strokes.forEach((stroke) => {
      if (stroke === currentStroke) return;
      trace(stroke, width, snapCtx);
    });
    snapshotReady = true;
  }

  function trace(stroke, width, g) {
    const points = stroke.points.map((point) => uvToScreen(point.u, point.v));
    if (!points.length) return;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.setLineDash(stroke.dashed ? [width * 2.6, width * 1.8] : []);
    if (points.length === 1) {
      g.setLineDash([]);
      g.fillStyle = stroke.color;
      g.beginPath();
      g.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      g.fill();
      return;
    }

    const arrow = stroke.arrow ? arrowVector(points) : null;
    const head = arrow ? width * 4.2 : 0;
    const linePoints = head ? trimEnd(points, head * 0.72) : points;

    const drawPath = () => {
      g.beginPath();
      g.moveTo(linePoints[0].x, linePoints[0].y);
      if (linePoints.length === 2) {
        g.lineTo(linePoints[1].x, linePoints[1].y);
        return;
      }
      g.lineTo((linePoints[0].x + linePoints[1].x) / 2, (linePoints[0].y + linePoints[1].y) / 2);
      for (let i = 1; i < linePoints.length - 1; i += 1) {
        const midX = (linePoints[i].x + linePoints[i + 1].x) / 2;
        const midY = (linePoints[i].y + linePoints[i + 1].y) / 2;
        g.quadraticCurveTo(linePoints[i].x, linePoints[i].y, midX, midY);
      }
      const last = linePoints[linePoints.length - 1];
      g.lineTo(last.x, last.y);
    };

    g.lineWidth = width + 2.2;
    g.strokeStyle = "rgba(0,0,0,0.32)";
    drawPath();
    g.stroke();
    g.lineWidth = width;
    g.strokeStyle = stroke.color;
    drawPath();
    g.stroke();
    g.setLineDash([]);
    if (arrow) drawArrowHead(g, arrow.tip, arrow.from, head, stroke.color);
    drawStepBadge(g, stroke, points);
  }

  function badgeFromScreen(points) {
    const start = points[0];
    const next = points[Math.min(1, points.length - 1)];
    const dx = next.x - start.x;
    const dy = next.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: start.x + (dx / len) * 12 + (-dy / len) * 26,
      y: start.y + (dy / len) * 12 + (dx / len) * 26
    };
  }

  function badgeFromUV(points) {
    return badgeFromScreen(points.map((point) => uvToScreen(point.u, point.v)));
  }

  function drawStepBadge(g, stroke, points) {
    if (!stroke.step || !points.length) return;
    const badge = badgeFromScreen(points);
    const x = badge.x;
    const y = badge.y;
    g.save();
    g.setLineDash([]);
    g.beginPath();
    g.arc(x, y, stroke.step === selectedStep ? 13 : 10, 0, Math.PI * 2);
    g.fillStyle = stroke.color;
    g.fill();
    g.lineWidth = stroke.step === selectedStep ? 3 : 1.5;
    g.strokeStyle = stroke.step === selectedStep ? "#f4fff7" : "rgba(0, 0, 0, 0.55)";
    g.stroke();
    g.fillStyle = stroke.color === "#ffffff" ? "#102018" : "#1c1402";
    g.font = "700 12px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(stroke.step), x, y + 0.5);
    if (stroke.note) {
      const end = points[points.length - 1];
      g.font = "700 13px sans-serif";
      g.textAlign = "left";
      g.fillStyle = stroke.color;
      g.fillText(stroke.note, end.x + 10, end.y - 10);
    }
    g.restore();
  }

  function trimEnd(points, distance) {
    const tip = points[points.length - 1];
    const prev = points[points.length - 2];
    const dx = tip.x - prev.x;
    const dy = tip.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const cut = Math.min(distance, len * 0.72);
    const end = { x: tip.x - (dx / len) * cut, y: tip.y - (dy / len) * cut };
    return points.slice(0, -1).concat(end);
  }

  function arrowVector(points) {
    const tip = points[points.length - 1];
    for (let i = points.length - 2; i >= 0; i -= 1) {
      const dx = tip.x - points[i].x;
      const dy = tip.y - points[i].y;
      if (dx * dx + dy * dy > 16) return { tip, from: points[i] };
    }
    return { tip, from: points[points.length - 2] };
  }

  function drawArrowHead(g, tip, from, length, color) {
    const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
    const spread = Math.PI / 7;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(tip.x, tip.y);
    g.lineTo(tip.x - length * Math.cos(angle - spread), tip.y - length * Math.sin(angle - spread));
    g.lineTo(tip.x - length * 0.72 * Math.cos(angle), tip.y - length * 0.72 * Math.sin(angle));
    g.lineTo(tip.x - length * Math.cos(angle + spread), tip.y - length * Math.sin(angle + spread));
    g.closePath();
    g.fill();
  }

  function fieldNorm(u, v) {
    const vx = FIELD.x + u * FIELD.w;
    const vy = FIELD.y + v * FIELD.h;
    return {
      nx: (vx - VB.x) / VB.w,
      ny: (vy - VB.y) / VB.h
    };
  }

  function normField(nx, ny) {
    const vx = VB.x + nx * VB.w;
    const vy = VB.y + ny * VB.h;
    return {
      u: (vx - FIELD.x) / FIELD.w,
      v: (vy - FIELD.y) / FIELD.h
    };
  }

  function uvToScreen(u, v) {
    const { nx, ny } = fieldNorm(u, v);
    const { w, h } = pitchBox();
    if (!portrait) return { x: nx * w, y: ny * h };
    return { x: ny * w, y: (1 - nx) * h };
  }

  function screenToUV(x, y) {
    const { w, h } = pitchBox();
    if (!w || !h) return { u: 0.5, v: 0.5 };
    if (!portrait) return normField(x / w, y / h);
    return normField(1 - y / h, x / w);
  }

  function clientToUV(clientX, clientY) {
    const origin = pitchBox();
    return screenToUV(clientX - origin.left, clientY - origin.top);
  }

  function pitchBox() {
    if (boxCache) return boxCache;
    const rect = pitch.getBoundingClientRect();
    boxCache = { w: rect.width, h: rect.height, left: rect.left, top: rect.top };
    return boxCache;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function selectTool(id) {
    if (!TOOLS[id]) return;
    if (id !== "move") penId = id;
    toolId = id;
    document.querySelectorAll("[data-tool]").forEach((item) => {
      const on = item.dataset.tool === toolId;
      item.classList.toggle("is-active", on);
      item.setAttribute("aria-pressed", on ? "true" : "false");
    });
    syncChrome();
    setModeStatus();
  }

  function syncChrome() {
    appEl.classList.toggle("is-bar-hidden", !panelOpen);
    const toggle = document.getElementById("toggle-panel");
    if (toggle) {
      toggle.textContent = panelOpen ? "收起" : "展開";
      toggle.setAttribute("aria-expanded", panelOpen ? "true" : "false");
      toggle.setAttribute("aria-label", panelOpen ? "收起功能表" : "展開功能表");
    }
    pitch.classList.toggle("is-drawing", toolId !== "move");
    pitch.classList.toggle("is-moving", toolId === "move");
    const moveBtn = document.getElementById("move-pieces");
    if (moveBtn) {
      const on = toolId === "move";
      moveBtn.classList.toggle("is-active", on);
      moveBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const sameBtn = document.getElementById("same-time");
    if (sameBtn) {
      sameBtn.classList.toggle("is-active", sameTime);
      sameBtn.textContent = sameTime ? "同時中" : "同時";
      sameBtn.setAttribute("aria-pressed", sameTime ? "true" : "false");
      sameBtn.setAttribute("aria-label", sameTime ? "下一筆會同上一步同時，再撳一次恢復逐步" : "下一筆與上一筆同時。再撳一次就恢復逐步");
    }
    const slowBtn = document.getElementById("slow-play");
    if (slowBtn) {
      slowBtn.classList.toggle("is-active", slowPlay);
      slowBtn.setAttribute("aria-pressed", slowPlay ? "true" : "false");
    }
    syncPlayButton();
  }

  function syncPlayButton() {
    const button = document.getElementById("play-route");
    if (!button) return;
    button.textContent = playing ? "暫停" : "播放";
    button.setAttribute("aria-label", playing ? "暫停播放" : "沿路線播放");
    button.setAttribute("aria-pressed", playing ? "true" : "false");
    button.classList.toggle("is-active", playing);
  }

  function forgetPlayback() {
    playing = false;
    paused = false;
    playClock = 0;
    routes = null;
    origins = null;
    if (animFrame) {
      window.cancelAnimationFrame(animFrame);
      animFrame = 0;
    }
    pieces.forEach((piece) => {
      if (piece.el) piece.el.classList.remove("is-animating");
    });
    syncPlayButton();
  }

  function physicalDistance(a, b) {
    return Math.hypot((a.u - b.u) * 2, a.v - b.v);
  }

  function nearestPiece(list, point, limit) {
    let best = null;
    let bestDistance = limit;
    list.forEach((piece) => {
      if (benched[piece.id]) return;
      const distance = physicalDistance(spotOf(piece), point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = piece;
      }
    });
    return best;
  }

  function routeLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      length += physicalDistance(points[i - 1], points[i]);
    }
    return length;
  }

  function pointAlong(points, distance) {
    let left = distance;
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      const step = physicalDistance(from, to);
      if (left <= step || i === points.length - 1) {
        const mix = step === 0 ? 1 : Math.min(1, left / step);
        return { u: from.u + (to.u - from.u) * mix, v: from.v + (to.v - from.v) * mix };
      }
      left -= step;
    }
    return points[points.length - 1];
  }

  function buildRoutes() {
    const players = pieces.filter((piece) => piece.team !== "ball");
    const ball = pieces.find((piece) => piece.team === "ball");
    const speed = slowPlay ? 0.22 : 0.42;
    const items = [];
    strokes.filter((stroke) => stroke !== currentStroke && stroke.points.length >= 2).forEach((stroke) => {
      const start = stroke.points[0];
      const pass = stroke.color === "#ffffff";
      let target = null;
      if (stroke.owner) {
        target = pieces.find((piece) => piece.id === stroke.owner && !benched[piece.id]) || null;
      }
      if (!target && pass) {
        if (ball && !benched.ball && (nearestPiece([ball], start, 0.36) || nearestPiece(players, start, 0.36))) target = ball;
      } else if (!target) {
        target = nearestPiece(players, start, 0.36);
      }
      if (!target) return;
      const length = routeLength(stroke.points);
      items.push({
        piece: target,
        points: stroke.points,
        step: stroke.step || 1,
        length,
        duration: Math.max(slowPlay ? 0.75 : 0.4, length / speed)
      });
    });
    if (!items.length) return null;
    const steps = [...new Set(items.map((item) => item.step))].sort((a, b) => a - b);
    const gap = slowPlay ? 0.32 : 0.18;
    let cursor = 0;
    const schedule = steps.map((step, index) => {
      const group = items.filter((item) => item.step === step);
      const duration = Math.max(...group.map((item) => item.duration));
      const entry = { step, items: group, start: cursor, duration };
      cursor += duration;
      if (index < steps.length - 1) cursor += gap;
      return entry;
    });
    return { schedule, total: cursor };
  }

  function captureOrigins() {
    origins = {};
    pieces.forEach((piece) => {
      origins[piece.id] = { u: piece.u, v: piece.v };
    });
  }

  function restoreOrigins() {
    if (!origins) return;
    pieces.forEach((piece) => {
      const spot = origins[piece.id];
      if (!spot) return;
      piece.u = spot.u;
      piece.v = spot.v;
      place(piece);
    });
  }

  function togglePlay() {
    if (playing) {
      playing = false;
      paused = true;
      if (animFrame) window.cancelAnimationFrame(animFrame);
      animFrame = 0;
      syncPlayButton();
      flash("已暫停");
      saveState();
      return;
    }
    if (!paused) {
      if (!routineStart) rememberStart();
      restoreStart();
      routes = buildRoutes();
      if (!routes) {
        flash("請由球員或足球旁邊開始畫線");
        return;
      }
      holdStep = -1;
      playClock = 0;
    }
    playing = true;
    paused = false;
    lastTick = performance.now();
    routes.schedule.forEach((group) => {
      group.items.forEach((item) => item.piece.el.classList.add("is-animating"));
    });
    syncPlayButton();
    statusEl.textContent = `第 ${routes.schedule[0].step} 步`;
    animFrame = window.requestAnimationFrame(playFrame);
  }

  function playFrame(now) {
    if (!playing || !routes) return;
    const step = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    playClock += step;
    const finished = playClock >= routes.total;
    let shown = routes.schedule[0].step;
    routes.schedule.forEach((group) => {
      if (playClock < group.start) return;
      shown = group.step;
      const local = Math.min(playClock - group.start, group.duration);
      group.items.forEach((item) => {
        const progress = Math.min(1, local / item.duration);
        const spot = pointAlong(item.points, item.length * progress);
        item.piece.u = spot.u;
        item.piece.v = spot.v;
        place(item.piece);
      });
    });
    if (!finished) statusEl.textContent = `第 ${shown} 步`;
    if (finished) {
      playing = false;
      paused = false;
      playClock = 0;
      if (animFrame) window.cancelAnimationFrame(animFrame);
      animFrame = 0;
      pieces.forEach((piece) => piece.el.classList.remove("is-animating"));
      holdStep = routes.schedule.length - 1;
      syncPlayButton();
      syncStepUi();
      saveState();
      flash("播放完成");
      return;
    }
    animFrame = window.requestAnimationFrame(playFrame);
  }

  function spotOf(piece) {
    if (routineStart && routineStart[piece.id]) return routineStart[piece.id];
    return piece;
  }

  function nearestLive(list, point, limit) {
    let best = null;
    let bestDistance = limit;
    list.forEach((piece) => {
      if (benched[piece.id]) return;
      const distance = physicalDistance(piece, point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = piece;
      }
    });
    return best;
  }

  function claimOwner(stroke) {
    if (!stroke || stroke.owner || stroke.points.length < 2) return;
    const start = stroke.points[0];
    const players = pieces.filter((piece) => piece.team !== "ball");
    const ball = pieces.find((piece) => piece.team === "ball");
    const pass = stroke.color === "#ffffff";
    let target = null;
    if (pass) {
      if (ball && !benched.ball && (nearestLive([ball], start, 0.36) || nearestLive(players, start, 0.36))) target = ball;
    } else {
      target = nearestLive(players, start, 0.36);
    }
    if (target) stroke.owner = target.id;
  }

  function rememberStart() {
    if (playing || holdStep >= 0) return;
    const next = {};
    pieces.forEach((piece) => {
      next[piece.id] = { u: piece.u, v: piece.v };
    });
    routineStart = next;
  }

  function restoreStart() {
    if (!routineStart) rememberStart();
    if (!routineStart) return;
    pieces.forEach((piece) => {
      const spot = routineStart[piece.id];
      if (!spot) return;
      piece.u = spot.u;
      piece.v = spot.v;
      place(piece);
    });
  }

  function scheduleNow() {
    const built = buildRoutes();
    return built ? built.schedule : [];
  }

  function syncStepUi() {
    const schedule = scheduleNow();
    const label = document.getElementById("step-label");
    if (label) {
      label.textContent = holdStep < 0 || !schedule.length
        ? "起點"
        : `第 ${holdStep + 1}/${schedule.length} 步`;
    }
    const prev = document.getElementById("step-prev");
    const next = document.getElementById("step-next");
    if (prev) prev.disabled = holdStep < 0;
    if (next) next.disabled = !schedule.length || holdStep >= schedule.length - 1;
    const edit = document.getElementById("step-edit");
    if (edit) edit.hidden = !selectedStep;
    const owner = document.getElementById("step-owner");
    if (owner) owner.classList.toggle("is-active", reassignMode);
    const noted = strokes.find((stroke) => stroke.step === selectedStep);
    const join = document.getElementById("step-join");
    const split = document.getElementById("step-split");
    const stepCount = strokes.filter((stroke) => stroke.step === selectedStep).length;
    if (join) join.disabled = !selectedStep || uniqueStepNumbers().length < 2;
    if (split) split.disabled = !selectedStep || stepCount < 2;
    document.querySelectorAll("[data-note]").forEach((button) => {
      button.classList.toggle("is-active", !!(noted && noted.note === button.dataset.note));
    });
    pitch.classList.toggle("is-reassign", reassignMode);
  }

  function showStep(index) {
    forgetPlayback();
    const schedule = scheduleNow();
    if (!schedule.length) {
      holdStep = -1;
      restoreStart();
      syncStepUi();
      statusEl.textContent = "未有路線";
      return;
    }
    holdStep = Math.max(-1, Math.min(index, schedule.length - 1));
    restoreStart();
    for (let i = 0; i <= holdStep; i += 1) {
      schedule[i].items.forEach((item) => {
        const end = item.points[item.points.length - 1];
        item.piece.u = end.u;
        item.piece.v = end.v;
        place(item.piece);
      });
    }
    syncStepUi();
    statusEl.textContent = holdStep < 0 ? "起點" : `第 ${schedule[holdStep].step} 步`;
    saveState();
  }

  function backToStart() {
    forgetPlayback();
    holdStep = -1;
    restoreStart();
    syncStepUi();
    saveState();
    flash("已回到起點，路線保留");
  }

  function badgeStepAt(uv, ignore) {
    const here = uvToScreen(uv.u, uv.v);
    let found = null;
    strokes.forEach((stroke) => {
      if (stroke === ignore || stroke.points.length < 2 || !stroke.step) return;
      const badge = badgeFromUV(stroke.points);
      if (Math.hypot(badge.x - here.x, badge.y - here.y) < 18) found = stroke.step;
    });
    return found;
  }

  function takeBadgeTap(stroke) {
    if (!stroke.points.length) return false;
    const start = uvToScreen(stroke.points[0].u, stroke.points[0].v);
    const end = uvToScreen(stroke.points[stroke.points.length - 1].u, stroke.points[stroke.points.length - 1].v);
    if (Math.hypot(end.x - start.x, end.y - start.y) > 16) return false;
    const hit = badgeStepAt(stroke.points[0], stroke);
    if (!hit) return false;
    strokes.pop();
    selectStep(hit);
    return true;
  }

  function selectStep(step) {
    selectedStep = step;
    reassignMode = false;
    syncStepUi();
    redraw();
    flash(`已選第 ${step} 步`);
  }

  function uniqueStepNumbers() {
    return [...new Set(strokes.map((stroke) => stroke.step).filter((step) => step > 0))].sort((a, b) => a - b);
  }

  function joinSelected() {
    if (!selectedStep) return;
    const nums = uniqueStepNumbers();
    const index = nums.indexOf(selectedStep);
    if (nums.length < 2 || index < 0) {
      flash("要有另一步先可以同時");
      return;
    }
    const neighbor = index > 0 ? nums[index - 1] : nums[index + 1];
    const keep = Math.min(selectedStep, neighbor);
    const drop = Math.max(selectedStep, neighbor);
    strokes.forEach((stroke) => {
      if (stroke.step === drop) stroke.step = keep;
    });
    const remaining = nums.filter((step) => step !== drop);
    renumberSteps();
    selectedStep = remaining.indexOf(keep) + 1;
    holdStep = -1;
    redraw();
    saveState();
    syncStepUi();
    flash(`已併成第 ${selectedStep} 步同時進行`);
  }

  function splitSelected() {
    if (!selectedStep) return;
    const group = strokes.filter((stroke) => stroke.step === selectedStep);
    if (group.length < 2) {
      flash("呢步得一條線，可選另一步再撳同時");
      return;
    }
    const shift = group.length - 1;
    strokes.forEach((stroke) => {
      if (stroke.step > selectedStep) stroke.step += shift;
    });
    group.forEach((stroke, index) => {
      stroke.step = selectedStep + index;
    });
    renumberSteps();
    holdStep = -1;
    redraw();
    saveState();
    syncStepUi();
    flash("已拆開做逐步");
  }

  function renumberSteps() {
    const nums = [...new Set(strokes.map((stroke) => stroke.step).filter((step) => step > 0))].sort((a, b) => a - b);
    const map = new Map(nums.map((step, index) => [step, index + 1]));
    strokes.forEach((stroke) => {
      stroke.step = map.get(stroke.step) || stroke.step;
    });
  }

  function deleteSelected() {
    if (!selectedStep) return;
    strokes = strokes.filter((stroke) => stroke.step !== selectedStep);
    selectedStep = null;
    reassignMode = false;
    renumberSteps();
    holdStep = -1;
    restoreStart();
    redraw();
    saveState();
    syncUndo();
    syncStepUi();
    flash("已刪除呢一步");
  }

  function shiftStep(direction) {
    if (!selectedStep) return;
    const nums = [...new Set(strokes.map((stroke) => stroke.step).filter((step) => step > 0))].sort((a, b) => a - b);
    const index = nums.indexOf(selectedStep);
    const neighbor = nums[index + direction];
    if (index < 0 || neighbor === undefined) return;
    strokes.forEach((stroke) => {
      if (stroke.step === selectedStep) stroke.step = -1;
    });
    strokes.forEach((stroke) => {
      if (stroke.step === neighbor) stroke.step = selectedStep;
    });
    strokes.forEach((stroke) => {
      if (stroke.step === -1) stroke.step = neighbor;
    });
    selectedStep = neighbor;
    redraw();
    saveState();
    syncStepUi();
    flash(direction < 0 ? "已提前" : "已押後");
  }

  function setNote(text) {
    if (!selectedStep) return;
    const current = strokes.find((stroke) => stroke.step === selectedStep);
    const next = current && current.note === text ? "" : text;
    strokes.forEach((stroke) => {
      if (stroke.step === selectedStep) stroke.note = next;
    });
    redraw();
    saveState();
    syncStepUi();
  }

  function assignOwner(piece) {
    if (!selectedStep) return;
    strokes.forEach((stroke) => {
      if (stroke.step === selectedStep) stroke.owner = piece.id;
    });
    reassignMode = false;
    redraw();
    saveState();
    syncStepUi();
    flash(`第 ${selectedStep} 步改由${piece.name}行`);
  }

  function toggleBench(piece) {
    if (piece.team === "ball") {
      flash("足球留喺場上");
      return;
    }
    if (holdStep >= 0) {
      holdStep = -1;
      restoreStart();
    }
    if (benched[piece.id]) delete benched[piece.id];
    else benched[piece.id] = true;
    piece.el.classList.toggle("is-benched", !!benched[piece.id]);
    rememberStart();
    renderBench();
    saveState();
    flash(benched[piece.id] ? `${piece.name}落場邊` : `${piece.name}返場`);
  }

  function renderBench() {
    const host = document.getElementById("bench-list");
    if (!host) return;
    host.innerHTML = "";
    Object.keys(benched).forEach((id) => {
      const piece = pieces.find((item) => item.id === id);
      if (!piece) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mini";
      button.textContent = `${piece.name}回場`;
      button.addEventListener("click", () => toggleBench(piece));
      host.appendChild(button);
    });
  }

  function flyKeeper(team) {
    const piece = pieces.find((item) => item.id === `${team}-1`);
    if (!piece) return;
    if (holdStep >= 0) {
      holdStep = -1;
      restoreStart();
    }
    delete benched[piece.id];
    piece.el.classList.remove("is-benched");
    piece.u = team === "red" ? 0.7 : 0.3;
    piece.v = 0.5;
    place(piece);
    rememberStart();
    renderBench();
    saveState();
    syncStepUi();
    flash(team === "red" ? "紅隊守門員出擊" : "藍隊守門員出擊");
  }

  function mirrorBoard() {
    pieces.forEach((piece) => {
      piece.v = round4(1 - piece.v);
      place(piece);
    });
    strokes.forEach((stroke) => {
      stroke.points.forEach((point) => {
        point.v = round4(1 - point.v);
      });
    });
    if (routineStart) {
      Object.keys(routineStart).forEach((id) => {
        routineStart[id].v = round4(1 - routineStart[id].v);
      });
    }
    redraw();
    saveState();
    flash("已左右對調");
  }

  function flipSpot(spot, mode) {
    if (mode === "u") return { u: round4(1 - spot.u), v: spot.v };
    if (mode === "v") return { u: spot.u, v: round4(1 - spot.v) };
    return { u: spot.u, v: spot.v };
  }

  function mapSpots(spots, mode, swap) {
    const next = {};
    Object.keys(spots).forEach((id) => {
      let target = id;
      if (swap && id !== "ball") {
        target = id.startsWith("red-") ? `blue-${id.slice(4)}` : `red-${id.slice(5)}`;
      }
      next[target] = flipSpot(spots[id], mode);
    });
    return next;
  }

  function placeSpots(spots) {
    Object.keys(spots).forEach((id) => {
      const piece = pieces.find((item) => item.id === id);
      if (!piece || benched[id]) return;
      piece.u = spots[id].u;
      piece.v = spots[id].v;
      place(piece);
    });
  }

  function scenesFor(kind) {
    if (kind === "corner") {
      const right = {
        ball: { u: 0.96, v: 0.92 },
        "red-1": { u: 0.1, v: 0.5 },
        "red-2": { u: 0.62, v: 0.48 },
        "red-3": { u: 0.72, v: 0.3 },
        "red-4": { u: 0.84, v: 0.97 },
        "red-5": { u: 0.78, v: 0.55 },
        "blue-1": { u: 0.94, v: 0.5 },
        "blue-2": { u: 0.7, v: 0.42 },
        "blue-3": { u: 0.74, v: 0.7 },
        "blue-4": { u: 0.82, v: 0.38 },
        "blue-5": { u: 0.84, v: 0.62 }
      };
      return [
        { name: "紅隊右角", spots: right },
        { name: "紅隊左角", spots: mapSpots(right, "v", false) },
        { name: "藍隊右角", spots: mapSpots(right, "u", true) },
        { name: "藍隊左角", spots: mapSpots(mapSpots(right, "u", true), "v", false) }
      ];
    }
    if (kind === "kickin") {
      const right = {
        ball: { u: 0.62, v: 0.98 },
        "red-4": { u: 0.5, v: 0.99 },
        "red-5": { u: 0.72, v: 0.72 },
        "red-3": { u: 0.55, v: 0.62 }
      };
      return [
        { name: "紅隊右邊線", spots: right },
        { name: "紅隊左邊線", spots: mapSpots(right, "v", false) },
        { name: "藍隊右邊線", spots: mapSpots(right, "u", true) },
        { name: "藍隊左邊線", spots: mapSpots(mapSpots(right, "u", true), "v", false) }
      ];
    }
    if (kind === "penalty") {
      const ten = {
        ball: { u: 0.75, v: 0.5 },
        "red-5": { u: 0.68, v: 0.5 },
        "red-4": { u: 0.6, v: 0.72 },
        "red-3": { u: 0.6, v: 0.28 },
        "red-2": { u: 0.52, v: 0.5 },
        "red-1": { u: 0.12, v: 0.5 },
        "blue-1": { u: 0.94, v: 0.5 },
        "blue-2": { u: 0.82, v: 0.32 },
        "blue-3": { u: 0.82, v: 0.5 },
        "blue-4": { u: 0.82, v: 0.68 },
        "blue-5": { u: 0.7, v: 0.5 }
      };
      const six = {
        ball: { u: 0.85, v: 0.5 },
        "red-5": { u: 0.76, v: 0.5 },
        "red-4": { u: 0.66, v: 0.74 },
        "red-3": { u: 0.66, v: 0.26 },
        "red-2": { u: 0.58, v: 0.5 },
        "red-1": { u: 0.12, v: 0.5 },
        "blue-1": { u: 0.94, v: 0.5 },
        "blue-2": { u: 0.9, v: 0.34 },
        "blue-3": { u: 0.9, v: 0.66 },
        "blue-4": { u: 0.78, v: 0.42 },
        "blue-5": { u: 0.78, v: 0.58 }
      };
      return [
        { name: "紅隊10米罰球", spots: ten },
        { name: "紅隊6米罰球", spots: six },
        { name: "藍隊10米罰球", spots: mapSpots(ten, "u", true) },
        { name: "藍隊6米罰球", spots: mapSpots(six, "u", true) }
      ];
    }
    const kick = {
      ball: { u: 0.07, v: 0.42 },
      "red-1": { u: 0.08, v: 0.5 },
      "red-2": { u: 0.28, v: 0.32 },
      "red-3": { u: 0.28, v: 0.68 },
      "red-4": { u: 0.4, v: 0.28 },
      "red-5": { u: 0.4, v: 0.72 }
    };
    return [
      { name: "紅隊龍門球", spots: kick },
      { name: "藍隊龍門球", spots: mapSpots(kick, "u", true) }
    ];
  }

  function applySetPiece(kind) {
    const scenes = scenesFor(kind);
    if (!scenes.length) return;
    const scene = scenes[setCursors[kind] % scenes.length];
    setCursors[kind] = (setCursors[kind] + 1) % scenes.length;
    forgetPlayback();
    if (holdStep >= 0) restoreStart();
    holdStep = -1;
    placeSpots(scene.spots);
    rememberStart();
    saveState();
    syncStepUi();
    flash(scene.name);
  }

  function readRoutines() {
    try {
      const data = JSON.parse(localStorage.getItem(ROUTINE_KEY));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  function strokeRecord(stroke) {
    return {
      color: stroke.color,
      dashed: !!stroke.dashed,
      arrow: !!stroke.arrow,
      step: stroke.step || 1,
      owner: stroke.owner || "",
      note: stroke.note || "",
      points: stroke.points.map((point) => ({ u: round4(point.u), v: round4(point.v) }))
    };
  }

  function strokesFrom(list) {
    return (list || []).filter((stroke) => stroke && Array.isArray(stroke.points)).map((stroke) => ({
      color: typeof stroke.color === "string" ? stroke.color : "#ffe14a",
      dashed: !!stroke.dashed,
      arrow: !!stroke.arrow,
      step: Number.isInteger(stroke.step) && stroke.step > 0 ? stroke.step : 0,
      owner: typeof stroke.owner === "string" ? stroke.owner : "",
      note: typeof stroke.note === "string" ? stroke.note.slice(0, 8) : "",
      points: stroke.points.filter((point) => Number.isFinite(point.u) && Number.isFinite(point.v))
    })).filter((stroke) => stroke.points.length);
  }

  function fillMissingSteps(list) {
    let next = 1;
    list.forEach((stroke) => {
      if (stroke.step) {
        next = stroke.step + 1;
        return;
      }
      stroke.step = next;
      next += 1;
    });
  }

  function applyBench(ids) {
    benched = {};
    pieces.forEach((piece) => {
      if (piece.el) piece.el.classList.remove("is-benched");
    });
    (ids || []).forEach((id) => {
      const piece = pieces.find((item) => item.id === id);
      if (!piece || piece.team === "ball") return;
      benched[id] = true;
      piece.el.classList.add("is-benched");
    });
  }

  function spotsFrom(list) {
    if (!Array.isArray(list)) return null;
    const next = {};
    list.forEach((saved) => {
      if (!saved || !pieces.some((piece) => piece.id === saved.id)) return;
      if (!Number.isFinite(saved.u) || !Number.isFinite(saved.v)) return;
      next[saved.id] = { u: saved.u, v: saved.v };
    });
    return Object.keys(next).length ? next : null;
  }

  function saveRoutine() {
    const input = document.getElementById("routine-name");
    const name = (input.value || "").trim();
    if (!name) {
      flash("先輸入套路名稱");
      return;
    }
    const list = readRoutines().filter((item) => item.name !== name);
    list.unshift({
      id: Date.now().toString(36),
      name,
      formation: { red: formation.red, blue: formation.blue },
      pieces: pieces.map((piece) => ({ id: piece.id, u: round4(piece.u), v: round4(piece.v) })),
      strokes: strokes.filter((stroke) => stroke !== currentStroke).map(strokeRecord),
      routineStart: routineStart ? Object.keys(routineStart).map((id) => ({
        id,
        u: round4(routineStart[id].u),
        v: round4(routineStart[id].v)
      })) : null,
      benched: Object.keys(benched)
    });
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(list.slice(0, 12)));
    renderRoutines();
    flash(`已儲存「${name}」`);
  }

  function loadRoutine(id) {
    const routine = readRoutines().find((item) => item.id === id);
    if (!routine) return;
    forgetPlayback();
    if (routine.formation && FORMATIONS[routine.formation.red]) formation.red = routine.formation.red;
    if (routine.formation && FORMATIONS[routine.formation.blue]) formation.blue = routine.formation.blue;
    applyHomes("red");
    applyHomes("blue");
    (routine.pieces || []).forEach((saved) => {
      const piece = pieces.find((item) => item.id === saved.id);
      if (!piece || !Number.isFinite(saved.u) || !Number.isFinite(saved.v)) return;
      piece.u = saved.u;
      piece.v = saved.v;
      place(piece);
    });
    strokes = strokesFrom(routine.strokes);
    fillMissingSteps(strokes);
    routineStart = spotsFrom(routine.routineStart);
    if (!routineStart) rememberStart();
    applyBench(routine.benched);
    holdStep = -1;
    selectedStep = null;
    reassignMode = false;
    markFormationButtons();
    redraw();
    saveState();
    renderBench();
    syncUndo();
    syncStepUi();
    flash(`已載入「${routine.name}」`);
  }

  function deleteRoutine(id) {
    const list = readRoutines().filter((item) => item.id !== id);
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(list));
    renderRoutines();
    flash("已刪除套路");
  }

  function renderRoutines() {
    const host = document.getElementById("routine-list");
    if (!host) return;
    host.innerHTML = "";
    readRoutines().forEach((routine) => {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "mini";
      open.textContent = routine.name;
      open.addEventListener("click", () => loadRoutine(routine.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mini";
      remove.textContent = "刪";
      remove.setAttribute("aria-label", `刪除${routine.name}`);
      remove.addEventListener("click", () => deleteRoutine(routine.id));
      host.appendChild(open);
      host.appendChild(remove);
    });
  }

  function setModeStatus() {
    window.clearTimeout(statusTimer);
    statusEl.textContent = sameTime ? "同時：下一筆同一時間" : TOOLS[toolId].label;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const savedRed = data.formations && data.formations.red;
      const savedBlue = data.formations && data.formations.blue;
      if (FORMATIONS[savedRed] && FORMATIONS[savedBlue]) {
        formation.red = savedRed;
        formation.blue = savedBlue;
      } else if (data.formation && FORMATIONS[data.formation]) {
        formation.red = data.formation;
        formation.blue = data.formation;
      }
      if (Array.isArray(data.pieces)) {
        data.pieces.forEach((saved) => {
          const piece = pieces.find((item) => item.id === saved.id);
          if (!piece || !Number.isFinite(saved.u) || !Number.isFinite(saved.v)) return;
          piece.u = saved.u;
          piece.v = saved.v;
        });
      }
      if (Array.isArray(data.strokes)) {
        strokes = data.strokes.filter((stroke) => stroke && Array.isArray(stroke.points)).map((stroke) => ({
          color: typeof stroke.color === "string" ? stroke.color : "#ffe14a",
          dashed: !!stroke.dashed,
          arrow: !!stroke.arrow,
          step: Number.isInteger(stroke.step) && stroke.step > 0 ? stroke.step : 0,
          owner: typeof stroke.owner === "string" ? stroke.owner : "",
          note: typeof stroke.note === "string" ? stroke.note.slice(0, 8) : "",
          points: stroke.points.filter((point) => Number.isFinite(point.u) && Number.isFinite(point.v))
        })).filter((stroke) => stroke.points.length);
        let next = 1;
        strokes.forEach((stroke) => {
          if (stroke.step) {
            next = stroke.step + 1;
            return;
          }
          stroke.step = next;
          next += 1;
        });
      }
      if (typeof data.panelOpen === "boolean") panelOpen = data.panelOpen;
      if (typeof data.sameTime === "boolean") sameTime = data.sameTime;
      if (typeof data.slowPlay === "boolean") slowPlay = data.slowPlay;
      if (Array.isArray(data.origins)) {
        const next = {};
        data.origins.forEach((saved) => {
          if (!pieces.some((piece) => piece.id === saved.id)) return;
          if (!Number.isFinite(saved.u) || !Number.isFinite(saved.v)) return;
          next[saved.id] = { u: saved.u, v: saved.v };
        });
        origins = Object.keys(next).length ? next : null;
      }
      routineStart = spotsFrom(data.routineStart);
      if (!routineStart && origins) {
        routineStart = {};
        Object.keys(origins).forEach((id) => {
          routineStart[id] = { u: origins[id].u, v: origins[id].v };
        });
      }
      applyBench(data.benched);
      if (Number.isInteger(data.holdStep)) holdStep = data.holdStep;
    } catch (error) {
      strokes = [];
    }
  }

  function saveState() {
    try {
      const data = {
        formations: { red: formation.red, blue: formation.blue },
        panelOpen,
        sameTime,
        slowPlay,
        holdStep,
        routineStart: routineStart ? pieces.filter((piece) => routineStart[piece.id]).map((piece) => ({
          id: piece.id,
          u: round4(routineStart[piece.id].u),
          v: round4(routineStart[piece.id].v)
        })) : null,
        benched: Object.keys(benched),
        origins: origins ? pieces.filter((piece) => origins[piece.id]).map((piece) => ({
          id: piece.id,
          u: round4(origins[piece.id].u),
          v: round4(origins[piece.id].v)
        })) : null,
        pieces: pieces.map((piece) => ({ id: piece.id, u: round4(piece.u), v: round4(piece.v) })),
        strokes: strokes.filter((stroke) => stroke !== currentStroke).map((stroke) => ({
          color: stroke.color,
          dashed: !!stroke.dashed,
          arrow: !!stroke.arrow,
          step: stroke.step || 1,
          owner: stroke.owner || "",
          note: stroke.note || "",
          points: stroke.points.map((point) => ({ u: round4(point.u), v: round4(point.v) }))
        }))
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (error) {
      /* 儲存空間不可用時，這一局仍然可以繼續操作 */
    }
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    let hadController = false;
    window.addEventListener("load", () => {
      hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) {
          hadController = true;
          return;
        }
        window.location.reload();
      });
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  function flash(text) {
    statusEl.textContent = text;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(setModeStatus, 1600);
  }
})();
