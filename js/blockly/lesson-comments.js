// Keep the explanation beside its block so it survives downloads and edits.
const explanations = {
    esp_forever: 'Repeat the enclosed steps continuously. Stop the program to end this loop.',
    esp_repeat: 'Repeat the enclosed steps the selected number of times, then continue after the loop.',
    esp_repeat_counter: 'Use the current counter as the number of repetitions. Each repetition runs all enclosed steps.',
    esp_led: 'Set the selected LED on or off. It keeps this state until another step changes it.',
    esp_led_toggle: 'Reverse the selected LED state: on becomes off, and off becomes on.',
    esp_led_blink: 'Toggle the LED when its interval has elapsed. Other steps can keep running between toggles.',
    esp_rgb: 'Set the red, green and blue channels independently to combine their light into a color.',
    esp_gpio: 'Write the chosen HIGH or LOW electrical level to the selected output GPIO. The output keeps its level until changed.',
    esp_gpio_level: 'True when the selected input GPIO matches HIGH or LOW. Use this condition with if or not. The input uses a pull-up, so an open input reads HIGH.',
    esp_if: 'Test the condition each time this step runs. Run the then branch if true, otherwise run the else branch if present.',
    esp_boot_pressed: 'True while BOOT is pressed. The input is active LOW; debounce ignores brief contact noise.',
    esp_boot_edge: 'True once for each new debounced BOOT press. Holding the button does not repeatedly trigger this condition.',
    esp_boot_held: 'True after BOOT has stayed pressed for the selected duration. Releasing it resets the hold timer.',
    esp_not: 'Reverse the condition: true becomes false and false becomes true.',
    esp_boolean: 'A fixed true or false condition.',
    esp_mode: 'Test the saved mode. Mode starts off unless the program sets it before this test.',
    esp_error: 'Test whether the calculation encountered division by zero. Choose an error pattern or a success pattern accordingly.',
    esp_counter_test: 'Compare the current counter with the selected threshold.',
    esp_counter_set: 'Store a starting value in the counter for later loops, comparisons or delays.',
    esp_counter_change: 'Add the selected amount to the counter. A negative amount decreases it.',
    esp_counter_print: 'Print the counter to the serial console so you can observe the result.',
    esp_mode_set: 'Save the selected mode for later conditions. The mode stays set until changed.',
    esp_mode_toggle: 'Switch the saved mode between off and on.',
    esp_wait: 'Pause for the selected number of seconds, keeping all output states unchanged.',
    esp_wait_counter: 'Use the counter as a delay in milliseconds. Changing the counter changes the blink speed.',
    esp_calculate: 'Divide the two numbers and store the result in the counter. Catch division by zero, set the counter to zero, and record an error for error conditions.',
    esp_digit: 'Set the seven-segment pattern for the selected digit.',
    esp_segment: 'Change only the selected display segment; keep the other segments unchanged.',
    esp_clear: 'Turn off every segment, including the decimal point.',
};

export function explainLesson(preset, title, algorithm) {
    function visit(block, first = false) {
        if (!block) return;
        const text = [first ? `${title} — example algorithm (initial settings): ${algorithm}` : '', explanations[block.type]].filter(Boolean).join('\n\n');
        if (text) block.icons = {...block.icons, comment:{text:[block.icons?.comment?.text,text].filter(Boolean).join('\n\n'),pinned:false,width:320,height:160}};
        for (const input of Object.values(block.inputs ?? {})) { visit(input.block); visit(input.shadow); }
        visit(block.next?.block);
    }
    // Explain groups that carry meaning beyond their individual instructions.
    if (title === 'SOS Signal') {
        let part = preset.workspace.blocks.blocks[0].inputs.DO.block;
        for (const text of ['S: three short pulses.', 'O: three long pulses.', 'S: three short pulses again.']) {
            part.icons = {...part.icons, comment:{text,pinned:false,width:320,height:120}};
            part = part.next?.block?.next?.block;
        }
    }
    preset.workspace.blocks.blocks.forEach(block=>visit(block,true));
    return preset;
}
