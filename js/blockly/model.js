export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
export const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
export const DEFAULT_CIRCUIT = { pins: [18, 19, 21, 22, 23, 25, 26, 27], resistors: Array(8).fill(220), common: 'cathode' };

export function normalizeCircuit(circuit) {
    return { ...circuit, displayEnabled: circuit.displayEnabled !== false, leds: circuit.leds ?? [] };
}

export function validateCircuit(value) {
    const circuit = normalizeCircuit(value);
    const used = new Set();
    function reserve(pins, resistors, name, onboard = false, enabled = true) {
        if (pins.some(pin => !Number.isInteger(pin) || pin < 0 || pin > 48)) throw new Error('GPIO numbers must be integers from 0 to 48.');
        if (!onboard && resistors.some(r => !Number.isFinite(r) || r < 100 || r > 10000)) throw new Error('Each LED channel needs a resistor between 100 and 10000 Ω.');
        if (!enabled) return;
        for (const pin of pins) {
            if (used.has(pin)) throw new Error('Each segment or LED channel needs a different GPIO.');
            used.add(pin);
        }
    }
    if (!['cathode', 'anode'].includes(circuit.common)) throw new Error('Choose a common-cathode or common-anode display.');
    if (!Array.isArray(circuit.pins) || !Array.isArray(circuit.resistors) || circuit.pins.length !== 8 || circuit.resistors.length !== 8) throw new Error('Wire all eight segments, including the decimal point.');
    reserve(circuit.pins, circuit.resistors, 'display', false, circuit.displayEnabled);
    if (!Array.isArray(circuit.leds) || circuit.leds.length > 16) throw new Error('Use at most 16 LEDs.');
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

export function circuitPythonSetup(value) {
    const circuit = normalizeCircuit(value);
    validateCircuit(circuit);
    const active = circuit.common === 'cathode' ? 'True' : 'False';
    let code = `import time
import board
import microcontroller
import digitalio

# GPIO numbers must match your ESP32 variant and wiring.
# Breadboard LEDs need one series resistor per channel.
def _resolve_pin(number):
    pin = getattr(board, "IO" + str(number), None)
    if pin is None:
        pin = getattr(microcontroller.pin, "GPIO" + str(number))
    return pin

_outputs = {}
def _output(number, inactive):
    pin = digitalio.DigitalInOut(_resolve_pin(number))
    pin.switch_to_output(value=inactive)
    _outputs[number] = pin
    return pin

def set_gpio(number, high):
    _outputs[number].value = high

`;
    if (circuit.displayEnabled) code += `# Display common pin to ${circuit.common === 'cathode' ? 'GND' : '3.3V'}.
# Segment resistors: ${circuit.resistors.join(', ')} ohms.
_segment_names = ${JSON.stringify(SEGMENTS)}
_gpio_numbers = ${JSON.stringify(circuit.pins)}
_active = ${active}
_segments = {}
for _name, _gpio in zip(_segment_names, _gpio_numbers):
    _segments[_name] = _output(_gpio, not _active)

def set_segment(name, on):
    _segments[name].value = _active if on else not _active

def clear_display():
    for name in _segment_names:
        set_segment(name, False)

def show_digit(digit):
    patterns = ${JSON.stringify(DIGITS)}
    pattern = patterns[int(digit) % 10]
    for name in _segment_names:
        set_segment(name, name in pattern)

`;
    if (circuit.leds.length) {
        code += '_leds = {}\n';
        for (const led of circuit.leds) {
            code += `# ${led.id}: ${led.type}, GPIO ${led.pins.join(', ')}, ${led.type === 'onboard' ? 'built-in resistor' : 'resistors ' + led.resistors.join(', ') + ' ohms'}.\n`;
            code += `_leds["${led.id}"] = ([${led.pins.map(pin => `_output(${pin}, ${led.activeLow ? 'True' : 'False'})`).join(', ')}], ${led.activeLow ? 'False' : 'True'})\n`;
        }
        code += `
def set_led(name, on):
    pins, active = _leds[name]
    for pin in pins:
        pin.value = active if on else not active

def set_rgb(name, red, green, blue):
    pins, active = _leds[name]
    for pin, on in zip(pins, (red, green, blue)):
        pin.value = active if on else not active

`;
    }
    return code;
}

export function validateProgram(program, value) {
    const circuit = normalizeCircuit(value);
    validateCircuit(circuit);
    const leds = new Map(circuit.leds.map(led => [led.id, led]));
    const pins = new Set([...(circuit.displayEnabled ? circuit.pins : []), ...circuit.leds.flatMap(led => led.pins)]);
    function visit(operations) {
        for (const op of operations) {
            if (['digit', 'segment', 'clear'].includes(op.type) && !circuit.displayEnabled) throw new Error('Enable the seven-segment display or remove its blocks.');
            if (op.type === 'led' || op.type === 'rgb') {
                if (!leds.has(op.id)) throw new Error(`Add LED "${op.id}" in Circuit components, or choose an existing LED in the block.`);
                if (op.type === 'rgb' && leds.get(op.id).type !== 'rgb') throw new Error(`LED "${op.id}" is not an RGB LED.`);
            }
            if (op.type === 'gpio' && !pins.has(op.pin)) throw new Error(`Connect an LED or display channel to GPIO ${op.pin} first.`);
            if (op.body) visit(op.body);
        }
    }
    visit(program);
}

// Interpret the supported block operations directly, without evaluating user code.
// Every operation yields so even a wait-free forever loop remains stoppable.
export async function simulate(program, { signal, render, wait, circuit: value = DEFAULT_CIRCUIT }) {
    const circuit = normalizeCircuit(value);
    validateProgram(program, circuit);
    let lit = new Set();
    const levels = new Map();
    if (circuit.displayEnabled) circuit.pins.forEach(pin => levels.set(pin, circuit.common === 'anode'));
    circuit.leds.forEach(led => led.pins.forEach(pin => levels.set(pin, led.activeLow)));
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
                case 'gpio':
                    levels.set(operation.pin, operation.high);
                    if (circuit.displayEnabled) circuit.pins.forEach((pin, i) => {
                        levels.get(pin) !== (circuit.common === 'anode') ? lit.add(SEGMENTS[i]) : lit.delete(SEGMENTS[i]);
                    });
                    break;
                case 'wait': await wait(operation.seconds * 1000, signal); break;
                case 'repeat':
                    for (let index = 0; index < operation.count && !signal.aborted; index++) {
                        await execute(operation.body);
                        await wait(16, signal);
                    }
                    break;
                case 'forever':
                    while (!signal.aborted) {
                        await execute(operation.body);
                        await wait(16, signal);
                    }
                    break;
                default: throw new Error(`Unsupported simulation operation: ${operation.type}`);
            }
            if (signal.aborted) return;
            render(new Set(lit), ledOutput());
            await wait(16, signal);
        }
    }
    await execute(program);
}
