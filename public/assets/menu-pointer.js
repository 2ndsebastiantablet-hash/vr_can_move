const POINTER_CONFIG = [
  { controllerId: "left-controller", pointerId: "left-menu-pointer", color: "#FFB1C8" },
  { controllerId: "right-controller", pointerId: "right-menu-pointer", color: "#98D9FF" }
];
const MENU_BUTTON_SELECTOR = ".vr-clickable";
const SELECTABLE_SELECTOR = ".selectable";
const RAY_NORMAL = "#00ffff";
const RAY_HOVER = "#ffff00";
const BUTTON_HOVER = "#44ccff";

const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const direction = new THREE.Vector3();
const rotation = new THREE.Quaternion();
let hoveredButtons = new Set();
let lobbyMenuForcedVisible = false;
let lastNoHitLog = 0;

function sceneEl() { return document.querySelector("a-scene"); }
function menuRoot() { return document.getElementById("vr-menu-root"); }
function isMenuVisible() { return menuRoot()?.object3D.visible !== false; }
function isLobbyMenu() { return Boolean(menuRoot()?.querySelector('[data-action="leave"]')); }

function makePointer(id, color) {
  const pointer = document.createElement("a-entity");
  pointer.setAttribute("id", id);
  pointer.setAttribute("visible", "false");
  pointer.setAttribute("geometry", "primitive: sphere; radius: 0.025; segmentsWidth: 16; segmentsHeight: 8");
  pointer.setAttribute("material", `color: ${color}; shader: flat; opacity: 0.95`);
  pointer.setAttribute("light", `type: point; color: ${color}; intensity: 0.25; distance: 0.35`);
  return pointer;
}

// Existing menu buttons are created in main.js as .vr-clickable planes. This marks
// those same entities as .selectable so controller raycasters only hit menu UI.
function refreshSelectableButtons() {
  for (const button of document.querySelectorAll(MENU_BUTTON_SELECTOR)) {
    button.classList.add("selectable");
    if (!button.dataset.baseColor) button.dataset.baseColor = button.getAttribute("color") || "#235C75";
    if (!button.dataset.baseScale) button.dataset.baseScale = button.getAttribute("scale") || "1 1 1";
  }
}

function setButtonHover(button, hovering) {
  if (!button) return;
  if (hovering) {
    button.setAttribute("color", BUTTON_HOVER);
    button.setAttribute("scale", "1.08 1.08 1.08");
  } else {
    button.setAttribute("color", button.dataset.baseColor || "#235C75");
    button.setAttribute("scale", button.dataset.baseScale || "1 1 1");
  }
}

function applyHoverSet(nextHovered) {
  for (const button of hoveredButtons) {
    if (!nextHovered.has(button)) {
      console.log("Menu hover end:", button.dataset.action || "unknown");
      setButtonHover(button, false);
    }
  }
  for (const button of nextHovered) {
    if (!hoveredButtons.has(button)) {
      console.log("Menu hover start:", button.dataset.action || "unknown");
      setButtonHover(button, true);
    }
  }
  hoveredButtons = nextHovered;
}

function setControllerRay(hand, hovering) {
  if (!hand) return;
  const color = hovering ? RAY_HOVER : RAY_NORMAL;
  hand.setAttribute("line", "color", color);
  hand.setAttribute("line", "opacity", hovering ? 1 : 0.85);
  hand.setAttribute("raycaster", "lineColor", color);
}

// Reuses the existing Quest controller entities. The raycaster is limited to
// .selectable so world geometry cannot block or accidentally receive menu clicks.
function setupControllerRay(hand) {
  if (!hand) return;
  hand.setAttribute("raycaster", "objects: .selectable; far: 12; showLine: true");
  hand.setAttribute("line", `color: ${RAY_NORMAL}; opacity: 0.85`);
}

function clickableFrom(el) {
  while (el && !el.classList?.contains("selectable")) el = el.parentElement;
  return el?.dataset?.action ? el : null;
}

function menuMeshes() {
  const root = menuRoot();
  if (!root || !isMenuVisible()) return [];
  const meshes = [];
  for (const button of document.querySelectorAll(SELECTABLE_SELECTOR)) {
    button.object3D.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
  }
  return meshes;
}

function manualControllerHit(controller, targets) {
  if (!controller || !targets.length) return null;
  sceneEl()?.object3D.updateMatrixWorld(true);
  controller.object3D.updateMatrixWorld(true);
  controller.object3D.getWorldPosition(origin);
  controller.object3D.getWorldQuaternion(rotation);
  direction.set(0, 0, -1).applyQuaternion(rotation).normalize();
  raycaster.set(origin, direction);
  raycaster.far = 12;
  return raycaster.intersectObjects(targets, false)[0] || null;
}

function cachedControllerHit(controller) {
  for (const hit of controller?.components?.raycaster?.intersections || []) {
    const button = clickableFrom(hit.object?.el);
    if (button) return { point: hit.point, distance: hit.distance, button };
  }
  return null;
}

function updatePointer(controller, pointer, targets) {
  if (!controller || !pointer || !targets.length) {
    pointer?.setAttribute("visible", "false");
    setControllerRay(controller, false);
    return null;
  }

  const cached = cachedControllerHit(controller);
  const manual = cached ? null : manualControllerHit(controller, targets);
  const hit = cached || (manual ? { point: manual.point, distance: manual.distance, button: clickableFrom(manual.object?.el) } : null);
  if (!hit?.button) {
    pointer.setAttribute("visible", "false");
    setControllerRay(controller, false);
    return null;
  }

  controller.object3D.getWorldQuaternion(rotation);
  direction.set(0, 0, -1).applyQuaternion(rotation).normalize();
  pointer.object3D.position.copy(hit.point).addScaledVector(direction, -0.025);
  pointer.object3D.scale.setScalar(Math.max(1, hit.distance * 0.35));
  pointer.setAttribute("visible", "true");
  setControllerRay(controller, true);
  return hit.button;
}

function currentButtonForHand(hand) {
  const cached = cachedControllerHit(hand);
  if (cached?.button) return cached.button;
  const manual = manualControllerHit(hand, menuMeshes());
  return clickableFrom(manual?.object?.el);
}

function logSelectAttempt(hand, eventName) {
  const button = currentButtonForHand(hand);
  if (!button) {
    const now = performance.now();
    if (now - lastNoHitLog > 500) {
      console.log("No menu raycaster intersections found for", hand?.id || "unknown controller");
      lastNoHitLog = now;
    }
    return null;
  }
  console.log("Menu button clicked:", button.dataset.action || "unknown", "via", eventName);
  return button;
}

function activateMenuButton(button) {
  if (!button) return;
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

function setupControllerSelectLogs(hand) {
  if (!hand) return;
  // Selection is intentionally trigger-only. X/Y/A/grip are reserved for other VR controls.
  hand.addEventListener("triggerdown", () => {
    const button = logSelectAttempt(hand, "triggerdown");
    activateMenuButton(button);
  });
}

function applyMenuVisibility() {
  const root = menuRoot();
  if (!root) return;
  const inLobby = isLobbyMenu();
  if (!inLobby) lobbyMenuForcedVisible = false;
  const visible = !inLobby || lobbyMenuForcedVisible;
  root.object3D.visible = visible;
  root.setAttribute("visible", visible ? "true" : "false");
  if (!visible) applyHoverSet(new Set());
}

function toggleLobbyMenu() {
  applyMenuVisibility();
  if (!isLobbyMenu()) return;
  lobbyMenuForcedVisible = !lobbyMenuForcedVisible;
  console.log("Lobby menu", lobbyMenuForcedVisible ? "shown" : "hidden", "from left controller menu button");
  applyMenuVisibility();
}

function setupMenuToggle(leftHand) {
  if (!leftHand) return;
  leftHand.addEventListener("menudown", toggleLobbyMenu);
  leftHand.addEventListener("buttondown", (event) => {
    const name = String(event.detail?.name || "").toLowerCase();
    if (name === "menu" || event.detail?.id === 4) toggleLobbyMenu();
  });
}

function makeDesktopReticle() {
  const reticle = document.createElement("div");
  reticle.style.cssText = "position:fixed;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border:2px solid #ffff00;border-radius:50%;pointer-events:none;z-index:20;opacity:.75";
  document.body.appendChild(reticle);
  sceneEl()?.addEventListener("enter-vr", () => { reticle.style.display = "none"; });
  sceneEl()?.addEventListener("exit-vr", () => { reticle.style.display = "block"; });
}

function startMenuPointers() {
  const scene = sceneEl();
  if (!scene) return;

  const pointers = POINTER_CONFIG.map((config) => {
    const hand = document.getElementById(config.controllerId);
    setupControllerRay(hand);
    setupControllerSelectLogs(hand);
    if (config.controllerId === "left-controller") setupMenuToggle(hand);
    const pointer = makePointer(config.pointerId, config.color);
    scene.appendChild(pointer);
    return { ...config, pointer };
  });

  refreshSelectableButtons();
  applyMenuVisibility();
  new MutationObserver(() => {
    refreshSelectableButtons();
    applyMenuVisibility();
  }).observe(menuRoot(), { childList: true, subtree: true });
  makeDesktopReticle();

  function tick() {
    refreshSelectableButtons();
    const targets = menuMeshes();
    const nextHovered = new Set();
    for (const entry of pointers) {
      const button = updatePointer(document.getElementById(entry.controllerId), entry.pointer, targets);
      if (button) nextHovered.add(button);
    }
    applyHoverSet(nextHovered);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

window.addEventListener("DOMContentLoaded", startMenuPointers);
