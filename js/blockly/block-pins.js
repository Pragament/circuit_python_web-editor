import * as Blockly from 'blockly';
import { normalizeCircuit, validateCircuit } from './model.js';
const LED_BLOCKS = new Set(['esp_led','esp_led_toggle','esp_led_blink']);
const BOOT_BLOCKS = new Set(['esp_boot_pressed','esp_boot_edge','esp_boot_held']);
export function addOnboardPinInput(block) {
    block.appendDummyInput('ONBOARD_PIN').appendField('onboard GPIO').appendField(new Blockly.FieldNumber(2,0,48,1),'PIN');
    syncBlockPin(block);
}
function circuitFor(block) {
    const workspace=block.workspace?.targetWorkspace ?? block.workspace;
    return workspace?.ledCircuit;
}
export function syncBlockPin(block) {
    const circuit=circuitFor(block);
    if(!circuit) return;
    if(BOOT_BLOCKS.has(block.type)) {
        if(Number(block.getFieldValue('PIN'))!==circuit.boot.pin) block.setFieldValue(String(circuit.boot.pin),'PIN');
    } else if(LED_BLOCKS.has(block.type)) {
        const led=circuit.leds.find(led=>led.id===block.getFieldValue('LED'));
        block.getInput('ONBOARD_PIN')?.setVisible(led?.type==='onboard');
        if(led?.type==='onboard'&&Number(block.getFieldValue('PIN'))!==led.pins[0]) block.setFieldValue(String(led.pins[0]),'PIN');
    }
}
export function syncWorkspacePins(workspace) {
    Blockly.Events.disable();
    try { for(const block of workspace.getAllBlocks(false)) syncBlockPin(block); }
    finally { Blockly.Events.enable(); }
}
export function circuitWithBlockPin(workspace,circuit,blockId,pin) {
    const block=workspace.getBlockById(blockId);
    if(!block||!block.getField('PIN')) return circuit;
    const next=structuredClone(normalizeCircuit(circuit));
    if(BOOT_BLOCKS.has(block.type)) next.boot={enabled:true,pin:Number(pin)};
    else if(LED_BLOCKS.has(block.type)) {
        const led=next.leds.find(led=>led.id===block.getFieldValue('LED'));
        if(led?.type!=='onboard') return circuit;
        led.pins=[Number(pin)];
    } else return circuit;
    validateCircuit(next);
    return next;
}
