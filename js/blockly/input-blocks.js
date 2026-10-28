import * as Blockly from 'blockly';
import { pythonGenerator, Order } from 'blockly/python';
const number = (name, value, min = 0) => ({type:'field_number',name,value,min,precision: name === 'SECONDS' ? 0.01 : 1});
const statement = (type, message0, args0 = [], colour = 210) => ({type,message0,args0,previousStatement:null,nextStatement:null,colour});
const boolean = (type, message0, args0 = []) => ({type,message0,args0,output:'Boolean',colour:210});
Blockly.defineBlocksWithJsonArray([
    {type:'esp_if',message0:'if %1',args0:[{type:'input_value',name:'CONDITION',check:'Boolean'}],message1:'then %1',args1:[{type:'input_statement',name:'DO'}],message2:'else %1',args2:[{type:'input_statement',name:'ELSE'}],previousStatement:null,nextStatement:null,colour:210},
    boolean('esp_boot_pressed','BOOT is pressed'),
    boolean('esp_boot_edge','BOOT was newly pressed'),
    boolean('esp_boot_held','BOOT held for %1 seconds',[number('SECONDS',2,0.01)]),
    boolean('esp_mode','mode is on'),
    boolean('esp_error','calculation error occurred'),
    boolean('esp_counter_test','counter %1 %2',[{type:'field_dropdown',name:'OP',options:[['≥','GE'],['=','EQ'],['<','LT']]},number('VALUE',5,-1000000)]),
    boolean('esp_not','not %1',[{type:'input_value',name:'INPUT',check:'Boolean'}]),
    boolean('esp_boolean','%1',[{type:'field_dropdown',name:'VALUE',options:[['true','TRUE'],['false','FALSE']]}]),
    statement('esp_counter_set','set counter to %1',[number('VALUE',0,-1000000)]),
    statement('esp_counter_change','change counter by %1',[number('VALUE',1,-1000000)]),
    statement('esp_counter_print','print counter'),
    statement('esp_mode_set','set mode %1',[{type:'field_dropdown',name:'VALUE',options:[['on','TRUE'],['off','FALSE']]}]),
    statement('esp_mode_toggle','toggle mode'),
    statement('esp_wait_counter','wait counter milliseconds'),
    statement('esp_calculate','calculate %1 ÷ %2 → counter (catch error)',[number('A',12,-1000000),number('B',3,-1000000)]),
    {type:'esp_repeat_counter',message0:'repeat counter times',message1:'do %1',args1:[{type:'input_statement',name:'DO'}],previousStatement:null,nextStatement:null,colour:120},
]);
const value = name => block => Number(block.getFieldValue(name));
pythonGenerator.forBlock.esp_if = (block,generator) => `if ${generator.valueToCode(block,'CONDITION',Order.NONE)||'False'}:\n${generator.statementToCode(block,'DO')||'    pass\n'}else:\n${generator.statementToCode(block,'ELSE')||'    pass\n'}`;
pythonGenerator.forBlock.esp_boot_pressed = () => ['boot_pressed()',Order.FUNCTION_CALL];
pythonGenerator.forBlock.esp_boot_edge = () => ['boot_new_press()',Order.FUNCTION_CALL];
pythonGenerator.forBlock.esp_boot_held = block => [`boot_held(${value('SECONDS')(block)})`,Order.FUNCTION_CALL];
pythonGenerator.forBlock.esp_error = () => ['_error',Order.ATOMIC];
pythonGenerator.forBlock.esp_wait_counter = () => 'time.sleep(max(0, _counter) / 1000)\n';
pythonGenerator.forBlock.esp_calculate = block => `_counter, _error = calculate(${value('A')(block)}, ${value('B')(block)})\n`;
pythonGenerator.forBlock.esp_repeat_counter = (block,generator) => `for _ in range(max(0, min(100000, int(_counter)))):\n${generator.statementToCode(block,'DO')||'    pass\n'}`;
pythonGenerator.forBlock.esp_mode = () => ['_mode',Order.ATOMIC];
pythonGenerator.forBlock.esp_counter_test = block => [`_counter ${{GE:'>=',EQ:'==',LT:'<'}[block.getFieldValue('OP')]} ${value('VALUE')(block)}`,Order.RELATIONAL];
pythonGenerator.forBlock.esp_not = (block,generator) => [`not (${generator.valueToCode(block,'INPUT',Order.NONE)||'False'})`,Order.LOGICAL_NOT];
pythonGenerator.forBlock.esp_boolean = block => [block.getFieldValue('VALUE')==='TRUE'?'True':'False',Order.ATOMIC];
pythonGenerator.forBlock.esp_counter_set = block => `_counter = ${value('VALUE')(block)}\n`;
pythonGenerator.forBlock.esp_counter_change = block => `_counter += ${value('VALUE')(block)}\n`;
pythonGenerator.forBlock.esp_counter_print = () => 'print("Counter:", _counter)\n';
pythonGenerator.forBlock.esp_mode_set = block => `_mode = ${block.getFieldValue('VALUE')==='TRUE'?'True':'False'}\n`;
pythonGenerator.forBlock.esp_mode_toggle = () => '_mode = not _mode\n';

export const INPUT_BLOCKS = ['esp_if','esp_boot_pressed','esp_boot_edge','esp_boot_held','esp_not','esp_mode','esp_counter_test','esp_counter_set','esp_counter_change','esp_counter_print','esp_mode_set','esp_mode_toggle','esp_boolean','esp_wait_counter','esp_repeat_counter','esp_calculate','esp_error'];
export function conditionFromBlock(block) {
    if (!block || !block.isEnabled()) return {type:'boolean',value:false};
    switch (block.type) {
        case 'esp_boot_pressed': return {type:'pressed'};
        case 'esp_boot_edge': return {type:'edge'};
        case 'esp_boot_held': return {type:'held',seconds:value('SECONDS')(block)};
        case 'esp_error': return {type:'error'};
        case 'esp_mode': return {type:'mode'};
        case 'esp_counter_test': return {type:'counter',op:block.getFieldValue('OP'),value:value('VALUE')(block)};
        case 'esp_not': return {type:'not',input:conditionFromBlock(block.getInputTargetBlock('INPUT'))};
        case 'esp_boolean': return {type:'boolean',value:block.getFieldValue('VALUE')==='TRUE'};
        default: throw new Error('Unsupported condition block: '+block.type);
    }
}
