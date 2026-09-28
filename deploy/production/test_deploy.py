"""Check that deployment never starts without passing CI for the exact commit."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deployment", Path(__file__).with_name("deploy.py"))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)
SHA = "a" * 40

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for name, value in (("ROOT", root), ("REPO", root / "repository"), ("STATE", root / "deployed-sha")):
            patcher = patch.object(deployment, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def runs(self, conclusion="success", sha=SHA):
        return {"workflow_runs": [dict(name=name, head_sha=sha, run_number=1,
            status="completed", conclusion=conclusion) for name in ("CI", "Security")]}

    def test_failed_or_missing_or_wrong_commit_checks_do_not_deploy(self):
        for results in (self.runs("failure"), {"workflow_runs": []}, self.runs(sha="b" * 40)):
            with patch.object(deployment, "api", side_effect=[{"sha": SHA}, results]), patch.object(deployment, "run") as run:
                deployment.main()
                run.assert_not_called()

    def test_already_deployed_does_not_redeploy(self):
        deployment.STATE.write_text(SHA)
        with patch.object(deployment, "api", return_value={"sha": SHA}), patch.object(deployment, "run") as run:
            deployment.main()
            run.assert_not_called()

    def test_failed_build_does_not_replace_running_services(self):
        def execute(*args, **kwargs):
            if "archive" in args:
                (deployment.ROOT / "release.tar").touch()
            if args[-1] == "build":
                raise subprocess.CalledProcessError(1, args)
        with patch.object(deployment, "api", side_effect=[{"sha": SHA}, self.runs()]), patch.object(deployment, "run", side_effect=execute) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                deployment.main()
            self.assertFalse(deployment.STATE.exists())
            self.assertFalse(any("up" in call.args for call in run.call_args_list))

    def test_success_records_exact_commit_after_health_checks(self):
        def execute(*args, **kwargs):
            if "archive" in args:
                (deployment.ROOT / "release.tar").touch()
        with patch.object(deployment, "api", side_effect=[{"sha": SHA}, self.runs()]), patch.object(deployment, "run", side_effect=execute) as run:
            deployment.main()
            self.assertEqual(deployment.STATE.read_text().strip(), SHA)
            self.assertEqual(sum(call.args[0] == "curl" for call in run.call_args_list), 3)

if __name__ == "__main__":
    unittest.main()
