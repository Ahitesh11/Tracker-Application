import { LayoutDashboard, ClipboardList, FileText, Factory, Warehouse, Ship, PackageCheck, Truck, Workflow, Sparkles, ChartNoAxesCombined, ListChecks, History, Settings2, BookOpen } from 'lucide-react';
export const navigation = [
  {path:'/',label:'Overview',icon:LayoutDashboard,description:'Your China-to-India operation, in one place.'},
  {path:'/orders',label:'Products & Orders',icon:ClipboardList,description:'Every product line, from final PI to customer delivery.'},
  {path:'/pi',label:'PI Tracker',icon:FileText,description:'One customer, one PI, a complete picture of every product.'},
  {path:'/production',label:'Production',icon:Factory,description:'Authorize, instruct, acknowledge and track factory progress.'},
  {path:'/china-warehouse',label:'China Warehouse',icon:Warehouse,description:'Vendor collection, partial receipts and available stock.'},
  {path:'/shipments',label:'Shipments',icon:Ship,description:'Container allocation and recorded China-to-India movements.'},
  {path:'/india-receiving',label:'India Receiving',icon:PackageCheck,description:'Reconcile loaded goods with actual arrivals.'},
  {path:'/delivery',label:'Customer Delivery',icon:Truck,description:'Deliver available stock and track the remaining balance.'},
  {path:'/fms',label:'Action Centre',icon:Workflow,description:'What needs attention, who owns it and what to do next.'},
  {path:'/approvals',label:'Approval Inbox',icon:ListChecks,description:'Review movement drafts before they change official quantities.'},
  {path:'/ai-assistant',label:'AI Assistant',icon:Sparkles,description:'Ask about products, find pending work and draft follow-ups.'},
  {path:'/reports',label:'Reports',icon:ChartNoAxesCombined,description:'Reconciled product counts and quantities from your workspace.'},
  {path:'/activity',label:'Activity Log',icon:History,description:'The record of imported movements and operator updates.'},
  {path:'/settings',label:'Connections & Planning',icon:Settings2,description:'AI connection status, source data and category lead times.'},
  {path:'/guide',label:'How it works',icon:BookOpen,description:'A simple guide for your India and China teams.'},
];
