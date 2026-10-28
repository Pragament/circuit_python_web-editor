export function renderLeds(circuit, states = new Map()) {
    if (!circuit.leds.length) return '';
    const height = 70 + circuit.leds.length * 125;
    return `<svg viewBox="0 0 440 ${height}" role="img" aria-label="ESP32 onboard and breadboard LED simulation">
        <rect x="8" y="8" width="424" height="45" rx="8" fill="#16464b"/>
        <text x="220" y="36" text-anchor="middle" fill="white" font-size="18">ESP32 · LED outputs</text>
        ${circuit.leds.map((led, index) => {
            const y = 65 + index * 125;
            const on = states.get(led.id) ?? led.pins.map(() => false);
            const color = led.type === 'rgb' ? `rgb(${on.map(value => value ? 255 : 0).join(',')})` : on[0] ? led.color : '#334155';
            const anyOn = on.some(Boolean);
            return `<rect x="10" y="${y}" width="420" height="115" rx="8" fill="${led.type === 'onboard' ? '#e2efeb' : '#f0eee8'}" stroke="#a8b2be"/>
                <text x="20" y="${y+18}" font-size="13" fill="#243044">${led.id} · ${led.type === 'onboard' ? 'Onboard LED' : led.type === 'rgb' ? 'Breadboard RGB LED' : 'Breadboard LED'} · ${anyOn ? 'ON' : 'OFF'}</text>
                <circle cx="385" cy="${y+52}" r="${anyOn ? 22 : 18}" fill="${color}" stroke="${anyOn ? '#f5c86b' : '#9ca3af'}" stroke-width="3"/>
                ${led.pins.map((pin, channel) => {
                    const py = y + 37 + channel * 21;
                    const label = led.type === 'rgb' ? ['R','G','B'][channel] : 'LED';
                    return `<text x="20" y="${py+4}" font-size="11" fill="#243044">GPIO ${pin} ${on[channel] !== led.activeLow ? 'HIGH' : 'LOW'}</text>
                        <path d="M 112 ${py} H 345 L 365 ${y+52}" stroke="${on[channel] ? '#e04c6a' : '#8797a6'}" stroke-width="2" fill="none"/>
                        <rect x="140" y="${py-6}" width="35" height="12" rx="3" fill="#dcc396" stroke="#816947"/>
                        <text x="182" y="${py-4}" font-size="10" fill="#243044">${label} · ${led.type === 'onboard' ? 'built-in resistor' : led.resistors[channel] + ' Ω'}</text>`;
                }).join('')}
                <text x="20" y="${y+106}" fill="#243044" font-size="11">${led.activeLow ? 'Common/anode → 3.3V · active LOW' : 'Cathode/common → GND · active HIGH'}</text>`;
        }).join('')}
    </svg>`;
}
