"""Run fixed-input pilots while pausing only our own Node child process.

Duty control is CPU-starvation stress, not Raspberry Pi emulation or cgroups.
The whole Node process, including its timer thread, pauses during off windows.
Elapsed-time deadline checks remain unchanged; the off-window granularity is
recorded. Memory caps limit V8 old generation per isolate, not total device RAM.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ALGORITHMS = ['capacity-compact', 'floor-dense', 'cluster-layer']
PROFILES = [('native', 1.), ('duty25', .25), ('duty10', .1)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='docs/edge-hardware/pilot-v1')
    parser.add_argument('--indices', default='0,24,49,74,99')
    parser.add_argument('--profiles', default='native,duty25,duty10')
    parser.add_argument('--heap-mib', type=int, default=64)
    args = parser.parse_args()
    def cancelled(_signum, _frame):
        raise KeyboardInterrupt('Hardware pilot interrupted')
    signal.signal(signal.SIGTERM, cancelled)
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    period = .05
    records = []
    protocol = {'schema': 'alps-duty-stress/1', 'indices': args.indices, 'algorithms': ALGORITHMS,
                'profiles': [{'id': p, 'nominalRunFraction': f} for p, f in PROFILES if p in args.profiles.split(',')],
                'periodMs': period * 1000, 'heapCapMiBPerIsolate': args.heap_mib,
                'classification': 'Host-process CPU starvation pilot, not target-board performance.',
                'limits': 'No hard RSS/RAM cap, no Pi CPU/cache/thermal/power emulation. Entire Node process pauses; watchdog delivery can be delayed by an off window.',
                'source': 'evaluation-v2 frozen engine, unchanged 9000ms search and 10000ms cycle.'}
    (out / 'protocol.json').write_text(json.dumps(protocol, indent=2) + '\n')
    for profile, fraction in PROFILES:
        if profile not in args.profiles.split(','):
            continue
        for algorithm in ALGORITHMS:
            log = out / f'{profile}-{algorithm}.log'
            command = ['node', f'--max-old-space-size={args.heap_mib}', 'scripts/edge-hardware-benchmark.mjs',
                       '--algorithm', algorithm, '--profile', profile, '--heap-mib', str(args.heap_mib),
                       '--indices', args.indices, '--out', str(out)]
            with log.open('w') as stream:
                child = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
                start = time.monotonic()
                runnable = paused = 0.
                cycles = 0
                try:
                    while child.poll() is None:
                        if fraction == 1:
                            time.sleep(.05)
                            continue
                        tick = time.monotonic()
                        os.kill(child.pid, signal.SIGCONT)
                        time.sleep(period * fraction)
                        if child.poll() is not None:
                            runnable += time.monotonic() - tick
                            break
                        os.kill(child.pid, signal.SIGSTOP)
                        switched = time.monotonic()
                        runnable += switched - tick
                        time.sleep(period * (1 - fraction))
                        paused += time.monotonic() - switched
                        cycles += 1
                finally:
                    if child.poll() is None:
                        os.kill(child.pid, signal.SIGCONT)
                        child.terminate()
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.wait()
                record = {'profile': profile, 'algorithm': algorithm, 'exitCode': child.returncode,
                          'wallSeconds': time.monotonic() - start, 'cycles': cycles,
                          'runnableSeconds': runnable, 'pausedSeconds': paused,
                          'measuredRunnableFraction': runnable / (runnable + paused) if fraction < 1 else 1,
                          'command': command, 'log': log.name}
                records.append(record)
                (out / 'execution.json').write_text(json.dumps(records, indent=2) + '\n')
                print(json.dumps(record), flush=True)
                if child.returncode:
                    print(log.read_text()[-2500:], flush=True)
                    raise SystemExit(child.returncode)


if __name__ == '__main__':
    main()
