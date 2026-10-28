// GPIO levels are debounced for 30 ms. Queries share one edge latch so a held
// button counts once, while long-press queries use a monotonic clock.
export class BootButton {
    constructor(read, now) {
        this.read = read;
        this.now = now;
        this.candidate = false;
        this.stable = false;
        this.changedAt = now();
        this.pressedAt = null;
        this.edge = false;
    }
    update() {
        const time = this.now(), raw = Boolean(this.read());
        if (raw !== this.candidate) { this.candidate = raw; this.changedAt = time; }
        if (raw !== this.stable && time - this.changedAt >= 0.03) {
            this.stable = raw;
            if (raw) { this.pressedAt = time; this.edge = true; }
            else { this.pressedAt = null; this.edge = false; }
        }
        return this.stable;
    }
    newPress() { this.update(); const edge = this.edge; this.edge = false; return edge; }
    held(seconds) { return this.update() && this.now() - this.pressedAt >= seconds; }
}

export const BUTTON_PYTHON = `
_boot_candidate = False
_boot_stable = False
_boot_changed_at = time.monotonic()
_boot_pressed_at = None
_boot_edge = False

def boot_pressed():
    global _boot_candidate, _boot_stable, _boot_changed_at, _boot_pressed_at, _boot_edge
    now = time.monotonic()
    raw = not _boot_pin.value
    if raw != _boot_candidate:
        _boot_candidate = raw
        _boot_changed_at = now
    if raw != _boot_stable and now - _boot_changed_at >= 0.03:
        _boot_stable = raw
        if raw:
            _boot_pressed_at = now
            _boot_edge = True
        else:
            _boot_pressed_at = None
            _boot_edge = False
    return _boot_stable

def boot_new_press():
    global _boot_edge
    boot_pressed()
    edge = _boot_edge
    _boot_edge = False
    return edge

def boot_held(seconds):
    return boot_pressed() and time.monotonic() - _boot_pressed_at >= seconds

`;
