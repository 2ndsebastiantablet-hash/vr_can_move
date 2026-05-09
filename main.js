import { MultiplayerClient } from "./frontend/multiplayer-client.js";

const params = new URLSearchParams(window.location.search);
const defaultWs = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
const wsUrl = params.get("ws") || defaultWs;
const playerName = params.get("name") || `Player-${Math.floor(Math.random() * 900 + 100)}`;
const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NETWORK_SEND_INTERVAL = 50;
const REMOTE_SMOOTHING = 0.25;
const STALE_REMOTE_MS = 10000;

const state = {
  client: null,
  snapshot: null,
  avatars: new Map(),
  menuKey: null,
  lastPush: 0,
  lastSendLog: 0,
  lastDebugLog: 0,
  color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 55%)`
};

function $(id) {
  return document.getElementById(id);
}

function getMenuKey(snapshot) {
  if (!snapshot) return "no-lobby";
  const lobby = snapshot.lobby;
  const playerCount = snapshot.players.filter((player) => !player.disconnectedAt).length;
  return `${lobby.id}:${lobby.code}:${lobby.isPrivate}:${playerCount}`;
}

function client() {
  if (!state.client) {
    state.client = new MultiplayerClient({
      wsUrl,
      name: playerName,
      onStatus: setStatus,
      onSnapshot: (snapshot) => {
        state.snapshot = snapshot;
        const nextMenuKey = getMenuKey(snapshot);
        if (state.menuKey !== nextMenuKey) {
          state.menuKey = nextMenuKey;
          renderMenu();
        }
        renderPlayers(snapshot);
      }
    });
  }
  return state.client;
}

function setStatus(message) {
  const status = $("status-text");
  if (status) status.setAttribute("value", message || "");
}

function randomCode() {
  let code = "";
  for (let i = 0; i < 5; i += 1) code += codeChars[Math.floor(Math.random() * codeChars.length)];
  return code;
}

function makeButton(parent, id, label, position, action, width = 1.85, color = "#2a3342") {
  const box = document.createElement("a-box");
  box.setAttribute("id", id);
  box.setAttribute("class", "vr-clickable");
  box.setAttribute("position", position);
  box.setAttribute("width", width);
  box.setAttribute("height", "0.28");
  box.setAttribute("depth", "0.05");
  box.setAttribute("color", color);
  box.setAttribute("data-action", action);
  box.setAttribute("animation__mouseenter", "property: scale; to: 1.04 1.04 1.04; startEvents: mouseenter; dur: 120");
  box.setAttribute("animation__mouseleave", "property: scale; to: 1 1 1; startEvents: mouseleave; dur: 120");

  const text = document.createElement("a-text");
  text.setAttribute("value", label);
  text.setAttribute("align", "center");
  text.setAttribute("color", "#f8fafc");
  text.setAttribute("width", "3.2");
  text.setAttribute("position", "0 0 0.035");
  text.setAttribute("side", "double");
  box.appendChild(text);
  parent.appendChild(box);
  return box;
}

function renderMenu() {
  const menu = $("vr-menu-root");
  if (!menu) return;
  menu.innerHTML = "";

  const panel = document.createElement("a-entity");
  panel.setAttribute("position", "0 1.35 -2.25");

  const bg = document.createElement("a-box");
  bg.setAttribute("width", "2.55");
  bg.setAttribute("height", "2.35");
  bg.setAttribute("depth", "0.04");
  bg.setAttribute("color", "#111827");
  bg.setAttribute("opacity", "0.92");
  panel.appendChild(bg);

  const title = document.createElement("a-text");
  title.setAttribute("value", "VR Can Move");
  title.setAttribute("align", "center");
  title.setAttribute("color", "#ffffff");
  title.setAttribute("width", "3.3");
  title.setAttribute("position", "0 0.93 0.04");
  panel.appendChild(title);

  const info = document.createElement("a-text");
  info.setAttribute("id", "status-text");
  info.setAttribute("align", "center");
  info.setAttribute("color", "#cbd5e1");
  info.setAttribute("width", "2.8");
  info.setAttribute("position", "0 0.67 0.04");
  panel.appendChild(info);

  if (state.snapshot) {
    const lobby = state.snapshot.lobby;
    const playerCount = state.snapshot.players.filter((player) => !player.disconnectedAt).length;
    info.setAttribute("value", `${lobby.isPrivate ? "Private" : "Public"} lobby ${lobby.code}\nPlayers: ${playerCount}`);
    makeButton(panel, "leave-lobby", "Leave lobby", "0 0.25 0.04", "leave", 1.8, "#6b2737");
    makeButton(panel, "refresh-lobby", "Refresh lobby", "0 -0.12 0.04", "refresh", 1.8);
  } else {
    info.setAttribute("value", "Create or join a multiplayer room.");
    makeButton(panel, "create-public", "Create public", "0 0.36 0.04", "create-public", 1.9, "#215732");
    makeButton(panel, "create-private", "Create private", "0 0.0 0.04", "create-private", 1.9, "#21505f");
    makeButton(panel, "refresh-public", "Refresh public", "0 -0.36 0.04", "list", 1.9);

    const joinLabel = document.createElement("a-text");
    joinLabel.setAttribute("value", `Join code: ${$("join-code")?.getAttribute("value") || ""}`);
    joinLabel.setAttribute("align", "center");
    joinLabel.setAttribute("color", "#e2e8f0");
    joinLabel.setAttribute("width", "2.6");
    joinLabel.setAttribute("position", "0 -0.67 0.04");
    panel.appendChild(joinLabel);
    makeButton(panel, "random-code", "Random code", "-0.53 -0.93 0.04", "random-code", 0.92);
    makeButton(panel, "join-private", "Join", "0.53 -0.93 0.04", "join", 0.92, "#5b3f12");

    const lobbies = state.client?.publicLobbies || [];
    lobbies.slice(0, 2).forEach((lobby, index) => {
      makeButton(panel, `public-${lobby.id}`, `${lobby.code} (${lobby.playerCount})`, `0 ${-1.25 - index * 0.31} 0.04`, `join-public:${lobby.id}`, 1.7, "#374151");
    });
  }

  menu.appendChild(panel);
}

async function action(name) {
  try {
    if (name === "create-public") {
      await client().createLobby({ isPrivate: false });
      hideMenuAfterLobbyJoin();
    } else if (name === "create-private") {
      await client().createLobby({ isPrivate: true, code: randomCode() });
      hideMenuAfterLobbyJoin();
    } else if (name === "list") {
      await client().listPublicLobbies();
      state.menuKey = null;
      renderMenu();
    } else if (name === "random-code") {
      $("join-code")?.setAttribute("value", randomCode());
      state.menuKey = null;
      renderMenu();
    } else if (name === "join") {
      const code = $("join-code")?.getAttribute("value") || "";
      await client().joinLobby({ code: code.trim().toUpperCase() });
      hideMenuAfterLobbyJoin();
    } else if (name?.startsWith("join-public:")) {
      await client().joinLobby({ lobbyId: name.split(":")[1] });
      hideMenuAfterLobbyJoin();
    } else if (name === "refresh") {
      await client().requestSnapshot();
    } else if (name === "leave") {
      client().leave();
      state.snapshot = null;
      state.menuKey = null;
      renderMenu();
    }
  } catch (error) {
    setStatus(error.message);
  }
}

function hideMenuAfterLobbyJoin() {
  window.dispatchEvent(new CustomEvent("vr-menu-joined-lobby"));
}

function localState() {
  const rig = $("playerRig");
  const cam = $("camera");
  const left = $("left-controller");
  const right = $("right-controller");
  const rigObj = rig?.object3D;
  return {
    t: Date.now(),
    rig: rigObj ? { x: rigObj.position.x, y: rigObj.position.y, z: rigObj.position.z } : { x: 0, y: 0, z: 0 },
    rotationY: rigObj ? rigObj.rotation.y : 0,
    head: part(cam),
    leftHand: part(left, left?.components?.["hand-pose"]?.pose),
    rightHand: part(right, right?.components?.["hand-pose"]?.pose)
  };
}

function part(el, pose = null) {
  if (!el?.object3D) return null;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  el.object3D.updateMatrixWorld();
  el.object3D.getWorldPosition(pos);
  el.object3D.getWorldQuaternion(quat);
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: [quat.x, quat.y, quat.z, quat.w],
    pose
  };
}

function makeAvatar(player) {
  const root = document.createElement("a-entity");
  root.setAttribute("class", "remote-player");

  const body = document.createElement("a-cylinder");
  body.setAttribute("height", "1.15");
  body.setAttribute("radius", "0.23");
  body.setAttribute("position", "0 0.58 0");
  body.setAttribute("color", player.meta?.color || "#38bdf8");
  root.appendChild(body);

  const head = document.createElement("a-sphere");
  head.setAttribute("radius", "0.2");
  head.setAttribute("position", "0 1.28 0");
  head.setAttribute("color", "#f8fafc");
  root.appendChild(head);

  const face = document.createElement("a-entity");
  face.setAttribute("position", "0 1.28 -0.19");
  face.appendChild(dot("-0.055 0.035 0", 0.018));
  face.appendChild(dot("0.055 0.035 0", 0.018));
  const smile = document.createElement("a-torus");
  smile.setAttribute("radius", "0.075");
  smile.setAttribute("radius-tubular", "0.006");
  smile.setAttribute("arc", "120");
  smile.setAttribute("rotation", "0 0 210");
  smile.setAttribute("position", "0 -0.03 0");
  smile.setAttribute("color", "#111827");
  face.appendChild(smile);
  root.appendChild(face);

  const name = document.createElement("a-text");
  name.setAttribute("value", player.name || "Player");
  name.setAttribute("align", "center");
  name.setAttribute("position", "0 1.65 0");
  name.setAttribute("width", "2");
  root.appendChild(name);

  const left = remoteHand("#22c55e");
  const right = remoteHand("#f97316");
  root.appendChild(left.root);
  root.appendChild(right.root);

  $("arena")?.appendChild(root);
  console.log("[MP] Created remote avatar", player.playerId);
  return { root, body, head, name, left, right, target: player, lastUpdate: Date.now(), lastLog: 0 };
}

function dot(position, radius) {
  const eye = document.createElement("a-sphere");
  eye.setAttribute("radius", radius);
  eye.setAttribute("position", position);
  eye.setAttribute("color", "#111827");
  return eye;
}

function remoteHand(color) {
  const root = document.createElement("a-entity");
  const palm = document.createElement("a-sphere");
  palm.setAttribute("radius", "0.08");
  palm.setAttribute("color", color);
  root.appendChild(palm);
  const fingers = [];
  [-0.06, -0.02, 0.02, 0.06].forEach((x) => {
    const finger = document.createElement("a-cylinder");
    finger.setAttribute("radius", "0.012");
    finger.setAttribute("height", "0.16");
    finger.setAttribute("position", `${x} -0.09 -0.03`);
    finger.setAttribute("rotation", "25 0 0");
    finger.setAttribute("color", "#f8fafc");
    root.appendChild(finger);
    fingers.push(finger);
  });
  return { root, fingers };
}

function renderPlayers(snapshot) {
  const live = new Set();
  for (const player of snapshot?.players || []) {
    if (player.isYou || player.disconnectedAt) continue;
    live.add(player.playerId);
    let avatar = state.avatars.get(player.playerId);
    if (!avatar) {
      avatar = makeAvatar(player);
      state.avatars.set(player.playerId, avatar);
    }
    updateAvatarTarget(avatar, player);
  }

  for (const [id] of state.avatars.entries()) {
    if (!live.has(id)) removeRemoteAvatar(id, "snapshot removal");
  }
}

function updateAvatarTarget(avatar, player) {
  avatar.target = player;
  avatar.lastUpdate = Date.now();
  avatar.name.setAttribute("value", player.name || "Player");
  avatar.body.setAttribute("color", player.meta?.color || "#38bdf8");
  const now = Date.now();
  if (now - avatar.lastLog > 1000) {
    console.log("[MP] Received remote player state", player.playerId, player.state);
    avatar.lastLog = now;
  }
}

function removeRemoteAvatar(id, reason = "removed") {
  const avatar = state.avatars.get(id);
  if (!avatar) return;
  avatar.root.remove();
  state.avatars.delete(id);
  console.log("[MP] Removed remote avatar", id, reason);
}

function targetLocalFromWorld(worldPosition, rigPosition) {
  if (!worldPosition) return null;
  return {
    x: Number(worldPosition.x || 0) - Number(rigPosition?.x || 0),
    y: Number(worldPosition.y || 0) - Number(rigPosition?.y || 0),
    z: Number(worldPosition.z || 0) - Number(rigPosition?.z || 0)
  };
}

function lerpObjectPosition(object3D, target, amount) {
  if (!object3D || !target) return;
  object3D.position.lerp(new THREE.Vector3(Number(target.x || 0), Number(target.y || 0), Number(target.z || 0)), amount);
}

function lerpObjectRotationY(object3D, targetY, amount) {
  if (!object3D || targetY === undefined || targetY === null) return;
  object3D.rotation.y += (Number(targetY) - object3D.rotation.y) * amount;
}

function slerpObjectQuaternion(object3D, rotation, amount) {
  if (!object3D || !Array.isArray(rotation) || rotation.length !== 4) return;
  const target = new THREE.Quaternion(Number(rotation[0]), Number(rotation[1]), Number(rotation[2]), Number(rotation[3]));
  object3D.quaternion.slerp(target, amount);
}

function applyHandPose(hand, statePart, rigPosition) {
  if (!hand || !statePart) return;
  lerpObjectPosition(hand.root.object3D, targetLocalFromWorld(statePart.position, rigPosition), REMOTE_SMOOTHING);
  slerpObjectQuaternion(hand.root.object3D, statePart.rotation, REMOTE_SMOOTHING);
  const curl = statePart.pose?.grip ? 65 : statePart.pose?.pinch ? 42 : 12;
  hand.fingers.forEach((finger) => finger.object3D.rotation.x += (THREE.MathUtils.degToRad(curl) - finger.object3D.rotation.x) * REMOTE_SMOOTHING);
}

function updateRemoteAvatars() {
  const now = Date.now();
  for (const [id, avatar] of state.avatars.entries()) {
    if (now - avatar.lastUpdate > STALE_REMOTE_MS) {
      removeRemoteAvatar(id, "stale timeout");
      continue;
    }

    const player = avatar.target;
    const playerState = player?.state;
    if (!playerState) continue;
    const rigPosition = playerState.rig || { x: 0, y: 0, z: 0 };

    lerpObjectPosition(avatar.root.object3D, rigPosition, REMOTE_SMOOTHING);
    lerpObjectRotationY(avatar.root.object3D, playerState.rotationY, REMOTE_SMOOTHING);

    if (playerState.head) {
      lerpObjectPosition(avatar.head.object3D, targetLocalFromWorld(playerState.head.position, rigPosition), REMOTE_SMOOTHING);
      slerpObjectQuaternion(avatar.head.object3D, playerState.head.rotation, REMOTE_SMOOTHING);
    }
    applyHandPose(avatar.left, playerState.leftHand, rigPosition);
    applyHandPose(avatar.right, playerState.rightHand, rigPosition);
  }
  requestAnimationFrame(updateRemoteAvatars);
}

function pushLoop(time) {
  if (state.client?.snapshot && time - state.lastPush >= NETWORK_SEND_INTERVAL) {
    const payload = localState();
    state.client.pushState(payload, { color: state.color });
    state.lastPush = time;
    if (time - state.lastSendLog > 1000) {
      console.log("[MP] Sent local movement state", payload);
      state.lastSendLog = time;
    }
  }

  if (time - state.lastDebugLog > 5000) {
    const lobby = state.snapshot?.lobby;
    console.log("[MP DEBUG]", {
      playerName,
      lobbyId: lobby?.id,
      roomCode: lobby?.code,
      connected: state.client?.connected,
      remotePlayers: state.avatars.size
    });
    state.lastDebugLog = time;
  }

  requestAnimationFrame(pushLoop);
}

AFRAME.registerComponent("hand-pose", {
  schema: { hand: { type: "string", default: "left" } },
  init() {
    this.pose = { grip: false, pinch: false };
    this.el.addEventListener("gripdown", () => { this.pose.grip = true; this.curl(true); });
    this.el.addEventListener("gripup", () => { this.pose.grip = false; this.curl(false); });
    this.el.addEventListener("triggerdown", () => { this.pose.pinch = true; this.curl(true); });
    this.el.addEventListener("triggerup", () => { this.pose.pinch = false; this.curl(false); });
  },
  curl(active) {
    const hand = this.el.querySelector("[data-finger-root]");
    if (!hand) return;
    hand.querySelectorAll("[data-finger]").forEach((finger, index) => {
      finger.setAttribute("rotation", `${active ? 62 : 12} 0 ${index < 2 ? -7 : 7}`);
    });
  }
});

function selected(controller) {
  const raycaster = controller.components.raycaster;
  const hit = raycaster?.intersections?.[0]?.object?.el;
  const clickable = hit?.closest?.("[data-action]");
  if (clickable) action(clickable.dataset.action);
}

window.addEventListener("DOMContentLoaded", () => {
  localStorage.setItem("vr_player_name", playerName);
  if (params.get("restore") !== "1") {
    sessionStorage.removeItem("vr_can_move_session");
  }
  $("join-code")?.setAttribute("value", randomCode());
  $("vr-menu-root")?.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-action]");
    if (target) action(target.dataset.action);
  });
  renderMenu();
  client().listPublicLobbies().then(() => {
    state.menuKey = null;
    renderMenu();
  }).catch(() => {});
  if (params.get("restore") === "1") {
    client().restore().then((snap) => {
      if (snap) setStatus("Session restored.");
    }).catch(() => {});
  }
  for (const id of ["left-controller", "right-controller"]) {
    const controller = $(id);
    controller?.addEventListener("triggerdown", () => selected(controller));
  }
  requestAnimationFrame(pushLoop);
  requestAnimationFrame(updateRemoteAvatars);
});
