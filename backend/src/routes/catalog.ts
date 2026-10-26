import { Router } from 'express';
import { getState, snapshot, plan, duplicate } from '../operations.js';
import { HttpError, paginate, text } from '../http.js';
export const catalogRouter=Router();
catalogRouter.get('/products',async (req,res)=>{
  const data=await snapshot(),query=text(req.query.q,200).toLowerCase(),customer=text(req.query.customer,200),vendor=text(req.query.vendor,200),pi=text(req.query.pi,200),stage=text(req.query.stage,100);
  const rows=data.products.filter(p=>(!query||[p.id,p.name,p.customer,p.vendor,p.pi,p.order].join(' ').toLowerCase().includes(query))&&(!customer||p.customer===customer)&&(!vendor||p.vendor===vendor)&&(!pi||p.pi===pi)&&(!stage||p.planning.stage===stage));
  res.json({...paginate(rows,req.query.page,req.query.limit),revision:data.revision});
});
catalogRouter.get('/products/:id',async (req,res)=>{
  const s=await getState(),p=s.products.find(p=>p.id===req.params.id);if(!p)throw new HttpError(404,'Product not found.');
  res.json({...p,planning:plan(p,s),activity:s.activity.filter(a=>a.productId===p.id),drafts:s.drafts.filter(d=>d.productId===p.id),revision:s.revision});
});
catalogRouter.get('/customers',async (_req,res)=>{
  const s=await getState();res.json({items:[...new Set(s.products.map(p=>p.customer))].map(name=>{const rows=s.products.filter(p=>p.customer===name);return{name,productLines:rows.length,pis:[...new Set(rows.map(p=>p.pi))],ordered:rows.reduce((n,p)=>n+p.quantity,0),delivered:rows.reduce((n,p)=>n+p.delivered,0)};})});
});
catalogRouter.get('/vendors',async (_req,res)=>{
  const s=await getState();res.json({items:[...new Set(s.products.map(p=>p.vendor))].map(name=>({name,productLines:s.products.filter(p=>p.vendor===name).length}))});
});
catalogRouter.get('/pis',async (_req,res)=>{
  const s=await getState();res.json({items:[...new Set(s.products.map(p=>p.pi))].map(id=>{const rows=s.products.filter(p=>p.pi===id);return{id,customer:rows[0].customer,order:rows[0].order,productLines:rows.length,ordered:rows.reduce((n,p)=>n+p.quantity,0),delivered:rows.reduce((n,p)=>n+p.delivered,0)};})});
});
catalogRouter.get('/shipments',async (_req,res)=>{const s=await getState();res.json({items:s.shipments.map(shipment=>({...shipment,products:s.products.filter(p=>p.shipment===shipment.Shipment_ID).map(p=>({id:p.id,name:p.name,loaded:p.loaded,india:p.india})),activity:s.activity.filter(a=>a.shipment===shipment.Shipment_ID)}))});});
catalogRouter.get('/approvals',async (req,res)=>{const s=await getState(),status=text(req.query.status,100);res.json(paginate(s.drafts.filter(d=>!status||d.status===status).map(d=>({...d,duplicate:duplicate(s,d)})),req.query.page,req.query.limit));});
catalogRouter.get('/lead-times',async (_req,res)=>res.json({items:(await await getState()).leads}));
catalogRouter.get('/inventory',async (_req,res)=>{const s=await getState();res.json({revision:s.revision,items:s.products.map(p=>({productId:p.id,pi:p.pi,name:p.name,unit:p.unit,ordered:p.quantity,chinaReceived:p.china,chinaAvailable:p.china-p.loaded,loaded:p.loaded,inTransit:p.loaded-p.india,indiaReceived:p.india,indiaAvailable:p.india-p.delivered,delivered:p.delivered,remaining:p.quantity-p.delivered}))});});
catalogRouter.get('/alerts',async (req,res)=>{const data=await snapshot();const severity=text(req.query.severity,100),owner=text(req.query.owner,100);res.json(paginate(data.alerts.filter(a=>(!severity||a.severity===severity)&&(!owner||a.owner===owner)),req.query.page,req.query.limit));});
catalogRouter.get('/activity',async (req,res)=>{const s=await getState(),productId=text(req.query.productId,100),q=text(req.query.q,200).toLowerCase();res.json(paginate(s.activity.filter(a=>(!productId||a.productId===productId)&&(!q||[a.productId,a.action,a.document,a.actor,a.notes].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.at.localeCompare(a.at)),req.query.page,req.query.limit));});
catalogRouter.get('/reports/summary',async (_req,res)=>{
  const s=await snapshot(),sum=(key:'quantity'|'china'|'loaded'|'india'|'delivered')=>s.products.reduce((total,p)=>total+p[key],0);
  res.json({asOf:s.today,revision:s.revision,productLines:s.products.length,pis:new Set(s.products.map(p=>p.pi)).size,customers:new Set(s.products.map(p=>p.customer)).size,ordered:sum('quantity'),chinaReceived:sum('china'),chinaStock:sum('china')-sum('loaded'),loaded:sum('loaded'),inTransit:sum('loaded')-sum('india'),indiaReceived:sum('india'),indiaStock:sum('india')-sum('delivered'),delivered:sum('delivered'),remaining:sum('quantity')-sum('delivered'),pendingApprovals:s.drafts.filter(d=>d.status==='Pending').length,criticalAlerts:s.alerts.filter(a=>a.severity==='Critical').length});
});
