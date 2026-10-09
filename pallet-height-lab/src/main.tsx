import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import App from './App';
import './styles.css';
const Lab3D=lazy(()=>import('./three/Lab3D'));
const PalletLab=lazy(()=>import('./pallet/PalletLab'));
const FocusedAlps=lazy(()=>import('./pallet/presentation/FocusedAlps'));
function Root(){
  const [mode,setMode]=useState(window.location.hash);
  useEffect(()=>{const changed=()=>{setMode(window.location.hash);window.scrollTo(0,0);};window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  if(window.location.pathname.replace(/\/$/,'').endsWith('/alps'))return <Suspense fallback={<div className="three-loading" role="status">ALPS를 여는 중…</div>}><FocusedAlps/></Suspense>;
  return mode==='#pallet'?<Suspense fallback={<div className="three-loading" role="status">팔레트 연구실을 여는 중…</div>}><PalletLab/></Suspense>:mode==='#3d'?<Suspense fallback={<div className="three-loading" role="status">3D 연구실을 여는 중…</div>}><Lab3D/></Suspense>:<App/>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
