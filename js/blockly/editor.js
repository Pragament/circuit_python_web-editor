import { migrateWorkspace } from './migrate-workspace.js';
import * as Blockly from 'blockly';
import * as English from 'blockly/msg/en';
import { toolbox, generatePython, programFromWorkspace, configureWorkspace, refreshFlyoutLeds } from './blocks.js';
import { DEFAULT_CIRCUIT, SEGMENTS, simulate, validateCircuit, normalizeCircuit, validateProgram } from './model.js';
import './style.css';
import { makeLed, lessonPreset, LESSONS } from './presets.js';
import { circuitWithBlockPin } from './block-pins.js';
import { renderLeds } from './led-view.js';

Blockly.setLocale(English);

function delay(ms, signal) {
    return new Promise(resolve => {
        if (signal.aborted) return resolve();
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
    });
}
function download(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class BlocksEditor {
    constructor({ onCode, onConvert, onRun, confirmReplace }) {
        this.onCode = onCode;
        this.confirmReplace = confirmReplace;
        this.circuit = normalizeCircuit(structuredClone(DEFAULT_CIRCUIT));
        this.panel = document.getElementById('blocks-panel');
        this.panel.innerHTML = `
            <div class="blocks-toolbar">
                <strong>Blockly · ESP32</strong>
                <button type="button" data-action="simulate">Simulate</button>
                <button type="button" data-action="stop" disabled>Stop</button>
                <button type="button" data-action="run">Run on ESP32</button>
                <button type="button" data-action="download">Download blocks</button>
                <button type="button" data-action="open">Open blocks</button>
                <button type="button" data-action="python">View Python</button>
                <input type="file" accept=".json" hidden aria-label="Open Blockly project">
            </div>
            <div class="blocks-body">
                <div class="blocks-workspace" aria-label="Blockly workspace"></div>
                <aside class="circuit-panel">
                    <h2>Circuit components</h2>
                    <label>Example <select class="lesson-preset">${[
                        ['Minimal GPIO (1)',LESSONS.filter(([id])=>id==='gpio-minimal')],
                        ['Onboard LED only (25)',LESSONS.filter(([id])=>id==='onboard'||id.startsWith('onboard-'))],
                        ['Onboard LED + BOOT (8)',LESSONS.filter(([id])=>id.startsWith('button-'))],
                        ['External components (3)',LESSONS.filter(([id])=>['display','multiple','rgb'].includes(id))],
                    ].map(([group,lessons])=>`<optgroup label="${group}">${lessons.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</optgroup>`).join('')}</select></label>
                    <button type="button" data-action="lesson">Load example</button>
                    <p class="lesson-description">${LESSONS[0][2]}</p>
                    <details class="boot-config"><summary>BOOT input wiring</summary>
                        <label><input type="checkbox" class="boot-enabled"> Enable BOOT input</label>
                        <label>GPIO <input type="number" class="boot-pin" min="0" max="48" value="0" aria-label="BOOT GPIO"></label>
                        <p>Active LOW with pull-up. Verify your board's BOOT pin. Release BOOT before resetting the real ESP32.</p>
                    </details>
                    <div class="boot-controls" hidden>
                        <button type="button" class="boot-momentary" aria-pressed="false">Hold BOOT</button>
                        <label><input type="checkbox" class="boot-latched"> Keep BOOT pressed</label>
                        <div class="boot-level">BOOT released · HIGH</div>
                    </div>
                    <div class="gpio-controls"></div>
                    <div class="gpio-output"></div>
                    <div class="program-state">
                        <div class="runtime-values">Counter: 0 · Mode: off · Error: no</div>
                        <details><summary>Simulator output</summary><pre class="simulation-log" aria-label="Simulator output"></pre></details>
                    </div>
                    <label><input type="checkbox" class="display-enabled" checked> Seven-segment display</label>
                    <p class="resistor-hint">Use one series resistor per external LED channel.</p>
                    <p class="simulation-status" role="status" aria-live="polite">Ready</p>
                    <div class="circuit-picture"></div>
                    <div class="led-components"></div>
                    <div class="component-add"><select aria-label="New LED type"><option value="single">Breadboard single LED</option><option value="rgb">Breadboard RGB LED</option><option value="onboard">Onboard LED</option></select><button type="button" data-action="add-led">Add LED</button></div>
                    <p>GPIO-controlled LEDs only; addressable NeoPixels require a different driver.</p>
                    <div class="display-wiring">
                    <label>Display <select class="display-common"><option value="cathode">Common cathode (GND)</option><option value="anode">Common anode (3.3V)</option></select></label>
                    <table><caption>ESP32 wiring</caption><thead><tr><th>Segment</th><th>GPIO</th><th>Resistor Ω</th></tr></thead><tbody>
                    ${SEGMENTS.map((s, i) => `<tr><th>${s}</th><td><input aria-label="GPIO for ${s}" data-pin="${i}" type="number" min="0" max="48" value="${this.circuit.pins[i]}"></td><td><input aria-label="Resistor for ${s}" data-resistor="${i}" type="number" min="100" max="10000" value="220"></td></tr>`).join('')}
                    </tbody></table></div>
                    <p>Check that these GPIOs are available and safe outputs on your ESP32 variant. Real-board execution requires CircuitPython.</p>
                    <p>Simulation models digital outputs and block timing, with an estimated LED current (3.3 V supply, 2 V LED). It does not emulate ESP32 firmware or analog electronics.</p>
                    <details><summary>Generated Python</summary><pre class="generated-python"></pre></details>
                </aside>
            </div>`;
        this.status = this.panel.querySelector('.simulation-status');
        const bootButton = this.panel.querySelector('.boot-momentary');
        this.bootHeld = false;
        this.readBoot = () => this.bootHeld || this.panel.querySelector('.boot-latched').checked;
        this.updateBootLevel = () => {
            const pressed = this.readBoot();
            bootButton.setAttribute('aria-pressed', String(pressed));
            this.panel.querySelector('.boot-level').textContent = `BOOT ${pressed ? 'pressed · LOW' : 'released · HIGH'}`;
        };
        bootButton.onpointerdown = event => { bootButton.setPointerCapture(event.pointerId); this.bootHeld = true; this.updateBootLevel(); };
        const release = () => { this.bootHeld = false; this.updateBootLevel(); };
        bootButton.onpointerup = release;
        bootButton.onpointercancel = release;
        bootButton.onlostpointercapture = release;
        bootButton.onkeydown = event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); this.bootHeld = true; this.updateBootLevel(); } };
        bootButton.onkeyup = release;
        bootButton.onblur = release;
        this.panel.querySelector('.boot-latched').onchange = this.updateBootLevel;
        this.panel.querySelector('[data-action="simulate"]').onclick = () => this.runSimulation();
        this.panel.querySelector('[data-action="stop"]').onclick = () => this.stop();
        this.panel.querySelector('[data-action="python"]').onclick = () => this.perform(() => { this.assertValidWiring(); validateProgram(programFromWorkspace(this.workspace), this.circuit); onConvert(this.code); });
        this.panel.querySelector('[data-action="run"]').onclick = () => this.perform(() => { this.assertValidWiring(); validateProgram(programFromWorkspace(this.workspace), this.circuit); return onRun(); });
        this.panel.querySelector('[data-action="download"]').onclick = () => {
            try { this.assertValidWiring(); } catch (error) { this.invalid(error); return; }
            download('project.blockly.json', JSON.stringify({ format: 'circuitstudio-blockly', version: 3, circuit: this.circuit, workspace: Blockly.serialization.workspaces.save(this.workspace) }, null, 2), 'application/json');
            this.savedProject = this.projectSnapshot();
        };
        const fileInput = this.panel.querySelector('input[type="file"]');
        this.panel.querySelector('[data-action="open"]').onclick = () => fileInput.click();
        fileInput.onchange = () => this.perform(async () => {
            const file = fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            if (file.size > 1000000) throw new Error('Choose a Blockly project smaller than 1 MB.');
            const project = JSON.parse(await file.text());
            if (project.format !== 'circuitstudio-blockly' || ![1, 2, 3].includes(project.version)) throw new Error('Choose a CircuitStudio Blockly project.');
            validateCircuit(project.circuit);
            // Validate in a temporary workspace before replacing the current project.
            const temporary = new Blockly.Workspace();
            try {
                configureWorkspace(temporary, project.circuit);
                Blockly.serialization.workspaces.load(migrateWorkspace(project.workspace), temporary);
                validateProgram(programFromWorkspace(temporary), project.circuit);
            } finally { temporary.dispose(); }
            if (!await this.confirmReplace()) return;
            this.stop();
            this.circuit = normalizeCircuit(project.circuit);
            configureWorkspace(this.workspace, this.circuit);
            this.loading = true;
            Blockly.serialization.workspaces.load(migrateWorkspace(project.workspace), this.workspace);
            this.loading = false;
            this.syncInputs();
            this.update();
            this.savedProject = this.projectSnapshot();
        });
        this.panel.querySelector('[data-action="lesson"]').onclick = () => this.perform(async () => {
            if (!await this.confirmReplace()) return;
            const kind = this.panel.querySelector('.lesson-preset').value;
            const preset = lessonPreset(kind);
            this.panel.querySelector('.lesson-description').textContent = LESSONS.find(([id])=>id===kind)[2];
            this.stop();
            this.circuit = normalizeCircuit(preset.circuit);
            configureWorkspace(this.workspace, this.circuit);
            this.loading = true;
            try { Blockly.serialization.workspaces.load(preset.workspace, this.workspace); }
            finally { this.loading = false; }
            this.syncInputs();
            this.update();
        });
        this.panel.querySelector('[data-action="add-led"]').onclick = () => this.perform(() => {
            this.assertValidWiring();
            const type = this.panel.querySelector('[aria-label="New LED type"]').value;
            const used = new Set([...(this.circuit.displayEnabled ? this.circuit.pins : []), ...this.circuit.leds.flatMap(led => led.pins), ...(this.circuit.boot.enabled ? [this.circuit.boot.pin] : [])]);
            const preferred = [...new Set([2,4,5,16,17,18,19,21,22,23,25,26,27,32,33,...Array.from({length:49},(_,i)=>i)])].filter(pin => !used.has(pin));
            const count = type === 'rgb' ? 3 : 1;
            if (this.circuit.leds.length >= 16 || preferred.length < count) throw new Error('No more LED channels are available.');
            let number = 1;
            while (this.circuit.leds.some(led => led.id === 'led' + number)) number++;
            this.circuit.leds.push(makeLed('led' + number, type, preferred.slice(0,count)));
            this.syncInputs(); this.update();
        });
        this.panel.addEventListener('click', event => {
            const button = event.target.closest('[data-remove-led]');
            if (!button) return;
            this.stop();
            this.circuit.leds = this.circuit.leds.filter(led => led.id !== button.dataset.removeLed);
            this.syncInputs();
            this.perform(() => this.update());
        });
        const changed = event => {
            if (!event.target.matches('.display-common, .display-enabled, .boot-enabled, .boot-pin, [data-pin], [data-resistor], [data-led-pin], [data-led-resistor], [data-led-polarity], [data-led-color]')) return;
            this.panel.querySelector('.display-wiring').hidden = !this.panel.querySelector('.display-enabled').checked;
            this.stop();
            try {
                this.assertValidWiring();
                this.update();
            } catch (error) { this.invalid(error); }
        };
        this.panel.addEventListener('input', changed);
        this.panel.addEventListener('change', changed);
        this.observer = new ResizeObserver(() => { if (this.workspace && !this.panel.hidden) Blockly.svgResize(this.workspace); });
        this.observer.observe(this.panel);
    }
    invalid(error) {
        this.status.textContent = error.message;
        this.panel.querySelectorAll('[data-action="simulate"], [data-action="run"], [data-action="python"]').forEach(button => button.disabled = true);
    }
    async perform(action) {
        try { await action(); }
        catch (error) { this.invalid(error); console.error(error); }
    }
    projectSnapshot() {
        return JSON.stringify({ circuit: this.circuit, workspace: Blockly.serialization.workspaces.save(this.workspace) });
    }
    get projectDirty() { return this.workspace && this.projectSnapshot() !== this.savedProject; }
    assertRunnable() {
        this.assertValidWiring();
        validateProgram(programFromWorkspace(this.workspace), this.circuit);
    }
    assertValidWiring() {
        const numericValues = selector => [...this.panel.querySelectorAll(selector)].map(input => input.value === '' ? NaN : Number(input.value));
        const candidate = {
            pins: numericValues('[data-pin]'),
            resistors: numericValues('[data-resistor]'),
            common: this.panel.querySelector('.display-common').value,
            displayEnabled: this.panel.querySelector('.display-enabled').checked,
            boot: {enabled:this.panel.querySelector('.boot-enabled').checked,pin:this.panel.querySelector('.boot-pin').value === '' ? NaN : Number(this.panel.querySelector('.boot-pin').value)},
            leds: this.circuit.leds.map(led => ({ ...led,
                pins: numericValues(`[data-led-pin="${led.id}"]`),
                resistors: led.type === 'onboard' ? [220] : numericValues(`[data-led-resistor="${led.id}"]`),
                activeLow: this.panel.querySelector(`[data-led-polarity="${led.id}"]`).value === 'low',
                color: this.panel.querySelector(`[data-led-color="${led.id}"]`)?.value ?? led.color,
            })),
        };
        validateCircuit(candidate);
        this.circuit = candidate;
        this.panel.querySelector('.resistor-hint').hidden = !candidate.displayEnabled && candidate.leds.every(led => led.type === 'onboard');
        this.panel.querySelector('.boot-config > summary').textContent = `BOOT input wiring · GPIO${candidate.boot.pin} · ${candidate.boot.enabled ? 'enabled' : 'disabled'}`;
        this.panel.querySelector('.boot-controls').hidden = !candidate.boot.enabled;
        if (this.workspace) configureWorkspace(this.workspace, candidate);
    }
    syncInputs() {
        this.panel.querySelector('.boot-enabled').checked = this.circuit.boot.enabled;
        this.panel.querySelector('.boot-pin').value = this.circuit.boot.pin;
        this.panel.querySelector('.boot-controls').hidden = !this.circuit.boot.enabled;
        this.panel.querySelector('.display-enabled').checked = this.circuit.displayEnabled;
        this.panel.querySelector('.display-wiring').hidden = !this.circuit.displayEnabled;
        this.renderComponentInputs();
        if (this.workspace) {
            configureWorkspace(this.workspace, this.circuit);
            this.refreshLedToolbox();
        }
        this.panel.querySelector('.display-common').value = this.circuit.common;
        this.panel.querySelectorAll('[data-pin]').forEach(input => input.value = this.circuit.pins[Number(input.dataset.pin)]);
        this.panel.querySelectorAll('[data-resistor]').forEach(input => input.value = this.circuit.resistors[Number(input.dataset.resistor)]);
        this.panel.querySelectorAll('[data-action="run"], [data-action="python"], [data-action="download"]').forEach(button => button.disabled = false);
    }
    refreshLedToolbox() {
        const signature = JSON.stringify(this.circuit.leds.map(led => [led.id, led.type]));
        if (signature === this.toolboxSignature) return;
        this.toolboxSignature = signature;
        this.workspace.updateToolbox(toolbox);
        refreshFlyoutLeds(this.workspace);
    }
    renderComponentInputs() {
        this.panel.querySelector('.led-components').innerHTML = this.circuit.leds.map(led => `
            <fieldset class="led-component"><legend>${led.id} · ${led.type === 'rgb' ? 'RGB LED' : led.type === 'onboard' ? 'Onboard LED' : 'Breadboard LED'}</legend>
                <button type="button" data-remove-led="${led.id}" aria-label="Remove ${led.id}">Remove</button>
                <label>Polarity <select data-led-polarity="${led.id}" aria-label="Polarity for ${led.id}"><option value="high" ${!led.activeLow?'selected':''}>Active HIGH / common cathode</option><option value="low" ${led.activeLow?'selected':''}>Active LOW / common anode</option></select></label>
                ${led.type !== 'rgb' ? `<label>Color <select data-led-color="${led.id}" aria-label="Color for ${led.id}">${['#ff4055','#39d96e','#4285ff','#ffca28','#ffffff',led.color].filter((v,i,a)=>a.indexOf(v)===i).map(color=>`<option value="${color}" ${led.color===color?'selected':''}>${({'#ff4055':'Red','#39d96e':'Green','#4285ff':'Blue','#ffca28':'Yellow','#ffffff':'White'})[color]??color}</option>`).join('')}</select></label>`:''}
                ${led.pins.map((pin,i)=>`<div class="led-channel"><span>${led.type==='rgb'?['R','G','B'][i]:'LED'}</span><label>GPIO <input type="number" min="0" max="48" value="${pin}" data-led-pin="${led.id}" aria-label="GPIO for ${led.id}${led.type==='rgb'?' '+['R','G','B'][i]:''}"></label>${led.type==='onboard'?'<span>Built-in resistor</span>':`<label>Ω <input type="number" min="100" max="10000" value="${led.resistors[i]}" data-led-resistor="${led.id}" aria-label="Resistor for ${led.id}${led.type==='rgb'?' '+['R','G','B'][i]:''}"></label>`}</div>`).join('')}
            </fieldset>`).join('');
    }
    start() {
        this.panel.hidden = false;
        if (!this.workspace) {
            this.workspace = Blockly.inject(this.panel.querySelector('.blocks-workspace'), { toolbox, trashcan: true, scrollbars: true, zoom: { controls: true, wheel: true }, media: `${import.meta.env.BASE_URL}blockly-media/` });
            this.workspace.addChangeListener(event => {
                if (event.type === Blockly.Events.TOOLBOX_ITEM_SELECT) {
                    refreshFlyoutLeds(this.workspace);
                    return;
                }
                // Intermediate typing events precede the committed field edit.
                // Rebuilding wiring here would replace the value being typed.
                if(event.type === Blockly.Events.BLOCK_FIELD_INTERMEDIATE_CHANGE) return;
                if (!event.isUiEvent && !this.loading) this.perform(() => {
                    if(event.type === Blockly.Events.BLOCK_CHANGE && event.element === 'field' && event.name === 'PIN') {
                        try {
                            const next=circuitWithBlockPin(this.workspace,this.circuit,event.blockId,event.newValue);
                            if(next!==this.circuit) { this.circuit=next; this.syncInputs(); }
                        } catch(error) {
                            configureWorkspace(this.workspace,this.circuit);
                            this.update();
                            this.status.textContent=error.message;
                            return;
                        }
                    }
                    this.update();
                });
            });
        }
        this.stop();
        this.loading = true;
        this.circuit = normalizeCircuit(structuredClone(DEFAULT_CIRCUIT));
        this.savedProject = null;
        this.panel.querySelector('.lesson-preset').value = 'display';
        this.panel.querySelector('.lesson-description').textContent = LESSONS[0][2];
        this.syncInputs();
        Blockly.serialization.workspaces.load(lessonPreset('display').workspace, this.workspace);
        this.loading = false;
        this.update();
        requestAnimationFrame(() => Blockly.svgResize(this.workspace));
    }
    hide() { this.stop(); this.panel.hidden = true; }
    resume() {
        this.panel.hidden = false;
        requestAnimationFrame(() => Blockly.svgResize(this.workspace));
    }
    update() {
        this.stop();
        this.assertValidWiring();
        this.code = generatePython(this.workspace, this.circuit);
        this.panel.querySelectorAll('[data-action="run"], [data-action="python"], [data-action="simulate"], [data-action="download"]').forEach(button => button.disabled = false);
        this.panel.querySelector('.generated-python').textContent = this.code;
        const inputPins = new Set();
        const visit = operations => operations.forEach(op => {
            const condition = node => {
                if (node?.type === 'gpio_level') inputPins.add(node.pin);
                if (node?.input) condition(node.input);
            };
            condition(op.condition);
            if (op.body) visit(op.body);
            if (op.otherwise) visit(op.otherwise);
        });
        visit(programFromWorkspace(this.workspace));
        this.panel.querySelector('.gpio-controls').innerHTML = [...inputPins].map(pin => `<label>Input GPIO ${pin} <select data-gpio-input="${pin}" aria-label="Input GPIO ${pin}"><option value="HIGH">HIGH (pull-up)</option><option value="LOW">LOW</option></select></label>`).join('');
        this.render(new Set());
        this.onCode(this.code);
    }
    stop() {
        this.bootHeld = false;
        this.panel.querySelector('.boot-latched').checked = false;
        this.updateBootLevel();
        this.controller?.abort();
        this.controller = null;
        this.panel.querySelector('[data-action="stop"]').disabled = true;
        try {
            this.assertValidWiring();
            this.panel.querySelector('[data-action="simulate"]').disabled = false;
        } catch {
            this.panel.querySelector('[data-action="simulate"]').disabled = true;
        }
        this.status.textContent = 'Stopped';
    }
    async runSimulation() {
        this.stop();
        const controller = new AbortController();
        this.controller = controller;
        this.panel.querySelector('[data-action="stop"]').disabled = false;
        this.panel.querySelector('[data-action="simulate"]').disabled = true;
        this.render(new Set());
        this.status.textContent = 'Running';
        this.panel.querySelector('.simulation-log').textContent = '';
        try {
            this.assertValidWiring();
            await simulate(programFromWorkspace(this.workspace), { signal: controller.signal, render: (lit, leds, values) => this.render(lit, leds, values), wait: delay, circuit: this.circuit, readBoot: this.readBoot, readGpio: pin => this.panel.querySelector(`[data-gpio-input="${pin}"]`)?.value !== 'LOW', log: text => {
                const output = this.panel.querySelector('.simulation-log');
                output.textContent = [...output.textContent.split('\n').filter(Boolean), text].slice(-20).join('\n');
            } });
            if (!controller.signal.aborted) this.status.textContent = 'Finished';
        } catch (error) { this.status.textContent = error.message; }
        finally {
            if (this.controller === controller) {
                this.controller = null;
                this.panel.querySelector('[data-action="stop"]').disabled = true;
                this.panel.querySelector('[data-action="simulate"]').disabled = false;
            }
        }
    }
    render(lit, leds = new Map(), values = {counter:0,mode:false}) {
        this.panel.querySelector('.gpio-output').textContent = [...(values.gpio ?? [])].map(([pin,high])=>`Output GPIO ${pin}: ${high ? 'HIGH' : 'LOW'}`).join(' · ');
        this.panel.querySelector('.runtime-values').textContent = `Counter: ${values.counter} · Mode: ${values.mode ? 'on' : 'off'}${this.circuit.boot.enabled ? ` · Input: ${values.pressed ? 'pressed' : 'released'}` : ''} · Error: ${values.error ? 'yes' : 'no'}`;
        this.panel.querySelector('.circuit-picture').innerHTML = (this.circuit.displayEnabled ? this.displayPicture(lit) : '') + renderLeds(this.circuit, leds);
    }
    displayPicture(lit) {
        const points = { a: '305,35 365,35', b: '370,40 370,85', c: '370,95 370,140', d: '305,145 365,145', e: '300,95 300,140', f: '300,40 300,85', g: '305,90 365,90', dp: '385,145 386,145' };
        return `<svg viewBox="0 0 440 385" role="img" aria-label="ESP32 connected through eight resistors on a breadboard to a seven-segment LED">
            <rect x="8" y="10" width="130" height="175" rx="10" fill="#16464b"/><rect x="32" y="25" width="82" height="50" rx="4" fill="#adb8c1"/><text x="73" y="55" text-anchor="middle" fill="#122">ESP32</text>
            <rect x="275" y="15" width="125" height="150" rx="8" fill="#171f2b"/>
            ${SEGMENTS.map(s => `<polyline points="${points[s]}" stroke="${lit.has(s) ? '#ff4d65' : '#45333b'}" stroke-width="9" stroke-linecap="round"/>`).join('')}
            <rect x="150" y="190" width="275" height="175" rx="10" fill="#f0eee8" stroke="#aaa"/>
            ${Array.from({ length: 8 }, (_, row) => Array.from({ length: 12 }, (_, col) => `<circle cx="${161 + col * 22}" cy="${207 + row * 17}" r="1.5" fill="#bdc3c5"/>`).join('')).join('')}
            <text x="280" y="355" text-anchor="middle" fill="#334">Breadboard · one resistor per segment</text>
            ${SEGMENTS.map((s, i) => {
                const y = 90 + i * 11, by = 207 + i * 17;
                return `<text x="18" y="${y + 4}" fill="white" font-size="10">GPIO ${this.circuit.pins[i]}</text>
                    <path d="M 120 ${y} H ${145 + i * 3} V ${by} H 200" fill="none" stroke="${lit.has(s) ? '#df4761' : '#81929b'}" stroke-width="2"/>
                    <rect x="200" y="${by - 5}" width="36" height="10" rx="3" fill="#dcc396" stroke="#816947"/>
                    <path d="M 236 ${by} H ${330 + i * 10} V 175 H ${285 + i * 12} V 165" fill="none" stroke="${lit.has(s) ? '#df4761' : '#81929b'}" stroke-width="2"/>
                    <text x="244" y="${by + 4}" font-size="10" fill="#223">${s} · ${this.circuit.resistors[i]} Ω · ${lit.has(s) ? (1300 / this.circuit.resistors[i]).toFixed(1) : '0.0'} mA</text>`;
            }).join('')}
            <path d="M 120 180 H 260 V 175 H 395 V 165" fill="none" stroke="#4385d0" stroke-width="3"/>
            <text x="10" y="380" fill="currentColor">Display common → ESP32 ${this.circuit.common === 'cathode' ? 'GND' : '3.3V'}</text>
            </svg>`;
    }
}
