(() => {
  /*
   * 座標與 index.html 的 viewBox="-36 -22 472 244" 對齊。
   * 場地本體 40m × 20m，原點在紅隊球門線與左上方邊線的交點。
   * u：0 紅隊球門 → 1 藍隊球門；v：0 → 1 沿場地寬度。
   */
  const VB = { x: -36, y: -22, w: 472, h: 244 };
  const FIELD = { x: 0, y: 0, w: 400, h: 200 };
  const RATIO = VB.w / VB.h;

  const TOOLS = {
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

  const FORMATION = [
    { id: "red-1", team: "red", num: "1", name: "紅隊守門員", u: 0.08, v: 0.5 },
    { id: "red-2", team: "red", num: "2", name: "紅隊左後衛", u: 0.26, v: 0.3 },
    { id: "red-3", team: "red", num: "3", name: "紅隊右後衛", u: 0.26, v: 0.7 },
    { id: "red-4", team: "red", num: "4", name: "紅隊左前鋒", u: 0.42, v: 0.3 },
    { id: "red-5", team: "red", num: "5", name: "紅隊右前鋒", u: 0.42, v: 0.7 },
    { id: "blue-1", team: "blue", num: "1", name: "藍隊守門員", u: 0.92, v: 0.5 },
    { id: "blue-2", team: "blue", num: "2", name: "藍隊左後衛", u: 0.74, v: 0.7 },
    { id: "blue-3", team: "blue", num: "3", name: "藍隊右後衛", u: 0.74, v: 0.3 },
    { id: "blue-4", team: "blue", num: "4", name: "藍隊左前鋒", u: 0.58, v: 0.7 },
    { id: "blue-5", team: "blue", num: "5", name: "藍隊右前鋒", u: 0.58, v: 0.3 },
    { id: "ball", team: "ball", num: "", name: "足球", u: 0.5, v: 0.5 }
  ];

  const pitch = document.getElementById("pitch");
  const markings = pitch.querySelector(".markings");
  const canvas = document.getElementById("draw-layer");
  const tokensEl = document.getElementById("tokens");
  const stage = document.querySelector(".stage");
  const statusEl = document.getElementById("status");
  const ctx = canvas.getContext("2d");

  const pieces = FORMATION.map((item) => ({
    ...item,
    homeU: item.u,
    homeV: item.v,
    el: null
  }));

  let portrait = true;
  let toolId = "run-solid";
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

  pieces.forEach(createToken);
  bindTools();
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

  function bindTools() {
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        toolId = button.dataset.tool;
        document.querySelectorAll("[data-tool]").forEach((item) => {
          const on = item.dataset.tool === toolId;
          item.classList.toggle("is-active", on);
          item.setAttribute("aria-pressed", on ? "true" : "false");
        });
        setModeStatus();
      });
    });

    document.getElementById("clear-lines").addEventListener("click", () => {
      strokes = [];
      currentStroke = null;
      drawing = false;
      redraw();
      flash("線條已清除");
    });

    document.getElementById("reset-formation").addEventListener("click", () => {
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
      flash("陣型已重設");
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
    redraw();
  }

  function extendStroke(clientX, clientY) {
    if (!currentStroke) return;
    const dx = clientX - currentStroke.lx;
    const dy = clientY - currentStroke.ly;
    if (dx * dx + dy * dy < 9) return;
    currentStroke.lx = clientX;
    currentStroke.ly = clientY;
    currentStroke.points.push(clientToUV(clientX, clientY));
    redraw();
  }

  function finishPointer() {
    if (dragging) {
      dragging.el.classList.remove("is-dragging");
      dragging = null;
    }
    drawing = false;
    currentStroke = null;
    activeTouchId = null;
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
    const availW = Math.max(0, bounds.width - 12);
    const availH = Math.max(0, bounds.height - 12);
    if (availW < 40 || availH < 40) return;

    const land = fit(availW, availH, RATIO);
    const port = fit(availW, availH, 1 / RATIO);
    const nextPortrait = port.area > land.area;
    const box = nextPortrait ? port : land;
    const width = Math.max(1, Math.round(box.w));
    const height = Math.max(1, Math.round(box.h));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    if (width === laidOut.w && height === laidOut.h && nextPortrait === laidOut.portrait && dpr === laidOut.dpr) return;

    portrait = nextPortrait;
    laidOut = { w: width, h: height, portrait, dpr };
    pitch.style.width = `${width}px`;
    pitch.style.height = `${height}px`;
    pitch.classList.toggle("is-portrait", portrait);
    pitch.classList.toggle("is-landscape", !portrait);
    pitch.dataset.orientation = portrait ? "portrait" : "landscape";

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

  function redraw() {
    const { w, h } = pitchBox();
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const width = Math.min(8, Math.max(3, Math.min(w, h) * 0.011));
    strokes.forEach((stroke) => trace(stroke, width));
  }

  function trace(stroke, width) {
    const points = stroke.points.map((point) => uvToScreen(point.u, point.v));
    if (!points.length) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(stroke.dashed ? [width * 2.6, width * 1.8] : []);
    if (points.length === 1) {
      ctx.setLineDash([]);
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const arrow = stroke.arrow ? arrowVector(points) : null;
    const head = arrow ? width * 4.2 : 0;
    const linePoints = head ? trimEnd(points, head * 0.72) : points;

    const drawPath = () => {
      ctx.beginPath();
      ctx.moveTo(linePoints[0].x, linePoints[0].y);
      if (linePoints.length === 2) {
        ctx.lineTo(linePoints[1].x, linePoints[1].y);
        return;
      }
      ctx.lineTo((linePoints[0].x + linePoints[1].x) / 2, (linePoints[0].y + linePoints[1].y) / 2);
      for (let i = 1; i < linePoints.length - 1; i += 1) {
        const midX = (linePoints[i].x + linePoints[i + 1].x) / 2;
        const midY = (linePoints[i].y + linePoints[i + 1].y) / 2;
        ctx.quadraticCurveTo(linePoints[i].x, linePoints[i].y, midX, midY);
      }
      const last = linePoints[linePoints.length - 1];
      ctx.lineTo(last.x, last.y);
    };

    ctx.lineWidth = width + 2.2;
    ctx.strokeStyle = "rgba(0,0,0,0.32)";
    drawPath();
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke.color;
    drawPath();
    ctx.stroke();
    ctx.setLineDash([]);
    if (arrow) drawArrowHead(arrow.tip, arrow.from, head, stroke.color);
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

  function drawArrowHead(tip, from, length, color) {
    const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
    const spread = Math.PI / 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - length * Math.cos(angle - spread), tip.y - length * Math.sin(angle - spread));
    ctx.lineTo(tip.x - length * 0.72 * Math.cos(angle), tip.y - length * 0.72 * Math.sin(angle));
    ctx.lineTo(tip.x - length * Math.cos(angle + spread), tip.y - length * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fill();
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
    const rect = pitch.getBoundingClientRect();
    return { w: rect.width, h: rect.height, left: rect.left, top: rect.top };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setModeStatus() {
    window.clearTimeout(statusTimer);
    statusEl.textContent = TOOLS[toolId].label;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  function flash(text) {
    statusEl.textContent = text;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(setModeStatus, 1600);
  }
})();
