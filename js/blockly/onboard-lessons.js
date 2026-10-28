import { DEFAULT_CIRCUIT } from './model.js';

export const ONBOARD_LESSONS = [
    ['onboard-on','LED ON','Keep the onboard LED on continuously.'],
    ['onboard-off','LED OFF','Keep the onboard LED off.'],
    ['onboard','Continuous Blink','Blink for one second on and one second off, continuously.'],
    ['onboard-fast','Fast Blink','Blink with 100 ms on/off intervals.'],
    ['onboard-slow','Slow Blink','Blink with three-second on/off intervals.'],
    ['onboard-triple','Triple Blink','Three short flashes, then a two-second pause.'],
    ['onboard-double','Double Blink','Two quick flashes, then a pause.'],
    ['onboard-sos','SOS Signal','Repeat three short, three long and three short pulses with signal gaps.'],
    ['onboard-finite','Finite Blink','Flash five times, turn off and finish. Change the repeat count to choose another number.'],
    ['onboard-countdown','Countdown Flashes','Show groups of five, four, three, two and one flash, then finish.'],
    ['onboard-short-long','Short and Long Flashes','Alternate a short pulse and a long pulse.'],
    ['onboard-faster','Increasing Blink Speed','Use the counter as a delay: decrease from 1000 ms to 100 ms, then repeat.'],
    ['onboard-slower','Decreasing Blink Speed','Use the counter as a delay: increase from 100 ms to 1000 ms, then repeat.'],
    ['onboard-heartbeat','Heartbeat Pattern','Two brief pulses with a short gap and a long rest.'],
    ['onboard-alternating','Alternating Blink Patterns','Alternate a group of three fast flashes with two slower flashes.'],
    ['onboard-variable','Variable-Based Blinking','Set the counter to four, use it as the number of flashes, then finish.'],
    ['onboard-nested','Nested Loop Blinking','Repeat three groups of four flashes using nested loops.'],
    ['onboard-traffic','Traffic Signal Timing','One-color timing analogy: long ON (stop), rapid flashes (wait), long OFF (go). A single LED does not show three colors.'],
    ['onboard-startup','Startup Indicator','Flash twice at program startup, then keep the LED on. Runs again on reset.'],
    ['onboard-complete','Execution Complete Indicator','Calculate 12 ÷ 3, print the result, then flash a completion pattern and finish.'],
    ['onboard-status','Continuous Status Indicator','Toggle every half-second without a blocking wait to indicate the program is running.'],
    ['onboard-error','Error Pattern','Attempt 10 ÷ 0 and catch the real division-by-zero error; flash three times while error is true. Change divisor to 2 for the success branch.'],
    ['onboard-mode','Mode Indicator','Cycle mode off/on in software: one flash for off, two for on. No button is needed.'],
    ['onboard-activity','Activity Indicator','Calculate and print 12 ÷ 3 repeatedly; pulse the LED after each calculation.'],
    ['onboard-sequence','Timed LED Sequence','Run a finite sequence of short, medium and long LED states, then finish off.'],
];

const block = (type,fields={}) => ({type,fields});
function chain(blocks) { return blocks.reduceRight((next,item)=>({...item,...(next?{next:{block:next}}:{})}),null); }
const led = on => block('esp_led',{LED:'led1',ON:on?'TRUE':'FALSE'});
const wait = seconds => block('esp_wait',{SECONDS:seconds});
const pulse = (on,off=on) => [led(true),wait(on),led(false),wait(off)];
const repeat = (count,body) => ({type:'esp_repeat',fields:{COUNT:count},inputs:{DO:{block:chain(body)}}});
const forever = body => ({type:'esp_forever',inputs:{DO:{block:chain(body)}}});
const repeatCounter = body => ({type:'esp_repeat_counter',inputs:{DO:{block:chain(body)}}});
const counter = value => block('esp_counter_set',{VALUE:value});
const change = value => block('esp_counter_change',{VALUE:value});
const print = () => block('esp_counter_print');
const calculate = (a,b) => block('esp_calculate',{A:a,B:b});
const conditional = (test,yes,no) => ({type:'esp_if',inputs:{CONDITION:{block:test},DO:{block:chain(yes)},ELSE:{block:chain(no)}}});

export function onboardLesson(kind) {
    let program;
    switch(kind) {
        case 'onboard-on': program=[led(true)]; break;
        case 'onboard-off': program=[led(false)]; break;
        case 'onboard': program=[forever(pulse(1))]; break;
        case 'onboard-fast': program=[forever(pulse(.1))]; break;
        case 'onboard-slow': program=[forever(pulse(3))]; break;
        case 'onboard-triple': program=[forever([repeat(3,pulse(.15)),wait(2)])]; break;
        case 'onboard-double': program=[forever([repeat(2,pulse(.1)),wait(1)])]; break;
        case 'onboard-sos': program=[forever([repeat(3,pulse(.2)),wait(.4),repeat(3,pulse(.6,.2)),wait(.4),repeat(3,pulse(.2)),wait(1.2)])]; break;
        case 'onboard-finite': program=[repeat(5,pulse(.2)),led(false)]; break;
        case 'onboard-countdown': program=[counter(5),repeat(5,[repeatCounter(pulse(.15)),wait(1),change(-1)]),led(false)]; break;
        case 'onboard-short-long': program=[forever([...pulse(.15,.3),...pulse(.8,.6)])]; break;
        case 'onboard-faster':
        case 'onboard-slower': {
            const faster=kind==='onboard-faster';
            program=[forever([counter(faster?1000:100),repeat(10,[led(true),block('esp_wait_counter'),led(false),block('esp_wait_counter'),change(faster?-100:100)])])];
            break;
        }
        case 'onboard-heartbeat': program=[forever([...pulse(.08,.12),...pulse(.08,1.2)])]; break;
        case 'onboard-alternating': program=[forever([repeat(3,pulse(.1)),wait(.6),repeat(2,pulse(.5)),wait(1)])]; break;
        case 'onboard-variable': program=[counter(4),repeatCounter(pulse(.2)),led(false)]; break;
        case 'onboard-nested': program=[repeat(3,[repeat(4,pulse(.12)),wait(1)]),led(false)]; break;
        case 'onboard-traffic': program=[forever([led(true),wait(5),repeat(4,pulse(.2)),led(false),wait(5)])]; break;
        case 'onboard-startup': program=[repeat(2,pulse(.15)),led(true)]; break;
        case 'onboard-complete': program=[calculate(12,3),print(),repeat(3,pulse(.2)),led(false)]; break;
        case 'onboard-status': program=[forever([block('esp_led_blink',{LED:'led1',SECONDS:.5})])]; break;
        case 'onboard-error': program=[calculate(10,0),forever([conditional(block('esp_error'),[repeat(3,pulse(.1)),wait(1)],[led(true),wait(1)])])]; break;
        case 'onboard-mode': program=[forever([conditional(block('esp_mode'),[repeat(2,pulse(.15))],[...pulse(.4)]),wait(1),block('esp_mode_toggle')])]; break;
        case 'onboard-activity': program=[forever([calculate(12,3),print(),...pulse(.1,1)])]; break;
        case 'onboard-sequence': program=[...pulse(.2,.5),...pulse(.7,.3),...pulse(1.5,1),led(false)]; break;
        default: throw new Error('Unknown onboard LED lesson.');
    }
    const circuit={...structuredClone(DEFAULT_CIRCUIT),displayEnabled:false,boot:{enabled:false,pin:0},leds:[{id:'led1',type:'onboard',pins:[2],resistors:[220],activeLow:false,color:'#ff4055'}]};
    return {circuit,workspace:{blocks:{languageVersion:0,blocks:[{...chain(program),x:30,y:30}]}}};
}
