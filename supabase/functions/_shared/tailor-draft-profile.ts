const priceBounds: Record<string,{min:number;max:number}>={
  NGN:{min:5000,max:9999999},GHS:{min:50,max:1000000},KES:{min:500,max:5000000},
  USD:{min:10,max:100000},GBP:{min:10,max:100000},EUR:{min:10,max:100000},CAD:{min:10,max:100000},
}

export type TailorDraftFields={
  displayName:string;businessName:string|null;bio:string;location:string;languages:string[];specialties:string[];
  currency:string;priceMin:number;priceMax:number;
}

const cleanList=(value:unknown,max:number)=>Array.isArray(value)
  ? value.map(item=>typeof item==='string'?item.trim():'').filter(Boolean).slice(0,max+1)
  : []

export function validateTailorDraftFields(body:Record<string,unknown>):{value?:TailorDraftFields;error?:string}{
  const displayName=typeof body.displayName==='string'?body.displayName.trim().slice(0,80):''
  const businessName=typeof body.businessName==='string'?(body.businessName.trim().slice(0,120)||null):null
  const bio=typeof body.bio==='string'?body.bio.trim().slice(0,2000):''
  const location=typeof body.location==='string'?body.location.trim().slice(0,120):''
  const languages=cleanList(body.languages,12),specialties=cleanList(body.specialties,20)
  const currency=typeof body.currency==='string'?body.currency.trim().toUpperCase():''
  const priceMin=Number(body.priceMin),priceMax=Number(body.priceMax),bounds=priceBounds[currency]
  if(displayName.length<2)return {error:'Add a public display name.'}
  if(!location)return {error:'Add a public location.'}
  if(bio.length<80)return {error:'Add at least 80 characters about the tailor’s work.'}
  if(languages.length<1||languages.length>12)return {error:'Choose between 1 and 12 languages.'}
  if(specialties.length<1||specialties.length>20)return {error:'Choose between 1 and 20 specialties.'}
  if(!bounds)return {error:'Choose a supported currency.'}
  if(!Number.isInteger(priceMin)||!Number.isInteger(priceMax)||priceMin<bounds.min||priceMax<priceMin||priceMax>bounds.max)return {error:`Set a valid ${currency} price range from ${bounds.min} to ${bounds.max}.`}
  return {value:{displayName,businessName,bio,location,languages,specialties,currency,priceMin,priceMax}}
}
