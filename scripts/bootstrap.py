"""Validate the starter; optionally create .env without overwriting it."""
import argparse
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--create-env', action='store_true')
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        raise SystemExit('Python 3.11+ is required')
    root = Path(__file__).resolve().parents[1]
    subprocess.run([sys.executable, 'scripts/check_starter.py'], cwd=root, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'], cwd=root, check=True)
    if args.create_env:
        try:
            with (root / '.env').open('x', encoding='utf-8', newline='\n') as output:
                output.write((root / '.env.example').read_text(encoding='utf-8'))
            print('Created .env with placeholders; no credentials supplied')
        except FileExistsError:
            print('Existing .env preserved')
    print('Starter ready. Application services are not included or started.')


if __name__ == '__main__':
    main()
