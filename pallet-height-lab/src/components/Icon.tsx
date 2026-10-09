const paths:Record<string,string>={
  cube:'m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7M12 12v10',
  play:'m8 5 11 7-11 7Z',pause:'M8 5v14M16 5v14',back:'m15 5-7 7 7 7',next:'m9 5 7 7-7 7',skip:'m5 5 10 7-10 7ZM19 5v14',reset:'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',book:'M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4ZM13 7a3 3 0 0 1 3-3h5v14h-5a3 3 0 0 0-3 3',
  tree:'M12 3v6M5 15V9h14v6M12 9v6M3 15h4v5H3ZM10 15h4v5h-4ZM17 15h4v5h-4Z',help:'M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 3M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  down:'m6 9 6 6 6-6',check:'m5 12 4 4 10-10',pin:'m8 3 8 0-1 6 3 3-5 1v8M6 12l3-3Z',arrow:'M4 12h16m-6-6 6 6-6 6',flask:'M9 3h6M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M7 15h10',
  chart:'M4 3v17h17M8 16v-4M13 16V7M18 16v-7',edit:'m4 16 12-12 4 4L8 20H4Zm10-10 4 4',close:'m6 6 12 12M18 6 6 18',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0',info:'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',grid:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',stop:'M6 6h12v12H6Z'
};
export function Icon({name,size=18}:{name:string;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill={name==='play'?'currentColor':'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]??paths.info}/></svg>;}
