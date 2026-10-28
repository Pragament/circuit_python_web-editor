import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import { lessonPreset, makeLed } from '../js/blockly/presets.js';
import { configureWorkspace, generatePython, programFromWorkspace } from '../js/blockly/blocks.js';
import { circuitWithBlockPin } from '../js/blockly/block-pins.js';
import { normalizeCircuit } from '../js/blockly/model.js';
import { spawnSync } from 'node:child_process';
function load(kind) {
    const preset=lessonPreset(kind), workspace=new Blockly.Workspace();
    const circuit=normalizeCircuit(preset.circuit);
    configureWorkspace(workspace,circuit);
    Blockly.serialization.workspaces.load(preset.workspace,workspace);
    configureWorkspace(workspace,circuit);
    return {circuit,workspace};
}
test('LED ON preview has no unrelated imports, state, helpers or unused hardware',()=>{
    const {workspace,circuit}=load('onboard-on');
    try {
        circuit.leds.push(makeLed('unused','rgb',[16,17,18]));
        circuit.boot.enabled=true;
        const source=generatePython(workspace,circuit).split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');
        assert.match(source,/led1.value = True/);
        assert.ok(source.split('\n').length<15);
        for(const text of ['import time','def ','_counter','_mode','_error','boot','rgb','_resolve_pin(16)','_resolve_pin(0)']) assert.ok(!source.includes(text),text);
    }finally{workspace.dispose();}
});
test('blink preview includes only the LED and delay; BOOT helpers are individually selected',()=>{
    for(const [kind,required,excluded] of [
        ['onboard',['import time','led1.value = True','time.sleep(1)'],['def ','_counter','_mode','_error','boot']],
        ['button-led',['def boot_pressed'],['def boot_held','def boot_new_press','_counter','_mode','_error','blink_']],
        ['button-long-press',['def boot_pressed','def boot_held'],['def boot_new_press','_boot_edge','_counter','_mode']],
        ['button-counter',['_counter = 0','def boot_new_press'],['def boot_held','_boot_pressed_at','_mode','_error']],
    ]){
        const {workspace,circuit}=load(kind);
        try{const source=generatePython(workspace,circuit).split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');for(const token of required)assert.ok(source.includes(token),token);for(const token of excluded)assert.ok(!source.includes(token),token);}
        finally{workspace.dispose();}
    }
});
test('changing an onboard pin updates all references, generated Python and serialized blocks',()=>{
    const item=load('onboard');
    const restored=new Blockly.Workspace();
    try{
        const ledBlock=item.workspace.getAllBlocks(false).find(b=>b.type==='esp_led');
        ledBlock.setFieldValue('4','PIN');
        const circuit=circuitWithBlockPin(item.workspace,item.circuit,ledBlock.id,4);
        configureWorkspace(item.workspace,circuit);
        for(const block of item.workspace.getAllBlocks(false).filter(b=>b.type==='esp_led'))assert.equal(Number(block.getFieldValue('PIN')),4);
        configureWorkspace(restored,circuit);
        Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(item.workspace),restored);
        configureWorkspace(restored,circuit);
        assert.deepEqual(programFromWorkspace(restored),programFromWorkspace(item.workspace));
        const source=generatePython(restored,circuit);
        assert.match(source,/board.IO4/);assert.ok(!source.includes('board.IO2'));
    }finally{item.workspace.dispose();restored.dispose();}
});
test('BOOT GPIO changes synchronize all condition blocks and reject LED conflicts',()=>{
    const item=load('button-long-press');
    try{
        const button=item.workspace.getAllBlocks(false).find(b=>b.type==='esp_boot_held');
        button.setFieldValue('9','PIN');
        const circuit=circuitWithBlockPin(item.workspace,item.circuit,button.id,9);
        configureWorkspace(item.workspace,circuit);
        assert.equal(circuit.boot.pin,9);
        assert.match(generatePython(item.workspace,circuit),/_boot_button = digitalio.DigitalInOut\(_resolve_pin\(9\)\)/);
        assert.throws(()=>circuitWithBlockPin(item.workspace,circuit,button.id,2),/different GPIO/);
        // Side-panel edits use the same synchronization and do not leave stale block pins.
        circuit.boot.pin=8;configureWorkspace(item.workspace,circuit);
        assert.equal(Number(button.getFieldValue('PIN')),8);
    }finally{item.workspace.dispose();}
});
test('custom LED/BOOT GPIOs execute on board aliases with no default-pin accesses',()=>{
    const item=load('button-led');
    try{
        item.circuit.leds[0].pins=[4];item.circuit.boot.pin=9;configureWorkspace(item.workspace,item.circuit);
        const source=generatePython(item.workspace,item.circuit);
        const script=`
import sys,types
class Stop(Exception): pass
clock=[0.0]
created={}
class Pin:
    def __init__(self,pin): self.pin=pin; self.current=False; self.input=False; created[pin]=self
    def switch_to_input(self,pull): assert self.pin==9; self.input=True
    def switch_to_output(self,value): self.current=value
    @property
    def value(self): return False if self.input else self.current
    @value.setter
    def value(self,value): self.current=value
sys.modules['board']=types.SimpleNamespace(IO4=4,IO9=9)
sys.modules['digitalio']=types.SimpleNamespace(DigitalInOut=Pin,Pull=types.SimpleNamespace(UP='UP'))
def sleep(seconds):
    clock[0]+=seconds
    if clock[0]>.2: raise Stop()
sys.modules['time']=types.SimpleNamespace(sleep=sleep,monotonic=lambda:clock[0])
try: exec(${JSON.stringify(source)})
except Stop: pass
assert set(created)=={4,9}
assert created[4].value is True
`;
        const result=spawnSync('python3',['-c',script],{encoding:'utf8',timeout:10000});
        assert.equal(result.status,0,result.stderr||result.error?.message);
    }finally{item.workspace.dispose();}
});
