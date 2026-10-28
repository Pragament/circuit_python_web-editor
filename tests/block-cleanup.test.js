import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import {toolbox,configureWorkspace,programFromWorkspace} from '../js/blockly/blocks.js';
import {migrateWorkspace} from '../js/blockly/migrate-workspace.js';
import {LESSONS,lessonPreset} from '../js/blockly/presets.js';

test('toolbox and all examples use reusable conditions with generic if',()=>{
    const types=toolbox.contents.flatMap(category=>category.contents.map(block=>block.type));
    assert.equal(new Set(types).size,types.length);
    assert.ok(types.includes('esp_if'));
    assert.ok(types.includes('esp_gpio_level'));
    assert.ok(!types.includes('esp_if_gpio'));
    assert.equal(Blockly.Blocks.esp_if_gpio,undefined);
    for(const [id] of LESSONS) assert.ok(!JSON.stringify(lessonPreset(id).workspace).includes('esp_if_gpio'),id);
});

test('legacy GPIO if migrates without changing pins, branches, comments or following steps',()=>{
    const saved={blocks:{languageVersion:0,blocks:[{type:'esp_forever',inputs:{DO:{block:{
        type:'esp_if_gpio',fields:{PIN:9,HIGH:'FALSE'},icons:{comment:{text:'Keep my explanation'}},
        inputs:{DO:{block:{type:'esp_gpio',fields:{PIN:4,HIGH:'TRUE'}}}},
        next:{block:{type:'esp_gpio',fields:{PIN:4,HIGH:'FALSE'}}},
    }}}}]}};
    const migrated=migrateWorkspace(saved);
    assert.equal(saved.blocks.blocks[0].inputs.DO.block.type,'esp_if_gpio');
    assert.deepEqual(migrateWorkspace(migrated),migrated);
    const workspace=new Blockly.Workspace();
    try {
        configureWorkspace(workspace,lessonPreset('gpio-minimal').circuit);
        Blockly.serialization.workspaces.load(migrated,workspace);
        const branch=programFromWorkspace(workspace)[0].body;
        assert.deepEqual(branch[0].condition,{type:'gpio_level',pin:9,high:false});
        assert.deepEqual(branch[0].body,[{type:'gpio',pin:4,high:true}]);
        assert.equal(branch[0].comment,'Keep my explanation');
        assert.deepEqual(branch[1],{type:'gpio',pin:4,high:false});
    } finally {workspace.dispose();}
});
