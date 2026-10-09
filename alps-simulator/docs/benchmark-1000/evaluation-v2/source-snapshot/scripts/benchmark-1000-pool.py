#!/usr/bin/env python3
"""Run frozen paired benchmark shards with bounded independent Node supervisors.

This is a shared-machine throughput experiment. Observed times and deadline
outcomes under this load are not isolated single-algorithm latency estimates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import sys
import time


def read_json(path):
    return json.loads(path.read_text())


def atomic(path, obj):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='docs/benchmark-1000/evaluation-v2')
    parser.add_argument('--n', '--orders', dest='n', type=int, default=100)
    parser.add_argument('--concurrency', type=int, default=4)
    parser.add_argument('--batch-size', type=int, default=25)
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--reference', default='docs/benchmark-1000/pilot-v2/progress.json')
    parser.add_argument('--poll-seconds', type=float, default=10)
    args = parser.parse_args()
    if not 1 <= args.n <= 1000 or not 1 <= args.concurrency <= 32 or not 1 <= args.batch_size <= 1000 or args.poll_seconds <= 0:
        parser.error('Invalid sample size, concurrency, batch size, or poll interval')
    root = Path.cwd()
    out = (root / args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    lock = out / '.pool.lock'
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        try:
            owner = int(lock.read_text())
            os.kill(owner, 0)
        except ProcessLookupError:
            lock.unlink()
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except (ValueError, PermissionError):
            raise RuntimeError(f'Cannot confirm pool lock is stale: {lock}')
        else:
            raise RuntimeError(f'Pool already running with PID {owner}')
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    active = {}
    interrupted = False
    failed = []
    started = time.time()
    reference_rows = []
    reference_path = (root / args.reference).resolve()
    if reference_path.exists():
        reference_rows = read_json(reference_path).get('rows', [])

    def stop(signum, frame):
        nonlocal interrupted
        interrupted = True
        for proc, handle in active.values():
            proc.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        common = ['--out', str(out), '--orders', str(args.n), '--concurrency', str(args.concurrency), '--batch-size', str(args.batch_size)]
        if args.pilot:
            common.append('--pilot')
        subprocess.run(['node', str(root / 'scripts/benchmark-1000.mjs'), *common, '--prepare'], cwd=root, check=True)
        freeze = read_json(out / 'freeze.json')
        signature = freeze['signature']
        algorithms = freeze['algorithms']
        conditions = [m['condition']['id'] for m in freeze['manifests']]
        jobs = []
        for start in range(0, args.n, args.batch_size):
            end = min(args.n, start + args.batch_size)
            for condition in conditions:
                jobs.append({'id': f'{condition}-{start:04d}-{end:04d}', 'condition': condition, 'start': start, 'end': end})
        atomic(out / 'pool-plan.json', {'signature': signature, 'execution': freeze['execution'], 'n': args.n, 'jobs': jobs})
        if args.prepare_only:
            return 0
        runner = out / 'source-snapshot/scripts/benchmark-1000.mjs'
        expected = {(m['condition']['id'], order['seed'], algorithm) for m in freeze['manifests'] for order in m['orders'] for algorithm in algorithms}
        total = len(expected)
        verified_complete = set()
        pending = []
        for job in jobs:
            progress_path = out / 'shards' / job['id'] / 'progress.json'
            if progress_path.exists():
                progress = read_json(progress_path)
                if progress['signature'] != signature:
                    raise RuntimeError(f'Shard signature mismatch: {job["id"]}')
                if progress.get('complete'):
                    rows = progress.get('rows', [])
                    identities = {(r['condition'], r['seed'], r['algorithm']) for r in rows}
                    target = {(job['condition'], order['seed'], a) for m in freeze['manifests'] if m['condition']['id'] == job['condition'] for order in m['orders'][job['start']:job['end']] for a in algorithms}
                    if identities != target or len(rows) != len(target):
                        raise RuntimeError(f'Completed shard has incorrect identities: {job["id"]}')
                    for row in rows:
                        path = out / row['trace']
                        if hashlib.sha256(path.read_bytes()).hexdigest() != row['traceSha256']:
                            raise RuntimeError(f'Completed trace hash mismatch: {path}')
                    verified_complete.add(job['id'])
                    continue
            pending.append(job)

        def collect():
            rows, identities, cancelled = [], set(), 0
            for job in jobs:
                path = out / 'shards' / job['id'] / 'progress.json'
                if not path.exists():
                    continue
                progress = read_json(path)
                if progress['signature'] != signature:
                    raise RuntimeError(f'Shard signature mismatch: {job["id"]}')
                cancelled += progress.get('cancelledAttempts', 0)
                for row in progress.get('rows', []):
                    key = (row['condition'], row['seed'], row['algorithm'])
                    if key not in expected or key in identities:
                        raise RuntimeError(f'Unexpected or duplicated trial: {key}')
                    identities.add(key)
                    rows.append(row)
            return rows, cancelled

        def report(final=False):
            rows, cancelled = collect()
            timing = []
            remaining_ms = 0.0
            unknown = []
            for condition in conditions:
                for algorithm in algorithms:
                    samples = [r['wallMs'] for r in rows if r['condition'] == condition and r['algorithm'] == algorithm]
                    reference = [r['wallMs'] for r in reference_rows if r['condition'] == condition and r['algorithm'] == algorithm]
                    estimates = samples or reference
                    count = len(samples)
                    entry = {'condition': condition, 'algorithm': algorithm, 'observed': count, 'remaining': args.n-count,
                             'estimateSource': 'loaded-evaluation' if samples else 'separate-pilot' if reference else 'unknown'}
                    if estimates:
                        entry.update(meanWallMs=statistics.mean(estimates), medianWallMs=statistics.median(estimates))
                        remaining_ms += entry['meanWallMs'] * (args.n-count)
                    elif count < args.n:
                        unknown.append(f'{condition}/{algorithm}')
                    timing.append(entry)
            # Sum expected remaining work across lanes; warmup and scheduling overhead
            # are excluded. This estimate is explicitly approximate under contention.
            eta = None if unknown else remaining_ms / 1000 / args.concurrency
            complete = len(rows) == total and not interrupted and not failed and not pending and not active
            progress = {'signature': signature, 'complete': complete, 'pilot': args.pilot, 'n': args.n, 'total': total,
                        'completed': len(rows), 'cancelledAttempts': cancelled, 'concurrency': args.concurrency,
                        'activeShards': list(active), 'pendingShards': len(pending), 'failedShards': failed,
                        'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(started)),
                        'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                        'sessionSeconds': time.time()-started, 'etaSecondsApproximate': eta, 'etaUnknownGroups': unknown,
                        'timingModel': timing, 'timingCaveat': 'Shared-machine loaded wall times; ETA excludes warmup and scheduling overhead. Separate pilot estimates are provisional until evaluation samples exist.',
                        'interrupted': interrupted, 'rows': rows}
            atomic(out / 'progress.json', progress)
            print(json.dumps({k: progress[k] for k in ('complete','completed','total','sessionSeconds','etaSecondsApproximate','activeShards','pendingShards','failedShards')}) , flush=True)
            return complete

        while pending or active:
            while pending and len(active) < args.concurrency and not interrupted and not failed:
                job = pending.pop(0)
                shard_out = out / 'shards' / job['id']
                shard_out.mkdir(parents=True, exist_ok=True)
                log = (shard_out / 'runner.log').open('a')
                log.write(f'\nPool launch at {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}\n')
                log.flush()
                proc = subprocess.Popen(['node', str(runner), *common, '--condition', job['condition'], '--start', str(job['start']), '--end', str(job['end'])], cwd=root, stdout=log, stderr=subprocess.STDOUT)
                active[job['id']] = (proc, log)
            for job_id, (proc, log) in list(active.items()):
                code = proc.poll()
                if code is not None:
                    log.close()
                    del active[job_id]
                    progress_path = out / 'shards' / job_id / 'progress.json'
                    done = progress_path.exists() and read_json(progress_path).get('complete', False)
                    if code != 0 or not done:
                        failed.append({'shard': job_id, 'exitCode': code, 'complete': done})
            report()
            if (interrupted or failed) and not active:
                break
            if pending or active:
                time.sleep(min(args.poll_seconds, 30))
        complete = report(final=True)
        return 0 if complete else 130 if interrupted else 1
    finally:
        for proc, handle in active.values():
            if proc.poll() is None:
                proc.terminate()
        for proc, handle in active.values():
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            handle.close()
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(f'Benchmark pool error: {exc}', file=sys.stderr)
        sys.exit(1)
