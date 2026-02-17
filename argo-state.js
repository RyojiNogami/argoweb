/**
 * ARGO State Manager + ORBIT Mode Controller
 * 
 * ORBIT params (read from UI sliders):
 *   DENSITY  (0-100) → burst count, gap/silence timing
 *   SCATTER  (0-100) → octave displacement probability
 *   DRIFT    (0-100) → filter sweep speed/range
 *   GHOSTS   (0-100) → ghost note count and volume
 *   WARMTH   (0-100) → base filter frequency
 *
 * SHARE → only works in orbit mode, captures orbit params + key/scale
 * URL load → auto-starts orbit with saved config
 */

// ============================================================
// HELPERS
// ============================================================
function _getSlider(id, f) { const e = document.getElementById(id); return e ? parseFloat(e.value) : f; }
function _getCheckbox(id, f) { const e = document.getElementById(id); return e ? e.checked : f; }
function _setSelect(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function _setCheckbox(id, v) { const e = document.getElementById(id); if (e) e.checked = v; }
function _setSliderVal(id, v) { const e = document.getElementById(id); if (e && v !== undefined) e.value = v; }

// ============================================================
// ORBIT PARAM READERS (normalized 0-100 → usable ranges)
// ============================================================

function _orbitDensity() { return _getSlider('orbit-density', 40); }
function _orbitScatter() { return _getSlider('orbit-scatter', 35); }
function _orbitDrift() { return _getSlider('orbit-drift', 50); }
function _orbitGhosts() { return _getSlider('orbit-ghosts', 30); }
function _orbitWarmth() { return _getSlider('orbit-warmth', 60); }

/** Density → burst count (1-7) */
function _calcBurstCount() {
    const d = _orbitDensity();
    return 1 + Math.floor((d / 100) * 6) + Math.floor(Math.random() * 2);
}

/** Density → burst duration ms (lower density = shorter) */
function _calcBurstMs() {
    const d = _orbitDensity();
    const base = 200 + (d / 100) * 800; // 200-1000ms center
    return base + Math.random() * 500;
}

/** Density → gap between bursts ms */
function _calcGapMs() {
    const d = _orbitDensity();
    const base = 300 + ((100 - d) / 100) * 2200; // lighter density = longer gaps
    return base + Math.random() * 1500;
}

/** Density → silence between nodes ms */
function _calcSilenceMs() {
    const d = _orbitDensity();
    const base = 2000 + ((100 - d) / 100) * 5000; // lighter density = longer silence
    return base + Math.random() * 3000;
}

/** Scatter → probability per note (0-0.6) */
function _calcScatterProb() {
    return (_orbitScatter() / 100) * 0.6;
}

/** Ghosts → count (0-5) */
function _calcGhostCount() {
    const g = _orbitGhosts();
    if (g < 5) return 0;
    return Math.floor((g / 100) * 5) + Math.floor(Math.random() * 2);
}

/** Ghosts → amplitude range */
function _calcGhostAmp() {
    const g = _orbitGhosts();
    return 0.005 + (g / 100) * 0.025;
}

/** Warmth → base filter freq (200-4000 Hz) */
function _calcWarmthFreq() {
    return 200 + (_orbitWarmth() / 100) * 3800;
}

/** Drift → sweep speed */
function _calcDriftSpeed() {
    return 0.01 + (_orbitDrift() / 100) * 0.15;
}

/** Drift → sweep range multiplier */
function _calcDriftRange() {
    return 400 + (_orbitDrift() / 100) * 2000;
}

// ============================================================
// STATE CAPTURE / RESTORE (orbit-only for sharing)
// ============================================================

function captureOrbitState() {
    return {
        v: 2,
        orbit: true,
        key: typeof currentKey !== 'undefined' ? currentKey : 0,
        scale: typeof currentScale !== 'undefined' ? currentScale : 'major',
        density: _orbitDensity(),
        scatter: _orbitScatter(),
        drift: _orbitDrift(),
        ghosts: _orbitGhosts(),
        warmth: _orbitWarmth(),
        fx: {
            filter: _getCheckbox('filter-toggle', true),
            delay: _getCheckbox('delay-toggle', true),
            reverb: _getCheckbox('reverb-toggle', true),
            arp: _getCheckbox('arp-toggle', true),
        },
        params: {
            filterFreq: _getSlider('filter-freq', 0.6),
            filterRes: _getSlider('filter-res', 0.1),
            delayDepth: _getSlider('delay-depth', 0.3),
            delayTime: _getSlider('delay-time', 0.25),
            reverbDepth: _getSlider('reverb-depth', 0.5),
            arpSpeed: _getSlider('arp-speed', 180),
            morphTime: _getSlider('morph-time', 500),
        },
    };
}

/** Legacy v1 capture for non-orbit use (minimal) */
function captureState() {
    return captureOrbitState();
}

function applyOrbitState(state) {
    if (!state) return false;

    currentKey = state.key || 0;
    currentScale = state.scale || 'major';
    _setSelect('key-select', currentKey);
    _setSelect('scale-select', currentScale);
    const hudKey = document.getElementById('hud-key');
    if (hudKey) hudKey.textContent = `KEY: ${KEY_NAMES[currentKey]} ${currentScale.toUpperCase()}`;

    // Set orbit sliders
    if (state.density !== undefined) _setSliderVal('orbit-density', state.density);
    if (state.scatter !== undefined) _setSliderVal('orbit-scatter', state.scatter);
    if (state.drift !== undefined) _setSliderVal('orbit-drift', state.drift);
    if (state.ghosts !== undefined) _setSliderVal('orbit-ghosts', state.ghosts);
    if (state.warmth !== undefined) _setSliderVal('orbit-warmth', state.warmth);

    // Audio FX toggles
    if (state.fx) {
        _setCheckbox('filter-toggle', state.fx.filter);
        _setCheckbox('delay-toggle', state.fx.delay);
        _setCheckbox('reverb-toggle', state.fx.reverb);
        if (state.fx.arp !== undefined) _setCheckbox('arp-toggle', state.fx.arp);
    }
    // All audio params
    if (state.params) {
        _setSliderVal('filter-freq', state.params.filterFreq);
        _setSliderVal('filter-res', state.params.filterRes);
        _setSliderVal('delay-depth', state.params.delayDepth);
        _setSliderVal('delay-time', state.params.delayTime);
        _setSliderVal('reverb-depth', state.params.reverbDepth);
        _setSliderVal('arp-speed', state.params.arpSpeed);
        _setSliderVal('morph-time', state.params.morphTime);
        const arpBpm = document.getElementById('arp-bpm');
        if (arpBpm && state.params.arpSpeed) arpBpm.textContent = state.params.arpSpeed + 'ms';
        const morphVal = document.getElementById('morph-time-val');
        if (morphVal && state.params.morphTime) morphVal.textContent = state.params.morphTime + 'ms';
    }

    processData();
    initAllNodes();
    _pendingOrbitState = state;
    return true;
}

// Alias for legacy code
function applyState(state) { return applyOrbitState(state); }

let _pendingOrbitState = null;
function applyPendingAudioState() {
    const s = _pendingOrbitState;
    if (!s || !audioSystem) return;
    _pendingOrbitState = null;

    if (s.fx) {
        audioSystem.toggleFilter(s.fx.filter);
        audioSystem.toggleDelay(s.fx.delay);
        audioSystem.toggleReverb(s.fx.reverb);
        if (s.fx.arp !== undefined) audioSystem.toggleArpeggio(s.fx.arp);
    }
    if (s.params) {
        if (s.params.filterFreq !== undefined) audioSystem.setFilterFreq(s.params.filterFreq);
        if (s.params.filterRes !== undefined) audioSystem.setFilterRes(s.params.filterRes);
        if (s.params.delayDepth !== undefined) audioSystem.setDelayDepth(s.params.delayDepth);
        if (s.params.delayTime !== undefined) audioSystem.setDelayTime(s.params.delayTime);
        if (s.params.reverbDepth !== undefined) audioSystem.setReverbDepth(s.params.reverbDepth);
        if (s.params.arpSpeed !== undefined) audioSystem.setArpSpeed(s.params.arpSpeed);
        if (s.params.morphTime !== undefined) audioSystem.setMorphTime(s.params.morphTime);
    }

    // Auto-start orbit if the state says orbit
    if (s.orbit && !orbitMode) {
        setTimeout(() => { toggleOrbit(); }, 600);
    }
}

// ============================================================
// URL SERIALIZATION
// ============================================================
function serializeToURL(state) {
    try {
        const json = JSON.stringify(state);
        if (typeof pako !== 'undefined') {
            const c = pako.deflate(json);
            const b = btoa(String.fromCharCode.apply(null, c));
            return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        return btoa(unescape(encodeURIComponent(json)));
    } catch (e) { return null; }
}
function deserializeFromURL(encoded) {
    try {
        if (typeof pako !== 'undefined') {
            let b = encoded.replace(/-/g, '+').replace(/_/g, '/');
            while (b.length % 4) b += '=';
            const bin = atob(b);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return JSON.parse(pako.inflate(bytes, { to: 'string' }));
        }
        return JSON.parse(decodeURIComponent(escape(atob(encoded))));
    } catch (e) { return null; }
}

function loadStateFromURL() {
    const p = new URLSearchParams(window.location.search);
    const e = p.get('s');
    if (!e) return false;
    const s = deserializeFromURL(e);
    return s ? applyOrbitState(s) : false;
}

// No more auto-updating URL — only SHARE button writes URL
function updateURL() {
    // Intentionally empty — removed auto-URL updates
}

// ============================================================
// SHARE (orbit only)
// ============================================================
function shareState() {
    if (!orbitMode) {
        // Show feedback that share only works in orbit
        const btn = document.getElementById('share-btn');
        if (btn) {
            const o = btn.textContent;
            btn.textContent = 'ORBIT ONLY';
            btn.style.borderColor = '#f44';
            btn.style.color = '#f44';
            setTimeout(() => { btn.textContent = o; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
        }
        return;
    }

    const s = captureOrbitState();
    const e = serializeToURL(s);
    if (!e) return;

    const url = window.location.origin + window.location.pathname + '?s=' + e;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('share-btn');
        if (!btn) return;
        const o = btn.textContent;
        btn.textContent = 'COPIED ✓';
        btn.style.borderColor = '#0f0';
        btn.style.color = '#0f0';
        setTimeout(() => { btn.textContent = o; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
    }).catch(() => prompt('Share URL:', url));
}

// ============================================================
// ORBIT MODE CONTROLLER
// ============================================================

let _orbitPhase = 'idle';
let _orbitTimer = null;
let _orbitTransitionStart = 0;
let _orbitTransitionDuration = 1500;
let _orbitNextNode = null;
let _orbitSavedPositions = null;
let _preOrbitAudio = null;
let _orbitAutoTriggered = false;
let _orbitVisibleNodes = new Set();
let _orbitCenterNode = null;
let _orbitBurstCount = 0;
let _orbitPreArpState = null;

let _ghostNoteTimers = [];
let _ghostNoteChordData = null;

let _filterSweepPhase = 0;

let _orbitIsSounding = false;

function _getCanvasCenter() {
    const w = typeof windowWidth !== 'undefined' ? windowWidth : window.innerWidth;
    const h = typeof windowHeight !== 'undefined' ? windowHeight : window.innerHeight;
    const sw = typeof SIDEBAR_WIDTH !== 'undefined' ? SIDEBAR_WIDTH : 280;
    return { x: sw + (w - sw) / 2, y: h / 2 };
}

function _applyOrbitVisuals(active) {
    document.body.classList.toggle('orbit-active', active);
    const btn = document.getElementById('orbit-toggle');
    if (btn) {
        btn.textContent = active ? 'ORBIT: ON' : 'ORBIT: OFF';
        btn.style.borderColor = active ? '#0ff' : '';
        btn.style.color = active ? '#0ff' : '';
        btn.style.background = active ? 'rgba(0,255,255,0.08)' : '';
    }
}

function _applyOrbitAudio() {
    if (!audioSystem) return;
    _preOrbitAudio = {
        reverbDepth: _getSlider('reverb-depth', 0.5),
        filterFreq: _getSlider('filter-freq', 0.6),
        delayDepth: _getSlider('delay-depth', 0.3),
        delayTime: _getSlider('delay-time', 0.25),
    };
    const arpEl = document.getElementById('arp-toggle');
    _orbitPreArpState = {
        arpActive: arpEl ? arpEl.checked : false,
        arpSpeed: _getSlider('arp-speed', 180),
    };

    // Apply warmth-based filter
    const warmthFreq = _calcWarmthFreq();
    if (audioSystem.filter) audioSystem.filter.freq(warmthFreq);
    if (audioSystem.reverb) audioSystem.reverb.drywet(0.9);
    if (audioSystem.delay) { audioSystem.delay.feedback(0.65); audioSystem.delay.delayTime(0.5); }
}

function _restoreOrbitAudio() {
    if (!audioSystem || !_preOrbitAudio) return;
    audioSystem.setReverbDepth(_preOrbitAudio.reverbDepth);
    audioSystem.setFilterFreq(_preOrbitAudio.filterFreq);
    audioSystem.setDelayDepth(_preOrbitAudio.delayDepth);
    audioSystem.setDelayTime(_preOrbitAudio.delayTime);
    _preOrbitAudio = null;
    if (_orbitPreArpState) {
        audioSystem.toggleArpeggio(_orbitPreArpState.arpActive);
        audioSystem.setArpSpeed(_orbitPreArpState.arpSpeed);
        const arpEl = document.getElementById('arp-toggle');
        if (arpEl) arpEl.checked = _orbitPreArpState.arpActive;
        _orbitPreArpState = null;
    }
}

function _orbitRandomizeArp() {
    if (!audioSystem) return;
    const arpOn = Math.random() > 0.5;
    audioSystem.toggleArpeggio(arpOn);
    audioSystem.arpActive = arpOn;
    if (arpOn) {
        audioSystem.arpSpeed = 80 + Math.floor(Math.random() * 320);
    }
}

// ============================================================
// GHOST NOTES
// ============================================================

function _playGhostNote() {
    if (!orbitMode || !audioSystem || !audioSystem.filter || !_ghostNoteChordData) return;

    try {
        const cd = _ghostNoteChordData;
        let octaveShift = 0;
        if (currentKey >= 7) octaveShift = -12;
        const baseOctave = 60 + octaveShift;
        const transposed = cd.intervals.map(iv => baseOctave + currentKey + cd.root + iv);
        const freqs = transposed.map(m => midiToFreq(m));

        let freq = freqs[Math.floor(Math.random() * freqs.length)];

        // Apply scatter probability
        const scatterProb = _calcScatterProb();
        const octRoll = Math.random();
        if (octRoll < scatterProb * 0.3) freq *= 2;
        else if (octRoll < scatterProb * 0.6) freq *= 0.5;

        const amp = _calcGhostAmp();
        const attackTime = 0.8 + Math.random() * 1.2;

        const osc = new p5.Oscillator();
        osc.setType('sine');
        osc.freq(freq);
        osc.disconnect();
        osc.connect(audioSystem.filter);
        osc.start();
        osc.amp(0);
        osc.amp(amp, attackTime);

        const osc2 = new p5.Oscillator();
        osc2.setType('sine');
        osc2.freq(freq * Math.pow(2, (Math.random() * 6 - 3) / 1200));
        osc2.disconnect();
        osc2.connect(audioSystem.filter);
        osc2.start();
        osc2.amp(0);
        osc2.amp(amp * 0.5, attackTime * 1.3);

        const sustainTime = 1500 + Math.random() * 3000;
        setTimeout(() => {
            osc.amp(0, 1.5);
            osc2.amp(0, 2.0);
            setTimeout(() => {
                try { osc.stop(); osc.dispose(); } catch (e) { }
                try { osc2.stop(); osc2.dispose(); } catch (e) { }
            }, 2500);
        }, sustainTime);
    } catch (e) { }
}

function _scheduleGhostNotes(silenceDurationMs) {
    _clearGhostNotes();
    const count = _calcGhostCount();

    for (let i = 0; i < count; i++) {
        const delay = 500 + Math.random() * Math.max(500, silenceDurationMs - 1500);
        const timer = setTimeout(() => {
            if (orbitMode && _orbitPhase === 'silence') _playGhostNote();
        }, delay);
        _ghostNoteTimers.push(timer);
    }
}

function _clearGhostNotes() {
    _ghostNoteTimers.forEach(t => clearTimeout(t));
    _ghostNoteTimers = [];
}

// ============================================================
// NODE ARRANGEMENT
// ============================================================

function _orbitArrangeConnected(centerNode) {
    const center = _getCanvasCenter();
    const ringRadius = 200;

    const allTrans = CHORD_TRANSITIONS.get(centerNode.name) || [];
    const nodeNames = new Set(nodes.map(n => n.name));
    const valid = allTrans.filter(t => nodeNames.has(t.next));
    const top5 = [...valid].sort((a, b) => b.prob - a.prob).slice(0, 5);

    _orbitVisibleNodes = new Set([centerNode.name]);
    top5.forEach(t => _orbitVisibleNodes.add(t.next));
    _orbitCenterNode = centerNode;

    centerNode._orbitStartX = centerNode.x;
    centerNode._orbitStartY = centerNode.y;
    centerNode._orbitTargetX = center.x;
    centerNode._orbitTargetY = center.y;

    const connectedNodes = top5.map(t => nodes.find(n => n.name === t.next)).filter(Boolean);
    connectedNodes.forEach((n, i) => {
        const angle = (TWO_PI / connectedNodes.length) * i - HALF_PI;
        n._orbitStartX = center.x;
        n._orbitStartY = center.y;
        n._orbitTargetX = center.x + cos(angle) * ringRadius;
        n._orbitTargetY = center.y + sin(angle) * ringRadius;
    });

    for (const n of nodes) {
        if (!_orbitVisibleNodes.has(n.name)) {
            n._orbitStartX = n.x;
            n._orbitStartY = n.y;
            n._orbitTargetX = center.x;
            n._orbitTargetY = center.y;
        }
    }
}

function _orbitClearTimers() {
    if (_orbitTimer) { clearTimeout(_orbitTimer); _orbitTimer = null; }
    _clearGhostNotes();
}

// ============================================================
// ORBIT LIFECYCLE
// ============================================================

function toggleOrbit() {
    orbitMode = !orbitMode;
    _applyOrbitVisuals(orbitMode);

    if (orbitMode) {
        _orbitSavedPositions = nodes.map(n => ({ name: n.name, x: n.x, y: n.y }));
        _applyOrbitAudio();
        _orbitPhase = 'idle';
        _orbitBurstCount = 0;
        _orbitIsSounding = false;
        _orbitVisibleNodes = new Set();
        _orbitCenterNode = null;
        _filterSweepPhase = Math.random() * 100;

        const startNode = activeNode || lastPlayedNode || nodes[Math.floor(Math.random() * nodes.length)];
        if (startNode) _orbitBeginCentering(startNode);
    } else {
        _orbitPhase = 'idle';
        _orbitNextNode = null;
        _orbitAutoTriggered = false;
        _orbitBurstCount = 0;
        _orbitIsSounding = false;
        _orbitVisibleNodes = new Set();
        _orbitCenterNode = null;
        _orbitClearTimers();

        if (audioSystem && audioSystem.stopChord) audioSystem.stopChord();

        if (_orbitSavedPositions) {
            for (const saved of _orbitSavedPositions) {
                const n = nodes.find(nd => nd.name === saved.name);
                if (n) { n.x = saved.x; n.y = saved.y; }
            }
            _orbitSavedPositions = null;
        }
        _restoreOrbitAudio();
    }
}

function orbitOnNodeClick(node) {
    if (!orbitMode || _orbitAutoTriggered) return;
    _orbitClearTimers();
    _orbitBeginCentering(node);
}

function _orbitBeginCentering(node) {
    _orbitNextNode = node;
    _orbitPhase = 'centering';
    _orbitTransitionStart = millis();
    _orbitIsSounding = false;
    _orbitArrangeConnected(node);
    _orbitBurstCount = _calcBurstCount();
    _ghostNoteChordData = node.data;
}

function _orbitPlayBurst() {
    if (!orbitMode || !_orbitNextNode) return;
    _orbitPhase = 'bursting';
    _orbitIsSounding = true;

    _orbitRandomizeArp();

    // Re-apply warmth each burst (user may have changed slider)
    const warmthFreq = _calcWarmthFreq();
    if (audioSystem && audioSystem.filter) audioSystem.filter.freq(warmthFreq);

    _orbitAutoTriggered = true;
    handleNodePress(_orbitNextNode);
    _orbitAutoTriggered = false;

    const burstMs = _calcBurstMs();

    _orbitClearTimers();
    _orbitTimer = setTimeout(() => {
        if (!orbitMode) return;
        _orbitIsSounding = false;
        if (audioSystem && audioSystem.stopChord) audioSystem.stopChord();
        _orbitBurstCount--;

        if (_orbitBurstCount > 0) {
            const gapMs = _calcGapMs();
            _orbitTimer = setTimeout(() => {
                if (!orbitMode) return;
                _orbitPlayBurst();
            }, gapMs);
        } else {
            _orbitStartSilence();
        }
    }, burstMs);
}

function _orbitStartSilence() {
    if (!orbitMode) return;
    _orbitPhase = 'silence';
    _orbitIsSounding = false;

    const silenceMs = _calcSilenceMs();
    _scheduleGhostNotes(silenceMs);

    _orbitTimer = setTimeout(() => {
        if (!orbitMode) return;
        _orbitAutoSelectNext(_orbitCenterNode || _orbitNextNode);
    }, silenceMs);
}

function _orbitAutoSelectNext(currentNode) {
    if (!orbitMode || !currentNode) return;

    const allTrans = CHORD_TRANSITIONS.get(currentNode.name) || [];
    const nodeNames = new Set(nodes.map(n => n.name));
    const valid = allTrans.filter(t => nodeNames.has(t.next));
    const top5 = [...valid].sort((a, b) => b.prob - a.prob).slice(0, 5);

    let nextNode = null;
    if (top5.length > 0) {
        const total = top5.reduce((s, t) => s + t.prob, 0);
        let roll = Math.random() * total;
        for (const t of top5) {
            roll -= t.prob;
            if (roll <= 0) { nextNode = nodes.find(n => n.name === t.next); break; }
        }
        if (!nextNode) nextNode = nodes.find(n => n.name === top5[0].next);
    }
    if (!nextNode) nextNode = nodes[Math.floor(Math.random() * nodes.length)];

    _orbitBeginCentering(nextNode);
}

// ============================================================
// ORBIT UPDATE (every frame)
// ============================================================

function orbitUpdate() {
    if (!orbitMode) return;

    // Centering animation
    if (_orbitPhase === 'centering' && _orbitNextNode) {
        const elapsed = millis() - _orbitTransitionStart;
        const t = Math.min(elapsed / _orbitTransitionDuration, 1.0);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        for (const node of nodes) {
            if (node._orbitStartX !== undefined && node._orbitTargetX !== undefined) {
                node.x = node._orbitStartX + (node._orbitTargetX - node._orbitStartX) * ease;
                node.y = node._orbitStartY + (node._orbitTargetY - node._orbitStartY) * ease;
            }
        }

        if (t >= 1.0) _orbitPlayBurst();
    }

    // Evolving filter sweep using DRIFT param
    if (audioSystem && audioSystem.filter) {
        const driftSpeed = _calcDriftSpeed();
        const driftRange = _calcDriftRange();
        _filterSweepPhase += driftSpeed * 0.016;
        const sweep1 = Math.sin(_filterSweepPhase) * 0.35;
        const sweep2 = Math.sin(_filterSweepPhase * 2.7 + 1.3) * 0.15;
        const sweepTotal = sweep1 + sweep2;
        const warmthBase = _calcWarmthFreq();
        const freq = warmthBase + sweepTotal * driftRange;
        audioSystem.filter.freq(Math.max(200, Math.min(5000, freq)));
    }
}

function isOrbitVisible(nodeName) {
    if (!orbitMode) return true;
    if (_orbitVisibleNodes.size === 0) return true;
    return _orbitVisibleNodes.has(nodeName);
}
