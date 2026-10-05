export const LAYERS = ['bottom','main','outer','shoes','accessories','bag','headwear'] as const
export type LayerId = typeof LAYERS[number]
export type Placement = {x:number;y:number;scale:number;rotation:number;locked:boolean}
export type Composition = {placements:Partial<Record<LayerId,Placement>>;layerOrder:LayerId[]}
export const LABELS:Record<LayerId,string>={main:'Main garment',bottom:'Bottom',outer:'Outer layer',shoes:'Shoes',headwear:'Headwear',accessories:'Jewellery & details',bag:'Bag'}
export const FIELDS:Record<LayerId,string>={main:'colour',bottom:'lowerColour',outer:'outerColour',shoes:'shoeColour',headwear:'headColour',accessories:'accentColour',bag:'accentColour'}
export const PIVOTS:Record<LayerId,[number,number]>={main:[250,210],bottom:[250,355],outer:[250,210],shoes:[250,704],headwear:[250,74],accessories:[250,295],bag:[317,365]}
export const neutral=():Placement=>({x:0,y:0,scale:1,rotation:0,locked:false})
const finite=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback
export function boundedPlacement(raw:unknown):Placement{const v=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;return {x:finite(v.x,-350,350,0),y:finite(v.y,-550,550,0),scale:finite(v.scale,.35,2.5,1),rotation:finite(v.rotation,-180,180,0),locked:v.locked===true}}
export type PlacementPoint={x:number;y:number}
export function transformPlacementWithPointers(initial:Placement,start:[PlacementPoint,PlacementPoint],current:[PlacementPoint,PlacementPoint]):Placement{
 const center=(points:[PlacementPoint,PlacementPoint])=>({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2})
 const distance=(points:[PlacementPoint,PlacementPoint])=>Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)
 const angle=(points:[PlacementPoint,PlacementPoint])=>Math.atan2(points[1].y-points[0].y,points[1].x-points[0].x)
 const startCenter=center(start),currentCenter=center(current),rotation=angle(current)-angle(start)
 return boundedPlacement({...initial,x:initial.x+currentCenter.x-startCenter.x,y:initial.y+currentCenter.y-startCenter.y,scale:initial.scale*distance(current)/Math.max(1,distance(start)),rotation:((initial.rotation+rotation*180/Math.PI+540)%360)-180})
}
export function parseComposition(raw:Record<string,unknown>):Composition{const placements:Composition['placements']={};const values=(raw.placements&&typeof raw.placements==='object'?raw.placements:{}) as Record<string,unknown>;for(const key of LAYERS)if(values[key])placements[key]=boundedPlacement(values[key]);const order=Array.isArray(raw.layerOrder)?raw.layerOrder.filter((k):k is LayerId=>LAYERS.includes(k as LayerId)):[];return {placements,layerOrder:[...new Set([...order,...LAYERS])]}}
export function placementTransform(key:LayerId,p:Placement){const [x,y]=PIVOTS[key];return `translate(${p.x} ${p.y}) translate(${x} ${y}) rotate(${p.rotation}) scale(${p.scale}) translate(${-x} ${-y})`}
export function layerMarkup(key:LayerId,markup:string,composition:Composition){if(!markup)return '';const p=composition.placements[key]||neutral();return `<g data-layer="${key}" data-piece="${FIELDS[key]}" transform="${placementTransform(key,p)}" aria-label="${LABELS[key].replace(/&/g,'&amp;')}" style="cursor:${p.locked?'pointer':'grab'}">${markup}</g>`}
export function orderedLayers(layers:Partial<Record<LayerId,string>>,composition:Composition){return composition.layerOrder.map(key=>layerMarkup(key,layers[key]||'',composition)).join('')}
