import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import { spawnSync } from 'node:child_process';
import { ONBOARD_LESSONS } from '../js/blockly/onboard-lessons.js';
import { lessonPreset } from '../js/blockly/presets.js';
import { configureWorkspace, generatePython, programFromWorkspace } from '../js/blockly/blocks.js';
import { simulate } from '../js/blockly/model.js';
function lesson(kind) {
    const preset=lessonPreset(kind), workspace=new Blockly.Workspace();
    configureWorkspace(workspace,preset.circuit);
    Blockly.serialization.workspaces.load(preset.workspace,workspace);
    return {...preset,workspace,program:programFromWorkspace(workspace)};
}
async function cycle(kind, mutate) {
    const item=lesson(kind),frames=[],delays=[],logs=[];
    try {
        if(mutate) mutate(item.workspace);
        // Execute one cycle of a forever lesson; finite repeat blocks run fully.
        const program=programFromWorkspace(item.workspace).flatMap(op=>op.type==='forever'?op.body:[op]);
        let now=0,on=false;
        await simulate(program,{circuit:item.circuit,signal:new AbortController().signal,now:()=>now,
            render:(_segments,leds,values)=>{on=leds.get('led1')[0];frames.push({...values,on});},
            wait:async ms=>{now+=ms/1000;if(ms!==16)delays.push({ms,on});},log:text=>logs.push(text)});
        let previous=false,flashes=0;
        for(const frame of frames){if(frame.on&&!previous)flashes++;previous=frame.on;}
        return {frames,delays,logs,flashes};
    } finally {item.workspace.dispose();}
}
test('exactly 25 LED-only examples allocate only onboard GPIO2 and no BOOT input',()=>{
    assert.equal(ONBOARD_LESSONS.length,25);
    assert.equal(new Set(ONBOARD_LESSONS.map(([id])=>id)).size,25);
    for(const [kind] of ONBOARD_LESSONS){
        const item=lesson(kind);
        try{
            assert.equal(item.circuit.boot.enabled,false);
            assert.equal(item.circuit.displayEnabled,false);
            assert.deepEqual(item.circuit.leds.map(led=>[led.type,led.pins]),[['onboard',[2]]]);
            const source=generatePython(item.workspace,item.circuit);
            assert.ok(!source.includes('_boot_button ='));
        }finally{item.workspace.dispose();}
    }
});
test('finite, countdown, variable, nested, startup and completion patterns have exact flash counts',async()=>{
    for(const [kind,count,finalOn] of [
        ['onboard-finite',5,false],['onboard-countdown',15,false],['onboard-variable',4,false],
        ['onboard-nested',12,false],['onboard-startup',3,true],['onboard-complete',3,false],['onboard-sequence',3,false],
    ]){
        const result=await cycle(kind);
        assert.equal(result.flashes,count,kind);
        assert.equal(result.frames.at(-1).on,finalOn,kind);
    }
    assert.equal((await cycle('onboard-countdown')).frames.at(-1).counter,0);
    assert.deepEqual((await cycle('onboard-complete')).logs,['Counter: 4']);
});
test('steady states and standard blink speeds',async()=>{
    assert.equal((await cycle('onboard-on')).frames.at(-1).on,true);
    assert.equal((await cycle('onboard-off')).frames.at(-1).on,false);
    for(const [kind,ms] of [['onboard',1000],['onboard-fast',100],['onboard-slow',3000]]){
        assert.deepEqual((await cycle(kind)).delays.map(d=>d.ms),[ms,ms]);
    }
});
test('SOS has three short, three long, three short pulses; grouped patterns match their counts',async()=>{
    assert.deepEqual((await cycle('onboard-sos')).delays.filter(d=>d.on).map(d=>d.ms),[200,200,200,600,600,600,200,200,200]);
    assert.equal((await cycle('onboard-triple')).flashes,3);
    assert.equal((await cycle('onboard-double')).flashes,2);
    assert.equal((await cycle('onboard-heartbeat')).flashes,2);
    assert.equal((await cycle('onboard-alternating')).flashes,5);
    assert.deepEqual((await cycle('onboard-short-long')).delays.filter(d=>d.on).map(d=>d.ms),[150,800]);
});
test('speed changes use the actual counter variable as the delay',async()=>{
    for(const [kind,start,step] of [['onboard-faster',1000,-100],['onboard-slower',100,100]]){
        assert.deepEqual((await cycle(kind)).delays.map(d=>d.ms),Array.from({length:10},(_,i)=>[start+i*step,start+i*step]).flat());
    }
});
test('error pattern follows a real failed calculation and clears for a valid divisor',async()=>{
    const failed=await cycle('onboard-error');
    assert.equal(failed.frames.at(-1).error,true);
    assert.equal(failed.flashes,3);
    const passed=await cycle('onboard-error',workspace=>workspace.getAllBlocks(false).find(b=>b.type==='esp_calculate').setFieldValue('2','B'));
    assert.equal(passed.frames.at(-1).error,false);
    assert.equal(passed.frames.at(-1).counter,5);
    assert.equal(passed.frames.at(-1).on,true);
    assert.equal(passed.flashes,1);
});
test('all 25 generated Python programs run using only an onboard LED test double',()=>{
    const sources=ONBOARD_LESSONS.map(([kind])=>{
        const item=lesson(kind);try{return {kind,source:generatePython(item.workspace,item.circuit)};}finally{item.workspace.dispose();}
    });
    const script=`
import json,sys,types
class Finished(Exception): pass
for item in json.load(sys.stdin):
    clock=[0.0]
    values=[]
    printed=[]
    class Output:
        def __init__(self,pin): assert pin==2; self.current=False
        def switch_to_output(self,value): self.value=value
        @property
        def value(self): return self.current
        @value.setter
        def value(self,value): self.current=value; values.append(value)
    def sleep(seconds):
        assert seconds>=0
        clock[0]+=seconds
        if clock[0]>60: raise Finished()
    sys.modules['board']=types.SimpleNamespace(IO2=2)
    sys.modules['microcontroller']=types.SimpleNamespace(pin=types.SimpleNamespace())
    sys.modules['digitalio']=types.SimpleNamespace(DigitalInOut=Output)
    sys.modules['time']=types.SimpleNamespace(monotonic=lambda:clock[0],sleep=sleep)
    namespace={'print':lambda *args:printed.append(args)}
    try: exec(compile(item['source'],item['kind'],'exec'),namespace)
    except Finished: pass
    kind=item['kind']
    assert '_boot_button' not in namespace
    counts={'onboard-finite':5,'onboard-countdown':15,'onboard-variable':4,'onboard-nested':12,'onboard-complete':3,'onboard-sequence':3}
    if kind in counts:
        assert clock[0]<60
        assert sum(on and not previous for previous,on in zip([False]+values,values))==counts[kind],kind
        assert values[-1] is False
    if kind=='onboard-on': assert values[-1] is True
    if kind=='onboard-off': assert values[-1] is False
    if kind=='onboard-complete': assert namespace['_counter']==4 and printed==[('Counter:',4.0)]
    if kind=='onboard-error': assert namespace['_error'] is True
`;
    const result=spawnSync('python3',['-c',script],{input:JSON.stringify(sources),encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
});
