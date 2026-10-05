import {LAYERS} from './studio-placement-state.ts'
import type {Look} from './studio-state.ts'

export type EverydayTop='shirt'|'sleeveless'|'tee'|'blouse'|'none'
export type EverydayBottom='trousers'|'skirt'|'shorts'|'none'
export type EverydayShoes='sandals'|'sneakers'|'flats'|'loafers'|'none'
export type EverydayPieces={top:EverydayTop;bottom:EverydayBottom;shoes:EverydayShoes}
export type EverydayBaseVariant={lower:'leggings'|'shorts';footwear:'open'|'closed';arms:'base'|'exposed'}
export const EVERYDAY_DEFAULTS:EverydayPieces={top:'shirt',bottom:'trousers',shoes:'sandals'}
export const EVERYDAY_VARIANT_COLOURS:Record<string,string>={shirt:'#f1ece2',sleeveless:'#f1ece2',tee:'#f1ece2',blouse:'#f1ece2',trousers:'#7e8671',skirt:'#7e8671',shorts:'#7e8671',sandals:'#674a37',sneakers:'#f1ece2',flats:'#674a37',loafers:'#674a37',crossbody:'#674a37',tote:'#674a37',shoulder:'#674a37'}
export function parseEverydayPieces(raw:unknown):EverydayPieces{
 const value=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>
 const shoe=value.shoes===true?'sandals':value.shoes===false?'none':value.shoes
 return {top:['shirt','sleeveless','tee','blouse','none'].includes(String(value.top))?value.top as EverydayTop:'shirt',bottom:['trousers','skirt','shorts','none'].includes(String(value.bottom))?value.bottom as EverydayBottom:'trousers',shoes:['sandals','sneakers','flats','loafers','none'].includes(String(shoe))?shoe as EverydayShoes:'sandals'}
}
export function everydayBaseVariant(pieces:EverydayPieces):EverydayBaseVariant{return {lower:pieces.bottom==='none'?'leggings':'shorts',footwear:['sneakers','flats','loafers'].includes(pieces.shoes)?'closed':'open',arms:pieces.top==='sleeveless'?'exposed':'base'}}
export const isEveryday=(look:Look)=>look.wardrobeArt==='easy-everyday'&&look.canvasMode==='figure'
export function resetEveryday(look:Look,restore=false){
 Object.assign(look,{wardrobeArt:'easy-everyday',canvasMode:'figure',outfit:'separates',figure:'feminine',body:'balanced',pose:'resting',outer:'none',headwear:false,beads:false,earrings:false,belt:false,bracelet:false,fan:false,wrap:'none',cane:false,watch:false,sunglasses:false,chestPanel:false,chestEmbroidery:false,pockets:false,buttons:false,details:[],placements:{},layerOrder:[...LAYERS],bag:restore?'crossbody':'none',everydayPieces:restore?{...EVERYDAY_DEFAULTS}:{top:'none',bottom:'none',shoes:'none'}})
 if(restore){Object.assign(look,{colour:'#f1ece2',lowerColour:'#7e8671',shoeColour:'#674a37',bagColour:'#674a37'});for(const key of ['colour','lowerColour','shoeColour','bagColour'])delete look.colourNames[key]}
}
export function everydayPiecePresent(look:Look,field:string){return field==='colour'?look.everydayPieces.top!=='none':field==='lowerColour'?look.everydayPieces.bottom!=='none':field==='shoeColour'?look.everydayPieces.shoes!=='none':look.bag!=='none'}
export function removeEverydayPiece(look:Look,field:string){
 if(field==='colour')look.everydayPieces.top='none'
 else if(field==='lowerColour')look.everydayPieces.bottom='none'
 else if(field==='shoeColour')look.everydayPieces.shoes='none'
 else look.bag='none'
}
