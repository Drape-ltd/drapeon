import type {Look} from './studio-state'
import {orderedLayers,parseComposition,placementTransform,neutral} from './studio-placement-state'
import {everydayBaseVariant} from './studio-everyday-state'
import shorts from '../assets/wardrobe/easy-everyday/v2/base-shorts.png'
import leggings from '../assets/wardrobe/easy-everyday/v2/base-leggings.png'
import shirt from '../assets/wardrobe/easy-everyday/v2/shirt.png'
import sleeveless from '../assets/wardrobe/easy-everyday/v2/sleeveless-coverage-v2.png'
import skirt from '../assets/wardrobe/easy-everyday/v2/skirt.png'
import sandals from '../assets/wardrobe/easy-everyday/v2/sandals.png'
import bag from '../assets/wardrobe/easy-everyday/v2/bag.png'
import tee from '../assets/wardrobe/easy-everyday/v3/tee.png'
import blouse from '../assets/wardrobe/easy-everyday/v3/blouse.png'
import shortsPiece from '../assets/wardrobe/easy-everyday/v3/shorts.png'
import sneakers from '../assets/wardrobe/easy-everyday/v3/sneakers.png'
import tote from '../assets/wardrobe/easy-everyday/v3/tote.png'
import flats from '../assets/wardrobe/easy-everyday/v5/flats.png'
import loafers from '../assets/wardrobe/easy-everyday/v5/loafers.png'
import shoulderBag from '../assets/wardrobe/easy-everyday/v4/shoulder-bag.png'
import hoop from '../assets/wardrobe/easy-everyday/v4/hoop.png'
import necklace from '../assets/wardrobe/easy-everyday/v4/necklace.png'
import sunglasses from '../assets/wardrobe/easy-everyday/v4/sunglasses.png'
import refinedTrousers from '../assets/wardrobe/easy-everyday/v7/trousers.png'
import frontHumanShorts from '../assets/wardrobe/easy-everyday/v9/front-human-shorts.png'
import frontHumanLeggings from '../assets/wardrobe/easy-everyday/v9/front-human-leggings.png'
import frontHeadShorts from '../assets/wardrobe/easy-everyday/v9/front-head-shorts.png'
import frontHeadLeggings from '../assets/wardrobe/easy-everyday/v9/front-head-leggings.png'
import shortsMeta from '../assets/wardrobe/easy-everyday/v2/base-shorts.json'
import leggingsMeta from '../assets/wardrobe/easy-everyday/v2/base-leggings.json'
import shirtMeta from '../assets/wardrobe/easy-everyday/v2/shirt.json'
import sleevelessMeta from '../assets/wardrobe/easy-everyday/v2/sleeveless-coverage-v2.json'
import skirtMeta from '../assets/wardrobe/easy-everyday/v2/skirt.json'
import sandalsMeta from '../assets/wardrobe/easy-everyday/v2/sandals.json'
import bagMeta from '../assets/wardrobe/easy-everyday/v2/bag.json'
import teeMeta from '../assets/wardrobe/easy-everyday/v3/tee.json'
import blouseMeta from '../assets/wardrobe/easy-everyday/v3/blouse.json'
import shortsPieceMeta from '../assets/wardrobe/easy-everyday/v3/shorts.json'
import sneakersMeta from '../assets/wardrobe/easy-everyday/v3/sneakers.json'
import toteMeta from '../assets/wardrobe/easy-everyday/v3/tote.json'
import flatsMeta from '../assets/wardrobe/easy-everyday/v5/flats.json'
import loafersMeta from '../assets/wardrobe/easy-everyday/v5/loafers.json'
import shoulderBagMeta from '../assets/wardrobe/easy-everyday/v4/shoulder-bag.json'
import hoopMeta from '../assets/wardrobe/easy-everyday/v4/hoop.json'
import necklaceMeta from '../assets/wardrobe/easy-everyday/v4/necklace.json'
import sunglassesMeta from '../assets/wardrobe/easy-everyday/v4/sunglasses.json'
import refinedTrousersMeta from '../assets/wardrobe/easy-everyday/v7/trousers.json'
import trouserFitCalibration from '../assets/wardrobe/easy-everyday/v8/trouser-fit-calibration.json'

type Meta={cropBounds:{x:number;y:number;width:number;height:number};alphaBounds:{x:number;y:number;width:number;height:number};file:{width:number;height:number};hit:{path:string}}
type Sprite={src:string;meta:Meta;fit:[number,number,number,number];native:string}
const trouserFit=trouserFitCalibration.fit as [number,number,number,number]
// Each item is authored for this figure and registered in its 1024 × 1536 frame.
// Alpha contours below are invisible hit targets, never replacement artwork.
const sprites:Record<string,Sprite>={
 shirt:{src:shirt,meta:shirtMeta,fit:[.56,.55,225,50],native:'#f1ece2'},
 tee:{src:tee,meta:teeMeta,fit:[.52,.43,200,186],native:'#f1ece2'},
 blouse:{src:blouse,meta:blouseMeta,fit:[.42,.48,262,149],native:'#7e8671'},
 sleeveless:{src:sleeveless,meta:sleevelessMeta,fit:[.60,.50,208,125],native:'#f1ece2'},
 // Match the trouser length and centre to the lower-body contour traced from
 // the covered base. Leave modest ease (about 5.5%) so the garment doesn't
 // reveal the underlayer while avoiding the earlier oversized palazzo width.
 trousers:{src:refinedTrousers,meta:refinedTrousersMeta,fit:trouserFit,native:'#7e8671'},
 shorts:{src:shortsPiece,meta:shortsPieceMeta,fit:[.42,.376,297,478],native:'#7e8671'},
 skirt:{src:skirt,meta:skirtMeta,fit:[1.13,.65,-68,418],native:'#7e8671'},
 sandals:{src:sandals,meta:sandalsMeta,fit:[.9,.60,60,602],native:'#674a37'},
 sneakers:{src:sneakers,meta:sneakersMeta,fit:[.40,.21,298,1245],native:'#f1ece2'},
 flats:{src:flats,meta:flatsMeta,fit:[.15,.085,397,1335],native:'#674a37'},
 loafers:{src:loafers,meta:loafersMeta,fit:[.15,.085,397,1335],native:'#674a37'},
 bag:{src:bag,meta:bagMeta,fit:[.37,.39,346,257],native:'#674a37'},
 shoulder:{src:shoulderBag,meta:shoulderBagMeta,fit:[.18,.25,520,350],native:'#674a37'},
 tote:{src:tote,meta:toteMeta,fit:[.20,.34,558,410],native:'#674a37'},
 hoop:{src:hoop,meta:hoopMeta,fit:[.06,.06,365,145],native:'#c89445'},
 necklace:{src:necklace,meta:necklaceMeta,fit:[.18,.14,407,225],native:'#c89445'},
 sunglasses:{src:sunglasses,meta:sunglassesMeta,fit:[.11,.10,437,87],native:'#30251e'},
}
const image=(src:string,meta:Meta,id='')=>{const b=meta.cropBounds;return `<image ${id?`id="${id}"`:''} href="${src}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" preserveAspectRatio="none" pointer-events="none"/>`}
const safeText=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))
const itemNames:Record<string,string>={sandals:'Sandals',sneakers:'Sneakers',flats:'Flats',loafers:'Loafers',bag:'Crossbody bag',shoulder:'Shoulder bag',tote:'Tote bag'}
function styledItem(id:string,layer:'shoes'|'bag',x:number,y:number,width:number,height:number,colour:string){
 const s=sprites[id],name=itemNames[id]||'Accessory',a=s.meta.alphaBounds,scale=Math.min(width/a.width,height/a.height),left=x+(width-a.width*scale)/2,top=y+(height-a.height*scale)/2,filter=colour.toLowerCase()===s.native?'':`filter="url(#easyTint-${id})"`
 return `<g data-layer="${layer}" data-everyday-piece="${id}" data-colour="${colour}" data-placement-fixed="true" aria-label="${safeText(name)} in Styled with" pointer-events="none"><g transform="translate(${left} ${top}) scale(${scale}) translate(${-a.x} ${-a.y})"><g ${filter}>${image(s.src,s.meta)}</g></g></g>`
}
const channel=(hex:string,n:number)=>parseInt(hex.slice(n,n+2),16)
function tint(id:string,colour:string,native:string){if(colour.toLowerCase()===native)return '';const ratios=[1,3,5].map(n=>(channel(colour,n)/channel(native,n)).toFixed(4));return `<filter id="easyTint-${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${ratios[0]} 0 0 0 0 0 ${ratios[1]} 0 0 0 0 0 ${ratios[2]} 0 0 0 0 0 1 0"/></filter>`}
function piece(id:string,colour:string){const s=sprites[id],[sx,sy,x,y]=s.fit;const changed=colour.toLowerCase()!==s.native;return `<g data-everyday-piece="${id}" data-colour="${colour}" ${id==='trousers'?'data-fit="leg-outline-calibrated"':''} transform="scale(.48828125)"><g transform="matrix(${sx} 0 0 ${sy} ${x} ${y})"><g ${changed?`filter="url(#easyTint-${id})"`:''}>${image(s.src,s.meta)}</g><path data-art-hit="true" d="${s.meta.hit.path}" fill="transparent" fill-rule="evenodd" pointer-events="all"/></g></g>`}
let renderSequence=0
export function renderEveryday(look:Look){
 const scope=`easy-${++renderSequence}`
 const p=look.everydayPieces,base=everydayBaseVariant(p),src=base.lower==='shorts'?shorts:leggings,meta=base.lower==='shorts'?shortsMeta:leggingsMeta
 const shoeId=p.shoes==='none'?'':p.shoes
 const bagId=look.bag==='none'?'':look.bag==='tote'?'tote':look.bag==='shoulder'?'shoulder':'bag'
 const colours:Record<string,string>={[p.top]:look.colour,[p.bottom]:look.lowerColour,[shoeId]:look.shoeColour,[bagId]:look.bagColour,...(look.beads?{necklace:'#ad7926'}:{})}
 const filters=Object.entries(colours).filter(([id])=>sprites[id]).map(([id,c])=>tint(id,c,sprites[id].native)).join('')
 const layerAccessories=[look.earrings?`${piece('hoop',sprites.hoop.native)}<g transform="translate(500 0) scale(-1 1)">${piece('hoop',sprites.hoop.native)}</g>`:'',look.beads?piece('necklace','#ad7926'):'',look.sunglasses?piece('sunglasses',sprites.sunglasses.native):''].join('')
 const layers={main:p.top==='none'?'':piece(p.top,look.colour),bottom:p.bottom==='none'?'':piece(p.bottom,look.lowerColour),shoes:'',accessories:layerAccessories,bag:''}
 const composition=parseComposition(look as unknown as Record<string,unknown>),foregroundLayers={...layers,accessories:''},frontAccessories=orderedLayers({accessories:layerAccessories},composition)
 const foregroundPieces=(['main','bottom'] as const).flatMap(layer=>{
  const id=layer==='main'?p.top:p.bottom
  const sprite=id==='none'?null:sprites[id]
  if(!sprite)return []
  const [sx,sy,x,y]=sprite.fit,placement=placementTransform(layer,composition.placements[layer]||neutral())
  return [`<g transform="scale(2.048)"><g transform="${placement}"><g transform="scale(.48828125)"><g transform="matrix(${sx} 0 0 ${sy} ${x} ${y})" filter="url(#easyHumanOcclusionAlpha)">${image(sprite.src,sprite.meta)}</g></g></g></g>`]
 }).join('')
 const blackAlpha=`<filter id="easyHumanOcclusionAlpha"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter>`
 const humanMask=`<mask id="easyHumanOcclusion" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1536" style="mask-type:luminance"><rect x="0" y="0" width="1024" height="1536" fill="white"/>${foregroundPieces}</mask>`
 const sketch=look.sketch.map((line,i)=>`<polyline data-line="${i}" tabindex="0" role="button" aria-label="Sketch line. Delete removes." points="${line.points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${line.colour}" stroke-width="${line.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
 const humanFront=base.lower==='shorts'?frontHumanShorts:frontHumanLeggings
 const humanFrontMeta=base.lower==='shorts'?shortsMeta:leggingsMeta
 const headFront=base.lower==='shorts'?frontHeadShorts:frontHeadLeggings
 const shoeCoversFoot=base.footwear==='closed'
 const shoeMask=shoeCoversFoot?`<clipPath id="easyShoeBase"><rect x="0" y="0" width="1024" height="1370"/></clipPath>`:''
 const shoeMaskAttr=shoeCoversFoot?'clip-path="url(#easyShoeBase)"':''
 const styledWith=p.shoes!=='none'||bagId?`<g data-styled-with="true" role="group" aria-label="Styled with: ${safeText([shoeId?itemNames[shoeId]:null,bagId?itemNames[bagId]:null].filter(Boolean).join(' and '))}"><rect x="348" y="35" width="145" height="79" rx="10" fill="#fffef9" fill-opacity=".94" stroke="#d9d8ce"/><text x="358" y="48" fill="#788375" font-family="sans-serif" font-size="6.5" font-weight="700" letter-spacing="1">STYLED WITH</text>${shoeId?`${styledItem(shoeId,'shoes',356,55,70,34,look.shoeColour)}<text x="358" y="107" fill="#4c5a50" font-family="sans-serif" font-size="7">${safeText(itemNames[shoeId]||'Shoes')}</text>`:''}${bagId?`${styledItem(bagId,'bag',441,54,32,49,look.bagColour)}<text x="439" y="107" fill="#4c5a50" font-family="sans-serif" font-size="7">${safeText(itemNames[bagId]||'Bag')}</text>`:''}</g>`:''
 return `<defs>${filters}${blackAlpha}${humanMask}${image(src,meta,'easyBasePixels')}${image(humanFront,humanFrontMeta,'easyHumanFrontPixels')}${image(headFront,humanFrontMeta,'easyHeadFrontPixels')}${shoeMask}</defs><g data-model="fixed" data-everyday-base="${base.lower}" data-base-arms="${base.arms}" data-footwear-base="${base.footwear}" data-neutral-cover="true" transform="scale(.48828125)" pointer-events="none" ${shoeMaskAttr}><use href="#easyBasePixels"/></g>${orderedLayers(foregroundLayers,composition)}<g transform="scale(.48828125)" mask="url(#easyHumanOcclusion)"><use data-model-foreground="true" href="#easyHumanFrontPixels" pointer-events="none"/></g><use data-model-head-foreground="true" href="#easyHeadFrontPixels" transform="scale(.48828125)" pointer-events="none"/>${frontAccessories}${styledWith}${sketch}`.replaceAll('easyBasePixels',`${scope}-base`).replaceAll('easyHumanFrontPixels',`${scope}-human-front`).replaceAll('easyHeadFrontPixels',`${scope}-head-front`).replaceAll('easyShoeBase',`${scope}-shoe-base`).replaceAll('easyHumanOcclusionAlpha',`${scope}-human-alpha`).replaceAll('easyHumanOcclusion',`${scope}-human-occlusion`).replaceAll('easyTint-',`${scope}-tint-`)
}
