import { DurableObject } from "cloudflare:workers";

const DIRECTORY_OBJECT_NAME = "global-lobby-directory";
const MAX_PLAYERS = 12;

function now() { return Date.now(); }
function randomId(bytes = 16) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function cleanCode(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }
function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function sanitizeText(value, fallback, limit) { return String(value || fallback).trim().slice(0, limit) || fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function num(value, fallback = 0, min = -80, max = 80) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}
function vector(value, fallback) {
  return { x: num(value?.x, fallback.x), y: num(value?.y, fallback.y, -10, 30), z: num(value?.z, fallback.z) };
}
function pose(value) {
  return { grip: num(value?.grip, 0, 0, 1), trigger: num(value?.trigger, 0, 0, 1), thumb: num(value?.thumb, 0, 0, 1) };
}
function quat(value) {
  return Array.isArray(value) && value.length === 4 ? value.map((part, i) => num(part, i === 3 ? 1 : 0, -1, 1)) : [0, 0, 0, 1];
}
function part(value, fallback) {
  return { position: vector(value?.position, fallback), quaternion: quat(value?.quaternion), pose: pose(value?.pose) };
}
function sanitizeState(state = {}) {
  return {
    rig: vector(state.rig, { x: 0, y: 0, z: 4 }),
    rotationY: num(state.rotationY, 0, -Math.PI * 4, Math.PI * 4),
    head: part(state.head, { x: 0, y: 1.6, z: 4 }),
    leftHand: part(state.leftHand, { x: -0.3, y: 1.2, z: 3.6 }),
    rightHand: part(state.rightHand, { x: 0.3, y: 1.2, z: 3.6 })
  };
}
function sanitizeMeta(meta = {}) {
  const color = String(meta.color || "#F4E3B2");
  return { color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#F4E3B2" };
}
async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON body.");
  return parsed;
}
function cors(origin = "*") {
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
}
function json(payload, status = 200, origin = "*") {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) } });
}
function jsonRequest(url, body) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function parse(response) {
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed.");
  return data;
}
function sortPlayers(players) { return Object.values(players).sort((a, b) => a.joinedSeq - b.joinedSeq); }

class LobbyService {
  constructor(env) { this.env = env; }
  directory() { return this.env.LOBBY_DIRECTORY.get(this.env.LOBBY_DIRECTORY.idFromName(DIRECTORY_OBJECT_NAME)); }
  room(lobbyId) { return this.env.GAME_ROOM.get(this.env.GAME_ROOM.idFromName(lobbyId)); }
  async listPublicLobbies() { return parse(await this.directory().fetch("https://directory.internal/directory/public")); }
  async createLobby(body) { return parse(await this.directory().fetch(jsonRequest("https://directory.internal/directory/create", body))); }
  async joinLobby(body) { return parse(await this.directory().fetch(jsonRequest("https://directory.internal/directory/join", body))); }
  async restoreSession(body) { return parse(await this.room(body.lobbyId).fetch(jsonRequest("https://room.internal/room/restore", body))); }
  async leaveLobby(body) { return parse(await this.room(body.lobbyId).fetch(jsonRequest("https://room.internal/room/leave", body))); }
  async connectSocket(request, lobbyId, sessionToken) {
    const url = new URL("https://room.internal/room/ws");
    url.searchParams.set("sessionToken", sessionToken);
    return this.room(lobbyId).fetch(new Request(url, { headers: request.headers }));
  }
}

export class LobbyDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.loaded = false;
    this.publicLobbies = {};
    this.codeLookup = {};
    this.lobbyMeta = {};
  }
  async load() {
    if (this.loaded) return;
    this.publicLobbies = (await this.ctx.storage.get("publicLobbies")) || {};
    this.codeLookup = (await this.ctx.storage.get("codeLookup")) || {};
    this.lobbyMeta = (await this.ctx.storage.get("lobbyMeta")) || {};
    this.loaded = true;
  }
  async save() {
    await this.ctx.storage.put("publicLobbies", this.publicLobbies);
    await this.ctx.storage.put("codeLookup", this.codeLookup);
    await this.ctx.storage.put("lobbyMeta", this.lobbyMeta);
  }
  room(lobbyId) { return this.env.GAME_ROOM.get(this.env.GAME_ROOM.idFromName(lobbyId)); }
  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/directory/public") {
      return json({ ok: true, lobbies: Object.values(this.publicLobbies).sort((a, b) => b.createdAt - a.createdAt) });
    }
    try {
      const body = await readJson(request);
      if (url.pathname === "/directory/create") return this.create(body);
      if (url.pathname === "/directory/join") return this.join(body);
      if (url.pathname === "/directory/update-summary") return this.updateSummary(body);
      return json({ ok: false, error: "Not found." }, 404);
    } catch (error) {
      return json({ ok: false, error: error.message || "Directory request failed." }, 400);
    }
  }
  async create(body) {
    const privateLobby = Boolean(body.privateLobby);
    let code = null;
    if (privateLobby) {
      code = cleanCode(body.code) || generateCode();
      while (this.codeLookup[code]) code = generateCode();
    }
    const lobbyId = crypto.randomUUID();
    const roomData = await parse(await this.room(lobbyId).fetch(jsonRequest("https://room.internal/room/create", {
      lobbyId,
      lobbyName: sanitizeText(body.lobbyName, "VR Lobby", 48),
      privateLobby,
      code,
      maxPlayers: clamp(Number(body.maxPlayers || MAX_PLAYERS), 2, Number(this.env.MAX_PLAYERS_PER_LOBBY || MAX_PLAYERS)),
      playerName: sanitizeText(body.playerName, "Player", 24),
      playerState: body.playerState,
      playerMeta: body.playerMeta
    })));
    this.lobbyMeta[lobbyId] = { private: privateLobby, code };
    if (code) this.codeLookup[code] = lobbyId;
    if (!privateLobby) this.publicLobbies[lobbyId] = summary(roomData.lobby);
    await this.save();
    return json(roomData);
  }
  async join(body) {
    const lobbyId = cleanCode(body.code) ? this.codeLookup[cleanCode(body.code)] : body.lobbyId;
    if (!lobbyId || !this.lobbyMeta[lobbyId]) throw new Error("Lobby not found.");
    const roomData = await parse(await this.room(lobbyId).fetch(jsonRequest("https://room.internal/room/join", body)));
    if (!this.lobbyMeta[lobbyId].private) this.publicLobbies[lobbyId] = summary(roomData.lobby);
    await this.save();
    return json(roomData);
  }
  async updateSummary(body) {
    if (!body.lobbyId) return json({ ok: true });
    if (body.remove) {
      const meta = this.lobbyMeta[body.lobbyId];
      delete this.publicLobbies[body.lobbyId];
      delete this.lobbyMeta[body.lobbyId];
      if (meta?.code) delete this.codeLookup[meta.code];
    } else if (body.summary && !this.lobbyMeta[body.lobbyId]?.private) {
      this.publicLobbies[body.lobbyId] = body.summary;
    }
    await this.save();
    return json({ ok: true });
  }
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.loaded = false;
    this.meta = null;
    this.players = {};
    this.sockets = new Map();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.sessionToken) this.sockets.set(attachment.sessionToken, socket);
    }
  }
  async load() {
    if (this.loaded) return;
    this.meta = (await this.ctx.storage.get("meta")) || null;
    this.players = (await this.ctx.storage.get("players")) || {};
    this.loaded = true;
  }
  async save() {
    await this.ctx.storage.put("meta", this.meta);
    await this.ctx.storage.put("players", this.players);
  }
  player(name, state, meta, isHost) {
    return {
      sessionToken: randomId(24),
      playerId: randomId(8),
      name: sanitizeText(name, "Player", 24),
      joinedSeq: (this.meta.nextJoinSeq || 0) + 1,
      joinedAt: now(),
      lastSeen: now(),
      disconnectedAt: null,
      isHost,
      state: sanitizeState(state),
      meta: sanitizeMeta(meta)
    };
  }
  snapshot(sessionToken = null) {
    const players = sortPlayers(this.players).map((player) => ({
      playerId: player.playerId,
      name: player.name,
      isYou: player.sessionToken === sessionToken,
      isHost: player.isHost,
      joinedAt: player.joinedAt,
      lastSeen: player.lastSeen,
      disconnectedAt: player.disconnectedAt,
      state: player.state,
      meta: player.meta
    }));
    return { lobbyId: this.meta.lobbyId, name: this.meta.name, private: this.meta.private, code: this.meta.private ? this.meta.code : null, maxPlayers: this.meta.maxPlayers, playerCount: players.length, createdAt: this.meta.createdAt, you: sessionToken, players };
  }
  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/room/ws") return this.ws(request, url);
      const body = await readJson(request);
      if (url.pathname === "/room/create") return this.create(body);
      if (url.pathname === "/room/join") return this.join(body);
      if (url.pathname === "/room/restore") return this.restore(body);
      if (url.pathname === "/room/leave") return this.leave(body.sessionToken);
      return json({ ok: false, error: "Not found." }, 404);
    } catch (error) {
      return json({ ok: false, error: error.message || "Room request failed." }, 400);
    }
  }
  async create(body) {
    this.meta = { lobbyId: body.lobbyId, name: body.lobbyName, private: Boolean(body.privateLobby), code: body.code || null, maxPlayers: Number(body.maxPlayers || MAX_PLAYERS), createdAt: now(), nextJoinSeq: 0 };
    const host = this.player(body.playerName, body.playerState, body.playerMeta, true);
    this.meta.nextJoinSeq = host.joinedSeq;
    this.players[host.sessionToken] = host;
    await this.save();
    await this.syncDirectory();
    return json({ ok: true, sessionToken: host.sessionToken, lobby: this.snapshot(host.sessionToken) });
  }
  async join(body) {
    if (!this.meta) throw new Error("Lobby not found.");
    if (Object.keys(this.players).length >= this.meta.maxPlayers) throw new Error("Lobby is full.");
    const joined = this.player(body.playerName, body.playerState, body.playerMeta, false);
    this.meta.nextJoinSeq = joined.joinedSeq;
    this.players[joined.sessionToken] = joined;
    await this.save();
    await this.syncDirectory();
    this.broadcastSnapshot();
    return json({ ok: true, sessionToken: joined.sessionToken, lobby: this.snapshot(joined.sessionToken) });
  }
  async restore(body) {
    const player = this.players[body.sessionToken];
    if (!player || !this.meta) throw new Error("Session not found.");
    player.lastSeen = now();
    player.disconnectedAt = null;
    await this.save();
    return json({ ok: true, sessionToken: body.sessionToken, lobby: this.snapshot(body.sessionToken) });
  }
  async leave(sessionToken) {
    delete this.players[sessionToken];
    if (!Object.values(this.players).some((player) => player.isHost)) {
      const nextHost = sortPlayers(this.players)[0];
      if (nextHost) nextHost.isHost = true;
    }
    await this.save();
    await this.syncDirectory();
    this.broadcastSnapshot();
    return json({ ok: true, left: true });
  }
  async ws(request, url) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") throw new Error("Expected a WebSocket upgrade.");
    const sessionToken = url.searchParams.get("sessionToken");
    const player = this.players[sessionToken];
    if (!this.meta || !player) return new Response("Session not found.", { status: 404 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sessionToken });
    this.sockets.set(sessionToken, server);
    player.disconnectedAt = null;
    player.lastSeen = now();
    await this.save();
    server.send(JSON.stringify({ type: "auth_ok", sessionToken, lobby: this.snapshot(sessionToken) }));
    this.broadcastSnapshot();
    return new Response(null, { status: 101, webSocket: client });
  }
  token(socket) { return socket.deserializeAttachment()?.sessionToken || null; }
  broadcast(payloadFor) {
    for (const [token, socket] of this.sockets.entries()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payloadFor(token)));
    }
  }
  broadcastSnapshot() { if (this.meta) this.broadcast((token) => ({ type: "lobby_snapshot", lobby: this.snapshot(token) })); }
  async webSocketMessage(socket, message) {
    await this.load();
    const sessionToken = this.token(socket);
    const player = this.players[sessionToken];
    if (!player) return;
    const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    player.lastSeen = now();
    player.disconnectedAt = null;
    if (data.type === "ping") socket.send(JSON.stringify({ type: "pong", ts: now() }));
    if (data.type === "state_update") {
      player.state = sanitizeState(data.state);
      player.meta = sanitizeMeta(data.meta);
      await this.save();
      this.broadcastSnapshot();
    }
  }
  async webSocketClose(socket) {
    await this.load();
    const sessionToken = this.token(socket);
    if (sessionToken && this.players[sessionToken]) {
      this.players[sessionToken].disconnectedAt = now();
      this.sockets.delete(sessionToken);
      await this.save();
      this.broadcastSnapshot();
    }
  }
  async syncDirectory() {
    const directory = this.env.LOBBY_DIRECTORY.get(this.env.LOBBY_DIRECTORY.idFromName(DIRECTORY_OBJECT_NAME));
    await directory.fetch(jsonRequest("https://directory.internal/directory/update-summary", { lobbyId: this.meta?.lobbyId, remove: !this.meta || Object.keys(this.players).length === 0, summary: this.meta ? summary(this.snapshot()) : null }));
  }
}

function summary(snapshot) {
  const host = snapshot.players.find((player) => player.isHost);
  return { lobbyId: snapshot.lobbyId, name: snapshot.name, private: false, playerCount: snapshot.playerCount, maxPlayers: snapshot.maxPlayers, hostName: host?.name || null, createdAt: snapshot.createdAt };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";
    const lobbyService = new LobbyService(env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    try {
      if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, status: "healthy", runtime: "cloudflare-workers", maxPlayersPerLobby: Number(env.MAX_PLAYERS_PER_LOBBY || MAX_PLAYERS) }, 200, origin);
      if (request.method === "GET" && url.pathname === "/api/lobbies/public") return json(await lobbyService.listPublicLobbies(), 200, origin);
      if (request.method === "POST" && url.pathname === "/api/lobbies/create") return json(await lobbyService.createLobby(await readJson(request)), 200, origin);
      if (request.method === "POST" && url.pathname === "/api/lobbies/join") return json(await lobbyService.joinLobby(await readJson(request)), 200, origin);
      if (request.method === "POST" && url.pathname === "/api/lobbies/restore") return json(await lobbyService.restoreSession(await readJson(request)), 200, origin);
      if (request.method === "POST" && url.pathname === "/api/lobbies/leave") return json(await lobbyService.leaveLobby(await readJson(request)), 200, origin);
      if (request.method === "GET" && url.pathname === "/ws") return lobbyService.connectSocket(request, url.searchParams.get("lobbyId"), url.searchParams.get("sessionToken"));
      return json({ ok: false, error: "Not found." }, 404, origin);
    } catch (error) {
      return json({ ok: false, error: error.message || "Request failed." }, 400, origin);
    }
  }
};
