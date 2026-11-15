"""Build release images once; reruns reuse immutable commit tags."""

import json
import os
import re
import subprocess


def main():
    config = json.loads(os.environ['AWS_DEPLOYMENT'])
    sha = os.environ['RELEASE_SHA']
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Expected a full commit SHA')
    registry = next(iter(config['repositories'].values())).split('/')[0]
    password = subprocess.check_output(['aws', 'ecr', 'get-login-password', '--region', config['region']])
    subprocess.run(['docker', 'login', '--username', 'AWS', '--password-stdin', registry],
                   input=password, check=True)
    builds = {'backend': ('backend/Dockerfile', 'backend'),
              'frontend': ('frontend/Dockerfile', 'frontend'),
              'tools': ('deploy/aws/Dockerfile.tools', '.'),
              'proxy': ('deploy/aws/Dockerfile.proxy', '.')}
    for service, repository in config['repositories'].items():
        check = subprocess.run(['aws', 'ecr', 'describe-images', '--repository-name',
                               config['project']+'/'+service, '--image-ids', 'imageTag='+sha],
                               capture_output=True)
        if check.returncode == 0:
            print(f'Reusing immutable {service} image')
            continue
        if b'ImageNotFoundException' not in check.stderr:
            raise RuntimeError('Unable to inspect existing ECR images')
        dockerfile, context = builds[service]
        image = repository+':'+sha
        subprocess.run(['docker', 'build', '-f', dockerfile, '-t', image, context], check=True)
        subprocess.run(['docker', 'push', image], check=True)


if __name__ == '__main__':
    main()
