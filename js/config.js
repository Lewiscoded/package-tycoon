// =====================================================
//  Package Tycoon version (bump this for every release,
//  and add an entry to CHANGELOG.md)
// =====================================================
const GAME_VERSION = "1.0.1";

// =====================================================
//  config.js: all the numbers you might want to tweak
// =====================================================

const ROUTES = [
  { name: "NYC",   color: "#e74c3c", pay: 5 },
  { name: "LA",    color: "#3498db", pay: 6 },
  { name: "MIAMI", color: "#2ecc71", pay: 7 },
  { name: "CHI",   color: "#9b59b6", pay: 9 },   // unlocked with "New Route"
  { name: "SEA",   color: "#f39c12", pay: 11 },  // unlocked with "New Route"
];
const START_ROUTES = 3;

const DAY_LENGTH = 90;     // seconds per shift (at 1× speed)
const START_MONEY = 150;
const SAVE_KEY = "packageTycoon.v2";
const SETTINGS_KEY = "packageTycoon.settings";
const LEGACY_KEY = "packageTycoon.legacy";   // franchise progress survives every reset

// ---------- world layout ----------
const BELT_START = -12;
const BELT_END = 8;
const BELT_TOP = 1.2;
const PKG = 0.9;
const BIN_Z = 3.9;
const BIN_SIZE = 1.9;
const BIN_HEIGHT = 1.1;
const WALL = 0.12;
const PALLET_Z = 5.45;     // shipped boxes wait here for the truck
const LANE_Z = 7.5;        // truck road
const STATION_Z = -2.1;    // where workers / robots stand
const MAX_STATIONS = 8;
const stationX = i => 6 - i * 2.3;
const DRAG_HEIGHT = BELT_TOP + 1.4;

// ---------- package types ----------
const PACKAGE_TYPES = {
  standard: { payMult: 1, repGain: 1, missRep: 3 },
  priority: { payMult: 3, repGain: 2, missRep: 6 },
  fragile:  { payMult: 2, repGain: 1, missRep: 5 },
  perishable: { payMult: 4, repGain: 2, missRep: 8 }, // unlocked by research
};

// ---------- staff you can hire ----------
// "station" staff stand along the belt; the rest are one-per-warehouse roles.
const STAFF = {
  sorter: {
    name: "Sorter", icon: "🧑‍🏭", hire: 150, wage: 25, station: true,
    desc: "Sorts packages that pass their station. Makes the odd mistake. Handles fragile boxes once trained (Training Lv 2).",
  },
  robot: {
    name: "Robo-Sorter", icon: "🤖", hire: 900, wage: 15, station: true,
    desc: "Fast and never wrong. Breaks down now and then. Click it (or hire a Technician) to repair.",
  },
  dispatcher: {
    name: "Dispatcher", icon: "📋", hire: 300, wage: 35, max: 1,
    desc: "Ships bins as soon as they're full and a truck is free.",
  },
  technician: {
    name: "Technician", icon: "🔧", hire: 350, wage: 30, max: 1,
    desc: "Fixes belt jams and broken robots automatically.",
  },
  drone: {
    name: "Sorting Drone", icon: "🛸", hire: 700, wage: 20, max: 3, research: "drones",
    desc: "Flies over the whole belt and sorts anything, fragile included. Needs no station.",
  },
  manager: {
    name: "Manager", icon: "👔", hire: 1500, wage: 60, max: 1,
    desc: "Unlocks Autopilot (days run back-to-back) and Auto-Invest (spends spare cash on upgrades and staff).",
  },
};

// ---------- facility upgrades ----------
const UPGRADES = [
  { id: "motor", name: "⚡ Belt Motor", max: 5, cost: l => 120 * (l + 1),
    desc: l => `Belt runs ${12 * (l + 1)}% faster: more packages per day (and less time to sort them).` },
  { id: "expansion", name: "🏗️ Warehouse Expansion", max: 3, cost: l => 400 * (l + 1),
    desc: l => `+2 worker stations (${2 + 2 * l} → ${4 + 2 * l}).` },
  { id: "capacity", name: "📦 Bigger Bins", max: 5, cost: l => 80 * (l + 1),
    desc: l => `Bins hold ${8 + 3 * (l + 1)} packages (now ${8 + 3 * l}).` },
  { id: "fleet", name: "🚚 Truck Fleet", max: 4, cost: l => 300 * (l + 1),
    desc: l => `+1 truck (${2 + l} → ${3 + l}). Each truck costs $10/day upkeep.` },
  { id: "engines", name: "🛞 Truck Engines", max: 4, cost: l => 150 * (l + 1),
    desc: l => `Round trips take ${14 - 2.5 * (l + 1)}s (now ${14 - 2.5 * l}s).` },
  { id: "route", name: "🗺️ New Route", max: ROUTES.length - START_ROUTES, cost: l => 450 * (l + 1),
    desc: l => {
      const r = ROUTES[START_ROUTES + l];
      return r ? `Unlock ${r.name}: $${r.pay}/package and a new bin.` : "All routes unlocked.";
    } },
  { id: "marketing", name: "📣 Marketing", max: 5, cost: l => 200 * (l + 1),
    desc: () => "More packages arrive, and more of them are ★ priority or fragile (worth more)." },
  { id: "training", name: "🎓 Training Program", max: 3, cost: l => 250 * (l + 1),
    desc: l => `Sorters work ${25 * (l + 1)}% faster with fewer mistakes.${l + 1 === 2 ? " Unlocks fragile handling." : ""}` },
  { id: "reliability", name: "🛠️ Robot Maintenance", max: 3, cost: l => 300 * (l + 1),
    desc: () => "Robo-Sorters break down half as often." },
];

// ---------- research tree ----------
// Earn Research Points (RP) by sorting packages and finishing contracts.
const RESEARCH_BRANCHES = [
  { name: "Automation", icon: "🤖", color: "var(--sky)" },
  { name: "Logistics",  icon: "🚚", color: "var(--peach)" },
  { name: "Business",   icon: "💼", color: "var(--lilac)" },
];
const RESEARCH = [
  { id: "scanners",    branch: 0, cost: 5,  icon: "📟", name: "Barcode Scanners",   desc: "Sorters work 20% faster and make 30% fewer mistakes." },
  { id: "labeler",     branch: 0, cost: 12, icon: "🏷️", name: "Auto-Labeler",       desc: "Every sorter can handle ⚠ fragile packages." },
  { id: "drones",      branch: 0, cost: 25, icon: "🛸", name: "Sorting Drones",     desc: "Unlocks Drones: they fly over the belt and sort anywhere (hire up to 3)." },
  { id: "recycle",     branch: 0, cost: 50, icon: "♻️", name: "Recirculation Loop", desc: "Packages that reach the end loop back to the start once instead of falling off." },

  { id: "bulk",        branch: 1, cost: 6,  icon: "📦", name: "Bulk Shipping",      desc: "Shipping a completely full bin pays +25%." },
  { id: "nightshift",  branch: 1, cost: 14, icon: "🌙", name: "Night Shift",        desc: "Every day lasts 30 seconds longer." },
  { id: "perishables", branch: 1, cost: 28, icon: "❄️", name: "Cold Chain",         desc: "Unlocks ❄ Perishable packages: worth 4×, but missing one really hurts." },
  { id: "hub",         branch: 1, cost: 55, icon: "🏙️", name: "Mega Hub",           desc: "All shipments pay +20% and trucks come back twice as fast." },

  { id: "brand",       branch: 2, cost: 5,  icon: "🤝", name: "Brand Deals",        desc: "Contract rewards +50%." },
  { id: "hr",          branch: 2, cost: 12, icon: "🗂️", name: "HR Department",      desc: "All wages -20%." },
  { id: "loyalty",     branch: 2, cost: 24, icon: "💖", name: "Loyal Customers",    desc: "Reputation losses are halved." },
  { id: "investors",   branch: 2, cost: 45, icon: "📈", name: "Investors",          desc: "Earn 3% interest on your bank every night (up to $600)." },
];
// each node needs the one above it in its branch
RESEARCH.forEach((r, i) => {
  const prev = RESEARCH.slice(0, i).filter(x => x.branch === r.branch).pop();
  r.req = prev ? prev.id : null;
});
const RP_PER_PACKAGE = 0.1;
const RP_PER_CONTRACT = 5;

// ---------- franchise (prestige) ----------
// Sell your company for trophies. Each trophy ever earned = +10% income forever.
const FRANCHISE_MIN_DAY = 8;
const FRANCHISE_MIN_EARNED = 8000;
const trophiesFor = earned => Math.floor(Math.sqrt(earned / 2000));
const TROPHY_BONUS = 0.1;

const PERKS = [
  { id: "seed",    icon: "💵", name: "Seed Money",        max: 3, cost: 1, desc: "Start each company with +$300 per level." },
  { id: "rep",     icon: "⭐", name: "Brand Recognition", max: 2, cost: 1, desc: "+10 starting reputation per level." },
  { id: "crew",    icon: "🧑‍🏭", name: "Veteran Crew",      max: 2, cost: 2, desc: "Start with an extra Sorter already hired, per level." },
  { id: "notes",   icon: "📓", name: "Old Lab Notes",     max: 3, cost: 2, desc: "+25% Research Points per level." },
  { id: "partner", icon: "👔", name: "Silent Partner",    max: 1, cost: 5, desc: "Start every company with a Manager already hired." },
];

// ---------- online versus ----------
const VERSUS = {
  days: 3,            // match length
  startMoney: 300,
  peerPrefix: "pkgtycoon-v1-", // room ids on the PeerJS server
};
const SABOTAGE = [
  { id: "jam",      icon: "🧱", name: "Jam belt",   cost: 150, cooldown: 25, desc: "Jams your rival's conveyor belt." },
  { id: "flood",    icon: "📦", name: "Junk flood", cost: 120, cooldown: 25, desc: "Starts a 10s rush hour at your rival's warehouse." },
  { id: "blackout", icon: "🌑", name: "Blackout",   cost: 200, cooldown: 35, desc: "Hides your rival's labels and bin colors for 8s." },
  { id: "shield",   icon: "🛡️", name: "Shield",     cost: 100, cooldown: 30, desc: "Blocks the next attack in the next 20s." },
];
const EMOTES = ["👋", "😂", "😤", "🔥", "GG"];
