#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REMOTE = (ROOT / "motion-studio" / "remote-gpu.js").read_text(encoding="utf-8")


def test_remote_approval_is_bound_to_exact_job_and_inputs():
    assert "function remoteApprovalKey(job,source,reference,audioTracks=[])" in REMOTE
    assert "function approvalMatches(job,source,reference,audioTracks=[])" in REMOTE
    assert "approvalKey:userApprovedRemote?approvalKey:''" in REMOTE
    assert "version:5" in REMOTE


def test_old_cross_job_approval_inheritance_is_removed():
    assert "approvedRemote||previous?.userApprovedRemote" not in REMOTE
    assert "Boolean(meta.userApprovedRemote)" not in REMOTE


def test_auto_send_rechecks_approval_after_changes():
    assert "if(approved){" in REMOTE
    assert "if(!approvalMatches(job,source,reference,audioTracks))" in REMOTE
    assert "confirmRemoteCompute('Изменённая задача Remote GPU')" in REMOTE


def test_input_changes_do_not_blindly_reuse_approval():
    assert "currentCharacterRef,currentAudioFile,false" in REMOTE
    assert "currentSourceFile.name,currentCharacterRef,currentAudioFile,false" in REMOTE
    assert "currentCharacterRef,currentAudioFiles,false" in REMOTE
