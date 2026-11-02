"""Structural checks; --integrity additionally verifies original delivery bytes."""
import argparse
import hashlib
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
SKILLS = {'fleet-plan', 'fleet-api', 'fleet-ui', 'fleet-data', 'fleet-costing', 'fleet-release'}


def check_skills(root):
    errors = []
    paths = list((root / '.agents/skills').glob('*/SKILL.md'))
    missing = SKILLS - {p.parent.name for p in paths}
    if missing:
        errors.append(f'Missing required Fleet skills: {", ".join(sorted(missing))}')
    for path in paths:
        content = path.read_text(encoding='utf-8')
        match = re.match(r'^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n', content)
        if not match or match[1] != path.parent.name or not match[2].strip() or not content[match.end():].strip():
            errors.append(f'Invalid starter skill metadata/body: {path.relative_to(root)}')
    return errors


def check(integrity=False):
    errors = []
    required = [
        'AGENTS.md', 'README.md', '.env.example', '.gitignore', '.gitattributes',
        '.codex/config.toml', '.github/workflows/starter-checks.yml',
        'docs/ARCHITECTURE.md', 'docs/COST_CALCULATION.md', 'docs/OPERATING_COSTS.md',
        'docs/LOCAL_SETUP.md', 'docs/GITHUB_SETUP.md', 'docs/HYBRID_CODEX.md',
        'docs/ASSUMPTIONS.md', 'docs/PROJECT_STRUCTURE.md', 'docs/ACCEPTANCE.md',
        'docs/SOURCES.md', 'examples/trip-cost.json', 'templates/TASK.md',
        'templates/HANDOFF.md', 'scripts/calculate_trip.py', 'scripts/bootstrap.py',
        'tests/test_calculate_trip.py', '.github/pull_request_template.md',
    ]
    for name in required:
        if not (ROOT / name).is_file() or not (ROOT / name).stat().st_size:
            errors.append(f'Missing or empty: {name}')
    errors.extend(check_skills(ROOT))
    try:
        config = tomllib.loads((ROOT / '.codex/config.toml').read_text(encoding='utf-8'))
        if config.get('sandbox_mode') != 'workspace-write' or config.get('approval_policy') != 'on-request':
            errors.append('Unexpected starter permission defaults; review intended change')
        if config.get('sandbox_workspace_write', {}).get('network_access') is not False:
            errors.append('Unexpected starter network default; review intended change')
    except (OSError, ValueError) as exc:
        errors.append(f'Invalid TOML: {exc}')
    for path in ROOT.rglob('*.md'):
        if any(part in {'.git', 'node_modules', 'work', '__pycache__'} for part in path.relative_to(ROOT).parts):
            continue
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
            if '://' in target or target.startswith('#') or target.startswith('mailto:'):
                continue
            target = target.split('#', 1)[0]
            if target and not (path.parent / target).exists():
                errors.append(f'Broken Markdown link in {path.relative_to(ROOT)}: {target}')
    if integrity:
        manifest = ROOT / 'MANIFEST.sha256'
        if not manifest.exists():
            errors.append('MANIFEST.sha256 is missing')
        else:
            seen = set()
            for line in manifest.read_text(encoding='utf-8').splitlines():
                match = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
                if not match:
                    errors.append('Malformed manifest line')
                    continue
                expected, name = match.groups()
                path = (ROOT / name).resolve()
                if not path.is_relative_to(ROOT.resolve()) or name in seen:
                    errors.append(f'Unsafe or duplicate manifest entry: {name}')
                    continue
                seen.add(name)
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                    errors.append(f'Integrity mismatch: {name}')
    if errors:
        for error in errors:
            print(f'FAIL: {error}', file=sys.stderr)
        return 1
    print('PASS: starter structure, required Fleet skills, all skill metadata, TOML and local Markdown links')
    if integrity:
        print('PASS: all listed original file hashes')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--integrity', action='store_true')
    raise SystemExit(check(parser.parse_args().integrity))
