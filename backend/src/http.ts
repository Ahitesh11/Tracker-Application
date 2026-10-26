import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const requestContext: RequestHandler = (_req,res,next) => {
  res.locals.requestId=randomUUID(); res.setHeader('X-Request-Id',res.locals.requestId);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');next();
};
export const jsonBody: RequestHandler = (req,_res,next) => {
  if(!['POST','PATCH','PUT'].includes(req.method)){next();return;}
  if(!req.is('application/json')){next(new HttpError(415,'Use Content-Type: application/json.'));return;}
  if(!req.body || typeof req.body!=='object' || Array.isArray(req.body)){next(new HttpError(400,'Request body must be a JSON object.'));return;}
  next();
};
export const errors: ErrorRequestHandler = (error: unknown,_req,res,_next) => {
  let status=500,message='Service unavailable. Check the backend or AI connection and retry.';
  if(error && typeof error==='object' && 'status' in error && typeof error.status==='number' && error.status>=400 && error.status<600){status=error.status;message=error instanceof Error?error.message:'Request failed.';}
  if(error && typeof error==='object' && 'type' in error && error.type==='entity.parse.failed'){status=400;message='Invalid JSON request.';}
  if(status===413)message='Request is too large. Maximum JSON size is 100 KB.';
  if(error instanceof Error && /SQLITE_BUSY|database is locked/.test(error.message)){status=503;message='Database is busy. Retry shortly.';}
  if(status>=500)console.error(JSON.stringify({requestId:res.locals.requestId,error:error instanceof Error?error.name:'UnknownError',status}));
  res.status(status).json({error:message,requestId:res.locals.requestId});
};
export function text(value: unknown,max=2000){
  if(value===undefined)return '';
  if(typeof value!=='string')throw new HttpError(400,'Text fields must contain strings.');
  if(value.length>max)throw new HttpError(400,`Text field exceeds ${max} characters.`);
  return value.trim();
}
export function integer(value:unknown,min=0,max=1000000){
  if((typeof value!=='number' && typeof value!=='string') || (typeof value==='string'&&!/^\d+$/.test(value)))throw new HttpError(400,'Enter a valid whole number.');
  const result=Number(value);
  if(!Number.isSafeInteger(result)||result<min||result>max)throw new HttpError(400,`Number must be between ${min} and ${max}.`);
  return result;
}
export function paginate<T>(items:T[],pageValue:unknown,limitValue:unknown){
  const page=integer(pageValue??1,1,100000),limit=integer(limitValue??25,1,100);
  return {items:items.slice((page-1)*limit,page*limit),page,limit,total:items.length,pages:Math.ceil(items.length/limit)};
}
