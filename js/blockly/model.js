import { BootButton } from './button-runtime.js';
export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
export const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
export const DEFAULT_CIRCUIT = { pins: [18, 19, 21, 22, 23, 25, 26, 27], resistors: Array(8).fill(220), common: 'cathode' };

export function normalizeCircuit(circuit) {
    return { ...circuit, displayEnabled: circuit.displayEnabled !== false, leds: circuit.leds ?? [], boot: circuit.boot ?? { enabled: false, pin: 0 } };
}

export function validateCircuit(value) {
    const circuit = normalizeCircuit(value);
    const used = new Set();
    function reserve(pins, resistors, name, onboard = false, enabled = true) {
        if (pins.some(pin => !Number.isInteger(pin) || pin < 0 || pin > 48)) throw new Error('GPIO numbers must be integers from 0 to 48.');
        if (!onboard && resistors.some(r => !Number.isFinite(r) || r < 100 || r > 10000)) throw new Error('Each LED channel needs a resistor between 100 and 10000 Ω.');
        if (!enabled) return;
        for (const pin of pins) {
            if (used.has(pin)) throw new Error('Each input, segment or LED channel needs a different GPIO.');
            used.add(pin);
        }
    }
    if (!['cathode', 'anode'].includes(circuit.common)) throw new Error('Choose a common-cathode or common-anode display.');
    if (!Array.isArray(circuit.pins) || !Array.isArray(circuit.resistors) || circuit.pins.length !== 8 || circuit.resistors.length !== 8) throw new Error('Wire all eight segments, including the decimal point.');
    reserve(circuit.pins, circuit.resistors, 'display', false, circuit.displayEnabled);
    if (!Array.isArray(circuit.leds) || circuit.leds.length > 16) throw new Error('Use at most 16 LEDs.');
    if (typeof circuit.boot.enabled !== 'boolean' || !Number.isInteger(circuit.boot.pin) || circuit.boot.pin < 0 || circuit.boot.pin > 48) throw new Error('Choose a BOOT button GPIO from 0 to 48.');
    if (circuit.boot.enabled) reserve([circuit.boot.pin], [], 'BOOT', true);
    const ids = new Set();
    for (const led of circuit.leds) {
        if (typeof led.id !== 'string' || !/^[a-z][a-z0-9_]{0,23}$/.test(led.id) || ids.has(led.id)) throw new Error('LED identifiers must be unique lowercase names.');
        ids.add(led.id);
        if (!['single', 'onboard', 'rgb'].includes(led.type)) throw new Error('Choose a single, onboard or RGB LED.');
        const count = led.type === 'rgb' ? 3 : 1;
        if (!Array.isArray(led.pins) || !Array.isArray(led.resistors) || led.pins.length !== count || led.resistors.length !== count) throw new Error('Wire every LED channel.');
        if (typeof led.activeLow !== 'boolean') throw new Error('Choose the LED polarity.');
        if (!/^#[0-9a-f]{6}$/i.test(led.color)) throw new Error('Choose a valid LED color.');
        reserve(led.pins, led.resistors, led.id, led.type === 'onboard');
    }
}

export function validateProgram(program, value) {
    const circuit = normalizeCircuit(value);
    validateCircuit(circuit);
    const leds = new Map(circuit.leds.map(led => [led.id, led]));
    const pins = new Set([...(circuit.displayEnabled ? circuit.pins : []), ...circuit.leds.flatMap(led => led.pins)]);
    const inputs = new Set(), outputs = new Set(pins);
    const validPin = pin => { if (!Number.isInteger(pin) || pin < 0 || pin > 48) throw new Error("GPIO numbers must be integers from 0 to 48."); };
    function condition(expression) {
        if (!expression) return;
        if (['pressed', 'edge', 'held'].includes(expression.type) && !circuit.boot.enabled) throw new Error('Enable the BOOT button input before using its blocks.');
        if (expression.type === 'gpio_level') { validPin(expression.pin); inputs.add(expression.pin); }
        if (expression.input) condition(expression.input);
    }
    function visit(operations) {
        for (const op of operations) {
            if (['digit', 'segment', 'clear'].includes(op.type) && !circuit.displayEnabled) throw new Error('Enable the seven-segment display or remove its blocks.');
            if (['led', 'rgb', 'toggle', 'blink'].includes(op.type)) {
                if (!leds.has(op.id)) throw new Error(`Add LED "${op.id}" in Circuit components, or choose an existing LED in the block.`);
                if (op.type === 'rgb' && leds.get(op.id).type !== 'rgb') throw new Error(`LED "${op.id}" is not an RGB LED.`);
            }
            if (op.type === 'gpio') { validPin(op.pin); outputs.add(op.pin); }
            condition(op.condition);
            if (op.body) visit(op.body);
            if (op.otherwise) visit(op.otherwise);
        }
    }
    visit(program);
    if (circuit.boot.enabled) inputs.add(circuit.boot.pin);
    for (const pin of inputs) if (outputs.has(pin)) throw new Error(`GPIO ${pin} cannot be both an input and an output.`);
}

// Interpret the supported block operations directly, without evaluating user code.
// Every operation yields so even a wait-free forever loop remains stoppable.
export async function simulate(program, { signal, render, wait, circuit: value = DEFAULT_CIRCUIT, readBoot = () => false, readGpio = () => true, now = () => performance.now() / 1000, log = () => {} }) {
    const circuit = normalizeCircuit(value);
    validateProgram(program, circuit);
    let lit = new Set();
    let counter = 0, mode = false, error = false;
    const button = new BootButton(readBoot, now), blinkTimes = new Map();
    function evaluate(expression) {
        switch (expression.type) {
            case 'gpio_level': return Boolean(readGpio(expression.pin)) === expression.high;
            case 'pressed': return button.update();
            case 'edge': return button.newPress();
            case 'held': return button.held(expression.seconds);
            case 'mode': return mode;
            case 'error': return error;
            case 'counter': return expression.op === 'EQ' ? counter === expression.value : expression.op === 'LT' ? counter < expression.value : counter >= expression.value;
            case 'not': return !evaluate(expression.input);
            case 'boolean': return expression.value;
            default: throw new Error('Unsupported condition.');
        }
    }
    const levels = new Map();
    if (circuit.displayEnabled) circuit.pins.forEach(pin => levels.set(pin, circuit.common === 'anode'));
    circuit.leds.forEach(led => led.pins.forEach(pin => levels.set(pin, led.activeLow)));
    function initializeOutputs(operations) {
        for (const op of operations) {
            if (op.type === 'gpio' && !levels.has(op.pin)) levels.set(op.pin, false);
            if (op.body) initializeOutputs(op.body);
            if (op.otherwise) initializeOutputs(op.otherwise);
        }
    }
    initializeOutputs(program);
    const setSegments = () => circuit.pins.forEach((pin, i) => levels.set(pin, lit.has(SEGMENTS[i]) !== (circuit.common === 'anode')));
    const ledOutput = () => new Map(circuit.leds.map(led => [led.id, led.pins.map(pin => levels.get(pin) !== led.activeLow)]));
    async function execute(operations) {
        for (const operation of operations) {
            if (signal.aborted) return;
            switch (operation.type) {
                case 'digit': lit = new Set(DIGITS[operation.value]); setSegments(); break;
                case 'segment': operation.on ? lit.add(operation.segment) : lit.delete(operation.segment); setSegments(); break;
                case 'clear': lit.clear(); setSegments(); break;
                case 'led':
                case 'rgb': {
                    const led = circuit.leds.find(led => led.id === operation.id);
                    led.pins.forEach((pin, i) => levels.set(pin, (operation.type === 'led' ? operation.on : operation.values[i]) !== led.activeLow));
                    break;
                }
                case 'toggle':
                case 'blink': {
                    const led = circuit.leds.find(led => led.id === operation.id);
                    if (operation.type === 'toggle' || !blinkTimes.has(led.id) || now() - blinkTimes.get(led.id) >= operation.seconds) {
                        const on = !(levels.get(led.pins[0]) !== led.activeLow);
                        led.pins.forEach(pin => levels.set(pin, on !== led.activeLow));
                        if (operation.type === 'blink') blinkTimes.set(led.id, now());
                    }
                    break;
                }
                case 'if': await execute(evaluate(operation.condition) ? operation.body : operation.otherwise); break;
                case 'counter_set': counter = operation.value; break;
                case 'counter_change': counter += operation.value; break;
                case 'mode_set': mode = operation.value; break;
                case 'mode_toggle': mode = !mode; break;
                case 'print_counter': log('Counter: ' + counter); break;
                case 'gpio':
                    levels.set(operation.pin, operation.high);
                    if (circuit.displayEnabled) circuit.pins.forEach((pin, i) => {
                        levels.get(pin) !== (circuit.common === 'anode') ? lit.add(SEGMENTS[i]) : lit.delete(SEGMENTS[i]);
                    });
                    break;
                case 'calculate':
                    error = operation.b === 0;
                    counter = error ? 0 : operation.a / operation.b;
                    break;
                case 'wait_counter': await wait(Math.max(0,counter),signal); break;
                case 'wait': await wait(operation.seconds * 1000, signal); break;
                case 'repeat':
                case 'repeat_counter': {
                    const count = operation.type === 'repeat' ? operation.count : Math.max(0,Math.min(100000,Math.trunc(counter)));
                    for (let index = 0; index < count && !signal.aborted; index++) {
                        await execute(operation.body);
                        await wait(16, signal);
                    }
                    break;
                }
                case 'forever':
                    while (!signal.aborted) {
                        await execute(operation.body);
                        await wait(16, signal);
                    }
                    break;
                default: throw new Error(`Unsupported simulation operation: ${operation.type}`);
            }
            if (signal.aborted) return;
            render(new Set(lit), ledOutput(), { counter, mode, error, pressed: button.stable, gpio: new Map(levels) });
            await wait(16, signal);
        }
    }
    await execute(program);
}
