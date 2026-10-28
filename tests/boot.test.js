import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import { spawnSync } from 'node:child_process';
import { lessonPreset, LESSONS } from '../js/blockly/presets.js';
import { configureWorkspace, programFromWorkspace, generatePython } from '../js/blockly/blocks.js';
import { BootButton } from '../js/blockly/button-runtime.js';
import { simulate, validateCircuit, validateProgram } from '../js/blockly/model.js';

function load(kind) {
    const preset = lessonPreset(kind), workspace = new Blockly.Workspace();
    configureWorkspace(workspace,preset.circuit);
    Blockly.serialization.workspaces.load(preset.workspace,workspace);
    return {...preset,workspace,program:programFromWorkspace(workspace)};
}
test('all 36 examples round-trip, validate and generate syntactically valid CircuitPython', () => {
    const sources = [];
    assert.equal(LESSONS.length,36);
    for (const [kind] of LESSONS) {
        const lesson=load(kind), restored=new Blockly.Workspace();
        try {
            configureWorkspace(restored,lesson.circuit);
            Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(lesson.workspace),restored);
            assert.deepEqual(programFromWorkspace(restored),lesson.program);
            validateProgram(lesson.program,lesson.circuit);
            const source=generatePython(restored,lesson.circuit);
            if (kind.startsWith('button-')) {
                assert.match(source,/_boot_pin.switch_to_input\(pull=digitalio.Pull.UP\)/);
                assert.match(source,/if /);
            }
            sources.push(source);
        } finally { lesson.workspace.dispose(); restored.dispose(); }
    }
    const compiled=spawnSync('python3',['-c','import json,sys\nfor source in json.load(sys.stdin): compile(source,"lesson.py","exec")'],{input:JSON.stringify(sources),encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr);
});

test('BOOT debounce, edge latch and continuous hold semantics', () => {
    let pressed=false,time=0;
    const button=new BootButton(()=>pressed,()=>time);
    pressed=true; button.update();
    time=.02; assert.equal(button.newPress(),false);
    pressed=false; button.update(); // a bounce cancels the candidate
    time=.04; pressed=true; button.update();
    time=.08; assert.equal(button.newPress(),true);
    assert.equal(button.newPress(),false);
    time=2.07; assert.equal(button.held(2),false);
    time=2.09; assert.equal(button.held(2),true);
    pressed=false; button.update(); time=2.13; assert.equal(button.held(2),false);
    pressed=true; time=3; button.update(); time=3.04; assert.equal(button.newPress(),true);
    assert.equal(button.held(2),false);
});

async function runTimeline(kind,pressWindows,duration=4) {
    const lesson=load(kind), controller=new AbortController();
    let time=0;
    const frames=[],logs=[];
    try {
        await simulate(lesson.program,{
            circuit:lesson.circuit,signal:controller.signal,now:()=>time,
            readBoot:()=>pressWindows.some(([start,end])=>time>=start&&time<end),
            wait:async ms=>{time+=ms/1000;if(time>=duration)controller.abort();},
            render:(_segments,leds,values)=>frames.push({time,on:leds.get('led1')[0],...values}),
            log:text=>logs.push(text),
        });
        return {frames,logs};
    } finally {lesson.workspace.dispose();}
}
test('button-controlled and inverse LED follow press/release',async()=>{
    for(const kind of ['button-led','button-released']) {
        const {frames}=await runTimeline(kind,[[.4,1.5]],2.5);
        assert.ok(frames.some(f=>f.time>.8&&f.time<1.4&&f.on===(kind==='button-led')));
        assert.ok(frames.some(f=>f.time>1.9&&f.on===(kind==='button-released')));
    }
});
test('long press lights after two seconds and turns off on release',async()=>{
    const {frames}=await runTimeline('button-long-press',[[.2,3.1]],4);
    assert.ok(frames.filter(f=>f.time<2.2).every(f=>!f.on));
    assert.ok(frames.some(f=>f.time>2.5&&f.time<3&&f.on));
    assert.ok(frames.some(f=>f.time>3.5&&!f.on));
});
test('counter increments once per press, not every polling iteration',async()=>{
    const windows=[[.2,.8],[1,1.6],[1.8,2.4],[2.6,3.2],[3.4,4]];
    const {frames,logs}=await runTimeline('button-counter',windows,4.5);
    assert.deepEqual(logs,['Counter: 1','Counter: 2','Counter: 3','Counter: 4','Counter: 5']);
    assert.equal(frames.at(-1).counter,5);
    assert.equal(frames.at(-1).on,true);
});
test('blink controller latches on; hold-to-blink stops on release',async()=>{
    const started=await runTimeline('button-blink',[[.2,.7]],2.5);
    const after=started.frames.filter(f=>f.time>1);
    assert.ok(after.some(f=>f.on)&&after.some(f=>!f.on));
    const held=await runTimeline('button-hold-blink',[[.2,.9]],2.5);
    assert.ok(held.frames.filter(f=>f.time>1.3).every(f=>!f.on));
});
test('two-mode and toggle examples switch only on new presses',async()=>{
    const modes=await runTimeline('button-two-mode',[[.2,.9],[1.8,2.3]],3.5);
    assert.ok(modes.frames.some(f=>f.time>1&&f.time<1.7&&f.mode));
    assert.ok(modes.frames.filter(f=>f.time>2.7).every(f=>!f.mode&&f.on));
    const toggle=await runTimeline('button-toggle',[[.2,.9],[1.8,2.3]],3.5);
    assert.ok(toggle.frames.filter(f=>f.time>1.1&&f.time<1.7).every(f=>f.on));
    assert.ok(toggle.frames.filter(f=>f.time>2.7).every(f=>!f.on));
});
test('BOOT pin cannot also drive an LED and BOOT conditions require an input',()=>{
    const lesson=load('button-led');
    try {
        assert.throws(()=>validateCircuit({...lesson.circuit,boot:{enabled:true,pin:2}}),/different GPIO/);
        assert.throws(()=>validateProgram(lesson.program,{...lesson.circuit,boot:{enabled:false,pin:0}}),/Enable the BOOT/);
    } finally {lesson.workspace.dispose();}
});

test('generated Python executes the requested projects against timed active-low GPIO input',()=>{
    const sources=LESSONS.filter(([kind])=>kind.startsWith('button-')).map(([kind])=>{
        const lesson=load(kind);
        try {return {kind,source:generatePython(lesson.workspace,lesson.circuit)};}finally{lesson.workspace.dispose();}
    });
    const script=`
import json, sys, types
class Done(Exception): pass
for lesson in json.load(sys.stdin):
    kind = lesson['kind']
    clock = [0.0]
    history = []
    printed = []
    windows = [(0.2, 0.8), (1, 1.6), (1.8, 2.4), (2.6, 3.2), (3.4, 4)] if kind == 'button-counter' else [(0.2, 3.1)]
    def sleep(seconds):
        clock[0] += seconds
        if clock[0] >= 4.5: raise Done()
    class Pin:
        def __init__(self, pin): self.pin=pin; self.current=False; self.input=False
        def switch_to_input(self, pull):
            assert self.pin == 0 and pull == 'UP'
            self.input=True
        def switch_to_output(self, value): self.value=value
        @property
        def value(self):
            return not any(start <= clock[0] < end for start,end in windows) if self.input else self.current
        @value.setter
        def value(self, value):
            self.current=value
            history.append((clock[0],value))
    sys.modules['board']=types.SimpleNamespace(IO0=0,IO2=2)
    sys.modules['microcontroller']=types.SimpleNamespace(pin=types.SimpleNamespace())
    sys.modules['digitalio']=types.SimpleNamespace(DigitalInOut=Pin,Pull=types.SimpleNamespace(UP='UP'))
    sys.modules['time']=types.SimpleNamespace(monotonic=lambda:clock[0],sleep=sleep)
    namespace={'print':lambda *args:printed.append(' '.join(map(str,args)))}
    try: exec(compile(lesson['source'],kind,'exec'),namespace)
    except Done: pass
    assert clock[0] >= 4.5
    if kind == 'button-counter':
        assert namespace['_counter'] == 5 and len(printed) == 5
    if kind == 'button-long-press':
        assert not any(on for t,on in history if t < 2.2)
        assert any(on for t,on in history if 2.3 < t < 3)
        assert history[-1][1] is False
    if kind == 'button-led':
        assert any(on for t,on in history if 0.4 < t < 3)
        assert history[-1][1] is False
    if kind == 'button-blink':
        assert namespace['_mode'] is True
        assert any(on for t,on in history if t > 3.5)
        assert any(not on for t,on in history if t > 3.5)
    if kind == 'button-two-mode': assert namespace['_mode'] is True
`;
    const result=spawnSync('python3',['-c',script],{input:JSON.stringify(sources),encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
});
