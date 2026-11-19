"""Read-only live pre-verification checks using a temporary real Auth session.
No test-only bypass is built into the application. Tokens are never printed.
"""
from pathlib import Path
import json
import urllib.request
import urllib.error
import argparse

parser=argparse.ArgumentParser()
parser.add_argument('--session-file',required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
config=json.loads((root/'public-config.json').read_text())
session=json.loads(Path(args.session_file).read_text())

def call(path,body,auth=True):
    headers={'apikey':config['supabasePublishableKey'],'Content-Type':'application/json'}
    if auth:headers['Authorization']='Bearer '+session['access_token']
    req=urllib.request.Request(config['supabaseUrl']+path,data=json.dumps(body).encode(),headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)

status,info=call('/rest/v1/rpc/finance_session_info',{})
assert status==200 and info['role']=='owner' and info['verified'] is False,(status,info)
status,result=call('/rest/v1/rpc/finance_create_client',{'p_code':'BLOCKEDTEST','p_name':'Must not be created'})
assert status in (401,403),(status,result)
status,result=call('/rest/v1/rpc/finance_service_context',{'p_user':'00000000-0000-0000-0000-000000000000','p_session':'00000000-0000-0000-0000-000000000000'})
assert status in (401,403,404),(status,result)
status,result=call('/rest/v1/rpc/finance_get_workspace',{},auth=False)
assert status in (401,403),(status,result)
print('PASS: real owner password session remains unverified; financial writes, service-only helpers and anonymous workspace reads are blocked')
