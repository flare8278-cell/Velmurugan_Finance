from pathlib import Path
import importlib.util
import io

spec=importlib.util.spec_from_file_location('finance_backup',Path(__file__).resolve().parents[2]/'scripts/backup_database.py')
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
password='SyntheticBackupPassword-2026'
payload=b'PGDMP'+b'financial-records\x00'*5000
out=io.BytesIO();backup.encrypt_stream(io.BytesIO(payload),out,password)
encrypted=out.getvalue()
assert payload not in encrypted
assert backup.decrypt_verified(io.BytesIO(encrypted),password)==payload
for content,pw in [(encrypted,'WrongBackupPassword-2026'),(encrypted[:-20]+bytes([encrypted[-20]^1])+encrypted[-19:],password)]:
    try:backup.decrypt_verified(io.BytesIO(content),pw)
    except Exception:pass
    else:raise AssertionError('Unauthenticated backup accepted')
print('PASS: encrypted backup round-trip; wrong password and modified backup rejected before restore')
