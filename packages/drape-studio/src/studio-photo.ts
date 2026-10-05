export function photoPalette(data: Uint8ClampedArray,width:number,height:number):string[]{
 if(width<1||height<1||data.length<width*height*4)return []
 const bins=new Map<string,{count:number;r:number;g:number;b:number}>()
 const step=Math.max(1,Math.floor(Math.min(width,height)/80))
 for(let y=Math.floor(height*.2);y<height*.85;y+=step)for(let x=Math.floor(width*.2);x<width*.8;x+=step){
  const i=(y*width+x)*4,r=data[i]!,g=data[i+1]!,b=data[i+2]!,max=Math.max(r,g,b),min=Math.min(r,g,b)
  if(max<38||min>245||max-min<9)continue
  const key=[r,g,b].map(v=>Math.min(7,Math.floor(v/32))).join(',')
  const bin=bins.get(key)||{count:0,r:0,g:0,b:0};bin.count++;bin.r+=r;bin.g+=g;bin.b+=b;bins.set(key,bin)
 }
 const candidates=[...bins.values()].sort((a,b)=>b.count-a.count)
 const palette:string[]=[];for(const bin of candidates){const channels=[bin.r,bin.g,bin.b].map(v=>Math.round(v/bin.count)),far=palette.every(hex=>{const other=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));return Math.hypot(...channels.map((v,i)=>v-other[i]!))>48});if(!far)continue;palette.push('#'+channels.map(v=>v.toString(16).padStart(2,'0')).join(''));if(palette.length===5)break}
 return palette
}

export function photoColourAt(data:Uint8ClampedArray,width:number,height:number,x:number,y:number):string|null{
 if(width<1||height<1||data.length<width*height*4||x<0||x>=width||y<0||y>=height)return null
 const px=Math.round(x),py=Math.round(y),totals=[0,0,0];let count=0
 for(let iy=Math.max(0,py-2);iy<=Math.min(height-1,py+2);iy++)for(let ix=Math.max(0,px-2);ix<=Math.min(width-1,px+2);ix++){const offset=(iy*width+ix)*4;if(data[offset+3]!<32)continue;for(let c=0;c<3;c++)totals[c]!+=data[offset+c]!;count++}
 return count?'#'+totals.map(v=>Math.round(v/count).toString(16).padStart(2,'0')).join(''):null
}
