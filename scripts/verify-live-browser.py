"""Real browser → Edge Function/RPC → Supabase persistence tests.

Needs a temporary, explicitly authorised owner session outside the repository.
All created records are named TEST-* and must be removed after verification.
No mock backend responses are used. Credentials/tokens are never printed.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse
import datetime
import json
import secrets

parser=argparse.ArgumentParser()
parser.add_argument('--session-file',required=True)
parser.add_argument('--url',default='http://127.0.0.1:4173/')
parser.add_argument('--evidence-dir',required=True)
parser.add_argument('--fixture-file',required=True)
args=parser.parse_args()
session=json.loads(Path(args.session_file).read_text())
code='TEST-'+secrets.token_hex(4).upper()
client_name='Integration Test '+code
wallet_password='WalletTest-'+secrets.token_urlsafe(24)
client_password='ClientTest-'+secrets.token_urlsafe(24)
evidence=Path(args.evidence_dir)
evidence.mkdir(parents=True,exist_ok=True)
Path(args.fixture_file).write_text(json.dumps({'wallet_test_password':wallet_password,'client_test_password':client_password,'customer_code':code}),encoding='utf-8')

def say(message):print(message,flush=True)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
    owner_context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    page=owner_context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    # Set storage only once, allowing subsequent logout/reload behaviour to be genuine.
    page.goto(args.url,wait_until='domcontentloaded')
    page.evaluate('(session)=>sessionStorage.setItem("velmurugan-auth",JSON.stringify(session))',session)
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('heading',name='Good to see you.').wait_for(timeout=30000)
    say('PASS: authorised owner workspace loads from Supabase')

    page.get_by_role('button',name='Clients',exact=True).click()
    page.get_by_role('button',name='Add client',exact=False).click()
    page.get_by_label('Full name',exact=True).fill(client_name)
    page.get_by_label('Customer ID',exact=True).fill(code)
    page.get_by_label('Mobile number',exact=True).fill('0000000000')
    page.get_by_label('Work',exact=True).fill('Synthetic verification only')
    page.get_by_label('Address',exact=True).fill('TEST RECORD — remove before launch')
    page.get_by_role('button',name='Save to Supabase',exact=False).click()
    page.get_by_text(client_name,exact=True).wait_for(timeout=20000)
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('heading',name='Good to see you.').wait_for(timeout=20000)
    page.get_by_role('button',name='Clients',exact=True).click()
    page.get_by_text(client_name,exact=True).wait_for(timeout=20000)
    say('PASS: client created in Supabase and survives full browser reload')

    page.locator('.sidebar').get_by_role('button',name='Loans',exact=True).click()
    page.get_by_role('button',name='Give money',exact=False).click()
    page.locator('select[name=client]').select_option(label=client_name+' · '+code)
    page.get_by_label('Amount given (₹)',exact=True).fill('100000')
    page.get_by_label('Monthly rate (%)',exact=True).fill('5')
    today=datetime.date.today()
    # 20th of two months ago guarantees exactly one posted monthly charge now.
    year=today.year;month=today.month-2
    if month<=0:month+=12;year-=1
    page.get_by_label('Date given',exact=True).fill(f'{year:04d}-{month:02d}-20')
    page.locator('input[name="approve"]').check()
    page.get_by_role('button',name='Save to Supabase',exact=False).click()
    page.get_by_role('dialog').wait_for(state='hidden',timeout=20000)
    page.get_by_text('₹5,000.00',exact=True).first.wait_for(timeout=20000)
    say('PASS: disbursement posts the expected 5,000 monthly interest charge')

    page.get_by_role('button',name='Record repayment',exact=False).click()
    page.get_by_label('Amount received (₹)',exact=True).fill('7000')
    page.get_by_role('button',name='Save to Supabase',exact=False).click()
    page.get_by_role('heading',name='Payment receipt',exact=True).wait_for(timeout=20000)
    page.get_by_role('dialog').get_by_text('₹5,000.00',exact=True).wait_for()
    page.get_by_role('dialog').get_by_text('₹2,000.00',exact=True).wait_for()
    page.get_by_role('button',name='Close dialog',exact=True).click()
    page.get_by_text('₹98,000.00',exact=True).first.wait_for(timeout=20000)
    say('PASS: 7,000 receipt allocates 5,000 interest + 2,000 principal; capital is 98,000')

    page.get_by_role('button',name='Secret wallet',exact=True).click()
    page.get_by_label('New wallet password',exact=True).fill(wallet_password)
    page.get_by_role('button',name='Create encrypted wallet',exact=True).click()
    page.get_by_text('Wallet unlocked.',exact=False).wait_for(timeout=20000)
    with page.expect_download() as download:
        page.get_by_role('button',name='Download recovery kit',exact=True).click()
    assert download.value.suggested_filename.endswith('.json')
    say('PASS: encrypted wallet created and recovery kit download generated')

    page.get_by_role('button',name='Clients',exact=True).click()
    page.get_by_role('row').filter(has_text=code).get_by_role('button',name='Create login',exact=True).click()
    page.get_by_label('Client password',exact=True).fill(client_password)
    page.get_by_label('Private notes',exact=True).fill('Synthetic credential record for verification only')
    page.get_by_role('button',name='Save to Supabase',exact=False).click()
    page.get_by_role('dialog').wait_for(state='hidden',timeout=20000)
    page.get_by_role('button',name='Reset password',exact=True).wait_for(timeout=20000)
    say('PASS: real client Auth identity provisioned with encrypted credential record')

    # Capture IDs without credentials for post-test SQL inspection and cleanup.
    fixture=page.evaluate('''async()=>{const config=await import('/public-config.json');const session=JSON.parse(sessionStorage.getItem('velmurugan-auth'));const r=await fetch(config.default.supabaseUrl+'/rest/v1/rpc/finance_get_workspace',{method:'POST',headers:{apikey:config.default.supabasePublishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}'});return r.json()}''')
    client=next(c for c in fixture['clients'] if c['customer_code']==code)
    loan=next(l for l in fixture['loans'] if l['client_id']==client['id'])
    assert float(loan['balance']['principal'])==98000 and float(loan['balance']['interest'])==0
    Path(args.fixture_file).write_text(json.dumps({'wallet_test_password':wallet_password,'client_test_password':client_password,'client_id':client['id'],'client_user_id':client['auth_user_id'],'customer_code':code,'loan_id':loan['id'],'owner_id':session.get('user',{}).get('id'),'wallet_test_created':True}),encoding='utf-8')
    page.screenshot(path=str(evidence/'live-owner-desktop.png'),full_page=True)

    client_context=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce')
    cp=client_context.new_page();cp.on('pageerror',lambda e:errors.append(str(e)))
    cp.goto(args.url,wait_until='domcontentloaded')
    cp.get_by_role('button',name='Client',exact=True).click()
    cp.get_by_label('Customer ID',exact=True).fill(code)
    cp.get_by_label('Password',exact=True).fill(client_password)
    cp.get_by_role('button',name='Sign in',exact=False).click()
    cp.get_by_role('heading',name='Hello, Integration.',exact=True).wait_for(timeout=30000)
    assert not cp.get_by_role('button',name='Secret wallet',exact=True).count()
    assert cp.evaluate('document.documentElement.scrollWidth<=innerWidth')
    cp.reload(wait_until='domcontentloaded')
    cp.get_by_role('heading',name='Hello, Integration.',exact=True).wait_for(timeout=20000)
    cp.get_by_text('₹98,000.00',exact=True).first.wait_for()
    say('PASS: independent client ID/password login sees real updated balance after reload at 390px')
    cp.get_by_role('button',name='Open workspace menu',exact=True).click()
    cp.get_by_role('button',name='Questions',exact=True).click()
    cp.get_by_role('button',name='New question',exact=False).click()
    cp.get_by_label('Subject',exact=True).fill('TEST — confirm my payment')
    cp.get_by_label('Your question',exact=True).fill('Can you confirm the interest and capital allocation?')
    cp.get_by_role('button',name='Save to Supabase',exact=False).click()
    cp.get_by_role('dialog').wait_for(state='hidden',timeout=20000)
    cp.get_by_text('TEST — confirm my payment',exact=True).wait_for(timeout=20000)
    cp.screenshot(path=str(evidence/'live-client-mobile.png'),full_page=True)
    say('PASS: client question is saved to Supabase')

    page.bring_to_front()
    page.get_by_role('button',name='Refresh',exact=False).click()
    page.get_by_role('button',name='Questions',exact=True).click()
    page.get_by_text('TEST — confirm my payment',exact=True).click()
    page.get_by_label('Your reply',exact=True).fill('Confirmed: 5,000 interest and 2,000 capital.')
    page.get_by_role('button',name='Send reply',exact=False).click()
    page.get_by_text('Confirmed: 5,000 interest and 2,000 capital.',exact=True).wait_for(timeout=20000)
    say('PASS: financer reads and replies to the client question')
    page.get_by_role('button',name='Clients',exact=True).click()
    page.get_by_role('row').filter(has_text=code).get_by_role('button',name='Disable',exact=True).click()
    page.get_by_text('Disabled',exact=True).wait_for(timeout=20000)
    cp.bring_to_front();cp.reload(wait_until='domcontentloaded')
    cp.get_by_role('heading',name='Account access',exact=True).wait_for(timeout=20000)
    say('PASS: disabling the client invalidates an already signed-in session')
    assert not errors,errors
    say('PASS: no browser JavaScript errors in the tested live flow')
    browser.close()
