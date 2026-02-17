// validate_layout.js - Check for overlapping nodes
const fs = require('fs');

const SCALE = 35;
const NODE_RADIUS = 22;
const MIN_DIST = NODE_RADIUS * 2; // 44px

function validate(filename) {
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const nodes = data.nodes;
    console.log(`\n=== ${data.mode} Layout (${nodes.length} nodes) ===`);

    // Check all chords exist in definitions
    const defs = JSON.parse(fs.readFileSync('Chord_Definitions.json', 'utf8'));
    nodes.forEach(n => {
        if (!defs[n.name]) console.log(`  ⚠ MISSING in Chord_Definitions: ${n.name}`);
    });

    let overlaps = 0;
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const ax = a.r * SCALE * Math.cos(a.theta);
            const ay = a.r * SCALE * Math.sin(a.theta);
            const bx = b.r * SCALE * Math.cos(b.theta);
            const by = b.r * SCALE * Math.sin(b.theta);
            const d = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
            if (d < MIN_DIST) {
                console.log(`  ✗ OVERLAP: ${a.name} ↔ ${b.name} (dist=${d.toFixed(1)}px < ${MIN_DIST}px)`);
                overlaps++;
            }
        }
    }
    if (overlaps === 0) {
        console.log(`  ✓ No overlaps detected! All ${nodes.length} nodes OK.`);
    } else {
        console.log(`  ✗ ${overlaps} overlap(s) found!`);
    }
}

validate('Chord_Layout_Config_v11_Major.json');
validate('Chord_Layout_Config_v11_Minor.json');
