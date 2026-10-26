import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { snapshot } from '../backend/dist/operations.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=fileURLToPath(new URL('.checks/render-check.mjs',import.meta.url));
const source=`
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {WorkspaceProvider} from './frontend/src/components/workspace-provider';
import {Dashboard,TrackingPage,ActionCentre,Reports,ActivityLog,Guide} from './frontend/src/pages/workspace';
import {Approvals} from './frontend/src/pages/approvals';
import {Assistant} from './frontend/src/pages/assistant';
import {Settings} from './frontend/src/pages/settings';
export function renderScreens(data){
 const screens=[['Overview',Dashboard,{}],...['orders','pi','production','china-warehouse','shipments','india-receiving','delivery'].map(view=>[view,TrackingPage,{view}]),['Action Centre',ActionCentre,{}],['Reports',Reports,{}],['Activity Log',ActivityLog,{}],['How it works',Guide,{}],['Approval Inbox',Approvals,{}],['AI Assistant',Assistant,{}],['Settings',Settings,{}]];
 return screens.map(([name,Component,props])=>({name,html:renderToStaticMarkup(h(MemoryRouter,null,h(WorkspaceProvider,{initialData:data},h(Component,props))))}));
}`;
const result=await build({stdin:{contents:source,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../frontend/src',import.meta.url))},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
mkdirSync(fileURLToPath(new URL('.checks/',import.meta.url)),{recursive:true});
writeFileSync(output,result.outputFiles[0].text);
try {
 const {renderScreens}=await import(pathToFileURL(output).href);
 for(const {name,html} of renderScreens(snapshot())){
  assert.ok(html.length>500,name+' did not render');
  assert.ok(!html.includes('NaN'),name+' has invalid numeric output');
  assert.ok(!html.includes('Invalid Date'),name+' has invalid date output');
  console.log('Rendered '+name+': '+html.length+' characters');
 }
 console.log('All 15 workspace screens rendered with imported workbook data.');
}finally{unlinkSync(output);}
