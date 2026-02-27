/**
 * ARGO MOBILE: RYOJI SOUND ENGINE
 * 
 * Mobile-optimized version:
 * - No sidebar (SIDEBAR_WIDTH = 0), fullscreen canvas
 * - Larger nodes for touch targets (baseRadius = 30)
 * - Touch event handling (touchStarted/touchEnded)
 * - Reduced node count (mobile layout JSON)
 * - Bottom drawer control panel
 */

let nodes = [];
let particles = [];
let audioSystem;
let isActive = false;
let currentKey = 0;
let currentScale = 'major';
let activeNode = null;
let lastPlayedNode = null;
let orbitMode = false;

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SIDEBAR_WIDTH = 0; // No sidebar on mobile

// Chord library loaded from JSON
let CHORD_LIBRARY;

// Data Holders
let majorProbTable, majorTransTable;
let minorProbTable, minorTransTable;
let majorLayoutData, minorLayoutData;
let CHORD_PROBABILITIES = new Map();
let CHORD_TRANSITIONS = new Map();

function preload() {
    // Load data files from parent directory
    majorProbTable = loadTable('../Major_Normalized_Probabilities.csv', 'csv', 'header');
    majorTransTable = loadTable('../Major_Normalized_Transitions.csv', 'csv', 'header');
    minorProbTable = loadTable('../Minor_Normalized_Probabilities.csv', 'csv', 'header');
    minorTransTable = loadTable('../Minor_Normalized_Transitions.csv', 'csv', 'header');
    CHORD_LIBRARY = loadJSON('../Chord_Definitions.json');
    // Mobile layout
    majorLayoutData = loadJSON('Chord_Layout_Config_Mobile_Major.json');
    // Minor uses parent for now
    minorLayoutData = loadJSON('../Chord_Layout_Config_v11_Minor.json');
}

// Notation Mapper: CSV (Nashville-ish) -> Roman Numerals
function mapCsvChordToRoman(csvName, isMinorContext) {
    if (!csvName) return null;
    const name = csvName.trim();
    const degreeMap = {
        '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII',
        'b1': 'bI', 'b2': 'bII', 'b3': 'bIII', 'b4': 'bIV', 'b5': 'bV', 'b6': 'bVI', 'b7': 'bVII',
        '#1': '#I', '#2': '#II', '#3': '#III', '#4': '#IV', '#5': '#V', '#6': '#VI', '#7': '#VII',
    };

    const match = name.match(/^([b#]?\d)(.*)/);
    if (!match) return name;

    const deg = match[1];
    const quality = match[2];
    const romanBase = degreeMap[deg];
    if (!romanBase) return name;

    const minorQualities = ['m7', 'm7b5', 'm6', 'mMaj7', 'dim7', '°7', 'mb5'];
    const isMinorChord = minorQualities.some(q => quality.startsWith(q));

    if (isMinorChord) {
        return romanBase.toLowerCase() + quality;
    }
    return romanBase + quality;
}

function processData() {
    console.log('Processing Probability Data...');

    const isMinor = currentScale === 'minor';
    const probTable = isMinor ? minorProbTable : majorProbTable;
    const transTable = isMinor ? minorTransTable : majorTransTable;
    const layoutData = isMinor ? minorLayoutData : majorLayoutData;

    CHORD_PROBABILITIES.clear();
    CHORD_TRANSITIONS.clear();

    const ALIASES = {
        'IIImMaj7': 'IIImaj7',
        'ImMaj7': 'Imaj7',
        'bVImMaj7': 'bVImaj7',
        'bIImMaj7': 'bIImaj7',
        'IVmMaj7': 'IVmaj7',
        'bIIImMaj7': 'bIIImaj7',
        'VIImMaj7': 'VIImaj7',
        'ivmaj7': 'IVmaj7',
        'IVm6': 'ivm6',
    };

    for (let r = 0; r < probTable.getRowCount(); r++) {
        const rawName = probTable.getString(r, 'Normalized_Chord');
        const prob = probTable.getNum(r, 'Probability');
        const romanName = mapCsvChordToRoman(rawName, isMinor);
        if (romanName) CHORD_PROBABILITIES.set(romanName, prob);
    }

    for (let r = 0; r < transTable.getRowCount(); r++) {
        const currentRaw = transTable.getString(r, 'Current_Chord');
        const nextRaw = transTable.getString(r, 'Next_Chord');
        const prob = transTable.getNum(r, 'Probability');
        const current = mapCsvChordToRoman(currentRaw, isMinor);
        const next = mapCsvChordToRoman(nextRaw, isMinor);
        if (!CHORD_TRANSITIONS.has(current)) {
            CHORD_TRANSITIONS.set(current, []);
        }
        CHORD_TRANSITIONS.get(current).push({ next: next, prob: prob });
    }

    const layoutNodeNames = layoutData.nodes ? layoutData.nodes.map(n => n.name) : [];

    for (const [alias, source] of Object.entries(ALIASES)) {
        if (!CHORD_TRANSITIONS.has(alias) && CHORD_TRANSITIONS.has(source)) {
            CHORD_TRANSITIONS.set(alias, [...CHORD_TRANSITIONS.get(source)]);
        }
        if (!CHORD_PROBABILITIES.has(alias) && CHORD_PROBABILITIES.has(source)) {
            CHORD_PROBABILITIES.set(alias, CHORD_PROBABILITIES.get(source));
        }
    }

    const reverseAliases = {};
    for (const [alias, source] of Object.entries(ALIASES)) {
        reverseAliases[source] = alias;
    }

    for (const [key, transitions] of CHORD_TRANSITIONS) {
        for (const trans of transitions) {
            if (!layoutNodeNames.includes(trans.next) && reverseAliases[trans.next]) {
                trans.next = reverseAliases[trans.next];
            }
        }
    }

    for (const node of layoutData.nodes || []) {
        let transitions = CHORD_TRANSITIONS.get(node.name) || [];
        if (!CHORD_TRANSITIONS.has(node.name)) {
            CHORD_TRANSITIONS.set(node.name, transitions);
        }
        const matchingTargets = transitions.filter(t => layoutNodeNames.includes(t.next));
        if (matchingTargets.length >= 5) continue;
        const needed = 5 - matchingTargets.length;
        const existingNextSet = new Set(transitions.map(t => t.next));
        const candidates = layoutData.nodes
            .filter(n => n.name !== node.name && !existingNextSet.has(n.name))
            .sort((a, b) => {
                const funcA = a.func === node.func ? 0 : 1;
                const funcB = b.func === node.func ? 0 : 1;
                if (funcA !== funcB) return funcA - funcB;
                return Math.abs(a.r - node.r) - Math.abs(b.r - node.r);
            });
        for (let i = 0; i < Math.min(needed, candidates.length); i++) {
            transitions.push({
                next: candidates[i].name,
                prob: 0.02 / (i + 1)
            });
        }
    }

    console.log(`✓ Processed ${CHORD_PROBABILITIES.size} chord probabilities, ${CHORD_TRANSITIONS.size} transition entries.`);
}

let PROGRESSION_MAP = {};

const COLORS = {
    Landing: { r: 100, g: 200, b: 255 },
    Tension: { r: 255, g: 150, b: 100 },
    Elegant: { r: 200, g: 150, b: 255 },
    Subdominant: { r: 255, g: 0, b: 255 },
    Dominant: { r: 255, g: 180, b: 50 },
    Tonic: { r: 0, g: 255, b: 255 },
    'Non-Diatonic': { r: 255, g: 100, b: 100 }
};

let _canvas; // Store canvas reference for direct event binding

function setup() {
    try {
        console.log("Starting Mobile Setup...");
        _canvas = createCanvas(windowWidth, windowHeight);
        colorMode(RGB);
        textFont('monospace');
        textAlign(CENTER, CENTER);

        audioSystem = new RyojiEngine();

        if (!majorProbTable || !majorTransTable || !CHORD_LIBRARY) {
            console.error("CRITICAL: Data Tables or Chord Object failed to load!");
        }
        console.log(`✓ Data Loaded. Library Size: ${Object.keys(CHORD_LIBRARY).length}`);

        processData();
        setupUI();

        // Attach touch listeners DIRECTLY to canvas element.
        // This way touches on UI buttons/drawer are NOT captured.
        _canvas.elt.addEventListener('touchstart', _canvasTouchStart, { passive: false });
        _canvas.elt.addEventListener('touchmove', _canvasTouchMove, { passive: false });
        _canvas.elt.addEventListener('touchend', _canvasTouchEnd, { passive: false });

        const hasURLState = loadStateFromURL();
        if (!hasURLState) {
            initAllNodes();
        }

        initFlowField();

        console.log("Mobile Setup Complete.");
    } catch (e) {
        console.error("CRITICAL ERROR IN SETUP:", e);
    }
}

function setupUI() {
    const enterBtn = document.getElementById('enter-btn');
    const overlay = document.getElementById('cosmos-overlay');

    if (enterBtn) {
        const handleEnter = async () => {
            // FIRST: Hide overlay and activate — do this before audio (which may fail on mobile)
            isActive = true;
            if (overlay) {
                overlay.style.opacity = 0;
                overlay.style.pointerEvents = 'none';
                setTimeout(() => overlay.style.display = 'none', 800);
            }

            // THEN: Try to start audio (may fail on some mobile browsers)
            try {
                await userStartAudio();
                const ctx = getAudioContext();
                if (ctx.state !== 'running') await ctx.resume();
                outputVolume(0.8);
                if (audioSystem) {
                    audioSystem.init();
                } else {
                    audioSystem = new RyojiEngine();
                    audioSystem.init();
                }
                audioSystem.playStartupSound();
                console.log('✓ Audio Active');
            } catch (e) {
                console.warn('Audio init deferred:', e);
            }

            // Apply any pending state from URL
            try { applyPendingAudioState(); } catch (e) { console.warn('State apply deferred:', e); }

            console.log('✓ Active');
        };

        // Use both click and touchend for reliable mobile input
        enterBtn.addEventListener('click', handleEnter);
        enterBtn.addEventListener('touchend', (e) => {
            e.preventDefault(); // Prevent ghost click
            handleEnter();
        });
    }

    // Drawer toggle — use touchend + click for reliable mobile handling
    const drawerToggle = document.getElementById('drawer-toggle');
    const controls = document.getElementById('controls');
    const drawerOverlay = document.getElementById('drawer-overlay');

    const toggleDrawer = () => {
        controls.classList.toggle('open');
        drawerToggle.classList.toggle('active');
        if (drawerOverlay) drawerOverlay.classList.toggle('active');
    };

    if (drawerToggle && controls) {
        drawerToggle.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDrawer();
        });
        drawerToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            // Only fire on non-touch (desktop fallback)
            if (!('ontouchstart' in window)) toggleDrawer();
        });
    }
    if (drawerOverlay) {
        const closeDrawer = () => {
            controls.classList.remove('open');
            drawerToggle.classList.remove('active');
            drawerOverlay.classList.remove('active');
        };
        drawerOverlay.addEventListener('touchend', (e) => { e.preventDefault(); closeDrawer(); });
        drawerOverlay.addEventListener('click', closeDrawer);
    }

    const keySelect = document.getElementById('key-select');
    if (keySelect) {
        keySelect.addEventListener('change', (e) => {
            currentKey = parseInt(e.target.value);
            const hudKey = document.getElementById('hud-key');
            if (hudKey) hudKey.textContent = `KEY: ${KEY_NAMES[currentKey]} ${currentScale.toUpperCase()}`;
            initAllNodes();
        });
    }

    const scaleSelect = document.getElementById('scale-select');
    if (scaleSelect) {
        scaleSelect.addEventListener('change', (e) => {
            currentScale = e.target.value;
            const hudKey = document.getElementById('hud-key');
            if (hudKey) hudKey.textContent = `KEY: ${KEY_NAMES[currentKey]} ${currentScale.toUpperCase()}`;
            processData();
            initAllNodes();
        });
    }

    const filterToggle = document.getElementById('filter-toggle');
    if (filterToggle) filterToggle.addEventListener('change', (e) => { audioSystem.toggleFilter(e.target.checked); });

    const filterFreq = document.getElementById('filter-freq');
    if (filterFreq) filterFreq.addEventListener('input', (e) => { audioSystem.setFilterFreq(e.target.value); });

    const filterRes = document.getElementById('filter-res');
    if (filterRes) filterRes.addEventListener('input', (e) => { audioSystem.setFilterRes(e.target.value); });

    const delayToggle = document.getElementById('delay-toggle');
    if (delayToggle) delayToggle.addEventListener('change', (e) => { audioSystem.toggleDelay(e.target.checked); });

    const reverbToggle = document.getElementById('reverb-toggle');
    if (reverbToggle) reverbToggle.addEventListener('change', (e) => { audioSystem.toggleReverb(e.target.checked); });

    const arpToggle = document.getElementById('arp-toggle');
    if (arpToggle) arpToggle.addEventListener('change', (e) => { audioSystem.toggleArpeggio(e.target.checked); });

    const arpMode = document.getElementById('arp-mode');
    if (arpMode) arpMode.addEventListener('change', (e) => { audioSystem.setArpMode(e.target.value); });

    const delayDepth = document.getElementById('delay-depth');
    if (delayDepth) delayDepth.addEventListener('input', (e) => { audioSystem.setDelayDepth(e.target.value); });

    const delayTime = document.getElementById('delay-time');
    if (delayTime) delayTime.addEventListener('input', (e) => { audioSystem.setDelayTime(e.target.value); });

    const reverbDepth = document.getElementById('reverb-depth');
    if (reverbDepth) reverbDepth.addEventListener('input', (e) => { audioSystem.setReverbDepth(e.target.value); });

    const arpSpeed = document.getElementById('arp-speed');
    if (arpSpeed) {
        arpSpeed.addEventListener('input', (e) => {
            audioSystem.setArpSpeed(e.target.value);
            const bpm = document.getElementById('arp-bpm');
            if (bpm) bpm.textContent = e.target.value + 'ms';
        });
    }

    const morphTime = document.getElementById('morph-time');
    if (morphTime) {
        morphTime.addEventListener('input', (e) => {
            audioSystem.setMorphTime(e.target.value);
            const label = document.getElementById('morph-time-val');
            if (label) label.textContent = e.target.value + 'ms';
        });
    }

    const orbitOctave = document.getElementById('orbit-octave');
    if (orbitOctave) {
        orbitOctave.addEventListener('input', (e) => {
            const label = document.getElementById('orbit-octave-val');
            if (label) label.textContent = e.target.value;
        });
    }
}

const CLUSTER_CONFIG = {
    tonic: { x: 0, y: 0, color: COLORS.Tonic, label: 'TONIC' },
    subdominant: { x: 0, y: 0, color: COLORS.Subdominant, label: 'SUBDOMINANT' },
    dominant: { x: 0, y: 0, color: COLORS.Dominant, label: 'DOMINANT' },
    unknown: { x: 0, y: 0, color: { r: 150, g: 150, b: 150 }, label: 'UNKNOWN' }
};

function initAllNodes() {
    try {
        nodes = [];
        particles = [];

        const centerX = width / 2;
        const centerY = height / 2;

        const layout = (currentScale === 'minor') ? minorLayoutData : majorLayoutData;

        if (!layout || !layout.nodes) {
            console.error("Layout data not loaded or invalid:", layout);
            return;
        }

        // Calculate dynamic scale — use smaller dimension for mobile
        const maxR = layout.nodes.reduce((max, n) => Math.max(max, parseFloat(n.r) || 0), 0);
        const margin = 60; // Larger margin for touch targets
        const availableW = width / 2 - margin;
        const availableH = height / 2 - margin;
        const maxPixelRadius = Math.min(availableW, availableH);
        const scale = maxR > 0 ? maxPixelRadius / maxR : 35;

        console.log(`Loading ${layout.mode} Mobile Layout with ${layout.nodes.length} nodes...`);

        layout.nodes.forEach(nodeData => {
            const chordName = nodeData.name;
            let libraryData = CHORD_LIBRARY[chordName];
            if (!libraryData) {
                libraryData = { root: 0, intervals: [0, 4, 7], role: 'Landing', shape: 6 };
            }

            let clusterType = 'unknown';
            const func = nodeData.func;
            if (func === 'Tonic') clusterType = 'tonic';
            else if (func === 'Subdominant') clusterType = 'subdominant';
            else if (func === 'Dominant') clusterType = 'dominant';
            else if (func === 'Elegant') clusterType = 'tonic';
            else if (func === 'Tension') clusterType = 'dominant';
            else if (func === 'Non-Diatonic') clusterType = 'dominant';

            const r = parseFloat(nodeData.r) || 0;
            const theta = parseFloat(nodeData.theta) || 0;
            const nx = centerX + r * scale * Math.cos(theta);
            const ny = centerY - r * scale * Math.sin(theta);

            const node = new NeonNode(nx, ny, chordName, libraryData, clusterType);
            if (COLORS[func]) {
                node.color = COLORS[func];
            }
            nodes.push(node);
        });

        if (nodes.length > 0) lastPlayedNode = nodes[0];
        console.log(`✓ Mobile Visuals: ${nodes.length} nodes created.`);
    } catch (e) {
        console.error("ERROR IN initAllNodes:", e);
    }
}

function draw() {
    try {
        background(5, 10, 20);
        drawFlowField();
        drawGuideCircles();
        drawConnections();

        if (orbitMode) orbitUpdate();

        for (let node of nodes) {
            node.update();
            node.display();
        }
    } catch (e) {
        if (frameCount % 60 === 0) console.error("Error in draw loop:", e);
    }
}

// ===== FLOW FIELD BACKGROUND =====
let noiseOffset = 0;

function initFlowField() { }

function drawFlowField() {
    noiseOffset += 0.002;
    push();
    blendMode(ADD);
    noStroke();

    const step = 80;
    const centerX = width / 2;
    const centerY = height / 2;

    for (let x = 0; x < width; x += step) {
        for (let y = 0; y < height; y += step) {
            const n = noise(x * 0.003, y * 0.003, noiseOffset);
            const d = dist(x, y, centerX, centerY);
            const maxD = dist(0, 0, centerX, centerY);
            const falloff = 1 - (d / maxD);

            if (n > 0.55) {
                const alpha = (n - 0.55) * 60 * falloff;
                fill(0, 100, 150, alpha);
                circle(x, y, 3);
            }
        }
    }
    blendMode(BLEND);
    pop();
}

// ===== GUIDE CIRCLES =====
function drawGuideCircles() {
    if (orbitMode) return;

    const layout = (currentScale === 'minor') ? minorLayoutData : majorLayoutData;
    if (!layout || !layout.rings) return;

    const centerX = width / 2;
    const centerY = height / 2;

    const maxR = layout.nodes.reduce((max, n) => Math.max(max, parseFloat(n.r) || 0), 0);
    const margin = 60;
    const availableW = width / 2 - margin;
    const availableH = height / 2 - margin;
    const maxPixelRadius = Math.min(availableW, availableH);
    const scale = maxR > 0 ? maxPixelRadius / maxR : 35;

    push();
    noFill();
    blendMode(ADD);
    for (const ringR of layout.rings) {
        if (ringR <= 0) continue;
        const pixR = ringR * scale;
        stroke(0, 255, 255, 15);
        strokeWeight(0.5);
        circle(centerX, centerY, pixR * 2);
    }

    // Subtle center crosshair
    stroke(0, 255, 255, 10);
    strokeWeight(0.5);
    line(centerX - 15, centerY, centerX + 15, centerY);
    line(centerX, centerY - 15, centerX, centerY + 15);

    blendMode(BLEND);
    pop();
}

// ===== CONNECTION SYSTEM =====
let connectionParticles = [];
const MAX_CONNECTION_PARTICLES = 300; // Reduced for mobile perf
const GLOW_COLOR = { r: 255, g: 160, b: 40 };

class ConnectionParticle {
    constructor(source, target, probability, color) {
        this.sx = source.x;
        this.sy = source.y;
        this.tx = target.x;
        this.ty = target.y;
        this.target = target;

        this.t = 0;
        this.speed = 0.005 + random(0.01);
        this.ox = random(-20, 20);
        this.oy = random(-20, 20);

        this.size = map(probability, 0, 0.3, 2, 6, true);
        this.alpha = map(probability, 0, 0.3, 60, 180, true);
        this.color = color;
        this.alive = true;
        this.trail = [];
    }

    update() {
        this.t += this.speed;
        if (this.t >= 1) {
            this.alive = false;
            return;
        }

        const ease = this.t < 0.5 ? 2 * this.t * this.t : 1 - Math.pow(-2 * this.t + 2, 2) / 2;
        this.x = lerp(this.sx, this.tx + this.ox, ease);
        this.y = lerp(this.sy, this.ty + this.oy, ease);

        this.trail.push({ x: this.x, y: this.y, a: this.alpha * (1 - this.t) });
        if (this.trail.length > 8) this.trail.shift();
    }

    display() {
        push();
        blendMode(ADD);
        noStroke();

        // Trail
        for (let i = 0; i < this.trail.length; i++) {
            const pt = this.trail[i];
            const trailAlpha = pt.a * (i / this.trail.length) * 0.3;
            fill(this.color.r, this.color.g, this.color.b, trailAlpha);
            circle(pt.x, pt.y, this.size * 0.7);
        }

        // Main particle
        const a = this.alpha * (1 - this.t * 0.6);
        fill(this.color.r, this.color.g, this.color.b, a * 0.3);
        circle(this.x, this.y, this.size * 3);
        fill(this.color.r, this.color.g, this.color.b, a);
        circle(this.x, this.y, this.size);

        blendMode(BLEND);
        pop();
    }
}

function drawConnections() {
    for (let node of nodes) {
        node.receivedGlow *= 0.96;
        if (node.receivedGlow < 1) { node.receivedGlow = 0; node.receivedRank = 0; }
    }

    if (!activeNode) {
        connectionParticles = connectionParticles.filter(p => p.alive);
        for (let p of connectionParticles) { p.update(); p.display(); }
        return;
    }

    const allTransitions = CHORD_TRANSITIONS.get(activeNode.name) || [];
    const nodeNames = new Set(nodes.map(n => n.name));
    const validTransitions = allTransitions.filter(t => nodeNames.has(t.next));
    const top5 = [...validTransitions].sort((a, b) => b.prob - a.prob).slice(0, 5);

    top5.forEach((trans, rank) => {
        const target = nodes.find(n => n.name === trans.next);
        if (!target) return;
        const rankIntensity = map(rank, 0, 4, 1.0, 0.3);
        const spawnRate = 0.4 * rankIntensity;
        if (random() < spawnRate && connectionParticles.length < MAX_CONNECTION_PARTICLES) {
            connectionParticles.push(new ConnectionParticle(activeNode, target, trans.prob, GLOW_COLOR));
        }
        const targetGlow = 200 * rankIntensity;
        target.receivedGlow = max(target.receivedGlow, targetGlow);
        target.receivedRank = rank + 1;
    });

    push();
    blendMode(ADD);
    noFill();
    top5.forEach((trans, rank) => {
        const target = nodes.find(n => n.name === trans.next);
        if (!target) return;
        const rankIntensity = map(rank, 0, 4, 1.0, 0.3);
        const pathAlpha = 35 * rankIntensity;
        stroke(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, pathAlpha);
        strokeWeight(1.5 * rankIntensity);
        const dx = target.x - activeNode.x;
        const dy = target.y - activeNode.y;
        bezier(activeNode.x, activeNode.y,
            activeNode.x + dx * 0.3, activeNode.y + dy * 0.3,
            activeNode.x + dx * 0.7, activeNode.y + dy * 0.7,
            target.x, target.y);
    });
    blendMode(BLEND);
    pop();

    connectionParticles = connectionParticles.filter(p => p.alive);
    for (let p of connectionParticles) { p.update(); p.display(); }

    // Active node glow
    push();
    blendMode(ADD);
    noStroke();
    const glowPulse = (sin(frameCount * 0.1) + 1) * 0.5;
    for (let i = 0; i < 4; i++) {
        const r = activeNode.radius + 12 + i * 12 + glowPulse * 10;
        const a = (50 - i * 10) * (0.6 + glowPulse * 0.4);
        fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, a);
        circle(activeNode.x, activeNode.y, r * 2);
    }
    fill(255, 230, 180, 20 + glowPulse * 15);
    circle(activeNode.x, activeNode.y, activeNode.radius * 1.5);
    blendMode(BLEND);
    pop();
}

function drawHexagonVisual(x, y, radius) {
    beginShape();
    for (let i = 0; i < 6; i++) {
        const angle = TWO_PI / 6 * i - HALF_PI;
        const vx = x + cos(angle) * radius;
        const vy = y + sin(angle) * radius;
        vertex(vx, vy);
    }
    endShape(CLOSE);
}

// NeonNode — mobile version with larger touch targets
class NeonNode {
    constructor(x, y, name, data, clusterType) {
        this.pos = createVector(x, y);
        this.home = createVector(x, y);
        this.vel = createVector(0, 0);
        this.acc = createVector(0, 0);
        this.name = name;
        this.data = data;
        this.clusterType = clusterType;

        const config = CLUSTER_CONFIG[clusterType] || CLUSTER_CONFIG['unknown'];
        this.color = config.color;

        this.x = x;
        this.y = y;

        // Mobile touch targets (24px radius, 1.4x hit area in contains())
        this.baseRadius = 24;
        this.radius = this.baseRadius;

        this.glow = 0;
        this.receivedGlow = 0;
        this.receivedRank = 0;
        this.pulse = random(TWO_PI);
        this.maxSpeed = 1.5;
    }

    applyPhysics(allNodes) { }

    update() {
        this.pulse += 0.04;
        if (this.glow > 0) this.glow -= 1;
    }

    display() {
        if (orbitMode && typeof isOrbitVisible === 'function' && !isOrbitVisible(this.name)) {
            return;
        }

        push();
        translate(this.x, this.y);

        const isActiveNode = (this === activeNode);
        const isReceiving = this.receivedGlow > 3;
        const p = (sin(this.pulse) + 1) * 0.5;
        const rg = this.receivedGlow;

        let orbitScale = 1.0;
        if (orbitMode) {
            const breathe = 1.0 + Math.sin(millis() * 0.001 * 0.5 + this.pulse) * 0.15;
            orbitScale = 3.0 * breathe; // Slightly smaller orbit scale for mobile
        }
        const r = this.radius * orbitScale;

        const swirlMultiplier = (typeof _orbitIsSounding !== 'undefined' && _orbitIsSounding) ? 1.5 : 0.4;

        blendMode(ADD);
        noStroke();

        if (orbitMode) {
            // ========= ORBIT MODE VISUALS =========
            const time = millis() * 0.001;

            if (isActiveNode) {
                for (let i = 0; i < 5; i++) {
                    const angle = time * 0.3 * swirlMultiplier + (TWO_PI / 5) * i;
                    const arcR = r + 60 + sin(time * 0.5 * swirlMultiplier + i) * 20;
                    const ax = cos(angle) * arcR * 0.3;
                    const ay = sin(angle) * arcR * 0.3;
                    fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 6 + p * 4);
                    ellipse(ax, ay, arcR * 1.0, arcR * 0.5);
                }

                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 5);
                circle(0, 0, (r + 120) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 12);
                circle(0, 0, (r + 80) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 30);
                circle(0, 0, (r + 40) * 2);
                fill(255, 220, 150, 25 + p * 15);
                circle(0, 0, (r + 15) * 2);

                for (let i = 0; i < 6; i++) {
                    const a = time * 0.8 * swirlMultiplier + (TWO_PI / 6) * i;
                    const sr = r * 0.6 + sin(time * 1.2 * swirlMultiplier + i * 0.7) * r * 0.3;
                    push();
                    rotate(a);
                    fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 15 + p * 10);
                    ellipse(sr, 0, r * 0.7, r * 0.12);
                    pop();
                }
            } else if (isReceiving) {
                const intensity = rg / 200;
                for (let i = 0; i < 3; i++) {
                    const angle = time * 0.5 * swirlMultiplier + (TWO_PI / 3) * i + this.pulse;
                    push();
                    rotate(angle);
                    fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 12);
                    ellipse(r * 0.5, 0, r * 0.6, r * 0.1);
                    pop();
                }

                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 10);
                circle(0, 0, (r + 50) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 30);
                circle(0, 0, (r + 25) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 60);
                circle(0, 0, (r + 8) * 2);
                fill(255, 230, 180, intensity * 20);
                circle(0, 0, (r + 3) * 2);
            } else {
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 4 + p * 2);
                circle(0, 0, (r + 15) * 2);
            }

            let hexGlow = isActiveNode ? (100 + 40 * p) : (isReceiving ? (20 + (rg / 200) * 60) : 15);
            fill(this.color.r, this.color.g, this.color.b, hexGlow);
            drawHexagonVisual(0, 0, r + 6);

            blendMode(BLEND);

            const bodyAlpha = isActiveNode ? 200 : (isReceiving ? max(60, 180 - rg) : 220);
            fill(8, 5, 15, bodyAlpha);
            const edgeBright = isActiveNode ? 255 : (isReceiving ? 150 + (rg / 200) * 100 : 100);
            stroke(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, edgeBright);
            strokeWeight(isActiveNode ? 3 : 1.5);
            drawHexagonVisual(0, 0, r);

            noStroke();
            if (isActiveNode) {
                push();
                rotate(time * 0.3 * swirlMultiplier);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 50);
                drawHexagonVisual(0, 0, r * 0.65);
                pop();
            } else if (isReceiving) {
                push();
                rotate(-time * 0.2 * swirlMultiplier);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, (rg / 200) * 30);
                drawHexagonVisual(0, 0, r * 0.65);
                pop();
            }

            blendMode(BLEND);
            noStroke();
            const textBright = isActiveNode ? 255 : (isReceiving ? 180 + (rg / 200) * 75 : 140);
            fill(255, 240, 220, textBright);
            textSize(14);
            textStyle(BOLD);
            text(getChordName(this.name, this.data), 0, r + 20);
            textStyle(NORMAL);
            blendMode(ADD);

        } else {
            // ========= NORMAL MODE VISUALS =========
            if (isActiveNode) {
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 8);
                circle(0, 0, (r + 80) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 25);
                circle(0, 0, (r + 50) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 60);
                circle(0, 0, (r + 25) * 2);
                fill(255, 220, 150, 40 + p * 20);
                circle(0, 0, (r + 8) * 2);
            } else if (isReceiving) {
                const intensity = rg / 200;
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 15);
                circle(0, 0, (r + 60 + intensity * 30) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 40);
                circle(0, 0, (r + 35 + intensity * 15) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 80);
                circle(0, 0, (r + 15 + intensity * 6) * 2);
                fill(255, 230, 180, intensity * 35);
                circle(0, 0, (r + 4) * 2);
            } else {
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 6 + p * 4);
                circle(0, 0, (r + 15) * 2);
            }

            let hexGlow = 20 + 10 * p;
            if (isActiveNode) hexGlow = 120 + 40 * p;
            else if (isReceiving) hexGlow = 30 + (rg / 200) * 80;
            fill(this.color.r, this.color.g, this.color.b, hexGlow);
            drawHexagonVisual(0, 0, r + 6 + this.glow / 3);

            blendMode(BLEND);

            const bodyAlpha = isReceiving ? max(80, 200 - rg * 1.2) : 230;
            fill(8, 5, 15, bodyAlpha);
            const edgeBright = isActiveNode ? 255 : (isReceiving ? 150 + (rg / 200) * 100 : 120);
            stroke(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, edgeBright);
            strokeWeight(isActiveNode ? 2.5 : (isReceiving ? 1.8 : 1.2));
            drawHexagonVisual(0, 0, r);

            if (isActiveNode) {
                noStroke();
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 80);
                drawHexagonVisual(0, 0, r * 0.65);
            } else if (isReceiving) {
                noStroke();
                const innerFill = (rg / 200) * 50;
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, innerFill);
                drawHexagonVisual(0, 0, r * 0.65);
            } else {
                noFill();
                stroke(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 30);
                strokeWeight(0.5);
                drawHexagonVisual(0, 0, r * 0.65);
            }

            // Label — larger for mobile
            noStroke();
            const textBright = isActiveNode ? 255 : (isReceiving ? 200 + (rg / 200) * 55 : 180);
            fill(255, 240, 220, textBright);
            textSize(12);
            textStyle(BOLD);
            text(getChordName(this.name, this.data), 0, 0);
            textStyle(NORMAL);
        }

        pop();
    }

    contains(mx, my) {
        // Enlarged hit area for touch (1.4x radius = ~34px effective)
        return dist(mx, my, this.pos.x, this.pos.y) < this.radius * 1.4;
    }
}

// ===== AUDIO ENGINE =====
class RyojiEngine {
    constructor() {
        this.delay = null;
        this.reverb = null;
        this.filter = null;
        this.compressor = null;
        this.oscillators = [];
        this.keepAliveOsc = null;
        this.arpLoop = null;
        this.arpSpeed = 220;
        this.morphTime = 0.5;
        this.delayActive = true;
        this.reverbActive = true;
        const arpEl = document.getElementById('arp-toggle');
        this.arpActive = arpEl ? arpEl.checked : true;
        this.arpMode = 'up'; // 'up', 'random-fixed', 'random-free'
        this.filterActive = true;
    }

    init() {
        console.log('Initializing Audio System...');
        if (this.keepAliveOsc) { try { this.keepAliveOsc.stop(); this.keepAliveOsc.dispose(); } catch (e) { } }
        if (this.filter) { try { this.filter.disconnect(); } catch (e) { } }
        if (this.delay) { try { this.delay.disconnect(); } catch (e) { } }
        if (this.reverb) { try { this.reverb.disconnect(); } catch (e) { } }

        this.filter = new p5.LowPass();
        this.filter.freq(2800);
        this.filter.res(0.3);
        this.filter.disconnect();

        this.delay = new p5.Delay();
        this.delay.process(this.filter, 0.35, 0.35, 2300);
        this.delay.setType('pingPong');

        this.reverb = new p5.Reverb();
        this.reverb.process(this.filter, 4, 3);
        this.reverb.set(6, 4);

        this.delay.drywet(0.4);
        this.reverb.drywet(0.5);

        // Android fix: Connect filter directly to destination as well (dry path).
        // This ensures the audio signal always reaches AudioContext.destination
        // even if Delay/Reverb internal routing is disrupted on some Android devices.
        try {
            const ctx = getAudioContext();
            this.filter.connect(ctx);
        } catch (e) {
            console.warn('Direct filter→destination connect failed:', e);
        }

        // Android fix: Keep-alive silent oscillator.
        // Prevents Android from suspending AudioContext during screen recording
        // by maintaining a continuous (inaudible) audio signal.
        try {
            this.keepAliveOsc = new p5.Oscillator('sine');
            this.keepAliveOsc.freq(1); // Sub-audible frequency
            this.keepAliveOsc.amp(0.001); // Essentially silent
            this.keepAliveOsc.disconnect();
            this.keepAliveOsc.connect(getAudioContext());
            this.keepAliveOsc.start();
            console.log('✓ Keep-alive oscillator started (Android audio fix)');
        } catch (e) {
            console.warn('Keep-alive oscillator failed:', e);
        }

        outputVolume(0.7);

        // Android fix: Listen for visibility changes (e.g. switching to recorder app)
        // and auto-resume AudioContext.
        this._setupVisibilityHandler();

        console.log('✓ Audio Chain Ready');
    }

    _setupVisibilityHandler() {
        // Remove previous handler if re-initializing
        if (this._visHandler) {
            document.removeEventListener('visibilitychange', this._visHandler);
        }
        this._visHandler = () => {
            if (document.visibilityState === 'visible') {
                const ctx = getAudioContext();
                if (ctx.state !== 'running') {
                    ctx.resume().then(() => {
                        console.log('✓ AudioContext resumed after visibility change');
                    }).catch(e => console.warn('AudioContext resume failed:', e));
                }
            } else {
                // Page hidden (navigating away, switching tabs, etc.)
                // Stop all audio to prevent sound continuing in background
                this.stopChord();
                if (typeof activeNode !== 'undefined') activeNode = null;
                console.log('✓ Audio stopped on page hide');
            }
        };
        document.addEventListener('visibilitychange', this._visHandler);
    }

    startChord(chordData) {
        const fadeOutTime = this.morphTime;
        const oscsToFade = [...this.oscillators];
        this.oscillators = [];

        if (this.arpLoop) {
            clearInterval(this.arpLoop);
            this.arpLoop = null;
        }

        oscsToFade.forEach(osc => {
            try {
                osc.amp(0, fadeOutTime);
                setTimeout(() => {
                    try { osc.stop(); osc.dispose(); } catch (e) { }
                }, (fadeOutTime + 0.15) * 1000);
            } catch (e) { }
        });

        let octaveShift = 0;
        if (currentKey >= 7) octaveShift = -12;

        const baseOctave = 60 + octaveShift;
        const transposed = chordData.intervals.map(interval => {
            let midi = baseOctave + currentKey + chordData.root + interval;
            if (typeof _orbitOctave === 'function') {
                const octLvl = _orbitOctave();
                const roll = Math.random();
                if (octLvl === 1) {
                    if (roll < 0.10) midi += 12;
                } else if (octLvl === 2) {
                    if (roll < 0.08) midi += 12;
                    else if (roll < 0.15) midi -= 12;
                } else if (octLvl === 3) {
                    if (roll < 0.05) midi += 24;
                    else if (roll < 0.20) midi += 12;
                    else if (roll < 0.30) midi -= 12;
                } else if (octLvl >= 4) {
                    if (roll < 0.10) midi += 24;
                    else if (roll < 0.30) midi += 12;
                    else if (roll < 0.45) midi -= 12;
                    else if (roll < 0.50) midi -= 24;
                }
            }
            return midi;
        });
        const freqs = transposed.map(m => midiToFreq(m));
        const attackTime = Math.max(0.08, fadeOutTime * 0.8);

        if (!this.arpActive) {
            freqs.forEach((freq, i) => {
                setTimeout(() => {
                    if (!this.filter) return;
                    const vel = orbitMode ? (0.3 + Math.random() * 1.2) : 1.0;

                    const osc1 = new p5.Oscillator();
                    osc1.setType('sine');
                    osc1.freq(freq);
                    osc1.disconnect();
                    osc1.connect(this.filter);
                    osc1.start();
                    osc1.amp(0);
                    osc1.amp(0.07 * vel, attackTime);
                    this.oscillators.push(osc1);

                    const osc2 = new p5.Oscillator();
                    osc2.setType('triangle');
                    osc2.freq(freq * Math.pow(2, 3 / 1200));
                    osc2.disconnect();
                    osc2.connect(this.filter);
                    osc2.start();
                    osc2.amp(0);
                    osc2.amp(0.04 * vel, attackTime * 1.2);
                    this.oscillators.push(osc2);

                    const osc3 = new p5.Oscillator();
                    osc3.setType('sine');
                    osc3.freq(freq * Math.pow(2, -2 / 1200));
                    osc3.disconnect();
                    osc3.connect(this.filter);
                    osc3.start();
                    osc3.amp(0);
                    osc3.amp(0.03 * vel, attackTime * 1.5);
                    this.oscillators.push(osc3);

                    const osc4 = new p5.Oscillator();
                    osc4.setType('sine');
                    osc4.freq(freq * 2.003);
                    osc4.disconnect();
                    osc4.connect(this.filter);
                    osc4.start();
                    osc4.amp(0);
                    osc4.amp(0.015 * vel, attackTime * 2.0);
                    this.oscillators.push(osc4);
                }, i * 25);
            });
        } else {
            // Arpeggio mode
            let arpPattern;
            const mode = this.arpMode;

            if (mode === 'random-fixed') {
                // Shuffle once, repeat same order
                arpPattern = [...freqs];
                for (let i = arpPattern.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [arpPattern[i], arpPattern[j]] = [arpPattern[j], arpPattern[i]];
                }
            } else {
                // 'up' and 'random-free' both start with ascending
                arpPattern = [...freqs];
            }
            let arpIndex = 0;

            this.arpLoop = setInterval(() => {
                if (!this.filter) return;

                let freq;
                if (mode === 'random-free') {
                    // Pick a random note from the chord each time
                    freq = freqs[Math.floor(Math.random() * freqs.length)];
                } else {
                    freq = arpPattern[arpIndex % arpPattern.length];
                }

                const osc = new p5.Oscillator();
                osc.setType('sine');
                osc.freq(freq);
                osc.disconnect();
                osc.connect(this.filter);
                osc.start();
                osc.amp(0);
                osc.amp(0.08, 0.02);

                const osc2 = new p5.Oscillator();
                osc2.setType('triangle');
                osc2.freq(freq * Math.pow(2, 3 / 1200));
                osc2.disconnect();
                osc2.connect(this.filter);
                osc2.start();
                osc2.amp(0);
                osc2.amp(0.03, 0.03);

                setTimeout(() => {
                    osc.amp(0, 0.8);
                    osc2.amp(0, 0.9);
                    setTimeout(() => {
                        try { osc.stop(); osc.dispose(); } catch (e) { }
                        try { osc2.stop(); osc2.dispose(); } catch (e) { }
                    }, 950);
                }, 180);

                arpIndex++;
            }, this.arpSpeed);
        }
    }

    stopChord() {
        if (this.arpLoop) {
            clearInterval(this.arpLoop);
            this.arpLoop = null;
        }
        const oscsToStop = [...this.oscillators];
        this.oscillators = [];
        oscsToStop.forEach(osc => {
            try {
                osc.amp(0, 0.5);
                setTimeout(() => {
                    try { osc.stop(); osc.dispose(); } catch (e) { }
                }, 600);
            } catch (e) { }
        });
    }

    setArpMode(v) { this.arpMode = v; this.stopChord(); }

    toggleFilter(active) {
        this.filterActive = active;
        if (this.filter) {
            this.filter.freq(active ? 2800 : 20000);
        }
    }

    toggleDelay(active) {
        this.delayActive = active;
        if (this.delay) this.delay.drywet(active ? 0.4 : 0);
    }

    toggleReverb(active) {
        this.reverbActive = active;
        if (this.reverb) this.reverb.drywet(active ? 0.5 : 0);
    }

    toggleArpeggio(active) {
        this.arpActive = active;
        this.stopChord();
    }

    setDelayDepth(v) {
        // DEPTH = how long echoes sustain (feedback amount)
        if (this.delay && this.delayActive) this.delay.feedback(parseFloat(v) * 0.95);
    }
    setDelayTime(v) {
        // TIME = interval between echoes (0.05-1.0s)
        if (this.delay) this.delay.delayTime(0.05 + parseFloat(v) * 0.95);
    }
    setReverbDepth(v) {
        if (this.reverb && this.reverbActive) this.reverb.drywet(0.3 + parseFloat(v) * 0.6);
    }
    setArpSpeed(v) { this.arpSpeed = parseFloat(v); }
    setMorphTime(v) { this.morphTime = parseFloat(v) / 1000; }
    setFilterFreq(v) {
        if (this.filter && this.filterActive) this.filter.freq(500 + parseFloat(v) * 4500);
    }
    setFilterRes(v) {
        if (this.filter && this.filterActive) this.filter.res(0.5 + parseFloat(v) * 20);
    }

    playStartupSound() {
        if (!this.filter) return;
        const osc = new p5.Oscillator();
        osc.setType('sine');
        osc.freq(60);
        osc.disconnect();
        osc.connect(this.filter);
        osc.start();
        osc.amp(0);
        osc.amp(0.3, 0.05);
        osc.freq(120, 0.1);
        setTimeout(() => {
            osc.amp(0, 0.4);
            setTimeout(() => { osc.stop(); osc.dispose(); }, 500);
        }, 100);
    }
}

function midiToFreq(m) {
    return 440 * pow(2, (m - 69) / 12);
}

// ===== TOUCH INTERACTION (Direct Canvas Listeners) =====
// These fire ONLY when touching the canvas, NOT when touching UI buttons.
let _touchActive = false;

// Check if a touch point overlaps with any UI element (drawer, HUD, copyright, toggle btn)
function _isTouchOverUI(clientX, clientY) {
    const uiIds = ['controls', 'drawer-toggle', 'hud', 'copyright-overlay', 'drawer-overlay', 'cosmos-overlay'];
    for (const id of uiIds) {
        const el = document.getElementById(id);
        if (!el || el.style.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            return true;
        }
    }
    return false;
}

function _canvasTouchStart(e) {
    e.preventDefault();
    userStartAudio();
    if (getAudioContext().state !== 'running') {
        getAudioContext().resume();
    }
    if (!isActive) return;

    const touch = e.touches[0];
    // Ignore touches that land on UI elements
    if (_isTouchOverUI(touch.clientX, touch.clientY)) return;

    _touchActive = true;
    const rect = _canvas.elt.getBoundingClientRect();
    const tx = touch.clientX - rect.left;
    const ty = touch.clientY - rect.top;

    let nodeFound = false;
    for (let node of nodes) {
        if (node.contains(tx, ty)) {
            handleNodePress(node);
            nodeFound = true;
            break;
        }
    }

    if (!nodeFound && lastPlayedNode) {
        handleNodePress(lastPlayedNode);
    }
}

function _canvasTouchMove(e) {
    e.preventDefault();
    if (!isActive || !_touchActive) return;

    const touch = e.touches[0];
    // Stop audio if dragging into UI area
    if (_isTouchOverUI(touch.clientX, touch.clientY)) return;

    const rect = _canvas.elt.getBoundingClientRect();
    const tx = touch.clientX - rect.left;
    const ty = touch.clientY - rect.top;

    for (let node of nodes) {
        if (node.contains(tx, ty)) {
            if (activeNode !== node) {
                handleNodePress(node);
            }
            break;
        }
    }
}

function _canvasTouchEnd(e) {
    e.preventDefault();
    // Android fix: Also resume AudioContext on touchend for extra robustness
    if (getAudioContext().state !== 'running') {
        getAudioContext().resume();
    }
    if (!isActive) return;
    _touchActive = false;
    audioSystem.stopChord();
    activeNode = null;
}

// ===== MOUSE (Desktop Fallback) =====
function mousePressed() {
    if (_touchActive) return;
    userStartAudio();
    if (getAudioContext().state !== 'running') {
        getAudioContext().resume();
    }
    if (!isActive) return;

    let nodeFound = false;
    for (let node of nodes) {
        if (node.contains(mouseX, mouseY)) {
            handleNodePress(node);
            nodeFound = true;
            break;
        }
    }

    if (!nodeFound && lastPlayedNode) {
        handleNodePress(lastPlayedNode);
    }
}

function mouseDragged() {
    if (_touchActive || !isActive) return;
    for (let node of nodes) {
        if (node.contains(mouseX, mouseY)) {
            if (activeNode !== node) handleNodePress(node);
            break;
        }
    }
}

function mouseReleased() {
    if (_touchActive || !isActive) return;
    audioSystem.stopChord();
    activeNode = null;
}

function handleNodePress(node) {
    activeNode = node;
    lastPlayedNode = node;

    const hudChord = document.getElementById('hud-chord');
    if (hudChord) hudChord.textContent = `CHORD: ${getChordName(node.name, node.data)}`;

    audioSystem.startChord(node.data);
    node.glow = 100;
    updateURL();

    // INSTANT GLOW: Top 5 targets
    connectionParticles = [];
    const allTransitions = CHORD_TRANSITIONS.get(node.name) || [];
    const nodeNames = new Set(nodes.map(n => n.name));
    const validTransitions = allTransitions.filter(t => nodeNames.has(t.next));
    const top5 = [...validTransitions].sort((a, b) => b.prob - a.prob).slice(0, 5);
    top5.forEach((trans, rank) => {
        const target = nodes.find(n => n.name === trans.next);
        if (!target) return;
        const rankIntensity = map(rank, 0, 4, 1.0, 0.3);
        target.receivedGlow = 200 * rankIntensity;
        target.receivedRank = rank + 1;
    });

    if (orbitMode && typeof orbitOnNodeClick === 'function') {
        orbitOnNodeClick(node);
    }
}

function getChordName(chordName, chordData) {
    const rootNote = (chordData.root + currentKey) % 12;
    const baseName = KEY_NAMES[rootNote];
    const quality = chordName.replace(/^[IViv#b]+/, '');
    return baseName + quality;
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    initAllNodes();
}
