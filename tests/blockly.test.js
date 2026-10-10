import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import * as English from 'blockly/msg/en';
import { DEFAULT_CIRCUIT, validateCircuit, simulate, DIGITS } from '../js/blockly/model.js';
import { starter, generatePython, programFromWorkspace } from '../js/blockly/blocks.js';
Blockly.setLocale(English);

test('starter project round-trips and generates hardware Python', () => {
    const workspace = new Blockly.Workspace();
    const restored = new Blockly.Workspace();
    try {
        Blockly.serialization.workspaces.load(starter, workspace);
        const saved = Blockly.serialization.workspaces.save(workspace);
        Blockly.serialization.workspaces.load(saved, restored);
        assert.deepEqual(programFromWorkspace(restored), [{ type: 'forever', body: [{ type: 'digit', value: 8 }, { type: 'wait', seconds: 1 }, { type: 'clear' }, { type: 'wait', seconds: 1 }] }]);
        const code = generatePython(restored, DEFAULT_CIRCUIT);
        assert.match(code, /while True:\n    show_digit\(8\)\n    time.sleep\(1\)\n    clear_display\(\)\n    time.sleep\(1\)/);
        assert.match(code, /_active = True/);
        assert.match(generatePython(restored, { ...DEFAULT_CIRCUIT, common: 'anode' }), /_active = False/);
        assert.match(code, /GPIO.*str\(_gpio\)/);
    } finally { workspace.dispose(); restored.dispose(); }
});

test('rejects duplicate GPIOs, missing resistors and invalid wiring', () => {
    assert.doesNotThrow(() => validateCircuit(DEFAULT_CIRCUIT));
    assert.throws(() => validateCircuit({ ...DEFAULT_CIRCUIT, pins: Array(8).fill(18) }), /different GPIO/);
    assert.throws(() => validateCircuit({ ...DEFAULT_CIRCUIT, resistors: Array(8).fill(0) }), /resistor/);
    assert.throws(() => validateCircuit({ ...DEFAULT_CIRCUIT, pins: [1] }), /eight/);
});

test('simulates digit, individual segments, repeat, wait and clear', async () => {
    const frames = [], waits = [];
    await simulate([{ type: 'repeat', count: 2, body: [{ type: 'digit', value: 7 }, { type: 'segment', segment: 'dp', on: true }, { type: 'wait', seconds: .5 }, { type: 'clear' }] }], {
        signal: new AbortController().signal,
        render: lit => frames.push([...lit].sort().join('')),
        wait: async ms => waits.push(ms),
    });
    assert.equal(frames[0], DIGITS[7]);
    assert.ok(frames.includes('abcdp'));
    assert.equal(frames.at(-1), '');
    assert.equal(waits.filter(ms => ms === 500).length, 2);
});

test('forever with no wait can be stopped', async () => {
    const controller = new AbortController();
    let ticks = 0;
    await simulate([{ type: 'forever', body: [] }], { signal: controller.signal, render: () => {}, wait: async () => { if (++ticks === 3) controller.abort(); } });
    assert.equal(ticks, 3);
});
