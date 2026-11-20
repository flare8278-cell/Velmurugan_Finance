"""Owner setup and live connection testing without credentials in command arguments.

Only public configuration is read from public-config.json. A short-lived setup
token is kept in ignored .env.local and removed after use. Password input is hidden.
"""
from pathlib import Path
import argparse
import getpass
import hashlib
import json
import secrets
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
config=json.loads((ROOT/'public-config.json').read_text())
envfile=ROOT/'.env.local'

def values():
    return dict(line.split('=',1) for line in envfile.read_text().splitlines() if '=' in line and not line.startswith('#')) if envfile.exists() else {}

def update_env(name,value):
    data=values()
    if value is None:data.pop(name,None)
    else:data[name]=value
    envfile.write_text(''.join(k+'='+v+'\n' for k,v in data.items()),encoding='utf-8')

def request(action,body=None):
    headers={'Content-Type':'application/json','apikey':config['supabasePublishableKey']}
    payload=json.dumps({'action':action,**(body or {})}).encode()
    req=urllib.request.Request(config['supabaseUrl']+'/functions/v1/finance-api',data=payload,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
    except urllib.error.HTTPError as error:
        try:message=json.load(error).get('error','Request failed')
        except Exception:message='Request failed'
        raise RuntimeError(message) from None

parser=argparse.ArgumentParser()
parser.add_argument('action',choices=['prepare','create','login-test'])
parser.add_argument('--session-file')
args=parser.parse_args()
if args.action=='prepare':
    token=secrets.token_urlsafe(48)
    update_env('FINANCE_SETUP_TOKEN',token)
    print('Setup token SHA256:',hashlib.sha256(token.encode()).hexdigest())
    print('Token stored only in ignored .env.local; valid only after the owner activates its hash in the private database config.')
elif args.action=='create':
    token=values().get('FINANCE_SETUP_TOKEN')
    if not token:raise SystemExit('Prepare and activate a setup token first.')
    password=getpass.getpass('Owner application password (hidden): ')
    try:
        request('bootstrap',{'token':token,'password':password})
        print('PASS: owner Auth account and owner profile created. No password was logged or stored in source.')
    finally:
        password=None
        update_env('FINANCE_SETUP_TOKEN',None)
else:
    if not args.session_file:raise SystemExit('--session-file is required for the temporary integration-test session.')
    password=getpass.getpass('Owner application password for verification (hidden): ')
    try:result=request('owner-login',{'email':'imran5426117@gmail.com','password':password})
    finally:password=None
    path=Path(args.session_file).resolve()
    if str(path).lower().startswith(str(ROOT).lower()):raise SystemExit('Store the temporary session outside the repository.')
    path.write_text(json.dumps(result['session']),encoding='utf-8')
    print('PASS: owner password login returned a real Supabase session. Temporary test session saved outside the repository.')
