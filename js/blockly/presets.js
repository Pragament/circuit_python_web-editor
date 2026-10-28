import { DEFAULT_CIRCUIT } from './model.js';
import { starter } from './blocks.js';
export function makeLed(id, type, pins) {
    return { id, type, pins, resistors: pins.map(() => 220), activeLow: false, color: '#ff4055' };
}
function chain(blocks) {
    return blocks.reduceRight((next, block) => ({ ...block, ...(next ? {next:{block:next}} : {}) }), null);
}
export function lessonPreset(kind) {
    const circuit = { ...structuredClone(DEFAULT_CIRCUIT), displayEnabled: kind === 'display', leds: [] };
    if (kind === 'display') return {circuit, workspace: structuredClone(starter)};
    if (kind === 'onboard') circuit.leds = [makeLed('led1', 'onboard', [2])];
    else if (kind === 'multiple') circuit.leds = [makeLed('led1', 'single', [33]), makeLed('led2', 'single', [25])];
    else if (kind === 'rgb') circuit.leds = [makeLed('rgb1', 'rgb', [16,17,18])];
    else throw new Error('Unknown lesson.');
    const blocks = [];
    for (const on of [true, false]) {
        for (const led of circuit.leds) blocks.push({type:'esp_led',fields:{LED:led.id,ON:on?'TRUE':'FALSE'}});
        blocks.push({type:'esp_wait',fields:{SECONDS:1}});
    }
    if (kind === 'rgb') {
        blocks.splice(0, blocks.length, ...[['TRUE','FALSE','FALSE'], ['FALSE','TRUE','FALSE'], ['FALSE','FALSE','TRUE']].flatMap(values => [
            {type:'esp_rgb', fields:{LED:'rgb1',RED:values[0],GREEN:values[1],BLUE:values[2]}}, {type:'esp_wait',fields:{SECONDS:1}},
        ]));
    }
    return { circuit, workspace: {blocks:{languageVersion:0,blocks:[{type:'esp_forever',x:40,y:40,inputs:{DO:{block:chain(blocks)}}}]}} };
}
