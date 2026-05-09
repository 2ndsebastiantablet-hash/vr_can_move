# VR Can Move

A basic static WebXR scene for Meta Quest Browser using A-Frame.

## Source Template

This project is adapted from the requested template source of truth:

- repo: `2ndsebastiantablet-hash/feeble`
- commit: `28a426aa6ade789320e2202cfa8d2fe61b46b539`
- folder: `templates/simple-vr-scene`

The scene keeps the same simple A-Frame structure, including the normal A-Frame `Enter VR` button. It adds a small browser-only `quest-move` component for Quest left-stick movement and right-stick snap turning.

## Files

- `index.html` sets up the A-Frame WebXR scene, camera rig, Quest controllers, lights, floor, sky, and simple test shapes.
- `main.js` adds the movement helper and VR session status updates.
- `.nojekyll` keeps GitHub Pages from applying Jekyll processing.

## Hosting

No framework, build tool, npm install, or server code is required. Host the repository root as a static website over HTTPS, then open the hosted URL in Meta Quest Browser and press `Enter VR`.

For GitHub Pages, publish the `main` branch from the repository root.
