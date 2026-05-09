// Adapted from feeble/templates/simple-vr-scene at 28a426aa6ade789320e2202cfa8d2fe61b46b539.
// Keeps the scene static-host friendly while adding basic Quest movement.

AFRAME.registerComponent("quest-move", {
  schema: {
    leftController: { type: "selector" },
    rightController: { type: "selector" },
    camera: { type: "selector" },
    moveSpeed: { default: 2.8 },
    turnDegrees: { default: 30 },
    turnCooldown: { default: 280 }
  },

  init: function () {
    this.leftStick = { x: 0, y: 0 };
    this.rightStick = { x: 0, y: 0 };
    this.keyboardStick = { x: 0, y: 0 };
    this.keys = new Set();
    this.lastTurn = 0;

    this.yawEuler = new THREE.Euler(0, 0, 0, "YXZ");
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();

    this.onLeftThumbstick = this.onLeftThumbstick.bind(this);
    this.onRightThumbstick = this.onRightThumbstick.bind(this);
    this.clearLeftThumbstick = this.clearLeftThumbstick.bind(this);
    this.clearRightThumbstick = this.clearRightThumbstick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  },

  play: function () {
    if (this.data.leftController) {
      this.data.leftController.addEventListener("thumbstickmoved", this.onLeftThumbstick);
      this.data.leftController.addEventListener("thumbsticktouchend", this.clearLeftThumbstick);
    }

    if (this.data.rightController) {
      this.data.rightController.addEventListener("thumbstickmoved", this.onRightThumbstick);
      this.data.rightController.addEventListener("thumbsticktouchend", this.clearRightThumbstick);
    }

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  },

  pause: function () {
    if (this.data.leftController) {
      this.data.leftController.removeEventListener("thumbstickmoved", this.onLeftThumbstick);
      this.data.leftController.removeEventListener("thumbsticktouchend", this.clearLeftThumbstick);
    }

    if (this.data.rightController) {
      this.data.rightController.removeEventListener("thumbstickmoved", this.onRightThumbstick);
      this.data.rightController.removeEventListener("thumbsticktouchend", this.clearRightThumbstick);
    }

    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  },

  onLeftThumbstick: function (event) {
    this.leftStick.x = event.detail.x || 0;
    this.leftStick.y = event.detail.y || 0;
  },

  onRightThumbstick: function (event) {
    this.rightStick.x = event.detail.x || 0;
    this.rightStick.y = event.detail.y || 0;
  },

  clearLeftThumbstick: function () {
    this.leftStick.x = 0;
    this.leftStick.y = 0;
  },

  clearRightThumbstick: function () {
    this.rightStick.x = 0;
    this.rightStick.y = 0;
  },

  onKeyDown: function (event) {
    this.keys.add(event.code);
  },

  onKeyUp: function (event) {
    this.keys.delete(event.code);
  },

  tick: function (time, deltaMs) {
    if (!this.data.camera) {
      return;
    }

    const deltaTime = Math.min(deltaMs / 1000, 0.05);

    if (!deltaTime) {
      return;
    }

    this.updateKeyboardStick();
    this.applySnapTurn(time);

    this.yawEuler.setFromQuaternion(this.data.camera.object3D.quaternion);
    this.yawEuler.x = 0;
    this.yawEuler.z = 0;

    this.forward.set(0, 0, -1).applyEuler(this.yawEuler);
    this.right.set(1, 0, 0).applyEuler(this.yawEuler);

    this.move.set(0, 0, 0);
    const inputX = this.leftStick.x || this.keyboardStick.x;
    const inputY = this.leftStick.y || this.keyboardStick.y;

    this.move.addScaledVector(this.right, inputX);
    this.move.addScaledVector(this.forward, -inputY);

    if (this.move.lengthSq() > 1) {
      this.move.normalize();
    }

    this.el.object3D.position.addScaledVector(this.move, this.data.moveSpeed * deltaTime);
    this.el.object3D.position.y = 0;
  },

  applySnapTurn: function (time) {
    if (Math.abs(this.rightStick.x) < 0.75 || time - this.lastTurn < this.data.turnCooldown) {
      return;
    }

    const direction = this.rightStick.x > 0 ? -1 : 1;
    this.el.object3D.rotation.y += THREE.MathUtils.degToRad(this.data.turnDegrees * direction);
    this.lastTurn = time;
  },

  updateKeyboardStick: function () {
    let x = 0;
    let y = 0;

    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) {
      x -= 1;
    }
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) {
      x += 1;
    }
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) {
      y -= 1;
    }
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) {
      y += 1;
    }

    this.keyboardStick.x = x;
    this.keyboardStick.y = y;
  }
});

window.addEventListener("DOMContentLoaded", function () {
  const scene = document.querySelector("a-scene");
  const note = document.getElementById("note");

  if (!scene || !note) {
    return;
  }

  const defaultNote = note.textContent.trim();

  scene.addEventListener("enter-vr", function () {
    note.textContent = "VR session active";
  });

  scene.addEventListener("exit-vr", function () {
    note.textContent = defaultNote;
  });
});
