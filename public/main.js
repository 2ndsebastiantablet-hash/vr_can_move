import { MultiplayerClient } from "./frontend/multiplayer-client.js";

const params = new URLSearchParams(location.search);
const apiBase = params.get("api") || localStorage.getItem("vr_can_move_api") || location.origin;
const colors = ["#F4E3B2", "#B8D8FF", "#FFC6D9", "#C7F5D5", "#FFD7A8", "#D5C7FF"];
const codeChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const state = {
  apiBase,
  client: null,
  snapshot: null,
  publicLobbies: [],
  playerName: `Pin ${Math.floor(1000 + Math.random() * 9000)}`,
  color: colors[Math.floor(Math.random() * colors.length)],
  joinCode: "ABC123",
  codeIndex: 0,
  status: "Pick public or private multiplayer.",
  avatars: new Map(),
  lastPush: 0
};

AFRAME.registerComponent("quest-move", {
  schema: { leftController: { type: "selector" }, rightController: { type: "selector" }, camera: { type: "selector" }, moveSpeed: { default: 2.8 }, turnDegrees: { default: 30 }, turnCooldown: { default: 280 } },
  init() {
    this.leftStick = { x: 0, y: 0 };
    this.rightStick = { x: 0, y: 0 };
    this.keys = new Set();
    this.lastTurn = 0;
    this.yaw = new THREE.Euler(0, 0, 0, "YXZ");
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.leftMove = (event) => { this.leftStick.x = event.detail.x || 0; this.leftStick.y = event.detail.y || 0; };
    this.rightMove = (event) => { this.rightStick.x = event.detail.x || 0; this.rightStick.y = event.detail.y || 0; };
    this.clearLeft = () => { this.leftStick.x = 0; this.leftStick.y = 0; };
    this.clearRight = () => { this.rightStick.x = 0; this.rightStick.y = 0; };
    this.keyDown = (event) => this.keys.add(event.code);
    this.keyUp = (event) => this.keys.delete(event.code);
  },
  play() {
    this.data.leftController?.addEventListener("thumbstickmoved", this.leftMove);
    this.data.leftController?.addEventListener("thumbsticktouchend", this.clearLeft);
    this.data.rightController?.addEventListener("thumbstickmoved", this.rightMove);
    this.data.rightController?.addEventListener("thumbsticktouchend", this.clearRight);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
  },
  pause() {
    this.data.leftController?.removeEventListener("thumbstickmoved", this.leftMove);
    this.data.leftController?.removeEventListener("thumbsticktouchend", this.clearLeft);
    this.data.rightController?.removeEventListener("thumbstickmoved", this.rightMove);
    this.data.rightController?.removeEventListener("thumbsticktouchend", this.clearRight);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
  },
  tick(time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    if (!dt || !this.data.camera) return;
    if (Math.abs(this.rightStick.x) > 0.75 && time - this.lastTurn > this.data.turnCooldown) {
      this.el.object3D.rotation.y += THREE.MathUtils.degToRad(this.data.turnDegrees * (this.rightStick.x > 0 ? -1 : 1));
      this.lastTurn = time;
    }
    const keyX = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const keyY = (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) - (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0);
    const x = this.leftStick.x || keyX;
    const y = this.leftStick.y || keyY;
    this.yaw.setFromQuaternion(this.data.camera.object3D.quaternion);
    this.yaw.x = 0;
    this.yaw.z = 0;
    this.forward.set(0, 0, -1).applyEuler(this.yaw);
    this.right.set(1, 0, 0).applyEuler(this.yaw);
    this.move.set(0, 0, 0).addScaledVector(this.right, x).addScaledVector(this.forward, -y);
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.el.object3D.position.addScaledVector(this.move, this.data.moveSpeed * dt);
    this.el.object3D.position.y = 0;
  }
});

AFRAME.registerComponent("hand-pose", {
  schema: { hand: { default: "left" } },
  init() {
    this.pose = { grip: 0, trigger: 0, thumb: 0 };
    this.fingers = [];
    this.makeHand(this.data.hand === "left" ? "#FFB1C8" : "#98D9FF");
    this.bind("gripdown", "grip", 1); this.bind("gripup", "grip", 0);
    this.bind("triggerdown", "trigger", 1); this.bind("triggerup", "trigger", 0);
    this.bind(this.data.hand === "right" ? "abuttondown" : "xbuttondown", "thumb", 1);
    this.bind(this.data.hand === "right" ? "abuttonup" : "xbuttonup", "thumb", 0);
    this.bind(this.data.hand === "right" ? "bbuttondown" : "ybuttondown", "thumb", 1);
    this.bind(this.data.hand === "right" ? "bbuttonup" : "ybuttonup", "thumb", 0);
  },
  bind(event, key, value) { this.el.addEventListener(event, () => { this.pose[key] = value; }); },
  makeHand(color) {
    const palm = document.createElement("a-sphere");
    palm.setAttribute("radius", "0.075");
    palm.setAttribute("scale", "1.1 0.7 1.35");
    palm.setAttribute("color", color);
    this.el.appendChild(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = document.createElement("a-box");
      finger.setAttribute("width", "0.024");
      finger.setAttribute("height", "0.11");
      finger.setAttribute("depth", "0.024");
      finger.setAttribute("position", `${-0.045 + i * 0.03} -0.015 -0.095`);
      finger.setAttribute("color", color);
      this.el.appendChild(finger);
      this.fingers.push(finger);
    }
  },
  tick() { curlFingers(this.fingers, this.pose); }
});

function client() {
  if (state.client) return state.client;
  state.client = new MultiplayerClient(state.apiBase, {
    storageKey: "vr_can_move_session",
    pingMs: 4000,
    onSnapshot: (snapshot) => { state.snapshot = snapshot; renderMenu(); renderPlayers(snapshot); },
    onOpen: () => setStatus("Connected. Move around the arena."),
    onClose: () => setStatus("Realtime connection closed."),
    onError: (error) => setStatus(error.message)
  });
  return state.client;
}

function setStatus(text) {
  state.status = String(text || "");
  const note = document.getElementById("note");
  if (note) note.textContent = state.status;
  renderMenu();
}

function makeText(value, x, y, width = 2.2, color = "#111") {
  const text = document.createElement("a-text");
  text.setAttribute("value", value);
  text.setAttribute("position", `${x} ${y} .025`);
  text.setAttribute("align", "center");
  text.setAttribute("anchor", "center");
  text.setAttribute("baseline", "center");
  text.setAttribute("width", width);
  text.setAttribute("wrap-count", Math.max(18, width * 16));
  text.setAttribute("color", color);
  return text;
}

function makeButton(label, action, x, y, w = .72, h = .22, color = "#235C75") {
  const plane = document.createElement("a-plane");
  plane.classList.add("vr-clickable");
  plane.dataset.action = action;
  plane.setAttribute("position", `${x} ${y} .02`);
  plane.setAttribute("width", w);
  plane.setAttribute("height", h);
  plane.setAttribute("color", color);
  const text = makeText(label, 0, 0, w * 4, "#fff");
  text.setAttribute("position", "0 0 .02");
  plane.appendChild(text);
  return plane;
}

function renderMenu() {
  const root = document.getElementById("vr-menu-root");
  if (!root) return;
  root.innerHTML = "";
  const panel = document.createElement("a-entity");
  const bg = document.createElement("a-plane");
  bg.setAttribute("width", "2.8");
  bg.setAttribute("height", state.snapshot ? "1.25" : "2.25");
  bg.setAttribute("color", "#F6FBFF");
  bg.setAttribute("opacity", ".96");
  panel.appendChild(bg);
  panel.appendChild(makeText("VR Can Move Multiplayer", 0, state.snapshot ? .45 : .95, 2.25));
  panel.appendChild(makeText(state.status, 0, state.snapshot ? .24 : .72, 2.35, "#27414E"));
  if (state.snapshot) {
    const code = state.snapshot.code ? ` code ${state.snapshot.code}` : "";
    panel.appendChild(makeText(`${state.snapshot.name}${code} | ${state.snapshot.playerCount}/${state.snapshot.maxPlayers}`, 0, .02, 2.3));
    panel.appendChild(makeButton("Leave", "leave", -.45, -.35, .7, .24, "#8F2F3D"));
    panel.appendChild(makeButton("Refresh", "refresh", .45, -.35, .7, .24, "#235C75"));
    root.appendChild(panel);
    return;
  }
  panel.appendChild(makeText(`API: ${state.apiBase}`, 0, .52, 2.35, "#45606C"));
  panel.appendChild(makeButton("Create Public", "create-public", -.52, .22, .9, .24));
  panel.appendChild(makeButton("Create Private", "create-private", .52, .22, .9, .24, "#335C2A"));
  panel.appendChild(makeButton("Refresh Public", "refresh", 0, -.08, 1.1, .23, "#4E5366"));
  panel.appendChild(makeText(`Join Code: ${formatCode()}`, 0, -.38, 2.2));
  panel.appendChild(makeButton("<", "code-left", -.95, -.67, .28, .22, "#5C6472"));
  panel.appendChild(makeButton("Prev", "code-prev", -.53, -.67, .48, .22, "#5C6472"));
  panel.appendChild(makeButton("Next", "code-next", .03, -.67, .48, .22, "#5C6472"));
  panel.appendChild(makeButton(">", "code-right", .45, -.67, .28, .22, "#5C6472"));
  panel.appendChild(makeButton("Join Code", "join-code", .95, -.67, .6, .22, "#7A4C1C"));
  panel.appendChild(makeText(state.publicLobbies.length ? "Public lobbies" : "No public lobbies loaded", 0, -.95, 2.2, "#27414E"));
  state.publicLobbies.slice(0, 3).forEach((lobby, i) => panel.appendChild(makeButton(`${lobby.name} ${lobby.playerCount}/${lobby.maxPlayers}`, `join:${lobby.lobbyId}`, 0, -1.2 - i * .25, 1.8, .2, "#3D6170")));
  root.appendChild(panel);
}

function formatCode() { return state.joinCode.split("").map((c, i) => i === state.codeIndex ? `[${c}]` : ` ${c} `).join(""); }
function lobbyOptions(extra = {}) { return { playerName: state.playerName, maxPlayers: 12, playerState: localState(), playerMeta: { color: state.color }, ...extra }; }

async function action(name) {
  try {
    const c = client();
    if (name === "refresh") { state.publicLobbies = await c.listPublicLobbies(); setStatus("Public lobbies refreshed."); return; }
    if (name === "create-public") { await c.createLobby(lobbyOptions({ privateLobby: false, lobbyName: `${state.playerName} public` })); setStatus("Public lobby ready."); return; }
    if (name === "create-private") { await c.createLobby(lobbyOptions({ privateLobby: true, lobbyName: `${state.playerName} private` })); setStatus("Private lobby ready."); return; }
    if (name === "join-code") { await c.joinLobbyByCode(lobbyOptions({ code: state.joinCode })); setStatus("Joined private lobby."); return; }
    if (name === "leave") { await c.leave(); state.snapshot = null; renderPlayers(null); setStatus("Left lobby."); return; }
    if (name.startsWith("join:")) { await c.joinLobbyById(lobbyOptions({ lobbyId: name.slice(5) })); setStatus("Joined public lobby."); return; }
    editCode(name);
  } catch (error) { setStatus(error.message || "Multiplayer action failed."); }
}

function editCode(name) {
  const chars = state.joinCode.split("");
  if (name === "code-left") state.codeIndex = (state.codeIndex + 5) % 6;
  if (name === "code-right") state.codeIndex = (state.codeIndex + 1) % 6;
  if (name === "code-prev" || name === "code-next") {
    const current = codeChars.indexOf(chars[state.codeIndex]);
    chars[state.codeIndex] = codeChars[(current + (name === "code-next" ? 1 : -1) + codeChars.length) % codeChars.length];
    state.joinCode = chars.join("");
  }
  renderMenu();
}

function localState() {
  const rig = document.getElementById("player-rig");
  const cam = document.getElementById("player-camera");
  const left = document.getElementById("left-controller");
  const right = document.getElementById("right-controller");
  return { rig: vec(rig.object3D.position), rotationY: rig.object3D.rotation.y, head: part(cam), leftHand: part(left, left.components["hand-pose"]?.pose), rightHand: part(right, right.components["hand-pose"]?.pose) };
}
function part(el, pose = null) {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  el.object3D.getWorldPosition(p);
  el.object3D.getWorldQuaternion(q);
  return { position: vec(p), quaternion: [q.x, q.y, q.z, q.w], pose: pose || undefined };
}
function vec(v) { return { x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000, z: Math.round(v.z * 1000) / 1000 }; }

function renderPlayers(snapshot) {
  const root = document.getElementById("remote-players");
  if (!root) return;
  const live = new Set();
  for (const player of snapshot?.players || []) {
    if (player.isYou) continue;
    live.add(player.playerId);
    let avatar = state.avatars.get(player.playerId);
    if (!avatar) { avatar = makeAvatar(player); state.avatars.set(player.playerId, avatar); root.appendChild(avatar.root); }
    updateAvatar(avatar, player);
  }
  for (const [id, avatar] of state.avatars.entries()) if (!live.has(id)) { avatar.root.remove(); state.avatars.delete(id); }
}

function makeAvatar(player) {
  const root = document.createElement("a-entity");
  const body = document.createElement("a-cone");
  body.setAttribute("radius-bottom", ".34"); body.setAttribute("radius-top", ".18"); body.setAttribute("height", "1.05"); body.setAttribute("position", "0 .55 0"); body.setAttribute("color", player.meta?.color || "#F4E3B2"); root.appendChild(body);
  const head = document.createElement("a-sphere");
  head.setAttribute("radius", ".28"); head.setAttribute("position", "0 1.22 0"); head.setAttribute("color", "#FFF3D5"); root.appendChild(head);
  const face = document.createElement("a-entity"); face.setAttribute("position", "0 1.22 -.265"); root.appendChild(face);
  dot(face, -.085, .045, .028, 1); dot(face, .085, .045, .028, 1); dot(face, 0, -.065, .075, .35);
  const name = makeText(player.name, 0, 1.65, 2.6); root.appendChild(name);
  const left = remoteHand("#FFB1C8"); const right = remoteHand("#98D9FF"); root.appendChild(left.root); root.appendChild(right.root);
  return { root, name, left, right };
}
function dot(parent, x, y, r, sy) { const d = document.createElement("a-sphere"); d.setAttribute("radius", r); d.setAttribute("scale", `1 ${sy} .18`); d.setAttribute("position", `${x} ${y} 0`); d.setAttribute("color", "#111"); parent.appendChild(d); }
function remoteHand(color) {
  const root = document.createElement("a-entity"); const palm = document.createElement("a-sphere"); palm.setAttribute("radius", ".075"); palm.setAttribute("scale", "1.1 .7 1.35"); palm.setAttribute("color", color); root.appendChild(palm);
  const fingers = [];
  for (let i = 0; i < 4; i += 1) { const f = document.createElement("a-box"); f.setAttribute("width", ".024"); f.setAttribute("height", ".11"); f.setAttribute("depth", ".024"); f.setAttribute("position", `${-.045 + i * .03} -.015 -.095`); f.setAttribute("color", color); root.appendChild(f); fingers.push(f); }
  return { root, fingers };
}
function updateAvatar(avatar, player) {
  const s = player.state || {}; const r = s.rig || { x: 0, y: 0, z: 0 };
  avatar.root.object3D.position.set(r.x || 0, r.y || 0, r.z || 0); avatar.root.object3D.rotation.y = Number(s.rotationY || 0); avatar.name.setAttribute("value", `${player.name}${player.isHost ? " host" : ""}`);
  placeHand(avatar.left, s.leftHand, r); placeHand(avatar.right, s.rightHand, r);
}
function placeHand(hand, data, rig) {
  if (!data?.position) return;
  hand.root.object3D.position.set((data.position.x || 0) - (rig.x || 0), (data.position.y || 0) - (rig.y || 0), (data.position.z || 0) - (rig.z || 0));
  if (Array.isArray(data.quaternion)) hand.root.object3D.quaternion.set(data.quaternion[0] || 0, data.quaternion[1] || 0, data.quaternion[2] || 0, data.quaternion[3] || 1);
  curlFingers(hand.fingers, data.pose || {});
}
function curlFingers(fingers, pose) { const curl = Math.max(Number(pose.grip || 0), Number(pose.trigger || 0) * .75); fingers.forEach((f, i) => { f.object3D.rotation.x = THREE.MathUtils.degToRad(15 + curl * 72 + (i === 0 ? Number(pose.thumb || 0) * 25 : 0)); }); }

function selected(controller) {
  const hit = controller.components.raycaster?.intersections?.[0]?.object?.el;
  let el = hit;
  while (el && !el.classList?.contains("vr-clickable")) el = el.parentElement;
  if (el?.dataset.action) action(el.dataset.action);
}
function pushLoop(time) { if (state.client?.snapshot && time - state.lastPush > 95) { state.client.pushState(localState(), { color: state.color }); state.lastPush = time; } requestAnimationFrame(pushLoop); }

window.addEventListener("DOMContentLoaded", () => {
  localStorage.setItem("vr_can_move_api", state.apiBase);
  const menu = document.getElementById("vr-menu-root");
  menu.addEventListener("click", (event) => { let el = event.target; while (el && !el.classList?.contains("vr-clickable")) el = el.parentElement; if (el?.dataset.action) action(el.dataset.action); });
  for (const id of ["left-controller", "right-controller"]) { const c = document.getElementById(id); c.addEventListener("triggerdown", () => selected(c)); c.addEventListener("abuttondown", () => selected(c)); c.addEventListener("xbuttondown", () => selected(c)); }
  renderMenu();
  client().restore().then((snap) => { if (snap) setStatus("Session restored."); }).catch(() => {});
  client().listPublicLobbies().then((lobbies) => { state.publicLobbies = lobbies; renderMenu(); }).catch(() => {});
  requestAnimationFrame(pushLoop);
});
