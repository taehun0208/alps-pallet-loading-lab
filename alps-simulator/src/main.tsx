import {createRoot} from 'react-dom/client';
import {lazy,Suspense} from 'react';
import Presentation from './cluster/Presentation';
const Lab=lazy(()=>import('./App'));
if(new URLSearchParams(location.search).get('view')==='lab')void import('./style.css');
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('view')==='lab'?<Suspense fallback={<p>기존 실험실을 불러오는 중…</p>}><Lab/></Suspense>:<Presentation/>);
