# VR Can Move

A basic Meta Quest WebXR game using A-Frame with template-based multiplayer.

## Source Templates

VR scene base:

- repo: `2ndsebastiantablet-hash/feeble`
- commit: `28a426aa6ade789320e2202cfa8d2fe61b46b539`
- folder: `templates/simple-vr-scene`

Multiplayer base:

- repo: `2ndsebastiantablet-hash/fly-game`
- commit: `389610aa69a18eb56eadb228520a5f4dfd33109d`
- folder: `multiplayer-template`

The multiplayer system follows that template's Worker/Durable Object architecture: public and private lobbies, join codes, WebSocket snapshots, session restore, and browser-side `MultiplayerClient` state pushes.

## What Was Added

- VR controller laser menu for create public, create private, refresh public lobbies, and join by private code.
- Multiplayer browser client copied from the pinned template into `frontend/multiplayer-client.js`.
- Cloudflare Worker/Durable Object backend in `backend/server.js`, adapted for VR rig/head/hand state.
- Remote players rendered as bowling-pin characters with a two-dot smile face.
- Left and right hands with four fingers; grip, trigger, and controller face buttons curl the fingers and sync the pose.

## Play Flow

1. Deploy the Worker with `npm install` then `npm run deploy`.
2. Host the repository root as a static HTTPS site.
3. Open the game in Meta Quest Browser. If the Worker is on a different domain, open the game with `?api=https://your-worker-url`.
4. Press `Enter VR`.
5. Aim a controller laser at the VR menu and press trigger to create or join a lobby.

The frontend has no framework or build step. Wrangler is only for the multiplayer Worker backend.
