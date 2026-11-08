/** Presentation-only: one cheapest visible offer per verified collectible identity.
 * Do not change saved scan rows or trading eligibility.
 * Entries with unresolved metadata are never merged by name/collection guesswork.
 */
export function cheapestPerCollectible(rows){
 const groups=new Map();
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  const identity=row?.metadataResolved===true&&typeof row.key==='string'&&
   row.key.length>0&&typeof row.contract==='string'&&row.contract.length>0
    ?row.contract.toLowerCase()+'|'+row.key
    :'unresolved-token-index:'+i;
  const previous=groups.get(identity);
  if(!previous){
   groups.set(identity,{row,count:1});
   continue;
  }
  previous.count++;
  const currentPrice=Number(row.price),previousPrice=Number(previous.row.price);
  const priceA=Number.isFinite(currentPrice)&&currentPrice>=0?currentPrice:Infinity;
  const priceB=Number.isFinite(previousPrice)&&previousPrice>=0?previousPrice:Infinity;
  const costA=Number(row.totalWithFeesEth),costB=Number(previous.row.totalWithFeesEth);
  const feeA=Number.isFinite(costA)&&costA>=0?costA:Infinity;
  const feeB=Number.isFinite(costB)&&costB>=0?costB:Infinity;
  if(feeA<feeB||(feeA===feeB&&priceA<priceB))previous.row=row;
 }
 return [...groups.values()].map(({row,count})=>({...row,groupedOfferCount:count}));
}
