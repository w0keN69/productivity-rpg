// In Track authentication adapter.
// No Supabase secrets are stored in the repository.
// Configure window.INTRACK_SUPABASE_CONFIG before enabling cloud auth.

let clientPromise=null;
export async function getClient(){
  const cfg=window.INTRACK_SUPABASE_CONFIG;
  if(!cfg?.url||!cfg?.anonKey)return null;
  if(!clientPromise){
    clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(({createClient})=>createClient(cfg.url,cfg.anonKey));
  }
  return clientPromise;
}
export async function getSession(){
  const client=await getClient(); if(!client)return null;
  const {data,error}=await client.auth.getSession(); if(error)throw error; return data.session||null;
}
export async function signUp(email,password,displayName=''){
  const client=await getClient(); if(!client)throw new Error('Cloud authentication is not configured yet.');
  return client.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo:'https://w0ken69.github.io/productivity-rpg/'}});
}
export async function signIn(email,password){
  const client=await getClient(); if(!client)throw new Error('Cloud authentication is not configured yet.');
  return client.auth.signInWithPassword({email,password});
}
export async function signOut(){
  const client=await getClient(); if(!client)throw new Error('Cloud authentication is not configured yet.');
  return client.auth.signOut();
}
export async function onAuthStateChange(callback){
  const client=await getClient(); if(!client)return ()=>{};
  const {data}=client.auth.onAuthStateChange((_event,session)=>callback(session));
  return ()=>data.subscription.unsubscribe();
}
export function isCloudConfigured(){
  const cfg=window.INTRACK_SUPABASE_CONFIG; return !!(cfg?.url&&cfg?.anonKey);
}
