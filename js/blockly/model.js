export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
export const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
export const DEFAULT_CIRCUIT = { pins: [18, 19, 21, 22, 23, 25, 26, 27], resistors: Array(8).fill(220), common: 'cathode' };

export function validateCircuit(circuit) {
    if (!['cathode', 'anode'].includes(circuit.common)) throw new Error('Choose a common-cathode or common-anode display.');
    if (circuit.pins.length !== 8 || circuit.resistors.length !== 8) throw new Error('Wire all eight segments, including the decimal point.');
    if (circuit.pins.some(pin => !Number.isInteger(pin) || pin < 0 || pin > 48)) throw new Error('GPIO numbers must be integers from 0 to 48.');
    if (new Set(circuit.pins).size !== 8) throw new Error('Each segment needs a different GPIO.');
    if (circuit.resistors.some(value => !Number.isFinite(value) || value < 100 || value > 10000)) throw new Error('Each segment needs a resistor between 100 and 10000 Ω.');
}

export function circuitPythonSetup(circuit) {
    validateCircuit(circuit);
    const active = circuit.common === 'cathode' ? 'True' : 'False';
    return `import time\nimport microcontroller\nimport digitalio\n\n# Match these GPIOs to your ESP32 board and wiring.\n# One series resistor per segment; common pin to ${circuit.common === 'cathode' ? 'GND' : '3.3V'}.\n# Resistors (a, b, c, d, e, f, g, dp): ${circuit.resistors.join(', ')} ohms.\n_segment_names = ${JSON.stringify(SEGMENTS)}\n_gpio_numbers = ${JSON.stringify(circuit.pins)}\n_active = ${active}\n_segments = {}\nfor _name, _gpio in zip(_segment_names, _gpio_numbers):\n    _pin = digitalio.DigitalInOut(getattr(microcontroller.pin, "GPIO" + str(_gpio)))\n    _pin.switch_to_output(value=not _active)\n    _segments[_name] = _pin\n\ndef set_segment(name, on):\n    _segments[name].value = _active if on else not _active\n\ndef clear_display():\n    for name in _segment_names:\n        set_segment(name, False)\n\ndef show_digit(digit):\n    patterns = ${JSON.stringify(DIGITS)}\n    pattern = patterns[int(digit) % 10]\n    for name in _segment_names:\n        set_segment(name, name in pattern)\n\n`;
}

// Interpret the supported block operations directly, without evaluating user code.
// Every operation yields so even a wait-free forever loop remains stoppable.
export async function simulate(program, { signal, render, wait }) {
    let lit = new Set();
    async function execute(operations) {
        for (const operation of operations) {
            if (signal.aborted) return;
            switch (operation.type) {
                case 'digit': lit = new Set(DIGITS[operation.value]); break;
                case 'segment': operation.on ? lit.add(operation.segment) : lit.delete(operation.segment); break;
                case 'clear': lit.clear(); break;
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
            render(new Set(lit));
            await wait(16, signal);
        }
    }
    await execute(program);
}
