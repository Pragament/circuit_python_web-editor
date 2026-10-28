import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import {LESSONS,lessonPreset} from '../js/blockly/presets.js';
import {configureWorkspace,generatePython} from '../js/blockly/blocks.js';

test('all examples retain block explanations and corresponding Python comments after round-trip',()=>{
    for(const [id,title] of LESSONS) {
        const preset=lessonPreset(id), workspace=new Blockly.Workspace(), restored=new Blockly.Workspace();
        try {
            configureWorkspace(workspace,preset.circuit);
            Blockly.serialization.workspaces.load(preset.workspace,workspace);
            for(const block of workspace.getAllBlocks(false)) assert.ok(block.getCommentText(),`${id}: ${block.type}`);
            const source=generatePython(workspace,preset.circuit);
            assert.ok(source.includes(`# ${title} — example algorithm`),id);
            for(const block of workspace.getAllBlocks(false)) {
                for(const line of block.getCommentText().split('\n').filter(Boolean)) assert.ok(source.includes('# '+line),`${id}: ${line}`);
            }
            configureWorkspace(restored,preset.circuit);
            Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(workspace),restored);
            assert.equal(generatePython(restored,preset.circuit),source,id);
        } finally {workspace.dispose();restored.dispose();}
    }
});

test('student comment edits are emitted as comments, including multiple lines',()=>{
    const preset=lessonPreset('gpio-minimal'), workspace=new Blockly.Workspace();
    try {
        configureWorkspace(workspace,preset.circuit);
        Blockly.serialization.workspaces.load(preset.workspace,workspace);
        workspace.getBlocksByType('esp_gpio')[0].setCommentText('My output step\nprint("explanation only")');
        const source=generatePython(workspace,preset.circuit);
        assert.match(source,/        # My output step\n        # print\("explanation only"\)\n        _gpio_2.value = True/);
    } finally {workspace.dispose();}
});
