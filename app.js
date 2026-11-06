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
  let routes = [];
  let origins = null;
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
      startDrag(piece, touch.clientX, touch.clientY);
    }, { passive: false });

    el.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || isGhostMouse() || mouseMode || activeTouchId !== null) return;
      event.preventDefault();
      mouseMode = true;
      startDrag(piece, event.clientX, event.clientY);
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
    saveState();
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
      flash("線條已清除");
    });

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
      redraw();
      saveState();
      syncUndo();
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
      event.preventDefault();
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
    if (dragging) {
      dragging.el.classList.remove("is-dragging");
      dragging = null;
    }
    drawing = false;
    currentStroke = null;
    activeTouchId = null;
    if (drew) redraw();
    if (drew || moved) saveState();
    if (drew) syncUndo();
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
    routes = [];
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
      const distance = physicalDistance(piece, point);
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
    const groups = new Map();
    const players = pieces.filter((piece) => piece.team !== "ball");
    const ball = pieces.find((piece) => piece.team === "ball");
    strokes.filter((stroke) => stroke !== currentStroke && stroke.points.length >= 2).forEach((stroke) => {
      const start = stroke.points[0];
      const pass = stroke.color === "#ffffff";
      let target = null;
      if (pass) {
        if (ball && (nearestPiece([ball], start, 0.36) || nearestPiece(players, start, 0.36))) target = ball;
      } else {
        target = nearestPiece(players, start, 0.36);
      }
      if (!target) return;
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push(stroke);
    });
    return [...groups.entries()].map(([piece, list]) => {
      const segments = list.map((stroke) => {
        const length = routeLength(stroke.points);
        return { points: stroke.points, length, duration: Math.max(0.4, length / 0.42) };
      });
      return {
        piece,
        segments,
        total: segments.reduce((sum, segment) => sum + segment.duration, 0)
      };
    });
  }

  function positionOnRoute(route, time) {
    let remain = time;
    for (let i = 0; i < route.segments.length; i += 1) {
      const segment = route.segments[i];
      if (remain > segment.duration && i < route.segments.length - 1) {
        remain -= segment.duration;
        continue;
      }
      const distance = segment.length * (Math.min(remain, segment.duration) / segment.duration);
      return pointAlong(segment.points, distance);
    }
    const last = route.segments[route.segments.length - 1].points;
    return last[last.length - 1];
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
      if (origins) restoreOrigins();
      routes = buildRoutes();
      if (!routes.length) {
        flash("請由球員或足球旁邊開始畫線");
        return;
      }
      if (!origins) captureOrigins();
      playClock = 0;
    }
    playing = true;
    paused = false;
    lastTick = performance.now();
    routes.forEach((route) => route.piece.el.classList.add("is-animating"));
    syncPlayButton();
    flash("播放路線");
    animFrame = window.requestAnimationFrame(playFrame);
  }

  function playFrame(now) {
    if (!playing) return;
    const step = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    playClock += step;
    let finished = true;
    routes.forEach((route) => {
      if (playClock < route.total) finished = false;
      const spot = positionOnRoute(route, Math.min(playClock, route.total));
      route.piece.u = spot.u;
      route.piece.v = spot.v;
      place(route.piece);
    });
    if (finished) {
      playing = false;
      paused = false;
      playClock = 0;
      if (animFrame) window.cancelAnimationFrame(animFrame);
      animFrame = 0;
      pieces.forEach((piece) => piece.el.classList.remove("is-animating"));
      syncPlayButton();
      saveState();
      flash("播放完成");
      return;
    }
    animFrame = window.requestAnimationFrame(playFrame);
  }

  function setModeStatus() {
    window.clearTimeout(statusTimer);
    statusEl.textContent = TOOLS[toolId].label;
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
          points: stroke.points.filter((point) => Number.isFinite(point.u) && Number.isFinite(point.v))
        })).filter((stroke) => stroke.points.length);
      }
      if (typeof data.panelOpen === "boolean") panelOpen = data.panelOpen;
      if (Array.isArray(data.origins)) {
        const next = {};
        data.origins.forEach((saved) => {
          if (!pieces.some((piece) => piece.id === saved.id)) return;
          if (!Number.isFinite(saved.u) || !Number.isFinite(saved.v)) return;
          next[saved.id] = { u: saved.u, v: saved.v };
        });
        origins = Object.keys(next).length ? next : null;
      }
    } catch (error) {
      strokes = [];
    }
  }

  function saveState() {
    try {
      const data = {
        formations: { red: formation.red, blue: formation.blue },
        panelOpen,
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
