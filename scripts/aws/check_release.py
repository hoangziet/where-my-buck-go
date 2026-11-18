"""Reject deployments unless the exact main commit passed all required checks."""

import json
import re
import subprocess
import sys
import time

REQUIRED = {'backend', 'frontend', 'docker-compose', 'aws-infrastructure'}


def ready(checks):
    latest = latest_required_checks(checks)
    return REQUIRED <= latest.keys() and all(c['conclusion'] == 'success' for c in latest.values())


def latest_required_checks(checks):
    latest = {}
    for check in checks:
        if check['name'] in REQUIRED and check['id'] > latest.get(check['name'], {}).get('id', -1):
            latest[check['name']] = check
    return latest


def failed(checks):
    return {name: check['conclusion'] for name, check in latest_required_checks(checks).items()
            if check['conclusion'] not in (None, 'success')}


def main():
    sha = sys.argv[1]
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Expected a full commit SHA')
    base = 'repos/hoangziet/where-my-buck-go'
    for _ in range(120):
        main = json.loads(subprocess.check_output(['gh', 'api', base+'/commits/main']))
        if main['sha'] != sha:
            raise RuntimeError('A newer main commit exists; this release is superseded')
        checks = json.loads(subprocess.check_output(['gh', 'api', f'{base}/commits/{sha}/check-runs?per_page=100']))
        if ready(checks['check_runs']):
            print('All required checks passed on the current main commit')
            return
        failures = failed(checks['check_runs'])
        if failures:
            summary = ', '.join(f'{name}: {conclusion}' for name, conclusion in sorted(failures.items()))
            raise RuntimeError(f'Required checks failed on the current main commit: {summary}')
        time.sleep(5)
    raise RuntimeError('Required checks did not all succeed within ten minutes')


if __name__ == '__main__':
    main()
