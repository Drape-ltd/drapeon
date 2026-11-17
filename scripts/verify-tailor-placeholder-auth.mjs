import assert from 'node:assert/strict'

const url=process.env.SUPABASE_URL?.replace(/\/+$/u,'')
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service=process.env.SUPABASE_SERVICE_ROLE_KEY
const userId=process.env.TAILOR_PLACEHOLDER_USER_ID
const email=process.env.TAILOR_PLACEHOLDER_EMAIL
if(!url||!anon||!service||!userId||!email)throw new Error('Development Supabase and placeholder inputs are required.')

async function call(path,{key=anon,body,method='POST'}={}){
  const response=await fetch(`${url}${path}`,{method,redirect:'manual',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  const payload=await response.json().catch(()=>({}))
  assert.equal('access_token' in payload,false,`${path} unexpectedly issued an access token`)
  assert.equal('refresh_token' in payload,false,`${path} unexpectedly issued a refresh token`)
  return response.status
}

const adminResponse=await fetch(`${url}/auth/v1/admin/users/${userId}`,{headers:{apikey:service,Authorization:`Bearer ${service}`}})
assert.equal(adminResponse.ok,true,'placeholder admin lookup failed')
const user=await adminResponse.json()
assert.equal(user.email,email)
assert.equal(user.email_confirmed_at??null,null)
assert.equal(user.last_sign_in_at??null,null)
const providers=Array.isArray(user.identities)?user.identities.map((identity)=>identity.provider):[]
assert.deepEqual(providers.filter((provider)=>provider!=='email'),[])
assert.ok(Date.parse(user.banned_until)>Date.now())

const password=await call('/auth/v1/token?grant_type=password',{body:{email,password:'not-a-real-placeholder-password'}})
const otp=await call('/auth/v1/otp',{body:{email,create_user:false}})
const recovery=await call('/auth/v1/recover',{body:{email}})
const refresh=await call('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:'placeholder-has-no-refresh-token'}})
console.log(JSON.stringify({ok:true,password,otp,recovery,refresh,banned:true,oauthIdentities:0,sessionsIssued:0}))
