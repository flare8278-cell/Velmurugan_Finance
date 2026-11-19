import {createClient} from 'npm:@supabase/supabase-js@2.119.0';

const url=Deno.env.get('SUPABASE_URL')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!;
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const ownerEmail='imran5426117@gmail.com';
const allowed=new Set((Deno.env.get('ALLOWED_ORIGINS')||'https://velmurugan-finance.flare8278.workers.dev,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173').split(','));
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
class ApiError extends Error{constructor(message:string,public status=400){super(message)}}
function text(value:unknown,max=200){if(typeof value!=='string'||value.length>max)throw new ApiError('Invalid text input');return value.trim()}
function password(value:unknown){if(typeof value!=='string'||value.length<12||value.length>128)throw new ApiError('Use a password of 12–128 characters');return value}
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await admin.rpc(name,args);if(error)throw new ApiError(error.message);return data}
async function limit(key:string,count=10,seconds=600){const k=await hash(serviceKey+':'+key);if(!await rpc('finance_service_rate_limit',{p_key:k,p_limit:count,p_window_seconds:seconds}))throw new ApiError('Too many attempts. Try again later.',429)}
async function identity(req:Request){
 const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
 if(!token)throw new ApiError('Sign in required',401);
 const {data,error}=await admin.auth.getUser(token);
 if(error||!data.user)throw new ApiError('Session expired. Sign in again.',401);
 let claims;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))}catch{throw new ApiError('Invalid session',401)}
 const session=claims.session_id;if(typeof session!=='string')throw new ApiError('Invalid session',401);
 const ctx=await rpc('finance_service_context',{p_user:data.user.id,p_session:session});
 if(!ctx?.active||!ctx.session_live||(ctx.role==='client'&&!ctx.client_active))throw new ApiError('Account disabled or not linked',403);
 return {token,user:data.user,session,ctx};
}
async function verifiedOwner(req:Request){const i=await identity(req);if(i.ctx.role!=='owner'||!i.ctx.verified)throw new ApiError('Owner email verification required',403);return i}
function sessionResult(session:any){return {session:{access_token:session.access_token,refresh_token:session.refresh_token,expires_in:session.expires_in,expires_at:session.expires_at,token_type:session.token_type}}}

Deno.serve(async req=>{
 const origin=req.headers.get('origin');
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, GET, OPTIONS'};
 if(origin&&allowed.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowed.has(origin))return respond({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method==='GET')return respond({service:'finance-api',email_delivery_configured:Boolean(Deno.env.get('RESEND_API_KEY')&&Deno.env.get('MAIL_FROM'))});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>250000)throw new ApiError('Request too large',413);
  const raw=await req.text();if(raw.length>250000)throw new ApiError('Request too large',413);
  const body=JSON.parse(raw);const action=text(body.action,50);
  // Gateway-controlled client address. Hash with a server-only secret before persistence.
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  await limit('ip:'+ip,60,600);
  if(action==='bootstrap'){
   const token=text(body.token,200),pw=password(body.password);
   const email=await rpc('finance_service_bootstrap_check',{p_token_hash:await hash(token)});
   const {data,error}=await admin.auth.admin.createUser({email,password:pw,email_confirm:true});
   if(error||!data.user)throw new ApiError('Owner account setup failed');
   try{await rpc('finance_service_finish_bootstrap',{p_user:data.user.id})}catch(error){await admin.auth.admin.deleteUser(data.user.id);throw error}
   return respond({ok:true});
  }
  if(action==='owner-login'||action==='client-login'){
   let email='';
   if(action==='owner-login'){
    email=text(body.email).toLowerCase();await limit('owner-login:'+email,10,900);
    if(email!==ownerEmail)throw new ApiError('Invalid login details',401);
   }else{
    const code=text(body.customer_id,30).toUpperCase();await limit('client-login:'+code,10,900);
    if(!/^[A-Z0-9-]{3,30}$/.test(code))throw new ApiError('Invalid login details',401);
    const mapped=await rpc('finance_service_client_identity',{p_code:code});
    if(!mapped?.email){await new Promise(r=>setTimeout(r,300));throw new ApiError('Invalid login details',401)}
    email=mapped.email;
   }
   const pw=typeof body.password==='string'?body.password:'';
   const client=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data,error}=await client.auth.signInWithPassword({email,password:pw});
   if(error||!data.session)throw new ApiError('Invalid login details',401);
   return respond(sessionResult(data.session));
  }
  if(action==='send-code'){
   const i=await identity(req);if(i.ctx.role!=='owner')throw new ApiError('Owner account required',403);
   const key=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('MAIL_FROM');
   if(!key||!from)throw new ApiError('Verification email is not configured. Ask the owner to configure the email sender.',503);
   await limit('send-code:'+i.user.id,5,3600);
   const id=crypto.randomUUID(),random=new Uint32Array(1);let value:number;
   do{crypto.getRandomValues(random);value=random[0]}while(value>=4294000000);
   const code=String(value%1000000).padStart(6,'0');
   await rpc('finance_service_issue_code',{p_user:i.user.id,p_session:i.session,p_id:id,p_hash:await hash(serviceKey+':'+id+':'+code)});
   const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from,to:[i.user.email],subject:'Velmurugan Finance — verification code',text:'Your sign-in code is '+code+'. It expires in 10 minutes. Do not share it.'})});
   if(!mail.ok)throw new ApiError('Email delivery failed. Try again after one minute.',502);
   return respond({challenge_id:id,expires_in:600});
  }
  if(action==='verify-code'){
   const i=await identity(req);if(i.ctx.role!=='owner')throw new ApiError('Owner account required',403);
   const id=text(body.challenge_id,50),code=text(body.code,6);if(!/^\d{6}$/.test(code))throw new ApiError('Enter the six-digit code');
   const ok=await rpc('finance_service_verify_code',{p_user:i.user.id,p_session:i.session,p_id:id,p_hash:await hash(serviceKey+':'+id+':'+code)});
   if(!ok)throw new ApiError('Code is incorrect, expired or already used',401);
   return respond({ok:true});
  }
  if(action==='provision-client'){
   const i=await verifiedOwner(req);const clientId=text(body.client_id,50),pw=password(body.password);
   const {data:record,error:readError}=await admin.from('finance_clients').select('id,customer_code,auth_user_id,active').eq('id',clientId).single();
   if(readError||!record||!record.active||record.auth_user_id)throw new ApiError('Choose an active client without a login');
   const email='client.'+crypto.randomUUID()+'@clients.velmurugan.invalid';
   const {data,error}=await admin.auth.admin.createUser({email,password:pw,email_confirm:true});
   if(error||!data.user)throw new ApiError('Could not create client login');
   try{await rpc('finance_service_link_client',{p_owner:i.user.id,p_session:i.session,p_client:clientId,p_user:data.user.id,p_envelope:body.envelope})}
   catch(error){await admin.auth.admin.deleteUser(data.user.id);throw error}
   return respond({ok:true,customer_id:record.customer_code});
  }
  if(action==='reset-client-password'){
   const i=await verifiedOwner(req);const id=text(body.client_id,50),pw=password(body.password);
   const {data:record,error}=await admin.from('finance_clients').select('auth_user_id').eq('id',id).single();
   if(error||!record?.auth_user_id)throw new ApiError('Client login not found');
   // Disable access and stage ciphertext before updating Auth. A partial failure stays
   // disabled; retry safely rather than showing an unconfirmed password as current.
   await rpc('finance_service_reset_client',{p_owner:i.user.id,p_session:i.session,p_client:id,p_envelope:body.envelope});
   const changed=await admin.auth.admin.updateUserById(record.auth_user_id,{password:pw});
   if(changed.error)throw new ApiError('Password update failed. Client access is temporarily disabled; retry the reset.',502);
   await rpc('finance_service_finish_client_reset',{p_owner:i.user.id,p_session:i.session,p_client:id});
   return respond({ok:true});
  }
  return respond({error:'Unknown operation'},404);
 }catch(error){
  if(error instanceof ApiError)return respond({error:error.message},error.status);
  return respond({error:'Unable to complete the request. Please try again.'},500);
 }
});
