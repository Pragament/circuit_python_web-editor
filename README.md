# CircuitPython Code Editor

The CircuitPython Code Editor is a browser app for editing and debugging CircuitPython devices over WiFi, Bluetooth, and USB. Each connectivity option has certain requirements on CircuitPython version and device (microcontroller)..

A live copy of the tool is hosted here: https://code.circuitpython.org

## Environment Setup

1. Copy files from the repo to your web server root.
2. Run `npm install`
3. Run `npm run dev` or `npx vite` to continuously update on file changes
   1. Debug with `npx vite -d`

## Production Build

1. Run `npm run build` or `npx vite build` to generate a static website.
2. Copy and deploy all files and folders in `./dist/` to your webserver.

## Troubleshooting

### `OSError: [Errno 5] Input/output error` on Linux after Save+Run

On Linux, the CIRCUITPY drive is mounted asynchronously by default. After the editor writes `code.py` over USB Mass Storage (the FS Access API), the host kernel can hold the file's data sectors in its page cache for up to ~30 seconds before flushing them to the device. If CircuitPython tries to read `code.py` before that flush completes, it raises `OSError: [Errno 5] Input/output error`.

The editor mitigates this by waiting (with a Blinka spinner) for the device to confirm it can read the full file before sending a soft-reboot. This covers the **Run** and **Reboot** buttons and Ctrl-D pressed in the terminal panel.

The built-in wait gives up after 60 seconds and falls through to the existing save-retry loop. That window comfortably covers the default Linux flush behavior (`vm.dirty_expire_centisecs` = 3000), but it can be exceeded on hosts running laptop-mode tools or other power-saving configs (which push the expire window to 60s+), on slow or contended USB buses, or when writing larger files. If you regularly see the Blinka loader time out, apply one of the workarounds below to short-circuit the wait.

If you want to eliminate the wait entirely (and the underlying race), pick one of the following workarounds on your Linux host:

**Option A — Mount CIRCUITPY synchronously (recommended; eliminates the wait).** With this rule the host commits writes inside `close()`, so the editor's flush-detector poll matches on its first attempt and the Run/Reboot/Ctrl-D actions feel instant. Add a udev rule:

```
# /etc/udev/rules.d/99-circuitpy.rules
ACTION=="add", KERNEL=="sd[a-z]*", ATTRS{idVendor}=="239a", ENV{ID_FS_LABEL}=="CIRCUITPY", ENV{UDISKS_MOUNT_OPTIONS}="sync,flush"
```

Then reload with `sudo udevadm control --reload-rules && sudo udevadm trigger`. The CIRCUITPY drive will be mounted with `sync,flush` on next reconnect, so writes commit immediately at a small write-speed cost.

**Option B — Reduce the kernel's dirty-page expire window** (host-wide; affects all writes, not just CIRCUITPY):

```
sudo sysctl -w vm.dirty_expire_centisecs=100
```

**Option C — Run `sync` in a terminal after saving** (no setup required). Opening a terminal on your Linux host and typing:

```
sync
```

forces the kernel to flush all pending writes immediately. If you run it right after the editor finishes saving, the editor's flush-detector poll matches on its next attempt and the wait completes quickly. Useful as a one-off speed-up when you don't want to install the udev rule.

Note: ChromeOS users cannot apply Options A or B and should rely on the editor's built-in wait.

## License

This project is made available under the MIT License. For more details, see the LICENSE file in the repository.

## Blockly, LEDs and seven-segment lessons

Click **New** and choose **Blockly blocks** or **Python**. New documents can be created without connecting a board. Blockly offers LED on/off, RGB channel controls, GPIO HIGH/LOW, display digit, individual segment on/off, clear, wait, repeat, and forever blocks. The starter project blinks the digit 8. In **Circuit components**, load an onboard GPIO2 blink, two-LED GPIO33/GPIO25 blink, or RGB color-cycle example. Examples replace the current blocks and wiring after confirmation.

Use **Add LED** to add any combination of onboard, single-color breadboard, and three-channel RGB LEDs (up to 16 components). Assign each channel an available GPIO from 0–48, a series resistor, and active-high/common-cathode or active-low/common-anode polarity. Single LEDs also have a display color. The onboard option represents a conventional GPIO-controlled LED with its existing board resistor; addressable NeoPixels are not supported. RGB channels are digital on/off, giving seven color combinations; PWM dimming is not included. Disable the seven-segment display when its pins are not needed. LED dropdowns identify components by their names (for example, `led1` or `rgb1`); GPIO blocks address any channel wired in Circuit components. Conflicting GPIO assignments and missing block targets prevent execution.

Use **Simulate** to run the blocks against the displayed ESP32 / breadboard / seven-segment circuit; **Stop** interrupts loops and waits. This is a digital, block-level simulator, not an ESP32 firmware emulator or analog circuit solver. Each segment, including the decimal point, has its own GPIO and series resistor. The default is a common-cathode display with 220 Ω resistors. GPIOs, resistor values, and common-anode/cathode polarity are editable. Verify GPIO availability against your actual ESP32 board; the defaults target classic ESP32 pin numbering and are not universal across ESP32 variants. The diagram shows segment names, not the physical pinout of a particular display package.

**Download blocks** saves an editable `.blockly.json` project, including wiring. **Open blocks** restores that project in a Blockly document. Existing version-1 seven-segment projects remain supported; new version-2 projects include LED wiring. **View Python** opens the generated code read-only without a warning. **Back to Blockly** returns to the same blocks and wiring. Typing, pasting, deleting, or choosing **Edit Python** shows a warning before enabling edits. Students can still return to Blockly after accepting the warning until they actually change the Python code; the first change permanently converts that document to Python. There is no conversion of edited Python back to Blockly. Start a new Blockly document to load a previously downloaded blocks project.

**Run on ESP32** uses the same connection, save, and run workflow as **Save + Run**. Install CircuitPython on a supported ESP32 board, connect over USB, WiFi, or Bluetooth as supported by the board, and save the generated code as `code.py` to run it. Generated programs use CircuitPython's `digitalio`, resolving `board.IO…` names first with a `microcontroller.pin.GPIO…` fallback. MicroPython is not supported by this integration. Saving to the board writes Python; download the blocks separately to preserve the editable project.

Run `npm test` (Node.js and Python 3) for Blockly serialization, Python generation/execution with GPIO test doubles, wiring validation, and simulator checks, and `npm run build` for the production bundle.


### BOOT input and condition lessons

The example selector includes the five BOOT projects: button-controlled LED, a two-second long-press detector, press-to-start blinking, a press counter, and a two-mode LED (steady/blinking). Additional examples cover toggle-on-press, LED-on-while-released, and blink-while-held. The catalogue contains 25 onboard-LED-only examples, eight BOOT examples and three external-component examples, for 36 examples total.

BOOT defaults to GPIO0, active LOW, using `digitalio.Pull.UP`; the onboard LED defaults to GPIO2. Both pins can be changed for the actual board. Enable BOOT input in Circuit components when building a custom project. Its GPIO cannot also drive an LED or display. BOOT pin assignments vary by ESP32 variant. Release BOOT before resetting the real ESP32: holding GPIO0 LOW at reset can select the ROM download bootloader ([Espressif boot-mode documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32/advanced-topics/boot-mode-selection.html)).

Blocks include if/else, BOOT pressed, BOOT newly pressed, BOOT held for a configurable duration, not, true/false, a counter with set/change/compare/print, and a mode flag with set/toggle/read. There is one shared counter and one shared mode flag per program. Toggle LED and nonblocking blink blocks allow button input to stay responsive while blinking. The counter example turns the LED on at five presses; the two-mode example changes modes on each new press. Long-press detection measures a continuous hold and resets on release.

In the simulator, press and hold **Hold BOOT** with the pointer or Space/Enter, or select **Keep BOOT pressed** for a sustained input. Release it for the next press. The status shows the raw HIGH/LOW input, debounced input, counter, mode, and printed counter output. Debouncing takes 30 ms; a held button generates one new-press event until released. Explicit wait blocks pause input polling, just as in the generated Python, so the button lessons use nonblocking blink and short polling loops. Stop resets the simulated button; restarting the simulation resets counter and mode. Version-3 project files include BOOT wiring, and versions 1 and 2 remain supported.


### Onboard LED only (25 examples)

Choose the **Onboard LED only (25)** group in the example selector. Every example disables BOOT and the seven-segment display and uses just the onboard LED (GPIO2 by default, editable for the actual board).

The group includes LED ON, LED OFF, continuous/fast/slow blinking, triple/double blinks, SOS, finite blink, countdown flashes, short/long pulses, increasing/decreasing speed, heartbeat, alternating patterns, variable-based blinking, nested loops, traffic-timing analogy, startup, completion, continuous status, error, mode, activity and timed-sequence indicators. Continuous Blink retains the existing `onboard` project identifier.

**Wait counter milliseconds** and **repeat counter times** use the shared counter variable. Repeat evaluates the counter once when entering the loop, truncates it to an integer and limits it to 0–100000 iterations. Countdown uses groups of five through one flash. The speed examples change the delay between 100 and 1000 ms. Finite patterns stop with the LED off; Startup Indicator finishes with the LED on. SOS uses three short, three long and three short pulses. Traffic Signal Timing represents phases with timing only: a single LED cannot display red, yellow and green.

The calculation task block divides its numeric operands, stores the result in the counter and catches a real `ZeroDivisionError` in generated Python. **Calculation error occurred** exposes that result as a condition. Error Pattern intentionally calculates `10 / 0` and flashes its error pattern; changing the divisor to `2` clears the error and holds the LED on. Completion and activity examples perform and print a valid calculation before indicating completion/activity; they do not depend on external sensors or a button.

The simulator's program-state panel shows counter, mode, calculation error and printed output for LED-only projects too. Restarting simulation resets all program state. The same blocks generate executable CircuitPython for the existing Save + Run workflow.
