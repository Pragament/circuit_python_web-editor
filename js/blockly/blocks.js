import * as Blockly from 'blockly';
import { pythonGenerator } from 'blockly/python';
import { SEGMENTS, circuitPythonSetup } from './model.js';

pythonGenerator.INDENT = '    ';

Blockly.defineBlocksWithJsonArray([
    { type: 'esp_digit', message0: 'display digit %1', args0: [{ type: 'field_number', name: 'DIGIT', value: 0, min: 0, max: 9, precision: 1 }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: 'esp_segment', message0: 'turn segment %1 %2', args0: [{ type: 'field_dropdown', name: 'SEGMENT', options: SEGMENTS.map(s => [s, s]) }, { type: 'field_dropdown', name: 'ON', options: [['on', 'TRUE'], ['off', 'FALSE']] }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: 'esp_clear', message0: 'clear display', previousStatement: null, nextStatement: null, colour: 285 },
    { type: 'esp_wait', message0: 'wait %1 seconds', args0: [{ type: 'field_number', name: 'SECONDS', value: 1, min: 0, max: 3600 }], previousStatement: null, nextStatement: null, colour: 180 },
    { type: 'esp_repeat', message0: 'repeat %1 times', args0: [{ type: 'field_number', name: 'COUNT', value: 10, min: 0, max: 100000, precision: 1 }], message1: 'do %1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 120 },
    { type: 'esp_forever', message0: 'forever', message1: 'do %1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 120 },
]);
pythonGenerator.forBlock.esp_digit = block => `show_digit(${block.getFieldValue('DIGIT')})\n`;
pythonGenerator.forBlock.esp_segment = block => `set_segment("${block.getFieldValue('SEGMENT')}", ${block.getFieldValue('ON') === 'TRUE' ? 'True' : 'False'})\n`;
pythonGenerator.forBlock.esp_clear = () => 'clear_display()\n';
pythonGenerator.forBlock.esp_wait = block => `time.sleep(${block.getFieldValue('SECONDS')})\n`;
pythonGenerator.forBlock.esp_repeat = (block, generator) => `for _ in range(${block.getFieldValue('COUNT')}):\n${generator.statementToCode(block, 'DO') || '    pass\n'}`;
pythonGenerator.forBlock.esp_forever = (block, generator) => `while True:\n${generator.statementToCode(block, 'DO') || '    pass\n'}`;

export const toolbox = { kind: 'flyoutToolbox', contents: ['esp_digit', 'esp_segment', 'esp_clear', 'esp_wait', 'esp_repeat', 'esp_forever'].map(type => ({ kind: 'block', type })) };
export const starter = { blocks: { languageVersion: 0, blocks: [{ type: 'esp_forever', x: 40, y: 40, inputs: { DO: { block: { type: 'esp_digit', fields: { DIGIT: 8 }, next: { block: { type: 'esp_wait', fields: { SECONDS: 1 }, next: { block: { type: 'esp_clear', next: { block: { type: 'esp_wait', fields: { SECONDS: 1 } } } } } } } } } } }] } };
export function generatePython(workspace, circuit) {
    return circuitPythonSetup(circuit) + pythonGenerator.workspaceToCode(workspace);
}
export function programFromWorkspace(workspace) {
    function chain(block) {
        const operations = [];
        for (; block; block = block.getNextBlock()) {
            if (!block.isEnabled()) continue;
            switch (block.type) {
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
    return workspace.getTopBlocks(true).flatMap(chain);
}
