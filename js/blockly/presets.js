import { explainLesson } from './lesson-comments.js';
import { DEFAULT_CIRCUIT } from './model.js';
import { ONBOARD_LESSONS, onboardLesson } from './onboard-lessons.js';
import { starter } from './blocks.js';
export function makeLed(id, type, pins) {
    return { id, type, pins, resistors: pins.map(() => 220), activeLow: false, color: '#ff4055' };
}
function chain(blocks) {
    return blocks.reduceRight((next, block) => ({ ...block, ...(next ? {next:{block:next}} : {}) }), null);
}
export function lessonPreset(kind) {
    const lesson = LESSONS.find(([id])=>id === kind);
    const preset = buildLesson(kind);
    return explainLesson(preset,lesson[1],lesson[2]);
}
function buildLesson(kind) {
    if (kind === 'gpio-minimal') return {circuit:{...structuredClone(DEFAULT_CIRCUIT),displayEnabled:false,leds:[]},workspace:{blocks:{languageVersion:0,blocks:[{type:'esp_forever',x:30,y:30,inputs:{DO:{block:{type:'esp_if',inputs:{CONDITION:{block:{type:'esp_gpio_level',fields:{PIN:0,HIGH:'FALSE'}}},DO:{block:{type:'esp_gpio',fields:{PIN:2,HIGH:'TRUE'}}}}}}}}]}}};
    if (kind === 'onboard' || kind.startsWith('onboard-')) return onboardLesson(kind);
    if (kind.startsWith('button-')) return buttonLesson(kind);
    const circuit = { ...structuredClone(DEFAULT_CIRCUIT), displayEnabled: kind === 'display', leds: [] };
    if (kind === 'display') return {circuit, workspace: structuredClone(starter)};
    if (kind === 'multiple') circuit.leds = [makeLed('led1', 'single', [33]), makeLed('led2', 'single', [25])];
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

export const LESSONS = [
    ['display','Seven-segment blink','Blink digit 8 using the seven-segment display.'],
    ['gpio-minimal','Minimal GPIO · if input → set output','Forever → generic if with a GPIO 0 is LOW condition → set GPIO 2 HIGH. Edit either pin and level in the blocks. Input uses a pull-up; output starts LOW and holds its value when the condition is false.'],
    ...ONBOARD_LESSONS,
    ['multiple','Two LEDs · GPIO33 + GPIO25','Switch two breadboard LEDs on and off together.'],
    ['rgb','RGB color cycle','Cycle red, green and blue using three GPIO channels.'],
    ['button-led','BOOT → LED while pressed','Input + if/else: press BOOT to turn the LED on; release to turn it off.'],
    ['button-long-press','BOOT → 2-second long press','Hold BOOT for two seconds to turn the LED on; release to turn it off.'],
    ['button-blink','BOOT → start blinking','Press BOOT once to start blinking. Blinking continues after release.'],
    ['button-counter','BOOT → press counter','Count each debounced press once and print the counter. LED turns on at five presses.'],
    ['button-two-mode','BOOT → two-mode LED','Each press switches the LED between steady on and blinking.'],
    ['button-toggle','BOOT → toggle LED','Each new press toggles the LED on or off; holding does not retrigger it.'],
    ['button-released','BOOT → LED while released','Use not + if/else: LED is on when BOOT is released and off while pressed.'],
    ['button-hold-blink','BOOT → blink while held','Blink only while BOOT is pressed; release to stop and turn the LED off.'],
];
const block = (type,fields={}) => ({type,fields});
const led = on => block('esp_led',{LED:'led1',ON:on?'TRUE':'FALSE'});
const blink = () => block('esp_led_blink',{LED:'led1',SECONDS:0.25});
const condition = (test, yes, no=[]) => ({type:'esp_if',inputs:{CONDITION:{block:test},...(yes.length?{DO:{block:chain(yes)}}:{}),...(no.length?{ELSE:{block:chain(no)}}:{})}});
function buttonLesson(kind) {
    const circuit = {...structuredClone(DEFAULT_CIRCUIT),displayEnabled:false,leds:[makeLed('led1','onboard',[2])],boot:{enabled:true,pin:0}};
    const pressed = () => block('esp_boot_pressed');
    const edge = () => block('esp_boot_edge');
    let body;
    switch(kind) {
        case 'button-led': body=[condition(pressed(),[led(true)],[led(false)])]; break;
        case 'button-long-press': body=[condition(block('esp_boot_held',{SECONDS:2}),[led(true)],[led(false)])]; break;
        case 'button-blink': body=[condition(edge(),[block('esp_mode_set',{VALUE:'TRUE'})]),condition(block('esp_mode'),[blink()],[led(false)])]; break;
        case 'button-counter': body=[condition(edge(),[block('esp_counter_change',{VALUE:1}),block('esp_counter_print')]),condition(block('esp_counter_test',{OP:'GE',VALUE:5}),[led(true)],[led(false)])]; break;
        case 'button-two-mode': body=[condition(edge(),[block('esp_mode_toggle')]),condition(block('esp_mode'),[blink()],[led(true)])]; break;
        case 'button-toggle': body=[condition(edge(),[block('esp_led_toggle',{LED:'led1'})])]; break;
        case 'button-released': body=[condition({type:'esp_not',inputs:{INPUT:{block:pressed()}}},[led(true)],[led(false)])]; break;
        case 'button-hold-blink': body=[condition(pressed(),[blink()],[led(false)])]; break;
        default: throw new Error('Unknown BOOT lesson.');
    }
    return {circuit,workspace:{blocks:{languageVersion:0,blocks:[{type:'esp_forever',x:30,y:30,inputs:{DO:{block:chain(body)}}}]}}};
}
