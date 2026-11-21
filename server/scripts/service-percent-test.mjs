// Проверка процента обслуживания у столов. Запуск: node server/scripts/service-percent-test.mjs <логин> <пароль>
// Нужен сотрудник с ПИН 2222 и правом открывать смену (создаёт pos-flow-test.mjs).
const B='http://127.0.0.1:4000/api';const [login,password]=process.argv.slice(2)
const j=async(m,p,b,t)=>{const r=await fetch(B+p,{method:m,headers:{...(b?{'Content-Type':'application/json'}:{}),...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});const d=await r.json().catch(()=>({}));return Array.isArray(d)?{s:r.status,list:d}:{s:r.status,...d}}
const ok=(n,c,e='')=>console.log((c?'PASS':'FAIL')+'  '+n+(e?'  '+e:''))
const {token:T}=await j('POST','/auth/login',{login,password})
const hall=await j('POST','/halls',{name:'Svc test '+Date.now()},T)
const t15=await j('POST','/tables',{hallId:hall.id,name:'A',seats:2,servicePercent:15},T)
const t0=await j('POST','/tables',{hallId:hall.id,name:'B',seats:2,servicePercent:0},T)
const tDef=await j('POST','/tables',{hallId:hall.id,name:'C',seats:2},T)
ok('table stores 15% / 0% / default',t15.serviceBp===1500&&t0.serviceBp===0&&tDef.serviceBp===null,[t15.serviceBp,t0.serviceBp,tDef.serviceBp].join(','))
ok('percent over 100 rejected',(await j('POST','/tables',{hallId:hall.id,name:'X',servicePercent:150},T)).s===400)
const bulk=await j('POST','/tables/bulk',{hallId:hall.id,from:1,to:3,servicePercent:7.5},T)
ok('bulk stores 7.5%',bulk.list.length===3&&bulk.list.every(t=>t.serviceBp===750))
const act=await j('POST','/pos/activate',{login,password,name:'svc'})
const P=(await j('POST','/pos/pin',{pin:'2222'},act.deviceToken)).token
const boot=await j('GET','/pos/bootstrap',null,P)
if(!boot.shift) await j('POST','/pos/shift/open',{openingCash:0},P)
const prod=boot.products.find(p=>p.price===10000)||boot.products[0]
const open=async(tid)=>{const r=await j('POST','/pos/receipts',{tableId:tid},P);const r2=await j('POST',`/pos/receipts/${r.id}/items`,{productId:prod.id},P);return r2}
const a=await open(t15.id),b=await open(t0.id),c=await open(tDef.id)
ok('receipt on 15% table',a.serviceBp===1500&&a.serviceAmount===Math.round(prod.price*0.15),`svc=${a.serviceAmount}`)
ok('receipt on 0% table has no service',b.serviceBp===0&&b.serviceAmount===0)
ok('receipt on default table uses sale type 10%',c.serviceBp===1000)
// изменить процент в любое время: новый чек берёт новый процент, открытый — остаётся
await j('PATCH','/tables/'+t15.id,{hallId:hall.id,name:'A',seats:2,servicePercent:5},T)
ok('open receipt keeps old percent',(await j('GET','/pos/receipts/'+a.id,null,P)).serviceBp===1500)
const cash=boot.paymentMethods.find(m=>m.kind==='cash').id
for(const r of [a,b,c]) await j('POST',`/pos/receipts/${r.id}/pay`,{payments:[{methodId:cash,amount:r.total}]},P)
const a2=await open(t15.id)
ok('new receipt uses changed percent 5%',a2.serviceBp===500)
await j('PATCH',`/pos/receipts/${a2.id}/items/${a2.items[0].id}`,{qty:0},P);await j('DELETE','/pos/receipts/'+a2.id,null,P)
await j('PATCH','/halls/'+hall.id,{name:hall.name,servicePercentForAll:12},T)
const hs=(await j('GET','/halls',null,T)).list.find(h=>h.id===hall.id)
ok('hall-wide percent applied to all tables',hs.tables.length===6&&hs.tables.every(t=>t.serviceBp===1200))
await j('DELETE','/halls/'+hall.id,null,T)
