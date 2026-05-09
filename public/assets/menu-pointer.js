const POINTER_CONFIG = [
  { controllerId: "left-controller", pointerId: "left-menu-pointer", color: "#FFB1C8" },
  { controllerId: "right-controller", pointerId: "right-menu-pointer", color: "#98D9FF" }
];

const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const direction = new THREE.Vector3();
const rotation = new THREE.Quaternion();

function makePointer(id, color) {
  const pointer = document.createElement("a-entity");
  pointer.setAttribute("id", id);
  pointer.setAttribute("visible", "false");
  pointer.setAttribute("geometry", "primitive: sphere; radius: 0.025; segmentsWidth: 16; segmentsHeight: 8");
  pointer.setAttribute("material", `color: ${color}; shader: flat; opacity: 0.95`);
  pointer.setAttribute("light", `type: point; color: ${color}; intensity: 0.25; distance: 0.35`);
  return pointer;
}

function menuMeshes() {
  const meshes = [];
  for (const button of document.querySelectorAll(".vr-clickable")) {
    button.object3D.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
  }
  return meshes;
}

function updatePointer(controller, pointer, targets) {
  if (!controller || !pointer || !targets.length) {
    pointer?.setAttribute("visible", "false");
    return;
  }

  document.querySelector("a-scene")?.object3D.updateMatrixWorld(true);
  controller.object3D.updateMatrixWorld(true);
  controller.object3D.getWorldPosition(origin);
  controller.object3D.getWorldQuaternion(rotation);
  direction.set(0, 0, -1).applyQuaternion(rotation).normalize();
  raycaster.set(origin, direction);
  raycaster.far = 8;

  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) {
    pointer.setAttribute("visible", "false");
    return;
  }

  pointer.object3D.position.copy(hit.point).addScaledVector(direction, -0.025);
  pointer.object3D.scale.setScalar(Math.max(1, hit.distance * 0.35));
  pointer.setAttribute("visible", "true");
}

function startMenuPointers() {
  const scene = document.querySelector("a-scene");
  if (!scene) return;

  const pointers = POINTER_CONFIG.map((config) => {
    const pointer = makePointer(config.pointerId, config.color);
    scene.appendChild(pointer);
    return { ...config, pointer };
  });

  function tick() {
    const targets = menuMeshes();
    for (const entry of pointers) {
      updatePointer(document.getElementById(entry.controllerId), entry.pointer, targets);
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

window.addEventListener("DOMContentLoaded", startMenuPointers);
