import { DIGITS, SEGMENTS, normalizeCircuit, validateProgram } from './model.js';

// Compile the same operations the simulator runs. Collect dependencies before
// emitting imports, pin allocations, state and helpers so previews stay focused.
export function pythonForProgram(program, value) {
    const circuit = normalizeCircuit(value);
    validateProgram(program, circuit);
    const blinkTargets = new Set(), inputPins = new Set();
    const features = new Set(), ledIds = new Set(), gpioPins = new Set(), segments = new Set();
    function expression(node) {
        if (!node) return;
        features.add(node.type);
        if (node.type === 'gpio_level') inputPins.add(node.pin);
        if (node.input) expression(node.input);
    }
    function visit(operations) {
        for (const op of operations) {
            features.add(op.type);
            if (op.id) ledIds.add(op.id);
            if (op.type === 'blink') blinkTargets.add(op.id);
            if (op.type === 'gpio') gpioPins.add(op.pin);
            if (op.type === 'segment') segments.add(op.segment);
            if (op.type === 'digit' || op.type === 'clear') SEGMENTS.forEach(name => segments.add(name));
            expression(op.condition);
            if (op.body) visit(op.body);
            if (op.otherwise) visit(op.otherwise);
        }
    }
    visit(program);
    const needsBoot = ['pressed','edge','held'].some(type => features.has(type));
    const compactGpio = inputPins.size > 0 && [...features].every(type => ['forever','if','gpio_level','gpio'].includes(type));
    const needsTime = needsBoot || ['wait','wait_counter','blink'].some(type => features.has(type)) || (features.has('forever') && !compactGpio);
    const needsCounter = ['counter','counter_set','counter_change','calculate','wait_counter','repeat_counter','print_counter'].some(type => features.has(type));
    const needsMode = ['mode','mode_set','mode_toggle'].some(type => features.has(type));
    const needsError = features.has('error');
    const pinNames = new Map(), ledNames = new Map();
    const allocations = [];
    const reserved = new Set(['time','board','digitalio','microcontroller','show_digit','boot_pressed','boot_new_press','boot_held',...Array.from(blinkTargets,id=>'blink_'+id)]);
    function allocate(pin, name, inactive, input = false) {
        if (pinNames.has(pin)) return pinNames.get(pin);
        if (reserved.has(name) || [...pinNames.values()].includes(name)) name = '_output_gpio'+pin;
        pinNames.set(pin,name);
        allocations.push({pin,name,inactive,input});
        return name;
    }
    const active = circuit.common === 'cathode';
    for (const name of segments) allocate(circuit.pins[SEGMENTS.indexOf(name)],`_segment_${name}`,!active);
    for (const led of circuit.leds.filter(led => ledIds.has(led.id))) {
        ledNames.set(led.id,led.pins.map((pin,index)=>allocate(pin,led.type === 'rgb' ? `${led.id}_${['red','green','blue'][index]}` : led.id,led.activeLow)));
    }
    for (const pin of gpioPins) {
        const led=circuit.leds.find(led=>led.pins.includes(pin));
        allocate(pin,`_gpio_${pin}`,led ? led.activeLow : circuit.displayEnabled && circuit.pins.includes(pin) && circuit.common === 'anode');
    }
    for (const pin of inputPins) allocate(pin,`_input_${pin}`,false,true);
    if (needsBoot) allocate(circuit.boot.pin,'_boot_button',false,true);
    const bool = value => value ? 'True' : 'False';
    const sections = [];
    const imports = [needsTime ? 'import time' : '', allocations.length ? (compactGpio ? 'import digitalio\nfrom microcontroller import pin' : 'import board\nimport digitalio') : ''].filter(Boolean).join('\n');
    if (imports) sections.push(imports);
    if (!compactGpio && allocations.length > 1) sections.push(`# Resolve GPIO numbers across board pin naming conventions.
def _resolve_pin(number):
    try:
        return getattr(board, "IO" + str(number))
    except AttributeError:
        import microcontroller
        return getattr(microcontroller.pin, "GPIO" + str(number))`);
    for (const output of allocations) {
        let setup = compactGpio ? `${output.name} = digitalio.DigitalInOut(pin.GPIO${output.pin})` : allocations.length > 1
            ? `${output.name} = digitalio.DigitalInOut(_resolve_pin(${output.pin}))`
            : `try:
    ${output.name} = digitalio.DigitalInOut(board.IO${output.pin})
except AttributeError:
    import microcontroller
    ${output.name} = digitalio.DigitalInOut(microcontroller.pin.GPIO${output.pin})`;
        setup += output.input ? `\n${output.name}.switch_to_input(pull=digitalio.Pull.UP)` : `\n${output.name}.switch_to_output(value=${bool(output.inactive)})`;
        if (program.some(op=>op.comment)) setup = `# GPIO ${output.pin}: ${output.input ? 'input with pull-up; an open input reads HIGH' : 'output; start at '+(output.inactive ? 'HIGH' : 'LOW')}.\n` + setup;
        sections.push(setup);
    }
    const state = [];
    let first = program[0];
    while(first?.type === 'forever') first=first.body[0];
    if (needsCounter && !['counter_set','calculate'].includes(first?.type)) state.push('_counter = 0');
    if (needsMode && first?.type !== 'mode_set') state.push('_mode = False');
    if (needsError && first?.type !== 'calculate') state.push('_error = False');
    if (state.length) sections.push(state.join('\n'));
    if (needsBoot) sections.push('# BOOT is active LOW. Accept state changes only after 30 ms of stable input.\n'+bootHelpers(features));
    if (features.has('digit')) sections.push(`# Map each digit to its illuminated segments.
def show_digit(digit):
    patterns = ${JSON.stringify(DIGITS)}
    pattern = patterns[int(digit) % 10]
    for name, pin in ${'{'}${SEGMENTS.map(name=>`"${name}": ${pinNames.get(circuit.pins[SEGMENTS.indexOf(name)])}`).join(', ')}${'}'}.items():
        pin.value = ${active ? 'name in pattern' : 'name not in pattern'}`);
    function setLed(id, on) {
        const led=circuit.leds.find(led=>led.id===id);
        return ledNames.get(id).map(name=>`${name}.value = ${bool(on !== led.activeLow)}`);
    }
    function toggle(id) {
        const names=ledNames.get(id);
        return names.length === 1 ? [`${names[0]}.value = not ${names[0]}.value`] : [`_next = not ${names[0]}.value`,...names.map(name=>`${name}.value = _next`)];
    }
    const blinkIds = new Set();
    function collectBlink(operations) {
        for (const op of operations) {
            if (op.type === 'blink') blinkIds.add(op.id);
            if (op.body) collectBlink(op.body);
            if (op.otherwise) collectBlink(op.otherwise);
        }
    }
    collectBlink(program);
    for (const id of blinkIds) sections.push(`# Check elapsed time instead of pausing, so input checks can continue.
_last_blink_${id} = None
def blink_${id}(seconds):
    global _last_blink_${id}
    now = time.monotonic()
    if _last_blink_${id} is None or now - _last_blink_${id} >= seconds:
${toggle(id).map(line=>'        '+line).join('\n')}
        _last_blink_${id} = now`);
    function condition(node) {
        switch(node.type) {
            case 'gpio_level': return `${node.high ? '' : 'not '}${pinNames.get(node.pin)}.value`;
            case 'boolean': return bool(node.value);
            case 'pressed': return 'boot_pressed()';
            case 'edge': return 'boot_new_press()';
            case 'held': return `boot_held(${node.seconds})`;
            case 'mode': return '_mode';
            case 'error': return '_error';
            case 'counter': return `_counter ${{GE:'>=',EQ:'==',LT:'<'}[node.op]} ${node.value}`;
            case 'not': return `not (${condition(node.input)})`;
            default: throw new Error('Unsupported Python condition.');
        }
    }
    function statements(operations, indent = '') {
        const lines=[];
        const add = line => lines.push(indent+line);
        const body = operations => statements(operations,indent+'    ') || indent+'    pass';
        for(const op of operations) {
            if (op.comment) for (const line of op.comment.split(/\r?\n/)) add('#' + (line ? ' ' + line : ''));
            switch(op.type) {
                case 'led': setLed(op.id,op.on).forEach(add); break;
                case 'rgb': {
                    const led=circuit.leds.find(led=>led.id===op.id);
                    ledNames.get(op.id).forEach((name,i)=>add(`${name}.value = ${bool(op.values[i] !== led.activeLow)}`));
                    break;
                }
                case 'toggle': toggle(op.id).forEach(add); break;
                case 'blink': add(`blink_${op.id}(${op.seconds})`); break;
                case 'gpio': add(`${pinNames.get(op.pin)}.value = ${bool(op.high)}`); break;
                case 'segment': add(`${pinNames.get(circuit.pins[SEGMENTS.indexOf(op.segment)])}.value = ${bool(op.on === active)}`); break;
                case 'digit': add(`show_digit(${op.value})`); break;
                case 'clear': for(const name of SEGMENTS) add(`${pinNames.get(circuit.pins[SEGMENTS.indexOf(name)])}.value = ${bool(!active)}`); break;
                case 'wait': add(`time.sleep(${op.seconds})`); break;
                case 'wait_counter': add('time.sleep(max(0, _counter) / 1000)'); break;
                case 'counter_set': add(`_counter = ${op.value}`); break;
                case 'counter_change': add(`_counter += ${op.value}`); break;
                case 'print_counter': add('print("Counter:", _counter)'); break;
                case 'mode_set': add(`_mode = ${bool(op.value)}`); break;
                case 'mode_toggle': add('_mode = not _mode'); break;
                case 'calculate':
                    if(op.b !== 0) {
                        add(`_counter = ${op.a} / ${op.b}`);
                        if(needsError) add('_error = False');
                    } else {
                        add('try:'); add(`    _counter = ${op.a} / ${op.b}`);
                        if(needsError) add('    _error = False');
                        add('except ZeroDivisionError:'); add('    _counter = 0');
                        if(needsError) add('    _error = True');
                    }
                    break;
                case 'if': add(`if ${condition(op.condition)}:`); lines.push(body(op.body));
                    if(op.otherwise.length) {add('else:');lines.push(body(op.otherwise));} break;
                case 'repeat': add(`for _ in range(${op.count}):`);lines.push(body(op.body));break;
                case 'repeat_counter': add('for _ in range(max(0, min(100000, int(_counter)))):');lines.push(body(op.body));break;
                case 'forever': add('while True:');lines.push(body(op.body));if(!compactGpio && !op.body.some(item=>item.type==='wait'&&item.seconds>0)) { add('    # Briefly yield between polling cycles.'); add('    time.sleep(0.01)'); }break;
                default: throw new Error('Unsupported Python operation: '+op.type);
            }
        }
        return lines.join('\n');
    }
    const code=statements(program);
    if(code) sections.push(code);
    return sections.join('\n\n')+'\n';
}

function bootHelpers(features) {
    const edge=features.has('edge'), held=features.has('held');
    const globals=['_boot_candidate','_boot_stable','_boot_changed_at',...(edge?['_boot_edge']:[]),...(held?['_boot_pressed_at']:[])];
    let code=`_boot_candidate = False
_boot_stable = False
_boot_changed_at = time.monotonic()
${edge?'_boot_edge = False\n':''}${held?'_boot_pressed_at = None\n':''}
def boot_pressed():
    global ${globals.join(', ')}
    now = time.monotonic()
    raw = not _boot_button.value
    if raw != _boot_candidate:
        _boot_candidate = raw
        _boot_changed_at = now
    if raw != _boot_stable and now - _boot_changed_at >= 0.03:
        _boot_stable = raw
${edge?'        _boot_edge = raw\n':''}${held?'        _boot_pressed_at = now if raw else None\n':''}    return _boot_stable`;
    if(edge) code+=`

def boot_new_press():
    global _boot_edge
    boot_pressed()
    edge = _boot_edge
    _boot_edge = False
    return edge`;
    if(held) code+=`

def boot_held(seconds):
    return boot_pressed() and time.monotonic() - _boot_pressed_at >= seconds`;
    return code;
}
