import * as Blockly from 'blockly';
import { pythonGenerator } from 'blockly/python';
import { SEGMENTS, circuitPythonSetup, normalizeCircuit, validateProgram } from './model.js';

import { INPUT_BLOCKS, conditionFromBlock } from './input-blocks.js';

pythonGenerator.INDENT = '    ';
// Disconnected condition blocks are editor fragments, not executable statements.
pythonGenerator.scrubNakedValue = () => '';

Blockly.defineBlocksWithJsonArray([
    { type: 'esp_digit', message0: 'display digit %1', args0: [{ type: 'field_number', name: 'DIGIT', value: 0, min: 0, max: 9, precision: 1 }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: 'esp_segment', message0: 'turn segment %1 %2', args0: [{ type: 'field_dropdown', name: 'SEGMENT', options: SEGMENTS.map(s => [s, s]) }, { type: 'field_dropdown', name: 'ON', options: [['on', 'TRUE'], ['off', 'FALSE']] }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: 'esp_clear', message0: 'clear display', previousStatement: null, nextStatement: null, colour: 285 },
    { type: 'esp_wait', message0: 'wait %1 seconds', args0: [{ type: 'field_number', name: 'SECONDS', value: 1, min: 0, max: 3600 }], previousStatement: null, nextStatement: null, colour: 180 },
    { type: 'esp_repeat', message0: 'repeat %1 times', args0: [{ type: 'field_number', name: 'COUNT', value: 10, min: 0, max: 100000, precision: 1 }], message1: 'do %1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 120 },
    { type: 'esp_forever', message0: 'forever', message1: 'do %1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 120 },
]);
function ledMenu(rgbOnly) {
    return function () {
        const block = this.getSourceBlock();
        const workspace = block?.workspace?.targetWorkspace ?? block?.workspace;
        const options = (workspace?.ledCircuit?.leds ?? []).filter(led => !rgbOnly || led.type === 'rgb').map(led => [led.id, led.id]);
        const selected = this.getValue();
        if (selected && !options.some(([, id]) => id === selected)) options.push([selected + ' (not connected)', selected]);
        return options.length ? options : [['choose LED', 'led1']];
    };
}
for (const [type, label] of [['esp_led_toggle','toggle LED'],['esp_led_blink','blink LED']]) {
    Blockly.Blocks[type] = { init() {
        const input = this.appendDummyInput().appendField(label).appendField(new Blockly.FieldDropdown(ledMenu(false)), 'LED');
        this.getField('LED').setOptions(ledMenu(false));
        if (type === 'esp_led_blink') input.appendField('every').appendField(new Blockly.FieldNumber(0.5,0.01,3600,0.01),'SECONDS').appendField('seconds (without waiting)');
        this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(30);
    } };
}
pythonGenerator.forBlock.esp_led_toggle = block => `toggle_led(${JSON.stringify(block.getFieldValue('LED'))})\n`;
pythonGenerator.forBlock.esp_led_blink = block => `blink_led(${JSON.stringify(block.getFieldValue('LED'))}, ${block.getFieldValue('SECONDS')})\n`;
const onOptions = [['on', 'TRUE'], ['off', 'FALSE']];
Blockly.Blocks.esp_led = { init() {
    this.appendDummyInput().appendField('turn LED').appendField(new Blockly.FieldDropdown(ledMenu(false)), 'LED').appendField(new Blockly.FieldDropdown(onOptions), 'ON');
    this.getField('LED').setOptions(ledMenu(false));
    this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(30);
} };
Blockly.Blocks.esp_rgb = { init() {
    this.appendDummyInput().appendField('RGB LED').appendField(new Blockly.FieldDropdown(ledMenu(true)), 'LED');
    this.getField('LED').setOptions(ledMenu(true));
    this.appendDummyInput().appendField('red').appendField(new Blockly.FieldDropdown(onOptions), 'RED').appendField('green').appendField(new Blockly.FieldDropdown(onOptions), 'GREEN').appendField('blue').appendField(new Blockly.FieldDropdown(onOptions), 'BLUE');
    this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(330);
} };
Blockly.defineBlocksWithJsonArray([{type: 'esp_gpio', message0: 'set GPIO %1 %2', args0: [{type: 'field_number', name: 'PIN', value: 2, min: 0, max: 48, precision: 1}, {type: 'field_dropdown', name: 'HIGH', options: [['HIGH', 'TRUE'], ['LOW', 'FALSE']]}], previousStatement: null, nextStatement: null, colour: 30}]);
const pythonBool = value => value === 'TRUE' ? 'True' : 'False';
pythonGenerator.forBlock.esp_led = block => `set_led(${JSON.stringify(block.getFieldValue('LED'))}, ${pythonBool(block.getFieldValue('ON'))})\n`;
pythonGenerator.forBlock.esp_rgb = block => `set_rgb(${JSON.stringify(block.getFieldValue('LED'))}, ${['RED', 'GREEN', 'BLUE'].map(name => pythonBool(block.getFieldValue(name))).join(', ')})\n`;
pythonGenerator.forBlock.esp_gpio = block => `set_gpio(${block.getFieldValue('PIN')}, ${pythonBool(block.getFieldValue('HIGH'))})\n`;
export function configureWorkspace(workspace, circuit) {
    workspace.ledCircuit = normalizeCircuit(circuit);
}
export function refreshFlyoutLeds(workspace) {
    for (const block of workspace.getFlyout()?.getWorkspace().getAllBlocks(false) ?? []) {
        if (['esp_led','esp_rgb','esp_led_toggle','esp_led_blink'].includes(block.type)) {
            block.getField('LED').setOptions(ledMenu(block.type === 'esp_rgb'));
        }
    }
}

pythonGenerator.forBlock.esp_digit = block => `show_digit(${block.getFieldValue('DIGIT')})\n`;
pythonGenerator.forBlock.esp_segment = block => `set_segment("${block.getFieldValue('SEGMENT')}", ${block.getFieldValue('ON') === 'TRUE' ? 'True' : 'False'})\n`;
pythonGenerator.forBlock.esp_clear = () => 'clear_display()\n';
pythonGenerator.forBlock.esp_wait = block => `time.sleep(${block.getFieldValue('SECONDS')})\n`;
pythonGenerator.forBlock.esp_repeat = (block, generator) => `for _ in range(${block.getFieldValue('COUNT')}):\n${generator.statementToCode(block, 'DO') || '    pass\n'}`;
pythonGenerator.forBlock.esp_forever = (block, generator) => `while True:\n${generator.statementToCode(block, 'DO') || '    pass\n'}    time.sleep(0.01)\n`;

export const toolbox = { kind: 'flyoutToolbox', contents: ['esp_led', 'esp_led_toggle', 'esp_led_blink', 'esp_rgb', 'esp_gpio', 'esp_wait', 'esp_repeat', 'esp_forever', ...INPUT_BLOCKS, 'esp_digit', 'esp_segment', 'esp_clear'].map(type => ({ kind: 'block', type })) };
export const starter = { blocks: { languageVersion: 0, blocks: [{ type: 'esp_forever', x: 40, y: 40, inputs: { DO: { block: { type: 'esp_digit', fields: { DIGIT: 8 }, next: { block: { type: 'esp_wait', fields: { SECONDS: 1 }, next: { block: { type: 'esp_clear', next: { block: { type: 'esp_wait', fields: { SECONDS: 1 } } } } } } } } } } }] } };
export function generatePython(workspace, circuit) {
    validateProgram(programFromWorkspace(workspace), circuit);
    return circuitPythonSetup(circuit) + pythonGenerator.workspaceToCode(workspace);
}
export function programFromWorkspace(workspace) {
    function chain(block) {
        const operations = [];
        for (; block; block = block.getNextBlock()) {
            if (!block.isEnabled()) continue;
            switch (block.type) {
                case 'esp_wait_counter': operations.push({type:'wait_counter'}); break;
                case 'esp_repeat_counter': operations.push({type:'repeat_counter',body:chain(block.getInputTargetBlock('DO'))}); break;
                case 'esp_calculate': operations.push({type:'calculate',a:Number(block.getFieldValue('A')),b:Number(block.getFieldValue('B'))}); break;
                case 'esp_if': operations.push({type:'if',condition:conditionFromBlock(block.getInputTargetBlock('CONDITION')),body:chain(block.getInputTargetBlock('DO')),otherwise:chain(block.getInputTargetBlock('ELSE'))}); break;
                case 'esp_counter_set': operations.push({type:'counter_set',value:Number(block.getFieldValue('VALUE'))}); break;
                case 'esp_counter_change': operations.push({type:'counter_change',value:Number(block.getFieldValue('VALUE'))}); break;
                case 'esp_counter_print': operations.push({type:'print_counter'}); break;
                case 'esp_mode_set': operations.push({type:'mode_set',value:block.getFieldValue('VALUE')==='TRUE'}); break;
                case 'esp_mode_toggle': operations.push({type:'mode_toggle'}); break;
                case 'esp_led_toggle': operations.push({type:'toggle',id:block.getFieldValue('LED')}); break;
                case 'esp_led_blink': operations.push({type:'blink',id:block.getFieldValue('LED'),seconds:Number(block.getFieldValue('SECONDS'))}); break;
                case 'esp_led': operations.push({type: 'led', id: block.getFieldValue('LED'), on: block.getFieldValue('ON') === 'TRUE'}); break;
                case 'esp_rgb': operations.push({type: 'rgb', id: block.getFieldValue('LED'), values: ['RED', 'GREEN', 'BLUE'].map(name => block.getFieldValue(name) === 'TRUE')}); break;
                case 'esp_gpio': operations.push({type: 'gpio', pin: Number(block.getFieldValue('PIN')), high: block.getFieldValue('HIGH') === 'TRUE'}); break;
                case 'esp_digit': operations.push({ type: 'digit', value: Number(block.getFieldValue('DIGIT')) }); break;
                case 'esp_segment': operations.push({ type: 'segment', segment: block.getFieldValue('SEGMENT'), on: block.getFieldValue('ON') === 'TRUE' }); break;
                case 'esp_clear': operations.push({ type: 'clear' }); break;
                case 'esp_wait': operations.push({ type: 'wait', seconds: Number(block.getFieldValue('SECONDS')) }); break;
                case 'esp_repeat': operations.push({ type: 'repeat', count: Number(block.getFieldValue('COUNT')), body: chain(block.getInputTargetBlock('DO')) }); break;
                case 'esp_forever': operations.push({ type: 'forever', body: chain(block.getInputTargetBlock('DO')) }); break;
                default: throw new Error(`Unsupported block: ${block.type}`);
            }
        }
        return operations;
    }
    return workspace.getTopBlocks(true).filter(block => !block.outputConnection).flatMap(chain);
}
