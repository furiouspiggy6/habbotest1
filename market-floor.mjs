import {WETH,weiToEth} from './core.mjs';
// Optional read-only price check sourced from Immutable's own metadata-stack market API.
// This is NOT a TokenTrove quote and must never be used for automatic purchases.
export function parseStackFloor(payload,contract,stackId){
 const root=payload?.result?.result??payload?.result??payload;
 const candidates=Array.isArray(root)?root:[root?.result??root];
 const stack=candidates.find(b=>String(b?.stack?.contract_address??'').toLowerCase()===String(contract).toLowerCase()&&
  String(b?.stack?.stack_id??'')===String(stackId));
 if(!stack)return {status:'unavailable',reason:'No matching verified NFT metadata stack returned'};
 const listing=stack.market?.floor_listing;
 if(!listing)return {status:'unavailable',reason:'No active stack floor was published by Immutable'};
 const p=listing.price_details,token=p?.token;
 if(String(token?.type??'').toUpperCase()!=='ERC20'||
  String(token?.contract_address??token?.contractAddress??'').toLowerCase()!==WETH){
  return {status:'other-currency',reason:'The reported lowest stack offer is not priced in the verified bridged WETH token'};
 }
 const price=weiToEth(p?.amount),total=weiToEth(p?.fee_inclusive_amount);
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(total)||total<price)
  return {status:'unavailable',reason:'The stack price was invalid'};
 return {status:'available',priceEth:price,totalCostEth:total,
  orderId:String(listing.listing_id??''),assetCount:Number(stack.stack_count)||null};
}
