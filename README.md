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

## Blockly and seven-segment lessons

Click **New** and choose **Blockly blocks** or **Python**. New documents can be created without connecting a board. Blockly offers display digit, individual segment on/off, clear, wait, repeat, and forever blocks. The starter project blinks the digit 8.

Use **Simulate** to run the blocks against the displayed ESP32 / breadboard / seven-segment circuit; **Stop** interrupts loops and waits. This is a digital, block-level simulator, not an ESP32 firmware emulator or analog circuit solver. Each segment, including the decimal point, has its own GPIO and series resistor. The default is a common-cathode display with 220 Ω resistors. GPIOs, resistor values, and common-anode/cathode polarity are editable. Verify GPIO availability against your actual ESP32 board; the defaults target classic ESP32 pin numbering and are not universal across ESP32 variants. The diagram shows segment names, not the physical pinout of a particular display package.

**Download blocks** saves an editable `.blockly.json` project, including wiring. **Open blocks** restores that project in a Blockly document. **View Python** opens the generated code read-only without a warning. **Back to Blockly** returns to the same blocks and wiring. Typing, pasting, deleting, or choosing **Edit Python** shows a warning before enabling edits. Students can still return to Blockly after accepting the warning until they actually change the Python code; the first change permanently converts that document to Python. There is no conversion of edited Python back to Blockly. Start a new Blockly document to load a previously downloaded blocks project.

**Run on ESP32** uses the same connection, save, and run workflow as **Save + Run**. Install CircuitPython on a supported ESP32 board, connect over USB, WiFi, or Bluetooth as supported by the board, and save the generated code as `code.py` to run it. Generated programs use CircuitPython's `digitalio` and `microcontroller.pin.GPIO…` APIs. MicroPython is not supported by this integration. Saving to the board writes Python; download the blocks separately to preserve the editable project.

Run `npm test` for Blockly serialization, Python generation, wiring validation, and simulator checks, and `npm run build` for the production bundle.
