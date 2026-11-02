"""Required workflows must remain present; optional skills receive the same validation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    'check_starter', Path(__file__).resolve().parents[1] / 'scripts/check_starter.py'
)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class SkillValidationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='fleet-skills-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for name in ('fleet-plan', 'fleet-api', 'fleet-ui', 'fleet-data', 'fleet-costing', 'fleet-release'):
            self.write_skill(name)

    def write_skill(self, name, metadata_name=None, description='Synthetic workflow', body='Workflow instructions.'):
        path = self.root / '.agents/skills' / name / 'SKILL.md'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f'---\nname: {metadata_name or name}\ndescription: {description}\n---\n\n{body}\n',
            encoding='utf-8',
        )
        return path

    def test_required_skills_without_extras(self):
        self.assertEqual(checker.check_skills(self.root), [])

    def test_valid_additional_skill_is_allowed(self):
        self.write_skill('find-skills')
        self.assertEqual(checker.check_skills(self.root), [])

    def test_extra_skill_does_not_replace_missing_required_skill(self):
        (self.root / '.agents/skills/fleet-api/SKILL.md').unlink()
        self.write_skill('find-skills')
        self.assertEqual(checker.check_skills(self.root), ['Missing required Fleet skills: fleet-api'])

    def test_invalid_extra_metadata_and_empty_content_are_rejected(self):
        for kwargs in ({'metadata_name': 'wrong-name'}, {'description': '   '}, {'body': '   '}):
            with self.subTest(kwargs=kwargs):
                self.write_skill('find-skills', **kwargs)
                self.assertTrue(any('find-skills' in error for error in checker.check_skills(self.root)))

    def test_required_skill_keeps_metadata_validation(self):
        self.write_skill('fleet-ui', metadata_name='wrong-name')
        self.assertTrue(any('fleet-ui' in error for error in checker.check_skills(self.root)))


if __name__ == '__main__':
    unittest.main()
