import * as Blockly from 'blockly';
const number = (name, value, min = 0) => ({type:'field_number',name,value,min,precision: name === 'SECONDS' ? 0.01 : 1});
const statement = (type, message0, args0 = [], colour = 210) => ({type,message0,args0,previousStatement:null,nextStatement:null,colour});
const boolean = (type, message0, args0 = []) => ({type,message0,args0,output:'Boolean',colour:210});
Blockly.defineBlocksWithJsonArray([
    {type:'esp_if',message0:'if %1',args0:[{type:'input_value',name:'CONDITION',check:'Boolean'}],message1:'then %1',args1:[{type:'input_statement',name:'DO'}],message2:'else %1',args2:[{type:'input_statement',name:'ELSE'}],previousStatement:null,nextStatement:null,colour:210},
    boolean('esp_gpio_level','GPIO %1 is %2',[{type:'field_number',name:'PIN',value:0,min:0,max:48,precision:1},{type:'field_dropdown',name:'HIGH',options:[['HIGH','TRUE'],['LOW','FALSE']]}]),
    boolean('esp_boot_pressed','BOOT GPIO %1 is pressed',[{type:'field_number',name:'PIN',value:0,min:0,max:48,precision:1}]),
    boolean('esp_boot_edge','BOOT GPIO %1 was newly pressed',[{type:'field_number',name:'PIN',value:0,min:0,max:48,precision:1}]),
    boolean('esp_boot_held','BOOT GPIO %1 held for %2 seconds',[{type:'field_number',name:'PIN',value:0,min:0,max:48,precision:1},number('SECONDS',2,0.01)]),
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

export const INPUT_BLOCKS = ['esp_if','esp_gpio_level','esp_boot_pressed','esp_boot_edge','esp_boot_held','esp_not','esp_mode','esp_counter_test','esp_counter_set','esp_counter_change','esp_counter_print','esp_mode_set','esp_mode_toggle','esp_boolean','esp_wait_counter','esp_repeat_counter','esp_calculate','esp_error'];
export function conditionFromBlock(block) {
    if (!block || !block.isEnabled()) return {type:'boolean',value:false};
    switch (block.type) {
        case 'esp_gpio_level': return {type:'gpio_level',pin:value('PIN')(block),high:block.getFieldValue('HIGH')==='TRUE'};
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
