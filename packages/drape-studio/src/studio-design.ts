export type SurfaceKey='main'|'bottom'|'outer'|'head'
export type Surface={scale:number;rotation:number;ink:string;finish:'matte'|'satin';}
export type DesignOptions={
 fit:'fitted'|'regular'|'relaxed'; length:'short'|'midi'|'long'; bottomLength:'short'|'midi'|'long'; waist:'natural'|'high'|'low';
 skirtShape:'straight'|'aline'|'flare'|'pencil'; collar:'none'|'pointed'|'stand'; pockets:boolean; buttons:boolean;
 bagColour:string; wrapColour:string; fanColour:string; embroideryColour:string;
 surfaces:Record<SurfaceKey,Surface>;
}
export const DESIGN_DEFAULTS:DesignOptions={fit:'regular',length:'long',bottomLength:'long',waist:'natural',skirtShape:'aline',collar:'none',pockets:false,buttons:false,bagColour:'#3f332c',wrapColour:'#23766b',fanColour:'#23766b',embroideryColour:'#d1a650',surfaces:{main:{scale:1,rotation:0,ink:'#d1a650',finish:'satin'},bottom:{scale:1,rotation:0,ink:'#d1a650',finish:'satin'},outer:{scale:1,rotation:0,ink:'#d1a650',finish:'satin'},head:{scale:1,rotation:0,ink:'#d1a650',finish:'satin'}}}
const choice=<T extends string>(v:unknown,allowed:T[],fallback:T):T=>allowed.includes(v as T)?v as T:fallback
const hex=(v:unknown,f:string)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)?v.toLowerCase():f
const num=(v:unknown,min:number,max:number,f:number)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):f
export function parseDesign(v:Record<string,unknown>):DesignOptions{
 const surfaces={} as DesignOptions['surfaces'];const raw=v.surfaces&&typeof v.surfaces==='object'?v.surfaces as Record<string,unknown>:{};
 for(const key of ['main','bottom','outer','head'] as const){const s=raw[key]&&typeof raw[key]==='object'?raw[key] as Record<string,unknown>:{};surfaces[key]={scale:num(s.scale,.3,2.5,num(v.patternScale,.3,2.5,1)),rotation:num(s.rotation,0,180,0),ink:hex(s.ink,hex(v.accentColour,'#d1a650')),finish:choice(s.finish,['matte','satin'],'satin')}}
 return {fit:choice(v.fit,['fitted','regular','relaxed'],'regular'),length:choice(v.length,['short','midi','long'],'long'),bottomLength:choice(v.bottomLength,['short','midi','long'],choice(v.length,['short','midi','long'],'long')),waist:choice(v.waist,['natural','high','low'],'natural'),skirtShape:choice(v.skirtShape,['straight','aline','flare','pencil'],'aline'),collar:choice(v.collar,['none','pointed','stand'],'none'),pockets:v.pockets===true,buttons:v.buttons===true,bagColour:hex(v.bagColour,hex(v.shoeColour,'#3f332c')),wrapColour:hex(v.wrapColour,hex(v.headColour,'#23766b')),fanColour:hex(v.fanColour,hex(v.headColour,'#23766b')),embroideryColour:hex(v.embroideryColour,hex(v.accentColour,'#d1a650')),surfaces}
}
export const surfaceKey=(field:string):SurfaceKey=>field==='lowerColour'?'bottom':field==='outerColour'?'outer':field==='headColour'?'head':'main'
