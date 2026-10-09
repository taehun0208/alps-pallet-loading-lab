import {createRoot} from 'react-dom/client';
import {lazy,Suspense} from 'react';
import Presentation from './cluster/Presentation';
const Lab=lazy(()=>import('./App'));
const labView=new URLSearchParams(location.search).get('view')==='lab'||location.hash==='#benchmark-best';
if(labView)void import('./style.css');
createRoot(document.getElementById('root')!).render(labView?<Suspense fallback={<p>기존 실험실을 불러오는 중…</p>}><Lab/></Suspense>:<Presentation/>);
