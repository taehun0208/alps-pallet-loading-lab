import type { Distribution } from './model';
export function percentile(values:number[],p:number):number|null{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),x=Math.max(0,Math.min(1,p))*(s.length-1),lo=Math.floor(x);return s[lo]+(s[Math.ceil(x)]-s[lo])*(x-lo);}
// Student-t two-sided 95% critical values (df 1..30); asymptotic approximation thereafter.
const T=[12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.16,2.145,2.131,2.12,2.11,2.101,2.093,2.086,2.08,2.074,2.069,2.064,2.06,2.056,2.052,2.048,2.045,2.042];
export function distribution(raw:(number|null|undefined)[]):Distribution{
 const a=raw.filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)),n=a.length;
 if(!n)return {n:0,mean:null,median:null,std:null,min:null,max:null,p05:null,p95:null,ci95:null};
 const mean=a.reduce((a,b)=>a+b,0)/n,std=n>1?Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/(n-1)):null,df=n-1,t=df<=30?T[df-1]:1.959964+(1.959964**3+1.959964)/(4*df),half=std===null?null:t*std/Math.sqrt(n);
 return {n,mean,median:percentile(a,.5),std,min:Math.min(...a),max:Math.max(...a),p05:percentile(a,.05),p95:percentile(a,.95),ci95:half===null?null:[mean-half,mean+half]};
}
export const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export const lowerScore=(n:number,good:number,bad:number)=>100*clamp((bad-n)/(bad-good));
// Canonical experiment identity excludes algorithm identity and never enters PlanningInput.
export function fingerprint(value:unknown){const canonical=(v:any):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v)??'null';let h=2166136261;for(const c of canonical(value))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16).padStart(8,'0');}
