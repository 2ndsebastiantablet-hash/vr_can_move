export class MultiplayerClient {
  constructor(apiBase, options = {}) {
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.wsBase = (options.wsBase || this.apiBase).replace(/^http/, "ws");
    this.storageKey = options.storageKey || "multiplayer_template_session";
    this.pingMs = options.pingMs || 5000;

    this.socket = null;
    this.pingTimer = null;
    this.snapshot = null;
    this.playerState = {};
    this.playerMeta = {};
    this.session = this.loadSession();

    this.onSnapshot = options.onSnapshot || (() => {});
    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onChat = options.onChat || (() => {});
    this.onCustom = options.onCustom || (() => {});
    this.onError = options.onError || (() => {});
  }

  loadSession() {
    const raw = sessionStorage.getItem(this.storageKey);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.sessionToken && parsed?.lobbyId) {
        return parsed;
      }
    } catch {}

    sessionStorage.removeItem(this.storageKey);
    return null;
  }

  saveSession(session) {
    this.session = session;
    if (!session) {
      sessionStorage.removeItem(this.storageKey);
      return;
    }

    sessionStorage.setItem(this.storageKey, JSON.stringify(session));
  }

  async get(path) {
    const response = await fetch(`${this.apiBase}${path}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  async post(path, body = {}) {
    const response = await fetch(`${this.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  async listPublicLobbies() {
    const data = await this.get("/api/lobbies/public");
    return data.lobbies;
  }

  async createLobby(options) {
    this.playerState = options.playerState || {};
    this.playerMeta = options.playerMeta || {};

    const data = await this.post("/api/lobbies/create", options);
    this.saveSession({
      sessionToken: data.sessionToken,
      lobbyId: data.lobby.lobbyId,
    });
    this.snapshot = data.lobby;
    this.onSnapshot(this.snapshot);
    await this.connectSocket();
    return this.snapshot;
  }

  async joinLobbyById(options) {
    this.playerState = options.playerState || {};
    this.playerMeta = options.playerMeta || {};

    const data = await this.post("/api/lobbies/join", options);
    this.saveSession({
      sessionToken: data.sessionToken,
      lobbyId: data.lobby.lobbyId,
    });
    this.snapshot = data.lobby;
    this.onSnapshot(this.snapshot);
    await this.connectSocket();
    return this.snapshot;
  }

  async joinLobbyByCode(options) {
    return this.joinLobbyById(options);
  }

  async restore() {
    if (!this.session) return null;

    const data = await this.post("/api/lobbies/restore", {
      sessionToken: this.session.sessionToken,
      lobbyId: this.session.lobbyId,
    });
    this.snapshot = data.lobby;
    this.onSnapshot(this.snapshot);
    await this.connectSocket();
    return this.snapshot;
  }

  async leave() {
    if (!this.session) return;

    await this.post("/api/lobbies/leave", {
      sessionToken: this.session.sessionToken,
      lobbyId: this.session.lobbyId,
    });
    this.disconnectSocket();
    this.saveSession(null);
    this.snapshot = null;
  }

  async closeLobby() {
    if (!this.session) throw new Error("No active session.");

    await this.post("/api/lobbies/close", {
      sessionToken: this.session.sessionToken,
      lobbyId: this.session.lobbyId,
    });
    this.disconnectSocket();
    this.saveSession(null);
    this.snapshot = null;
  }

  async kickPlayer(targetPlayerId) {
    if (!this.session) throw new Error("No active session.");

    await this.post("/api/lobbies/kick", {
      sessionToken: this.session.sessionToken,
      lobbyId: this.session.lobbyId,
      targetPlayerId,
    });
  }

  async connectSocket() {
    if (!this.session) throw new Error("No session.");

    this.disconnectSocket();

    await new Promise((resolve, reject) => {
      const wsUrl = new URL(`${this.wsBase}/ws`);
      wsUrl.searchParams.set("lobbyId", this.session.lobbyId);
      wsUrl.searchParams.set("sessionToken", this.session.sessionToken);

      const socket = new WebSocket(wsUrl.toString());
      this.socket = socket;

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "auth_ok") {
          this.snapshot = message.lobby;
          this.onSnapshot(this.snapshot);
          this.startPing();
          this.onOpen(this.snapshot);
          resolve();
          return;
        }

        if (message.type === "lobby_snapshot") {
          this.snapshot = message.lobby;
          this.onSnapshot(this.snapshot);
          return;
        }

        if (message.type === "chat") {
          this.onChat(message);
          return;
        }

        if (message.type === "custom") {
          this.onCustom(message);
          return;
        }

        if (message.type === "error") {
          this.onError(new Error(message.error || "Socket error."));
        }
      });

      socket.addEventListener("close", () => {
        this.stopPing();
        this.onClose();
      });

      socket.addEventListener("error", () => {
        reject(new Error("WebSocket error."));
      });
    });
  }

  disconnectSocket() {
    this.stopPing();
    if (!this.socket) return;

    try {
      this.socket.close();
    } catch {}
    this.socket = null;
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "ping" }));
      }
    }, this.pingMs);
  }

  stopPing() {
    if (!this.pingTimer) return;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  pushState(nextState = {}, nextMeta = null) {
    this.playerState = { ...this.playerState, ...nextState };
    if (nextMeta) {
      this.playerMeta = { ...this.playerMeta, ...nextMeta };
    }

    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: "state_update",
        state: this.playerState,
        meta: this.playerMeta,
      }),
    );
  }

  sendChat(text) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: "chat",
        text: String(text || ""),
      }),
    );
  }

  sendCustom(customType, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: "custom",
        customType,
        payload,
      }),
    );
  }
}
