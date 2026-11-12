"""Archive allowlisted application source and both verified frontend builds."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
previous = json.loads((root / sys.argv[1]).read_text(encoding="utf-8-sig"))
destination = (root / sys.argv[2]).resolve()
assert destination.is_relative_to(root / "tools/test-artifacts/frontend-artifacts")
destination.mkdir(parents=True, exist_ok=False)
digest = lambda data: hashlib.sha256(data).hexdigest()

builds = []
for mode, directory in [("on", "dist"), ("off", "dist-motion-off")]:
    source = root / "frontend" / directory
    files = sorted(file for file in source.rglob("*") if file.is_file())
    assert len(files) == 3 and (source / "index.html").is_file()
    archive = destination / f"frontend-{mode}.zip"
    manifest = [{"path": file.relative_to(source).as_posix(), "sha256": digest(file.read_bytes())} for file in files]
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
        for file in files:
            package.write(file, file.relative_to(source))
    restored = destination / f"verified-{mode}"
    restored.mkdir()
    with zipfile.ZipFile(archive) as package:
        assert sorted(package.namelist()) == sorted(item["path"] for item in manifest)
        package.extractall(restored)
    for item in manifest:
        assert digest((restored / item["path"]).read_bytes()) == item["sha256"]
    builds.append({"mode": mode, "archive": archive.name, "sha256": digest(archive.read_bytes()), "extractionVerified": True, "files": manifest})

paths = sorted(set(item["path"] for item in previous["files"]) | {
    "tools/test-spa-zoom.cjs", "tools/analyze-spa-motion.cjs", "tools/archive-test-state.py",
    "frontend/src/sessionCookieLock.ts", "frontend/src/sessionCookieLock.test.ts",
    "tools/test-spa-asset-picker.cjs", "tools/test-real-session-expiry.cjs",
    "tools/test-spa-menu-matrix.cjs", "tools/test-spa-detail-loading.cjs",
    "tools/test-spa-dialog-references.cjs",
    "tools/test-spa-navigation-mutations.cjs",
    "tools/cleanup-isolated-stack.ps1", "tools/testing/database-context.ps1",
    "tools/test-backup-restore.ps1",
    "tools/test-real-expiry-scan.cjs", "tools/testing/expiry-scan-runner.cjs",
    "tools/test-real-worker-recovery.cjs", "tools/testing/worker-recovery-runner.cjs",
    "tools/test-real-policy-version.cjs", "tools/testing/policy-version-runner.cjs",
    "backend/test/policy-validation.spec.ts",
    "backend/test/auth-logout.spec.ts",
    "backend/test/api-exception.spec.ts", "tools/test-real-body-parser.cjs",
    "backend/src/database/migrate.ts", "tools/test-real-runtime-ledger.cjs",
    "tools/testing/runtime-ledger-runner.cjs",
    "backend/test/migration-command.spec.ts", "tools/test-real-runtime-privileges.cjs",
    "tools/testing/runtime-privileges-runner.cjs", "tools/testing/runtime-grants.sql",
    "tools/testing/delayed-navigation.cjs",
    "tools/test-spa-dialog-focus.cjs",
    "tools/test-spa-focus-contrast.cjs",
    "backend/src/health/readiness.service.ts", "tools/test-real-health-readiness.ps1",
    "backend/src/operations/operations.module.ts", "backend/src/operations/operations.controller.ts",
    "backend/src/operations/operations-metrics.service.ts",
    "tools/test-real-operations-metrics.ps1", "tools/testing/operations-metrics-runner.cjs",
    ".env.example", "tools/monitor-operations.cjs", "tools/test-real-operations-monitor.cjs", "tools/testing/monitor-operations.test.cjs",
    "tools/test-real-request-draft-ui.cjs", "tools/test-real-user-administration.cjs",
    "backend/src/notifications/email-template.ts", "backend/test/email-template.spec.ts",
    "tools/test-real-email-delivery.cjs", "tools/testing/email-delivery-runner.cjs",
    "tools/preview-email-templates.cjs", "tools/test-real-email-links.cjs",
    "backend/src/departments/departments.dto.ts", "backend/src/departments/departments.service.ts",
    "backend/src/departments/departments.controller.ts", "backend/src/departments/departments.module.ts",
    "backend/test/departments.spec.ts", "backend/test/request-session-lock.spec.ts",
    "frontend/src/DepartmentManager.tsx", "frontend/src/api/contracts/departments.ts",
    "tools/test-real-departments.cjs",
    "backend/src/auth/account-action-token.ts", "backend/src/auth/account-actions.dto.ts", "backend/src/auth/account-actions.service.ts",
    "backend/test/account-action-token.spec.ts", "frontend/src/AccountActionScreen.tsx",
    "tools/test-real-account-actions.cjs", "tools/testing/account-actions-runner.cjs", "tools/testing/account-actions-mailbox.cjs",
    "tools/testing/compose.account-actions.yml",
})
files = []
archive = destination / "application-source.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
    for relative in paths:
        source = (root / relative).resolve()
        assert source.is_relative_to(root) and source.is_file()
        assert source.name != ".env" and source.name != "test.env"
        data = source.read_bytes()
        files.append({"path": relative, "sha256": digest(data)})
        package.writestr(relative, data)
with zipfile.ZipFile(archive) as package:
    assert len(package.namelist()) == len(files)
    for item in files:
        assert digest(package.read(item["path"])) == item["sha256"]
manifest = {"scope": previous["scope"], "head": previous["head"], "workingTreeDirty": True, "archive": archive.name, "archiveSha256": digest(archive.read_bytes()), "files": files}
(destination / "source-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
(destination / "manifest.json").write_text(json.dumps({"source": "source-manifest.json", "builds": builds}, indent=2), encoding="utf-8")
print(json.dumps({"destination": str(destination), "sourceFiles": len(files), "sourceSha256": manifest["archiveSha256"], "builds": [{"mode": item["mode"], "sha256": item["sha256"]} for item in builds]}, indent=2))
