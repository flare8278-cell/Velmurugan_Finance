"""Run real SQL/RLS and concurrent-payment tests in a disposable local PostgreSQL.

Requires PostgreSQL 17 tools on PATH or PG_BIN. Uses only fake data, no existing DB.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import os
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('PG_BIN', r'C:\Program Files\PostgreSQL\17\bin'))

def tool(name):
    return str(BIN / (name + ('.exe' if os.name == 'nt' else ''))) if BIN.exists() else shutil.which(name)

def run(args, check=True):
    # Windows server children can retain pipe handles after pg_ctl exits.
    # Redirect controller output to a file so communicate() cannot hang.
    if Path(args[0]).stem == 'pg_ctl':
        with tempfile.TemporaryFile(mode='w+') as output:
            result = subprocess.run(args, text=True, stdin=subprocess.DEVNULL, stdout=output, stderr=output, timeout=60)
            output.seek(0)
            result.stdout = output.read()
            result.stderr = ''
    else:
        result = subprocess.run(args, text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    return result

with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='velmurugan-finance-test-') as temp:
    cluster = Path(temp) / 'data'
    log = Path(temp) / 'server.log'
    run([tool('initdb'), '-D', str(cluster), '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'])
    started = False
    try:
        run([tool('pg_ctl'), '-D', str(cluster), '-l', str(log), '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start'])
        started = True
        base = [tool('psql'), '-X', '-h', '127.0.0.1', '-p', str(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
        for file in ['supabase/tests/bootstrap_local.sql', 'supabase/migrations/202611030001_finance_core.sql', 'supabase/tests/finance_core.sql']:
            run(base + ['-f', str(ROOT / file)])
        print('PASS: migration, calculations, idempotency, permission and date tests')

        owner = '00000000-0000-0000-0000-000000000001'
        session = '00000000-0000-0000-0000-000000000010'
        claims = json.dumps({'sub': owner, 'session_id': session})
        client = '00000000-0000-0000-0000-000000000030'
        loan = '00000000-0000-0000-0000-000000000040'
        setup = f"""
        insert into auth.users values ('{owner}');
        insert into public.finance_profiles values ('{owner}','owner',true);
        insert into finance_private.owner_verifications values ('{owner}','{session}',now()+interval '1 hour');
        insert into public.finance_clients(id,customer_code,name) values ('{client}','RACE001','Concurrency Test');
        insert into public.finance_loans(id,client_id,original_principal,monthly_rate,disbursed_on,first_due_on,next_due_on,terms_code,terms_approved_at,terms_approved_by)
        values ('{loan}','{client}',1000,5,current_date,current_date+60,current_date+60,'monthly_remaining_v1',now(),'{owner}');
        """
        run(base + ['-c', setup])

        def payment(request, amount):
            sql = f"""begin; set local role authenticated;
            select set_config('request.jwt.claims','{claims}',true);
            select (public.finance_record_payment('{request}','{loan}',{amount},(now() at time zone 'Asia/Kolkata')::date,'cash')).id;
            commit;"""
            return run(base + ['-c', sql], check=False)

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda r: payment(r,600), [
                '00000000-0000-0000-0000-000000000051',
                '00000000-0000-0000-0000-000000000052']))
        assert sum(r.returncode == 0 for r in results) == 1, 'Concurrent overpayments were not serialized'
        assert any('exceeds outstanding' in r.stderr for r in results), 'Expected overpayment rejection'
        print('PASS: two competing 600 payments against 1000 allow exactly one receipt')

        request = '00000000-0000-0000-0000-000000000060'
        with ThreadPoolExecutor(2) as pool:
            retries = list(pool.map(lambda _: payment(request,100), range(2)))
        assert all(r.returncode == 0 for r in retries), 'Concurrent retry failed'
        count = run(base + ['-tA', '-c', f"select count(*) from public.finance_payments where request_id='{request}'"]).stdout.strip()
        assert count == '1', 'Concurrent duplicate produced multiple receipts'
        print('PASS: concurrent identical request creates exactly one receipt')
    finally:
        if started:
            run([tool('pg_ctl'), '-D', str(cluster), '-m', 'fast', '-w', 'stop'])
