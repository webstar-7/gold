(function(){
'use strict';
const K=window.K={};

/* ============================================================
   NYANSATEK Gold — multi-tenant, Supabase-backed.

   This file is the real-product rebuild of the offline single-file
   Gold Dealership demo. The pricing/karat-chart/cash-float business
   logic further down is carried over byte-for-byte from the
   demo (it was already verified against the dealer's own worked
   numbers) — only the LOGIN and STORAGE layers are new, rebuilt to
   match the pattern already proven on the live nyansatek-pos app:
   Supabase Auth, a business-name/staff-username login lookup, and
   an org_id-scoped multi-tenant data model enforced by RLS.

   TODO before going live: replace these with your real Gold
   Supabase project's values (Project Settings -> API). Get a
   project by running schema/gold_schema.sql (shipped alongside
   this file) in a NEW Supabase project dedicated to Gold.
   ============================================================ */
const SUPABASE_URL = "https://kgpdapzwxgwnhzfsamro.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtncGRhcHp3eGd3bmh6ZnNhbXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MDU3NzYsImV4cCI6MjEwNjQ4MTc3Nn0.w55duBHPDnkgZ9AyoLo5Hejb0fpdohLr2kd4EBkqBhQ";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const C={name:'NYANSATEK Gold',product:'Gold Dealership Manager',vendorName:'NYANSATEK',vendorPhone:'0536340578',
 tagline:'Weigh in Refined or Box gold, price it exactly the way the Gold App does — karat chart and all — pay the seller on the spot, and track the day’s cash float.'};
let S=null,user=null,org=null,cur='dashboard';

/* ================= generic helpers (unchanged from the demo engine) ================= */
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const pad=(n,l)=>String(n).padStart(l||2,'0');
const dstr=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>dstr(new Date());
const parse=s=>{const p=String(s).slice(0,10).split('-').map(Number);return new Date(p[0],p[1]-1,p[2]);};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return dstr(d);};
const diffDays=(a,b)=>Math.round((parse(a)-parse(b))/86400000);
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtDate=s=>{if(!s)return '—';const d=parse(s);return d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear();};
const fmtDay=s=>{const d=parse(s);return DOW[d.getDay()]+' '+d.getDate()+' '+MON[d.getMonth()];};
const nowTime=()=>{const d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes());};
const timeOf=ts=>{if(!ts)return '';const d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes());};
const money=n=>'GH₵'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const sum=(a,f)=>a.reduce((s,x)=>s+(f?f(x):x),0);
const firstName=n=>{n=String(n||'').replace(/^((mr|mrs|ms|dr|pharm|rev|pastor|elder|nurse|madam|hon|prof|deaconess|deacon)\.?\s+)+/i,'');return n.split(/\s+/)[0]||'';};
const initials=n=>String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
Object.assign(K,{firstName,esc,pad,today,addDays,diffDays,fmtDate,fmtDay,nowTime,money,sum,initials,dstr,parse});
K.rng=seed=>{let s=(seed>>>0)||1;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};};

const ICONS={
home:'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
users:'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21c0-4 4-6 8-6s8 2 8 6',
cash:'M3 6h18v12H3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
cart:'M3 4h2l2.4 11h11l2-8H6.2M9.5 20h.01M17 20h.01',
box:'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
gear:'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
chart:'M4 20V10M10 20V4M16 20v-7M22 20H2',
list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'
};
K.icon=n=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="'+(ICONS[n]||ICONS.list)+'"/></svg>';

/* ================= org-scoped data layer (replaces localStorage) =================
   Every tenant table is loaded into memory once at boot (S.t.<table>), exactly the
   shape the original demo's views already expect. K.add/K.upd/K.del update that
   in-memory copy immediately (so the UI never waits on a round trip) and fire the
   real Supabase write in the background. If a write fails, the optimistic local
   change is rolled back and the user is told plainly — there is no offline write
   queue in this first version (unlike the till-sale queue on nyansatek-pos), so an
   add/edit/delete does need a live connection to actually stick. Reads fall back to
   a short-lived local cache if the network is down at boot (see loadCachedBoot). */
const ADAPTERS={
 sellers:{
  table:'sellers',
  toApp:r=>({id:r.id,name:r.name,phone:r.phone||''}),
  toDb:a=>({id:a.id,org_id:org.id,name:a.name,phone:a.phone||null})
 },
 purchases:{
  table:'purchases',
  toApp:r=>({id:r.id,ref:r.ref,date:r.occurred_on,time:timeOf(r.created_at),sellerId:r.seller_id||'',weigher:r.weigher||'',
   kind:r.kind,grams:Number(r.grams),density:r.density!=null?Number(r.density):undefined,pounds:r.pounds!=null?Number(r.pounds):undefined,
   karat:r.karat!=null?Number(r.karat):undefined,bladeEq:r.blade_eq!=null?Number(r.blade_eq):undefined,
   poundEq:Number(r.pound_eq),amount:Number(r.amount)}),
  toDb:a=>({id:a.id,org_id:org.id,ref:a.ref,kind:a.kind,grams:a.grams,density:a.density==null?null:a.density,karat:a.karat==null?null:a.karat,
   pounds:a.pounds==null?null:a.pounds,blade_eq:a.bladeEq==null?null:a.bladeEq,pound_eq:a.poundEq,amount:a.amount,
   seller_id:a.sellerId||null,weigher:a.weigher||null,occurred_on:a.date})
 },
 dispatches:{
  table:'dispatches',
  toApp:r=>({id:r.id,ref:r.ref,date:r.occurred_on,time:timeOf(r.created_at),to:r.sold_to||'',kind:r.kind,poundEq:Number(r.pound_eq),rate:Number(r.rate||0),revenue:Number(r.amount||0)}),
  toDb:a=>({id:a.id,org_id:org.id,ref:a.ref,kind:a.kind,pound_eq:a.poundEq,rate:a.rate,amount:a.revenue,sold_to:a.to||null,occurred_on:a.date})
 },
 cashfloat:{
  table:'cashfloat',
  toApp:r=>({id:r.id,date:r.occurred_on,amount:Number(r.amount),note:r.note||''}),
  toDb:a=>({id:a.id,org_id:org.id,amount:a.amount,note:a.note||null,occurred_on:a.date})
 },
 expenses:{
  table:'expenses',
  toApp:r=>({id:r.id,date:r.occurred_on,category:r.category||'',amount:Number(r.amount),note:r.note||''}),
  toDb:a=>({id:a.id,org_id:org.id,category:a.category||null,amount:a.amount,note:a.note||null,occurred_on:a.date})
 },
 rateHistory:{
  table:'rate_history',
  toApp:r=>({id:r.id,date:r.effective_on,poundRate:Number(r.pound_rate),bladeRate:Number(r.blade_rate),resaleRate:Number(r.resale_rate)}),
  toDb:a=>({id:a.id,org_id:org.id,pound_rate:a.poundRate,blade_rate:a.bladeRate,resale_rate:a.resaleRate,effective_on:a.date})
 }
};
const SETTING_COL={poundRate:'pound_rate',bladeRate:'blade_rate',resaleRate:'resale_rate',worldGoldUsdOz:'world_gold_usd_oz',usdGhsRate:'usd_ghs_rate',org:'business_name',phone:'phone',location:'location'};

K.T=n=>{if(!S.t[n])S.t[n]=[];return S.t[n];};
K.get=(n,id)=>K.T(n).find(r=>r.id===id);
K.uid=()=>(self.crypto&&crypto.randomUUID)?crypto.randomUUID():'id'+Date.now()+Math.random().toString(16).slice(2);
K.save=()=>{}; // compat no-op — persistence now happens per-call inside add/upd/del below

K.add=(table,row)=>{
 const ad=ADAPTERS[table];
 if(!ad){ // local-only pseudo-tables (e.g. activity) that never touch the server
  row.id=row.id||K.uid();K.T(table).push(row);return row;
 }
 row.id=row.id||K.uid();
 if(!row.time)row.time=nowTime();
 K.T(table).push(row);
 sb.from(ad.table).insert(ad.toDb(row)).then(({error})=>{
  if(error){
   S.t[table]=K.T(table).filter(r=>r.id!==row.id);
   K.toast('Could not save to the server — check your connection and try again','bad');
   if(cur)K.render();
  }
 });
 return row;
};
K.upd=(table,id,patch)=>{
 const ad=ADAPTERS[table];const r=K.get(table,id);if(!r)return null;
 const before=Object.assign({},r);
 Object.assign(r,patch);
 if(ad){
  sb.from(ad.table).update(ad.toDb(r)).eq('id',id).then(({error})=>{
   if(error){Object.assign(r,before);K.toast('Could not save that change — check your connection','bad');if(cur)K.render();}
  });
 }
 return r;
};
K.del=(table,id)=>{
 const ad=ADAPTERS[table];const row=K.get(table,id);
 S.t[table]=K.T(table).filter(r=>r.id!==id);
 if(ad&&row){
  sb.from(ad.table).delete().eq('id',id).then(({error})=>{
   if(error){K.T(table).push(row);K.toast('Could not delete that — check your connection','bad');if(cur)K.render();}
  });
 }
};
K.setting=(k,v)=>{
 const col=SETTING_COL[k];
 if(v!==undefined){
  S.settings[k]=v;
  if(col&&org){org[col]=v;sb.from('organizations').update({[col]:v}).eq('id',org.id).then(({error})=>{if(error)K.toast('Could not save that setting','bad');});}
 }
 return S.settings[k];
};
K.user=()=>user;
K.log=text=>{const a=K.T('activity');a.unshift({id:K.uid(),at:new Date().toISOString(),text});if(a.length>60)a.length=60;};

/* ================= UI atoms (unchanged from the demo engine) ================= */
K.badge=(t,tone)=>'<span class="badge b-'+(tone||'mute')+'">'+esc(t)+'</span>';
K.empty=(t,s)=>'<div class="empty"><b>'+esc(t)+'</b>'+(s?esc(s):'')+'</div>';
K.prog=(pct,tone)=>'<div class="prog '+(tone||'')+'"><i style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div>';
K.chips=(list,curIdx,act)=>'<div class="chips">'+list.map((l,i)=>'<button type="button" class="'+(i===curIdx?'on':'')+'" data-act="'+act+'" data-id="'+i+'">'+esc(l)+'</button>').join('')+'</div>';
K.strip=items=>'<div class="strip">'+items.map(i=>'<div class="s">'+esc(i[0])+'<b>'+(i[2]==='raw'?i[1]:esc(i[1]))+'</b></div>').join('')+'</div>';
K.table=(cols,rows,opt)=>{
 opt=opt||{};
 if(!rows.length)return K.empty(opt.empty||'Nothing here yet',opt.emptySub||'');
 return '<div class="tablewrap"><table><thead><tr>'+cols.map(c=>'<th class="'+(c.cls||'')+'">'+esc(c.l)+'</th>').join('')+'</tr></thead><tbody>'+
   rows.map((r,i)=>'<tr>'+cols.map(c=>'<td class="'+(c.cls||'')+'">'+(c.f?c.f(r,i):esc(r[c.k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
};
K.bind=(el,h)=>{
 el.onclick=e=>{const b=e.target.closest('[data-act]');if(!b||!el.contains(b))return;const f=h[b.dataset.act];if(f)f(b.dataset.id,b,e);};
 el.onchange=e=>{const t=e.target.closest('[data-chg]');if(t&&el.contains(t)){const f=h[t.dataset.chg];if(f)f(t.value,t,e);}};
 el.oninput=e=>{const t=e.target.closest('[data-inp]');if(t&&el.contains(t)){const f=h[t.dataset.inp];if(f)f(t.value,t,e);}};
};
K.render=()=>go(cur);
K.go=id=>go(id);

K.toast=(msg,tone)=>{
 const root=document.getElementById('toast-root');
 const t=document.createElement('div');t.className='toast '+(tone||'');t.textContent=msg;root.appendChild(t);
 setTimeout(()=>t.remove(),2800);
};
K.modal=o=>{
 const root=document.getElementById('modal-root');
 const w=document.createElement('div');w.className='modal-back';
 w.innerHTML='<div class="modal'+(o.wide?' wide':'')+'" role="dialog" aria-modal="true"><header><h3>'+esc(o.title)+'</h3><button class="x" data-close aria-label="Close">×</button></header><div class="mbody">'+o.body+'</div><footer>'+(o.buttons||[]).map((b,i)=>'<button type="button" class="btn '+(b.cls||'')+'" data-b="'+i+'">'+esc(b.l)+'</button>').join('')+'</footer></div>';
 const close=()=>{w.remove();document.removeEventListener('keydown',key);};
 const key=e=>{if(e.key==='Escape'&&root.lastElementChild===w)close();};
 document.addEventListener('keydown',key);
 w.addEventListener('mousedown',e=>{if(e.target===w)close();});
 w.addEventListener('click',e=>{
  if(e.target.closest('[data-close]')){close();return;}
  const pt=e.target.closest('[data-pwtoggle]');
  if(pt){const inp=w.querySelector('input[name="'+pt.dataset.pwtoggle+'"]');if(inp){const show=inp.type==='password';inp.type=show?'text':'password';pt.textContent=show?'Hide':'Show';}return;}
  const b=e.target.closest('[data-b]');
  if(b){const def=o.buttons[+b.dataset.b];const r=def.fn?def.fn(w,close):undefined;if(r!==false)close();}
 });
 root.appendChild(w);
 const f=w.querySelector('input:not([type=hidden]),select,textarea');if(f&&!o.noFocus)f.focus();
 if(o.onOpen)o.onOpen(w,close);
 return{close,el:w};
};
K.confirm=(msg,yes,fn,tone)=>K.modal({title:'Please confirm',body:'<p>'+esc(msg)+'</p>',buttons:[{l:'Cancel'},{l:yes||'Yes',cls:tone||'pri',fn:()=>{fn();}}]});

K.formModal=o=>{
 const v=o.values||{};
 const fld=f=>{
  const val=v[f.k]!=null?v[f.k]:(f.def!=null?f.def:'');
  let inp;
  const optsOf=()=>((typeof f.opts==='function'?f.opts():f.opts)||[]).map(x=>typeof x==='object'?x:{v:x,l:x});
  if(f.t==='select'){
   inp='<select name="'+f.k+'">'+(f.blank===false?'':'<option value="">— choose —</option>')+optsOf().map(x=>'<option value="'+esc(x.v)+'"'+(String(x.v)===String(val)?' selected':'')+'>'+esc(x.l)+'</option>').join('')+'</select>';
  }else if(f.t==='pick'){
   const os=optsOf();const cur2=os.find(x=>String(x.v)===String(val));
   inp='<input name="'+f.k+'" list="dl_'+f.k+'" autocomplete="off" value="'+esc(cur2?cur2.l:'')+'" placeholder="'+esc(f.ph||'Start typing a name…')+'"><datalist id="dl_'+f.k+'">'+os.map(x=>'<option value="'+esc(x.l)+'"></option>').join('')+'</datalist>';
  }else if(f.t==='textarea'){
   inp='<textarea name="'+f.k+'" rows="3">'+esc(val)+'</textarea>';
  }else if(f.t==='password'){
   inp='<div class="pwwrap"><input name="'+f.k+'" type="password" value="'+esc(val)+'"'+(f.ph?' placeholder="'+esc(f.ph)+'"':'')+' autocomplete="new-password"><button type="button" class="pwtoggle" data-pwtoggle="'+f.k+'">Show</button></div>';
  }else{
   inp='<input name="'+f.k+'" type="'+(f.t||'text')+'" value="'+esc(val)+'"'+(f.step?' step="'+f.step+'"':'')+(f.min!=null?' min="'+f.min+'"':'')+(f.ph?' placeholder="'+esc(f.ph)+'"':'')+(f.ro?' readonly':'')+'>';
  }
  return '<label class="fld'+(f.w==='full'||f.t==='textarea'?' full':'')+'"><span>'+esc(f.l)+(f.req?' *':'')+'</span>'+inp+(f.hint?'<small>'+esc(f.hint)+'</small>':'')+'</label>';
 };
 return K.modal({title:o.title,wide:o.wide,body:'<form class="fgrid" onsubmit="return false">'+o.fields.map(fld).join('')+'</form>'+(o.foot||''),
  buttons:[{l:'Cancel'},{l:o.saveLabel||'Save',cls:'pri',fn:w=>{
   const out={};
   for(const f of o.fields){
    const el=w.querySelector('[name="'+f.k+'"]');let x=el?el.value.trim():'';
    if(f.t==='pick'){
     const os=((typeof f.opts==='function'?f.opts():f.opts)||[]).map(y=>typeof y==='object'?y:{v:y,l:y});
     if(x){const m=os.find(y=>y.l===x);if(!m){K.toast('Choose "'+f.l+'" from the list','bad');el.focus();return false;}x=m.v;}
    }
    if(f.req&&x===''){K.toast('Fill in: '+f.l,'bad');if(el)el.focus();return false;}
    if(f.t==='number'&&x!=='')x=Number(x);
    out[f.k]=x;
   }
   return o.onSave(out,w);
  }}]});
};

K.result=o=>{
 const root=document.getElementById('modal-root');
 const w=document.createElement('div');w.className='res-back';
 w.innerHTML='<div class="res-card"><div class="res-banner '+(o.tone||'ok')+'"><b>'+esc(o.title)+'</b></div><div class="res-body"><div class="avatar" style="background:'+(o.tone==='bad'?'#a82c2c':o.tone==='warn'?'#a86a08':'#0f6b43')+'">'+esc(initials(o.name))+'</div><h4>'+esc(o.name)+'</h4><div class="muted">'+esc(o.sub||'')+'</div><div class="rows">'+(o.rows||[]).map(r=>'<div><span>'+esc(r[0])+'</span><span>'+esc(r[1])+'</span></div>').join('')+'</div></div></div>';
 const close=()=>{clearTimeout(t);w.remove();};
 const t=setTimeout(close,o.ms||4200);
 w.onclick=close;root.appendChild(w);
};

/* ================= printing (unchanged from the demo engine) ================= */
const RCPT_CSS='.rcpt{font:12.5px/1.45 "Segoe UI",Arial,sans-serif;width:320px;margin:0 auto;color:#000;padding:8mm 6mm}'+
 '.rcpt .rhead{text-align:center;margin-bottom:2px}.rcpt h4{text-align:center;font-size:17px;margin:0 0 3px;letter-spacing:.2px}'+
 '.rcpt .c{text-align:center}.rcpt hr{border:0;border-top:1px dashed #000;margin:8px 0}'+
 '.rcpt .l{display:flex;justify-content:space-between;gap:8px;margin:2px 0}.rcpt .b{font-weight:700;font-size:14.5px}'+
 '.rcpt table{width:100%;border-collapse:collapse;margin:4px 0}'+
 '.rcpt th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid #000;padding:3px 2px 4px}'+
 '.rcpt th.n,.rcpt td.n{text-align:right}.rcpt td{padding:3px 2px;vertical-align:top;font-size:12.5px}'+
 '.rcpt .fine{font-size:10.5px;color:#333}';
K.print=html=>{
 let f=document.getElementById('printframe');if(f)f.remove();
 f=document.createElement('iframe');f.id='printframe';f.setAttribute('aria-hidden','true');
 f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';
 document.body.appendChild(f);
 try{const d=f.contentWindow.document;d.open();d.write(html);d.close();}catch(e){return;}
 setTimeout(()=>{try{f.contentWindow.focus();f.contentWindow.print();}catch(e){}},250);
};
K.poweredByText=()=>'Powered by '+C.vendorName+' — '+C.vendorPhone;
K.receiptBody=o=>{
 const st=S.settings;
 return '<div class="rcpt">'+
  '<div class="rhead"><h4>'+esc(st.org)+'</h4>'+
  (st.location?'<div class="c">'+esc(st.location)+'</div>':'')+
  (st.phone?'<div class="c">Tel: '+esc(st.phone)+'</div>':'')+
  '</div><hr>'+
  '<div class="c b">'+esc(o.title)+'</div>'+
  (o.meta||[]).map(m=>'<div class="l"><span>'+esc(m[0])+'</span><span>'+esc(m[1])+'</span></div>').join('')+'<hr>'+
  ((o.items||[]).length?'<table><thead><tr><th>Qty</th><th>Item</th><th class="n">Unit</th><th class="n">Price</th></tr></thead><tbody>'+
    (o.items||[]).map(i=>'<tr><td>'+esc(i.q)+'</td><td>'+esc(i.n)+'</td><td class="n">'+esc(i.p)+'</td><td class="n">'+esc(i.t)+'</td></tr>').join('')+
    '</tbody></table><hr>':'')+
  (o.totals||[]).map(t=>'<div class="l'+(t[2]?' b':'')+'"><span>'+esc(t[0])+'</span><span>'+esc(t[1])+'</span></div>').join('')+
  '<hr><div class="c">'+esc(o.foot||'Thank you')+'</div><div class="c fine" style="margin-top:6px">'+esc(K.poweredByText())+'</div></div>';
};
K.printReceipt=o=>K.print('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title><style>@page{margin:8mm}body{margin:0}'+RCPT_CSS+'</style></head><body>'+K.receiptBody(o)+'</body></html>');
K.showReceipt=(o,after)=>K.modal({title:'Receipt',body:K.receiptBody(o),buttons:[{l:'Close',fn:()=>{if(after)after();}},{l:'Print receipt',cls:'pri',fn:()=>{K.printReceipt(o);return false;}}]});

/* ================= generic CRUD view (unchanged from the demo engine) ================= */
K.crud=(el,d)=>{
 const st={q:'',chip:0,rng:d.range?(d.range.def||'all'):'all'};
 const RNG=[['today','Today'],['week','Last 7 days'],['month','Last 30 days'],['all','All']];
 const inRange=r=>{
  if(!d.range||st.rng==='all')return true;
  const v=String(r[d.range.key]||'').slice(0,10),t=today();
  if(st.rng==='today')return v===t;if(st.rng==='week')return v>=addDays(t,-6)&&v<=t;if(st.rng==='month')return v>=addDays(t,-29)&&v<=t;return true;
 };
 const list=()=>{
  let r=K.T(d.table).filter(inRange);
  if(d.filter)r=r.filter(d.filter);
  if(d.chips&&d.chips[st.chip]&&d.chips[st.chip].fn)r=r.filter(d.chips[st.chip].fn);
  if(st.q){const q=st.q.toLowerCase();r=r.filter(x=>(d.search||[]).some(k=>String(typeof k==='function'?k(x):(x[k]==null?'':x[k])).toLowerCase().indexOf(q)>-1));}
  if(d.sort)r=r.slice().sort(d.sort);
  return r;
 };
 const cols=d.cols.slice();
 const hasActs=!d.noEdit||!d.noDelete||(d.actions&&d.actions.length);
 const tbl=r=>{
  const c=cols.concat(hasActs?[{l:'',cls:'acts',f:row=>
   (d.actions||[]).filter(a=>!a.show||a.show(row)).map(a=>'<button class="btn sm '+(a.cls||'')+'" data-act="row" data-a="'+a.a+'" data-id="'+row.id+'">'+esc(a.l)+'</button>').join('')+
   (d.noEdit?'':'<button class="btn sm" data-act="edit" data-id="'+row.id+'">Edit</button>')+
   (d.noDelete?'':'<button class="btn sm bad" data-act="del" data-id="'+row.id+'">Delete</button>')}]:[]);
  return K.table(c,r,{empty:d.empty||'Nothing here yet',emptySub:d.emptySub||(d.noAdd?'':'Use the add button to create the first one.')});
 };
 const paintBody=()=>{const r=list();const b=el.querySelector('#cbody'),s=el.querySelector('#csum');if(b)b.innerHTML=tbl(r);if(s)s.innerHTML=d.summary?d.summary(r):'';};
 const paint=()=>{
  el.innerHTML='<div class="bar">'+(d.search?'<input class="search" data-inp="q" placeholder="'+esc(d.searchPh||'Search…')+'" value="'+esc(st.q)+'">':'')+
   (d.chips?K.chips(d.chips.map(c=>c.l),st.chip,'chip'):'')+
   (d.range?K.chips(RNG.map(x=>x[1]),RNG.findIndex(x=>x[0]===st.rng),'rng'):'')+
   '<span class="sp"></span>'+(d.topHtml||'')+(d.noAdd?'':'<button class="btn pri" data-act="add">+ '+esc(d.addLabel||'Add')+'</button>')+'</div><div id="csum"></div><div class="card tc" id="cbody"></div>';
  paintBody();
 };
 const form=(row)=>K.formModal({title:(row?'Edit ':'Add ')+(d.noun||'record'),fields:typeof d.fields==='function'?d.fields(row):d.fields,values:row||(d.defaults?d.defaults():{}),wide:d.wide,
  onSave:v=>{
   if(d.validate){const m=d.validate(v,row);if(m){K.toast(m,'bad');return false;}}
   if(row){const out=d.before?d.before(v,row):v;K.upd(d.table,row.id,out);if(d.after)d.after(K.get(d.table,row.id),false);}
   else{const out=d.before?d.before(v,null):v;const nr=K.add(d.table,out);if(d.after)d.after(nr,true);K.log('Added '+(d.noun||'record')+(nr.name?': '+nr.name:''));}
   K.toast('Saved','ok');paint();
  }});
 const ext={};Object.keys(d.on||{}).forEach(k=>{ext[k]=(id,b)=>d.on[k](id,b,paint);});
 K.bind(el,Object.assign({
  q:v=>{st.q=v;paintBody();},
  chip:i=>{st.chip=+i;paint();},
  rng:i=>{st.rng=RNG[+i][0];paint();},
  add:()=>form(null),
  edit:id=>form(K.get(d.table,id)),
  del:id=>{const row=K.get(d.table,id);K.confirm('Delete this '+(d.noun||'record')+(row&&row.name?' ('+row.name+')':'')+'? This cannot be undone.','Delete',()=>{K.del(d.table,id);if(d.afterDelete)d.afterDelete(row);K.toast('Deleted');paint();},'bad');},
  row:(id,b)=>{const a=d.actions.find(x=>x.a===b.dataset.a);if(a)a.fn(K.get(d.table,id),paint);}
 },ext));
 paint();
 return{paint};
};

/* ================= dashboard chart + list (unchanged from the demo engine) ================= */
K.barChart=(data,unit)=>{
 const W=440,H=190,pl=8,pb=26,pt=22,n=data.length,bw=(W-pl*2)/n;
 const max=Math.max(1,...data.map(x=>x.v));
 return '<div class="chart"><svg viewBox="0 0 '+W+' '+H+'" role="img">'+data.map((x,i)=>{
  const h=Math.max(2,(x.v/max)*(H-pb-pt)),x0=pl+i*bw+bw*.18,w=bw*.64,y=H-pb-h;
  return '<rect x="'+x0.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="4" fill="var(--accent)"/>'+
   '<text class="v" x="'+(x0+w/2).toFixed(1)+'" y="'+(y-6).toFixed(1)+'" text-anchor="middle">'+esc(unit==='money'?Math.round(x.v).toLocaleString('en-US'):x.v)+'</text>'+
   '<text x="'+(x0+w/2).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(x.l)+'</text>';
 }).join('')+'</svg></div>';
};
K.lastDays=(n,fn)=>{const out=[];for(let i=n-1;i>=0;i--){const d=addDays(today(),-i);out.push({l:DOW[parse(d).getDay()],d,v:fn(d)});}return out;};
K.list=(items,emptyMsg)=>items.length?'<ul class="list">'+items.map(i=>'<li><div><b>'+esc(i.t)+'</b><span>'+esc(i.s||'')+'</span></div><em>'+(i.rHtml||esc(i.r||''))+'</em></li>').join('')+'</ul>':K.empty(emptyMsg||'Nothing to show yet');
function renderDashboard(el){
 const d=GOLD.dashboard(K);
 const h=new Date().getHours();const gr=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
 const act=K.T('activity').slice(0,7).map(a=>({t:a.text,s:new Date(a.at).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}));
 el.innerHTML='<div class="hello"><div><h2>'+gr+', '+esc(firstName(user?user.name:''))+'</h2><p>'+esc(fmtDay(today()))+' · '+esc(S.settings.org)+'</p></div></div>'+
  '<div class="kpis">'+d.kpis.map(k=>'<div class="kpi '+(k.tone||'')+'"><span class="kl">'+esc(k.l)+'</span><b class="kv">'+esc(k.v)+'</b><span class="ks">'+esc(k.s||'')+'</span></div>').join('')+'</div>'+
  '<div class="grid2"><div class="card"><h3>'+esc(d.chart.title)+'</h3>'+K.barChart(d.chart.data,d.chart.unit)+'</div><div class="stack">'+
  (d.lists||[]).map(l=>'<div class="card"><h3>'+esc(l.title)+'</h3>'+K.list(l.items,l.empty)+'</div>').join('')+
  '<div class="card"><h3>Recent activity</h3>'+K.list(act,'Activity appears here as you work (this session only).')+'</div></div></div>';
}

/* ================= settings ================= */
function renderSettings(el){
 const st=S.settings;
 el.innerHTML='<div class="grid2"><div class="stack"><div class="card"><h3>Dealership details</h3><div class="fgrid">'+
  '<label class="fld full"><span>Name shown on receipts and screens</span><input id="s_org" value="'+esc(st.org)+'"></label>'+
  '<label class="fld"><span>Contact phone</span><input id="s_phone" value="'+esc(st.phone||'')+'"></label>'+
  '<label class="fld"><span>Location</span><input id="s_location" value="'+esc(st.location||'')+'"></label></div>'+
  '<div style="margin-top:14px"><button class="btn pri" data-act="save">Save changes</button></div></div>'+
  '<div class="card"><h3>Your account</h3>'+K.table([{l:'',k:'a'},{l:'',f:r=>r.b}],[
   {a:'Business',b:org.business_name},{a:'Plan',b:(org.plan_key||'—')+' / '+(org.plan_cycle||'—')},
   {a:'Subscription',b:org.subscription_status==='active'?K.badge('Active','ok'):K.badge(org.subscription_status||'Unknown','warn')},
   {a:'Renews / expires',b:org.paid_through_date?fmtDate(org.paid_through_date):'—'}
  ]).replace('<thead><tr><th class=""></th><th class=""></th></tr></thead>','')+'</div></div>'+
  '<div class="stack"><div class="card"><h3>Your data</h3><p class="muted" style="margin-bottom:12px">Everything here is stored securely online under your business account, backed up automatically. You can still download a plain copy any time.</p><button class="btn pri" data-act="backup">Download a backup (.json)</button></div>'+
  '<div class="card"><h3>Install on this device</h3><p class="muted" style="margin-bottom:12px">Add an icon for '+esc(C.name)+' so it opens like a regular app, without going through the browser address bar.</p><button class="btn pri" data-act="install">Add to desktop / home screen</button></div></div></div>';
 K.bind(el,{
  save:()=>{
   K.setting('org',el.querySelector('#s_org').value.trim()||C.name);
   K.setting('phone',el.querySelector('#s_phone').value.trim());
   K.setting('location',el.querySelector('#s_location').value.trim());
   chromeSide();K.toast('Saved','ok');
  },
  backup:()=>{const b=new Blob([JSON.stringify({app:'gold',at:new Date().toISOString(),org:org.business_name,data:S.t})],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='gold-backup-'+today()+'.json';document.body.appendChild(a);a.click();a.remove();K.toast('Backup downloaded','ok');},
  install:()=>K.installApp()
 });
}
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
K.installApp=()=>{
 if(deferredInstall){deferredInstall.prompt();deferredInstall.userChoice.finally(()=>{deferredInstall=null;});return;}
 K.modal({title:'Add '+C.name+' to your desktop',
  body:'<p>Your browser isn’t offering the one-click install here, but a shortcut is still a couple of clicks away:</p>'+
   '<ol style="margin:10px 0 0 18px;line-height:1.7">'+
   '<li>Click the <b>⋮</b> menu at the top right of the browser window.</li>'+
   '<li>Choose <b>Save and share → Create shortcut…</b> (Chrome) or <b>Apps → Install this site as an app</b> (Edge).</li>'+
   '<li>Tick <b>Open as window</b>, then click <b>Create</b>.</li></ol>',
  buttons:[{l:'Got it',cls:'pri'}]});
};

/* ================= staff (now real logins, not a demo list) ================= */
function renderStaff(el){
 const paint=()=>{
  const rows=K.T('_profiles').slice().sort((a,b)=>a.display_name.localeCompare(b.display_name));
  el.innerHTML='<div class="bar"><span class="sp"></span><button class="btn pri" data-act="add">+ Add staff</button></div>'+
   '<div class="card tc">'+K.table([
    {l:'Name',f:p=>p.display_name+(p.id===user.id?' <span class="sub2">(you)</span>':'')},
    {l:'Role',f:p=>K.badge(p.role==='owner'?'Owner':'Staff',p.role==='owner'?'info':'mute')},
    {l:'Username',k:'login_username'},{l:'Phone',f:p=>p.phone||'—'},
    {l:'Status',f:p=>K.badge(p.is_active?'Active':'Inactive',p.is_active?'ok':'mute')},
    {l:'',cls:'acts',f:p=>p.role==='owner'?'':'<button type="button" class="btn sm" data-act="tog" data-id="'+p.id+'">'+(p.is_active?'Deactivate':'Activate')+'</button>'}
   ],rows,{empty:'Just you so far'})+'</div>';
 };
 const reload=async()=>{
  const{data,error}=await sb.from('profiles').select('*').eq('org_id',org.id);
  if(!error)S.t._profiles=data;
  paint();
 };
 K.bind(el,{
  add:()=>K.formModal({title:'Add staff',fields:[
    {k:'fullName',l:'Full name',req:1,w:'full'},
    {k:'phone',l:'Phone'},
    {k:'username',l:'Username (for sign-in)',req:1,hint:'Letters/numbers only, no spaces'},
    {k:'password',l:'Temporary password',t:'password',req:1,hint:'At least 8 characters — share this with them directly'}
   ],onSave:async v=>{
    const{data,error}=await sb.functions.invoke('create-staff',{body:v});
    if(error||(data&&data.error)){K.toast((data&&data.error)||error.message||'Could not add staff','bad');return false;}
    K.toast('Staff account created','ok');await reload();
   }}),
  tog:async id=>{
   const p=K.T('_profiles').find(x=>x.id===id);if(!p)return;
   const{error}=await sb.from('profiles').update({is_active:!p.is_active}).eq('id',id);
   if(error){K.toast('Could not update that account','bad');return;}
   p.is_active=!p.is_active;K.toast('Updated','ok');paint();
  }
 });
 reload();
}

/* ================= shell ================= */
function allowed(n){return !n.roles||!user||n.roles.includes(user.role);}
const NAV_BASE=[{id:'dashboard',label:'Overview',icon:'home'},
 {id:'purchase',label:'Buy Gold',icon:'cart'},
 {id:'cash',label:'Cash & Balances',icon:'cash',roles:['owner']},
 {id:'stock',label:'Gold Stock',icon:'box',roles:['owner']},
 {id:'sellers',label:'Sellers',icon:'users',roles:['owner']},
 {id:'staff',label:'Staff',icon:'list',roles:['owner']},
 {id:'ledger',label:'Ledger',icon:'chart',roles:['owner']},
 {id:'settings',label:'Settings',icon:'gear',roles:['owner']}];
function navItems(){return NAV_BASE.filter(allowed);}
function homeFor(){return user&&user.role==='staff'?'purchase':'dashboard';}
function titleOf(id){const n=NAV_BASE.find(x=>x.id===id);return n?n.label:'';}
function chromeSide(){
 const s=document.getElementById('side');
 s.innerHTML='<div class="brand"><div class="mono">'+esc(initials(S.settings.org))+'</div><div><b>'+esc(S.settings.org)+'</b><small>'+esc(C.product)+'</small></div></div><nav class="nav" aria-label="Main">'+
  navItems().map(n=>'<button type="button" data-nav="'+n.id+'" class="'+(n.id===cur?'on':'')+'">'+K.icon(n.icon)+'<span>'+esc(n.label)+'</span></button>').join('')+'</nav>'+
  '<div class="foot"><div><b>'+esc(user?user.name:'')+'</b><span>'+esc(user&&user.role==='owner'?'Owner':'Staff')+'</span></div><button type="button" data-act="logout">Sign out</button></div>';
 s.onclick=e=>{const b=e.target.closest('[data-nav]');if(b){go(b.dataset.nav);return;}if(e.target.closest('[data-act="logout"]')){signOut();}};
}
function chromeTop(){
 const t=document.getElementById('top');if(!t)return;
 t.innerHTML='<h1>'+esc(titleOf(cur))+'</h1><div class="r"><span class="net'+(navigator.onLine?' on':'')+'" style="pointer-events:none"><span class="dot"></span>'+(navigator.onLine?'Online':'No connection')+'</span></div>';
}
function chromeAll(){chromeSide();chromeTop();}
function go(id){
 const navDef=NAV_BASE.find(n=>n.id===id);
 if(navDef&&!allowed(navDef))id=homeFor();
 cur=id;chromeAll();
 const el=document.getElementById('view');
 el.onclick=el.onchange=el.oninput=null;
 try{
  if(id==='dashboard')renderDashboard(el);else if(id==='settings')renderSettings(el);else if(id==='staff')renderStaff(el);
  else GOLD.views[id](el,K);
 }catch(e){console.error(e);el.innerHTML='<div class="card"><h3>Something went wrong</h3><p class="muted">'+esc(e&&e.message)+'</p></div>';}
 window.scrollTo(0,0);
}
K.go=go;

/* ================= auth / boot ================= */
const CACHE_KEY='nyansatek_gold_cache';
function cacheBoot(){try{localStorage.setItem(CACHE_KEY,JSON.stringify({user,org,t:S.t,at:Date.now()}));}catch(e){}}
function loadCachedBoot(uid){
 try{
  const c=JSON.parse(localStorage.getItem(CACHE_KEY));
  if(c&&c.user&&c.user.id===uid&&Date.now()-c.at<1000*60*60*24*7)return c; // trust a cached session for up to 7 days offline
 }catch(e){}
 return null;
}
async function fetchTenantData(orgId){
 const names=Object.keys(ADAPTERS);
 const results=await Promise.all(names.map(n=>sb.from(ADAPTERS[n].table).select('*').eq('org_id',orgId)));
 const t={activity:[]};
 names.forEach((n,i)=>{
  const{data,error}=results[i];
  if(error)throw error;
  t[n]=(data||[]).map(ADAPTERS[n].toApp);
 });
 return t;
}
function buildSettings(orgRow){
 return{org:orgRow.business_name,phone:orgRow.phone||'',location:orgRow.location||'',
  poundRate:Number(orgRow.pound_rate),bladeRate:Number(orgRow.blade_rate),resaleRate:Number(orgRow.resale_rate),
  worldGoldUsdOz:Number(orgRow.world_gold_usd_oz),usdGhsRate:Number(orgRow.usd_ghs_rate)};
}
async function boot(session){
 const{data:profile,error:profErr}=await sb.from('profiles').select('*').eq('id',session.user.id).maybeSingle();
 if(profErr||!profile)throw profErr||new Error('No profile found for this account');
 if(profile.role==='master'){
  await signOut();
  K.toast('The cross-business admin console isn’t part of this app yet — sign in with a dealership account instead.','bad');
  return;
 }
 const{data:orgRow,error:orgErr}=await sb.from('organizations').select('*').eq('id',profile.org_id).maybeSingle();
 if(orgErr||!orgRow)throw orgErr||new Error('No business found for this account');
 if(orgRow.is_active===false||orgRow.subscription_status==='suspended'){
  document.getElementById('app').hidden=true;
  const l=document.getElementById('login');l.hidden=false;
  l.innerHTML='<div class="login-r" style="grid-column:1/-1;display:grid;place-items:center"><div class="login-card"><h2>Account suspended</h2><p class="sub">Your subscription needs to be renewed to continue. Contact '+esc(C.vendorName)+' at '+esc(C.vendorPhone)+'.</p><button class="btn pri" id="suspend-signout">Sign out</button></div></div>';
  document.getElementById('suspend-signout').onclick=signOut;
  return;
 }
 org=orgRow;
 user={id:profile.id,name:profile.display_name||profile.full_name||profile.login_username||'User',role:profile.role};
 const t=await fetchTenantData(org.id);
 S={t,settings:buildSettings(org)};
 cacheBoot();
 enterApp();
}
async function bootFromCache(uid){
 const c=loadCachedBoot(uid);
 if(!c)return false;
 org=c.org;user=c.user;S={t:c.t,settings:buildSettings(c.org)};
 K.toast('Offline — showing your last saved data from this device','warn');
 enterApp();
 return true;
}
function enterApp(){
 document.getElementById('login').hidden=true;document.getElementById('app').hidden=false;
 cur='dashboard';go(homeFor());
}
async function signOut(){
 try{await sb.auth.signOut();}catch(e){}
 try{localStorage.removeItem(CACHE_KEY);}catch(e){}
 user=null;org=null;S=null;
 document.getElementById('app').hidden=true;
 showLogin();
}
function showLogin(msg){
 document.getElementById('app').hidden=true;
 const l=document.getElementById('login');l.hidden=false;
 l.innerHTML='<div class="login-l"><div><div class="mono">NG</div><h1>NYANSATEK Gold</h1><p class="tag">'+esc(C.tagline)+'</p></div><ul><li><i></i>Your records are backed up automatically, under your own account</li><li><i></i>Staff get their own logins with their own access</li><li><i></i>Works from a phone, tablet, or the shop computer</li></ul></div>'+
  '<div class="login-r"><form class="login-card" id="lf"><h2>Sign in</h2><p class="sub">Use your business name (owner) or your staff username.</p>'+
  '<label class="fld" style="margin-bottom:12px"><span>Business name or username</span><input id="lu" type="text" autocomplete="username"></label>'+
  '<label class="fld"><span>Password</span><div class="pwwrap"><input id="lp" type="password" autocomplete="current-password"><button type="button" class="pwtoggle" data-pwtoggle="lp">Show</button></div></label>'+
  '<button class="btn pri" type="submit" style="margin-top:14px">Sign in</button>'+
  '<p id="lerr" class="demo" style="display:'+(msg?'block':'none')+';color:#c0392b">'+esc(msg||'')+'</p></form></div>';
 l.onclick=e=>{const pt=e.target.closest('[data-pwtoggle]');if(!pt)return;const inp=document.getElementById(pt.dataset.pwtoggle);if(inp){const show=inp.type==='password';inp.type=show?'text':'password';pt.textContent=show?'Hide':'Show';}};
 document.getElementById('lf').onsubmit=async e=>{
  e.preventDefault();
  const err=document.getElementById('lerr');err.style.display='none';
  const nameOrUser=document.getElementById('lu').value.trim();
  const pass=document.getElementById('lp').value;
  const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;btn.textContent='Signing in…';
  try{
   let loginEmail=null;
   const{data:row}=await sb.from('login_lookup').select('login_email').ilike('business_name',nameOrUser).maybeSingle();
   loginEmail=row&&row.login_email;
   if(!loginEmail){
    const{data:staffRow}=await sb.from('staff_login_lookup').select('login_email').ilike('login_username',nameOrUser).maybeSingle();
    loginEmail=staffRow&&staffRow.login_email;
   }
   if(!loginEmail)throw new Error('Business name / username or password is incorrect.');
   const{error:ae}=await sb.auth.signInWithPassword({email:loginEmail,password:pass});
   if(ae)throw new Error('Business name / username or password is incorrect.');
   const{data:{session}}=await sb.auth.getSession();
   await boot(session);
  }catch(x){err.textContent=x.message||'Could not sign in';err.style.display='block';}
  finally{btn.disabled=false;btn.textContent='Sign in';}
 };
}
(async function init(){
 try{
  const{data:{session}}=await sb.auth.getSession();
  if(session){
   try{await boot(session);}
   catch(e){
    console.error(e);
    const ok=await bootFromCache(session.user.id);
    if(!ok)showLogin('Could not load your account — check your connection and try again.');
   }
  }else{
   showLogin();
  }
 }catch(e){console.error(e);showLogin();}
})();
window.addEventListener('online',()=>{if(cur)chromeTop();});
window.addEventListener('offline',()=>{if(cur)chromeTop();});

/* ============================================================
   Gold-specific pricing + views — carried over from the verified
   offline demo (v_gold.js) with NO changes to the pricing math,
   karat chart, or cash-float logic. Only the storage calls
   (K.T/K.add/K.upd/K.del/K.setting/K.get) changed meaning above;
   this code below is unaware of Supabase at all.
   ============================================================ */
const r2=n=>Math.round(n*100)/100;
const T=K.T,add=K.add,upd=K.upd,get=K.get,badge=K.badge;
// Truncate (never round) to n decimals — the real Gold App chops digits at every step.
const trunc=(x,n)=>{const f=Math.pow(10,n);return Math.floor(Number((x*f).toFixed(6)))/f;};

// ---- The Royal Ama Yaba Ent. Gold Karat Chart ----
const KCHART=[
20.17,20.19,20.21,20.22,20.24,20.26,20.28,20.30,20.32,20.34,20.36,20.38,20.40,20.41,20.43,20.45,20.47,20.49,20.51,20.53,20.55,20.57,20.58,20.60,20.62,20.64,20.66,20.68,20.70,20.71,20.73,20.75,20.77,20.79,20.81,20.83,20.84,20.86,20.88,20.90,20.92,20.94,20.95,20.97,
20.99,21.01,21.03,21.05,21.06,21.08,21.10,21.12,21.14,21.15,21.17,21.19,21.21,21.23,21.24,21.26,21.28,21.30,21.32,21.33,21.35,21.37,21.39,21.41,21.42,21.44,21.46,21.48,21.49,21.51,21.53,21.55,21.56,21.58,21.60,21.62,21.63,21.65,21.67,21.69,21.70,21.72,21.74,21.76,
21.77,21.79,21.81,21.83,21.84,21.86,21.88,21.90,21.91,21.93,21.95,21.96,21.98,22.00,22.02,22.03,22.05,22.07,22.08,22.10,22.12,22.13,22.15,22.17,22.19,22.20,22.22,22.24,22.25,22.27,22.29,22.30,22.32,22.34,22.35,22.37,22.39,22.40,22.42,22.44,22.45,22.47,22.49,22.50,
22.52,22.54,22.55,22.57,22.59,22.60,22.62,22.64,22.65,22.67,22.68,22.70,22.72,22.73,22.75,22.77,22.78,22.80,22.82,22.83,22.85,22.86,22.88,22.90,22.91,22.93,22.94,22.96,22.98,22.99,23.01,23.02,23.04,23.06,23.07,23.09,23.10,23.12,23.14,23.15,23.17,23.18,23.20,23.22,
23.23,23.25,23.26,23.28,23.29,23.31,23.33,23.34,23.36,23.37,23.39,23.40,23.42,23.44,23.45,23.47,23.48,23.50,23.51,23.53,23.54,23.56,23.57,23.59,23.61,23.62,23.64,23.65,23.67,23.68,23.70,23.71,23.73,23.74,23.76,23.77,23.79,23.80,23.82,23.83,23.85,23.86,23.88,23.89,23.91,23.92,23.94,23.95,23.97,23.98,24.00
];
const KCHART_MIN=17.00,KCHART_MAX=19.26;
const lookupKarat=idx=>{
 idx=trunc(idx,2);
 if(idx<KCHART_MIN)return{karat:KCHART[0],flag:'below chart — very low purity, please double-check'};
 if(idx>KCHART_MAX)return{karat:24.00,flag:null};
 const pos=Math.min(KCHART.length-1,Math.max(0,Math.round((idx-KCHART_MIN)*100)));
 return{karat:KCHART[pos],flag:null};
};
const rates=()=>({pound:Number(K.setting('poundRate'))||0,blade:Number(K.setting('bladeRate'))||0,resale:Number(K.setting('resaleRate'))||0});

function refinedCalc(grams,density,rt){
 grams=Number(grams)||0;density=Number(density)||0;
 if(grams<=0||density<=0)return null;
 const pounds=trunc(grams/7.75,2);
 const karatIndex=trunc(grams/density,2);
 const look=lookupKarat(karatIndex);
 const karat=look.karat;
 const factor=karat>=23?1:trunc(karat/23,2);
 const adjRate=r2(rt.pound*factor);
 const amount=r2(pounds*adjRate);
 return{kind:'refined',grams,density,pounds,karatIndex,karat,factor,adjRate,amount,poundEq:pounds,flag:look.flag};
}
function boxCalc(grams,rt){
 grams=Number(grams)||0;
 if(grams<=0)return null;
 const bladeEq=trunc(grams/0.8,1);
 const amount=r2(bladeEq*rt.blade);
 return{kind:'box',grams,bladeEq,amount,poundEq:r2(bladeEq/10)};
}
const fmtLb=n=>trunc(n,2).toFixed(2)+' lb-eq';
const sellerOf=id=>get('sellers',id)||{name:'Walk-in seller',phone:''};
const sellerOpts=()=>T('sellers').map(s=>({v:s.id,l:s.name+(s.phone?' ('+s.phone+')':'')}));
const stockPoundEq=()=>r2(sum(T('purchases'),x=>x.poundEq)-sum(T('dispatches'),x=>x.poundEq));
const stockByKind=()=>({
 refined:r2(sum(T('purchases').filter(x=>x.kind==='refined'),x=>x.poundEq)-sum(T('dispatches').filter(x=>x.kind==='refined'),x=>x.poundEq)),
 box:r2(sum(T('purchases').filter(x=>x.kind==='box'),x=>x.poundEq)-sum(T('dispatches').filter(x=>x.kind==='box'),x=>x.poundEq))
});
const pl=n=>'<span style="color:'+(n<0?'var(--bad)':'var(--ok)')+';font-weight:700">'+money(n)+'</span>';
const out=n=>'<span style="color:var(--bad);font-weight:700">'+money(n)+'</span>';
const row2=(label,val,bold)=>'<div style="display:flex;justify-content:space-between;gap:10px;margin:4px 0'+(bold?';font-weight:800;font-size:16px':'')+'"><span>'+label+'</span><span>'+val+'</span></div>';

const floatIn=(d)=>sum(T('cashfloat').filter(x=>!d||x.date===d),x=>x.amount)+sum(T('dispatches').filter(x=>!d||x.date===d),x=>x.revenue);
const floatOut=(d)=>sum(T('purchases').filter(x=>!d||x.date===d),x=>x.amount)+sum(T('expenses').filter(x=>!d||x.date===d),x=>x.amount);
const floatBalance=()=>r2(floatIn()-floatOut());
function allDates(){
 const s=new Set();
 ['cashfloat','purchases','dispatches','expenses'].forEach(t=>T(t).forEach(x=>s.add(x.date)));
 return Array.from(s).sort();
}
function dailyBalances(){
 const days=allDates();let opening=0;const rows=[];
 days.forEach(d=>{
  const inn=r2(floatIn(d)),outt=r2(floatOut(d)),closing=r2(opening+inn-outt);
  rows.push({date:d,opening:r2(opening),in:inn,out:outt,closing});
  opening=closing;
 });
 return rows;
}

const purchaseReceipt=row=>{
 const s=sellerOf(row.sellerId);
 if(row.kind==='refined')return{title:'Gold purchase receipt — Refined',
  meta:[['Receipt No.',row.ref],['Date',fmtDate(row.date)+' '+row.time],['Seller',s.name],['Weighed by',row.weigher||'—']],
  items:[],
  totals:[['Weight',row.grams+' g'],['Density',row.density],['Karat (chart)',row.karat.toFixed(2)],['Weight — Pounds',row.pounds.toFixed(2)+' lb'],['Amount paid',money(row.amount),1]],
  foot:'Thank you for your business'};
 return{title:'Gold purchase receipt — Box (raw)',
  meta:[['Receipt No.',row.ref],['Date',fmtDate(row.date)+' '+row.time],['Seller',s.name],['Weighed by',row.weigher||'—']],
  items:[],
  totals:[['Weight',row.grams+' g'],['Blade-equivalent',row.bladeEq.toFixed(1)],['Amount paid',money(row.amount),1]],
  foot:'Thank you for your business'};
};

const KCHART_MODAL=()=>{
 const rowsHtml=KCHART.map((k,i)=>{const d=r2(KCHART_MIN+i*0.01);return '<tr><td>'+d.toFixed(2)+'</td><td>'+k.toFixed(2)+'</td></tr>';}).join('');
 K.modal({title:'Gold Karat Chart — Royal Ama Yaba Ent.',wide:true,
  body:'<p class="muted small" style="margin-bottom:8px">Density (from the water test) on the left, the karat it corresponds to on the right.</p>'+
   '<div style="max-height:60vh;overflow:auto"><table style="width:100%;border-collapse:collapse"><thead style="position:sticky;top:0;background:#fff"><tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)">Density</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)">Karat</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div>',
  buttons:[{l:'Close'}]});
};

// ---- World gold market tracker ----
// Backed by a real feed: the world-gold-price Supabase Edge Function proxies
// MetalAPI (XAU/USD) + open.er-api.com (USD/GHS), keeping the API key off
// the client. fetchLiveMarket() pulls a fresh anchor each time the Stock
// view opens; between fetches, a small cosmetic random-walk (seedMarketHist/
// marketTick) keeps the chart feeling alive without pretending every 2.2s
// tick is a new real quote. If the live fetch fails (no connection, secret
// not configured yet, etc.) it falls back to the owner's manual anchor
// below, same as before.
const OZ_TO_GRAMS=31.1035;
let marketHist=null,marketTimer=null,marketLive=false,marketAsOf=null;
const stopMarketTicker=()=>{if(marketTimer){clearInterval(marketTimer);marketTimer=null;}};
const seedMarketHist=()=>{
 const s=S.settings;let usdOz=Number(s.worldGoldUsdOz)||2650,ghs=Number(s.usdGhsRate)||15.3;
 marketHist=[];
 for(let i=20;i>=0;i--){usdOz=r2(usdOz*(1+(Math.random()-0.5)*0.0016));ghs=r2(Math.max(1,ghs*(1+(Math.random()-0.5)*0.0008)));marketHist.push({usdOz,ghs});}
};
const fetchLiveMarket=async()=>{
 try{
  const{data,error}=await sb.functions.invoke('world-gold-price');
  if(error||!data||!data.usdOz||!data.usdGhs)throw error||new Error('bad response');
  K.setting('worldGoldUsdOz',data.usdOz);K.setting('usdGhsRate',data.usdGhs);
  marketLive=true;marketAsOf=data.asOf;
  seedMarketHist();
  return true;
 }catch(e){
  marketLive=false;marketAsOf=null;
  return false;
 }
};
const marketTick=()=>{
 if(!marketHist)seedMarketHist();
 const last=marketHist[marketHist.length-1];
 const usdOz=Math.max(500,r2(last.usdOz*(1+(Math.random()-0.5)*0.0016)));
 const ghs=Math.max(1,r2(last.ghs*(1+(Math.random()-0.5)*0.0008)));
 marketHist.push({usdOz,ghs});
 if(marketHist.length>36)marketHist.shift();
 return marketHist[marketHist.length-1];
};
const marketDerived=pt=>{
 const usdPerGram=r2(pt.usdOz/OZ_TO_GRAMS);
 const ghsPerGram=r2(usdPerGram*pt.ghs);
 const ghsPerPound=r2(ghsPerGram*7.75);
 return{usdPerGram,ghsPerGram,ghsPerPound};
};

const GOLD={
 views:{
  purchase(el){
   stopMarketTicker();
   const st={kind:'refined'};
   const readGrams=()=>Number(el.querySelector('#pf_grams').value)||0;
   const readDensity=()=>Number(el.querySelector('#pf_density').value)||0;
   const calcNow=()=>st.kind==='refined'?refinedCalc(readGrams(),readDensity(),rates()):boxCalc(readGrams(),rates());
   const paintPreview=()=>{
    const c=calcNow();const box=el.querySelector('#pf_preview');
    if(!c){box.innerHTML=K.empty('Enter a weight above zero to see the price');return;}
    if(c.kind==='refined'){
     box.innerHTML=row2('Weight in pounds','<b>'+c.pounds.toFixed(2)+' lb</b>')+
      row2('Karat index (grams ÷ density)',c.karatIndex.toFixed(2))+
      row2('Karat (from chart)','<b>'+c.karat.toFixed(2)+'</b>'+(c.flag?' <span style="color:var(--bad)">— '+esc(c.flag)+'</span>':''))+
      (c.factor<1?row2('Below 23k — rate factor',c.factor.toFixed(2)+' ('+c.karat.toFixed(2)+' ÷ 23)'):row2('23k or above','full market rate applies'))+
      row2('Adjusted pound rate',money(c.adjRate))+
      '<hr style="border:0;border-top:1px dashed var(--line);margin:8px 0">'+
      row2('Amount to pay seller',money(c.amount),1);
    }else{
     box.innerHTML=row2('Blade-equivalent (grams ÷ 0.8)','<b>'+c.bladeEq.toFixed(1)+'</b>')+
      row2('Priced at blade rate','<b>'+money(rates().blade)+'</b> — no karat test for raw/box gold')+
      '<hr style="border:0;border-top:1px dashed var(--line);margin:8px 0">'+
      row2('Amount to pay seller',money(c.amount),1);
    }
   };
   const paintLists=()=>{
    const rows=T('purchases').slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
    const todayRows=rows.filter(x=>x.date===today());
    el.querySelector('#plist').innerHTML=K.list(todayRows.slice(0,8).map(x=>({t:sellerOf(x.sellerId).name+' — '+(x.kind==='refined'?'Refined':'Box'),s:(x.kind==='refined'?x.grams+'g @ '+x.karat.toFixed(2)+'k':x.grams+'g box')+' · '+x.time,r:money(x.amount)})),'No purchases recorded yet today.');
    el.querySelector('#pstocksum').innerHTML=row2('Total gold held','<b>'+fmtLb(stockPoundEq())+'</b>',1)+row2('Cash float remaining today',money(floatBalance()));
    el.querySelector('#ptab').innerHTML=K.table([
     {l:'Ref',k:'ref'},{l:'Seller',f:x=>sellerOf(x.sellerId).name},{l:'Type',f:x=>badge(x.kind==='refined'?'Refined':'Box',x.kind==='refined'?'info':'mute')},
     {l:'Weight',f:x=>x.grams+' g'},{l:'Paid',cls:'num',f:x=>money(x.amount)},
     {l:'',cls:'acts',f:x=>'<button type="button" class="btn sm" data-act="reprint" data-id="'+x.id+'">Reprint</button>'}
    ],rows.slice(0,10),{empty:'No purchases yet'});
   };
   const draw=()=>{
    el.innerHTML='<div class="grid2"><div class="stack">'+
     '<div class="card"><div class="bar" style="margin-bottom:4px"><h3 style="margin:0">Weigh in gold from a seller</h3><span class="sp"></span><button type="button" class="btn sm" data-act="chart">View karat chart</button></div>'+
      K.chips(['Refined','Box (raw/crude)'],st.kind==='refined'?0:1,'kind')+
      '<label class="fld full" style="margin:10px 0"><span>Seller</span><select id="pf_seller"><option value="">Walk-in seller</option>'+
       sellerOpts().map(o=>'<option value="'+esc(o.v)+'">'+esc(o.l)+'</option>').join('')+'</select></label>'+
      '<div style="display:grid;grid-template-columns:repeat('+(st.kind==='refined'?2:1)+',1fr);gap:12px">'+
       '<label class="fld"><span>Weight (grams)</span><input id="pf_grams" type="number" min="0" step="0.01" value="" data-inp="wg" placeholder="e.g. 8.63"></label>'+
       (st.kind==='refined'?'<label class="fld"><span>Density (water test)</span><input id="pf_density" type="number" min="0" step="0.01" value="" data-inp="wd" placeholder="e.g. 0.47"></label>':'')+
      '</div>'+
      '<div class="card" id="pf_preview" style="background:var(--paper);margin:14px 0"></div>'+
      '<button class="btn acc lg" style="width:100%" data-act="record">Record purchase &amp; pay seller</button>'+
     '</div>'+
     '<div class="card" style="margin-top:16px"><h3>Today’s purchases</h3><div id="plist"></div></div>'+
     '</div><div class="stack">'+
     '<div class="card"><h3>Gold in stock right now</h3><div id="pstocksum"></div></div>'+
     '<div class="card"><h3>Recent purchases</h3><div id="ptab"></div></div>'+
     '</div></div>';
    paintPreview();paintLists();
   };
   function record(){
    const c=calcNow();
    if(!c){K.toast(st.kind==='refined'?'Enter both weight and density':'Enter a weight greater than zero','bad');return;}
    const sellerId=el.querySelector('#pf_seller').value;
    const n=T('purchases').length+1;
    const rowRec=add('purchases',Object.assign({ref:'GP-'+pad(n,4),date:today(),time:nowTime(),sellerId:sellerId||'',weigher:K.user().name},c));
    K.log('Bought '+(c.kind==='refined'?'refined':'box')+' gold ('+c.grams+'g) from '+sellerOf(sellerId).name+' — paid '+money(c.amount));
    el.querySelector('#pf_grams').value='';const dEl=el.querySelector('#pf_density');if(dEl)dEl.value='';
    paintPreview();paintLists();
    K.showReceipt(purchaseReceipt(rowRec));
   }
   K.bind(el,{wg:paintPreview,wd:paintPreview,
    kind:i=>{st.kind=+i===0?'refined':'box';draw();},
    record:()=>record(),chart:()=>KCHART_MODAL(),
    reprint:id=>{const rowRec=get('purchases',id);if(rowRec)K.printReceipt(purchaseReceipt(rowRec));}});
   draw();
  },

  cash(el){
   stopMarketTicker();
   const draw=()=>{
    const days=dailyBalances().slice().reverse();
    const todayRow=days.find(d=>d.date===today())||{opening:days[0]?days[0].closing:0,in:0,out:0,closing:floatBalance()};
    el.innerHTML='<div class="grid2"><div class="stack">'+
     '<div class="card"><h3>Today</h3>'+K.strip([
       ['Opening balance',money(todayRow.opening!=null?todayRow.opening:0)],
       ['Cash received today',money(floatIn(today()))],
       ['Paid out today',out(floatOut(today())),'raw'],
       ['Closing balance (running)',money(floatBalance()),'raw']
      ])+
      '<div class="bar" style="margin-top:12px"><span class="sp"></span><button class="btn pri" data-act="newcash">Record cash received</button></div></div>'+
     '<div class="card"><h3>Daily opening &amp; closing balance</h3>'+K.table([
       {l:'Date',f:d=>fmtDate(d.date)},{l:'Opening',cls:'num',f:d=>money(d.opening)},{l:'Received',cls:'num',f:d=>money(d.in)},{l:'Paid out',cls:'num',f:d=>money(d.out)},{l:'Closing',cls:'num',f:d=>money(d.closing)}
      ],days,{empty:'No cash activity yet'})+'</div>'+
     '</div><div class="stack">'+
     '<div class="card"><h3>Cash float received</h3><p class="muted small" style="margin-bottom:10px">Cash sent down to buy gold with — usually on Tuesdays.</p>'+K.table([
       {l:'Date',f:x=>fmtDate(x.date)},{l:'Amount',cls:'num',f:x=>money(x.amount)},{l:'Note',k:'note'}
      ],T('cashfloat').slice().sort((a,b)=>b.date.localeCompare(a.date)),{empty:'No cash float recorded yet'})+'</div>'+
     '</div></div>';
   };
   K.bind(el,{
    newcash:()=>K.formModal({title:'Record cash received',fields:[
      {k:'date',l:'Date',t:'date',req:1,def:today()},
      {k:'amount',l:'Amount (GH₵)',t:'number',step:'0.01',req:1},
      {k:'note',l:'Note',w:'full',def:'Weekly float'}
     ],onSave:v=>{add('cashfloat',{date:v.date,amount:Number(v.amount),note:v.note});K.log('Cash float received: '+money(v.amount));K.toast('Recorded','ok');draw();}})
   });
   draw();
  },

  stock(el){
   stopMarketTicker();
   const readD=()=>Number(el.querySelector('#df_poundeq').value)||0;
   const readKind=()=>el.querySelector('#df_kind').value||'refined';
   const paintDispatchPreview=()=>{
    const rt=rates();const w=readD();const rev=r2(w*rt.resale);const avail=stockByKind()[readKind()];
    el.querySelector('#df_preview').innerHTML=row2('Available in that pile',fmtLb(avail))+row2('Expected revenue',money(rev),1);
   };
   const paintDispatches=()=>{
    el.querySelector('#dtab').innerHTML=K.table([
     {l:'Ref',k:'ref'},{l:'Date',f:x=>fmtDate(x.date)},{l:'To',k:'to'},{l:'From',f:x=>badge(x.kind==='refined'?'Refined':'Box',x.kind==='refined'?'info':'mute')},{l:'Weight',f:x=>fmtLb(x.poundEq)},{l:'Revenue',cls:'num',f:x=>money(x.revenue)}
    ],T('dispatches').slice().reverse(),{empty:'No dispatches recorded yet'});
   };
   const paintRateHistory=()=>{
    const hist=T('rateHistory').slice().sort((a,b)=>a.date.localeCompare(b.date));
    el.querySelector('#ratechart').innerHTML=hist.length?K.barChart(hist.map(h=>({l:fmtDate(h.date).slice(0,6),v:h.poundRate})),'money'):K.empty('No rate changes logged yet');
   };
   const paintMarket=()=>{
    const box=el.querySelector('#marketbox');if(!box)return;
    const pt=marketHist[marketHist.length-1];const d=marketDerived(pt);
    const rt=rates();const spread=r2(rt.pound-d.ghsPerPound);const spreadPct=d.ghsPerPound>0?r2(spread/d.ghsPerPound*100):0;
    const badgeEl=el.querySelector('#marketbadge');
    if(badgeEl)badgeEl.outerHTML=marketLive?'<span class="badge b-ok" id="marketbadge" style="font-weight:600" title="'+esc(marketAsOf||'')+'">live</span>':'<span class="badge b-mute" id="marketbadge" style="font-weight:600">simulated</span>';
    box.innerHTML=K.strip([
      ['World gold price','$'+pt.usdOz.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' / oz'],
      ['USD ⇄ GHS',pt.ghs.toFixed(2)],
      ['World price / gram','$'+d.usdPerGram.toFixed(2)+' ≈ '+money(d.ghsPerGram)],
      ['World equivalent / pound-unit',money(d.ghsPerPound)]
     ])+row2('Your buying rate vs. world equivalent',(spread>=0?'<span style="color:var(--ok)">+':'<span style="color:var(--bad)">')+money(spread)+' ('+spreadPct+'%)</span>',1)+
     '<div id="marketchart" style="margin-top:8px"></div>'+
     (marketLive?'<p class="muted small" style="margin-top:8px">Live gold + forex feed, refreshed when you open this page. Small moves between refreshes are a cosmetic animation, not new quotes.</p>'
                :'<p class="muted small" style="margin-top:8px">Live feed unavailable right now (check the connection or the price-feed setup) — showing a simulation around your anchor values below. Correct them to match today’s actual print in the meantime.</p>');
    el.querySelector('#marketchart').innerHTML=K.barChart(marketHist.slice(-14).map((x,i)=>({l:'',v:x.ghs*x.usdOz/OZ_TO_GRAMS})),'money');
   };
   const tick=()=>{
    if(!el.querySelector('#marketbox')){stopMarketTicker();return;}
    marketTick();paintMarket();
   };
   const draw=()=>{
    const stn=stockPoundEq();const byKind=stockByKind();const rt=rates();
    el.innerHTML='<div class="grid2"><div class="stack">'+
     '<div class="card"><h3>Gold in stock</h3><div class="kpis" style="grid-template-columns:repeat(3,1fr)">'+
      '<div class="kpi"><span class="kl">Total</span><b class="kv">'+fmtLb(stn)+'</b></div>'+
      '<div class="kpi"><span class="kl">Refined</span><b class="kv">'+fmtLb(byKind.refined)+'</b></div>'+
      '<div class="kpi"><span class="kl">Box</span><b class="kv">'+fmtLb(byKind.box)+'</b></div>'+
      '</div>'+
      '<p class="muted small" style="margin-top:10px">Refined purchases already come in pounds; Box purchases convert at 10 blade-equivalents = 1 pound-equivalent, so both sit on one scale — dispatches are tagged by pile, so the split above is exact, not estimated.</p></div>'+
     '<div class="card"><h3>Dispatch / sell gold onward</h3>'+
      '<label class="fld" style="margin-bottom:10px"><span>From stock</span><select id="df_kind" data-chg="dkind"><option value="refined">Refined ('+fmtLb(byKind.refined)+')</option><option value="box">Box ('+fmtLb(byKind.box)+')</option></select></label>'+
      '<label class="fld"><span>Weight to dispatch (pound-equivalent)</span><input id="df_poundeq" type="number" min="0" step="0.01" value="0" data-inp="dwp"></label>'+
      '<label class="fld full" style="margin:10px 0"><span>Sold to</span><input id="df_to" placeholder="e.g. Precious Metals Refinery"></label>'+
      '<div class="card" id="df_preview" style="background:var(--paper);margin-bottom:12px"></div>'+
      '<button class="btn acc lg" style="width:100%" data-act="dispatch">Record dispatch</button>'+
     '</div>'+
     '</div><div class="stack">'+
     '<div class="card"><h3>World Gold Market <span class="badge b-mute" id="marketbadge" style="font-weight:600">checking…</span></h3><div id="marketbox"></div>'+
      '<div class="fgrid" style="margin-top:12px">'+
       '<label class="fld"><span>Anchor: world price (USD/oz)</span><input id="mk_oz" type="number" step="0.01" value="'+(K.setting('worldGoldUsdOz'))+'"></label>'+
       '<label class="fld"><span>Anchor: USD → GHS rate</span><input id="mk_fx" type="number" step="0.01" value="'+(K.setting('usdGhsRate'))+'"></label>'+
      '</div>'+
      '<button class="btn sm" style="margin-top:8px" data-act="resetmarket">Reset live feed to these anchors</button>'+
     '</div>'+
     '<div class="card"><h3>Buying &amp; resale rates</h3>'+
      '<label class="fld" style="margin-bottom:10px"><span>Rate per Pound (GH₵)</span><input id="rf_pound" type="number" step="0.01" value="'+rt.pound+'"></label>'+
      '<label class="fld" style="margin-bottom:10px"><span>Rate per Blade (GH₵)</span><input id="rf_blade" type="number" step="0.01" value="'+rt.blade+'"></label>'+
      '<label class="fld"><span>Resale rate per pound-equivalent (GH₵)</span><input id="rf_resale" type="number" step="0.01" value="'+rt.resale+'"></label>'+
      '<button class="btn pri" style="margin-top:12px" data-act="saverates">Save rates</button>'+
     '</div>'+
     '<div class="card"><h3>Your rate history</h3><div id="ratechart"></div></div>'+
     '<div class="card"><h3>Recent dispatches</h3><div id="dtab"></div></div>'+
     '</div></div>';
    paintDispatchPreview();paintDispatches();paintRateHistory();
    if(!marketHist)seedMarketHist();
    paintMarket();
    fetchLiveMarket().then(()=>{if(el.querySelector('#marketbox'))paintMarket();});
    stopMarketTicker();marketTimer=setInterval(tick,2200);
   };
   function dispatch(){
    const rt=rates();const w=readD();const kind=readKind();
    if(w<=0){K.toast('Enter a weight greater than zero','bad');return;}
    if(w>stockByKind()[kind]){K.toast('Only '+fmtLb(stockByKind()[kind])+' of '+kind+' gold in stock','bad');return;}
    const to=el.querySelector('#df_to').value.trim()||'Buyer';
    const revenue=r2(w*rt.resale);
    const n=T('dispatches').length+1;
    add('dispatches',{ref:'GD-'+pad(n,4),date:today(),time:nowTime(),to,kind,poundEq:w,rate:rt.resale,revenue});
    K.log('Dispatched '+fmtLb(w)+' ('+kind+') to '+to+' — '+money(revenue));K.toast('Dispatch recorded','ok');
    draw();
   }
   function saveRates(){
    const p=Number(el.querySelector('#rf_pound').value)||0,b=Number(el.querySelector('#rf_blade').value)||0,rs=Number(el.querySelector('#rf_resale').value)||0;
    K.setting('poundRate',p);K.setting('bladeRate',b);K.setting('resaleRate',rs);
    add('rateHistory',{date:today(),poundRate:p,bladeRate:b,resaleRate:rs});
    K.log('Updated gold buying/resale rates');K.toast('Rates saved','ok');draw();
   }
   function resetMarket(){
    const oz=Number(el.querySelector('#mk_oz').value)||2650,fx=Number(el.querySelector('#mk_fx').value)||15.3;
    K.setting('worldGoldUsdOz',oz);K.setting('usdGhsRate',fx);
    seedMarketHist();K.toast('Live feed reset to your anchors','ok');paintMarket();
   }
   K.bind(el,{dwp:paintDispatchPreview,dkind:paintDispatchPreview,dispatch:()=>dispatch(),saverates:()=>saveRates(),resetmarket:()=>resetMarket()});
   draw();
  },

  sellers(el){
   stopMarketTicker();
   K.crud(el,{table:'sellers',noun:'seller',addLabel:'Add seller',search:['name','phone'],sort:(a,b)=>a.name.localeCompare(b.name),
    cols:[{l:'Seller',f:s=>'<b>'+esc(s.name)+'</b><span class="sub2">'+esc(s.phone||'')+'</span>'},
     {l:'Times sold to us',cls:'num',f:s=>T('purchases').filter(p=>p.sellerId===s.id).length},
     {l:'Total supplied',f:s=>fmtLb(sum(T('purchases').filter(p=>p.sellerId===s.id),p=>p.poundEq))},
     {l:'Total paid',cls:'num',f:s=>money(sum(T('purchases').filter(p=>p.sellerId===s.id),p=>p.amount))}
    ],
    fields:[{k:'name',l:'Seller name',req:1,w:'full'},{k:'phone',l:'Phone (optional)'}]
   });
  },

  ledger(el){
   stopMarketTicker();
   el.innerHTML='<h3 style="margin:0 0 10px">Gold Trading Ledger</h3><div id="ltabs"></div><div id="lbody" style="margin-top:12px"></div>';
   const st={tab:0};
   const TABS=['Purchases (full record)','Dispatches / Resale','Profit report'];
   const drawTabs=()=>{el.querySelector('#ltabs').innerHTML=K.chips(TABS,st.tab,'tab');};
   const paint=()=>{
    const body=el.querySelector('#lbody');
    if(st.tab===0){
     const rows=T('purchases').slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
     body.innerHTML='<div class="card tc">'+K.table([
       {l:'Ref',f:x=>'<b>'+esc(x.ref)+'</b><span class="sub2">'+fmtDate(x.date)+' '+esc(x.time)+'</span>'},
       {l:'Seller',f:x=>sellerOf(x.sellerId).name},
       {l:'Type',f:x=>badge(x.kind==='refined'?'Refined':'Box',x.kind==='refined'?'info':'mute')},
       {l:'Weight',f:x=>x.grams+' g'},
       {l:'Karat / Blade-eq',f:x=>x.kind==='refined'?x.karat.toFixed(2)+'k':x.bladeEq.toFixed(1)},
       {l:'Pound-equivalent',cls:'num',f:x=>x.poundEq.toFixed(2)},
       {l:'Weigher',k:'weigher'},
       {l:'Amount paid',cls:'num',f:x=>money(x.amount)}
      ],rows,{empty:'No purchases yet'})+'</div>';
    }else if(st.tab===1){
     const rows=T('dispatches').slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
     body.innerHTML='<div class="card tc">'+K.table([
      {l:'Ref',f:x=>'<b>'+esc(x.ref)+'</b><span class="sub2">'+fmtDate(x.date)+'</span>'},{l:'Sold to',k:'to'},{l:'Weight',f:x=>fmtLb(x.poundEq)},{l:'Rate',cls:'num',f:x=>money(x.rate)},{l:'Revenue',cls:'num',f:x=>money(x.revenue)}
     ],rows,{empty:'No dispatches yet'})+'</div>';
    }else{
     const purchasesRows=T('purchases'),dispatchRows=T('dispatches');
     const avgCostOf=kind=>{
      const rows=purchasesRows.filter(x=>x.kind===kind);
      const eq=sum(rows,x=>x.poundEq);
      return eq>0?sum(rows,x=>x.amount)/eq:0;
     };
     const avgCostRefined=avgCostOf('refined'),avgCostBox=avgCostOf('box');
     const revenue=sum(dispatchRows,x=>x.revenue);
     const dispatchedRefinedEq=sum(dispatchRows.filter(x=>x.kind==='refined'),x=>x.poundEq);
     const dispatchedBoxEq=sum(dispatchRows.filter(x=>x.kind==='box'),x=>x.poundEq);
     const cogs=r2(avgCostRefined*dispatchedRefinedEq+avgCostBox*dispatchedBoxEq);
     const gross=r2(revenue-cogs);
     const exp=sum(T('expenses'),x=>x.amount);
     const net=r2(gross-exp);
     const byKind=stockByKind();const stockNow=stockPoundEq();const rt=rates();
     const stockCostValue=r2(avgCostRefined*byKind.refined+avgCostBox*byKind.box);
     const stockMarketValue=r2(stockNow*rt.resale);
     const unrealizedGain=r2(stockMarketValue-stockCostValue);
     body.innerHTML='<div class="card">'+K.strip([
       ['Avg. cost — Refined (per lb-eq)',money(avgCostRefined)],
       ['Avg. cost — Box (per lb-eq)',money(avgCostBox)]
      ])+'</div>'+
      '<div class="card" style="margin-top:12px">'+K.strip([
       ['Revenue from dispatches',money(revenue)],
       ['Cost of gold sold (COGS)',out(cogs),'raw'],
       ['Gross profit',pl(gross),'raw'],
       ['Operating expenses',out(exp),'raw'],
       ['Net profit',pl(net),'raw']
      ])+'</div>'+
      '<div class="card" style="margin-top:12px"><h3>Gold still in stock (not yet sold — carried as inventory, not an expense)</h3>'+K.strip([
       ['Current stock',fmtLb(stockNow)],
       ['Inventory value (at cost)',money(stockCostValue)],
       ['Inventory value (at resale rate)',money(stockMarketValue)],
       ['Unrealized gain if sold today',pl(unrealizedGain),'raw']
      ])+'</div>'+
      '<div class="bar" style="margin-top:12px"><span class="sp"></span><button class="btn pri" data-act="newexp">Add expense</button></div>'+
      '<div class="card tc">'+K.table([{l:'Date',f:e=>fmtDate(e.date)},{l:'Category',k:'category'},{l:'Note',k:'note'},{l:'Amount',cls:'num',f:e=>money(e.amount)}],T('expenses').slice().reverse(),{empty:'No expenses logged'})+'</div>';
    }
   };
   const bind=()=>{
    el.querySelector('#ltabs').onclick=e=>{const b=e.target.closest('[data-act=tab]');if(b){st.tab=+b.dataset.id;drawTabs();paint();bind();}};
    const body=el.querySelector('#lbody');
    body.onclick=e=>{
     if(e.target.closest('[data-act=newexp]'))return K.formModal({title:'Add expense',fields:[{k:'date',l:'Date',t:'date',req:1,def:today()},{k:'category',l:'Category',t:'select',opts:['Security','Assay fees','Rent','Transport','Other'],blank:false},{k:'amount',l:'Amount (GH₵)',t:'number',step:'0.01',req:1},{k:'note',l:'Note',w:'full'}],
      onSave:v=>{add('expenses',{date:v.date,category:v.category,amount:Number(v.amount),note:v.note});K.log('Expense '+money(v.amount)+' — '+v.category);K.toast('Expense recorded','ok');paint();bind();}});
    };
   };
   drawTabs();paint();bind();
  }
 },

 dashboard(K){
  const t=today(),wk=addDays(t,-6);
  const week=T('purchases').filter(x=>x.date>=wk);
  const stockNow=stockPoundEq();
  const recentP=T('purchases').slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).slice(0,5).map(x=>({t:sellerOf(x.sellerId).name+' ('+(x.kind==='refined'?'Refined':'Box')+')',s:x.grams+'g · '+fmtDate(x.date),r:money(x.amount)}));
  const recentD=T('dispatches').slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).slice(0,5).map(x=>({t:x.to,s:fmtLb(x.poundEq)+' · '+fmtDate(x.date),r:money(x.revenue)}));
  return{
   kpis:[
    {l:'Bought this week',v:fmtLb(sum(week,x=>x.poundEq)),s:week.length+' purchases',tone:'ok'},
    {l:'Paid to sellers this week',v:money(sum(week,x=>x.amount)),s:week.length+' transactions'},
    {l:'Gold in stock',v:fmtLb(stockNow),s:'pound-equivalent',tone:'info'},
    {l:'Cash float remaining',v:money(floatBalance()),s:'as of today',tone:floatBalance()>=0?'ok':'bad'}
   ],
   chart:{title:'Gold bought — last 7 days (pound-equivalent)',unit:'',data:K.lastDays(7,d=>r2(sum(T('purchases').filter(x=>x.date===d),x=>x.poundEq)))},
   lists:[{title:'Recent purchases',items:recentP,empty:'No purchases yet'},{title:'Recent dispatches',items:recentD,empty:'No dispatches yet'}]
  };
 }
};

})();
