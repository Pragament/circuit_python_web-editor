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
