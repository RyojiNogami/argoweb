/**
 * ARGO: RYOJI SOUND ENGINE
 * 
 * Features:
 * - Fixed concentric circle layout
 * - Flow visualization to next chord candidates
 * - Last played node memory
 * - Ethereal electronic sound (Ryoji signature style)
 * - Deep reverb, subtle delay
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
const SIDEBAR_WIDTH = 280;

// Chord library expanded for Minor Key support
// Chord library explicity loaded from JSON
let CHORD_LIBRARY;

// ... (PROGRESSION_MAP can remain as is, it might be loose for minor but acceptable for now)

// ... (PROGRESSION_MAP follows)

// Data Holders
let majorProbTable, majorTransTable;
let minorProbTable, minorTransTable;
let majorLayoutData, minorLayoutData; // New Layout Data
let CHORD_PROBABILITIES = new Map();
let CHORD_TRANSITIONS = new Map();

function preload() {
    majorProbTable = loadTable('Major_Normalized_Probabilities.csv', 'csv', 'header');
    majorTransTable = loadTable('Major_Normalized_Transitions.csv', 'csv', 'header');
    minorProbTable = loadTable('Minor_Normalized_Probabilities.csv', 'csv', 'header');
    minorTransTable = loadTable('Minor_Normalized_Transitions.csv', 'csv', 'header');

    majorLayoutData = loadJSON('Chord_Layout_Config_v11_Major.json');
    minorLayoutData = loadJSON('Chord_Layout_Config_v11_Minor.json');
    CHORD_LIBRARY = loadJSON('Chord_Definitions.json');
}

// Notation Mapper: CSV (Nashville-ish) -> Roman Numerals
function mapCsvChordToRoman(csvName, isMinorContext) {
    if (!csvName) return null;

    // Handle special characters
    let name = csvName.replace('#', '#').replace('b', 'b');

    // Strip parenthetical voicings like "16(Fm7)" -> "16"
    name = name.replace(/\(.*$/, '');

    // Extract root number — SINGLE digit only (1-7)
    const match = name.match(/^([#b]?\d)(.*)$/);
    if (!match) return name; // Fallback

    let rootNum = match[1];
    let quality = match[2];

    // Roman Numeral Conversion
    const romanMap = {
        '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII',
        '#1': '#I', '#2': '#II', '#4': '#IV', '#5': '#V',
        'b2': 'bII', 'b3': 'bIII', 'b5': 'bV', 'b6': 'bVI', 'b7': 'bVII'
    };

    let roman = romanMap[rootNum] || rootNum;

    // Case adjustments for Minor/Major quality
    // Lowercase for minor chords if not explicitly 'maj' or dominant
    const isMinorQuality = quality.includes('m') && !quality.includes('maj');
    const isDim = quality.includes('dim') || quality.includes('°') || quality === '07';

    if (isMinorQuality || isDim) {
        roman = roman.toLowerCase();
    }

    // Handle diminished °7 notation: "07" in CSV -> "°7" in layout
    if (quality === '07') {
        return roman + '°7';
    }

    // Handle standard connection
    return roman + quality;
}

function processData() {
    console.log('Processing Probability Data...');

    const isMinor = currentScale === 'minor';
    const probTable = isMinor ? minorProbTable : majorProbTable;
    const transTable = isMinor ? minorTransTable : majorTransTable;
    const layoutData = isMinor ? minorLayoutData : majorLayoutData;

    CHORD_PROBABILITIES.clear();
    CHORD_TRANSITIONS.clear();

    // Alias map: layout node name -> CSV-mapped name
    // Some layout nodes use notation (e.g., "MajMaj7") that the CSV doesn't produce
    const ALIASES = {
        'IIImMaj7': 'IIImaj7',   // CSV 3maj7 -> IIImaj7, layout uses IIImMaj7
        'ImMaj7': 'Imaj7',       // CSV 1maj7 -> Imaj7, layout uses ImMaj7
        'bVImMaj7': 'bVImaj7',   // CSV b6maj7 -> bVImaj7, layout uses bVImMaj7
        'bIImMaj7': 'bIImaj7',   // CSV b2maj7 -> bIImaj7, layout uses bIImMaj7
        'IVmMaj7': 'IVmaj7',     // CSV 4maj7 -> IVmaj7, layout uses IVmMaj7
        'bIIImMaj7': 'bIIImaj7', // CSV b3maj7 -> bIIImaj7, layout uses bIIImMaj7
        'VIImMaj7': 'VIImaj7',   // CSV 7maj7 -> VIImaj7, layout uses VIImMaj7
        'ivmaj7': 'IVmaj7',      // minor-case iv but maj7 quality
        'IVm6': 'ivm6',          // uppercase IV but minor quality m6
    };

    // 1. Process Probabilities
    for (let r = 0; r < probTable.getRowCount(); r++) {
        const rawName = probTable.getString(r, 'Normalized_Chord');
        const prob = probTable.getNum(r, 'Probability');
        const romanName = mapCsvChordToRoman(rawName, isMinor);
        if (romanName) CHORD_PROBABILITIES.set(romanName, prob);
    }

    // 2. Process Transitions
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

    // 3. Apply aliases — copy transitions so layout node names find their data
    const layoutNodeNames = layoutData.nodes ? layoutData.nodes.map(n => n.name) : [];

    for (const [alias, source] of Object.entries(ALIASES)) {
        // If the alias (layout name) has no transitions but the source does, clone them
        if (!CHORD_TRANSITIONS.has(alias) && CHORD_TRANSITIONS.has(source)) {
            CHORD_TRANSITIONS.set(alias, [...CHORD_TRANSITIONS.get(source)]);
        }
        // Also copy probabilities
        if (!CHORD_PROBABILITIES.has(alias) && CHORD_PROBABILITIES.has(source)) {
            CHORD_PROBABILITIES.set(alias, CHORD_PROBABILITIES.get(source));
        }
    }

    // Also ensure targets reference aliased names: remap target names to layout names
    const reverseAliases = {};
    for (const [alias, source] of Object.entries(ALIASES)) {
        reverseAliases[source] = alias;
    }

    for (const [key, transitions] of CHORD_TRANSITIONS) {
        for (const trans of transitions) {
            // If trans.next doesn't match any layout node but an alias does, remap
            if (!layoutNodeNames.includes(trans.next) && reverseAliases[trans.next]) {
                trans.next = reverseAliases[trans.next];
            }
        }
    }

    // 4. Ensure every layout node has at least 5 transitions to OTHER layout nodes
    for (const node of layoutData.nodes || []) {
        let transitions = CHORD_TRANSITIONS.get(node.name) || [];
        if (!CHORD_TRANSITIONS.has(node.name)) {
            CHORD_TRANSITIONS.set(node.name, transitions);
        }

        // Count how many targets match layout nodes
        const matchingTargets = transitions.filter(t => layoutNodeNames.includes(t.next));
        if (matchingTargets.length >= 5) continue;

        // Need more — add transitions to same-function or nearby nodes
        const needed = 5 - matchingTargets.length;
        const existingNextSet = new Set(transitions.map(t => t.next));

        // Candidates: prioritize same-function, then adjacent rings
        const candidates = layoutData.nodes
            .filter(n => n.name !== node.name && !existingNextSet.has(n.name))
            .sort((a, b) => {
                // Same function first
                const funcA = a.func === node.func ? 0 : 1;
                const funcB = b.func === node.func ? 0 : 1;
                if (funcA !== funcB) return funcA - funcB;
                // Closer ring distance
                return Math.abs(a.r - node.r) - Math.abs(b.r - node.r);
            });

        for (let i = 0; i < Math.min(needed, candidates.length); i++) {
            transitions.push({
                next: candidates[i].name,
                prob: 0.15 - i * 0.02
            });
        }
    }

    console.log(`✓ Data Processed: ${CHORD_TRANSITIONS.size} chords have transitions.`);
}

// Fallback/Legacy Map (will be overwritten if data loads)
let PROGRESSION_MAP = {};

const COLORS = {
    Landing: { r: 100, g: 200, b: 255 }, // Cyan
    Tension: { r: 255, g: 150, b: 100 }, // Orange
    Elegant: { r: 200, g: 150, b: 255 }, // Violet
    Subdominant: { r: 255, g: 0, b: 255 }, // Magenta
    Dominant: { r: 255, g: 180, b: 50 }, // Orange/Gold
    Tonic: { r: 0, g: 255, b: 255 }, // Cyan
    'Non-Diatonic': { r: 255, g: 100, b: 100 } // Reddish
};

function setup() {
    try {
        console.log("Starting Setup...");
        createCanvas(windowWidth, windowHeight);
        colorMode(RGB);
        textFont('monospace');
        textAlign(CENTER, CENTER);

        audioSystem = new RyojiEngine();

        // Safety Check for Data Loading
        if (!majorProbTable || !majorTransTable || !CHORD_LIBRARY) {
            console.error("CRITICAL: Data Tables or Chord Object failed to load!", { majorProbTable, majorTransTable, CHORD_LIBRARY });
        }
        console.log(`✓ Data Loaded. Library Size: ${Object.keys(CHORD_LIBRARY).length}`);

        processData(); // Initialize Probability Data
        setupUI();

        // Load state from URL if present (before initAllNodes)
        const hasURLState = loadStateFromURL();
        if (!hasURLState) {
            initAllNodes();
        }

        initFlowField(); // Initialize background flow field

        console.log("Setup Complete.");
    } catch (e) {
        console.error("CRITICAL ERROR IN SETUP:", e);
    }
}

function setupUI() {
    const enterBtn = document.getElementById('enter-btn');
    const overlay = document.getElementById('cosmos-overlay');

    if (enterBtn) {
        enterBtn.addEventListener('click', async () => {
            try {
                console.log('Enter button clicked');
                await userStartAudio();
                const ctx = getAudioContext();
                if (ctx.state !== 'running') {
                    await ctx.resume();
                }

                outputVolume(0.8);

                if (audioSystem) {
                    audioSystem.init();
                } else {
                    console.error('AudioSystem not initialized');
                    audioSystem = new RyojiEngine();
                    audioSystem.init();
                }

                audioSystem.playStartupSound();

                isActive = true;
                if (overlay) {
                    overlay.style.opacity = 0;
                    setTimeout(() => overlay.style.display = 'none', 800);
                }

                // Apply any pending state from URL
                applyPendingAudioState();

                console.log('✓ Active');
            } catch (e) {
                console.error('Error starting audio:', e);
            }
        });
    }

    const keySelect = document.getElementById('key-select');
    if (keySelect) {
        keySelect.addEventListener('change', (e) => {
            currentKey = parseInt(e.target.value);
            const hudKey = document.getElementById('hud-key');
            if (hudKey) hudKey.textContent = `KEY: ${KEY_NAMES[currentKey]} ${currentScale.toUpperCase()}`;
            initAllNodes();
            updateURL();
        });
    }

    const scaleSelect = document.getElementById('scale-select');
    if (scaleSelect) {
        scaleSelect.addEventListener('change', (e) => {
            currentScale = e.target.value;
            const hudKey = document.getElementById('hud-key');
            if (hudKey) hudKey.textContent = `KEY: ${KEY_NAMES[currentKey]} ${currentScale.toUpperCase()}`;

            processData(); // Reload data for new scale
            initAllNodes();
            updateURL();
        });
    }

    const filterToggle = document.getElementById('filter-toggle');
    if (filterToggle) filterToggle.addEventListener('change', (e) => { audioSystem.toggleFilter(e.target.checked); updateURL(); });

    const filterFreq = document.getElementById('filter-freq');
    if (filterFreq) filterFreq.addEventListener('input', (e) => { audioSystem.setFilterFreq(e.target.value); updateURL(); });

    const filterRes = document.getElementById('filter-res');
    if (filterRes) filterRes.addEventListener('input', (e) => { audioSystem.setFilterRes(e.target.value); updateURL(); });

    const delayToggle = document.getElementById('delay-toggle');
    if (delayToggle) delayToggle.addEventListener('change', (e) => { audioSystem.toggleDelay(e.target.checked); updateURL(); });

    const reverbToggle = document.getElementById('reverb-toggle');
    if (reverbToggle) reverbToggle.addEventListener('change', (e) => { audioSystem.toggleReverb(e.target.checked); updateURL(); });

    const arpToggle = document.getElementById('arp-toggle');
    if (arpToggle) arpToggle.addEventListener('change', (e) => { audioSystem.toggleArpeggio(e.target.checked); updateURL(); });

    const delayDepth = document.getElementById('delay-depth');
    if (delayDepth) delayDepth.addEventListener('input', (e) => { audioSystem.setDelayDepth(e.target.value); updateURL(); });

    const delayTime = document.getElementById('delay-time');
    if (delayTime) delayTime.addEventListener('input', (e) => { audioSystem.setDelayTime(e.target.value); updateURL(); });

    const reverbDepth = document.getElementById('reverb-depth');
    if (reverbDepth) reverbDepth.addEventListener('input', (e) => { audioSystem.setReverbDepth(e.target.value); updateURL(); });

    const arpSpeed = document.getElementById('arp-speed');
    if (arpSpeed) {
        arpSpeed.addEventListener('input', (e) => {
            audioSystem.setArpSpeed(e.target.value);
            const bpm = document.getElementById('arp-bpm');
            if (bpm) bpm.textContent = e.target.value + 'ms';
            updateURL();
        });
    }

    const morphTime = document.getElementById('morph-time');
    if (morphTime) {
        morphTime.addEventListener('input', (e) => {
            audioSystem.setMorphTime(e.target.value);
            const label = document.getElementById('morph-time-val');
            if (label) label.textContent = e.target.value + 'ms';
            updateURL();
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
    tonic: { x: -300, y: -70, color: COLORS.Tonic, label: 'TONIC' },
    subdominant: { x: 0, y: 320, color: COLORS.Subdominant, label: 'SUBDOMINANT' },
    dominant: { x: 300, y: -70, color: COLORS.Dominant, label: 'DOMINANT' },
    unknown: { x: 0, y: 0, color: { r: 150, g: 150, b: 150 }, label: 'UNKNOWN' }
};



function initAllNodes() {
    try {
        nodes = [];
        particles = [];

        const centerX = SIDEBAR_WIDTH + (width - SIDEBAR_WIDTH) / 2;
        const centerY = height / 2;

        // 1. Select Layout Data based on Key Mode
        const layout = (currentScale === 'minor') ? minorLayoutData : majorLayoutData;

        if (!layout || !layout.nodes) {
            console.error("Layout data not loaded or invalid:", layout);
            return;
        }

        // Calculate dynamic scale to fit all nodes on screen
        const maxR = layout.nodes.reduce((max, n) => Math.max(max, parseFloat(n.r) || 0), 0);
        const margin = 50; // px margin from edge (node radius + padding)
        const availableW = (width - SIDEBAR_WIDTH) / 2 - margin;
        const availableH = height / 2 - margin;
        const maxPixelRadius = Math.min(availableW, availableH);
        const scale = maxR > 0 ? maxPixelRadius / maxR : 35;


        console.log(`Loading ${layout.mode} Layout with ${layout.nodes.length} nodes...`);

        // 2. Create Nodes from JSON
        layout.nodes.forEach(nodeData => {
            const chordName = nodeData.name;

            // Find chord definition (intervals, etc)
            let libraryData = CHORD_LIBRARY[chordName];

            if (!libraryData) {
                // Auto-fallback or warn if missing
                // console.warn(`Chord ${chordName} not found in library. Using default.`);
                libraryData = { root: 0, intervals: [0, 4, 7], role: 'Landing', shape: 6 };
            }

            // Determine Cluster Type based on Function (for coloring/labeling)
            let clusterType = 'unknown';
            const func = nodeData.func; // e.g., "Tonic", "Dominant"

            if (func === 'Tonic') clusterType = 'tonic';
            else if (func === 'Subdominant') clusterType = 'subdominant';
            else if (func === 'Dominant') clusterType = 'dominant';
            else if (func === 'Elegant') clusterType = 'tonic';
            else if (func === 'Tension') clusterType = 'dominant';
            else if (func === 'Non-Diatonic') clusterType = 'dominant';

            // Calculate Position
            // Ensure r and theta are numbers
            const r = parseFloat(nodeData.r) || 0;
            const theta = parseFloat(nodeData.theta) || 0;

            const nx = centerX + r * scale * Math.cos(theta);
            const ny = centerY - r * scale * Math.sin(theta); // Flip Y for standard Cartesian if needed, or keep additive

            // Instantiate
            const node = new NeonNode(nx, ny, chordName, libraryData, clusterType);

            // Override color based on specific Function if available in COLORS
            if (COLORS[func]) {
                node.color = COLORS[func];
            }

            nodes.push(node);
        });

        if (nodes.length > 0) lastPlayedNode = nodes[0];
        console.log(`✓ Visuals Initialized: ${nodes.length} nodes created.`);
    } catch (e) {
        console.error("ERROR IN initAllNodes:", e);
    }
}

function draw() {
    try {
        background(5, 10, 20); // Deep dark blue/black

        drawFlowField(); // Installation art background
        drawGuideCircles(); // Distance ring guides
        drawConnections(); // Overflow light connections

        // ORBIT auto-play update
        if (orbitMode) orbitUpdate();

        // Nodes
        for (let node of nodes) {
            node.update();
            node.display();
        }

    } catch (e) {
        if (frameCount % 60 === 0) console.error("Error in draw loop:", e);
    }
}

// ===== FLOW FIELD BACKGROUND (Minimal — particles removed for performance) =====
let noiseOffset = 0;

function initFlowField() {
    // MagParticles removed for performance
}

function drawFlowField() {
    push();
    noiseOffset += 0.003;
    blendMode(ADD);

    // Central glow only (particles removed for performance)
    const cx = SIDEBAR_WIDTH + (width - SIDEBAR_WIDTH) / 2;
    const cy = height / 2;
    noStroke();
    const pulse = (sin(noiseOffset * 2) + 1) * 0.5;
    fill(30, 15, 60, 6 + pulse * 4);
    circle(cx, cy, 300 + pulse * 50);
    fill(20, 10, 50, 4 + pulse * 2);
    circle(cx, cy, 500 + pulse * 80);

    blendMode(BLEND);
    pop();
}


// drawClusterFrames: Kept as reference but unused
function drawClusterFrames() {
    const centerX = SIDEBAR_WIDTH + (width - SIDEBAR_WIDTH) / 2;
    const centerY = height / 2;

    push();
    noFill();

    Object.keys(CLUSTER_CONFIG).forEach(key => {
        const c = CLUSTER_CONFIG[key];
        const cx = centerX + c.x;
        const cy = centerY + c.y;

        // Glow frame (Outer)
        strokeWeight(12);
        stroke(c.color.r, c.color.g, c.color.b, 30);
        drawHexagonVisual(cx, cy, 180);

        // Core frame (Target)
        strokeWeight(2);
        stroke(c.color.r, c.color.g, c.color.b, 150);
        drawHexagonVisual(cx, cy, 180);

        // Label
        noStroke();
        fill(c.color.r, c.color.g, c.color.b, 200);
        textSize(14);
        textStyle(BOLD);
        text(c.label, cx, cy);
        textStyle(NORMAL);
        noFill();
    });
    pop();
}

// drawClusterFrames REMOVED or commented out if you prefer, but removing call is enough for now. 
// I will keep the function definition just in case, but it's not called.

// ===== GUIDE CIRCLES (Distance Rings) =====
function drawGuideCircles() {
    const centerX = SIDEBAR_WIDTH + (width - SIDEBAR_WIDTH) / 2;
    const centerY = height / 2;
    const layout = (currentScale === 'minor') ? minorLayoutData : majorLayoutData;
    const rings = layout && layout.rings ? layout.rings : [3.0, 4.8, 6.6, 8.4];

    const maxR = layout && layout.nodes ? layout.nodes.reduce((max, n) => Math.max(max, parseFloat(n.r) || 0), 0) : 8.4;
    const margin = 50;
    const availableW = (width - SIDEBAR_WIDTH) / 2 - margin;
    const availableH = height / 2 - margin;
    const maxPixelRadius = Math.min(availableW, availableH);
    const scale = maxR > 0 ? maxPixelRadius / maxR : 35;

    push();
    noFill();
    strokeWeight(0.5);

    rings.forEach((r, i) => {
        if (r === 0) return;
        const radius = r * scale;
        stroke(60, 90, 140, orbitMode ? 5 : (20 + i * 3));
        circle(centerX, centerY, radius * 2);
    });

    pop();
}

// ===== OVERFLOW LIGHT CONNECTION SYSTEM =====
let connectionParticles = [];
const MAX_CONNECTION_PARTICLES = 500;
// Uniform warm amber glow color (Magnetosphere style)
const GLOW_COLOR = { r: 255, g: 160, b: 40 };

class ConnectionParticle {
    constructor(source, target, probability, color) {
        this.sx = source.x;
        this.sy = source.y;
        this.tx = target.x;
        this.ty = target.y;
        this.target = target;

        // Random offset for bezier control points — wider spread for mist effect
        const dx = this.tx - this.sx;
        const dy = this.ty - this.sy;
        const perpX = -dy * 0.25;
        const perpY = dx * 0.25;
        const bend = random(-1, 1);
        this.cp1x = this.sx + dx * 0.3 + perpX * bend;
        this.cp1y = this.sy + dy * 0.3 + perpY * bend;
        this.cp2x = this.sx + dx * 0.7 - perpX * bend * 0.5;
        this.cp2y = this.sy + dy * 0.7 - perpY * bend * 0.5;

        this.t = random(0, 0.05);
        this.speed = map(probability, 0, 0.4, 0.02, 0.06, true) + random(0, 0.01);
        this.size = map(probability, 0, 0.3, 8, 22, true); // Much larger: misty blobs
        this.alpha = map(probability, 0, 0.3, 60, 180, true);
        this.color = color;
        this.alive = true;
        this.trail = [];
    }

    update() {
        this.t += this.speed;

        if (this.t >= 1.0) {
            // Particle arrived — big glow burst to target
            if (this.target) {
                this.target.receivedGlow = min(this.target.receivedGlow + 30, 255);
            }
            this.alive = false;
            return;
        }

        const x = bezierPoint(this.sx, this.cp1x, this.cp2x, this.tx, this.t);
        const y = bezierPoint(this.sy, this.cp1y, this.cp2y, this.ty, this.t);

        // Longer trail for mist effect
        this.trail.push({ x, y });
        if (this.trail.length > 12) this.trail.shift();
    }

    display() {
        if (this.trail.length < 1) return;
        const head = this.trail[this.trail.length - 1];

        push();
        blendMode(ADD);
        noStroke();

        // Misty trail: large soft blobs with fade
        for (let i = 0; i < this.trail.length; i++) {
            const p = this.trail[i];
            const t = i / this.trail.length;
            const trailAlpha = t * this.alpha * 0.25;
            const trailSize = this.size * (0.4 + 0.6 * t);
            // Outer mist halo
            fill(this.color.r, this.color.g, this.color.b, trailAlpha * 0.3);
            circle(p.x, p.y, trailSize * 3);
            // Inner mist
            fill(this.color.r, this.color.g, this.color.b, trailAlpha);
            circle(p.x, p.y, trailSize);
        }

        // Head: large luminous mist blob
        // Outermost haze
        fill(this.color.r, this.color.g, this.color.b, this.alpha * 0.08);
        circle(head.x, head.y, this.size * 6);
        // Mid glow
        fill(this.color.r, this.color.g, this.color.b, this.alpha * 0.2);
        circle(head.x, head.y, this.size * 3);
        // Core glow
        fill(this.color.r, this.color.g, this.color.b, this.alpha * 0.6);
        circle(head.x, head.y, this.size);
        // Hot white center
        fill(255, 255, 255, this.alpha * 0.5);
        circle(head.x, head.y, this.size * 0.3);

        blendMode(BLEND);
        pop();
    }
}

function drawConnections() {
    // Decay glow
    for (let node of nodes) {
        node.receivedGlow *= 0.96;
        if (node.receivedGlow < 1) { node.receivedGlow = 0; node.receivedRank = 0; }
    }

    if (!activeNode) {
        connectionParticles = connectionParticles.filter(p => p.alive);
        for (let p of connectionParticles) {
            p.update();
            p.display();
        }
        return;
    }

    const allTransitions = CHORD_TRANSITIONS.get(activeNode.name) || [];
    // Filter to only transitions that target actual on-screen nodes, then take top 5
    const nodeNames = new Set(nodes.map(n => n.name));
    const validTransitions = allTransitions.filter(t => nodeNames.has(t.next));
    const top5 = [...validTransitions].sort((a, b) => b.prob - a.prob).slice(0, 5);

    // Spawn mist particles for top 5 only, use uniform warm color
    top5.forEach((trans, rank) => {
        const target = nodes.find(n => n.name === trans.next);
        if (!target) return;

        // Rank-based intensity: rank 0 = strongest, rank 4 = weakest
        const rankIntensity = map(rank, 0, 4, 1.0, 0.3);

        // Spawn rate — top rank gets most particles
        const spawnRate = 0.5 * rankIntensity;
        if (random() < spawnRate && connectionParticles.length < MAX_CONNECTION_PARTICLES) {
            connectionParticles.push(
                new ConnectionParticle(activeNode, target, trans.prob, GLOW_COLOR)
            );
        }

        // Maintain glow on targets (rank-based)
        const targetGlow = 200 * rankIntensity;
        target.receivedGlow = max(target.receivedGlow, targetGlow);
        target.receivedRank = rank + 1;
    });

    // Path guides — warm amber, top 5 only
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
        const cp1x = activeNode.x + dx * 0.3;
        const cp1y = activeNode.y + dy * 0.3;
        const cp2x = activeNode.x + dx * 0.7;
        const cp2y = activeNode.y + dy * 0.7;
        bezier(activeNode.x, activeNode.y, cp1x, cp1y, cp2x, cp2y, target.x, target.y);
    });
    blendMode(BLEND);
    pop();

    // Update and draw connection particles
    connectionParticles = connectionParticles.filter(p => p.alive);
    for (let p of connectionParticles) {
        p.update();
        p.display();
    }

    // Active node overflow glow — warm amber radial burst
    push();
    blendMode(ADD);
    noStroke();
    const glowPulse = (sin(frameCount * 0.1) + 1) * 0.5;
    for (let i = 0; i < 5; i++) {
        const r = activeNode.radius + 15 + i * 15 + glowPulse * 12;
        const a = (60 - i * 10) * (0.6 + glowPulse * 0.4);
        fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, a);
        circle(activeNode.x, activeNode.y, r * 2);
    }
    fill(255, 230, 180, 25 + glowPulse * 20);
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

// Updated NeonNode physics for better separation
class NeonNode {
    constructor(x, y, name, data, clusterType) {
        this.pos = createVector(x, y);
        // Home position includes the cluster offset
        // We add random jitter to home to encourage spread rather than single point
        this.home = createVector(x, y); // Strict home, no jitter

        this.vel = createVector(0, 0);
        this.acc = createVector(0, 0);

        this.name = name;
        this.data = data;
        this.clusterType = clusterType;

        // Safety for color
        const config = CLUSTER_CONFIG[clusterType] || CLUSTER_CONFIG['unknown'];
        this.color = config.color;

        this.x = x; // Direct Coordinate
        this.y = y; // Direct Coordinate

        // Uniform node size
        this.baseRadius = 22;
        this.radius = this.baseRadius;

        this.glow = 0;
        this.receivedGlow = 0; // Glow received from connection particles
        this.receivedRank = 0; // 1-5 rank, 0 = not receiving
        this.pulse = random(TWO_PI);

        this.maxSpeed = 1.5; // Slower movement
    }

    applyPhysics(allNodes) {
        // DISABLED
    }

    update() {
        // DISABLED PHYSICS MOVEMENT
        // this.vel.add(this.acc);
        // this.vel.limit(this.maxSpeed);
        // this.pos.add(this.vel);
        // this.vel.mult(0.92); // More friction for stable movement
        // this.acc.mult(0);

        this.pulse += 0.04;
        if (this.glow > 0) this.glow -= 1;

        // Sync properties for display
        // this.x = this.pos.x;
        // this.y = this.pos.y;
    }

    display() {
        // Orbit mode: only show visible nodes
        if (orbitMode && typeof isOrbitVisible === 'function' && !isOrbitVisible(this.name)) {
            return; // Skip hidden nodes entirely
        }

        push();
        translate(this.x, this.y);

        const isActiveNode = (this === activeNode);
        const isReceiving = this.receivedGlow > 3;
        const p = (sin(this.pulse) + 1) * 0.5;
        const rg = this.receivedGlow;

        // In orbit mode: scale radius 4x, add breathing
        let orbitScale = 1.0;
        if (orbitMode) {
            const breathe = 1.0 + Math.sin(millis() * 0.001 * 0.5 + this.pulse) * 0.15;
            orbitScale = 4.0 * breathe;
        }
        const r = this.radius * orbitScale;

        // Swirl speed: faster when sounding, slow when silent
        const swirlMultiplier = (typeof _orbitIsSounding !== 'undefined' && _orbitIsSounding) ? 1.5 : 0.4;

        blendMode(ADD);
        noStroke();

        if (orbitMode) {
            // ========= ORBIT MODE VISUALS =========
            // Swirling vortex of light arcs around the node
            const time = millis() * 0.001;

            if (isActiveNode) {
                // Center node: massive warm vortex
                // Outermost swirling haze
                for (let i = 0; i < 6; i++) {
                    const angle = time * 0.3 * swirlMultiplier + (TWO_PI / 6) * i;
                    const arcR = r + 80 + sin(time * 0.5 * swirlMultiplier + i) * 30;
                    const ax = cos(angle) * arcR * 0.3;
                    const ay = sin(angle) * arcR * 0.3;
                    fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 6 + p * 4);
                    ellipse(ax, ay, arcR * 1.2, arcR * 0.6);
                }

                // Deep glow layers
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 5);
                circle(0, 0, (r + 150) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 12);
                circle(0, 0, (r + 100) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 30);
                circle(0, 0, (r + 50) * 2);
                fill(255, 220, 150, 25 + p * 15);
                circle(0, 0, (r + 20) * 2);

                // Rotating light streaks
                for (let i = 0; i < 8; i++) {
                    const a = time * 0.8 * swirlMultiplier + (TWO_PI / 8) * i;
                    const sr = r * 0.6 + sin(time * 1.2 * swirlMultiplier + i * 0.7) * r * 0.3;
                    push();
                    rotate(a);
                    fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 15 + p * 10);
                    ellipse(sr, 0, r * 0.8, r * 0.15);
                    pop();
                }
            } else if (isReceiving) {
                // Connected orbiting nodes: softer swirling glow
                const intensity = rg / 200;

                // Swirling arcs (fewer, subtler)
                for (let i = 0; i < 4; i++) {
                    const angle = time * 0.5 * swirlMultiplier + (TWO_PI / 4) * i + this.pulse;
                    push();
                    rotate(angle);
                    fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 12);
                    ellipse(r * 0.5, 0, r * 0.7, r * 0.12);
                    pop();
                }

                // Glow layers
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 10);
                circle(0, 0, (r + 60) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 30);
                circle(0, 0, (r + 30) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 60);
                circle(0, 0, (r + 10) * 2);
                fill(255, 230, 180, intensity * 20);
                circle(0, 0, (r + 3) * 2);
            } else {
                // Idle orbit node (shouldn't be visible, but fallback)
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 4 + p * 2);
                circle(0, 0, (r + 20) * 2);
            }

            // Hex glow ring (scaled)
            let hexGlow = isActiveNode ? (100 + 40 * p) : (isReceiving ? (20 + (rg / 200) * 60) : 15);
            fill(this.color.r, this.color.g, this.color.b, hexGlow);
            drawHexagonVisual(0, 0, r + 8);

            blendMode(BLEND);

            // Dark core
            const bodyAlpha = isActiveNode ? 200 : (isReceiving ? max(60, 180 - rg) : 220);
            fill(8, 5, 15, bodyAlpha);
            const edgeBright = isActiveNode ? 255 : (isReceiving ? 150 + (rg / 200) * 100 : 100);
            stroke(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, edgeBright);
            strokeWeight(isActiveNode ? 3 : 1.5);
            drawHexagonVisual(0, 0, r);

            // Inner swirl ring
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

            // Orbit mode chord label — larger, glowing
            blendMode(BLEND);
            noStroke();
            const textBright = isActiveNode ? 255 : (isReceiving ? 180 + (rg / 200) * 75 : 140);
            fill(255, 240, 220, textBright);
            textSize(16);
            textStyle(BOLD);
            text(getChordName(this.name, this.data), 0, r + 24);
            textStyle(NORMAL);
            blendMode(ADD);

        } else {
            // ========= NORMAL MODE VISUALS (unchanged) =========

            if (isActiveNode) {
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 8);
                circle(0, 0, (r + 100) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 25);
                circle(0, 0, (r + 60) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 60);
                circle(0, 0, (r + 30) * 2);
                fill(255, 220, 150, 40 + p * 20);
                circle(0, 0, (r + 10) * 2);
            } else if (isReceiving) {
                const intensity = rg / 200;
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 15);
                circle(0, 0, (r + 70 + intensity * 40) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 40);
                circle(0, 0, (r + 40 + intensity * 20) * 2);
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, intensity * 80);
                circle(0, 0, (r + 18 + intensity * 8) * 2);
                fill(255, 230, 180, intensity * 35);
                circle(0, 0, (r + 5) * 2);
            } else {
                fill(GLOW_COLOR.r, GLOW_COLOR.g, GLOW_COLOR.b, 6 + p * 4);
                circle(0, 0, (r + 18) * 2);
            }

            let hexGlow = 20 + 10 * p;
            if (isActiveNode) hexGlow = 120 + 40 * p;
            else if (isReceiving) hexGlow = 30 + (rg / 200) * 80;
            fill(this.color.r, this.color.g, this.color.b, hexGlow);
            drawHexagonVisual(0, 0, r + 8 + this.glow / 3);

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

            // Label (normal mode only)
            noStroke();
            const textBright = isActiveNode ? 255 : (isReceiving ? 200 + (rg / 200) * 55 : 180);
            fill(255, 240, 220, textBright);
            textSize(10);
            textStyle(BOLD);
            text(getChordName(this.name, this.data), 0, 0);
            textStyle(NORMAL);
        }

        pop();
    }

    contains(mx, my) {
        return dist(mx, my, this.pos.x, this.pos.y) < this.radius;
    }
}

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
        this.morphTime = 0.5; // seconds for crossfade morph

        this.delayActive = true;
        this.reverbActive = true;

        const arpEl = document.getElementById('arp-toggle');
        this.arpActive = arpEl ? arpEl.checked : true;

        this.filterActive = true;
    }

    init() {
        console.log('Initializing Audio System...');

        // Safety check: remove old effects if they exist
        if (this.keepAliveOsc) { try { this.keepAliveOsc.stop(); this.keepAliveOsc.dispose(); } catch (e) { } }
        if (this.filter) { try { this.filter.disconnect(); } catch (e) { } }
        if (this.delay) { try { this.delay.disconnect(); } catch (e) { } }
        if (this.reverb) { try { this.reverb.disconnect(); } catch (e) { } }

        // 1. Create Filter (LowPass)
        this.filter = new p5.LowPass();
        this.filter.freq(2800);
        this.filter.res(0.3);
        this.filter.disconnect();

        // 2. Create Delay
        this.delay = new p5.Delay();
        this.delay.process(this.filter, 0.35, 0.35, 2300);
        this.delay.setType('pingPong');

        // 3. Create Reverb
        this.reverb = new p5.Reverb();
        this.reverb.process(this.filter, 4, 3);
        this.reverb.set(6, 4);

        // Delay & Reverb dry/wet
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

        console.log('✓ Audio Chain Ready: Osc -> Filter -> Delay/Reverb -> Master');
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
        // Fade out previous oscillators smoothly (morph crossfade)
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

        // Adjust octave based on key
        let octaveShift = 0;
        if (currentKey >= 7) {
            octaveShift = -12;
        }

        const baseOctave = 60 + octaveShift;
        const transposed = chordData.intervals.map(interval => {
            let midi = baseOctave + currentKey + chordData.root + interval;

            // Octave scatter — 5-level control via OCTAVE slider (0-4)
            if (typeof _orbitOctave === 'function') {
                const octLvl = _orbitOctave();
                const roll = Math.random();
                if (octLvl === 1) {
                    // Subtle: rare +1 oct
                    if (roll < 0.10) midi += 12;
                } else if (octLvl === 2) {
                    // Normal: occasional ±1 oct
                    if (roll < 0.08) midi += 12;
                    else if (roll < 0.15) midi -= 12;
                } else if (octLvl === 3) {
                    // Wide: +2/+1/-1
                    if (roll < 0.05) midi += 24;
                    else if (roll < 0.20) midi += 12;
                    else if (roll < 0.30) midi -= 12;
                } else if (octLvl >= 4) {
                    // Extreme: ±2 oct aggressively
                    if (roll < 0.10) midi += 24;
                    else if (roll < 0.30) midi += 12;
                    else if (roll < 0.45) midi -= 12;
                    else if (roll < 0.50) midi -= 24;
                }
                // octLvl === 0: no change
            }

            return midi;
        });
        const freqs = transposed.map(m => midiToFreq(m));
        const attackTime = Math.max(0.08, fadeOutTime * 0.8);

        if (!this.arpActive) {
            // === Ryoji Style: layered, detuned, ethereal ===
            freqs.forEach((freq, i) => {
                setTimeout(() => {
                    if (!this.filter) return;

                    // ORBIT: velocity dynamics — random amp multiplier per note
                    const vel = orbitMode ? (0.3 + Math.random() * 1.2) : 1.0;

                    // Layer 1: Pure sine (warm fundamental)
                    const osc1 = new p5.Oscillator();
                    osc1.setType('sine');
                    osc1.freq(freq);
                    osc1.disconnect();
                    osc1.connect(this.filter);
                    osc1.start();
                    osc1.amp(0);
                    osc1.amp(0.07 * vel, attackTime);
                    this.oscillators.push(osc1);

                    // Layer 2: Triangle, slightly detuned (+3 cents)
                    const osc2 = new p5.Oscillator();
                    osc2.setType('triangle');
                    osc2.freq(freq * Math.pow(2, 3 / 1200)); // +3 cents
                    osc2.disconnect();
                    osc2.connect(this.filter);
                    osc2.start();
                    osc2.amp(0);
                    osc2.amp(0.04 * vel, attackTime * 1.2);
                    this.oscillators.push(osc2);

                    // Layer 3: Sine detuned (-2 cents) for subtle chorus
                    const osc3 = new p5.Oscillator();
                    osc3.setType('sine');
                    osc3.freq(freq * Math.pow(2, -2 / 1200)); // -2 cents
                    osc3.disconnect();
                    osc3.connect(this.filter);
                    osc3.start();
                    osc3.amp(0);
                    osc3.amp(0.03 * vel, attackTime * 1.5);
                    this.oscillators.push(osc3);

                    // Layer 4: Octave-up sine pad (ethereal shimmer)
                    const osc4 = new p5.Oscillator();
                    osc4.setType('sine');
                    osc4.freq(freq * 2.003); // 1 oct up, slight detune
                    osc4.disconnect();
                    osc4.connect(this.filter);
                    osc4.start();
                    osc4.amp(0);
                    osc4.amp(0.015 * vel, attackTime * 2.0);
                    this.oscillators.push(osc4);
                }, i * 25);
            });
        } else {
            // Arpeggio mode — Ryoji bell-like tones
            let arpPattern;
            if (orbitMode) {
                // Orbit mode: random note order within the chord
                arpPattern = [...freqs];
                for (let i = arpPattern.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [arpPattern[i], arpPattern[j]] = [arpPattern[j], arpPattern[i]];
                }
            } else {
                arpPattern = [...freqs, ...freqs.slice().reverse()];
            }
            let arpIndex = 0;

            this.arpLoop = setInterval(() => {
                if (!this.filter) return;

                const freq = arpPattern[arpIndex % arpPattern.length];

                // Main sine bell
                const osc = new p5.Oscillator();
                osc.setType('sine');
                osc.freq(freq);
                osc.disconnect();
                osc.connect(this.filter);
                osc.start();
                osc.amp(0);
                osc.amp(0.08, 0.02);

                // Soft triangle shadow
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

        // Clone and clear main array immediately
        const oscsToStop = [...this.oscillators];
        this.oscillators = [];

        oscsToStop.forEach(osc => {
            try {
                // Long fade out to prevent clicking/popping
                osc.amp(0, 0.5);
                setTimeout(() => {
                    try {
                        osc.stop();
                        osc.dispose();
                    } catch (e) { }
                }, 600);
            } catch (e) { }
        });
    }

    toggleFilter(active) {
        this.filterActive = active;
        if (this.filter) {
            if (active) {
                this.filter.freq(2800);
            } else {
                this.filter.freq(20000);
            }
        }
    }

    toggleDelay(active) {
        this.delayActive = active;
        // Use drywet instead of amp to keep dry signal passing through
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
        // DEPTH = feedback amount (how long the echo sustains)
        // 0 = no repeat, 1 = long echo tail
        if (this.delay && this.delayActive) {
            this.delay.feedback(parseFloat(v) * 0.85);
        }
    }

    setDelayTime(v) {
        // TIME = delay interval (shorter = faster echo repetition)
        // Maps 0-1 range to 0.05-0.8 seconds
        if (this.delay) {
            const time = 0.05 + parseFloat(v) * 0.75;
            this.delay.delayTime(time);
        }
    }

    setReverbDepth(v) {
        if (this.reverb && this.reverbActive) {
            this.reverb.drywet(0.3 + parseFloat(v) * 0.6);
        }
    }

    setArpSpeed(v) {
        this.arpSpeed = parseFloat(v);
    }

    setMorphTime(v) {
        this.morphTime = parseFloat(v) / 1000; // Convert ms to seconds
    }

    setFilterFreq(v) {
        if (this.filter && this.filterActive) {
            const freq = 500 + parseFloat(v) * 4500;
            this.filter.freq(freq);
        }
    }

    setFilterRes(v) {
        if (this.filter && this.filterActive) {
            const res = 0.5 + parseFloat(v) * 20;
            this.filter.res(res);
        }
    }

    playStartupSound() {
        if (!this.filter) return;

        // Deep sub-bass sweep (Ryoji style)
        const osc = new p5.Oscillator();
        osc.setType('sine');
        osc.freq(60);
        osc.disconnect();
        osc.connect(this.filter);
        osc.start();
        osc.amp(0);

        // Quick swell and fade
        osc.amp(0.3, 0.05);
        osc.freq(120, 0.1);

        setTimeout(() => {
            osc.amp(0, 0.4);
            setTimeout(() => {
                osc.stop();
                osc.dispose();
            }, 500);
        }, 100);
    }
}

function midiToFreq(m) {
    return 440 * pow(2, (m - 69) / 12);
}

// Global Interaction Functions
function mousePressed() {
    userStartAudio();
    if (getAudioContext().state !== 'running') {
        getAudioContext().resume();
    }

    if (!isActive) return;

    // Don't play sound when clicking on the sidebar UI
    if (mouseX < SIDEBAR_WIDTH) return;

    let nodeFound = false;
    for (let node of nodes) {
        if (node.contains(mouseX, mouseY)) {
            handleNodePress(node);
            nodeFound = true;
            break;
        }
    }

    // Background Click: Replay last node
    if (!nodeFound && lastPlayedNode) {
        console.log('Background click - Replaying:', lastPlayedNode.name);
        handleNodePress(lastPlayedNode);
        // Visual feedback for background click?
        // Maybe a global ripple? For now, just sound.
    }
}

function mouseDragged() {
    if (!isActive) return;
    if (mouseX < SIDEBAR_WIDTH) return;

    for (let node of nodes) {
        if (node.contains(mouseX, mouseY)) {
            if (activeNode !== node) {
                handleNodePress(node);
            }
            break;
        }
    }
}

function mouseReleased() {
    if (!isActive) return;
    if (mouseX < SIDEBAR_WIDTH) return;
    audioSystem.stopChord();
    activeNode = null;
}

function handleNodePress(node) {
    activeNode = node;
    lastPlayedNode = node;
    console.log('Playing:', node.name);

    const hudChord = document.getElementById('hud-chord');
    if (hudChord) hudChord.textContent = `CHORD: ${getChordName(node.name, node.data)}`;

    audioSystem.startChord(node.data);
    node.glow = 100;
    updateURL();

    // INSTANT GLOW: Top 5 targets light up immediately on chord press
    connectionParticles = []; // Clear old particles
    const allTransitions = CHORD_TRANSITIONS.get(node.name) || [];
    const nodeNames = new Set(nodes.map(n => n.name));
    const validTransitions = allTransitions.filter(t => nodeNames.has(t.next));
    const top5 = [...validTransitions].sort((a, b) => b.prob - a.prob).slice(0, 5);
    top5.forEach((trans, rank) => {
        const target = nodes.find(n => n.name === trans.next);
        if (!target) return;
        const rankIntensity = map(rank, 0, 4, 1.0, 0.3);
        target.receivedGlow = 200 * rankIntensity; // Instant bright
        target.receivedRank = rank + 1;
    });

    // In Orbit mode: if user manually clicked a node, start orbit from it
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
