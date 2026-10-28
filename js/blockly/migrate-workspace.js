// Upgrade saved projects without keeping obsolete blocks in the toolbox/runtime.
export function migrateWorkspace(workspace) {
    const result = structuredClone(workspace);
    function visit(block) {
        if (!block) return;
        if (block.type === 'esp_if_gpio') {
            const {PIN = 0, HIGH = 'TRUE'} = block.fields ?? {};
            block.type = 'esp_if';
            delete block.fields;
            block.inputs = {...block.inputs, CONDITION:{block:{type:'esp_gpio_level',fields:{PIN,HIGH}}}};
        }
        for (const input of Object.values(block.inputs ?? {})) {visit(input.block);visit(input.shadow);}
        visit(block.next?.block);
    }
    result.blocks?.blocks?.forEach(visit);
    return result;
}
