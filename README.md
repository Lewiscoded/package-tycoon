# Package Tycoon

A cozy 3D package-sorting tycoon game in HTML, CSS and JavaScript (three.js).
Double-click `index.html` to play (needs an internet connection to load three.js).

## Files
- `index.html`: page layout and HUD
- `css/style.css`: all the styling
- `js/config.js`: **balance numbers**: routes, staff, upgrades, day length
- `js/audio.js`: synth sound effects
- `js/world.js`: 3D scene: warehouse, belt, lights, models, particles
- `js/entities.js`: bins, packages, trucks, staff models
- `js/ui.js`: HUD, toasts, Manage panel, menus
- `js/net.js`: online 1v1 Versus mode (PeerJS)
- `js/game.js`: game state, day cycle, staff AI, input, main loop

## Features
- Drag-and-drop sorting, trucks, contracts, belt jams, rush hours
- Staff: sorters, robo-sorters, drones, dispatcher, technician, manager (autopilot)
- Research Lab (press R): 12 techs in 3 branches
- Franchise prestige: trophies = permanent income bonus + Legacy Perks
- **Online Versus**: race a friend over the internet with a room code (encrypted peer-to-peer via PeerJS)

## Playing online
Open the hosted page, click **Play online (Versus)**, and either create a room or enter your friend's code.
