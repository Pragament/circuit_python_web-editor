import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import {lessonPreset} from '../js/blockly/presets.js';
import {configureWorkspace,generatePython,programFromWorkspace} from '../js/blockly/blocks.js';
import {simulate,validateProgram} from '../js/blockly/model.js';

test('minimal GPIO example uses generic if and an editable GPIO condition and focused Python',()=>{
    const {circuit,workspace:json}=lessonPreset('gpio-minimal');
    const workspace=new Blockly.Workspace();
    try {
        configureWorkspace(workspace,circuit);
        Blockly.serialization.workspaces.load(json,workspace);
        assert.equal(workspace.getAllBlocks(false).length,4);
        const input=workspace.getBlocksByType('esp_gpio_level')[0];
        const output=workspace.getBlocksByType('esp_gpio')[0];
        input.setFieldValue(9,'PIN'); input.setFieldValue('TRUE','HIGH');
        output.setFieldValue(4,'PIN'); output.setFieldValue('FALSE','HIGH');
        const source=generatePython(workspace,circuit).split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');
        assert.match(source,/pin.GPIO9/); assert.match(source,/pin.GPIO4/);
        assert.match(source,/while True:\n    if _input_9.value:\n        _gpio_4.value = False/);
        assert.doesNotMatch(source,/def |time|boot|counter|mode|error|board/);
        assert.ok(source.trim().split('\n').length<=12);
        output.setFieldValue(9,'PIN');
        assert.throws(()=>generatePython(workspace,circuit),/both an input and an output/);
    } finally {workspace.dispose();}
});

test('GPIO simulator matches HIGH and LOW conditions and holds output on false',async()=>{
    const {circuit}=lessonPreset('gpio-minimal');
    for(const high of [true,false]) {
        const controller=new AbortController();
        let input=!high, iterations=0;
        const observed=[];
        const program=[{type:'forever',body:[{type:'if',condition:{type:'gpio_level',pin:9,high},body:[{type:'gpio',pin:4,high:true}],otherwise:[]}]}];
        await simulate(program,{circuit,signal:controller.signal,readGpio:()=>input,
            render:(lit,leds,state)=>observed.push(state.gpio.get(4)??false),
            wait:async()=>{iterations++;if(iterations===3)input=high;if(iterations===8)input=!high;if(iterations>14)controller.abort();}});
        assert.equal(observed[0],false); assert.ok(observed.includes(true));assert.equal(observed.at(-1),true);
    }
    assert.throws(()=>validateProgram([{type:'gpio',pin:49,high:true}],circuit),/0 to 48/);
});

test('GPIO condition composes with generic not and if/else',()=>{
    const {circuit,workspace:json}=lessonPreset('gpio-minimal'), workspace=new Blockly.Workspace();
    try {
        configureWorkspace(workspace,circuit);
        Blockly.serialization.workspaces.load(json,workspace);
        const condition=workspace.getBlocksByType('esp_gpio_level')[0], branch=workspace.getBlocksByType('esp_if')[0];
        condition.outputConnection.disconnect();
        const not=workspace.newBlock('esp_not');
        not.getInput('INPUT').connection.connect(condition.outputConnection);
        branch.getInput('CONDITION').connection.connect(not.outputConnection);
        const otherwise=workspace.newBlock('esp_gpio');
        otherwise.setFieldValue('FALSE','HIGH');
        branch.getInput('ELSE').connection.connect(otherwise.previousConnection);
        const program=programFromWorkspace(workspace);
        assert.equal(program[0].body[0].condition.type,'not');
        assert.equal(program[0].body[0].otherwise[0].high,false);
        assert.match(generatePython(workspace,circuit),/if not \(not _input_0.value\):/);
    } finally {workspace.dispose();}
});
