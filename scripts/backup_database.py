"""Encrypted PostgreSQL backup; never writes a plaintext dump to disk.

Set FINANCE_DATABASE_URL privately, then run:
  python scripts/backup_database.py backup --output backups/daily.vmbak
  python scripts/backup_database.py verify --input backups/daily.vmbak

Requires PostgreSQL pg_dump and Python cryptography. Secrets are read from the
environment/hidden prompt, never command-line arguments or this repository.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
import argparse
import base64
import getpass
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile

MAGIC=b'VELMURUGAN-BACKUP-1\n'

def derive(password,salt):
    if len(password)<12:raise ValueError('Use a backup password of at least 12 characters.')
    return Scrypt(salt=salt,length=32,n=32768,r=8,p=1).derive(password.encode())

def encrypt_stream(source,destination,password):
    salt=os.urandom(16);iv=os.urandom(12)
    header=json.dumps({'v':1,'cipher':'AES-256-GCM','kdf':'scrypt','salt':base64.b64encode(salt).decode(),'iv':base64.b64encode(iv).decode()},separators=(',',':')).encode()+b'\n'
    cipher=Cipher(algorithms.AES(derive(password,salt)),modes.GCM(iv)).encryptor()
    cipher.authenticate_additional_data(MAGIC+header)
    destination.write(MAGIC+header)
    while True:
        block=source.read(1024*1024)
        if not block:break
        destination.write(cipher.update(block))
    destination.write(cipher.finalize());destination.write(cipher.tag)

def decrypt_verified(source,password):
    if source.readline()!=MAGIC:raise ValueError('Unsupported backup format.')
    header=source.readline(4097)
    if len(header)>4096:raise ValueError('Invalid backup header.')
    meta=json.loads(header)
    if meta.get('v')!=1 or meta.get('cipher')!='AES-256-GCM' or meta.get('kdf')!='scrypt':raise ValueError('Unsupported encryption parameters.')
    salt=base64.b64decode(meta['salt'],validate=True);iv=base64.b64decode(meta['iv'],validate=True)
    if len(salt)!=16 or len(iv)!=12:raise ValueError('Invalid backup encryption metadata.')
    data=source.read(1024*1024*1024+1)
    if len(data)>1024*1024*1024 or len(data)<16:raise ValueError('Backup is too large or incomplete.')
    cipher=Cipher(algorithms.AES(derive(password,salt)),modes.GCM(iv,data[-16:])).decryptor()
    cipher.authenticate_additional_data(MAGIC+header)
    # Authentication must succeed BEFORE any plaintext is handed to a restore tool.
    plain=cipher.update(data[:-16])+cipher.finalize()
    return plain

def database_environment():
    url=os.environ.get('FINANCE_DATABASE_URL','')
    parsed=urlsplit(url)
    if parsed.scheme not in ('postgres','postgresql') or not parsed.hostname:raise ValueError('Set FINANCE_DATABASE_URL privately first.')
    env=os.environ.copy()
    env.update(PGHOST=parsed.hostname,PGPORT=str(parsed.port or 5432),PGUSER=unquote(parsed.username or ''),PGPASSWORD=unquote(parsed.password or ''),PGDATABASE=parsed.path.lstrip('/'))
    env['PGSSLMODE']='require' if parsed.hostname not in ('localhost','127.0.0.1') else 'prefer'
    return env

def pg_dump_path():
    explicit=os.environ.get('PG_BIN')
    if explicit:return str(Path(explicit)/('pg_dump.exe' if os.name=='nt' else 'pg_dump'))
    found=shutil.which('pg_dump')
    if not found:raise ValueError('Install PostgreSQL tools or set PG_BIN.')
    return found

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['backup','verify'])
    parser.add_argument('--output')
    parser.add_argument('--input')
    args=parser.parse_args()
    password=getpass.getpass('Backup encryption password (hidden): ')
    if args.action=='verify':
        if not args.input:raise ValueError('--input is required.')
        with open(args.input,'rb') as source:plain=decrypt_verified(source,password)
        if not plain.startswith(b'PGDMP'):raise ValueError('Authenticated backup is not a PostgreSQL custom archive.')
        print('PASS: encrypted backup authenticated; PostgreSQL archive readable. A restore test is still required.')
        return
    if not args.output:raise ValueError('--output is required.')
    output=Path(args.output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
    if output.exists():raise ValueError('Backup already exists; use a new filename.')
    pending=output.with_suffix(output.suffix+'.partial')
    try:
        with tempfile.TemporaryFile() as errors:
            process=subprocess.Popen([pg_dump_path(),'--format=custom','--no-owner','--schema=public','--schema=finance_private','--schema=auth'],env=database_environment(),stdout=subprocess.PIPE,stderr=errors)
            try:
                with pending.open('xb') as destination:encrypt_stream(process.stdout,destination,password)
            finally:
                if process.stdout:process.stdout.close()
            if process.wait()!=0:raise ValueError('Database export failed; check private database credentials and connectivity.')
        with pending.open('rb') as source:
            plain=decrypt_verified(source,password)
            if not plain.startswith(b'PGDMP'):raise ValueError('Export did not produce a PostgreSQL archive.')
        pending.replace(output)
        digest=hashlib.sha256(output.read_bytes()).hexdigest()
        output.with_suffix(output.suffix+'.sha256').write_text(digest+'\n',encoding='ascii')
        print('PASS: encrypted database backup written and authenticated. Copy it to your independent backup destination.')
    finally:
        if pending.exists():pending.unlink()

if __name__=='__main__':
    try:main()
    except Exception as error:raise SystemExit(type(error).__name__+': '+str(error))
