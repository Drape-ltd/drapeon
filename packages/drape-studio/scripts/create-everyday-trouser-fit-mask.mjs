#!/usr/bin/env node
/**
 * Trace the lower-body silhouette from the fixed Easy everyday base figure.
 * The generated mask is a clipping guide, not visible artwork. It includes the
 * modest grey shorts and leg contours, while excluding hands and bare feet.
 */
import {createRequire} from 'node:module'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {prepareEverydayAsset} from './prepare-everyday-assets.mjs'

const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url))
const sharp=require('sharp')
const root=resolve(new URL('../assets/wardrobe/easy-everyday/',import.meta.url).pathname)
const base=resolve(root,'v2/base-shorts.png')
const metadata=JSON.parse(await readFile(resolve(root,'v2/base-shorts.json'),'utf8'))
const output=resolve(root,'v8/trouser-fit-mask.png')
const {data,info}=await sharp(base).ensureAlpha().raw().toBuffer({resolveWithObject:true})
const mask=Buffer.alloc(info.width*info.height*4)
function set(x,y){const offset=(y*info.width+x)*4;mask[offset]=255;mask[offset+1]=255;mask[offset+2]=255;mask[offset+3]=255}
function rangesForRow(y,accept){
  const ranges=[];let start=-1
  for(let x=0;x<info.width;x++){
    const i=(y*info.width+x)*4,r=data[i],g=data[i+1],b=data[i+2],a=data[i+3]
    if(accept(x,r,g,b,a)){if(start<0)start=x}
    else if(start>=0){ranges.push([start,x-1]);start=-1}
  }
  if(start>=0)ranges.push([start,info.width-1])
  return ranges
}
const neutralBase=(r,g,b,a)=>a>120&&Math.max(r,g,b)-Math.min(r,g,b)<24&&r>35&&r<190
for(let y=355;y<=410;y++){
  // The lower grey base layer sits beneath the shirt; the shirt artwork masks
  // any small overlap at the waist.
  for(const [left,right] of rangesForRow(y,(_x,r,g,b,a)=>neutralBase(r,g,b,a)))
    for(let x=left;x<=right;x++)set(x,y)
}
let tracedRows=0,firstLegRow=-1,firstLegPair=[]
const legPairs=new Map()
for(let y=467;y<748;y++){
  const legs=rangesForRow(y,(_x,r,g,b,a)=>a>120&&r>g+14&&g>b+5&&r>70)
    .filter(([left,right])=>right-left>=24&&left>145&&right<390)
  if(legs.length<2)continue
  // Select the two central leg components, leaving hands and feet out of the
  // garment's contour. A few pixels of ease soften the edge against the body.
  const center=(info.width-1)/2
  const pair=legs.sort((a,b)=>Math.abs((a[0]+a[1])/2-center)-Math.abs((b[0]+b[1])/2-center)).slice(0,2).sort((a,b)=>a[0]-b[0])
  if(firstLegRow<0){firstLegRow=y;firstLegPair=pair}
  legPairs.set(y,pair)
  for(const [left,right]of pair)for(let x=Math.max(0,left-4);x<=Math.min(info.width-1,right+4);x++)set(x,y)
  tracedRows++
}
if(tracedRows<180)throw new Error(`Expected a continuous leg trace, found ${tracedRows} rows`)
// Join the grey hip/shorts panel to the skin-derived leg contours. The bridge
// continues down the upper thigh so the garment's crotch is not cut away.
if(firstLegRow<0)throw new Error('No leg outline found for the fit guide')
for(let y=Math.max(355,firstLegRow-18);y<=firstLegRow+50;y++){
  const pair=legPairs.get(y)||firstLegPair
  for(let x=Math.max(0,pair[0][0]-6);x<=Math.min(info.width-1,pair[1][1]+6);x++)set(x,y)
}
// Replace the base shorts' horizontal leg opening with a continuous trouser
// hip-to-crotch panel. Interpolate from the waistband outline into the traced
// leg outline instead of carrying the shorts hem into the new garment.
const hipRanges=rangesForRow(410,(_x,r,g,b,a)=>neutralBase(r,g,b,a))
if(!hipRanges.length)throw new Error('Could not trace the hip edge for trousers')
for(let y=411;y<firstLegRow;y++){
  const t=(y-410)/Math.max(1,firstLegRow-410)
  const left=Math.round(hipRanges[0][0]+(firstLegPair[0][0]-hipRanges[0][0])*t)
  const right=Math.round(hipRanges.at(-1)[1]+(firstLegPair[1][1]-hipRanges.at(-1)[1])*t)
  for(let x=Math.max(0,left-4);x<=Math.min(info.width-1,right+4);x++)set(x,y)
}
const {x,y,width,height}=metadata.cropBounds
const canvasWidth=metadata.original.width,canvasHeight=metadata.original.height
await mkdir(dirname(output),{recursive:true})
const resizedMask=await sharp(mask,{raw:{width:info.width,height:info.height,channels:4}}).resize(width,height,{fit:'fill',kernel:'lanczos3'}).png().toBuffer()
const composed=await sharp({create:{width:canvasWidth,height:canvasHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
  .composite([{input:resizedMask,left:x,top:y}]).png().toBuffer()
const {data:resizedPixels}=await sharp(composed).ensureAlpha().raw().toBuffer({resolveWithObject:true})
const total=canvasWidth*canvasHeight,occupied=new Uint8Array(total),outside=new Uint8Array(total),queue=new Int32Array(total)
for(let i=0;i<total;i++)occupied[i]=resizedPixels[i*4+3]>127?1:0
let head=0,tail=0
function addOutside(index){if(!outside[index]&&!occupied[index]){outside[index]=1;queue[tail++]=index}}
for(let xx=0;xx<canvasWidth;xx++){addOutside(xx);addOutside((canvasHeight-1)*canvasWidth+xx)}
for(let yy=0;yy<canvasHeight;yy++){addOutside(yy*canvasWidth);addOutside(yy*canvasWidth+canvasWidth-1)}
while(head<tail){const at=queue[head++],xx=at%canvasWidth,yy=(at-xx)/canvasWidth;if(xx)addOutside(at-1);if(xx+1<canvasWidth)addOutside(at+1);if(yy)addOutside(at-canvasWidth);if(yy+1<canvasHeight)addOutside(at+canvasWidth)}
const cleaned=Buffer.alloc(total*4)
for(let i=0;i<total;i++){
  const inside=occupied[i]||!outside[i]
  if(inside){cleaned[i*4]=cleaned[i*4+1]=cleaned[i*4+2]=255;cleaned[i*4+3]=255}
}
await sharp(cleaned,{raw:{width:canvasWidth,height:canvasHeight,channels:4}}).blur(.45).png().toFile(output)
const outline=await prepareEverydayAsset(output,resolve(root,'v8/trouser-fit-outline'),{hitSampleStep:1})
const trousers=JSON.parse(await readFile(resolve(root,'v7/trousers.json'),'utf8'))
const widthEase=1.055
const sx=Number((outline.alphaBounds.width*widthEase/trousers.alphaBounds.width).toFixed(2))
const sy=Number((outline.alphaBounds.height/trousers.alphaBounds.height).toFixed(3))
const fit=[sx,sy,Number((metadata.original.width/2-(trousers.alphaBounds.x+trousers.alphaBounds.width/2)*sx).toFixed(1)),Number((outline.alphaBounds.y-trousers.alphaBounds.y*sy).toFixed(1))]
const calibration={schemaVersion:1,source:'v7/trousers.json',target:'v8/trouser-fit-outline.json',widthEase,modelHipAxis:metadata.original.width/2,fit}
const calibrationPath=resolve(root,'v8/trouser-fit-calibration.json')
await writeFile(calibrationPath,`${JSON.stringify(calibration,null,2)}\n`)
console.log(JSON.stringify({output,calibrationPath,sourceDimensions:info,tracedRows,canvas:metadata.original,outlineBounds:outline.alphaBounds,outlineContours:outline.hit.contours,fit}))
