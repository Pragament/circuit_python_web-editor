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
        assert.match(code, /while True:\n    show_digit\(8\)\n    time.sleep\(1\)/);
        assert.match(code, /_segment_dp.value = False/);
        assert.match(code, /_segment_a.switch_to_output\(value=False\)/);
        assert.match(generatePython(restored, { ...DEFAULT_CIRCUIT, common: 'anode' }), /_segment_a.switch_to_output\(value=True\)/);
        assert.match(code, /GPIO.*str\(number\)/);
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

import { configureWorkspace } from '../js/blockly/blocks.js';
import { normalizeCircuit, validateProgram } from '../js/blockly/model.js';
import { lessonPreset, makeLed } from '../js/blockly/presets.js';
import { pythonForProgram } from '../js/blockly/python.js';
import { spawnSync } from 'node:child_process';

test('onboard, multiple and RGB lessons round-trip with their component selections', () => {
    for (const kind of ['onboard', 'multiple', 'rgb']) {
        const preset = lessonPreset(kind);
        const workspace = new Blockly.Workspace(), restored = new Blockly.Workspace();
        try {
            configureWorkspace(workspace, preset.circuit);
            Blockly.serialization.workspaces.load(preset.workspace, workspace);
            configureWorkspace(restored, preset.circuit);
            Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(workspace), restored);
            assert.deepEqual(programFromWorkspace(restored), programFromWorkspace(workspace));
            const code = generatePython(restored, preset.circuit);
            assert.ok(!code.includes('_segment_names ='), 'LED-only lessons do not allocate display GPIOs');
            assert.match(code, kind === 'rgb' ? /rgb1_red.value = True/ : /led1.value = True/);
        } finally { workspace.dispose(); restored.dispose(); }
    }
});

test('legacy seven-segment circuits normalize without losing wiring', () => {
    const normalized = normalizeCircuit(DEFAULT_CIRCUIT);
    assert.equal(normalized.displayEnabled, true);
    assert.deepEqual(normalized.leds, []);
    assert.deepEqual(normalized.pins, DEFAULT_CIRCUIT.pins);
});

test('validates collisions across display and LEDs, RGB channels, and missing targets', () => {
    const circuit = lessonPreset('multiple').circuit;
    assert.doesNotThrow(() => validateCircuit(circuit));
    assert.throws(() => validateCircuit({...circuit, leds:[...circuit.leds, makeLed('rgb1','rgb',[4,5,33])]}), /different GPIO/);
    assert.throws(() => validateCircuit({...normalizeCircuit(DEFAULT_CIRCUIT), leds:[makeLed('led1','single',[18])]}), /different GPIO/);
    assert.throws(() => validateProgram([{type:'led',id:'missing',on:true}],circuit), /Add LED/);
    assert.throws(() => validateProgram([{type:'rgb',id:'led1',values:[true,true,true]}],circuit), /not an RGB/);
    assert.doesNotThrow(() => validateProgram([{type:'gpio',pin:2,high:true}],circuit));
    assert.throws(() => validateProgram([{type:'digit',value:1}],circuit), /Enable the seven/);
    assert.throws(() => validateCircuit({...circuit, leds:[makeLed('led1','rgb',[1,1,2])]}), /different GPIO/);
});

test('multiple LEDs, RGB mixing and raw GPIO share the same simulation output state', async () => {
    const circuit = {...lessonPreset('multiple').circuit};
    circuit.leds.push({...makeLed('rgb1','rgb',[4,5,16]),activeLow:true});
    const frames = [];
    await simulate([
        {type:'led',id:'led1',on:true}, {type:'led',id:'led2',on:true},
        {type:'rgb',id:'rgb1',values:[true,false,true]},
        {type:'gpio',pin:5,high:false}, // Active-low green joins red + blue -> white.
        {type:'gpio',pin:33,high:false}, {type:'led',id:'led2',on:false},
    ], {circuit,signal:new AbortController().signal,wait:async()=>{},render:(_segments,leds)=>frames.push(leds)});
    assert.deepEqual(frames[1].get('led1'),[true]);
    assert.deepEqual(frames[1].get('led2'),[true]);
    assert.deepEqual(frames[2].get('rgb1'),[true,false,true]);
    assert.deepEqual(frames[3].get('rgb1'),[true,true,true]);
    assert.deepEqual(frames.at(-1).get('led1'),[false]);
    assert.deepEqual(frames.at(-1).get('led2'),[false]);
});

test('generated CircuitPython drives board.IO pins and GPIO fallback with matching polarities', () => {
    const circuit = {...lessonPreset('multiple').circuit};
    circuit.leds.push({...makeLed('rgb1','rgb',[4,5,16]),activeLow:true});
    const script = `
import sys, types
created = {}
class Output:
    def __init__(self, pin):
        self.pin = pin
        created[pin] = self
    def switch_to_output(self, value): self.value = value
sys.modules['board'] = types.SimpleNamespace(IO33=33, IO25=25)
sys.modules['microcontroller'] = types.SimpleNamespace(pin=types.SimpleNamespace(GPIO4=4, GPIO5=5, GPIO16=16))
sys.modules['digitalio'] = types.SimpleNamespace(DigitalInOut=Output)
${pythonForProgram([
{type:'led',id:'led1',on:true},{type:'led',id:'led2',on:true},
{type:'rgb',id:'rgb1',values:[true,false,true]},{type:'gpio',pin:5,high:false},
{type:'led',id:'led1',on:false}],circuit)}
assert len(created) == 5
assert created[33].value is False and created[25].value is True
assert [created[p].value for p in (4,5,16)] == [False, False, False]
`;
    const result = spawnSync('python3', ['-c', script], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr || result.error?.message);
});
